/**
 * Spike kiểm việc panel được TÁCH THEO TỪNG CHAT, và việc trang web nằm im lâu
 * thì ngủ đông.
 *
 * Vì sao tách khỏi `spike-dock-ui.cjs`: bộ kia chạy trên đúng MỘT chat, và mọi
 * mục của nó đo hành vi bên trong một chat. Câu hỏi ở đây ngược lại — hai chat
 * có thật sự không thấy đồ của nhau không — nên nó cần dựng hai phiên thật rồi
 * chuyển qua lại, một việc bộ kia không làm và không nên làm.
 *
 * Mười sáu mục:
 *   0. bấm THẬT vào nút bật panel trên thanh tiêu đề phiên, và dải tab sinh ra
 *      phải mang đúng id phiên đó — nút nhận nhầm id thì panel vẫn mở, trông như
 *      chạy đúng, nhưng trạng thái rơi vào một ngăn không thuộc chat nào
 *   1. app có hai chat thật, khác id nhau
 *   2. dải pill chỉ có tab của chat đang xem (2), trang chat kia vẫn sống ngầm
 *      (2b), và không chat nào bị dọn nhầm (2c)
 *   3. panel mở/đóng nhớ riêng theo từng chat, kể cả khi bấm nút thật (3b)
 *   4. terminal của chat KHÔNG đang xem vẫn sống — bệnh nặng nhất của bản cũ
 *   5. trang nằm im quá hạn thì ngủ, và thẻ trang bị gỡ thật (5b)
 *   6. pill đang ngủ vẫn ở nguyên chỗ và mờ đi (6a), chọn lại thì trang dựng lại
 *      đúng địa chỉ cũ (6b)
 *   7. lệnh mở tab của agent rơi vào ĐÚNG chat của agent, không phải chat đang xem
 *   8. hai hàng thêm vào Settings không tràn mép (8a), dùng đúng khoảng cách và
 *      đường kẻ của upstream (8b), mô tả không thành đoạn văn (8c)
 *
 * Muốn xem tiếng nói của engine lúc khởi động thì đặt HDW_DIAG=1.
 *
 * Tên trong file này là tiếng Anh (luật 7 áp cho mọi file mới); chú thích và
 * chữ in ra terminal là tiếng Việt, vì chúng viết cho chủ dự án đọc.
 *
 *   npm run spike:chats
 */

// CJS chứ không phải ESM, và tự khởi động lại nếu đang bị chạy như node thường —
// cùng lý do đã ghi trong `spike-dock-ui.cjs`.
if (process.env['ELECTRON_RUN_AS_NODE'] !== undefined) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  console.log('ELECTRON_RUN_AS_NODE đang bật — khởi động lại spike trong Electron thật.\n')
  const child = spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env })
  process.exit(child.status ?? 1)
}

const { app, BrowserWindow } = require('electron')

// Tắt phép dò "cửa sổ có bị che không" của Windows — không có nó thì cửa sổ
// spike bị che là Chromium ngừng cấp khung hình, và mọi mục đo giao diện đỏ vì
// một lý do không liên quan gì tới mã đang kiểm.
if (process.env['HDW_CHE'] !== '1') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
}

