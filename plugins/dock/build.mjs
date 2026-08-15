/**
 * Dựng hai nửa của plugin.
 *
 * - `lib/index.js`  — nửa Node, chạy trong tiến trình engine.
 * - `lib/client.js` — nửa giao diện, engine phục vụ cho trình duyệt tại
 *   `/plugins/harness-desktop-dock/client.js`.
 *
 * Nửa giao diện phải theo đúng một định dạng mà trình nạp module của upstream
 * quy định (xem `_upstream_dsh/packages/client/tsdown.client.ts:262-272`):
 * classic script, thân CJS, chỉ ĐĂNG KÝ một factory chứ không chạy thân module.
 * Thân chạy sau, lúc module được materialize.
 *
 *   node build.mjs
 */

import * as esbuild from 'esbuild'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Phải khớp `name` trong package.json VÀ `name` trong cordis.patch.yml. */
const ID = 'harness-desktop-dock'

/**
 * Những module KHÔNG được nhồi vào bundle: trình nạp cấp chúng qua bảng module
 * đóng băng của shell, và bảng đó là bản duy nhất trong trang.
 *
 * Nguồn sự thật: `PLATFORM_MODULES` ở
 * `_upstream_dsh/packages/client/web/src/platform.ts:8-15`, cộng ngoại lệ có
 * tài liệu `RUNTIME_STORE_EXEMPTION` ở `tsdown.client.ts:62`.
 *
 * RÀ LẠI DANH SÁCH NÀY SAU MỖI LẦN `/nang-cap-engine`.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

/**
 * Nhét file CSS vào bundle dưới dạng chuỗi.
 *
 * esbuild mặc định tách `.css` ra một file riêng, mà bundle giao diện bắt buộc
 * phải là MỘT file script duy nhất. Nạp dưới dạng `text` rồi để code tự tiêm
 * thẻ `<style>` có nhãn sở hữu — đúng cách upstream làm cho CSS của plugin.
 */
const cssAsText = { '.css': 'text' }

const shared = { bundle: true, sourcemap: true, logLevel: 'warning' }

/**
 * Nội dung mọi file nguồn dưới một thư mục, đệ quy.
 * @param {string} dir - thư mục gốc.
 * @returns {string[]} nội dung từng file.
 */
function docSources(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...docSources(path))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(readFileSync(path, 'utf8'))
  }
  return out
}

// ---------------------------------------------------------------- nửa Node

await esbuild.build({
  ...shared,
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // `node-pty` và `ws` phải ở ngoài: một cái là addon nhị phân, cái kia không
  // có lý do gì để nhồi. Chúng đi kèm plugin trong `node_modules/`.
  packages: 'external',
})

// ------------------------------------------------------------ nửa giao diện

await esbuild.build({
  ...shared,
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: CLIENT_EXTERNALS,
  loader: cssAsText,
  define: { 'process.env.NODE_ENV': '"production"' },
  // esbuild không có `intro` nên gộp vào banner. `"use strict"` phải là câu
  // lệnh đầu tiên trong thân arrow function mới có tác dụng.
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => { "use strict"; var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})

// ------------------------------------------------------------- chốt chặn
//
// Ba lỗi dưới đây đều KHÔNG gây ra lỗi nào lúc chạy — chúng chỉ làm màn hình
// trắng hoặc làm panel im lặng biến mất. Bắt chúng ở đây để build đỏ trước khi
// app trắng.

const out = readFileSync('lib/client.js', 'utf8')
const loi = []

if (!out.startsWith('window.__ModuleLoader__.load(')) {
  loi.push('bundle không mở đầu bằng lời gọi __ModuleLoader__.load — trình nạp sẽ bỏ qua nó')
}

// Mỗi external ĐANG ĐƯỢC DÙNG phải còn nguyên dạng `require(...)` trong bản
// dựng. Nếu esbuild nhồi được nó vào thì trang sẽ có hai bản React, và hook vỡ
// theo kiểu không đọc ra được nguyên nhân.
//
// Quét cả cây `src/client/` chứ không riêng file entry: các import nằm rải ở
// từng component, và chỉ kiểm file entry thì chốt chặn này gần như luôn im.
// Bỏ hẳn các câu `import type ... from '...'` trước khi tìm: chúng không sinh
// mã nên không có `require` nào để mà đòi. Cắt theo câu lệnh chứ không theo
// dòng, vì một import có thể trải nhiều dòng — và không dò bằng dấu chấm phẩy,
// vì mã ở đây không viết chấm phẩy cuối dòng.
const src = docSources('src/client').join('\n')
  .replace(/import\s+type\s[\s\S]*?from\s*['"][^'"]+['"]/g, '')

for (const mod of CLIENT_EXTERNALS) {
  const dungThat = src.includes(`'${mod}'`) || src.includes(`"${mod}"`)
  if (dungThat && !out.includes(`require("${mod}")`)) {
    loi.push(`external bị nhồi vào bundle thay vì để trình nạp cấp: ${mod}`)
  }
}

for (const dauVet of ['Invalid hook call', '__SECRET_INTERNALS', 'react-dom.production']) {
  if (out.includes(dauVet)) {
    loi.push(`bundle mang theo một bản React thứ hai (thấy chuỗi "${dauVet}")`)
  }
}

if (loi.length > 0) {
  console.error('\nBUILD HỎNG:')
  for (const dong of loi) console.error(`  - ${dong}`)
  process.exit(1)
}

console.log(`lib/index.js + lib/client.js đã dựng (${(out.length / 1024).toFixed(1)} KB giao diện)`)
