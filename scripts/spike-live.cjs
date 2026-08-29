/**
 * Lượt chạy THẬT: model thật, profile thật, và một loạt việc đời thường.
 *
 * Ba bộ kiểm kia đều chạy trên một `DSH_HOME` tạm và không có model nào. Chúng
 * chứng minh từng mảnh chạy đúng khi được gọi đúng cách. Chúng KHÔNG chứng minh
 * được thứ chủ dự án thật sự muốn biết: **nhờ một việc bình thường thì nó có
 * xong không.**
 *
 * Nên bài này không gọi tool nào cả. Nó gõ một câu tiếng Việt vào ô soạn đúng
 * như người dùng, rồi đo **kết quả nhìn thấy được** — trang nào đang mở, ảnh nào
 * hiện ra, chữ nào xuất hiện trong câu trả lời. Model tự chọn tool; nếu nó chọn
 * sai hay tool hỏng giữa chừng thì mục kiểm đỏ, và đó đúng là điều cần biết.
 *
 * ## Nó động vào gì của bạn
 *
 * - Dùng `~/.dsh` THẬT, nên có API key và model đã cấu hình sẵn.
 * - Tạo một phiên hội thoại MỚI cho mỗi kịch bản, và tiêu một lượt gọi model.
 * - Không sửa cấu hình, không bấm nút xác nhận nào thay bạn.
 *
 *   npm run spike:live              chạy hết
 *   HDW_ONLY=shot,search npm run spike:live    chỉ chạy vài kịch bản
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

// Thừa hưởng phiên đăng nhập trong panel, bằng một BẢN CHÉP của hồ sơ app.
//
// Kho cookie của panel (`persist:hdw-browser`) nằm trong thư mục dữ liệu của
// app thật. Chạy bằng binary electron trần thì Electron đặt tên thư mục khác,
// nên spike có kho cookie TRẮNG — đó là lý do mọi lượt chạy trước đều gặp trang
// đăng nhập Google trong khi chủ dự án đã đăng nhập sẵn trong app.
//
// Trỏ thẳng vào hồ sơ thật thì hỏng theo kiểu khác: hai tiến trình Electron
// dùng chung một thư mục hồ sơ sẽ phá hỏng nó, kèm theo là mất đúng phiên đăng
// nhập vừa nói. Nên chép ra một bản tạm, chỉ đọc từ bản gốc. Bài kiểm chạy được
// cả khi app đang mở, và không có đường nào để nó ghi vào hồ sơ của bạn.
//
// Chép hai thứ, và phải đủ cả hai: thư mục phân vùng chứa cookie, và `Local
// State` chứa khoá giải mã cookie. Thiếu khoá thì cookie chép sang chỉ là rác.
function cloneProfile() {
  const fs = require('node:fs')
  const path = require('node:path')
  const source = path.join(app.getPath('appData'), 'Harness Desktop')
  const target = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hdw-profile-'))

  /** Chép đệ quy, BỎ QUA file đang bị app khoá thay vì chết cả bài kiểm. */
  const copy = (from, to) => {
    let entries
    try {
      entries = fs.readdirSync(from, { withFileTypes: true })
    } catch { return }
    fs.mkdirSync(to, { recursive: true })
    for (const entry of entries) {
      const src = path.join(from, entry.name)
      const dst = path.join(to, entry.name)
      if (entry.isDirectory()) copy(src, dst)
      else { try { fs.copyFileSync(src, dst) } catch { /* file đang bị khoá */ } }
    }
  }

  try { fs.copyFileSync(path.join(source, 'Local State'), path.join(target, 'Local State')) } catch { /* chưa có */ }
  copy(path.join(source, 'Partitions', 'hdw-browser'), path.join(target, 'Partitions', 'hdw-browser'))
  return target
}

app.setPath('userData', cloneProfile())

