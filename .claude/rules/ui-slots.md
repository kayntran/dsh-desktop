---
paths: ["plugins/**", "src/main/window.ts", "**/*.tsx", "**/*.css"]
description: Vị trí giao diện được phép cắm vào, vị trí bị cấm, và hệ biến màu của upstream.
---

# Giao diện: chỉ được cộng thêm

Giao diện app do upstream dựng, và nó có sẵn một hệ thống "chỗ trống" (slot) để cắm thêm vào. Phần
giao diện của plugin được engine phục vụ cho trình duyệt **lúc chạy** — không cần dựng lại app web
của upstream. Cơ chế: gói khai báo `dsh.client` trong `package.json`, engine quét thấy và phục vụ
bản dựng tại `/plugins/<id>/client.js`.

## Ba mức, và vì sao mức 3 bị cấm

| Mức | Là gì | Hệ quả |
|---|---|---|
| 1 — cộng thêm | Cắm vào một chỗ trống có sẵn | Đồ của ta và đồ của họ cùng tồn tại. Vẫn nhận mọi cập nhật |
| 2 — chen có chọn lọc | Nhận đúng trường hợp của mình, phần còn lại vẫn dùng bản gốc | Chỉ phần đã nhận là của ta |
| 3 — thay thế cả vùng | Chiếm một slot đang có chủ | **CẤM** |

Mức 3 bị cấm vì nó **không gây ra lỗi nào**: merge vẫn sạch, typecheck vẫn xanh, app vẫn chạy. Thứ
mất đi là mọi cải tiến tương lai của vùng đó, và không có gì báo cho chủ dự án biết. Hỏng trong im
lặng là loại hỏng tệ nhất với một người không đọc code.

Nếu một yêu cầu có vẻ bắt buộc phải thay cả vùng: **dừng lại, nói ra, chờ quyết định.** Đừng tự chọn.

## Được phép — mức 1

| Khu vực | Slot |
|---|---|
| Toàn cửa sổ (lớp nổi trên mọi cột) | `shell.overlay` |
| Chân thanh bên, cạnh Cài đặt | `sidebar.footer.action` |
| Hàng nút cạnh tiêu đề phiên | `conversation.session.header.actions` |
| Nhóm tiện ích canh phải ở đầu phiên | `conversation.session.header.utilities` |
| **Tab xem mới trong phiên** | `conversation.view` |
| Nút trên mỗi tin nhắn đã hoàn tất | `conversation.chat.assistant-actions` |
| Hàng riêng phía trên ô nhập (nội dung cao) | `conversation.input.dock` |
| Dải mỏng dưới ô nhập (thông tin nền) | `conversation.composer.dock` |
| Nút nhỏ đầu trái hàng công cụ trong ô nhập | `conversation.input.left` |
| Nút nhỏ bên phải, cạnh nút Gửi | `conversation.input.right` |
| Lớp nổi neo vào ô nhập (menu, popup) | `conversation.input.overlay` |
| **Trang cài đặt mới** | `settings.section` |
| Một dòng tuỳ chọn trong mục General | `settings.general.item` |
| Nút ở đầu panel cài đặt | `settings.action` |
| Tab trong mục Plugins | `settings.plugins.tab` |
| Thẻ trong danh sách plugin | `settings.plugin.item` |
| Bước hướng dẫn lần đầu | `settings.onboarding` |

**Đăng ký theo tên** (khai tên rồi nhận):

| Slot | Ghi chú |
|---|---|
| `tool.call.toolview` | Khai tên tool. Tool **của ta** → mức 1. Tool có sẵn của họ → là mức 3 cho riêng tool đó, cấm |
| `conversation.chat.commandview` | Khai tên lệnh gạch chéo. Lệnh chưa ai nhận vẫn có bản mặc định |

## Được phép — mức 2

| Slot | Cách hoạt động |
|---|---|
| `conversation.composer` | Thay ô nhập cho một tình huống cụ thể; tình huống khác rơi về bản gốc |
| `conversation.chat.turnTail` | Chèn vào cuối lượt hội thoại, tự chọn lượt nào nhận |

## CẤM — mức 3

`sidebar` · `conversation` · `details` · `conversation.session` · `conversation.session.header` ·
`conversation.details.tool` · `conversation.composer.bar` · `conversation.hero.workspace` ·
`conversation.hero.agentPreset` · `conversation.input.model` · `conversation.input.plan`

Đây đều là slot loại `single` **đang có chủ**. Đăng ký vào là thay nguyên vùng, và mọi slot con bên
trong biến mất theo.

## Muốn có một trang riêng thì dùng gì

- `conversation.view` — một tab xem hoàn toàn mới bên trong phiên làm việc
- `settings.section` — một trang cài đặt hoàn chỉnh, có mục riêng trên thanh điều hướng
- `shell.overlay` — panel toàn màn hình, mở từ nút đặt ở `sidebar.footer.action`

Ba chỗ này giải quyết gần hết nhu cầu "thêm page" mà không phải chạm vào gì.

## Dựng bằng gì

File này chỉ trả lời **cắm vào đâu**. Câu hỏi **dựng bằng gì** — component nào, icon nào, màu nào —
nằm ở `.claude/rules/ui-toolkit.md`, và ở đó là luật bắt buộc: dùng đồ có sẵn của upstream, không tự
vẽ lại thứ đã có.

## Danh sách này chụp ở phiên bản nào

Bản `0.1.0-rc.6`. Upstream đang phát triển mạnh nên nhiều khả năng sẽ có thêm slot mới. Sau mỗi lần
`/nang-cap-engine`, rà lại bằng cách tìm khai báo slot trong bản clone:

```bash
grep -rhn "kind: '\(list\|chain\|single\)'" --include=*.ts _upstream_dsh/packages/client
```