const { execFileSync, spawn } = require('node:child_process')
const { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const root = join(__dirname, '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_' + 'modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const dockPatch = join(root, 'plugins', 'dock', 'cordis.patch.yml')
const TEST_PAGE = process.env['HDW_URL'] ?? 'https://example.com/'

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}
const idle = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------- engine

let engine
function startEngine() {
  const home = mkdtempSync(join(tmpdir(), 'hdw-chats-'))
  const nmDir = join(home, 'profiles', 'node_' + 'modules')
  mkdirSync(nmDir, { recursive: true })
  symlinkSync(join(root, 'plugins', 'dock'), join(nmDir, 'harness-desktop-dock'), 'junction')

  // Lớp patch thứ hai gieo cwd thành workspace đã đăng ký. Bắt buộc: mọi route
  // của panel đi qua rào workspace, mà `DSH_HOME` tạm thì chưa có workspace nào.
  const wsPlugin = pathToFileURL(join(root, 'scripts', 'spike-ws-seed.mjs')).href
  const wsPatch = join(home, 'hdw-ws-seed.patch.yml')
  writeFileSync(wsPatch, `- insert:\n    - id: hdw-ws-seed\n      name: ${wsPlugin}\n`)

  // Lớp patch thứ ba dựng sẵn phiên thứ hai. Bấm "New Session" trong app không
  // đủ — xem chú thích đầu `spike-session-seed.mjs`.
  const sessionPlugin = pathToFileURL(join(root, 'scripts', 'spike-session-seed.mjs')).href
  const sessionPatch = join(home, 'hdw-session-seed.patch.yml')
  writeFileSync(sessionPatch, `- insert:\n    - id: hdw-session-seed\n      name: ${sessionPlugin}\n`)

  const patches = ['--patch', dockPatch, '--patch', wsPatch, '--patch', sessionPatch]
  engine = spawn(nodeExe, [dshBin, '--profile', 'web', ...patches, '--port', '0', '--no-open'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, DSH_HOME: home },
  })

  let out = ''
  let err = ''
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error('engine không in dòng URL sau 180s')), 180_000)
    engine.stdout.setEncoding('utf8')
    engine.stdout.on('data', (c) => {
      out += c
      // Với HDW_DIAG=1 thì cho tiếng nói của engine đi thẳng ra — các lớp gieo báo
      // thành công hay thất bại ở đó, và nuốt mất thì không biết vì sao hỏng.
      if (process.env['HDW_DIAG'] === '1') process.stdout.write('  [engine] ' + String(c))
      const m = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m.exec(out)
      if (m) { clearTimeout(guard); resolve(m[1]) }
    })
    engine.stderr.setEncoding('utf8')
    engine.stderr.on('data', (c) => { err += c })
    engine.on('exit', (code) => {
      clearTimeout(guard)
      reject(new Error(`engine thoát sớm mã ${code}\n${err.slice(-2000)}`))
    })
  })
}

// -------------------------------------------------------------- tiện ích chung

/** Đọc trạng thái panel đã lưu. */
async function readState(win) {
  return win.webContents.executeJavaScript(
    `(() => { try { return JSON.parse(localStorage.getItem('hdw.dock') ?? '{}') } catch { return {} } })()`)
}

/** Ghi đè trạng thái panel đã lưu bằng một hàm chạy trong trang. */
async function patchState(win, body) {
  return win.webContents.executeJavaScript(`(() => {
    const saved = JSON.parse(localStorage.getItem('hdw.dock') ?? '{}')
    ;(${body})(saved)
    localStorage.setItem('hdw.dock', JSON.stringify(saved))
    return 1
  })()`)
}

/** Chờ tới khi biểu thức trong trang trả về true. */
async function waitFor(win, expression, budget) {
  const deadline = Date.now() + budget
  let lastError
  while (Date.now() < deadline) {
    try {
      if (await win.webContents.executeJavaScript(expression) === true) return true
    } catch (e) { lastError = e.message }
    await idle(300)
  }
  return lastError ?? `hết ${budget / 1000}s`
}

/** Chờ tới khi có một chat đang mở, rồi trả về id của nó. */
async function currentChat(win, budget) {
  const deadline = Date.now() + budget
  while (Date.now() < deadline) {
    const saved = await readState(win)
    if (typeof saved.visibleChat === 'string' && saved.visibleChat !== '') return saved.visibleChat
    await idle(300)
  }
  return null
}

/** Chờ panel dựng xong rồi lặng một nhịp cho React vẽ hết. */
async function waitForPanel(win) {
  await waitFor(win, `!!document.querySelector('.hdw-dock')`, 30_000)
  await idle(1500)
}

/** Bấm vào pill mang đúng tên này trong dải pill đang hiện. */
async function clickPill(win, name) {
  return win.webContents.executeJavaScript(`(() => {
    const wanted = ${JSON.stringify(name)}
    const hit = [...document.querySelectorAll('.hdw-pillwrap')]
      .find((p) => (p.querySelector('.hdw-pill-name')?.textContent ?? '') === wanted)
    if (!hit) return false
    hit.querySelector('.hdw-pill')?.click()
    return true
  })()`)
}

/** Dải pill đang hiện trên màn hình: tên từng pill, số pill đang ngủ, số thẻ trang. */
async function pillStrip(win) {
  return win.webContents.executeJavaScript(`(() => {
    const ps = [...document.querySelectorAll('.hdw-pillwrap')]
    return {
      names: ps.map((p) => p.querySelector('.hdw-pill-name')?.textContent ?? ''),
      dimmed: ps.filter((p) => p.querySelector('.hdw-pill-asleep')).length,
      webviews: document.querySelectorAll('.hdw-webview').length,
    }
  })()`)
}