const { execFileSync, spawn } = require('node:child_process')
const { mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const root = join(__dirname, '..')
const nodeExe = join(root, 'runtime', 'node.exe')
const dshBin = join(root, 'engine', 'node_' + 'modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const dockPatch = join(root, 'plugins', 'dock', 'cordis.patch.yml')

/** Nơi để ảnh chụp từng kịch bản, để nhìn bằng mắt sau khi chạy. */
const shotDir = process.env['HDW_ANH'] ?? join(tmpdir(), 'hdw-live')

/** Ngân sách cho một lượt model, tính cả thời gian nó gọi tool. */
const TURN_BUDGET_MS = Number(process.env['HDW_CHO'] ?? 240_000)

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}
const wait = (ms) => new Promise((r) => { setTimeout(r, ms) })

// ------------------------------------------------------------------ kịch bản
//
// Mỗi kịch bản là một câu người dùng thật sẽ gõ, cộng một phép kiểm nhìn vào
// KẾT QUẢ chứ không nhìn vào tool nào được gọi. Cố ý không nêu tên tool trong
// câu nhờ: nếu phải chỉ tận tay thì tính năng chưa dùng được.
//
// `check(view)` nhận một bản chụp trạng thái:
//   view.urls    — địa chỉ mọi trang web đang mở trong panel
//   view.widths  — bề rộng khung nhìn mà CHÍNH MỖI TRANG khai, tính bằng CSS px
//   view.text    — toàn bộ chữ trong khung hội thoại
//   view.tools   — tên các tool model đã gọi
//   view.shot    — { has, naturalWidth, naturalHeight } của ảnh trong thẻ kết quả

const SCENARIOS = [
  {
    id: 'read',
    title: 'đọc một trang và trả lời đúng nội dung của nó',
    prompt: 'Mở trang example.com giúp tôi, rồi cho tôi biết tiêu đề trang và câu đầu tiên trên đó.',
    check: (view) => ({
      ok: view.urls.some((u) => u.includes('example.com')) && /example domain/i.test(view.text),
      detail: `trang mở: ${view.urls.join(', ') || '(không có)'}`,
    }),
  },
  {
    id: 'search',
    title: 'gõ vào ô tìm kiếm rồi đọc kết quả',
    prompt: 'Vào duckduckgo.com và tìm giúp tôi "deepseek harness", rồi kể vài kết quả đầu tiên.',
    check: (view) => ({
      ok: view.urls.some((u) => /duckduckgo\.com\/.*q=/i.test(u) && /deepseek/i.test(u)),
      detail: `trang kết quả: ${view.urls.join(', ').slice(0, 110) || '(không có)'}`,
    }),
  },
  {
    id: 'click',
    title: 'bấm một liên kết trên trang rồi đi tới trang mới',
    // Tên liên kết phải ĐÚNG. Bản trước ghi "More information" trong khi trang
    // chỉ có "Learn more"; agent đọc trang, thấy lệch, và dừng lại hỏi — đúng
    // việc phải làm, nhưng nó biến kịch bản này thành phép đo sự cẩn thận của
    // model chứ không còn đo cú bấm nữa.
    prompt: 'Mở example.com rồi bấm vào liên kết "Learn more" trên trang đó cho tôi.',
    check: (view) => ({
      ok: view.urls.some((u) => /iana\.org/i.test(u)),
      detail: `trang sau khi bấm: ${view.urls.join(', ') || '(không có)'}`,
    }),
  },
  {
    id: 'shot',
    title: 'chụp ảnh trang và ảnh HIỆN RA cho người dùng xem',
    prompt: 'Mở trang wikipedia.org rồi chụp ảnh trang đó cho tôi xem.',
    check: (view) => ({
      ok: view.shot.has && view.shot.naturalWidth > 100,
      detail: view.shot.has
        ? `ảnh ${view.shot.naturalWidth}x${view.shot.naturalHeight} trên màn hình`
        : 'KHÔNG có ảnh nào trong khung hội thoại',
    }),
  },
  {
    id: 'mobile',
    title: 'xem một trang ở cỡ điện thoại rồi chụp lại',
    prompt: 'Cho tôi xem trang example.com trông thế nào trên màn hình điện thoại, chụp ảnh lại nhé.',
    // Hỏi CHÍNH TRANG xem nó tin mình rộng bao nhiêu, không đo bề rộng tấm ảnh:
    // ảnh chụp ra theo pixel vật lý nên nhân thêm tỉ lệ màn hình, và bản trước
    // đã suýt nghiệm thu bằng một con số 516px trông chẳng giống điện thoại
    // chút nào. Cái cần biết là bố cục trang đổi theo, tức `innerWidth` của nó.
    check: (view) => ({
      ok: view.shot.has && view.widths.some((w) => w > 0 && w <= 480),
      detail: `khung nhìn trang khai: ${view.widths.join(', ') || '?'}px`
        + `; ảnh ${view.shot.has ? `${view.shot.naturalWidth}x${view.shot.naturalHeight}` : 'KHÔNG CÓ'}`,
    }),
  },
  {
    id: 'tabs',
    title: 'mở nhiều tab và quản lý được chúng',
    prompt: 'Mở giúp tôi hai tab: một cái example.com, một cái wikipedia.org. Xong rồi liệt kê các tab đang mở.',
    // Đòi ĐÚNG hai địa chỉ đó, không phải "có từ hai tab trở lên": panel giữ
    // tab qua các phiên, nên phép đếm suông sẽ xanh nhờ tab của kịch bản trước.
    check: (view) => ({
      ok: view.urls.some((u) => u.includes('example.com'))
        && view.urls.some((u) => /wikipedia\.org/i.test(u)),
      detail: `${view.urls.length} tab: ${view.urls.join(', ').slice(0, 110)}`,
    }),
  },
  {
    id: 'network',
    title: 'gỡ lỗi: xem trang gọi những request nào',
    prompt: 'Mở example.com rồi cho tôi biết trang đó tải về những tài nguyên gì qua mạng.',
    check: (view) => ({
      ok: view.tools.includes('browser_network') && view.urls.some((u) => u.includes('example.com')),
      detail: `tool đã gọi: ${view.tools.join(', ') || '(không có)'}`,
    }),
  },
  {
    id: 'scroll',
    title: 'cuộn xuống và đọc phần nội dung phía dưới',
    prompt: 'Mở https://en.wikipedia.org/wiki/Web_browser, cuộn xuống dưới và tóm tắt cho tôi phần lịch sử.',
    check: (view) => ({
      ok: view.urls.some((u) => /wikipedia\.org\/wiki\/Web_browser/i.test(u))
        && view.text.length > 400,
      detail: `trang: ${view.urls.join(', ').slice(0, 80)}`,
    }),
  },

  // ---------------------------------------------------- việc nặng hơn một bậc

  {
    id: 'form',
    title: 'điền một form nhiều ô rồi gửi đi',
    // Việc khó nhất trong cả bộ: sáu ô, ba kiểu khác nhau (ô chữ, nút chọn, hộp
    // kiểm, vùng ghi chú), rồi bấm gửi. Chọn httpbin vì nó in NGƯỢC lại đúng dữ
    // liệu vừa nhận — nên "gửi thành công" là thứ đo được, không phải thứ tin lời.
    prompt: 'Vào https://httpbin.org/forms/post và điền form giúp tôi: tên "Nguyen Van A", '
      + 'điện thoại 0900123456, email a@example.com, cỡ Large, chọn topping bacon, '
      + 'ghi chú "giao truoc 7 gio toi". Điền xong thì bấm gửi.',
    // Nhận cả `httpbingo.org`: httpbin.org hay trả 503, và agent đã tự chuyển
    // sang bản mirror cùng mã nguồn rồi báo lại — đúng thứ ta muốn nó làm. Phép
    // kiểm bản trước đòi đúng một tên miền nên chấm đỏ một lượt hoàn toàn thành
    // công.
    check: (view) => ({
      ok: view.urls.some((u) => /httpbin(go)?\.org\/post/i.test(u))
        && /nguyen van a/i.test(view.text)
        && /bacon/i.test(view.text),
      detail: `trang sau khi gửi: ${view.urls.join(', ').slice(0, 90) || '(không có)'}`,
    }),
  },
  {
    id: 'table',
    title: 'trích dữ liệu từ một bảng trên trang',
    prompt: 'Mở https://en.wikipedia.org/wiki/List_of_countries_by_population_(United_Nations) '
      + 'và cho tôi ba nước đông dân nhất kèm số dân.',
    // Nhận CẢ HAI ngôn ngữ. Agent trả lời bằng tiếng Việt vì câu nhờ bằng tiếng
    // Việt — hoàn toàn đúng — và bản trước chỉ dò "India"/"China" nên chấm đỏ một
    // câu trả lời chuẩn xác tới từng con số.
    //
    // Bài học chung của cả ba lần chấm sai trong bộ này: **đo lời văn của model
    // thì mong manh, đo dấu vết nó để lại thì chắc.** Địa chỉ trang, tấm ảnh,
    // khung nhìn đều không phụ thuộc model diễn đạt thế nào.
    check: (view) => {
      const NAMES = [
        ['India', 'Ấn Độ'], ['China', 'Trung Quốc'], ['United States', 'Hoa Kỳ|Mỹ'],
      ]
      const seen = NAMES.filter(([en, vi]) => new RegExp(`${en}|${vi}`, 'i').test(view.text))
      return {
        ok: seen.length >= 2,
        detail: `nhắc tới: ${seen.map(([en]) => en).join(', ') || '(không nước nào)'}`,
      }
    },
  },
  {
    id: 'lookup',
    title: 'tra một con số cụ thể trên trang',
    // Nói rõ "trong trình duyệt của panel". Bản trước chỉ nói "tra trên
    // Wikipedia", và agent dùng tool tìm kiếm web có sẵn của engine rồi trả lời
    // đúng mà không mở trang nào — hợp lý với người dùng, nhưng khi đang đo
    // chính cái trình duyệt thì phải chỉ đúng cửa.
    prompt: 'Mở trang Wikipedia về ngôn ngữ lập trình Python trong trình duyệt của panel, '
      + 'rồi cho tôi biết bản đầu tiên ra năm nào.',
    check: (view) => ({
      ok: /1991/.test(view.text) && view.urls.some((u) => /wikipedia\.org/i.test(u)),
      detail: `trả lời có "1991": ${String(/1991/.test(view.text))}`,
    }),
  },
  {
    id: 'research',
    title: 'nghiên cứu: mở nhiều nguồn rồi so sánh',
    prompt: 'So sánh ngắn gọn Vite và Webpack giúp tôi. Mở trang chủ của cả hai để đối chiếu.',
    check: (view) => ({
      ok: view.urls.filter((u) => /vite|webpack/i.test(u)).length >= 2,
      detail: `nguồn đã mở: ${view.urls.join(', ').slice(0, 110) || '(không có)'}`,
    }),
  },
  {
    id: 'gdocs',
    title: 'trang cần đăng nhập: tới được và BÁO ĐÚNG là cần đăng nhập',
    // Google Docs/Sheets nằm sau tường đăng nhập, và panel dùng kho cookie
    // RIÊNG chứ không mượn phiên Chrome của người dùng — nên agent chắc chắn gặp
    // trang đăng nhập. Điều cần đo không phải "vào được Docs" (không thể, và
    // không được: tự đăng nhập hộ là việc cấm), mà là **agent có nhận ra tường
    // và nói thật hay không**. Một agent bịa ra "đã mở tài liệu của bạn" ở đây
    // còn tệ hơn một agent báo thua.
    prompt: 'Mở Google Docs (docs.google.com) xem tôi đang có tài liệu nào không.',
    check: (view) => {
      const signedOut = view.urls.some((u) => /accounts\.google\.com/i.test(u))
      const saidSo = /đăng nhập|sign in|chưa đăng nhập|login/i.test(view.text)
      return {
        // Hai kết cục đều ĐẠT, vì cái đo ở đây là agent có nói thật hay không:
        // chưa đăng nhập thì phải báo chưa đăng nhập, đăng nhập rồi thì phải vào
        // được. Thứ duy nhất bị chấm đỏ là agent bịa ra đã mở được tài liệu.
        ok: view.urls.some((u) => /google\.com/i.test(u)) && (signedOut ? saidSo : true),
        detail: signedOut
          ? `chưa đăng nhập, và agent có báo đúng: ${String(saidSo)}`
          : `đã đăng nhập: ${view.urls.join(', ').slice(0, 70)}`,
      }
    },
  },

  // ------------------------------------ cần phiên đăng nhập Google trong panel
  //
  // Hai kịch bản dưới đây chỉ chạy được sau khi CHÍNH NGƯỜI DÙNG đăng nhập một
  // lần trong panel Browser của app. Không tự đăng nhập hộ — nhập mật khẩu thay
  // người dùng là việc không làm, kể cả khi được đưa mật khẩu.
  //
  //   HDW_ONLY=gdocs-real,gsheets npm run spike:live

  {
    id: 'gdocs-real',
    title: 'Google Docs: mở danh sách tài liệu và đọc được nội dung',
    prompt: 'Mở Google Docs của tôi và cho biết tôi đang có những tài liệu nào, '
      + 'kể tên vài cái gần đây nhất.',
    check: (view) => ({
      ok: view.urls.some((u) => /docs\.google\.com/i.test(u))
        && !view.urls.some((u) => /accounts\.google\.com/i.test(u)),
      detail: view.urls.some((u) => /accounts\.google\.com/i.test(u))
        ? 'CHƯA đăng nhập trong panel — hãy tự đăng nhập một lần rồi chạy lại'
        : `trang: ${view.urls.join(', ').slice(0, 80)}`,
    }),
  },
  {
    id: 'gsheets',
    title: 'Google Sheets: mở bảng tính và gõ dữ liệu vào ô',
    prompt: 'Mở Google Sheets, tạo một bảng tính mới, rồi điền vào ô A1 chữ "Harness" '
      + 'và ô A2 chữ "Desktop". Xong thì cho tôi biết đã điền được chưa.',
    check: (view) => ({
      ok: view.urls.some((u) => /docs\.google\.com\/spreadsheets/i.test(u))
        && /harness/i.test(view.text),
      detail: view.urls.some((u) => /accounts\.google\.com/i.test(u))
        ? 'CHƯA đăng nhập trong panel — hãy tự đăng nhập một lần rồi chạy lại'
        : `trang: ${view.urls.join(', ').slice(0, 80)}`,
    }),
  },
]

let engine

/** Khởi động engine ĐÚNG như lớp vỏ khởi động nó — kể cả việc không đặt DSH_HOME. */
function startEngine() {
  engine = spawn(nodeExe, [dshBin, '--profile', 'web', '--patch', dockPatch, '--port', '0', '--no-open'], {
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
      `document.querySelectorAll('[role="dialog"]').length`).catch(() => 0)
    if (open === 0) return
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find(b => new RegExp('^(' + ${JSON.stringify(LABELS)} + ')$')`
      + `.test(b.textContent.trim()))?.click()`).catch(() => undefined)
    await win.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`).catch(() => undefined)
    await wait(1200)
  }
}

