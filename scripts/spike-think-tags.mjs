/**
 * Bộ kiểm bộ lọc thẻ <think>.
 *
 * Runs the rewriter over hand-built streams shaped like the ones real providers
 * send, then checks two things for every case: the assistant message the app
 * would show, and that the rewritten stream still obeys the engine's own stream
 * grammar (`packages/llm/llm/src/invariant.ts`). The second check is the one
 * that matters — a stream that violates it takes the whole answer down with an
 * invariant failure rather than a wrong-looking reply.
 *
 *   node scripts/spike-think-tags.mjs
 */

import { rewriteThinkTags } from '../plugins/think-tags/lib/index.js'

let failed = 0

/** Feed an array of chunks through the rewriter. */
async function run(chunks) {
  const out = []
  for await (const chunk of rewriteThinkTags((async function* () { yield* chunks })())) {
    out.push(chunk)
  }
  return out
}

/** Rebuild the assistant message the way the engine's assembler does. */
function assemble(chunks) {
  const order = []
  const partials = new Map()
  const ensure = (index, type) => {
    let partial = partials.get(index)
    if (!partial) { partial = { type, text: '' }; partials.set(index, partial); order.push(index) }
    return partial
  }
  for (const chunk of chunks) {
    if (chunk.type === 'block-start') ensure(chunk.index, chunk.blockType)
    else if (chunk.type === 'text-delta') ensure(chunk.index, 'text').text += chunk.text
    else if (chunk.type === 'reasoning-delta') ensure(chunk.index, 'reasoning').text += chunk.text
    else if (chunk.type === 'tool-call-delta') ensure(chunk.index, 'tool-call').text += chunk.argumentsDelta
  }
  return order.map((index) => {
    const partial = partials.get(index)
    return { type: partial.type, text: partial.text }
  })
}

/** The engine's stream grammar, transcribed from upstream's invariant module. */
function grammarErrors(chunks) {
  const open = new Map()
  const problems = []
  let usageSeen = false
  let finished = false
  const seen = new Set()
  for (const chunk of chunks) {
    if (finished) problems.push(`chunk ${chunk.type} sau finish`)
    if (chunk.type === 'block-start') {
      if (seen.has(chunk.index)) problems.push(`block-start lặp lại chỉ số ${chunk.index}`)
      seen.add(chunk.index)
      open.set(chunk.index, chunk.blockType)
    } else if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta') {
      const want = chunk.type === 'text-delta' ? 'text' : chunk.type === 'reasoning-delta' ? 'reasoning' : 'tool-call'
      if (open.get(chunk.index) !== want) problems.push(`${chunk.type} ở chỉ số ${chunk.index} không có khối ${want} đang mở`)
    } else if (chunk.type === 'block-end') {
      const type = open.get(chunk.index)
      if (type === undefined) problems.push(`block-end ở chỉ số ${chunk.index} không có khối nào đang mở`)
      else if (chunk.block.type !== type) problems.push(`block-end ở chỉ số ${chunk.index} đóng ${chunk.block.type}, đang mở ${type}`)
      open.delete(chunk.index)
    } else if (chunk.type === 'usage') {
      if (usageSeen) problems.push('usage xuất hiện hai lần')
      usageSeen = true
    } else if (chunk.type === 'finish') {
      if (open.size > 0) problems.push(`finish khi còn ${open.size} khối chưa đóng`)
      finished = true
    }
  }
  if (!finished) problems.push('dòng kết thúc mà không có chunk finish')
  return problems
}

/** One check: run the stream, compare the message, and always check the grammar. */
async function check(title, chunks, expected) {
  const out = await run(chunks)
  const blocks = assemble(out)
  const problems = grammarErrors(out)

  const got = JSON.stringify(blocks)
  const want = JSON.stringify(expected)
  const ok = got === want && problems.length === 0

  console.log(`${ok ? 'ĐẠT ' : 'HỎNG'}  ${title}`)
  if (!ok) {
    failed += 1
    if (got !== want) {
      console.log(`        chờ đợi: ${want}`)
      console.log(`        nhận được: ${got}`)
    }
    for (const problem of problems) console.log(`        sai ngữ pháp dòng: ${problem}`)
  }
  return out
}

// ------------------------------------------------------------------ dữ liệu

const START_TEXT = { type: 'block-start', index: 0, blockType: 'text' }
const END_TEXT = (index, text) => ({ type: 'block-end', index, block: { type: 'text', text } })
const FINISH = { type: 'finish', reason: { kind: 'stop' } }

