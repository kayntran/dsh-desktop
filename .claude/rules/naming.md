---
paths: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs", "**/*.cjs", "**/*.css"]
description: Tiếng Việt ở đâu, tiếng Anh ở đâu. Danh sách sai-đúng, và cách hook cưỡng chế.
---

# Đặt tên: tiếng Anh. Chú thích: tiếng Việt.

Một ranh giới, không có vùng xám:

| Thứ này | Ngôn ngữ | Ví dụ |
|---|---|---|
| Chú thích trong mã | **Tiếng Việt** | `// Tab nền bị che chứ không bị ẩn — capturePage() treo khi bị ẩn thật.` |
| Tài liệu `.md` | **Tiếng Việt** | CLAUDE.md, MY-CHANGES.md, chính file này |
| Chữ hiện trên màn hình | **Tiếng Việt** | `'Đóng panel'`, `aria-label="Địa chỉ"` |
| Câu lỗi gửi cho người dùng hoặc model | **Tiếng Việt** | `throw new Error('Chỉ cho phép http và https.')` |
| Tên hàm, kiểu, biến, hằng | **Tiếng Anh** | `restack`, `TabStatus`, `driver`, `MAX_PENDING` |
| Tên file, tên thư mục | **Tiếng Anh** | `browser-stage.ts`, `net-policy.ts` |
| Trường trong JSON đi trên dây | **Tiếng Anh** | `{ t: 'call', id, cmd, params }` |
| Đường dẫn HTTP, tên query | **Tiếng Anh** | `/hdw/bus/probe?open=…` |
| Class CSS | **Tiếng Anh** | `.hdw-tabbar`, `.hdw-webview` |

Chú thích tiếng Việt là phần **đúng luật và có giá trị nhất** trong repo này — chúng ghi lại vì sao
một quyết định được chọn, thứ mà mã không tự nói được. **Đừng bao giờ dịch chúng sang tiếng Anh** để
"cho đồng bộ".

## Vì sao

Chủ dự án đọc tiếng Việt, nên phần giải thích phải bằng tiếng Việt. Nhưng **tên thì không phải phần
giải thích** — nó là thứ đứng cạnh tên của thư viện, của framework, của chính engine DeepSeek. Một
dòng như `const taiXe = clients.find(...)` bắt người đọc nhảy qua nhảy lại giữa hai ngôn ngữ trong
cùng một biểu thức.

Ba hệ quả thật, không phải chuyện thẩm mỹ:

- **Không tra cứu được.** `xepChong` không ra kết quả nào trên mạng; `restack` thì có.
- **Không ai khác đọc nổi.** Một lập trình viên được nhờ xem giúp sẽ đọc code trước, chú thích sau.
- **Trộn với API của thư viện thành cẩu thả.** `stage.setActive(id, traoBanPhim)` — nửa tên hàm
  tiếng Anh, nửa tham số tiếng Việt, trong cùng một lời gọi.

## Sai — đúng, lấy từ chính dự án này

| Đã từng viết | Phải là |
|---|---|
| `moCau()` | `openBridge()` |
| `xepChong()` | `restack()` |
| `banGiaoTieuDiem()` | `handOffFocus()` |
| `chonTaiXe()` / `taiXe` | `pickDriver()` / `driver` |
| `laUrlCongCong()` | `isPublicUrl()` |
| `batBuocUrlCongCong()` | `assertPublicUrl()` |
| `chuanHoaUrl()` | `normalizeUrl()` |
| `ketThuc()` / `huyHet()` | `settle()` / `failAll()` |
| `MAX_DANG_CHO` / `NHIP_TIM_MS` | `MAX_PENDING` / `HEARTBEAT_MS` |
| `{ t: 'goi', lenh, tham_so }` | `{ t: 'call', cmd, params }` |
| `{ t: 'xong', ket_qua }` | `{ t: 'done', result }` |
| `{ t: 'loi', ly_do }` | `{ t: 'error', reason }` |
| `/hdw/bus/thu?mo=` | `/hdw/bus/probe?open=` |
| `<Tab an={...} batDau={...} />` | `<Tab isHidden={...} startUrl={...} />` |

## Hook cưỡng chế

`.claude/hooks/guard-naming.mjs`, chạy ở `PreToolUse` trên `Write`/`Edit`.

Nó chỉ soi **nội dung sắp ghi**, và trong đó chỉ soi **tên được khai báo mới**. Nên sửa một dòng
trong file cũ còn tên tiếng Việt vẫn qua được — hook gác dòng mới, không bắt dọn cả file. Chỉ soi
file mã; `.md`, `.json`, `.yml` được phép mang tiếng Việt thoải mái.

**Cách nó dò:** cắt tên thành từng đoạn theo camelCase và gạch dưới (`handOffFocus` → `hand`, `off`,
`focus`), rồi so từng đoạn với một danh sách tiếng Việt. So **bằng nhau**, không so chuỗi con.

Chi tiết đó không phải trang trí: bản đầu tiên so chuỗi con và chặn oan `handler`,
`NotifierHandlers`, `reapOrphanEngine` — vì `han` nằm trong cả ba. Phép thử bắt được ngay, và nó dạy
đúng một bài học: **một rào chặn oan là một rào sẽ bị tắt.**

**Giới hạn, nói thẳng:** đây là danh sách tiếng, không phải từ điển. Nó bắt được lớp từ vựng đã tái
diễn trong dự án này và sẽ bỏ lọt tiếng mới. Bỏ lọt thì thêm vào `SYLLABLES` — đó là cách nó lớn
lên. Danh sách cũng cố ý **bỏ** những tiếng trùng từ tiếng Anh hoặc trùng viết tắt thông dụng
(`ban`, `can`, `con`, `gui`, `hop`, `sat`, `so`, `tin`), và bỏ mọi tiếng dưới ba chữ.

## Tự rà một lượt

Liệt kê mọi tên được khai báo, rồi tự đọc lướt:

```bash
grep -rhoE "\b(function|const|let|var|interface|type|class) +[A-Za-z_][A-Za-z0-9_]*" --include=*.ts --include=*.tsx plugins/dock/src src/main | awk '{print $2}' | sort -u
```

Kiểm hook không chặn oan — chạy nó lên chính mã hiện có, phải không ra dòng nào:

```bash
for f in $(ls plugins/dock/src/*.ts plugins/dock/src/client/* src/main/*.ts); do node -e "const fs=require('fs');process.stdout.write(JSON.stringify({tool_name:'Write',tool_input:{file_path:process.argv[1],content:fs.readFileSync(process.argv[1],'utf8')}}))" "$f" | node .claude/hooks/guard-naming.mjs; done
```

## Chỗ còn lệch

`scripts/spike-*.cjs|mjs` vẫn còn tên tiếng Việt. Cố ý để lại: đó là mã kiểm không có bộ kiểm kiểu
nào bắt lỗi, nên đổi tên hàng loạt bằng regex ở đó là cách chắc chắn nhất để làm hỏng chính cái lưới
an toàn dùng để nghiệm thu mọi thay đổi khác. Dọn dần **trong lúc** sửa từng file, mỗi đợt chạy lại
`npm run spike:dock` ngay sau đó. Hook vẫn gác mọi tên mới thêm vào chúng.