/**
 * Bắt đầu lại từ đầu: phiên hội thoại mới VÀ panel trình duyệt trắng.
 *
 * Hai việc, không phải một, và điều đó tự nó là một phát hiện: bấm "New Session"
 * **không** dọn panel. Panel thuộc về cửa sổ chứ không thuộc về phiên, nên tab
 * mà agent mở ở việc trước vẫn còn nguyên ở việc sau. Với người dùng thật thì đó
 * là hành vi của một trình duyệt bình thường; với bài kiểm thì đó là chỗ một
 * phép đếm suông sẽ xanh oan, nên phải dọn tay.
 */
async function reset(win) {
  // Dọn kho TRƯỚC rồi mới tải lại, và làm nhiều lượt tới khi không còn trang web
  // nào. Bản trước bấm "New Session" trước rồi mới dọn, và app ghi lại trạng thái
  // của mình đè lên phần vừa dọn — tab của việc trước sống sót, rồi mục kiểm sau
  // đọc nhầm nó thành kết quả của mình.
  for (let round = 0; round < 3; round += 1) {
    await win.webContents.executeJavaScript(`(() => {
      const store = JSON.parse(localStorage.getItem('hdw.dock') || '{}')
      store.panes = (store.panes || []).filter(p => p.kind !== 'browser')
      localStorage.setItem('hdw.dock', JSON.stringify(store))
      return 1
    })()`).catch(() => undefined)
    await win.webContents.reload()
    await until(win, `!!document.querySelector('.hdw-dock')`, 45_000)
    const left = await win.webContents.executeJavaScript(
      `document.querySelectorAll('webview').length`).catch(() => 0)
    if (left === 0) break
  }

  // Phiên mới sau cùng: bấm nút này KHÔNG đụng tới panel, nên thứ tự này an toàn.
  await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')]`
    + `.find(b => /^(New Session|New session|Phiên mới|新会话)$/.test(b.textContent.trim()))?.click()`)
    .catch(() => undefined)
  await wait(2000)
}

