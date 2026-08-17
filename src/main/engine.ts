/**
 * Vòng đời tiến trình engine dsh: khởi động, chờ tín hiệu sẵn sàng, dừng sạch,
 * và dọn xác của lần chạy trước.
 *
 * App không nhúng engine vào tiến trình Electron mà spawn nó ra riêng, chạy
 * bằng node.exe đóng gói kèm app (xem `nodeExePath`). Nhờ vậy người dùng không
 * cần cài Node.js, mà engine vẫn chạy đúng như khi gõ `dsh web` trong terminal
 * — trên đúng runtime upstream nhắm tới.
 * @module
 */

import { spawn, execFile, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync, createWriteStream, readFileSync, rmSync, writeFileSync, type WriteStream } from 'node:fs'
import { logShell } from './log.js'
import {
  dockPatchPath,
  dshBinPath,
  engineLogPath,
  enginePidPath,
  nodeExePath,
  pluginManagerPatchPath,
  pluginStatePath,
} from './paths.js'

/**
 * Dòng dsh in ra stdout sau khi cây plugin đã settle. Upstream coi đây là tín
 * hiệu sẵn sàng chính thức: thấy dòng này thì gọi RPC được ngay.
 */
const READY_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m

/**
 * Hạn chờ engine sẵn sàng. Lần chạy đầu tiên tốn thêm thời gian khởi tạo
 * profile và dựng cây symlink trong `%USERPROFILE%\.dsh`, nên hạn phải rộng.
 */
const READY_TIMEOUT_MS = 180_000

/** Số ký tự log giữ lại trong bộ nhớ để hiển thị khi engine chết. */
const TAIL_LIMIT = 4000

/**
 * Contents of the state file when nothing is disabled yet: an empty list.
 *
 * It has to be valid YAML and a top-level array — the engine treats an unreadable
 * `--patch` file as a startup failure, so a missing or malformed file means the app
 * does not open at all.
 */
const EMPTY_PLUGIN_STATE = `# Plugins currently turned off in Harness Desktop.
#
# The app writes this file when you flip a switch in Settings > Plugins > On/off.
#
# ESCAPE HATCH: if the app will not start after you disabled something, delete the
# contents of this file and replace them with the two characters [] , then reopen
# the app. Every plugin returns to its default.

[]
`

/**
 * Make sure the state file exists before the engine is spawned.
 *
 * The engine treats an unreadable `--patch` file as a startup failure, and on the
 * very first run nobody has created this file yet. Created only when missing — never
 * overwrites the user's choices.
 */
