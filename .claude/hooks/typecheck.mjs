/**
 * Chạy kiểm lỗi kiểu sau khi sửa file TypeScript.
 *
 * Chạy ở PostToolUse, chế độ nền (async + asyncRewake): không làm chậm thao tác
 * sửa file, nhưng đánh thức AI khi có lỗi thay vì để lỗi trôi qua tới lúc chủ dự
 * án mở app mới phát hiện.
 *
 * Thoát 0 = sạch. Thoát 2 = có lỗi, nội dung in ra sẽ được đưa lại cho AI.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { raw += chunk })
process.stdin.on('end', () => {
  let target
  try {
    const input = JSON.parse(raw)
    const args = input.tool_input ?? {}
    target = input.tool_response?.filePath ?? args.file_path
  } catch {
    return // Không đọc được thì thôi, đây không phải tấm chắn an toàn.
  }

  // Chỉ quan tâm file TypeScript trong dự án. tsconfig.json hiện chỉ phủ src/;
  // khi plugins/ có mã TypeScript riêng thì mở rộng tsconfig rồi sửa chỗ này.
  if (typeof target !== 'string' || !/\.tsx?$/i.test(target)) return

  const run = spawnSync('npm', ['run', 'typecheck'], {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
  })

  if (run.status === 0) return

  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  process.stdout.write(
    `Kiểm lỗi kiểu KHÔNG sạch sau khi sửa ${target}.\n` +
    `Sửa cho hết lỗi trước khi làm tiếp — đừng báo là đã xong khi còn lỗi ở đây.\n\n` +
    `${output}\n`,
  )
  process.exit(2)
})