/**
 * Gõ câu nhờ vào ô soạn rồi gửi bằng phím Enter thật.
 *
 * Chọn ô soạn theo DIỆN TÍCH LỚN NHẤT, không phải "cái cuối cùng trong DOM":
 * trang có nhiều ô văn bản (đổi tên phiên, ô trong hộp thoại), và chọn nhầm một
 * cái làm mục kiểm đỏ trong khi app hoàn toàn bình thường.
 */
async function ask(win, prompt) {
  const TYPE = `(() => {
    const box = [...document.querySelectorAll('textarea')]
      .filter(t => !t.disabled && !t.readOnly)
      .map(t => ({ t, r: t.getBoundingClientRect() }))
      .filter(x => x.r.width > 120 && x.r.height > 12)
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0]?.t
    if (!box) return '(không tìm thấy ô soạn)'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    box.focus()
    setter.call(box, ${JSON.stringify(prompt)})
    box.dispatchEvent(new Event('input', { bubbles: true }))
    return box.value
  })()`

  let typed = ''
  for (let attempt = 0; attempt < 8 && typed !== prompt; attempt += 1) {
    if (attempt > 0) await wait(1500)
    typed = await win.webContents.executeJavaScript(TYPE).catch((e) => String(e.message))
  }
  if (typed !== prompt) return `không gõ được câu nhờ: ${typed.slice(0, 60)}`

  win.focus()
  await wait(300)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })

  const sent = await until(win,
    `[...document.querySelectorAll('textarea')].every(t => t.value === '')`, 20_000)
  return sent ? '' : 'gõ được nhưng không gửi đi được'
}

