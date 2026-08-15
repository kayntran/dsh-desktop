/**
 * Chặn tên tiếng Việt trong mã.
 *
 * Chạy ở PreToolUse trên `Write`/`Edit`. Chỉ soi **nội dung sắp ghi**, và chỉ
 * soi những **tên được khai báo mới** trong nội dung đó. Nhờ vậy sửa một file cũ
 * còn tên tiếng Việt vẫn qua được — hook gác dòng mới, không bắt dọn cả file.
 *
 * Vì sao cần hook thay vì chỉ ghi luật: Luật 7 đã nằm trong CLAUDE.md từ đầu, mà
 * mã trong `plugins/dock/` vẫn trôi khỏi nó qua nhiều phiên — 179 cái tên. Vùng
 * mã gốc thì không ai đụng suốt mấy tháng, và khác biệt duy nhất là ở đó có
 * `guard-upstream.mjs` chặn cứng. Một dòng luật nhắc; một hook thì cưỡng chế.
 *
 * ## Giới hạn, nói thẳng
 *
 * Nó dò theo **danh sách gốc từ**, không phải từ điển tiếng Việt. Nó bắt đúng
 * lớp từ vựng đã tái diễn trong dự án này và sẽ bỏ lọt từ mới. Bỏ lọt thì thêm
 * vào `STEMS` — đó là cách nó lớn lên. Một hook bắt được phần lớn và nói thật về
 * phần còn lại vẫn hơn hẳn một dòng luật bắt được số không.
 *
 * Xem thêm: CLAUDE.md Luật 7, `.claude/rules/naming.md`.
 */

/** Chỉ soi mã. `.md`, `.json`, `.yml` được phép mang tiếng Việt thoải mái. */
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|css)$/i

/**
 * Tiếng tiếng Việt, so theo **từng đoạn** của tên chứ không theo chuỗi con.
 *
 * So chuỗi con là sai, và phép thử đầu tiên đã chứng minh: gốc `han` khớp bên
 * trong `handler`, `NotifierHandlers`, `reapOrphanEngine` — chặn oan hàng loạt
 * mã tiếng Anh đúng chuẩn. Một rào chặn oan là một rào sẽ bị tắt.
 *
 * Nên tên được cắt thành đoạn theo camelCase và gạch dưới (`handOffFocus` →
 * `hand`, `off`, `focus`), rồi mới so bằng nhau.
 *
 * Danh sách cố ý BỎ những tiếng trùng từ tiếng Anh hoặc trùng viết tắt thông
 * dụng: `ban`, `can`, `con`, `gui`, `hop`, `map`, `no`, `pin`, `sat`, `so`,
 * `tin`, `to`. Cũng bỏ mọi tiếng dưới ba chữ — quá ngắn để chắc chắn.
 */
const SYLLABLES = new Set([
  'bam', 'bao', 'buoc',
  'cham', 'chay', 'chen', 'chiem', 'cho', 'chon', 'chong', 'chuan', 'chuoi', 'chup',
  'dang', 'danh', 'diem', 'dieu', 'dinh', 'doi', 'dong', 'duong',
  'ghi', 'giao', 'gio',
  'han', 'het', 'hien',
  'ket', 'khau', 'khien', 'khung', 'kiem',
  'lenh', 'lich', 'loi',
  'moi', 'muc',
  'nhan', 'nhap', 'noi',
  'phan', 'phien', 'phim',
  'qua', 'quan',
  'sach', 'san',
  'tai', 'tham', 'thai', 'thoai', 'thoat', 'tich', 'tieu', 'trang', 'truong',
  'viec', 'xep', 'xong',
])

/**
 * Tên đầy đủ đã gặp và chắc chắn sai, kể cả khi cắt đoạn ra không ai khớp.
 * Chủ yếu là tên trường trong giao thức, dạng gạch dưới.
 */
const EXACT = new Set([
  'bat_dau', 'co_san', 'co_scheme', 'dia_chi', 'ket_qua', 'ly_do',
  'mac_dinh', 'noi_ket', 'phien_ban', 'tham_so', 'tre_ms',
])

/** `handOffFocus` → `hand`, `off`, `focus`. `TAI_XE` → `tai`, `xe`. */
function segments(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_$]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase())
}

/** Tên này có mang tiếng Việt không. */
function isVietnamese(name) {
  if (EXACT.has(name.toLowerCase())) return true
  return segments(name).some((seg) => SYLLABLES.has(seg))
}

/**
 * Tên được KHAI BÁO trong đoạn mã này.
 *
 * Chỉ khai báo, không phải mọi lần dùng: sửa một dòng có gọi `xepChong()` của
 * file cũ thì vẫn qua, chỉ khi viết `function xepChong` mới bị chặn.
 */
const DECLARATIONS = [
  /\b(?:function|class|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\btype\s+([A-Za-z_$][\w$]*)\s*=/g,
  // Thuộc tính của object literal và của interface — đây là chỗ tên giao thức
  // (`tham_so`, `ket_qua`) lọt qua ở bản trước.
  /^\s*([A-Za-z_$][\w$]*)\s*[:?]/gm,
]

/** Những tên vi phạm trong một đoạn mã, không trùng lặp. */
function offenders(code) {
  const found = new Set()
  for (const re of DECLARATIONS) {
    for (const match of String(code).matchAll(re)) {
      const name = match[1]
      if (name !== undefined && isVietnamese(name)) found.add(name)
    }
  }
  return [...found]
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
    // Im lặng cho qua là để tấm chắn tắt mà không ai biết — nói ra.
    process.stdout.write(JSON.stringify({
      systemMessage: 'guard-naming: không đọc được dữ liệu hook, thao tác đã được cho qua.',
    }))
    return
  }

  const args = input.tool_input ?? {}
  const target = args.file_path ?? args.notebook_path ?? args.path ?? ''
  if (!CODE_FILE.test(String(target))) return

  // `Write` mang cả file; `Edit` chỉ mang đoạn thay thế. Cả hai đều là "nội dung
  // sắp có mặt trong file", nên soi cùng một cách.
  const code = args.content ?? args.new_string ?? ''
  const bad = offenders(code)
  if (bad.length === 0) return

  deny(
    `Tên tiếng Việt trong mã — bị chặn theo Luật 7 trong CLAUDE.md.\n`
    + `Tên vi phạm: ${bad.join(', ')}\n`
    + `Tiếng Việt dùng cho CHÚ THÍCH, tài liệu, và chữ hiện trên màn hình — giữ nguyên, đừng dịch.\n`
    + `Tiếng Anh dùng cho TÊN: hàm, kiểu, biến, hằng, file, trường JSON, đường dẫn HTTP, class CSS.\n`
    + `Đổi tên rồi ghi lại. Chi tiết và bảng ví dụ: .claude/rules/naming.md`,
  )
})
