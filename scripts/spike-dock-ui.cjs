/**
 * Spike kiểm GIAO DIỆN panel — thứ mà từ giai đoạn 1 tới giờ vẫn phải nhờ chủ
 * dự án bấm hộ.
 *
 * Vấn đề: không có cách nào điều khiển cửa sổ app đang chạy. Windows từ chối
 * cho tiến trình nền giành tiêu điểm, và gửi thông điệp chuột thẳng vào cửa sổ
 * con của Chromium thì bị bỏ qua. Nên mọi thay đổi giao diện tới nay chỉ được
 * xác nhận bằng ảnh chụp tĩnh, không bằng một cú bấm thật.
 *
 * Cách gỡ: KHÔNG điều khiển cửa sổ app. Dựng một cửa sổ Electron của riêng
 * spike, cấu hình y hệt lớp vỏ thật (`webviewTag` cộng ba chốt an toàn), rồi
 * trỏ nó vào đúng URL mà app trỏ vào. Trong cửa sổ của mình thì
 * `executeJavaScript` bấm được mọi thứ và đọc được mọi thứ.
 *
 * Sáu mục:
 *   1. plugin gắn được vào trang, panel mở ra
 *   2. dải pill vẽ đúng số pill và đúng cái đang chọn
 *   3. sân khấu webview nằm ĐÚNG chồng khít ô trống mà React chừa
 *   4. trang web thật nạp được bên trong
 *   5. bấm pill đổi được pane đang xem
 *   6. đóng pill gỡ luôn webview, không để lại tiến trình trang mồ côi
 *
 *   npm run spike:dock
 */

// CJS chứ không phải ESM: khi Electron nạp một entry ESM, tên 'electron' được
// phân giải bằng bộ giải module của Node và trúng gói npm rỗng trong
// node_modules thay vì module dựng sẵn — mọi API trả về undefined.

// Terminal tích hợp của VS Code đặt sẵn ELECTRON_RUN_AS_NODE=1, biến
// electron.exe thành một node.exe thường: không cửa sổ, không module dựng sẵn.
if (process.env['ELECTRON_RUN_AS_NODE'] !== undefined) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  console.log('ELECTRON_RUN_AS_NODE đang bật — khởi động lại spike trong Electron thật.\n')
  const child = spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env })
  process.exit(child.status ?? 1)
}

const { app, BrowserWindow, session, shell } = require('electron')
const { execFileSync, spawn } = require('node:child_process')
const { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const root = join(__dirname, '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_' + 'modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const dockPatch = join(root, 'plugins', 'dock', 'cordis.patch.yml')
const PARTITION = 'persist:hdw-browser'
// `HDW_URL` để thử đúng trang mà chủ dự án gặp lỗi — trang nặng như google.com
// đi qua những đường mà example.com không bao giờ chạm tới.
const TRANG_THU = process.env['HDW_URL'] ?? 'https://example.com/'

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const cho = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------- engine

let engine
function moEngine() {
  const home = mkdtempSync(join(tmpdir(), 'hdw-ui-'))
  const nmDir = join(home, 'profiles', 'node_' + 'modules')
  mkdirSync(nmDir, { recursive: true })
  symlinkSync(join(root, 'plugins', 'dock'), join(nmDir, 'harness-desktop-dock'), 'junction')

  // Lớp patch thứ hai: gieo cwd thành workspace đã đăng ký.
  //
  // Bắt buộc, không phải tuỳ chọn. Mọi route của panel đi qua rào workspace, mà
  // `DSH_HOME` tạm ở trên thì chưa có workspace nào — không gieo thì mọi mục
  // kiểm đều bị từ chối, trông y hệt rào hỏng ngược.
  //
  // File patch sinh ra ngay trong `DSH_HOME` tạm chứ không nằm sẵn trong repo:
  // nó phải chứa đường dẫn TUYỆT ĐỐI tới plugin gieo, mà đường đó khác nhau
  // trên mỗi máy. Trên Windows phải là URL `file:///C:/...`; đường dẫn trần gây
  // `ERR_UNSUPPORTED_ESM_URL_SCHEME`.
  const seedPlugin = pathToFileURL(join(root, 'scripts', 'spike-ws-seed.mjs')).href
  const seedPatch = join(home, 'hdw-ws-seed.patch.yml')
  writeFileSync(seedPatch, `- insert:\n    - id: hdw-ws-seed\n      name: ${seedPlugin}\n`)

  const patches = ['--patch', dockPatch, '--patch', process.env['HDW_SEED_PATCH'] ?? seedPatch]

  engine = spawn(nodeExe, [dshBin, '--profile', 'web', ...patches, '--port', '0'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, DSH_HOME: home },
  })

  let out = ''
  let err = ''
  return new Promise((resolve, reject) => {
    const han = setTimeout(() => reject(new Error('engine không in dòng URL sau 180s')), 180_000)
    engine.stdout.setEncoding('utf8')
    engine.stdout.on('data', (c) => {
      out += c
      const m = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)/m.exec(out)
      if (m) { clearTimeout(han); resolve(m[1]) }
    })
    engine.stderr.setEncoding('utf8')
    engine.stderr.on('data', (c) => { err += c })
    engine.on('exit', (code) => {
      clearTimeout(han)
      reject(new Error(`engine thoát sớm mã ${code}\n${err.slice(-2000)}`))
    })
  })
}

