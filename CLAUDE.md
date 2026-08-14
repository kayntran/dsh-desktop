# Luật của dự án này

Trả lời bằng **tiếng Việt**. Tên file, tên hàm, tên vị trí giao diện giữ nguyên tiếng Anh.

## Dự án này là gì

Harness Desktop là một **lớp vỏ Electron mỏng** bọc quanh engine `@deepseek-ai/dsh` — một agent
harness mã nguồn mở của DeepSeek. Engine được tải nguyên bản từ npm và ghim phiên bản trong
[engine/package.json](engine/package.json); lớp vỏ ở [src/main/](src/main/) chỉ lo cửa sổ, khay hệ
thống, thông báo Windows và vòng đời tiến trình.

`_upstream_dsh/` là **bản clone chỉ để tra cứu**, không thuộc mã của dự án và không được đóng gói.

Chủ dự án không đọc code. Mọi quyết định kỹ thuật phải được giải thích theo hướng *người dùng app sẽ
thấy gì*, và những quyết định không thể hoàn tác phải được hỏi trước.

## Nguyên tắc gốc: everything is a plugin

Upstream tự dựng app của họ theo đúng cách này — giao diện web, CLI, vòng lặp agent đều là plugin,
ghép lại bằng các lớp cấu hình. Hai bộ họ phát hành sẵn (`dsh-base`, `dsh-web-app`) chỉ là các lớp
cấu hình, không có đặc quyền gì hơn plugin của chúng ta.

Nghĩa là: **mọi thứ chúng ta thêm vào đều là plugin.** Không có lý do chính đáng nào để sửa mã gốc.

---

## Luật 1 — Mã gốc là bất khả xâm phạm

Không bao giờ ghi vào những nơi sau:

| Đường dẫn | Là gì |
|---|---|
| `_upstream_dsh/` | Bản clone mã nguồn DeepSeek, chỉ để đọc |
| `node_modules/` | Phụ thuộc của lớp vỏ |
| `engine/node_modules/` | Engine dsh tải từ npm |
| `runtime/` | Node runtime tải từ nodejs.org |

Hệ thống đã chặn cứng bằng hook ([.claude/hooks/guard-upstream.mjs](.claude/hooks/guard-upstream.mjs))
và bằng `permissions.deny` trong [.claude/settings.json](.claude/settings.json). Nếu bị chặn, **đó
không phải lỗi cần đi vòng** — hãy dừng lại, giải thích cho chủ dự án vì sao lại cần sửa mã gốc, và
chờ quyết định. Không tự tìm cách lách qua.

Lớp chặn cho lệnh shell chỉ bắt các mẫu ghi đè thường gặp (`sed -i`, chuyển hướng `>`, `tee`), không
phải mọi cách viết file. Đừng coi việc lách được là được phép.

Ngoại lệ hợp lệ duy nhất: `npm install` / `npm ci` / `npm run engine:install` — đó là đường nâng cấp
engine chính thức, và nó ghi vào `engine/node_modules/`.

## Luật 2 — Code mới đặt trong `plugins/`

Mỗi tính năng là một thư mục con `plugins/<tên>/`. Xem [plugins/README.md](plugins/README.md).

Chỉ sửa [src/main/](src/main/) khi việc đó **thật sự thuộc về lớp vỏ**: hành vi cửa sổ, khay hệ
thống, thông báo Windows, cập nhật app, vòng đời tiến trình engine. Mọi thứ liên quan tới nội dung,
công cụ, giao diện bên trong app đều thuộc về plugin.

## Luật 3 — Giao diện chỉ được cộng thêm

Upstream chừa sẵn rất nhiều vị trí để cắm thêm. **Chỉ được dùng những vị trí này:**

| Khu vực | Vị trí |
|---|---|
| Toàn cửa sổ | `shell.overlay` |
| Thanh bên | `sidebar.footer.action` |
| Đầu khung hội thoại | `conversation.session.header.actions`, `conversation.session.header.utilities` |
| Nội dung hội thoại | `conversation.view`, `conversation.chat.assistant-actions` |
| Khu vực ô nhập | `conversation.input.dock`, `conversation.composer.dock`, `conversation.input.left`, `conversation.input.right`, `conversation.input.overlay` |
| Cài đặt | `settings.section`, `settings.general.item`, `settings.action`, `settings.plugins.tab`, `settings.plugin.item`, `settings.onboarding` |
| Theo tên | `tool.call.toolview` (theo tên tool của **chúng ta**), `conversation.chat.commandview` |
| Chen có chọn lọc | `conversation.composer`, `conversation.chat.turnTail` |