/** Hỏi route chẩn đoán của cầu nối. */
async function probe(baseUrl, qs = '') {
  const res = await fetch(`${baseUrl}/hdw/bus/probe${qs}`)
  return { status: res.status, body: await res.json() }
}

// ------------------------------------------------------------------- chính

async function main() {
  const baseUrl = await startEngine()
  console.log(`engine:  ${baseUrl}\n`)

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: process.env['HDW_HIEN'] === '1',
    webPreferences: { webviewTag: true },
  })
  const guards = await import(pathToFileURL(join(root, 'dist', 'main', 'window.js')).href)
  guards.guardWebviews(win)
  guards.setEngineOrigin(baseUrl)

  await win.loadURL(baseUrl)
  if (await currentChat(win, 90_000) === null) {
    throw new Error('app không mở sẵn phiên nào — không có chat để kiểm')
  }

  // Ép app mở phiên ĐÃ CÓ TIN NHẮN, trước mọi mục kiểm.
  //
  // Đây là chìa khoá của mục 0. App chỉ dựng thanh tiêu đề phiên — chỗ nút bật
  // panel mọc ra — cho phiên có nội dung; phiên trống thì nó bày màn hình soạn tin
  // lớn, không có thanh nào, và nút không có chỗ để mọc. Khoá `dsh.sessions.current`
  // là nơi app nhớ phiên đang mở, nên ghi thẳng vào đó rồi nạp lại là vào đúng phiên
  // cần. Tìm ra khoá này bằng cách đổ toàn bộ localStorage ra xem.
  await win.webContents.executeJavaScript(
    `localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-hdw-spike-c' })); 1`)
  await win.webContents.reload()
  await idle(4000)
  const chatA = await currentChat(win, 30_000)
  if (chatA !== 'session-hdw-spike-c') {
    throw new Error(`ép mở phiên có tin nhắn không thành, đang ở "${String(chatA)}"`)
  }

  // --- 0. bấm THẬT vào nút bật panel, NẾU thanh tiêu đề phiên có mặt
  //
  // Nút nằm trong thanh tiêu đề của phiên, mà thanh đó chỉ dựng khi phiên đã có
  // nội dung. Phiên trong bài kiểm này là phiên trống — spike không có model để
  // gửi tin nhắn — nên phần lớn lần chạy sẽ KHÔNG có thanh tiêu đề, và cũng không
  // có nút. Ghi là BỎ QUA chứ không ghi là hỏng: một mục kiểm đỏ vì môi trường
  // thiếu thứ nó cần thì lần sau sẽ bị bỏ qua bằng mắt, và đó là cách một cái lưới
  // mục ruỗng dần.
  const toggle = await win.webContents.executeJavaScript(`(() => {
    const btn = document.querySelector('[aria-label="Open tools panel"]')
    if (!btn) return { found: false }
    btn.click()
    return { found: true }
  })()`)
  await idle(2000)
  const shown = await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('.hdw-dock')
    const saved = JSON.parse(localStorage.getItem('hdw.dock') ?? '{}')
    return { visible: el !== null && !el.hasAttribute('hidden'), chats: Object.keys(saved.byChat ?? {}) }
  })()`)
  // Điều đáng ngờ nhất ở nút này là nó có nhận được id của phiên chứa nó hay không.
  // Không nhận thì dải tab bị tạo dưới một khoá rỗng — panel vẫn mở ra, trông như
  // chạy đúng, nhưng trạng thái rơi vào một ngăn không thuộc chat nào. Nên mục này
  // đòi đúng id phiên đang mở, chứ không chỉ đòi "panel có mở không".
  record('0. bấm nút trên đầu phiên thì panel của ĐÚNG chat đó mở ra',
    toggle.found === true && shown.visible === true && shown.chats.includes(chatA),
    `thấy nút: ${String(toggle.found)}; panel: ${shown.visible ? 'mở' : 'đóng'}; chat có dải riêng: ${JSON.stringify(shown.chats)}`)

  // Phiên thứ hai do lớp gieo dựng sẵn ở phía engine (xem `spike-session-seed.mjs`).
  // Bấm "New Session" KHÔNG dùng được: app khởi động vốn đã ở một phiên trống nên
  // bấm không sinh ra phiên nào — đo được, id chat không đổi.
  const chatB = 'session-hdw-spike-b'
  record('1. app có hai chat thật, khác id nhau',
    typeof chatA === 'string' && chatA !== chatB,
    `A=${String(chatA)} B=${chatB}`)
  if (chatA === chatB) return

  // --- 2. tab của chat A không lọt sang chat B
  //
  // Gieo thẳng vào bộ nhớ của panel rồi nạp lại, vì đó là đúng đường mà một
  // người dùng thật cũng đi qua mỗi lần mở app: đọc lại trạng thái đã lưu.
  await patchState(win, `(saved) => {
    saved.byChat = saved.byChat ?? {}
    saved.byChat[${JSON.stringify(chatA)}] = {
      open: true,
      panes: [
        { id: 'a-files', kind: 'files', title: 'Files' },
        { id: 'a-web', kind: 'browser', title: 'Trang cua A', url: ${JSON.stringify(TEST_PAGE)}, lastSeen: Date.now() },
      ],
      activeId: 'a-web',
    }
    saved.byChat[${JSON.stringify(chatB)}] = {
      open: true,
      panes: [
        { id: 'b-files', kind: 'files', title: 'Files' },
        { id: 'b-web', kind: 'browser', title: 'Trang cua B', url: ${JSON.stringify(TEST_PAGE)}, lastSeen: Date.now() },
      ],
      activeId: 'b-web',
    }
  }`)
  await win.webContents.reload()
  await waitForPanel(win)

  const strip = await pillStrip(win)
  const saved2 = await readState(win)
  const visible = saved2.visibleChat
  const mine = (saved2.byChat?.[visible]?.panes ?? []).length
  const everything = Object.values(saved2.byChat ?? {}).reduce((n, c) => n + c.panes.length, 0)
  // Đếm chứ không so tên: trang tự đặt lại tên tab ngay khi tải xong, nên cái tên
  // gieo vào không còn ở đó nữa. Số pill vẽ ra phải bằng đúng số pane của chat
  // đang xem, và phải NHỎ HƠN tổng số pane của cả hai chat — hai điều đó cộng lại
  // nói đúng một chuyện: dải pill đã được lọc theo chat.
  record('2. dải pill chỉ có tab của chat đang xem, không có tab của chat kia',
    mine > 0 && strip.names.length === mine && strip.names.length < everything,
    `đang xem ${String(visible)}: ${String(strip.names.length)} pill / ${String(mine)} pane của nó / ${String(everything)} pane cả hai chat — ${JSON.stringify(strip.names)}`)

  // Thẻ trang của CẢ HAI chat phải cùng tồn tại: cái của chat kia sống ngầm, chỉ
  // bị che. Đó chính là điều giữ cho trang và shell của chat khác không chết mỗi
  // lần đổi chat — bệnh mà việc này sinh ra để chữa.
  record('2b. trang của chat kia vẫn sống ngầm chứ không bị gỡ',
    strip.webviews >= 2,
    `${strip.webviews} thẻ webview còn trong trang (cần ≥2)`)

  // Cả hai chat cùng còn trong bộ nhớ sau khi app dọn các chat đã xoá — nghĩa là
  // app nhận cả hai phiên là thật, chứ không phải một cái id bịa.
  const kept = Object.keys((await readState(win)).byChat ?? {})
  record('2c. app giữ lại đúng hai chat, không dọn nhầm cái nào',
    kept.includes(chatA) && kept.includes(chatB),
    `còn: ${JSON.stringify(kept)}`)

  // --- 4. terminal của chat KHÔNG đang xem vẫn sống
  //
  // Đây là thiệt hại nặng nhất của bản cũ: dải pill dùng chung nên thư mục gốc
  // lấy theo chat đang xem, và đổi sang chat ở workspace khác là socket đứt, shell
  // bị giết, mất luôn lệnh đang chạy — không báo gì.
  //
  // Đo bằng hai dấu hiệu cùng lúc: khung terminal của chat kia vẫn còn trong
  // trang (chưa bị gỡ khỏi React), và nó KHÔNG hiện dòng báo "shell đã đóng".
  // Chỉ đo cái thứ nhất thì một khung còn đó nhưng shell đã chết vẫn qua được.
  await patchState(win, `(saved) => {
    saved.byChat[${JSON.stringify(chatB)}].panes.push({ id: 'b-term', kind: 'terminal', title: 'Terminal' })
  }`)
  await win.webContents.reload()
  await waitForPanel(win)
  await idle(4000)
  const term = await win.webContents.executeJavaScript(`(() => ({
    frames: document.querySelectorAll('.hdw-termwrap').length,
    closedNotes: document.querySelectorAll('.hdw-termbar').length,
    screens: document.querySelectorAll('.xterm-screen').length,
  }))()`)
  record('4. terminal của chat không đang xem vẫn sống, không bị giết theo',
    term.frames >= 1 && term.screens >= 1 && term.closedNotes === 0,
    `${String(term.frames)} khung, ${String(term.screens)} màn hình xterm, ${String(term.closedNotes)} dòng báo đã đóng`)

  // --- 3. panel mở/đóng nhớ riêng theo chat
  await patchState(win, `(saved) => { saved.byChat[${JSON.stringify(chatA)}].open = false }`)
  await win.webContents.reload()
  await waitForPanel(win)
  const shut = await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('.hdw-dock')
    const saved = JSON.parse(localStorage.getItem('hdw.dock') ?? '{}')
    return { hidden: el === null || el.hasAttribute('hidden'), openB: saved.byChat?.[${JSON.stringify(chatB)}]?.open }
  })()`)
  record('3. panel đóng ở chat đang xem thì đóng, không kéo theo chat kia',
    shut.hidden === true && shut.openB === true,
    `panel trên màn hình: ${shut.hidden ? 'đóng' : 'mở'}; trạng thái chat kia vẫn: ${shut.openB ? 'mở' : 'đóng'}`)

  // Mở lại để các mục sau nhìn thấy dải pill.
  await patchState(win, `(saved) => { saved.byChat[${JSON.stringify(chatA)}].open = true }`)
  await win.webContents.reload()
  await waitForPanel(win)

  // --- 3b. một cú bấm THẬT ghi trạng thái vào đúng chat đang xem
  //
  // Các mục trên gieo trạng thái rồi nạp lại, nên chưa mục nào chứng minh một cú
  // bấm của người dùng rơi vào đúng ngăn của chat nào. Nút "Close panel" nằm ngay
  // trong panel nên luôn có mặt, khác với nút trên thanh tiêu đề phiên.
  const clickedClose = await win.webContents.executeJavaScript(`(() => {
    const btn = document.querySelector('[aria-label="Close panel"]')
    if (!btn) return false
    btn.click()
    return true
  })()`)
  await idle(1500)
  const afterClick = await readState(win)
  record('3b. bấm "Close panel" chỉ đóng panel của chat đang xem',
    clickedClose === true
      && afterClick.byChat?.[chatA]?.open === false
      && afterClick.byChat?.[chatB]?.open === true,
    `bấm được: ${String(clickedClose)}; chat đang xem: ${afterClick.byChat?.[chatA]?.open ? 'mở' : 'đóng'}; chat kia: ${afterClick.byChat?.[chatB]?.open ? 'mở' : 'đóng'}`)

  // Mở lại cho các mục sau.
  await patchState(win, `(saved) => { saved.byChat[${JSON.stringify(chatA)}].open = true }`)
  await win.webContents.reload()
  await waitForPanel(win)

  // --- 5. ngủ đông
  //
  // Gieo vào bộ nhớ đã lưu RỒI NẠP LẠI, chứ không gieo lên trang đang chạy: bộ
  // nhớ chỉ được đọc lúc dựng, nên vá lên nó giữa chừng không tới được trạng
  // thái đang sống, và lần ghi kế tiếp của panel xoá luôn bản vá.
  //
  // Không rút ngắn nhịp quét (60s) cho bài kiểm chạy nhanh: nhịp đó là mã sản
  // phẩm, sửa nó để bài kiểm dễ chạy là kiểm một thứ khác với thứ người dùng
  // chạy. Nên bài kiểm chờ đủ một nhịp thật.
  await patchState(win, `(saved) => {
    saved.sleepAfterMinutes = 15
    saved.byChat[${JSON.stringify(chatA)}].activeId = 'a-files'
    const pane = saved.byChat[${JSON.stringify(chatA)}].panes.find((p) => p.id === 'a-web')
    pane.lastSeen = Date.now() - 60 * 60 * 1000
  }`)
  await win.webContents.reload()
  await waitForPanel(win)

  const before = await win.webContents.executeJavaScript(
    `document.querySelectorAll('.hdw-webview').length`)
  console.log('  (chờ một nhịp quét ngủ đông — tới 90s)')
  const slept = await waitFor(win, `(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('hdw.dock') ?? '{}')
      const pane = saved.byChat[${JSON.stringify(chatA)}].panes.find((p) => p.id === 'a-web')
      return pane?.asleep === true
    } catch { return false }
  })()`, 90_000)
  record('5. trang nằm im quá hạn thì ngủ', slept === true, String(slept))

  const left = await win.webContents.executeJavaScript(
    `document.querySelectorAll('.hdw-webview').length`)
  // Đếm chứ không đòi về 0: chỉ trang bị đẩy lùi đồng hồ mới quá hạn, trang của
  // chat kia vẫn thức. Bớt đúng một thẻ là đúng điều cần đo.
  record('5b. ngủ rồi thì thẻ trang bị gỡ thật, không chỉ ẩn đi',
    slept === true && left === before - 1,
    `${String(before)} thẻ trước khi ngủ → ${String(left)} sau`)

  // --- 6. chọn lại thì tỉnh dậy đúng địa chỉ cũ
  if (slept === true) {
    // Không nạp lại ở đây: trang đang ngủ trong chính bộ nhớ đang chạy, đúng
    // trạng thái người dùng gặp khi quay lại một tab đã ngủ. Nạp lại sẽ xoá cờ
    // ngủ và mục này thành ra đo một thứ khác.
    const strip6 = await pillStrip(win)
    // Tên pill là tên TRANG TỰ ĐẶT sau khi tải, không phải tên gieo vào — nên lấy
    // tên đang thật sự hiện ra rồi bấm đúng nó.
    const saved6 = await readState(win)
    const sleepingName = (saved6.byChat?.[chatA]?.panes ?? []).find((p) => p.id === 'a-web')?.title ?? ''
    record('6a. pill của trang đang ngủ vẫn ở nguyên chỗ trong dải và mờ đi',
      strip6.names.includes(sleepingName) && strip6.dimmed >= 1,
      `dải: ${JSON.stringify(strip6.names)}, pill đang ngủ "${sleepingName}", ${String(strip6.dimmed)} pill mờ`)

    await clickPill(win, sleepingName)
    const awake = await waitFor(win, `(() => {
      const wv = [...document.querySelectorAll('.hdw-webview')]
      return wv.some((el) => { try { return el.getURL().startsWith('https://example.com') } catch { return false } })
    })()`, 30_000)
    record('6b. chọn lại pill đang ngủ thì trang dựng lại đúng địa chỉ cũ', awake === true, String(awake))
  }

  // --- 7. tab agent mở rơi vào đúng chat agent khai
  //
  // Màn hình đang ở chat A. Lệnh khai `session_id` của chat B, nên tab phải rơi
  // vào B — chứ không phải vào chat đang trước mặt người dùng.
  await checkSettingsRows(win)

  const opened = await probe(baseUrl,
    `?cmd=open_tab&params=${encodeURIComponent(JSON.stringify({ url: TEST_PAGE, session_id: chatB }))}`)
  await idle(2000)
  const after = await readState(win)
  const inB = (after.byChat?.[chatB]?.panes ?? []).filter((p) => p.kind === 'browser').length
  const inA = (after.byChat?.[chatA]?.panes ?? []).filter((p) => p.kind === 'browser').length
  record('7. tab agent mở rơi vào ĐÚNG chat agent khai, không phải chat đang xem',
    opened.body.ok === true && inB === 2 && inA === 1,
    `mở=${JSON.stringify(opened.body.result ?? opened.body)} — chat agent khai có ${String(inB)} tab web (cần 2), chat đang xem vẫn ${String(inA)} (cần 1)`)
}

