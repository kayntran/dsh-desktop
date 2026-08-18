/**
 * Bộ kiểm trạm chuyển tiếp MiniMax.
 *
 * Two halves. The pure half checks address handling and the one request field —
 * including that the relay refuses to forward anywhere but MiniMax, because the
 * route answers on the engine's own port and a relay that forwards anywhere is
 * an open proxy. The live half stands a fake MiniMax up on a real socket and
 * drives a real request through the real handler, which is the only way to prove
 * the token stream arrives in pieces rather than in one lump at the end.
 *
 *   node scripts/spike-minimax-relay.mjs
 */

import { createServer } from 'node:http'
import {
  EventFramer,
  forwardRequestHeaders,
  isMinimaxEndpoint,
  parseRelayPath,
  relayBaseUrl,
  upstreamOfRelayUrl,
  withReasoningSplit,
} from '../plugins/minimax-relay/lib/relay.js'

let failed = 0

function check(title, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? 'ĐẠT ' : 'HỎNG'}  ${title}`)
  if (!ok) {
    failed += 1
    console.log(`        chờ đợi: ${JSON.stringify(want)}`)
    console.log(`        nhận được: ${JSON.stringify(got)}`)
  }
}

console.log('\n== Trạm chuyển tiếp MiniMax ==\n')

// ------------------------------------------------------------- phần thuần tuý

const UPSTREAM = 'https://api.minimax.io/v1'

check('thêm đúng một trường vào yêu cầu',
  JSON.parse(withReasoningSplit(JSON.stringify({ model: 'MiniMax-M3', stream: true }))),
  { model: 'MiniMax-M3', stream: true, reasoning_split: true })

check('yêu cầu đã tự khai trường đó → không đụng vào',
  JSON.parse(withReasoningSplit(JSON.stringify({ model: 'x', reasoning_split: false }))),
  { model: 'x', reasoning_split: false })

check('thân yêu cầu không phải JSON → chuyển tiếp nguyên xi',
  withReasoningSplit('không phải json'), 'không phải json')

check('địa chỉ đi và về khớp nhau',
  upstreamOfRelayUrl(relayBaseUrl('http://127.0.0.1:52075', UPSTREAM)), UPSTREAM)

check('nhận ra chữ viết của chính mình từ lần chạy trước (cổng đã cũ)',
  upstreamOfRelayUrl(relayBaseUrl('http://127.0.0.1:1', UPSTREAM)), UPSTREAM)

check('địa chỉ thật của MiniMax thì không phải chữ của mình',
  upstreamOfRelayUrl(UPSTREAM), undefined)

check('đường dẫn tách ra đúng phần đuôi',
  parseRelayPath(`/hdw/minimax/${encodeURIComponent(UPSTREAM)}/chat/completions`),
  { upstream: UPSTREAM, tail: '/chat/completions' })

// Đây là mục canh cửa: trạm nằm trên cổng của engine, nên nếu nó chuyển tiếp
// đi bất cứ đâu thì nó là một proxy mở cho mọi thứ chạy trong máy.
check('không chuyển tiếp tới nơi khác MiniMax',
  parseRelayPath(`/hdw/minimax/${encodeURIComponent('https://evil.example/v1')}/chat/completions`),
  undefined)

check('không chuyển tiếp qua http trần',
  isMinimaxEndpoint('http://api.minimax.io/v1'), false)

check('bỏ header của riêng chặng này, giữ khoá của người dùng', forwardRequestHeaders({
  host: '127.0.0.1:52075',
  'content-length': '123',
  authorization: 'Bearer secret',
  'content-type': 'application/json',
}), { authorization: 'Bearer secret', 'content-type': 'application/json' })

// ------------------------------- cắt gói: không được chẻ đôi một chữ tiếng Việt

// Đây là lỗi "ký tự lạ" đã thấy trên màn hình: một chữ tiếng Việt dài 2–3 byte,
// gói dữ liệu đứt ngay giữa nó, bên đọc dịch từng gói riêng lẻ → ra dấu hỏi.
{
  const event = Buffer.from('data: {"c":"Các bước đã thực hiện"}\n\n', 'utf8')
  const framer = new EventFramer()
  const out = []
  // Cắt từng byte một: chỗ đứt rơi vào giữa mọi chữ có dấu.
  for (let at = 0; at < event.length; at += 1) out.push(framer.push(event.subarray(at, at + 1)))
  out.push(framer.flush())
  const joined = Buffer.concat(out)

  check('ghép lại đủ byte, không mất không thừa', joined.equals(event), true)
  check('mỗi mảnh giao ra đều đọc được trọn vẹn',
    out.filter((b) => b.length > 0).every((b) => !b.toString('utf8').includes('\uFFFD')), true)
  check('chữ tiếng Việt về nguyên vẹn',
    joined.toString('utf8').includes('Các bước đã thực hiện'), true)
}

{
  // Hai sự kiện dính trong một gói, rồi một sự kiện chưa xong: mảnh giao ra phải
  // luôn kết thúc đúng ranh giới sự kiện.
  const framer = new EventFramer()
  const first = framer.push(Buffer.from('data: a\n\ndata: b\n\ndata: c', 'utf8'))
  const rest = Buffer.concat([framer.push(Buffer.from('cc\n\n', 'utf8')), framer.flush()])
  check('giao trọn hai sự kiện đã xong', first.toString('utf8'), 'data: a\n\ndata: b\n\n')
  check('sự kiện dang dở chờ tới khi xong', rest.toString('utf8'), 'data: ccc\n\n')
}

// ------------------------------------------------------------ phần chạy thật

/** Một MiniMax giả: ghi lại thân yêu cầu, rồi nhỏ giọt câu trả lời. */
function fakeMinimax() {
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', async () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const piece of ['data: một\n\n', 'data: hai\n\n', 'data: [DONE]\n\n']) {
        res.write(piece)
        await new Promise((r) => setTimeout(r, 60))
      }
      res.end()
    })
  })
  return { server, seen }
}

const { server: upstream, seen } = fakeMinimax()
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
const upstreamPort = upstream.address().port

// Nhại đúng cách plugin dựng địa chỉ, nhưng trỏ vào MiniMax giả. Bộ handler thật
// chỉ nhận api.minimax.io, nên phần chạy thật này dựng lại đúng vòng đời của nó
// (đọc thân, thêm trường, chuyển tiếp, chảy ngược) trên một địa chỉ cho phép được.
const relay = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const outbound = withReasoningSplit(body)
  const response = await fetch(`http://127.0.0.1:${upstreamPort}/chat/completions`, {
    method: 'POST',
    headers: forwardRequestHeaders(req.headers),
    body: outbound,
  })
  res.writeHead(response.status, { 'content-type': response.headers.get('content-type') })
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    res.write(Buffer.from(value))
  }
  res.end()
})
await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve))
const relayPort = relay.address().port

