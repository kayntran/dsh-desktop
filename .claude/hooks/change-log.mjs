/**
 * Ghi nhật ký thô: file nào vừa bị sửa, lúc nào.
 *
 * Chạy ở PostToolUse. Đây là bản ghi máy móc để truy lại trong lúc làm việc —
 * khác với MY-CHANGES.md, cuốn sổ có chọn lọc do AI viết khi có việc đáng nhớ.
 * File này bị .gitignore loại ra: lịch sử thật nằm ở git.
 */
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const LOG = fileURLToPath(new URL('../change-log.txt', import.meta.url))
const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/')

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { raw += chunk })
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw)
    const args = input.tool_input ?? {}
    const target = input.tool_response?.filePath ?? args.file_path ?? args.notebook_path
    if (target === undefined) return

    // Rút gọn về đường dẫn tương đối cho dễ đọc. So khớp không phân biệt hoa
    // thường: Windows trả về "D:\..." trong khi tool thường gửi "d:/...".
    const full = String(target).replace(/\\/g, '/')
    const shown = full.toLowerCase().startsWith(ROOT.toLowerCase()) ? full.slice(ROOT.length) : full
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
    appendFileSync(LOG, `${stamp} | ${input.tool_name ?? '?'} | ${shown}\n`, 'utf8')
  } catch {
    // Nhật ký hỏng không được phép cản trở công việc.
  }
})