/** Cắt một chuỗi thành các delta nhỏ, để tag bị chẻ giữa hai chunk. */
function deltas(index, text, size) {
  const out = []
  for (let at = 0; at < text.length; at += size) {
    out.push({ type: 'text-delta', index, text: text.slice(at, at + size) })
  }
  return out
}

const THINKING = 'The user asks which model I am. Answer briefly.'
const ANSWER = 'Mình là MiniMax-M3.'
const TAGGED = `<think>${THINKING}</think>\n\n${ANSWER}`

console.log('\n== Bộ lọc thẻ <think> ==\n')

// 1 — MiniMax: cả phần nghĩ lẫn câu trả lời đi chung một dòng chữ.
await check(
  'thẻ <think> mở đầu câu trả lời → tách ra thành ô Think',
  [START_TEXT, ...deltas(0, TAGGED, 7), END_TEXT(0, TAGGED), FINISH],
  [{ type: 'reasoning', text: THINKING }, { type: 'text', text: ANSWER }],
)

// 2 — cắt từng ký tự một: thẻ bị chẻ ở mọi vị trí có thể.
await check(
  'thẻ bị chẻ vụn qua từng chunk một ký tự',
  [START_TEXT, ...deltas(0, TAGGED, 1), END_TEXT(0, TAGGED), FINISH],
  [{ type: 'reasoning', text: THINKING }, { type: 'text', text: ANSWER }],
)

// 3 — đúng hình dạng trong ảnh chụp màn hình: nhà cung cấp gửi phần nghĩ HAI lần,
//     một lần trong thẻ, một lần ở trường riêng đến sau.
await check(
  'phần nghĩ gửi hai lần → chỉ còn một ô Think',
  [
    START_TEXT, ...deltas(0, TAGGED, 11), END_TEXT(0, TAGGED),
    { type: 'block-start', index: 1, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 1, text: THINKING },
    { type: 'block-end', index: 1, block: { type: 'reasoning', text: THINKING } },
    FINISH,
  ],
  [{ type: 'reasoning', text: THINKING }, { type: 'text', text: ANSWER }],
)

// 4 — chiều ngược lại: trường riêng đến trước, thẻ lặp lại đến sau.
await check(
  'trường riêng đến trước, thẻ lặp lại sau → thẻ bị bỏ',
  [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: THINKING },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: THINKING } },
    { type: 'block-start', index: 1, blockType: 'text' },
    ...deltas(1, TAGGED, 13),
    END_TEXT(1, TAGGED),
    FINISH,
  ],
  [{ type: 'reasoning', text: THINKING }, { type: 'text', text: ANSWER }],
)

// 5 — model cư xử đúng chuẩn (DeepSeek): không có thẻ nào, không được đụng vào.
await check(
  'model gửi đúng chuẩn → dòng chữ giữ nguyên',
  [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'nghĩ một chút' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'nghĩ một chút' } },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text: 'Chào bạn.' },
    END_TEXT(1, 'Chào bạn.'),
    FINISH,
  ],
  [{ type: 'reasoning', text: 'nghĩ một chút' }, { type: 'text', text: 'Chào bạn.' }],
)

// 6 — thẻ nằm GIỮA câu trả lời là chữ thật, không phải phần nghĩ.
{
  const quoted = 'Thẻ <think>ví dụ</think> dùng để bọc phần suy nghĩ.'
  await check(
    'thẻ nằm giữa câu trả lời → giữ nguyên là chữ',
    [START_TEXT, ...deltas(0, quoted, 5), END_TEXT(0, quoted), FINISH],
    [{ type: 'text', text: quoted }],
  )
}

