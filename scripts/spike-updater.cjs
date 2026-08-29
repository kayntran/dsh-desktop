/**
 * Nghiệm thu mặt hiện của việc tự cập nhật, TRONG TRANG THẬT.
 *
 * Thứ bộ này gác là nửa mà người dùng chạm vào: dòng trong Settings › General, dải
 * nổi khi bản mới đã tải xong, và đường lệnh chạy ngược từ trang về lớp vỏ. Phần máy
 * móc của `electron-updater` KHÔNG thuộc phạm vi ở đây — nó chỉ sống trong bản đóng
 * gói, và cách duy nhất đo nó là chạy bản đã đóng gói.
 *
 * Vì sao phải mở cửa sổ thật thay vì kiểm bằng HTTP: route trả đúng JSON không chứng
 * minh được người dùng nhìn thấy gì. Bài học đã trả giá hai lần trong dự án này —
 * `presentResult` đúng hợp đồng mà không có gì hiện ra, và bộ kiểm dò bảng khởi động
 * theo lối viết cũ nên báo đỏ oan trong khi tính năng chạy tốt.
 *
 *   npm run spike:updater
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

const { spawn } = require('node:child_process')
const { mkdirSync, mkdtempSync, symlinkSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const root = join(__dirname, '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_' + 'modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

const PKG = 'harness-desktop-updater'

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let engine

/**
 * Dựng engine đúng cách lớp vỏ dựng, trong một DSH_HOME dùng xong bỏ.
 * @returns {Promise<string>} địa chỉ loopback của engine.
 */
function startEngine() {
  const home = mkdtempSync(join(tmpdir(), 'hdw-upd-'))
  const nmDir = join(home, 'profiles', 'node_' + 'modules')
  mkdirSync(nmDir, { recursive: true })
  // Junction chứ không phải symlink: engine phân giải nửa client qua
  // `createRequire(<thư mục profile>).resolve('<gói>/package.json')`, và Windows cần
  // junction cho liên kết thư mục nếu không muốn đòi quyền quản trị.
  symlinkSync(join(root, 'plugins', 'updater'), join(nmDir, PKG), 'junction')

  const patches = ['--patch', join(root, 'plugins', 'updater', 'cordis.patch.yml')]
  engine = spawn(nodeExe, [dshBin, '--profile', 'web', ...patches, '--port', '0', '--no-open'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, DSH_HOME: home },
  })

  let out = ''
  let err = ''
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('engine không in dòng URL sau 300s')), 300_000)
    engine.stdout.setEncoding('utf8')
    engine.stdout.on('data', (chunk) => {
      out += chunk
      const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m.exec(out)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
    engine.stderr.setEncoding('utf8')
    engine.stderr.on('data', (chunk) => { err += chunk })
    engine.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`engine thoát sớm mã ${code}\n${err.slice(-2000)}`))
    })
  })
}

