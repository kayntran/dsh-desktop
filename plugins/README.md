# plugins/ — tính năng riêng của app

Mọi thứ chúng ta thêm vào app nằm ở đây, mỗi tính năng một thư mục con. Không có tính năng nào được
rải vào [../src/main/](../src/main/) trừ khi đó thật sự là việc của lớp vỏ Electron (cửa sổ, khay hệ
thống, thông báo Windows, vòng đời tiến trình engine).

Lý do quy ước này tồn tại: engine `@deepseek-ai/dsh` được tải nguyên bản từ npm. Giữ mọi thứ của
chúng ta ở một chỗ tách bạch nghĩa là mỗi bản cập nhật của DeepSeek về được bằng một lệnh, và ngược
lại, nếu một ngày DeepSeek đổi hướng thì công sức của chúng ta vẫn còn nguyên chứ không hòa tan vào
mã của họ. Xem [Luật 2 trong CLAUDE.md](../CLAUDE.md).

## Hình dạng một plugin

```
plugins/<tên>/
├── package.json        # tên gói; khai báo "dsh.client" nếu có phần giao diện
├── cordis.patch.yml    # dòng cấu hình bật plugin này lên
└── src/
    └── index.ts        # export const name + export function apply(ctx)
```

Một plugin ở dạng đơn giản nhất chỉ là một module xuất ra hàm `apply`:

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'ten-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(/* ... */)
}
```

Mọi thứ đăng ký qua `ctx` — sự kiện, tool, hẹn giờ — được dọn tự động khi plugin gỡ ra.

## Plugin hiện có

| Thư mục | Việc |
|---|---|
| `dock/` | Panel bên phải: Files, Terminal, Browser, và bộ tool trình duyệt cho agent |
| `plugin-manager/` | Tab Cài đặt → Plugins → **Bật/tắt**: gạt từng plugin, có lưu lựa chọn |
| `think-tags/` | Lưới đỡ: cắt phần suy nghĩ bọc trong `<think>` ra khỏi câu trả lời. Không có giao diện |
| `minimax-relay/` | Thêm `reasoning_split` vào yêu cầu gửi MiniMax, để nó trả phần nghĩ ra trường riêng. Không có giao diện |
| `growth/` | Tab Cài đặt → **Growth**: hai trang SOUL.md / USER.md sửa được ngay trên giao diện, buổi hỏi đáp lần đầu, mẩu nhớ và skill agent tự đúc kết |

## Nạp vào app

Engine được khởi động ở [../src/main/engine.ts](../src/main/engine.ts) với **sáu** lớp `--patch`:

```ts
spawn(node, [bin, '--profile', 'web',
  '--patch', dockPatchPath(),           // panel phải
  '--patch', pluginManagerPatchPath(),  // công tắc bật/tắt
  '--patch', thinkTagsPatchPath(),      // bộ lọc thẻ <think>
  '--patch', minimaxRelayPatchPath(),   // trạm chuyển tiếp MiniMax
  '--patch', growthPatchPath(),         // Soul, hồ sơ người dùng, Memory, Skills
  '--patch', pluginStatePath(),         // lựa chọn của người dùng — PHẢI ĐỨNG CUỐI
  '--port', '0'], ...)
```

Để nạp plugin mới, thêm **một tham số** `--patch` trỏ tới file `cordis.patch.yml` của nó. Tham số của
trình khởi động (`--profile`, `--patch`) phải đứng **trước** tham số của app (`--port`).

**Thứ tự các lớp `--patch` không phải chuyện thẩm mỹ.** Engine áp chúng theo đúng thứ tự trên dòng
lệnh, và một lớp chỉ sửa được những dòng đã tồn tại khi nó áp. Lớp lưu lựa chọn của người dùng phải
đứng cuối, nếu không thì các plugin do lớp trước chèn vào sẽ không tắt được — mà không có lỗi nào
báo. Đã đo: `npm run spike:loader`, phép 9 và phép 10.

Đường dẫn trong file patch phải là đường dẫn tuyệt đối, nên khi đóng gói cần dựng nó lúc chạy từ vị
trí thật của app chứ không viết cứng.

## Giao diện

Phần giao diện của plugin được engine phục vụ cho trình duyệt lúc chạy — **không cần dựng lại app
web của upstream**. Cơ chế: gói khai báo `dsh.client` trong `package.json`, engine quét thấy và phục
vụ bản dựng của nó tại `/plugins/<id>/client.js`.

Chỉ được cắm vào các vị trí upstream chừa sẵn. Danh sách đầy đủ và danh sách cấm nằm ở
[Luật 3 trong CLAUDE.md](../CLAUDE.md). Dùng lại bộ component và biến màu `--dsw-*` của upstream để
giao diện mới không lệch tông.

## Tài liệu gốc

Trong bản clone tra cứu `_upstream_dsh/` (không thuộc dự án, không được commit):

| Việc | Tài liệu |
|---|---|
| Plugin đầu tiên | `docs/user/develop/basic/index.md` |
| Viết một tool | `docs/user/develop/basic/tool.md` |
| Nhận cấu hình từ người dùng | `docs/user/develop/basic/config.md` |
| Đóng gói và cài đặt | `docs/user/develop/basic/publish.md` |
| Cách giao diện plugin được nạp | `docs/subsystems/client-modules.md` |
| Hệ thống vị trí giao diện | `packages/client/ui-slots/README.md` |
