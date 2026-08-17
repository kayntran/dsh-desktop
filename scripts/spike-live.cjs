/**
 * Lượt chạy THẬT: model thật, profile thật của chủ dự án, và một ảnh chụp màn
 * hình để nhìn bằng mắt.
 *
 * Ba bộ kiểm kia đều chạy trên một `DSH_HOME` tạm và không có model nào. Chúng
 * chứng minh được từng mảnh: lệnh chụp giao đủ dữ liệu cho thẻ, và thẻ vẽ đúng
 * khi có dữ liệu đúng. Chúng KHÔNG chứng minh được hai mảnh ghép lại trong app
 * thật — mà đúng chỗ ghép ấy là chỗ lần trước hỏng.
 *
 * Nên bài này làm đúng một việc: nhờ model thật chụp một tấm ảnh, rồi hỏi
 * **trong khung hội thoại có tấm ảnh nào không**.
 *
 * ## Nó động vào gì của bạn
 *
 * - Dùng `~/.dsh` THẬT, nên có API key và model đã cấu hình sẵn.
 * - Tạo MỘT phiên hội thoại mới trong lịch sử, và tiêu một lượt gọi model.
 * - Không sửa cấu hình, không bấm nút xác nhận nào thay bạn.
 *
 *   npm run spike:live
 */

if (process.env['ELECTRON_RUN_AS_NODE'] !== undefined) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  const child = spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env })
  process.exit(child.status ?? 1)
}

const { app, BrowserWindow } = require('electron')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const { execFileSync, spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const root = join(__dirname, '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_' + 'modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const dockPatch = join(root, 'plugins', 'dock', 'cordis.patch.yml')

/** Câu nhờ model. Cố ý ngắn và không nêu tên tool — để model tự chọn. */
const PROMPT = process.env['HDW_PROMPT']
  ?? 'Mở trang example.com trong trình duyệt của panel rồi chụp ảnh trang đó cho tôi xem.'

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}
const wait = (ms) => new Promise((r) => { setTimeout(r, ms) })

let engine

/** Khởi động engine ĐÚNG như lớp vỏ khởi động nó — kể cả việc không đặt DSH_HOME. */
function startEngine() {
  engine = spawn(nodeExe, [dshBin, '--profile', 'web', '--patch', dockPatch, '--port', '0'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let out = ''
  let err = ''
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('engine không in dòng URL sau 180s')) }, 180_000)
    engine.stdout.setEncoding('utf8')
    engine.stdout.on('data', (chunk) => {
      out += chunk
      const found = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m.exec(out)
      if (found) { clearTimeout(timer); resolve(found[1]) }
    })
    engine.stderr.setEncoding('utf8')
    engine.stderr.on('data', (chunk) => { err += chunk })
    engine.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`engine thoát sớm mã ${code}\n${err.slice(-1500)}`))
    })
  })
}

/** Hỏi lại một biểu thức theo nhịp cho tới khi nó thành true, hoặc hết giờ. */
async function until(win, expression, budgetMs) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    try {
      if (await win.webContents.executeJavaScript(expression) === true) return true
    } catch { /* trang đang vẽ lại — hỏi lại vòng sau */ }
    await wait(400)
  }
  return false
}

/** Đóng các hộp thoại chào mừng. Chỉ bấm nút lành tính, không xác nhận gì thay người dùng. */
async function dismissDialogs(win) {
  const LABELS = 'Continue|Configure later|Skip|Later|Close|Done|Tiếp tục|Bỏ qua|Đóng|继续|跳过'
  for (let round = 0; round < 6; round += 1) {
    const open = await win.webContents.executeJavaScript(
      `document.querySelectorAll('[role="dialog"]').length`)
    if (open === 0) return
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find(b => new RegExp('^(' + ${JSON.stringify(LABELS)} + ')$')`
      + `.test(b.textContent.trim()))?.click()`).catch(() => undefined)
    await win.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`).catch(() => undefined)
    await wait(1200)
  }
}