// 7 — gọi tool đi kèm: khối tool phải qua nguyên vẹn.
await check(
  'thẻ <think> đứng cạnh một lời gọi tool',
  [
    START_TEXT, ...deltas(0, TAGGED, 9), END_TEXT(0, TAGGED),
    { type: 'block-start', index: 5, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 5, id: 'call-1', name: 'read', argumentsDelta: '{"path":"a"}' },
    { type: 'block-end', index: 5, block: { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"a"}' } },
    FINISH,
  ],
  [
    { type: 'reasoning', text: THINKING },
    { type: 'text', text: ANSWER },
    { type: 'tool-call', text: '{"path":"a"}' },
  ],
)

// 8 — câu trả lời bị cắt giữa chừng khi đang nghĩ: vẫn phải ra một dòng hợp lệ.
await check(
  'bị ngắt giữa chừng khi đang nghĩ → khối vẫn được đóng',
  [
    START_TEXT,
    { type: 'text-delta', index: 0, text: '<think>đang nghĩ dở' },
    { type: 'finish', reason: { kind: 'aborted' } },
  ],
  [{ type: 'reasoning', text: 'đang nghĩ dở' }],
)

// 9 — hình dạng MỚI, sau khi có trạm chuyển tiếp: MiniMax gửi phần nghĩ ở
//     trường riêng nhưng vẫn để rơi thẻ ĐÓNG vào câu trả lời.
{
  const leaked = `</think>

Xong rồi nhé.`
  await check(
    'thẻ đóng lạc lõng đầu câu trả lời → bỏ đi',
    [START_TEXT, ...deltas(0, leaked, 4), END_TEXT(0, leaked), FINISH],
    [{ type: 'text', text: 'Xong rồi nhé.' }],
  )
}

// 10 — biến thể có tên miền: </mm:think>.
{
  const leaked = `</mm:think>

Xong rồi nhé.`
  await check(
    'biến thể </mm:think> cũng bị bỏ',
    [START_TEXT, ...deltas(0, leaked, 3), END_TEXT(0, leaked), FINISH],
    [{ type: 'text', text: 'Xong rồi nhé.' }],
  )
}

// 11 — bước chỉ có mỗi thẻ đóng, không còn chữ nào: không được để lại khối rỗng.
await check(
  'bước chỉ có mỗi thẻ đóng → không còn khối nào',
  [START_TEXT, ...deltas(0, '</think>', 2), END_TEXT(0, '</think>'), FINISH],
  [],
)

// 12 — cặp thẻ đầy đủ theo lối có tên miền.
{
  const tagged = `<mm:think>${THINKING}</mm:think>

${ANSWER}`
  await check(
    'cặp <mm:think> đầy đủ → tách như thường',
    [START_TEXT, ...deltas(0, tagged, 5), END_TEXT(0, tagged), FINISH],
    [{ type: 'reasoning', text: THINKING }, { type: 'text', text: ANSWER }],
  )
}

// 13 — thẻ đóng nằm GIỮA câu trả lời vẫn là chữ thật.
{
  const quoted = 'Thẻ đóng viết là </think> nhé.'
  await check(
    'thẻ đóng nằm giữa câu trả lời → giữ nguyên',
    [START_TEXT, ...deltas(0, quoted, 6), END_TEXT(0, quoted), FINISH],
    [{ type: 'text', text: quoted }],
  )
}

// ------------------------------------------------- trạng thái phát lại (replay)

/** So sánh trạng thái phát lại ở chunk cuối với thứ mong đợi. */
async function checkReplay(title, chunks, expected) {
  const out = await run(chunks)
  const got = out.at(-1).replayState
  const ok = JSON.stringify(got) === JSON.stringify(expected)
  console.log(`${ok ? 'ĐẠT ' : 'HỎNG'}  ${title}`)
  if (!ok) {
    failed += 1
    console.log(`        chờ đợi: ${JSON.stringify(expected)}`)
    console.log(`        nhận được: ${JSON.stringify(got)}`)
  }
}

const TEXT_ENTRY = { type: 'text', textSignature: 'sig' }
const replay = (blocks) => ({ version: 1, provider: 'minimax', model: 'MiniMax-M3', blocks })

console.log()

await checkReplay(
  'không có thẻ → trạng thái phát lại giữ nguyên',
  [
    START_TEXT, { type: 'text-delta', index: 0, text: 'Chào bạn.' }, END_TEXT(0, 'Chào bạn.'),
    { type: 'finish', reason: { kind: 'stop' }, replayState: replay([TEXT_ENTRY]) },
  ],
  replay([TEXT_ENTRY]),
)

// Có sửa thì bỏ hẳn: bản ghi tự đối chiếu từng mục với các khối, mà ta vừa đổi
// các khối. Giữ lại là lượt sau lỗi. Trạm chuyển tiếp mới là chỗ chữa việc này.
await checkReplay(
  'có tách thẻ → bỏ trạng thái phát lại',
  [
    START_TEXT, ...deltas(0, TAGGED, 6), END_TEXT(0, TAGGED),
    { type: 'finish', reason: { kind: 'stop' }, replayState: replay([TEXT_ENTRY]) },
  ],
  undefined,
)

console.log(failed === 0 ? '\nTất cả đều đạt.\n' : `\n${failed} mục hỏng.\n`)
process.exit(failed === 0 ? 0 : 1)