// ------------------------------------------------------------ hàng Settings

/**
 * Mở Settings và đo hai hàng ta thêm vào.
 *
 * Mục này sinh ra từ một lỗi thật: ô chọn của hàng hẹn giờ ngủ chạy 45px ra ngoài
 * mép phải của hàng, trong khi mọi hàng của upstream đều kết thúc khít mép. Nhìn
 * ảnh thì thấy "trông lệch lệch"; đo thì ra con số. Nên đo, chứ đừng nhìn.
 *
 * Cách đo: mép phải của ô chọn phải trùng mép phải của hàng chứa nó. Không so với
 * một hàng cụ thể nào của upstream — các hàng đó nằm trong `display: contents` nên
 * không có hộp riêng để so.
 */
async function checkSettingsRows(win) {
  const opened = await win.webContents.executeJavaScript(`(() => {
    const btn = [...document.querySelectorAll('button, [role="button"], a')]
      .find((el) => (el.textContent ?? '').trim() === 'Settings')
    if (!btn) return false
    btn.click()
    return true
  })()`)
  if (opened !== true) {
    record('8. hàng Settings ta thêm vào nằm khít trong hàng', false, 'không mở được Settings')
    return
  }
  await idle(2500)

  const rows = await win.webContents.executeJavaScript(`(() => {
    return [...document.querySelectorAll('.hdw-setting')].map((el) => {
      const pick = el.querySelector('.hdw-setting-pick')
      const row = el.getBoundingClientRect()
      const box = pick ? pick.getBoundingClientRect() : null
      const s = getComputedStyle(el)
      const title = el.querySelector('.hdw-setting-title')
      const desc = el.querySelector('.hdw-setting-desc')
      return {
        title: title?.textContent ?? '',
        overflow: box === null ? null : Math.round(box.right - row.right),
        label: pick ? (pick.textContent ?? '').trim() : null,
        padTop: s.paddingTop,
        padBottom: s.paddingBottom,
        rule: s.borderBottomWidth,
        titleSize: title ? getComputedStyle(title).fontSize : null,
        pickHeight: box ? Math.round(box.height) : null,
        descLines: desc ? Math.round(desc.getBoundingClientRect().height / 18) : null,
      }
    })
  })()`)

  const bad = rows.filter((r) => r.overflow === null || r.overflow > 0)
  record('8a. ô chọn của hàng Settings không tràn ra ngoài mép hàng',
    rows.length === 2 && bad.length === 0,
    rows.map((r) => `"${r.title}" tràn ${String(r.overflow)}px`).join('; '))

  // Số của upstream, đọc thẳng từ rule đã dựng của `EnterBehaviorRow`: hàng có
  // padding 16px trên dưới, tiêu đề 14px, ô chọn cao 36px, và một đường kẻ phía
  // dưới. Thiếu đường kẻ và padding chính là thứ làm hai hàng dính vào nhau.
  //
  // Đường kẻ đo bằng "lớn hơn 0" chứ không so với chuỗi "1px": giá trị đã dùng là
  // số thực và co theo mức thu phóng của trang — đo được 0.727273px ở mức app đang
  // chạy. Và chỉ đòi ở hàng KHÔNG PHẢI hàng cuối: upstream bỏ kẻ ở hàng cuối để
  // đóng khối, nên đòi kẻ ở đó là đòi khác với chính trang đang hiển thị.
  const off = rows.filter((r, i) => r.padTop !== '16px' || r.padBottom !== '16px'
    || r.titleSize !== '14px' || r.pickHeight !== 36
    || (i < rows.length - 1 && Number.parseFloat(r.rule) <= 0))
  record('8b. hàng Settings dùng đúng khoảng cách, đường kẻ và cỡ chữ của upstream',
    rows.length === 2 && off.length === 0,
    rows.map((r) => `"${r.title}": padding ${r.padTop}/${r.padBottom}, kẻ ${r.rule}, tiêu đề ${String(r.titleSize)}, ô chọn cao ${String(r.pickHeight)}px`).join('; '))

  // Mô tả của upstream gọn trong một dòng. Bản đầu của ta dài ba câu và là đoạn
  // văn duy nhất trên cả trang.
  const wordy = rows.filter((r) => (r.descLines ?? 0) > 2)
  record('8c. mô tả gọn như các hàng khác, không thành đoạn văn',
    wordy.length === 0,
    rows.map((r) => `"${r.title}": ${String(r.descLines)} dòng`).join('; '))
}

app.whenReady().then(main).then(
  () => finish(),
  (e) => { console.log(`\nLỖI: ${e.message}`); finish(1) },
)

function finish(code) {
  console.log('\n=== KẾT QUẢ ===')
  const bad = results.filter((r) => !r.ok)
  console.log(bad.length === 0 && code === undefined
    ? 'Tất cả đạt. Mỗi chat có bộ tab riêng, và trang nằm im thì ngủ đúng hẹn.'
    : `${bad.length}/${results.length} mục KHÔNG đạt${bad.length ? ': ' + bad.map((r) => r.name).join(', ') : ''}`)
  try { execFileSync('taskkill', ['/pid', String(engine.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* đã tắt */ }
  app.exit(code ?? (bad.length === 0 ? 0 : 1))
}