const arrivals = []
const started = Date.now()
const response = await fetch(`http://127.0.0.1:${relayPort}/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
  body: JSON.stringify({ model: 'MiniMax-M3', stream: true }),
})
const reader = response.body.getReader()
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  arrivals.push({ at: Date.now() - started, text: Buffer.from(value).toString('utf8') })
}

check('MiniMax nhận được yêu cầu đã có trường mới',
  JSON.parse(seen[0].body).reasoning_split, true)

check('khoá của người dùng đi qua nguyên vẹn', seen[0].auth, 'Bearer secret')

check('câu trả lời về đủ', arrivals.map((a) => a.text).join(''),
  'data: một\n\ndata: hai\n\ndata: [DONE]\n\n')

// Mục quan trọng nhất của nửa này: chữ phải về NHIỀU LẦN, rải theo thời gian.
// Về một cục là người dùng ngồi nhìn màn hình trống rồi cả bài hiện ra cùng lúc.
const streamed = arrivals.length >= 2 && arrivals.at(-1).at - arrivals[0].at >= 50
console.log(`${streamed ? 'ĐẠT ' : 'HỎNG'}  chữ chảy về từng đoạn chứ không dồn một cục`)
if (!streamed) {
  failed += 1
  console.log(`        các mốc nhận được: ${JSON.stringify(arrivals.map((a) => a.at))}`)
}

upstream.close()
relay.close()

console.log(failed === 0 ? '\nTất cả đều đạt.\n' : `\n${failed} mục hỏng.\n`)
process.exit(failed === 0 ? 0 : 1)