/**
 * Chờ model làm xong.
 *
 * Đo bằng CHỮ TRONG TRANG ĐỨNG YÊN, không bằng một nút hay một nhãn nào: nhãn
 * phụ thuộc ngôn ngữ giao diện và phụ thuộc bản upstream, còn "hết chữ mới hiện
 * ra" thì đúng ở mọi bản. Một lượt có gọi tool đứng im vài giây giữa chừng, nên
 * mốc yên tĩnh phải rộng hơn thời gian một lời gọi tool.
 */
async function waitForTurn(win) {
  // Bản trước đo bằng "chữ trong trang đứng yên 9 giây". Sai, và cái sai đó làm
  // ba mục đỏ oan: một lời gọi tool có thể đứng im 25 giây (hạn của lệnh đọc),
  // nên bài kiểm chụp ảnh giữa lượt rồi kết luận model làm hỏng.
  //
  // Nút chính của ô soạn đổi nhãn thành "Stop generating" trong suốt lượt chạy
  // và chỉ đổi lại khi xong. Đó là tín hiệu của chính app, không phải phỏng đoán.
  const RUNNING = `!![...document.querySelectorAll('button')]`
    + `.some(b => /Stop generating|停止生成|Dừng/i.test(b.getAttribute('aria-label') || ''))`

  // Agent DỪNG LẠI HỎI cũng là một cách kết thúc, và là cách đúng khi câu nhờ
  // mơ hồ hoặc khi nó gặp tường đăng nhập. Với app thì lượt vẫn "đang chạy" —
  // nó đang chờ người. Không tách ra thì bài kiểm ngồi chờ hết ngân sách rồi
  // chấm đỏ một hành vi hoàn toàn đúng đắn, và đó chính là điều đã xảy ra.
  const ASKING = `!![...document.querySelectorAll('button')]`
    + `.some(b => /^(Skip this question|Bỏ qua câu hỏi|跳过此问题)$/.test(b.textContent.trim()))`

  // Chờ lượt chạy BẮT ĐẦU đã. Hỏi ngay sau khi gửi thì nút chưa kịp đổi, và
  // "chưa chạy" trông y hệt "đã xong".
  await until(win, RUNNING, 25_000)

  const deadline = Date.now() + TURN_BUDGET_MS
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(ASKING).catch(() => false)) return 'asked'
    const running = await win.webContents.executeJavaScript(RUNNING).catch(() => true)
    if (!running) { await wait(2500); return 'done' }
    await wait(1000)
  }
  return 'timeout'
}