async function main() {
  const baseUrl = await startEngine()
  console.log(`engine:  ${baseUrl}  (profile thật: ~/.dsh)\n`)

  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    show: process.env['HDW_HIEN'] !== '0',
    webPreferences: { webviewTag: true },
  })

  // Chốt an toàn và đường chụp ảnh: dùng CHÍNH module của app trong `dist/`.
  const guards = await import(pathToFileURL(join(root, 'dist', 'main', 'window.js')).href)
  const shotLink = await import(pathToFileURL(join(root, 'dist', 'main', 'shot-link.js')).href)
  guards.guardWebviews(win)
  guards.setEngineOrigin(baseUrl)
  win.webContents.on('did-attach-webview', (_e, guest) => { shotLink.trackGuest(guest) })
  shotLink.startShotLink(baseUrl)

  // Khối ảnh của upstream nuốt lỗi tải; console của trang là chỗ duy nhất câu
  // lỗi thật đi qua.
  const noise = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && message.includes('hdw-dock')) noise.push(message)
  })

  await win.loadURL(baseUrl)
  const mounted = await until(win, `!!document.querySelector('.hdw-dock')`, 60_000)
  record('1. app mở được và panel gắn vào', mounted)
  await dismissDialogs(win)

  // Gõ câu nhờ vào ô soạn. Gán qua setter GỐC vì ô nhập do React quản — gán
  // thẳng thì DOM đổi mà React không biết, và nó ghi đè lại ở lần vẽ kế tiếp.
  //
  // Chọn ô soạn theo DIỆN TÍCH LỚN NHẤT, không phải "cái cuối cùng trong DOM":
  // trang có nhiều ô văn bản (đổi tên phiên, ô trong hộp thoại), và lần chạy
  // trước đã trúng nhầm một cái — mục kiểm đỏ trong khi app hoàn toàn bình
  // thường.
  const TYPE = `(() => {
    const boxes = [...document.querySelectorAll('textarea')]
      .filter(t => !t.disabled && !t.readOnly)
      .map(t => ({ t, box: t.getBoundingClientRect() }))
      .filter(x => x.box.width > 120 && x.box.height > 12)
      .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)
    const box = boxes[0]?.t
    if (!box) return 'không tìm thấy ô soạn'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    box.focus()
    setter.call(box, ${JSON.stringify(PROMPT)})
    box.dispatchEvent(new Event('input', { bubbles: true }))
    return box.value
  })()`

  let typed = ''
  for (let attempt = 0; attempt < 8 && typed !== PROMPT; attempt += 1) {
    if (attempt > 0) await wait(1500)
    typed = await win.webContents.executeJavaScript(TYPE).catch((e) => String(e.message))
  }
  record('2. gõ được câu nhờ vào ô soạn', typed === PROMPT, String(typed).slice(0, 60))

  // Gửi bằng phím Enter THẬT qua tiến trình chính, không phải sự kiện DOM giả:
  // ô soạn nghe phím ở tầng của nó, và một sự kiện giả có thể đi lọt qua đúng
  // chỗ mà phím thật bị chặn.
  win.focus()
  await wait(300)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })

  const sent = await until(win,
    `[...document.querySelectorAll('textarea')].every(t => t.value === '')`, 15_000)
  record('3. câu nhờ đã gửi đi (ô soạn trống lại)', sent)

  // --- MỤC QUYẾT ĐỊNH ---
  //
  // Chờ một thẻ `<img>` xuất hiện bên trong thẻ ảnh chụp. Không hỏi "tool có
  // chạy không", không hỏi "hàm dựng thẻ trả về gì" — hỏi thẳng thứ chủ dự án
  // hỏi: trên màn hình có tấm ảnh nào không.
  const budget = Number(process.env['HDW_CHO'] ?? 240_000)
  const drawn = await until(win, `(() => {
    const img = document.querySelector('.hdw-shot-card img')
    if (!img) return false
    const box = img.getBoundingClientRect()
    return box.width > 40 && box.height > 40 && img.naturalWidth > 0
  })()`, budget)

  const seen = await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.hdw-shot-card')
    const img = card && card.querySelector('img')
    const box = img && img.getBoundingClientRect()
    return {
      cards: document.querySelectorAll('.hdw-shot-card').length,
      note: card ? card.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60) : '(chưa có thẻ nào)',
      w: box ? Math.round(box.width) : 0,
      h: box ? Math.round(box.height) : 0,
      natural: img ? img.naturalWidth + 'x' + img.naturalHeight : '',
    }
  })()`)
  record('4. MODEL THẬT chụp ảnh và TẤM ẢNH HIỆN RA trong khung hội thoại',
    drawn, `${JSON.stringify(seen)}${noise.length === 0 ? '' : ` | lỗi: ${noise.join(' ; ').slice(0, 300)}`}`)

  // Mặc định ghi vào thư mục tạm, KHÔNG vào gốc repo: một file ảnh rơi lại ở đó
  // sẽ theo `git add` vào commit của người chạy sau.
  const shotPath = process.env['HDW_ANH'] ?? join(require('node:os').tmpdir(), 'hdw-luot-chay-that.png')
  writeFileSync(shotPath, (await win.webContents.capturePage()).toPNG())
  console.log(`\nảnh cửa sổ app: ${shotPath}`)

  shotLink.stopShotLink()
  if (process.env['HDW_GIU'] === '1') await wait(600_000)
}

app.whenReady().then(main).then(() => finish(), (error) => {
  console.log(`\nLỖI: ${error.stack ?? error.message}`)
  finish(1)
})

function finish(code) {
  console.log('\n=== KẾT QUẢ ===')
  const failed = results.filter((r) => !r.ok)
  console.log(failed.length === 0 && code === undefined
    ? 'Model thật đã chụp ảnh, và tấm ảnh hiện ra trên màn hình.'
    : `${failed.length}/${results.length} mục KHÔNG đạt${failed.length ? ': ' + failed.map((r) => r.name).join(', ') : ''}`)
  try {
    execFileSync('taskkill', ['/pid', String(engine.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch { /* engine đã tắt */ }
  app.exit(code ?? (failed.length === 0 ? 0 : 1))
}