function ensurePluginState(): void {
  const path = pluginStatePath()
  if (existsSync(path)) return
  try {
    writeFileSync(path, EMPTY_PLUGIN_STATE)
    logShell(`plugin: created empty state file ${path}`)
  } catch (error) {
    logShell(`plugin: could NOT create the state file — ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Engine đang chạy. */
export interface Engine {
  /** URL loopback của Web UI, ví dụ `http://127.0.0.1:53211`. */
  readonly url: string
  /** PID tiến trình engine. */
  readonly pid: number
}

let child: ChildProcess | undefined
let logStream: WriteStream | undefined
let tail = ''

/**
 * App đang chủ động dừng engine (thoát app, hoặc người dùng bấm Thử lại).
 *
 * Không có cờ này thì cái chết do chính ta gây ra cũng đi qua nhánh "engine
 * dừng đột ngột" và bật trang lỗi lên — ngay giữa lúc app đang đóng, hoặc đè
 * lên màn hình chờ của lần khởi động lại.
 */
let stopping = false

/** Lỗi engine chết trước khi kịp sẵn sàng, kèm đoạn log cuối để hiển thị. */
export class EngineStartError extends Error {
  constructor(message: string, readonly tail: string) {
    super(message)
    this.name = 'EngineStartError'
  }
}

/**
 * Diệt cả cây tiến trình. `child.kill()` chỉ hạ tiến trình cha, để lại các
 * worker con của engine chạy tiếp và giữ cổng — trên Windows phải dùng
 * `taskkill /T`.
 */
function killTree(pid: number): void {
  try {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {})
  } catch {
    // Tiến trình đã chết rồi thì không còn gì để làm.
  }
}

/** Dấu vết engine của lần chạy trước, đủ để nhận lại đúng tiến trình đó. */
interface EngineMark {
  pid: number
  /** Thời điểm app spawn engine, tính bằng mili giây epoch. */
  spawnedAt: number
}

/**
 * Sai số cho phép giữa thời điểm app spawn và thời điểm hệ điều hành ghi nhận
 * tiến trình ra đời. Hai mốc này cách nhau vài mili giây; năm giây là rộng rãi
 * mà vẫn đủ hẹp để loại một tiến trình khác được cấp lại cùng PID — tiến trình
 * đó chỉ có thể ra đời SAU khi engine cũ chết, tức là rất lâu sau mốc đã lưu.
 */
const MARK_TOLERANCE_MS = 5_000

/** Thời điểm hệ điều hành tạo tiến trình mang PID này, hoặc undefined nếu không tra được. */
function processCreationTime(pid: number): number | undefined {
  try {
    // Hỏi bằng HAI câu, và kiểm null trước khi gọi phương thức.
    //
    // Bản một câu `(Get-CimInstance ...).CreationDate.ToFileTimeUtc()` hỏng ở
    // đúng trường hợp thường gặp nhất: tiến trình engine của lần trước đã chết
    // rồi. Lúc đó `Get-CimInstance` không lỗi — nó trả về RỖNG — nên
    // `-ErrorAction Stop` không cứu được gì, và PowerShell in ra sáu dòng đỏ
    // *"You cannot call a method on a null-valued expression"* ngay giữa màn
    // hình khởi động của người dùng. Hàm vẫn trả đúng `undefined`, tức là app
    // vẫn xử lý đúng; chỉ có người dùng là bị doạ.
    const query = '$p = Get-CimInstance Win32_Process -Filter "ProcessId=' + String(pid) + '"'
      + ' -ErrorAction SilentlyContinue; if ($p) { $p.CreationDate.ToFileTimeUtc() }'
    const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', query], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      // Không cho stderr của PowerShell chảy thẳng ra terminal của người dùng.
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    const fileTime = Number(output)
    if (!Number.isFinite(fileTime) || fileTime <= 0) return undefined
    // FILETIME đếm đơn vị 100 nano giây từ 1601-01-01; quy về epoch mili giây.
    return fileTime / 10_000 - 11_644_473_600_000
  } catch {
    return undefined
  }
}

/**
 * Dọn engine còn sót của lần chạy trước (app bị tắt cứng nên không kịp dừng
 * engine). Chỉ chạy khi lần thoát trước không sạch.
 *
 * Windows cấp lại PID của tiến trình đã chết cho tiến trình mới, nên "PID còn
 * sống" KHÔNG đủ để kết luận — diệt nhầm một PID tái sử dụng là giết một tiến
 * trình vô can của người dùng. Cặp (PID, thời điểm tạo) mới là danh tính duy
 * nhất của một tiến trình trên Windows, và đó là thứ được đối chiếu ở đây.
 */
export function reapOrphanEngine(): void {
  const pidFile = enginePidPath()
  if (!existsSync(pidFile)) return

  let mark: EngineMark | undefined
  try {
    const parsed: unknown = JSON.parse(readFileSync(pidFile, 'utf8'))
    const candidate = parsed as Partial<EngineMark>
    if (Number.isInteger(candidate.pid) && Number.isFinite(candidate.spawnedAt)) {
      mark = candidate as EngineMark
    }
  } catch {
    // File hỏng hoặc theo định dạng cũ — không đủ căn cứ để diệt gì cả.
  }
  rmSync(pidFile, { force: true })
  if (mark === undefined || mark.pid <= 0) return

  const createdAt = processCreationTime(mark.pid)
  // Không tra được thì thà để sót một tiến trình còn hơn diệt nhầm.
  if (createdAt === undefined) return
  if (Math.abs(createdAt - mark.spawnedAt) > MARK_TOLERANCE_MS) return
  killTree(mark.pid)
}

/**
 * Khởi động engine và chờ tới khi phục vụ được.
 * @param onExit - gọi khi engine chết ngoài ý muốn SAU khi đã sẵn sàng.
 * @returns engine đang chạy.
 * @throws {EngineStartError} khi engine chết sớm hoặc quá hạn chờ.
 */
export async function startEngine(onExit: (tail: string) => void): Promise<Engine> {
  const bin = dshBinPath()
  if (!existsSync(bin)) {
    throw new EngineStartError(`Không tìm thấy engine dsh tại:\n${bin}`, '')
  }
  const node = nodeExePath()
  if (!existsSync(node)) {
    throw new EngineStartError(`Không tìm thấy Node runtime tại:\n${node}`, '')
  }

  logStream = createWriteStream(engineLogPath(), { flags: 'w' })
  tail = ''
  stopping = false

  // The engine spawns further child processes of its own — Windows' directory
  // picker is one — through its own `process.execPath`, so the whole child tree runs
  // on this node.exe rather than falling back to the Electron binary.
  //
  // `--profile` and `--patch` are launcher flags and must come BEFORE `--port`,
  // which is forwarded to the app.
  //
  // THREE `--patch` LAYERS, AND THE ORDER IS MANDATORY. The engine applies them in
  // command-line order, and a layer can only edit rows that already exist when it
  // applies:
  //
  //   1. the right-hand panel (Files / Terminal / Browser)
  //   2. the plugin on/off switch
  //   3. the user's own choices — MUST COME LAST
  //
  // Put layer 3 earlier and it cannot see the two rows layers 1 and 2 insert, so a
  // user who disables the panel — or the switch itself — finds them enabled again on
  // the next launch, with nothing reporting an error. Measured:
  // `npm run spike:loader`, checks 9 and 10.
  ensurePluginState()
  child = spawn(node, [
    bin, '--profile', 'web',
    '--patch', dockPatchPath(),
    '--patch', pluginManagerPatchPath(),
    '--patch', pluginStatePath(),
    '--port', '0',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const pid = child.pid
  if (pid === undefined) throw new EngineStartError('Không spawn được tiến trình engine.', '')
  const mark: EngineMark = { pid, spawnedAt: Date.now() }
  writeFileSync(enginePidPath(), JSON.stringify(mark))
  logShell(`engine: đã spawn pid ${String(pid)} — ${node} chạy ${bin}`)

  const collect = (chunk: string): void => {
    logStream?.write(chunk)
    tail = (tail + chunk).slice(-TAIL_LIMIT)
  }
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', collect)

  let ready = false
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new EngineStartError(`Engine không phản hồi sau ${READY_TIMEOUT_MS / 1000} giây.`, tail))
    }, READY_TIMEOUT_MS)
    const settle = (fn: () => void): void => { clearTimeout(timer); fn() }

    let stdout = ''
    child?.stdout?.on('data', (chunk: string) => {
      collect(chunk)
      if (ready) return
      stdout += chunk
      const match = READY_LINE.exec(stdout)
      if (match?.[1] !== undefined) {
        const found = match[1]
        settle(() => { ready = true; resolve(found) })
      }
    })
    // Engine in dòng URL rồi vẫn có thể chết ngay sau đó (một plugin anh em
    // hỏng lúc mount), nên phải theo dõi exit chứ không tin mỗi dòng URL.
    child?.on('exit', (code) => {
      if (ready) {
        if (stopping) return
        logShell(`engine: dừng ngoài ý muốn với mã ${String(code)}`)
        onExit(tail)
        return
      }
      settle(() => reject(new EngineStartError(`Engine dừng sớm với mã ${String(code)}.`, tail)))
    })
    child?.on('error', (error) => {
      if (ready) return
      settle(() => reject(new EngineStartError(error.message, tail)))
    })
  }).catch((error: unknown) => {
    logShell(`engine: khởi động thất bại — ${error instanceof Error ? error.message : String(error)}`)
    killTree(pid)
    rmSync(enginePidPath(), { force: true })
    throw error
  })

  logShell(`engine: sẵn sàng tại ${url}`)
  return { url, pid }
}

/** Dừng engine và xoá dấu vết PID. Gọi được nhiều lần. */
export function stopEngine(): void {
  stopping = true
  const pid = child?.pid
  child = undefined
  logStream?.end()
  logStream = undefined
  rmSync(enginePidPath(), { force: true })
  if (pid !== undefined) killTree(pid)
}
