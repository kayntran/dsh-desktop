/**
 * Chặn mọi thao tác ghi vào mã gốc của DeepSeek.
 *
 * Chạy ở PreToolUse. Đọc JSON từ stdin, in ra quyết định từ chối nếu thao tác
 * nhắm vào vùng bảo vệ. Viết bằng Node vì máy này không có `jq`.
 *
 * Vì sao cần hook thay vì chỉ ghi luật trong CLAUDE.md: luật có thể trôi khỏi
 * ngữ cảnh trong một phiên làm việc dài, hook thì không quên.
 *
 * Xem thêm: CLAUDE.md, Luật 1.
 */
import { fileURLToPath } from 'node:url'

const norm = (p) => String(p).replace(/\\/g, '/').toLowerCase()

/** Thư mục gốc dự án — script nằm ở <gốc>/.claude/hooks/. */
const ROOT = norm(fileURLToPath(new URL('../../', import.meta.url)))

/**
 * Vùng bảo vệ. Hai loại khác nhau, và phân biệt sai là để lọt:
 * - Theo tên thư mục ở BẤT KỲ độ sâu nào: `engine/node_modules/` cũng phải bị
 *   chặn như `node_modules/` ở gốc.
 * - Chỉ ở gốc dự án: `runtime/` là Node runtime tải về, nhưng một plugin sau này
 *   hoàn toàn có thể có thư mục con tên `runtime` hợp lệ.
 */
const PROTECTED_SEGMENTS = ['_upstream_dsh', 'node_modules']
const PROTECTED_ROOT_DIRS = ['runtime']

/** Tên nhận diện vùng bảo vệ khi soi một dòng lệnh shell (không có gốc để đối chiếu). */
const PROTECTED_IN_CMD = /(_upstream_dsh|node_modules|runtime[/\\])/i

/**
 * Đường nâng cấp engine chính thức — ghi vào engine/node_modules/ là đúng việc
 * của nó, chặn thì không nâng cấp được nữa.
 */
const SANCTIONED = /^\s*(npm|pnpm|yarn)\s+(install|ci|i)\b|^\s*npm\s+run\s+engine:/i

/** Động từ ghi đè thường gặp trong shell. */
const WRITE_VERBS = [
  /\bsed\b[^]*\s-i\b/i,
  /(^|[^>])>>?[^>]/,
  /\btee\b/i,
  /\b(rm|mv|cp|mkdir|touch|truncate)\b/i,
]

/** Đường dẫn này có nằm trong vùng bảo vệ của dự án không. */
function isProtectedPath(filePath) {
  if (!filePath) return null
  let p = norm(filePath)
  if (!p.startsWith(ROOT)) {
    // Đường dẫn tương đối: coi như tính từ gốc dự án.
    if (/^[a-z]:\//.test(p) || p.startsWith('/')) return null
    p = ROOT + p.replace(/^\.\//, '')
  }
  const parts = p.slice(ROOT.length).split('/').filter(Boolean)
  const nested = parts.find((seg) => PROTECTED_SEGMENTS.includes(seg))
  if (nested !== undefined) return `${nested}/`
  if (PROTECTED_ROOT_DIRS.includes(parts[0])) return `${parts[0]}/`
  return null
}

/** Dòng lệnh này có ghi đè vào vùng bảo vệ không. */
function isProtectedCommand(command) {
  if (!command || SANCTIONED.test(command)) return null
  // Xét từng đoạn riêng: `rm tam.txt && cat node_modules/x` không phải thao tác ghi.
  for (const segment of String(command).split(/&&|\|\||;|\|/)) {
    if (!PROTECTED_IN_CMD.test(segment)) continue
    if (WRITE_VERBS.some((re) => re.test(segment))) return segment.trim()
  }
  return null
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }))
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { raw += chunk })
process.stdin.on('end', () => {
  let input
  try {
    input = JSON.parse(raw)
  } catch {
    // Không đọc được thì cho qua, nhưng phải nói ra — im lặng ở đây đồng nghĩa
    // với việc tấm chắn bị tắt mà không ai biết.
    process.stdout.write(JSON.stringify({
      systemMessage: 'guard-upstream: không đọc được dữ liệu hook, thao tác đã được cho qua.',
    }))
    return
  }

  const tool = input.tool_name ?? ''
  const args = input.tool_input ?? {}

  if (tool === 'Bash' || tool === 'PowerShell') {
    const hit = isProtectedCommand(args.command)
    if (hit !== null) {
      deny(
        `Lệnh này ghi vào mã gốc của DeepSeek — bị chặn theo Luật 1 trong CLAUDE.md.\n` +
        `Đoạn vi phạm: ${hit}\n` +
        `Vùng bảo vệ: _upstream_dsh/, node_modules/, engine/node_modules/, runtime/.\n` +
        `Đừng tìm cách đi vòng. Hãy dừng lại, giải thích cho chủ dự án vì sao cần sửa mã gốc, ` +
        `và chờ quyết định. Nếu định nâng cấp engine, dùng "npm run engine:install".`,
      )
    }
    return
  }

  const target = args.file_path ?? args.notebook_path ?? args.path
  const dir = isProtectedPath(target)
  if (dir !== null) {
    deny(
      `"${target}" nằm trong ${dir} — mã gốc của DeepSeek, bị chặn theo Luật 1 trong CLAUDE.md.\n` +
      `App này giữ engine nguyên bản để mỗi bản cập nhật của DeepSeek về được bằng một lệnh. ` +
      `Sửa vào đây là đánh đổi điều đó.\n` +
      `Tính năng riêng đặt ở plugins/. Nếu tin rằng không còn cách nào khác, dừng lại và hỏi ` +
      `chủ dự án — đừng tự quyết.`,
    )
  }
})