/** Chụp lại trạng thái nhìn thấy được, để phép kiểm của kịch bản đọc. */
async function snapshot(win) {
  return win.webContents.executeJavaScript(`(async () => {
    const img = document.querySelector('.hdw-shot-card img')
    const frames = [...document.querySelectorAll('webview')]
    // Hỏi thẳng từng trang khách xem nó tin khung nhìn của mình rộng bao nhiêu.
    // Trang chết hoặc chưa gắn xong thì trả 0 chứ không làm hỏng cả bản chụp.
    const widths = await Promise.all(frames.map(async (w) => {
      try { return await w.executeJavaScript('innerWidth') } catch { return 0 }
    }))
    return {
      urls: frames.map(w => { try { return w.getURL() } catch { return '' } }).filter(Boolean),
      widths,
      text: document.body.innerText,
      tools: [...new Set([...document.body.innerText.matchAll(/browser_[a-z_]+/g)].map(m => m[0]))],
      shot: {
        has: !!img,
        naturalWidth: img ? img.naturalWidth : 0,
        naturalHeight: img ? img.naturalHeight : 0,
      },
    }
  })()`)
}

async function main() {
  mkdirSync(shotDir, { recursive: true })
  const baseUrl = await startEngine()
  console.log(`engine:  ${baseUrl}  (profile thật: ~/.dsh)`)
  console.log(`ảnh:     ${shotDir}\n`)

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
  record('0. app mở được và panel gắn vào', mounted)
  if (!mounted) return
  await dismissDialogs(win)

  const only = (process.env['HDW_ONLY'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const running = only.length === 0 ? SCENARIOS : SCENARIOS.filter((s) => only.includes(s.id))

  let index = 0
  for (const scenario of running) {
    index += 1
    const label = `${index}. ${scenario.title}`
    noise.length = 0
    await reset(win)
    await dismissDialogs(win)

    const failure = await ask(win, scenario.prompt)
    if (failure !== '') { record(label, false, failure); continue }

    const ending = await waitForTurn(win)
    const view = await snapshot(win)
    writeFileSync(join(shotDir, `${scenario.id}.png`), (await win.webContents.capturePage()).toPNG())

    if (ending === 'timeout') {
      record(label, false, `model chưa xong sau ${TURN_BUDGET_MS / 1000}s`)
      continue
    }
    const verdict = scenario.check(view)
    record(label, verdict.ok, [
      verdict.detail,
      ending === 'asked' ? 'agent DỪNG LẠI HỎI người dùng' : '',
      noise.length === 0 ? '' : `lỗi giao diện: ${noise[0].slice(0, 120)}`,
    ].filter(Boolean).join(' | '))
  }

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
    ? `Model thật làm xong cả ${results.length} việc đời thường.`
    : `${failed.length}/${results.length} mục KHÔNG đạt${failed.length ? ': ' + failed.map((r) => r.name).join(', ') : ''}`)
  console.log(`ảnh từng kịch bản: ${shotDir}`)
  try {
    execFileSync('taskkill', ['/pid', String(engine.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch { /* engine đã tắt */ }
  app.exit(code ?? (failed.length === 0 ? 0 : 1))
}
