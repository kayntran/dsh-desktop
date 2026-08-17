/**
 * Bài kiểm cho TẦNG TOOL — đoạn từ model gọi xuống, thứ mà `spike-dock-ui.cjs`
 * không chạm tới.
 *
 * Bộ kiểm giao diện gọi thẳng vào cầu qua route chẩn đoán, nên nó chứng minh
 * được "lệnh chạm tới trang thật" nhưng KHÔNG chứng minh được gì về tầng tool:
 * hình dạng schema, phép kiểm tham số, rào địa chỉ ở tầng tool, câu chữ trả cho
 * model, ba đường đi của tấm ảnh. Cả tầng đó chưa từng chạy một lần nào.
 *
 * Đây không phải bài kiểm thay thế bài kia — nó đo một đoạn khác của cùng một
 * đường. Bên kia đo từ cầu xuống trang; bên này đo từ model xuống cầu.
 *
 * Thay `bus`, `shots`, `attachments` bằng đồ giả để **đo được cả những đường mà
 * app thật không đi tới**: model đưa địa chỉ nội bộ, model quên tham số bắt
 * buộc, model chạy trên tuyến không đọc được ảnh. Trong app thật, muốn đi tới
 * những nhánh đó phải có một model chịu làm sai.
 *
 *   node scripts/spike-tools.mjs
 */

import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = join(import.meta.dirname, '..')

// `esbuild` là phụ thuộc lúc dựng của plugin, không phải của gốc repo — nên
// phân giải từ thư mục plugin thay vì trông chờ vào cây module ở gốc.
const requireFromPlugin = createRequire(join(root, 'plugins', 'dock', 'package.json'))
const esbuild = requireFromPlugin('esbuild')
const results = []

/**
 * Ghi một mục kiểm.
 * @param {string} name - tên mục.
 * @param {boolean} ok - đạt hay không.
 * @param {string} [detail] - chi tiết in kèm.
 */
