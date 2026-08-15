/**
 * Chọn icon cho một file theo đuôi tên.
 *
 * Bộ 70 icon của upstream **không có icon file** — bản thân DeepSeek chưa cần,
 * vì trình duyệt thư mục của họ chỉ liệt kê thư mục chứ không bao giờ hiện file
 * (`ui-directory-picker-browse/src/client/DirectoryBrowser.tsx`). Nên thay vì
 * tự vẽ một bộ icon file, ta mượn đúng những icon họ đã có và đã dùng cho cùng
 * ý nghĩa ở nơi khác trong app:
 *
 * - `IconCodeOutline16` là icon họ gán cho biến thể `code` của thẻ tool
 * - `IconApiOutline14` là icon họ gán cho biến thể `bash`
 * - `IconGlobeOutline14` là quả địa cầu, dùng cho trang web
 * - `IconDataOutline16` là hình khối dữ liệu, dùng cho file cấu hình/dữ liệu
 * - `IconListPenOutline16` là trang giấy có bút, dùng cho file chữ
 * - `IconPaperclipOutline16` là cái kẹp giấy — thứ đính kèm chứ không đọc được
 *
 * Sáu nhóm là đủ để nhìn lướt phân biệt được, và ít hơn hẳn một bảng đuôi file
 * đầy đủ mà không ai duy trì nổi.
 * @module
 */

import {
  IconApiOutline14,
  IconCodeOutline16,
  IconDataOutline16,
  IconGlobeOutline14,
  IconListPenOutline16,
  IconPaperclipOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Đuôi file theo nhóm. Đuôi không nằm ở đây rơi vào nhóm "đính kèm". */
const NHOM: readonly (readonly [React.ReactNode, readonly string[]])[] = [
  [<IconApiOutline14 key="sh" size={16} />, ['sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd']],
  [<IconGlobeOutline14 key="web" size={16} />, ['html', 'htm', 'xhtml']],
  [<IconDataOutline16 key="data" />, [
    'json', 'jsonc', 'json5', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env',
    'xml', 'csv', 'tsv', 'sql', 'db', 'sqlite', 'lock', 'properties',
  ]],
  [<IconListPenOutline16 key="text" />, ['md', 'mdx', 'markdown', 'txt', 'text', 'rst', 'adoc', 'log', 'nfo']],
  [<IconCodeOutline16 key="code" />, [
    'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'astro',
    'py', 'pyi', 'rb', 'php', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'scala', 'dart',
    'c', 'h', 'cc', 'cpp', 'hpp', 'cxx', 'cs', 'm', 'mm', 'lua', 'pl', 'r', 'jl', 'ex', 'exs',
    'css', 'scss', 'sass', 'less', 'styl', 'graphql', 'gql', 'proto', 'ipynb',
  ]],
]

/**
 * Icon hợp với kiểu file.
 *
 * File không có đuôi (`Makefile`, `Dockerfile`, `LICENSE`) rơi vào nhóm chữ —
 * gần như luôn đúng, và đúng hơn hẳn cái kẹp giấy.
 * @param name - tên file, không phải đường dẫn.
 * @returns phần tử icon 16px.
 */
export function fileIcon(name: string): React.ReactNode {
  const cham = name.lastIndexOf('.')
  // `.gitignore` có dấu chấm ở vị trí 0: đó là file ẩn không đuôi, không phải
  // file đuôi `gitignore`.
  if (cham <= 0) return <IconListPenOutline16 />
  const duoi = name.slice(cham + 1).toLowerCase()
  for (const [icon, danhSach] of NHOM) {
    if (danhSach.includes(duoi)) return icon
  }
  return <IconPaperclipOutline16 />
}
