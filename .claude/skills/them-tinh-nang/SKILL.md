---
name: them-tinh-nang
description: Quy trình thêm một tính năng mới vào Harness Desktop dưới dạng plugin. Buộc chọn vị trí giao diện từ danh sách cho phép và khai báo mức 1/2/3 TRƯỚC khi viết code. Kích hoạt khi user muốn thêm tính năng, thêm tool, thêm trang, thêm nút, thêm panel, hoặc bất cứ thứ gì mới vào app.
---

# Thêm một tính năng mới

Thứ tự các bước mới là phần quan trọng, không phải từng bước riêng lẻ. Lý do: quyết định đắt nhất
(cắm vào đâu, mức mấy) phải xảy ra **trước** khi có dòng code nào, vì sau đó nó rất khó đổi và hậu
quả thì không hiện ra ngay.

## 1. Hiểu tính năng theo hướng người dùng

Chủ dự án không đọc code. Trước khi làm gì, diễn đạt lại tính năng thành một câu kiểu:
*"Người dùng bấm X ở chỗ Y, thấy Z."*

Nếu chưa đủ rõ để viết được câu đó → **hỏi**, đừng đoán.

## 2. Phân loại

| Loại | Dấu hiệu | Đi tiếp bước |
|---|---|---|
| Tool cho model | Model cần gọi được, có tham số, trả kết quả | 4 |
| Giao diện | Người dùng nhìn thấy, bấm được | 3 rồi 4 |
| Cả hai | Tool + cách hiển thị riêng cho kết quả của nó | 3 rồi 4 |
| Việc của lớp vỏ | Cửa sổ, khay hệ thống, thông báo Windows, cập nhật app | Sửa `src/main/`, bỏ qua bước 3 |

## 3. Chọn vị trí giao diện — BẮT BUỘC trước khi viết code

1. Đọc `.claude/rules/ui-slots.md`.
2. Chọn một slot **trong danh sách được phép**.
3. Nói ra cho chủ dự án: *"Tính năng này cắm vào `<slot>`, đây là mức 1."*

**Nếu không slot nào vừa: DỪNG LẠI.** Không tự chuyển sang mức 3. Báo cho chủ dự án:

- Tính năng này cần chỗ nào mà upstream không chừa sẵn
- Cách duy nhất còn lại là chiếm vùng nào, và vùng đó sẽ ngừng nhận cập nhật vĩnh viễn
- Có phương án mức 1 nào gần đúng không (thường là có: `shell.overlay` mở từ
  `sidebar.footer.action` thay thế được phần lớn nhu cầu "một trang riêng")

Chờ quyết định. Đây là loại quyết định không được để AI tự quyết.

## 3b. Chọn vật liệu — trước khi viết giao diện

Đọc `.claude/rules/ui-toolkit.md`. Liệt kê ra **tên component và icon có sẵn** sẽ dùng, ví dụ:
*"nút dùng `Button`, icon dùng `IconDownloadOutline16`, hộp thoại dùng `Modal`."*

Không tự viết nút, ô nhập, menu, hộp thoại, tooltip, thẻ, icon. Không viết cứng mã màu — chỉ dùng
biến `--dsw-*`.

Nếu tin rằng cần một thành phần upstream không có: kiểm tra bằng
`grep -n "export" _upstream_dsh/packages/client/ui-primitives/src/index.ts`, rồi **báo cho chủ dự án
trước khi tự viết**.

## 4. Dựng plugin

Đọc [plugins/README.md](../../../plugins/README.md) cho cấu trúc đầy đủ. Tối thiểu:

```
plugins/<tên>/
├── package.json        # khai "dsh.client" nếu có phần giao diện
├── cordis.patch.yml    # dòng cấu hình bật plugin
└── src/index.ts        # export const name + export function apply(ctx)
```

Đặt tên thư mục bằng **tiếng Anh**, gạch ngang: `dock`, `plugin-manager`, `think-tags`. Đây là tên
file nên nó theo Luật 7 — xem `.claude/rules/naming.md`.

## 5. Nạp vào app

Engine khởi động ở [src/main/engine.ts](../../../src/main/engine.ts):

```ts
spawn(node, [bin, '--profile', 'web', '--port', '0'], ...)
```

Thêm `--patch <đường-dẫn tuyệt đối tới cordis.patch.yml>` **trước** `--port` (tham số của trình khởi
động phải đứng trước tham số của app). Dựng đường dẫn lúc chạy từ vị trí thật của app, không viết
cứng — bản đóng gói nằm ở chỗ khác với lúc phát triển.

Mỗi plugin mới đụng vào `src/main/` đúng ba chỗ, và **chỉ** ba chỗ đó: đường dẫn tới thư mục plugin
và file patch của nó (`paths.ts`), một lớp `--patch` thêm vào lệnh khởi động (`engine.ts`), một dòng
trong danh sách junction (`plugin-link.ts`). Thiếu junction thì engine không tìm thấy gói và **chết
ngay lúc khởi động** — đo bằng cách cố tình đặt sai tên gói. Ngoài ba chỗ đó còn hai chỗ nữa nằm
ngoài `src/main/`: danh sách chép file lúc đóng gói (`electron-builder.yml`) và các lệnh
`typecheck` / `plugins:build` / `plugins:install` (`package.json`). Bỏ sót nhóm sau thì bản chạy thử
vẫn tốt còn bản cài đặt thiếu plugin.

## 6. Kiểm chứng — không được bỏ

```bash
npm run typecheck     # phải sạch
npm run dev           # mở app, bấm thử đúng thao tác ở bước 1
```

Chưa mở app bấm thử thì **chưa được báo là xong**. Typecheck xanh chỉ nói code hợp lệ, không nói
tính năng chạy đúng.

## 7. Ghi sổ và báo cáo

Thêm vào [MY-CHANGES.md](../../../MY-CHANGES.md):

```
## <ngày> — <tên tính năng>
Nằm ở plugins/<tên>/, cắm vào <slot>, mức <n>.
Vì sao: ...
```

Rồi báo cho chủ dự án bằng ngôn ngữ người dùng: bấm vào đâu, thấy gì, đã thử chưa. Không liệt kê
tên file.

## Những chỗ hay sai

- **Viết code trước rồi mới nghĩ cắm vào đâu.** Đảo ngược thứ tự này là cách chắc chắn nhất để rơi
  vào mức 3 mà không nhận ra.
- **Tự ý sửa `src/main/`** cho những việc thuộc về plugin. `src/main/` chỉ dành cho lớp vỏ.
- **Báo xong khi mới typecheck.** Xem bước 6.
- **Chọn "viết lại cả khung cho gọn".** Đó chính là mức 3.
