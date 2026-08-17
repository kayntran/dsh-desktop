---
paths: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs", "**/*.cjs", "**/*.css"]
description: Mã là tiếng Anh, tài liệu là tiếng Việt. Danh sách sai-đúng, và cách hook cưỡng chế.
---

# Bên trong mã: tiếng Anh. Tài liệu và đối thoại: tiếng Việt.

Một ranh giới, không có vùng xám:

| Thứ này | Ngôn ngữ | Ví dụ |
|---|---|---|
| Tên hàm, kiểu, biến, hằng | **Tiếng Anh** | `restack`, `TabStatus`, `driver`, `MAX_PENDING` |
| Tên file, tên thư mục | **Tiếng Anh** | `browser-stage.ts`, `net-policy.ts` |
| **Chú thích trong mã** | **Tiếng Anh** | `// Background tab is covered, not hidden — capturePage() hangs when truly hidden.` |
| **Chữ hiện trên màn hình** | **Tiếng Anh** | `'Close panel'`, `aria-label="Address"` |
| **Câu lỗi gửi cho người dùng hoặc model** | **Tiếng Anh** | `throw new Error('Only http and https are allowed.')` |
| Trường trong JSON đi trên dây | **Tiếng Anh** | `{ t: 'call', id, cmd, params }` |
| Đường dẫn HTTP, tên query | **Tiếng Anh** | `/hdw/bus/probe?open=…` |
| Class CSS | **Tiếng Anh** | `.hdw-tabbar`, `.hdw-webview` |
| Tài liệu `.md` | **Tiếng Việt** | CLAUDE.md, MY-CHANGES.md, chính file này |
| Câu trả lời gửi chủ dự án | **Tiếng Việt** | mọi lời giải thích trong hội thoại |

## Vì sao

**Chữ trên màn hình phải khớp với app.** Giao diện do DeepSeek dựng là tiếng Anh — "Settings",
"General", "Plugins". Một nhãn tiếng Việt chen vào giữa chúng làm app trông chắp vá, đúng loại lệch
tông mà Luật 4 sinh ra để chống.

**Tên và chú thích phải khớp với mã xung quanh.** Chúng đứng cạnh tên của thư viện, của framework, của
chính engine DeepSeek. `const taiXe = clients.find(...)` bắt người đọc nhảy qua nhảy lại giữa hai
ngôn ngữ trong cùng một biểu thức; một chú thích tiếng Việt trên một hàm tiếng Anh cũng vậy.

Ba hệ quả thật, không phải chuyện thẩm mỹ:

- **Không tra cứu được.** `xepChong` không ra kết quả nào trên mạng; `restack` thì có.
- **Không ai khác đọc nổi.** Một lập trình viên được nhờ xem giúp đọc được cả mã lẫn chú thích.
- **Trộn với API của thư viện thành cẩu thả.** `stage.setActive(id, traoBanPhim)` — nửa tên hàm
  tiếng Anh, nửa tham số tiếng Việt, trong cùng một lời gọi.

**Phần giải thích cho chủ dự án vẫn là tiếng Việt** — nhưng nó thuộc tài liệu `.md` và hội thoại, chứ
không nằm trong file mã.

## Một ngoại lệ có chủ ý: chữ mà bộ kiểm in ra

`scripts/spike-*.mjs|cjs` in báo cáo kết quả **cho chủ dự án đọc**, không phải cho người dùng app.
Phần chữ in ra terminal ở đó giữ **tiếng Việt** — nó là câu trả lời trong hội thoại, chỉ tình cờ đi
qua stdout. Chú thích trong chính các file đó vẫn theo luật chung.

## Đổi luật ngày 2026-08-17

Trước ngày này, luật ngược lại: chú thích và chữ trên màn hình bằng **tiếng Việt**. Chủ dự án đổi vì
lý do ở trên.

**Dọn xong cùng ngày:** `src/main/` và `plugins/dock/` nay không còn một chữ tiếng Việt nào — chú
thích, câu lỗi, nhãn trên màn hình, chú thích trong `tsconfig.json` và `cordis.patch.yml`. Dịch tay
từng khối chứ không bằng regex: các khối `@module` ở đó ghi lại *vì sao* từng quyết định được chọn,
và dịch máy làm mất đúng phần đó. Ba chỗ chú thích đã nói sai so với mã thì sửa chứ không dịch.

Cùng lượt đó, **mười chỗ tiếng Việt vẫn đang hiện trên màn hình** mới lộ ra: năm câu lỗi khi engine
không khởi động được (màn hình đầu tiên của một người cài lỗi), ba chỗ `'không rõ'` ở màn hình About,
tên tab khi chặn chuyển hướng, và tên file ảnh đính kèm. Bài học: *"đã dịch giao diện"* không có
nghĩa là đã dịch hết chữ người dùng thấy — chữ dựng ở lớp vỏ rồi bơm vào một trang tiếng Anh vẫn là
chữ trên màn hình.

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

`scripts/` đang dọn dần. Xong: `spike-pty.mjs`, `spike-pty-route.mjs`, `spike-stage-order.cjs`,
`spike-surface.cjs`; `spike-switch-ui.cjs` sinh ra đã là tiếng Anh. Còn lại 15 file.

Hai file khó nhất, cố ý để sau cùng:

- **`spike-dock-ui.cjs`** — khoảng 120 tên tiếng Việt, và nó chính là cái lưới dùng để nghiệm thu mọi
  thay đổi khác. Đổi tên ở đó phải chạy lại `npm run spike:dock` (62 mục) ngay sau, theo từng đợt nhỏ.
- **`spike-webview.cjs`** — tên tiếng Việt nằm cả trong chuỗi HTML của trang thử (`nut`, `san`,
  `con-nguyen`), và chính các mục kiểm dò đúng những chuỗi đó. Đổi một bên mà quên bên kia thì mục
  kiểm đỏ mà không nói được vì sao.

Nguyên tắc khi dọn: **chữ in ra terminal giữ tiếng Việt** (xem mục ngoại lệ ở trên), biến môi trường
`HDW_*` giữ nguyên tên vì chủ dự án gõ tay chúng, và mỗi file dọn xong thì chạy lại đúng bộ kiểm của
nó trước khi sang file sau. Hook vẫn gác mọi tên mới thêm vào.
