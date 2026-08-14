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

## Nạp vào app

Engine hiện được khởi động ở [../src/main/engine.ts](../src/main/engine.ts) bằng:

```ts
spawn(node, [bin, '--profile', 'web', '--port', '0'], ...)
```

Để nạp plugin, thêm **một tham số** `--patch` trỏ tới file `cordis.patch.yml` của nó. Tham số của
trình khởi động (`--profile`, `--patch`) phải đứng **trước** tham số của app (`--port`).

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