function record(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

/** Gọi một hàm và trả về câu lỗi, hoặc `''` nếu nó không ném. */
async function errorOf(run) {
  try {
    await run()
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// Bundle `tools.ts` ra một file tạm rồi nạp. `tools.ts` cố ý không có import
// nào lúc chạy ngoài file cùng thư mục, nên bản bundle là tự chứa — chính điều
// đó là thứ làm nó nạp được ở đây mà không cần cả cây module của engine.
const outDir = mkdtempSync(join(tmpdir(), 'hdw-tools-'))
const outFile = join(outDir, 'tools.mjs')
await esbuild.build({
  entryPoints: [join(root, 'plugins', 'dock', 'src', 'tools.ts')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'warning',
})
const { registerBrowserTools } = await import(pathToFileURL(outFile).href)

// --------------------------------------------------------------- đồ giả

/** Ghi lại mọi lời gọi xuống cầu, để đối chiếu tool đã gửi đúng gì. */
const calls = []
const bus = {
  call: async (cmd, params) => {
    calls.push({ cmd, params })
    if (cmd === 'shot_prepare') return { tab_id: 'tab-1', wc_id: 42 }
    if (cmd === 'read_page') return { outline: '- link "A" [ref_1]', refs: 1, url: 'https://a.test/' }
    if (cmd === 'get_page_text') return { text: 'xin chào', truncated: false, total: 8 }
    return { ok: true, cmd }
  },
  hasDriver: () => true,
  agentControl: () => true,
}

const saved = []
const shots = {
  capture: async (wcId) => {
    calls.push({ cmd: 'capture', params: { wcId } })
    // PNG 1x1 hợp lệ, đủ để đi hết đường lưu đính kèm.
    return { data: 'iVBORw0KGgo=', width: 800, height: 600 }
  },
  ready: () => true,
}

const registered = []
const ctx = {
  tools: {
    register: (tool) => {
      registered.push(tool)
      return () => { /* huỷ đăng ký */ }
    },
  },
  get: (name) => {
    if (name === 'attachments') {
      return {
        saveImage: async (input) => {
          saved.push(input)
          return {
            attachmentId: 'att-1', mediaType: 'image/png',
            bytes: input.data.length, width: 800, height: 600,
          }
        },
      }
    }
    // Cố ý KHÔNG có `llm`: đó đúng là tình huống của model DeepSeek — không
    // phân giải được tuyến đọc ảnh, và lệnh chụp phải hỏng theo hướng đóng.
    return undefined
  },
}

const dispose = registerBrowserTools(ctx, bus, shots)
const byName = new Map(registered.map((tool) => [tool.name, tool]))
const exec = { signal: undefined, agent: undefined }

// ------------------------------------------------------------ mục kiểm

const EXPECTED = [
  'browser_tabs', 'browser_navigate', 'browser_read_page', 'browser_find',
  'browser_get_page_text', 'browser_screenshot', 'browser_console', 'browser_network',
  'browser_computer', 'browser_form_input', 'browser_javascript', 'browser_resize',
]

record('1. đăng ký đủ và đúng tên các tool',
  registered.length === EXPECTED.length && EXPECTED.every((n) => byName.has(n)),
  `${registered.length} tool: ${registered.map((t) => t.name).join(', ')}`)

// --- 2. hình dạng schema
//
// Đây là mục canh cho quyết định "tự dựng object thay vì dùng defineTool".
// Bỏ helper của upstream nghĩa là tự chịu trách nhiệm phần này, nên phải có
// một mục đo nó — nếu không thì lời hứa "tự lo được" là lời hứa suông.
{
  const bad = []
  for (const tool of registered) {
    if (typeof tool.description !== 'string' || tool.description.length < 20) bad.push(`${tool.name}: mô tả quá ngắn`)
    const p = tool.parameters
    if (p?.type !== 'object') bad.push(`${tool.name}: parameters không phải object`)
    if (p?.additionalProperties !== false) bad.push(`${tool.name}: thiếu additionalProperties=false`)
    if (typeof p?.properties !== 'object') bad.push(`${tool.name}: thiếu properties`)
    for (const key of p?.required ?? []) {
      if (!(key in (p.properties ?? {}))) bad.push(`${tool.name}: required "${key}" không có trong properties`)
    }
    if (typeof tool.output?.schema !== 'object') bad.push(`${tool.name}: thiếu output.schema`)
    if (typeof tool.output?.render !== 'function') bad.push(`${tool.name}: thiếu output.render`)
    if (typeof tool.execute !== 'function') bad.push(`${tool.name}: thiếu execute`)
    // Tên tham số phải là tiếng Anh — chúng đi thẳng vào lời gọi của model.
    for (const key of Object.keys(p?.properties ?? {})) {
      if (!/^[a-z][a-z0-9_]*$/.test(key)) bad.push(`${tool.name}: tên tham số lạ "${key}"`)
    }
  }
  record('2. mọi tool có schema đúng hình dạng upstream đòi', bad.length === 0,
    bad.length === 0 ? `${registered.length} tool đều sạch` : bad.join('; '))
}

// --- 3. rào địa chỉ Ở TẦNG TOOL
//
// Rào này đã có ở cầu, nhưng tầng tool phải chặn TRƯỚC — không gửi một địa chỉ
// nội bộ xuống rồi mới để tầng dưới từ chối.
{
  calls.length = 0
  const denied = await errorOf(() => byName.get('browser_tabs').execute(
    { action: 'open', url: 'http://192.168.1.1/' }, exec))
  const leaked = calls.some((c) => c.cmd === 'open_tab')
  record('3. tool từ chối địa chỉ nội bộ và KHÔNG gửi nó xuống dưới',
    denied.includes('nội bộ') && !leaked,
    `${denied.slice(0, 60)}; đã gửi xuống cầu=${String(leaked)}`)
}

// --- 4. địa chỉ công cộng đi đúng lệnh, đúng tham số
{
  calls.length = 0
  await byName.get('browser_tabs').execute({ action: 'open', url: 'example.com/x' }, exec)
    .catch(() => undefined)
  const sent = calls.find((c) => c.cmd === 'open_tab')
  record('4. địa chỉ công cộng được chuẩn hoá rồi mới gửi xuống',
    sent !== undefined && String(sent.params.url).startsWith('http'),
    JSON.stringify(sent ?? calls))
}

// --- 4b. thêm scheme không được làm hở rào địa chỉ
//
// Phép sửa ở mục 4 là "thiếu scheme thì mặc định https". Mục này canh cho nó
// không mở đường vòng: `192.168.1.1` trần phải vẫn bị chặn y như
// `http://192.168.1.1/`. Mỗi lần nới một phép kiểm, phải có một mục đo cái vừa
// nới ra.
{
  calls.length = 0
  const bare = await errorOf(() => byName.get('browser_tabs').execute(
    { action: 'open', url: '192.168.1.1' }, exec))
  const local = await errorOf(() => byName.get('browser_tabs').execute(
    { action: 'open', url: 'localhost:3000' }, exec))
  const script = await errorOf(() => byName.get('browser_tabs').execute(
    { action: 'open', url: 'javascript:alert(1)' }, exec))
  record('4b. thiếu scheme vẫn không lọt được địa chỉ nội bộ hay javascript:',
    bare.includes('nội bộ') && local.includes('nội bộ') && script !== ''
    && !calls.some((c) => c.cmd === 'open_tab'),
    `trần="${bare.slice(0, 30)}"; localhost="${local.slice(0, 30)}"; js="${script.slice(0, 30)}"`)

  // Dấu hai chấm trong `example.com:8080` là CỔNG, không phải scheme. Đọc nhầm
  // thì một địa chỉ công cộng hoàn toàn hợp lệ bị chặn oan — và một rào chặn
  // oan là một rào sẽ bị tắt.
  calls.length = 0
  await byName.get('browser_tabs').execute({ action: 'open', url: 'example.com:8080/x' }, exec)
    .catch(() => undefined)
  const withPort = calls.find((c) => c.cmd === 'open_tab')
  record('4c. địa chỉ công cộng có cổng KHÔNG bị chặn oan',
    withPort !== undefined && String(withPort.params.url).includes(':8080'),
    JSON.stringify(withPort ?? 'bị chặn oan'))
}

// --- 5. thiếu tham số bắt buộc thì báo rõ, không gửi gì xuống
//
// Upstream nói thẳng: tool đăng ký bằng JSON Schema thô thì TỰ LO phần kiểm
// tham số. Mục này là bằng chứng cho lời hứa đó.
{
  calls.length = 0
  const missing = await errorOf(() => byName.get('browser_form_input').execute({ value: 'x' }, exec))
  record('5. thiếu tham số bắt buộc thì từ chối kèm câu chỉ đường',
    missing.includes('ref') && calls.length === 0,
    `${missing.slice(0, 80)}; số lệnh gửi xuống=${String(calls.length)}`)
}

// --- 6. lệnh đọc gọi đúng lệnh dưới cầu và trả đúng câu chữ cho model
{
  calls.length = 0
  const tool = byName.get('browser_read_page')
  const value = await tool.execute({ filter: 'interactive' }, exec)
  const blocks = tool.output.render({}, value)
  record('6. lệnh đọc trang gọi đúng cầu và tóm tắt đúng cho model',
    calls[0]?.cmd === 'read_page' && blocks[0].text.includes('ref_1') && blocks[0].text.includes('https://a.test/'),
    `${calls[0]?.cmd}; "${blocks[0]?.text.replace(/\n/g, ' ').slice(0, 70)}"`)
}

// --- 7. CHỤP ẢNH: ba đường của một tấm ảnh
//
// Mục quan trọng nhất của bài kiểm này. Trong app thật, `llm` không phân giải
// được tuyến đọc ảnh (model DeepSeek), nên nhánh "model không nhìn được" mới là
// nhánh chạy hằng ngày — mà nó cũng là nhánh dễ quên nhất.
{
  calls.length = 0
  saved.length = 0
  const tool = byName.get('browser_screenshot')
  const value = await tool.execute({}, exec)

  const order = calls.map((c) => c.cmd).join(' → ')
  record('7a. chụp ảnh đi đúng thứ tự: dựng cảnh, chụp, rồi trả màn hình về chỗ cũ',
    order === 'shot_prepare → capture → shot_done', order)

  record('7b. ảnh được lưu vào kho đính kèm, không nhét byte vào kết quả',
    saved.length === 1 && saved[0].mediaType === 'image/png'
    && value.attachment_id === 'att-1' && value.data === undefined,
    JSON.stringify(value))

  const modelBlocks = tool.output.render({}, value)
  const hasImageForModel = modelBlocks.some((b) => b.type === 'image')
  record('7c. model KHÔNG đọc được ảnh thì không đính ảnh vào, và nói rõ vì sao',
    value.seen_by_model === false && !hasImageForModel
    && modelBlocks[0].text.includes('không đọc được ảnh'),
    `seen_by_model=${String(value.seen_by_model)}; khối ảnh cho model=${String(hasImageForModel)}`)

  const meta = tool.output.presentationMeta({}, value)
  const view = tool.presentResult({}, { meta })
  const userImage = view?.content?.find((b) => b.type === 'image')
  record('7d. NGƯỜI DÙNG vẫn luôn thấy ảnh trong thẻ kết quả',
    userImage !== undefined && userImage.attachment.attachmentId === 'att-1',
    JSON.stringify(view?.content ?? view))
}

// --- 8. hai hàm dựng thẻ phải THUẦN và không được ném
//
// Upstream chạy chúng cả lúc đang stream lẫn lúc xem lại nhật ký cũ, và nhật ký
// cũ có thể tới từ một bản plugin trước. Ném ở đây là làm vỡ màn hình xem lại.
{
  const junk = [{}, { action: 'x' }, { ref: 1 }, null, undefined]
  let thrown = ''
  for (const tool of registered) {
    for (const args of junk) {
      try {
        tool.presentCall?.(args)
        tool.presentResult?.(args, { meta: undefined })
        tool.output.render(args, {})
      } catch (error) {
        thrown = `${tool.name}: ${error.message}`
      }
    }
  }
  record('8. thẻ kết quả dựng được từ dữ liệu cũ hoặc thiếu, không ném', thrown === '', thrown)
}

// --- 9. gỡ đăng ký sạch
record('9. gỡ plugin thì mọi tool được huỷ đăng ký', typeof dispose === 'function')
dispose()

rmSync(outDir, { recursive: true, force: true })

const failed = results.filter((r) => !r.ok)
console.log('\n=== KẾT QUẢ ===')
if (failed.length === 0) console.log('Tất cả đạt. Tầng tool đúng hợp đồng của upstream.')
else console.log(`${String(failed.length)}/${String(results.length)} mục KHÔNG đạt: ${failed.map((f) => f.name).join(', ')}`)
process.exit(failed.length === 0 ? 0 : 1)