/** Đóng vai lớp vỏ: báo một trạng thái lên plugin. */
async function report(baseUrl, state) {
  const res = await fetch(`${baseUrl}/hdw/update/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state),
  })
  if (!res.ok) throw new Error(`/hdw/update/state trả ${res.status}`)
}

/** Chờ tới khi biểu thức trong trang trả về true, hoặc hết giờ. */
async function waitUntil(win, expression, limitMs = 20_000) {
  const deadline = Date.now() + limitMs
  let last
  while (Date.now() < deadline) {
    last = await win.webContents.executeJavaScript(`(() => { try { return ${expression} } catch (e) { return 'LỖI: ' + e.message } })()`)
    if (last === true) return true
    await sleep(250)
  }
  return last
}

/**
 * Mở panel Cài đặt và bấm sang mục có dòng của ta.
 *
 * Cách tìm giống `spike-switch-ui.cjs`: bấm nút mở Cài đặt ở chân thanh bên, chờ hộp
 * thoại, rồi bấm lần lượt các mục nav cho tới khi thấy dòng cập nhật.
 */
const OPEN_SETTINGS = `(async () => {
  const trigger = document.querySelector('[data-slot="sidebar.settings"] button[aria-haspopup="dialog"]')
  if (trigger === null) return { reason: 'không thấy nút mở Cài đặt' }
  trigger.click()
  for (let wait = 0; wait < 40; wait += 1) {
    if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) break
    await new Promise((r) => setTimeout(r, 200))
  }
  const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
  if (panel === null) return { reason: 'panel Cài đặt không mở' }
  const buttons = [...panel.querySelectorAll('nav button')]
  for (const button of buttons) {
    button.click()
    for (let wait = 0; wait < 10; wait += 1) {
      if (panel.querySelector('.hdw-upd-row') !== null) return { ok: true }
      await new Promise((r) => setTimeout(r, 150))
    }
  }
  return { reason: 'bấm hết ' + buttons.length + ' mục nav mà không thấy dòng cập nhật' }
})()`

async function main() {
  const baseUrl = await startEngine()
  console.log(`engine tại ${baseUrl}\n`)

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: process.env['HDW_HIEN'] === '1',
    webPreferences: { webviewTag: true },
  })

  // --- 1. nửa giao diện được phục vụ và có mặt trong đồ thị khởi động
  const bundle = await fetch(`${baseUrl}/plugins/${PKG}/client.js`)
  const page = await (await fetch(`${baseUrl}/`)).text()
  const inBoot = page.includes(PKG)
  record('1. nửa giao diện được phục vụ và nằm trong đồ thị khởi động',
    bundle.status === 200 && inBoot,
    `client.js ${bundle.status}, có trong trang: ${String(inBoot)}`)

  await win.loadURL(baseUrl)

  // --- 2. dòng trong Settings hiện phiên bản đang chạy
  //
  // Mục quyết định của nửa này: người dùng vào Settings và THẤY được app đang ở bản
  // nào. Trước đây con số đó chỉ nằm trong cửa sổ About.
  await report(baseUrl, { phase: 'current', current: '0.1.0' })
  const opened = await win.webContents.executeJavaScript(OPEN_SETTINGS)
  const row = opened.ok !== true ? { reason: opened.reason } : await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('.hdw-upd-row')
    if (el === null) return { reason: 'dòng biến mất' }
    const box = el.getBoundingClientRect()
    return {
      text: el.innerText.replace(/\\s+/g, ' ').trim().slice(0, 90),
      width: Math.round(box.width),
      height: Math.round(box.height),
      button: el.querySelector('button')?.innerText.trim() ?? '(không có nút)',
    }
  })()`)
  record('2. Settings › General có dòng cập nhật, hiện phiên bản đang chạy',
    row.reason === undefined && row.width > 200 && row.height > 20
      && row.text.includes('0.1.0') && /check/i.test(row.button),
    row.reason ?? JSON.stringify(row))

  // --- 3. tải xong thì dải nổi hiện ra, kèm đúng số hiệu bản mới
  await report(baseUrl, { phase: 'ready', current: '0.1.0', next: '0.1.1' })
  const pillUp = await waitUntil(win, `!!document.querySelector('.hdw-upd-pill')`)
  const pill = pillUp !== true ? { reason: String(pillUp) } : await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('.hdw-upd-pill')
    const box = el.getBoundingClientRect()
    return {
      text: el.innerText.replace(/\\s+/g, ' ').trim().slice(0, 80),
      width: Math.round(box.width),
      // Nằm trong khung nhìn hay đã trôi ra ngoài — một dải "hiện" mà ở ngoài màn
      // hình thì cũng như không.
      onScreen: box.top >= 0 && box.left >= 0
        && box.bottom <= window.innerHeight && box.right <= window.innerWidth,
    }
  })()`)
  record('3. tải xong: dải nổi hiện ra trong khung nhìn, nêu đúng bản mới',
    pill.reason === undefined && pill.width > 150 && pill.onScreen === true
      && pill.text.includes('0.1.1'),
    pill.reason ?? JSON.stringify(pill))

  // --- 4. MỤC QUYẾT ĐỊNH: bấm "Restart now" thì lệnh về tới lớp vỏ
  //
  // Đi trọn vòng người dùng → trang → plugin → cầu chờ sẵn → lớp vỏ. Xanh nghĩa là
  // nút đó thật sự nối vào thứ khởi động lại app, chứ không phải một nút đẹp.
  const held = fetch(`${baseUrl}/hdw/update/wait`).then((r) => r.json())
  await sleep(500)
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('.hdw-upd-pill')
    if (el === null) return { reason: 'dải nổi biến mất trước khi bấm' }
    const button = [...el.querySelectorAll('button')].find((b) => /restart/i.test(b.innerText))
    if (button === undefined) return { reason: 'không thấy nút Restart' }
    button.click()
    return { ok: true }
  })()`)
  const answer = clicked.ok !== true ? undefined : await Promise.race([held, sleep(15_000)])
  record('4. bấm "Restart now": lệnh install về tới lớp vỏ đang chờ',
    clicked.reason === undefined && answer?.command === 'install',
    clicked.reason ?? JSON.stringify(answer ?? 'không có trả lời sau 15s'))

  // --- 5. bấm bỏ qua thì dải biến mất và KHÔNG tự quay lại
  //
  // Bản cập nhật đã nằm trên đĩa và sẽ được áp lúc app đóng, nên bỏ qua không mất gì.
  // Nếu nó mọc lại sau mỗi nhịp hỏi thì một tin vui thành một sự phiền.
  const dismissed = await win.webContents.executeJavaScript(`(async () => {
    const el = document.querySelector('.hdw-upd-pill')
    if (el === null) return { reason: 'dải nổi không còn để bỏ qua' }
    el.querySelector('.hdw-upd-pill-x').click()
    await new Promise((r) => setTimeout(r, 300))
    const atOnce = document.querySelector('.hdw-upd-pill') === null
    // Đợi qua vài nhịp hỏi để chắc nó không mọc lại.
    await new Promise((r) => setTimeout(r, 3000))
    return { atOnce, later: document.querySelector('.hdw-upd-pill') === null }
  })()`)
  record('5. bỏ qua dải nổi: biến mất và không tự quay lại',
    dismissed.reason === undefined && dismissed.atOnce === true && dismissed.later === true,
    dismissed.reason ?? JSON.stringify(dismissed))

  // --- 6. bản không tự cập nhật được thì NÓI RA, không im lặng
  //
  // Đây là lý do trạng thái `unsupported` tồn tại: im lặng ở đây đọc y hệt "bạn đang
  // dùng bản mới nhất", qua mọi lần phát hành.
  await report(baseUrl, {
    phase: 'unsupported',
    current: '0.1.0',
    reason: 'This portable build cannot update itself — download a new one when you want it.',
    downloadPage: 'https://example.com/releases',
  })
  const blocked = await waitUntil(win, `!!document.querySelector('.hdw-upd-row') && /cannot update itself/.test(document.querySelector('.hdw-upd-row').innerText)`)
  const blockedRow = blocked !== true ? { reason: String(blocked) } : await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('.hdw-upd-row')
    return {
      text: el.innerText.replace(/\\s+/g, ' ').trim().slice(0, 90),
      button: el.querySelector('button')?.innerText.trim() ?? '(không có nút)',
    }
  })()`)
  record('6. bản không tự cập nhật được: nói thẳng và mời tải tay',
    blockedRow.reason === undefined && /download/i.test(blockedRow.button),
    blockedRow.reason ?? JSON.stringify(blockedRow))

  console.log('\n=== KẾT QUẢ ===')
  const failed = results.filter((r) => !r.ok)
  if (failed.length === 0) console.log('Tất cả đạt. Mặt hiện của việc tự cập nhật chạy đúng trong trang thật.')
  else console.log(`${failed.length}/${results.length} mục KHÔNG đạt: ${failed.map((r) => r.name).join(', ')}`)
}

app.whenReady().then(main).catch((error) => {
  record('spike chạy tới cuối', false, error.stack ?? String(error))
}).finally(() => {
  if (engine !== undefined) { try { engine.kill() } catch { /* đã chết */ } }
  app.quit()
})
