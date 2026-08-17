# Luật của dự án này

**Trả lời chủ dự án bằng tiếng Việt.** Nhưng **mọi thứ bên trong mã là tiếng Anh** — tên, chú thích,
và chữ hiện trên màn hình. Xem Luật 7.

Chủ dự án **không đọc code**. Giải thích mọi quyết định theo hướng *người dùng app sẽ thấy gì*, và
hỏi trước khi làm những việc không hoàn tác được.

## Dự án này là gì

Harness Desktop là **lớp vỏ Electron mỏng** bọc quanh engine `@deepseek-ai/dsh` — agent harness mã
nguồn mở của DeepSeek. Engine tải nguyên bản từ npm, ghim phiên bản trong
[engine/package.json](engine/package.json). Lớp vỏ ở [src/main/](src/main/) chỉ lo cửa sổ, khay hệ
thống, thông báo Windows, vòng đời tiến trình.

`_upstream_dsh/` là bản clone **chỉ để tra cứu**, không thuộc mã dự án, không đóng gói, không commit.

## Nguyên tắc gốc: everything is a plugin

Upstream tự dựng app của họ theo đúng cách này — giao diện web, CLI, vòng lặp agent đều là plugin,
ghép bằng các lớp cấu hình. Hai bộ họ phát hành sẵn (`dsh-base`, `dsh-web-app`) cũng chỉ là lớp cấu
hình, không đặc quyền gì hơn plugin của chúng ta.

Nên: **mọi thứ chúng ta thêm vào đều là plugin.** Không có lý do chính đáng nào để sửa mã gốc.

## Bảy điều luật

1. **Mã gốc bất khả xâm phạm.** Không ghi vào `_upstream_dsh/`, `node_modules/` (mọi độ sâu, kể cả
   `engine/node_modules/`), `runtime/`. Hệ thống đã chặn cứng. Bị chặn thì **dừng lại và hỏi**,
   không tìm đường đi vòng. Chi tiết: `.claude/rules/upstream-boundary.md`.
2. **Code mới đặt trong `plugins/<tên>/`.** Chỉ sửa [src/main/](src/main/) khi việc đó thật sự
   thuộc về lớp vỏ. Xem [plugins/README.md](plugins/README.md).
3. **Giao diện chỉ được cộng thêm**, vào các vị trí upstream chừa sẵn. Cấm thay thế cả vùng.
   Danh sách đầy đủ: `.claude/rules/ui-slots.md`.
4. **Dùng vật liệu của hệ thống, không tự vẽ.** Component, icon, biến màu đều lấy từ upstream —
   25 component và 70 icon đã có sẵn trong engine đã cài. Chỉ tự viết khi đã kiểm tra và xác nhận
   không có sẵn, và phải báo trước. Không sửa CSS của upstream; ghi đè biến `--dsw-*` trong CSS của
   mình. Chi tiết: `.claude/rules/ui-toolkit.md`.
5. **Khai báo mức trước khi viết code giao diện**: mức 1 (cộng thêm), mức 2 (chen có chọn lọc),
   mức 3 (thay thế — cấm).
6. **Ghi sổ.** Việc đáng nhớ ghi một dòng vào [MY-CHANGES.md](MY-CHANGES.md).
7. **Mã là tiếng Anh, đối thoại là tiếng Việt.** Tiếng Anh cho tên (hàm, kiểu, biến, hằng, file,
   trường JSON, đường dẫn HTTP, class CSS), cho **chú thích trong mã**, và cho **chữ hiện trên màn
   hình** — giao diện app do DeepSeek dựng vốn là tiếng Anh, chữ ta thêm vào phải khớp với nó. Tiếng
   Việt cho tài liệu `.md` và cho câu trả lời gửi chủ dự án. Hook chặn cứng tên tiếng Việt; bị chặn
   thì đổi tên. Chi tiết: `.claude/rules/naming.md`.

## Định tuyến rule

Rule chi tiết ở `.claude/rules/`, chỉ đọc khi đụng tới việc tương ứng — để dành chỗ trong ngữ cảnh
cho việc chính.

| Đụng tới | Đọc |
|---|---|
| Chọn chỗ cắm giao diện vào | `rules/ui-slots.md` |
| Dựng giao diện: component, icon, màu, CSS | `rules/ui-toolkit.md` |
| Bị chặn ghi file, hoặc định đụng vào `_upstream_dsh/`, `node_modules/`, `runtime/` | `rules/upstream-boundary.md` |
| Viết plugin mới | [plugins/README.md](plugins/README.md) |
| Bị chặn vì đặt tên, hoặc phân vân tiếng Việt hay tiếng Anh | `rules/naming.md` |

## Quy trình gọi theo tên

| Việc | Gõ |
|---|---|
| Thêm một tính năng mới | `/them-tinh-nang` |
| Nhận bản cập nhật mới của DeepSeek | `/nang-cap-engine` |
| Rà soát xem có gì đã lệch khỏi luật chưa | `/kiem-tra-ranh-gioi` |
| Commit và đẩy lên GitHub | `/commit` |

Đừng làm tay những việc đã có quy trình — quy trình tồn tại vì thứ tự các bước mới là phần quan
trọng, không phải từng bước riêng lẻ.

## Lệnh hay dùng

| Lệnh | Việc |
|---|---|
| `npm run typecheck` | Kiểm lỗi kiểu, không sinh file |
| `npm run dev` | Build rồi mở app |
| `npm run dist` | Đóng gói bản cài đặt |
| `npm run engine:install` | Cài lại engine theo phiên bản đã ghim |

## Quản lý tài liệu trong `.claude/`

- Quy tắc mới → thêm hoặc sửa file trong `.claude/rules/` theo chủ đề, **không phình CLAUDE.md**.
- Mọi file `.md` trong `.claude/` giữ **dưới 250 dòng**, đếm bằng `wc -l` chứ đừng ước lượng.
- Rule chỉ liên quan một loại việc → khai `paths:` và thêm dòng vào bảng định tuyến ở trên.
