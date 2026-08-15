/**
 * `build.mjs` nạp file `.css` dưới dạng chuỗi (`loader: { '.css': 'text' }`),
 * vì bundle giao diện bắt buộc phải là một file script duy nhất — để esbuild
 * tách CSS ra file riêng thì trình nạp module sẽ không bao giờ lấy nó.
 * Khai báo này cho TypeScript biết điều đó.
 * @module
 */

declare module '*.css' {
  const content: string
  export default content
}
