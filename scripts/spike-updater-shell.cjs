/**
 * Nghiệm thu VÒNG ĐỜI của phần cập nhật ở lớp vỏ.
 *
 * Bộ `spike:updater` gác nửa người dùng nhìn thấy. Bộ này gác nửa còn lại, và gác đúng
 * một câu hỏi: **bật rồi tắt nhiều lần thì có sạch không.** Câu hỏi đó không vu vơ —
 * engine bị khởi động lại là chuyện thường ngày (mỗi lần cài một plugin từ chợ là một
 * lần, nút Retry ở màn hình lỗi cũng vậy), và mỗi lần như thế `startUpdater` chạy lại.
 *
 * Hai thứ từng rò rỉ ở đó, cả hai đều không hiện ra dưới dạng lỗi:
 *
 *   1. Bộ lắng nghe sự kiện của `autoUpdater` được gắn thêm một bộ mới sau mỗi lần
 *      khởi động lại, không bao giờ gỡ. Ba lần khởi động lại là mỗi nhịp tiến độ tải
 *      bắn bốn lần; quá mười lần thì Node in cảnh báo tràn listener vào nhật ký,
 *      trông y như lỗi của app.
 *   2. Hẹn giờ kiểm tra lần đầu nằm trong một biến cục bộ nên `stopUpdater` không
 *      huỷ được: một phút là đủ dài để engine kịp khởi động lại bên trong nó.
 *
 * Không cần engine thật: dựng một máy chủ tí hon nói đúng hai route mà lớp vỏ gọi.
 *
 *   npm run spike:updater-shell
 */

if (process.env['ELECTRON_RUN_AS_NODE'] !== undefined) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  const child = spawnSync(process.execPath, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env })
  process.exit(child.status ?? 1)
}

const { app } = require('electron')
const { createServer } = require('node:http')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const root = join(__dirname, '..')

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Số lần lớp vỏ đã báo trạng thái lên. */
let posts = 0

/**
 * Máy chủ tí hon đóng vai nửa Node của plugin.
 * @returns {Promise<string>} địa chỉ gốc của nó.
 */
function startFakeEngine() {
  const server = createServer((req, res) => {
    if (req.url === '/hdw/update/state') {
      posts += 1
      req.resume()
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"stored":true}')
      })
      return
    }
    if (req.url === '/hdw/update/wait') {
      // Trả lời "chưa có gì" sau một nhịp ngắn, đúng hình dạng route thật.
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"command":null}')
      }, 300)
      return
    }
    res.writeHead(404)
    res.end()
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` })
    })
  })
}

async function main() {
  const fake = await startFakeEngine()
  console.log(`may chu gia tai ${fake.url}\n`)

  const updater = await import(pathToFileURL(join(root, 'dist', 'main', 'updater.js')).href)
  const { autoUpdater } = require('electron-updater')

  const EVENTS = ['update-available', 'update-not-available', 'download-progress', 'update-downloaded', 'error']

  // --- 1. bật/tắt ba lần: số bộ lắng nghe KHÔNG được tăng
  //
  // Mục quyết định. Ba lần bật/tắt mô phỏng ba lần cài plugin từ chợ.
  //
  // Đo phần MÌNH thêm vào, không đo tổng: `electron-updater` tự gắn sẵn một bộ lắng
  // nghe `error` của riêng nó ngay khi được nạp, nên một phép đo tuyệt đối sẽ đỏ oan
  // ở đúng một sự kiện và xanh ở bốn cái còn lại — thứ nhiễu khiến người đọc kết luận
  // sai rằng bộ kiểm mới là cái hỏng.
  const baseline = Object.fromEntries(EVENTS.map((name) => [name, autoUpdater.listenerCount(name)]))
  for (let round = 0; round < 3; round += 1) {
    updater.startUpdater(fake.url, () => {})
    await sleep(400)
    updater.stopUpdater()
    await sleep(100)
  }
  const added = Object.fromEntries(EVENTS.map((name) => [name, autoUpdater.listenerCount(name) - baseline[name]]))
  const maxAdded = Math.max(...Object.values(added))
  record('1. bat/tat ba lan: bo lang nghe khong nhan ban',
    maxAdded === 1,
    `so bo tu gan them: ${JSON.stringify(added)} (nen tang cua electron-updater: ${JSON.stringify(baseline)})`)

  // --- 2. đã tắt thì im: một sự kiện đến muộn không được báo đi đâu cả
  //
  // Đây là cái lưới chung cho mọi thứ có thể sống sót qua lệnh tắt — hẹn giờ mồ côi,
  // một lượt tải đang dở, một sự kiện đang trên đường. Nếu `report` không kiểm cờ
  // đang chạy, con số dưới đây sẽ nhích lên.
  const before = posts
  autoUpdater.emit('update-not-available', { version: '9.9.9' })
  autoUpdater.emit('download-progress', { percent: 50 })
  await sleep(500)
  record('2. da tat thi im: su kien den muon khong bao di dau',
    posts === before,
    `so lan bao truoc ${before}, sau ${posts}`)

  // --- 3. bật lại thì nói lại được
  //
  // Kiểm ngược của mục 2: cái cờ kia phải TẮT tiếng, không phải làm câm vĩnh viễn.
  const beforeRestart = posts
  updater.startUpdater(fake.url, () => {})
  await sleep(500)
  const spokeAgain = posts > beforeRestart
  updater.stopUpdater()
  record('3. bat lai thi noi lai duoc', spokeAgain, `so lan bao ${beforeRestart} -> ${posts}`)

  fake.server.close()

  console.log('\n=== KẾT QUẢ ===')
  const failed = results.filter((r) => !r.ok)
  if (failed.length === 0) console.log('Tất cả đạt. Bật rồi tắt nhiều lần vẫn sạch.')
  else console.log(`${failed.length}/${results.length} mục KHÔNG đạt: ${failed.map((r) => r.name).join(', ')}`)
}

app.whenReady().then(main).catch((error) => {
  record('spike chạy tới cuối', false, error.stack ?? String(error))
}).finally(() => { app.quit() })
