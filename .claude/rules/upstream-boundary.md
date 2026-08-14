---
paths: ["engine/**", "_upstream_dsh/**", "runtime/**", ".claude/hooks/**"]
description: Vùng mã gốc bất khả xâm phạm, vì sao nó tồn tại, và những ngoại lệ hợp lệ.
---

# Ranh giới với mã gốc của DeepSeek

## Vùng bảo vệ

| Đường dẫn | Là gì | Ai quản |
|---|---|---|
| `_upstream_dsh/` | Bản clone mã nguồn DeepSeek, chỉ để đọc | `git clone` tay |
| `node_modules/` | Phụ thuộc của lớp vỏ Electron | `npm install` |
| `engine/node_modules/` | Engine dsh tải từ npm | `npm run engine:install` |
| `runtime/` | Node runtime tải từ nodejs.org | `npm run runtime:install` |

Không có trường hợp nào mà việc ghi tay vào bốn nơi này là đúng.

## Vì sao ranh giới này tồn tại

App giữ engine **nguyên bản**. Nhờ đó mỗi bản cập nhật của DeepSeek về được bằng một lệnh: đổi số
phiên bản trong [engine/package.json](engine/package.json) rồi cài lại. Sửa vào mã gốc là đánh đổi
chính điều đó — từ lúc ấy mỗi bản cập nhật là một lần gỡ rối, và chủ dự án sẽ phải chờ.

Nói theo hướng người dùng app: hiện tại DeepSeek ra bản mới thì họ nhận được trong ngày. Sau khi có
một chỗ bị sửa, họ chờ tới khi ai đó gỡ xong.

Ranh giới này cũng bảo vệ theo chiều ngược lại: nếu DeepSeek đổi hướng hoặc bỏ dự án, mọi thứ ta làm
vẫn còn nguyên trong `plugins/` chứ không hòa tan vào mã của họ.

## Đã chặn bằng gì

- `permissions.deny` trong [.claude/settings.json](../settings.json) — lớp khai báo
- [.claude/hooks/guard-upstream.mjs](../hooks/guard-upstream.mjs) chạy ở `PreToolUse` — lớp cưỡng chế

Lớp hook soi cả `Write`/`Edit` (theo đường dẫn, mọi độ sâu, cả kiểu Windows lẫn kiểu Unix) và `Bash`
(bắt các mẫu ghi đè: `sed -i`, chuyển hướng `>`, `tee`, `rm`/`mv`/`cp` nhắm vào vùng bảo vệ).

**Lớp Bash không bắt hết mọi cách viết file qua shell.** Lách được không có nghĩa là được phép — lỗ
hổng thực tế cần bịt là dùng `Edit` lên file upstream, và chỗ đó đã bịt kín.

## Ngoại lệ hợp lệ

Chỉ những lệnh sau được phép ghi vào `node_modules/` (hook đã chừa sẵn):

```
npm install / npm ci / npm i
pnpm install / yarn install
npm run engine:install
```

Đó là đường nâng cấp chính thức. Chặn luôn cả chúng thì không nâng cấp được nữa.

## Khi bị chặn thì làm gì

1. **Dừng lại.** Không thử cách khác, không dùng shell để lách.
2. Nói cho chủ dự án biết: định sửa file nào, để làm gì, và vì sao không làm được bằng plugin.
3. Chờ quyết định. Nếu được cho phép, ghi ngoại lệ đó vào [MY-CHANGES.md](../../MY-CHANGES.md) kèm
   đánh đổi đã chấp nhận.

Gần như mọi trường hợp đều có lối đi bằng plugin. Hệ thống cordis cho phép chèn, ghi đè, thay thế
từng dòng cấu hình của upstream **mà không sửa file nào của họ** — xem
[plugins/README.md](../../plugins/README.md).

## Kiểm tra ranh giới còn nguyên

Chạy `/kiem-tra-ranh-gioi`. Ba dấu hiệu cho biết mã gốc còn sạch:

```bash
cd _upstream_dsh && git status --porcelain    # rỗng = chưa ai đụng
find engine/node_modules/@deepseek-ai -type f -printf "%TY-%Tm-%Td %TH:%TM\n" | sort -u
                                              # một mốc thời gian duy nhất = chưa ai sửa sau khi cài
grep -m1 '"version"' engine/node_modules/@deepseek-ai/dsh/package.json
                                              # phải khớp số ghim trong engine/package.json
```