// ------------------------------------------------------------------ cửa sổ

/** Đúng ba chốt an toàn của `src/main/window.ts`. Lệch là spike vô nghĩa. */
function guardWebviews(win) {
  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    prefs.backgroundThrottling = false
    params.partition = PARTITION
    delete params.allowpopups
  })
  win.webContents.on('did-attach-webview', (_e, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
  session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, _q, cb) => { cb(false) })
}

// ------------------------------------------------------------------- chính

async function main() {
  const baseUrl = await moEngine()
  console.log(`engine:  ${baseUrl}\n`)

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: process.env['HDW_HIEN'] === '1',
    webPreferences: { webviewTag: true },
  })
  guardWebviews(win)

  // Giữ webContents của từng guest — để hỏi thẳng trang khách xem nó có được
  // cấp khung hình không (`doKhungHinh`).
  //
  // ĐỪNG dùng chúng để chụp pixel. `capturePage` trên guest trả về hình guest
  // TỰ VẼ trong bộ nhớ, nên nó báo "vẽ ra rồi" kể cả khi trang bị sơn đè và
  // người dùng chỉ thấy một khoảng trắng. Xem MY-CHANGES.md ngày 2026-08-15.
  const guests = []
  win.webContents.on('did-attach-webview', (_e, guest) => {
    guests.push(guest)
    // Tiến trình trang chết là một cách ra màn hình trắng mà mọi sự kiện điều
    // hướng vẫn nổ đủ trước đó. Không nghe thì không bao giờ biết.
    guest.on('render-process-gone', (_ev, details) => {
      console.log(`  !! guest CHẾT: ${details.reason} (exitCode ${details.exitCode}) — ${guest.isDestroyed() ? '?' : guest.getURL()}`)
    })
    guest.on('did-fail-load', (_ev, code, moTa, url, mainFrame) => {
      if (mainFrame && code !== -3) console.log(`  !! guest did-fail-load ${code} ${moTa} — ${url}`)
    })
  })

  /**
   * Trang của guest có ĐANG ĐƯỢC CẤP KHUNG HÌNH không.
   *
   * Đây là thước đo chính cho câu hỏi "màn hình có trắng không", thay cho phép
   * đếm pixel qua `capturePage` đã bị gỡ. `capturePage` treo thất thường ngay
   * trên cả trang biết chắc là vẽ ra, nên "treo" ở đó KHÔNG chứng minh được
   * điều gì — đã có một lần kết luận sai vì tin nó.
   *
   * `requestAnimationFrame` thì dứt khoát: Chromium chỉ cấp khung hình cho thứ
   * nó tin là có người nhìn. Bề mặt hiển thị chưa từng được cấp thì `rAF` không
   * bao giờ chạy — dù trang đã tải xong, đã có tiêu đề, đã chạy đủ script.
   */
  const doKhungHinh = async (guest) => {
    if (guest === undefined || guest.isDestroyed()) return { ly_do: 'không bắt được guest' }
    const kq = await Promise.race([
      guest.executeJavaScript(`new Promise((res) => {
        let n = 0
        const buoc = () => { n += 1; requestAnimationFrame(buoc) }
        requestAnimationFrame(buoc)
        setTimeout(() => res({ n, vis: document.visibilityState, w: innerWidth, h: innerHeight }), 1000)
      })`).catch((e) => ({ ly_do: e.message })),
      new Promise((r) => setTimeout(() => r(null), 6000)),
    ])
    if (kq === null) return { ly_do: 'TREO — trang không trả lời sau 6s' }
    return kq
  }

  // ĐÃ BỎ `doPixel` (đếm pixel qua `guest.capturePage()`). Đừng dựng lại nó.
  //
  // Trên trang https thật nó treo vô hạn, và có lần còn LÀM CHẾT tiến trình
  // trang — kéo sập cả spike ngay giữa chừng. Tệ hơn: nó từng làm kết luận sai
  // theo cả hai chiều. "Treo" bị đọc thành "trang trắng" (thật ra trang vẽ tốt),
  // còn khi nó trả về ảnh thì ảnh đó là hình guest TỰ VẼ trong bộ nhớ — nên nó
  // báo "vẽ ra rồi" suốt nhiều tháng trong khi người dùng nhìn thấy một khoảng
  // trắng, vì trang bị nền panel sơn đè.
  //
  // Hai thước thay thế, cả hai đều rẻ và không treo được:
  //   `doKhungHinh` — trang có được cấp khung hình không
  //   mục 4d        — có kẻ ĐỤC nào sơn đè lên ô trang web không

  // Nạp lần một chỉ để có origin, rồi gieo trạng thái panel vào localStorage và
  // nạp lại. Cách này thay cho việc bấm chuột mở panel: nó đi qua đúng đường
  // đọc-lại-trạng-thái mà người dùng thật cũng đi qua mỗi lần mở app.
  await win.loadURL(baseUrl)
  await win.webContents.executeJavaScript(`
    localStorage.setItem('hdw.dock', JSON.stringify({
      open: true, width: 520,
      panes: [
        { id: 'p-files', kind: 'files', title: 'Files' },
        { id: 'p-web', kind: 'browser', title: 'Trang mới', url: ${JSON.stringify(TRANG_THU)} },
      ],
      activeId: 'p-web',
    }))
  `)
  await win.loadURL(baseUrl)

  // Chờ panel mount. Hỏi theo nhịp thay vì ngủ một phát: engine còn phải dựng
  // xong web UI trước khi plugin của ta chạy.
  const coPanel = await doiDenKhi(win, `!!document.querySelector('.hdw-dock:not([hidden])')`, 30_000)
  record('1. plugin gắn được, panel mở ra', coPanel === true, coPanel === true ? '' : String(coPanel))
  if (coPanel !== true) return

  const daDong = await dongHopThoai(win)
  console.log(`  (chuẩn bị) hộp thoại chào mừng: ${daDong}\n`)

  // --- 2. dải pill
  const pill = await win.webContents.executeJavaScript(`(() => {
    const ps = [...document.querySelectorAll('.hdw-pillwrap')]
    return {
      so: ps.length,
      ten: ps.map(p => p.querySelector('.hdw-pill-name')?.textContent ?? ''),
      chon: ps.findIndex(p => p.querySelector('[aria-selected="true"]')),
      soNutDong: ps.filter(p => p.querySelector('.hdw-pill-x')).length,
    }
  })()`)
  record('2. dải pill đúng số và đúng cái đang chọn',
    pill.so === 2 && pill.chon === 1 && pill.soNutDong === 1,
    `${pill.so} pill ${JSON.stringify(pill.ten)}, đang chọn #${pill.chon}, ${pill.soNutDong} nút đóng`)

  // --- 3. sân khấu chồng khít ô trống
  await cho(600)
  const khop = await win.webContents.executeJavaScript(`(() => {
    const slot = document.querySelector('.hdw-slot')
    const stage = document.querySelector('.hdw-stage')
    if (!slot || !stage) return { ly_do: 'thiếu ' + (slot ? 'stage' : 'slot') }
    const a = slot.getBoundingClientRect(), b = stage.getBoundingClientRect()
    const lech = Math.max(Math.abs(a.x-b.x), Math.abs(a.y-b.y), Math.abs(a.width-b.width), Math.abs(a.height-b.height))
    // "Ẩn" nay nghĩa là bị dìm dưới app (z-index âm), không phải display:none.
    return { lech: Math.round(lech), an: getComputedStyle(stage).zIndex === '-1', w: Math.round(b.width), h: Math.round(b.height) }
  })()`)
  record('3. sân khấu chồng khít ô trống React chừa',
    khop.lech !== undefined && khop.lech <= 1 && khop.an === false && khop.w > 100,
    khop.ly_do ?? `lệch ${khop.lech}px, ${khop.w}x${khop.h}, ẩn=${khop.an}`)

  // --- 4. trang thật nạp được
  const nap = await doiDenKhi(win, `(() => {
    const wv = document.querySelector('.hdw-webview')
    return !!wv && typeof wv.getURL === 'function' && wv.getURL().length > ${'about:blank'.length}
  })()`, 30_000)
  const diaChi = await win.webContents.executeJavaScript(
    `(() => { const wv = document.querySelector('.hdw-webview'); return wv && wv.getURL ? wv.getURL() : '(chưa có)' })()`)
  record('4. trang web thật nạp được trong webview', nap === true, diaChi)

  // Thanh địa chỉ có bám theo trang không. So với TRANG_THU chứ không so cứng
  // — trang thử đổi được qua HDW_URL.
  const thanh = await win.webContents.executeJavaScript(
    `document.querySelector('.hdw-address input')?.value ?? '(không có ô địa chỉ)'`)
  record('4b. thanh địa chỉ bám theo trang', thanh.startsWith(new URL(TRANG_THU).origin), thanh)

  // --- 4c. trang có VẼ RA PIXEL thật không — đo từ tiến trình chính
  //
  // Đây là tầng mà mọi mục trước đều không chạm tới, và là đúng tầng chủ dự án
  // nhìn: pill đổi tên, thanh địa chỉ đúng, mà vùng trang trắng trơn.
  {
    const kh = await doKhungHinh(guests[0])
    record('4c. trang ĐƯỢC CẤP KHUNG HÌNH (tab dựng sẵn)',
      kh.n !== undefined && kh.n > 0,
      kh.ly_do ?? `${kh.n} khung hình/giây, visibility=${kh.vis}, khung nhìn ${kh.w}x${kh.h}`)
  }

  // --- 4d. KHÔNG ai sơn đè lên ô trang web
  //
  // Đây là mục bắt được lỗi "trang trắng" mà 15 mục còn lại đều bỏ lọt: panel
  // sống trong lớp `overlayLayer` (z-index 20) của upstream, còn sân khấu
  // webview khai `z-index: 5`, nên NỀN CỦA PANEL sơn đè lên trang. Trang vẫn
  // tải, vẫn có tiêu đề, vẫn được cấp khung hình — chỉ là không ai nhìn thấy nó.
  //
  // Nên mục này hỏi đúng câu người dùng hỏi: cái gì đang nằm trên trang web, và
  // nó có trong suốt không.
  {
    const che = await win.webContents.executeJavaScript(`(() => {
      const stage = document.querySelector('.hdw-stage')
      if (stage === null) return { ly_do: 'không thấy sân khấu' }
      const s = stage.getBoundingClientRect()
      const chong = document.elementsFromPoint(Math.round(s.x + s.width / 2), Math.round(s.y + s.height / 2))
      const i = chong.findIndex((e) => e.classList.contains('hdw-stage') || e.classList.contains('hdw-webview'))
      const tren = (i === -1 ? chong : chong.slice(0, i))
      // Chỉ tính phần tử CỦA PANEL này. Hộp thoại hay lớp mask của upstream nằm
      // trên trang web là chuyện đúng — chúng phải che. Thứ không bao giờ được
      // che là chính panel chứa trang web đó.
      const duc = tren.filter((e) => {
        const ten = e.className.toString()
        if (!ten.includes('hdw-')) return false
        const bg = getComputedStyle(e).backgroundColor
        return bg !== 'transparent' && !/rgba\\(.*,\\s*0\\)$/.test(bg)
      })
      return { soDuc: duc.length, ten: duc.map((e) => (e.className || e.tagName).toString().slice(0, 30)) }
    })()`)
    record('4d. không có gì sơn đè lên ô trang web',
      che.soDuc === 0,
      che.ly_do ?? (che.soDuc === 0 ? 'không kẻ nào' : `bị ${che.soDuc} lớp đục phủ: ${JSON.stringify(che.ten)}`))
  }

  // CÒN TREO (chỉ với capturePage gọi TỪ TRONG TRANG) — đường tiến trình chính
  // ở trên chạy tốt và là đường lệnh chụp của agent sẽ dùng.
  //
  // Một mục "trang có vẽ ra pixel thật không", gọi `wv.capturePage()` từ trong
  // trang, làm cả spike treo cứng: Promise không giải quyết, và cả
  // `setTimeout` bọc ngoài nó cũng không nổ — tức là vòng lặp sự kiện của trang
  // bị chặn, chứ không phải một lời hứa bị quên.
  //
  // Lạ ở chỗ `scripts/spike-webview.cjs` mục 6a gọi ĐÚNG API đó từ ĐÚNG vị trí
  // đó và trả về 8058 byte. Khác biệt duy nhất tìm được: ở đó trang khách là
  // một trang cục bộ do spike tự phục vụ, ở đây là một trang https ngoài đời.
  //
  // Không chặn đường: đường chụp ảnh dành cho agent vốn đã dự kiến đi qua tiến
  // trình chính (`did-attach-webview` trao thẳng webContents của guest), chứ
  // không đi qua trang. Ghi lại để lần sau khỏi dò lại từ đầu.

  // Ảnh lúc trang web đang hiện. Chụp CỬA SỔ (không phải guest) là có chủ ý:
  // câu hỏi cần trả lời là "trang có vẽ ra đúng ô của nó trong panel không",
  // và chỉ ảnh của cả cửa sổ mới trả lời được.
  if (process.env['HDW_ANH_WEB'] !== undefined) {
    await cho(1200)
    const anh = await win.webContents.capturePage()
    require('node:fs').writeFileSync(process.env['HDW_ANH_WEB'], anh.toPNG())
    console.log(`  ảnh lúc mở trang: ${process.env['HDW_ANH_WEB']}`)
  }

  // --- 5. bấm pill đổi pane
  await win.webContents.executeJavaScript(
    `document.querySelectorAll('.hdw-pillwrap .hdw-pill')[0].click()`)
  await cho(500)
  const sau = await win.webContents.executeJavaScript(`(() => ({
    chon: [...document.querySelectorAll('.hdw-pillwrap')].findIndex(p => p.querySelector('[aria-selected="true"]')),
    stageAn: getComputedStyle(document.querySelector('.hdw-stage')).zIndex === '-1',
    filesHien: !!document.querySelector('.hdw-files:not([hidden])') || !!document.querySelector('.hdw-empty:not([hidden])'),
  }))()`)
  record('5. bấm pill đổi được pane, sân khấu ẩn theo',
    sau.chon === 0 && sau.stageAn === true && sau.filesHien === true,
    `đang chọn #${sau.chon}, sân khấu ẩn=${sau.stageAn}, Files hiện=${sau.filesHien}`)

  // --- 6. đóng pill gỡ webview
  await win.webContents.executeJavaScript(
    `document.querySelector('.hdw-pill-x').click()`)
  await cho(600)
  const con = await win.webContents.executeJavaScript(`({
    pill: document.querySelectorAll('.hdw-pillwrap').length,
    webview: document.querySelectorAll('.hdw-webview').length,
  })`)
  record('6. đóng pill gỡ luôn webview', con.pill === 1 && con.webview === 0,
    `còn ${con.pill} pill, ${con.webview} webview`)

  // --- 7. nút `+` phải MỞ RA MENU NHÌN THẤY ĐƯỢC
  //
  // Chủ dự án báo: bấm `+` không thấy gì xảy ra. Kiểm "menu có trong DOM không"
  // là chưa đủ — nó vẫn có trong DOM khi bị container cha cắt mất. Phép kiểm
  // thật là **bắn tia vào giữa menu**: `elementFromPoint` chỉ trả về nó khi nó
  // thực sự nhìn thấy được và bấm được.
  await win.webContents.executeJavaScript(
    `document.querySelector('.hdw-tabbar button[aria-label="Mở thêm"]').click()`)
  await cho(400)
  const menu = await win.webContents.executeJavaScript(`(() => {
    const m = document.querySelector('[role="menu"]')
    if (!m) return { ly_do: 'không có phần tử role=menu nào' }
    const r = m.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return { ly_do: 'menu có kích thước 0' }
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    const trung = document.elementFromPoint(x, y)
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      trongKhung: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
      bamDuoc: !!trung && m.contains(trung),
      soMuc: m.querySelectorAll('[role="menuitem"]').length,
    }
  })()`)
  record('7. bấm + mở ra menu NHÌN THẤY và BẤM ĐƯỢC',
    menu.bamDuoc === true && menu.trongKhung === true && menu.soMuc === 3,
    menu.ly_do ?? `${menu.w}x${menu.h}, ${menu.soMuc} mục, trong khung=${menu.trongKhung}, bấm được=${menu.bamDuoc}`)

  // --- 8. chọn một mục thì thật sự mở pane mới
  if (menu.soMuc === 3) {
    const truoc = await win.webContents.executeJavaScript(`document.querySelectorAll('.hdw-pillwrap').length`)
    await win.webContents.executeJavaScript(`(() => {
      const muc = [...document.querySelectorAll('[role="menuitem"]')]
      const t = muc.find(m => m.textContent.includes('Terminal'))
      t.click()
    })()`)
    await cho(700)
    const sau8 = await win.webContents.executeJavaScript(`({
      pill: document.querySelectorAll('.hdw-pillwrap').length,
      ten: [...document.querySelectorAll('.hdw-pill-name')].map(e => e.textContent),
      menuCon: !!document.querySelector('[role="menu"]'),
    })`)
    record('8. chọn "Terminal mới" mở ra pane mới và đóng menu',
      sau8.pill === truoc + 1 && sau8.menuCon === false,
      `${truoc} → ${sau8.pill} pill ${JSON.stringify(sau8.ten)}, menu còn mở=${sau8.menuCon}`)
  } else {
    record('8. chọn "Terminal mới" mở ra pane mới và đóng menu', false, 'bỏ qua vì menu không mở được')
  }

  // --- 9. terminal mở từ `+` phải CHẠY THẬT
  //
  // Mục 8 chỉ nói "có thêm một pill". Một pill trỏ vào một terminal chết cũng
  // là một pill. Kiểm tới nơi: xterm có vẽ ra, và có chữ của shell chảy về.
  const term = await doiDenKhi(win, `(() => {
    const rows = document.querySelector('.hdw-termwrap:not([hidden]) .xterm-rows')
    return !!rows && rows.textContent.trim().length > 0
  })()`, 25_000)
  const termChiTiet = await win.webContents.executeJavaScript(`(() => {
    const w = document.querySelector('.hdw-termwrap')
    return {
      co: !!w,
      daDong: !!document.querySelector('.hdw-termbar'),
      chu: (document.querySelector('.xterm-rows')?.textContent ?? '').trim().slice(0, 60),
    }
  })()`)
  record('9. terminal mở từ + chạy thật, có chữ của shell',
    term === true && termChiTiet.daDong === false,
    termChiTiet.daDong ? 'phiên đã đóng ngay' : JSON.stringify(termChiTiet.chu))

  // --- 10. đường người dùng thật: mở tab web trống rồi GÕ địa chỉ
  //
  // Khác hẳn mục 4, nơi tab được tạo sẵn kèm URL. Ở đây tab bắt đầu trống và
  // địa chỉ đi qua ô nhập của React — đúng thao tác của người dùng.
  await win.webContents.executeJavaScript(
    `document.querySelector('.hdw-tabbar button[aria-label="Mở thêm"]').click()`)
  await cho(400)
  await win.webContents.executeJavaScript(`(() => {
    const muc = [...document.querySelectorAll('[role="menuitem"]')]
    muc.find(m => m.textContent.includes('Trang web')).click()
  })()`)
  await cho(800)

  // Ô nhập của React bỏ qua việc gán thẳng `.value`; phải gọi setter gốc rồi
  // phát sự kiện `input` thì React mới thấy.
  const goDuoc = await win.webContents.executeJavaScript(`(() => {
    const o = document.querySelector('.hdw-browser:not([hidden]) .hdw-address input')
    if (!o) return 'không tìm thấy ô địa chỉ của tab đang mở'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(o, 'example.com')
    o.dispatchEvent(new Event('input', { bubbles: true }))
    o.form.requestSubmit()
    return true
  })()`)
  const daDi = goDuoc === true && await doiDenKhi(win, `(() => {
    const wv = [...document.querySelectorAll('.hdw-webview')].pop()
    return !!wv && wv.getURL().startsWith('https://example.com')
  })()`, 25_000) === true
  record('10. gõ "example.com" vào thanh địa chỉ là đi được',
    daDi, goDuoc === true ? '' : String(goDuoc))

  // --- 11. hai tab web cùng lúc: chỉ tab đang xem nằm trên
  const chong = await win.webContents.executeJavaScript(`(() => {
    const ws = [...document.querySelectorAll('.hdw-webview')]
    return { so: ws.length, z: ws.map(w => w.style.zIndex) }
  })()`)
  record('11. nhiều tab web xếp chồng, đúng một cái nằm trên',
    chong.so >= 1 && chong.z.filter((z) => z === '1').length === 1,
    `${chong.so} webview, z-index ${JSON.stringify(chong.z)}`)

  // --- 12. trang web PHẢI CHIẾM CHỖ THẬT trên màn hình
  //
  // Mục 3 đo sân khấu lúc panel vừa mở với tab web dựng sẵn. Nó KHÔNG bắt được
  // trường hợp thật đã xảy ra: trang nạp xong, tiêu đề lan sang pill, thanh
  // địa chỉ đúng — mà vùng trang trắng trơn, vì lệnh hiện sân khấu nằm trong
  // một `requestAnimationFrame` không bao giờ nổ.
  //
  // Nên kiểm ở đây theo cách người dùng nhìn: bắn tia vào giữa vùng trang. Nếu
  // trúng thẻ webview thì trang thật sự chiếm chỗ đó; trúng thứ khác (hoặc
  // không trúng gì) là trang vô hình dù đã nạp xong.
  const chiemCho = await win.webContents.executeJavaScript(`(() => {
    const wv = [...document.querySelectorAll('.hdw-webview')].find(w => w.style.zIndex === '1')
    const stage = document.querySelector('.hdw-stage')
    if (!wv || !stage) return { ly_do: 'thiếu webview hoặc sân khấu' }
    if (getComputedStyle(stage).zIndex === '-1') return { ly_do: 'sân khấu đang bị dìm trong khi tab web đang xem' }
    const b = wv.getBoundingClientRect()
    if (b.width < 100 || b.height < 100) return { ly_do: 'webview kích thước ' + Math.round(b.width) + 'x' + Math.round(b.height) }
    // Dùng elementsFromPoint (SỐ NHIỀU): lấy cả chồng phần tử tại điểm đó, từ
    // trên xuống. Câu hỏi đúng không phải "webview có ở trên cùng không" — một
    // hộp thoại của app nằm trên nó là chuyện ĐÚNG, hộp thoại phải che trang
    // web. Câu hỏi đúng là **webview có nằm trên giao diện app không**, tức nó
    // phải đứng TRƯỚC #root trong chồng.
    const chong = document.elementsFromPoint(b.left + b.width / 2, b.top + b.height / 2)
    const iWv = chong.findIndex((e) => e === wv || wv.contains(e))
    const iRoot = chong.findIndex((e) => e.id === 'root')
    return {
      w: Math.round(b.width), h: Math.round(b.height),
      coWv: iWv !== -1,
      trenApp: iWv !== -1 && (iRoot === -1 || iWv < iRoot),
      // Cái gì nằm trên webview — để khi hỏng còn biết bị ai che.
      tren: (iWv === -1 ? chong : chong.slice(0, iWv))
        .map((e) => e.id || e.className || e.tagName).slice(0, 4),
    }
  })()`)
  record('12. trang web chiếm chỗ thật, nằm trên giao diện app',
    chiemCho.trenApp === true,
    chiemCho.ly_do ?? `${chiemCho.w}x${chiemCho.h}, có trong chồng=${chiemCho.coWv}`
      + (chiemCho.trenApp === true ? '' : `, bị che bởi ${JSON.stringify(chiemCho.tren)}`))

  // --- 13. tab mở theo ĐÚNG thao tác người dùng cũng phải vẽ ra pixel
  //
  // Khác 4c: tab kia dựng sẵn kèm URL lúc nạp trang; tab này vừa được mở trống
  // từ nút `+` rồi gõ địa chỉ — y hệt điều chủ dự án làm khi gặp lỗi.
  {
    const kh = await doKhungHinh(guests[guests.length - 1])
    record('13. tab mở từ + rồi gõ địa chỉ cũng được cấp khung hình',
      kh.n !== undefined && kh.n > 0,
      kh.ly_do ?? `${kh.n} khung hình/giây, visibility=${kh.vis}, khung nhìn ${kh.w}x${kh.h}`)
  }

  // Ảnh chụp để nhìn bằng mắt, kể cả khi mọi mục đều đạt.
  if (process.env['HDW_ANH'] !== undefined) {
    const anh = await win.webContents.capturePage()
    require('node:fs').writeFileSync(process.env['HDW_ANH'], anh.toPNG())
    console.log(`\nảnh: ${process.env['HDW_ANH']}`)
  }
}