**CẤM** đăng ký vào các vị trí sau — chúng đang có chủ, và đăng ký vào đó là thay thế cả một vùng:

`sidebar` · `conversation` · `details` · `conversation.session` · `conversation.session.header` ·
`conversation.details.tool` · `conversation.composer.bar`

Lý do lệnh cấm này tồn tại: thay thế cả vùng **không gây ra lỗi nào**. Merge vẫn sạch, typecheck vẫn
xanh, app vẫn chạy. Thứ mất đi là mọi cải tiến tương lai của vùng đó, và không có gì báo cho chủ dự
án biết. Nếu một yêu cầu có vẻ bắt buộc phải thay cả vùng, **dừng lại và nói ra** thay vì tự làm.

Muốn có một trang riêng: `conversation.view` (tab mới trong phiên), `settings.section` (trang cài
đặt), hoặc `shell.overlay` (panel toàn màn hình mở từ nút ở `sidebar.footer.action`).

## Luật 4 — Không sửa CSS của upstream

Đổi giao diện bằng cách ghi đè biến thiết kế `--dsw-*` trong CSS của riêng chúng ta. Bảng biến gốc:
`_upstream_dsh/packages/client/ui-theme/src/styles/design-platform.css`.

Dùng lại component có sẵn ở `_upstream_dsh/packages/client/ui-primitives/src/` (Button, Modal, Menu,
Tooltip, Pill, Toast, JsonTree, DiffBlock, TerminalBlock…) để giao diện mới không lệch tông và tự
chạy theo chế độ sáng/tối.

## Luật 5 — Khai báo mức mỗi khi đụng giao diện

Mỗi lần thêm hoặc sửa giao diện, nói rõ đang làm ở mức nào:

- **Mức 1 — cộng thêm.** Cắm vào một vị trí trong bảng trên. Không mất gì.
- **Mức 2 — chen có chọn lọc.** `conversation.composer` hoặc `conversation.chat.turnTail`: nhận
  đúng trường hợp của mình, phần còn lại vẫn dùng giao diện gốc.
- **Mức 3 — thay thế cả vùng.** **Cấm.** Nếu tin rằng không còn cách nào khác, dừng lại và hỏi.

## Luật 6 — Ghi sổ

`MY-CHANGES.md` là sổ ghi **có chọn lọc**, do bạn viết. Ghi vào đó khi:

- Thêm một tính năng mới (một dòng: tên, nằm ở đâu, cắm vào vị trí nào)
- Có quyết định kiến trúc đáng nhớ
- Chủ dự án cho phép một ngoại lệ so với bộ luật này

Đừng ghi những thay đổi vụn vặt — `.claude/change-log.txt` đã tự ghi nhật ký thô rồi, và git giữ
lịch sử đầy đủ.

---

## Quy trình nâng cấp engine

Engine ghim ở `@deepseek-ai/dsh` phiên bản `0.1.0-rc.6`. Upstream đang ở giai đoạn `rc`, API còn đổi
nhiều. Cách nâng:

```bash
git checkout -b nang-cap-engine     # nhánh riêng = đường quay lui
# đổi số version trong engine/package.json
npm run engine:install
npm run typecheck
npm run dev                          # mở app, bấm thử
```

Xanh hết thì merge vào `main`. Hỏng thì `git checkout main`, coi như chưa có gì xảy ra.

Trước khi nâng, có thể `git pull` trong `_upstream_dsh/` rồi đọc phần đã đổi. Đọc để hiểu ý đồ, không
phải để chép tay.

## Lệnh hay dùng

| Lệnh | Việc |
|---|---|
| `npm run typecheck` | Kiểm lỗi kiểu, không sinh file |
| `npm run dev` | Build rồi mở app |
| `npm run dist` | Đóng gói bản cài đặt |
| `npm run engine:install` | Cài lại engine theo phiên bản đã ghim |