/**
 * Đóng mọi hộp thoại chào mừng của upstream, và XÁC NHẬN đã hết.
 *
 * DSH_HOME mới tinh bật ra một CHUỖI hộp thoại, không phải một cái: đóng
 * "Internal Testing Notice" thì hiện tiếp "Add an API key". Nên phải lặp tới
 * khi không còn cái nào, chứ không phải thử vài cách trên một cái.
 *
 * Dọn cho màn hình gọn, KHÔNG phải điều kiện tiên quyết. Các mục kiểm được
 * viết để chịu được việc còn hộp thoại: mục 12 hỏi "webview có nằm trên #root
 * không" thay vì "webview có ở trên cùng không", vì một hộp thoại của app nằm
 * trên trang web là chuyện ĐÚNG — hộp thoại phải che trang.
 *
 * Mỗi vòng hỏi lại thay vì tin: "đã bấm" và "đã đóng" là hai chuyện khác nhau —
 * bấm "Continue" một mình đã đo được là không đủ, và hộp "Internal Testing
 * Notice" còn tự bật lại khi profile chưa có API key.
 */
async function dongHopThoai(win) {
  const dem = async () => await win.webContents.executeJavaScript(
    `document.querySelectorAll('[role="dialog"]').length`)
  if (await dem() === 0) return 'không có'

  // Nút đóng lành tính, theo thứ tự ưu tiên. Cố ý KHÔNG có "Save"/"Confirm" —
  // bài kiểm không được cam kết thay người dùng thứ gì.
  const NHAN = 'Continue|Configure later|Skip|Later|Close|Done|Tiếp tục|Bỏ qua|Đóng|继续|跳过'
  const cach = [
    `[...document.querySelectorAll('button')].find(b => new RegExp('^(' + ${JSON.stringify(NHAN)} + ')$').test(b.textContent.trim()))?.click()`,
    `document.querySelector('[role="dialog"]')?.parentElement?.querySelector('[aria-hidden="true"]')?.click()`,
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  ]

  const daDong = []
  for (let vong = 0; vong < 6; vong += 1) {
    const truoc = await dem()
    if (truoc === 0) return `đã đóng ${daDong.length} hộp (${daDong.join(', ')})`
    const ten = await win.webContents.executeJavaScript(
      `document.querySelector('[role="dialog"]').textContent.trim().slice(0, 28)`)
    for (const ma of cach) {
      try { await win.webContents.executeJavaScript(ma) } catch { /* thử cách sau */ }
      await cho(450)
      if (await dem() < truoc) break
    }
    if (await dem() >= truoc) {
      return `không đóng được hộp "${ten}" (không sao — các mục kiểm chịu được)`
    }
    daDong.push(ten)
  }
  return `còn hộp thoại sau 6 vòng — đã đóng ${daDong.length}`
}

/** Hỏi lại biểu thức theo nhịp cho tới khi nó thành true, hoặc hết giờ. */
async function doiDenKhi(win, bieuThuc, han) {
  const het = Date.now() + han
  let cuoi
  while (Date.now() < het) {
    try {
      if (await win.webContents.executeJavaScript(bieuThuc) === true) return true
    } catch (e) { cuoi = e.message }
    await cho(300)
  }
  return cuoi ?? `hết ${han / 1000}s`
}

app.whenReady().then(main).then(
  () => ket(),
  (e) => { console.log(`\nLỖI: ${e.message}`); ket(1) },
)

function ket(ma) {
  console.log('\n=== KẾT QUẢ ===')
  const hong = results.filter((r) => !r.ok)
  console.log(hong.length === 0 && ma === undefined
    ? 'Tất cả đạt. Panel và trình duyệt chạy đúng trong trang thật.'
    : `${hong.length}/${results.length} mục KHÔNG đạt${hong.length ? ': ' + hong.map(r => r.name).join(', ') : ''}`)
  try { execFileSync('taskkill', ['/pid', String(engine.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* đã tắt */ }
  app.exit(ma ?? (hong.length === 0 ? 0 : 1))
}
