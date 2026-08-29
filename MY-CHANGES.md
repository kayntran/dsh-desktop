# Sổ thay đổi

Ghi chép **có chọn lọc** về những gì đã thêm vào app và vì sao. Đây là thứ giải thích được dự án sau
sáu tháng, khi không ai còn nhớ.

Không ghi vào đây những sửa đổi vụn vặt — `.claude/change-log.txt` đã tự ghi nhật ký thô, và git giữ
lịch sử đầy đủ.

**Ghi vào đây khi:**

- Thêm một tính năng mới → tên tính năng, nằm ở thư mục nào, cắm vào vị trí giao diện nào
- Có một quyết định kiến trúc đáng nhớ → quyết định gì, vì sao chọn vậy
- Chủ dự án cho phép một ngoại lệ so với [CLAUDE.md](CLAUDE.md) → ngoại lệ gì, đánh đổi điều gì

**Mẫu một dòng:**

```
## 2026-08-14 — Tên việc
Làm gì, ở đâu (đường dẫn), cắm vào vị trí nào, mức mấy.
Vì sao: ...
```

---

## 2026-08-14 — Dựng bộ luật và lưới an toàn

Khởi tạo git (trước đó dự án không có lịch sử, không có đường quay lui). Thêm `CLAUDE.md` làm bộ
luật, `.claude/hooks/` chặn cứng mọi thao tác ghi vào mã gốc của DeepSeek, và ba hook phụ trợ:
nhắc luật đầu phiên, tự kiểm lỗi kiểu sau khi sửa code, ghi nhật ký thô.

Vì sao: chủ dự án không đọc code, nên rủi ro lớn nhất là AI âm thầm sửa vào mã gốc hoặc thay thế
cả một vùng giao diện — cả hai đều không gây lỗi, nên sẽ không bị phát hiện. Luật ghi trong file
thì AI có thể quên giữa phiên dài; hook thì không quên.

## 2026-08-14 — Tách tài liệu thành ba tầng

`CLAUDE.md` rút từ 150 xuống 75 dòng, chỉ còn phần cốt lõi và bảng định tuyến. Chi tiết dời vào
`.claude/rules/` (`ui-slots.md`, `upstream-boundary.md`), quy trình lặp lại thành skill
(`them-tinh-nang`, `nang-cap-engine`, `kiem-tra-ranh-gioi`) và lệnh `/commit`.

Vì sao: `CLAUDE.md` được nạp toàn bộ mỗi phiên. Bảng 17 vị trí giao diện chỉ hữu ích khi đang làm
giao diện, nhưng trước đó chiếm chỗ mọi lúc — mà khi ngữ cảnh đầy thì thứ bị quên đầu tiên thường
là luật. Khớp luôn với cách tổ chức đang dùng ở các dự án khác của chủ dự án.

## 2026-08-14 — Luật bắt buộc dùng vật liệu giao diện của hệ thống

Luật 4 đổi từ "không sửa CSS của upstream" thành "dùng component/icon/biến màu của upstream, cấm
tự vẽ lại thứ đã có". Chi tiết ở `.claude/rules/ui-toolkit.md`: 25 component, 70 icon, 78 biến màu
`--dsw-alias-*`, kèm bảng "cần gì → dùng gì".

Đã xác nhận **mọi gói giao diện của upstream đều nằm trong `engine/node_modules/@deepseek-ai/`** —
plugin import trực tiếp được, nên luật này thi hành được chứ không phải nói suông.

Vì sao: tự vẽ lại nút hay hộp thoại không gây lỗi nào, chỉ làm app lệch tông dần, mất chế độ
sáng/tối, và mất khả năng dùng bàn phím. Không có gì báo — đúng loại hỏng im lặng mà bộ luật này
sinh ra để chống.

**Còn treo:** chưa xác nhận cách khai `react`/`react-dom` là external khi đóng gói plugin giao
diện. Hai bản React trong một trang làm hook vỡ. Kiểm lại khi dựng plugin giao diện đầu tiên.

## 2026-08-15 — Panel trái Files/Terminal/Browser: hai spike trước khi viết code

Bắt đầu plugin đầu tiên của dự án (`plugins/dock/`, tên gói `harness-desktop-dock`) — panel bên
trái có ba tab, cắm vào `shell.overlay` và `sidebar.footer.action`, **mức 1**. Kế hoạch đầy đủ ở
`~/.claude/plans/t-i-c-n-th-m-1-lazy-papert.md`.

Giai đoạn 0 là hai spike, viết trước mọi dòng code sản phẩm. Cả hai đều xanh, và chúng trả lời
được những câu mà đọc code không trả lời nổi:

**`npm run spike:plugin`** — plugin ngoài cây có nửa giao diện thì **tên trong `cordis.patch.yml`
phải là tên gói, không được là đường dẫn file**, và gói phải phân giải được từ thư mục profile.
Sai chỗ này thì nửa Node vẫn chạy, engine không báo gì, mà panel đơn giản là không bao giờ hiện —
đúng loại hỏng im lặng mà bộ luật sinh ra để chống, nên nó phải bị bắt bằng phép thử.
Đo được: junction đặt ở `~/.dsh/profiles/node_modules/` hay `~/.dsh/profiles/web/node_modules/`
đều chạy. Chọn chỗ đầu vì đó là cây do thượng nguồn tự chữa theo lối chỉ-thêm-không-xoá, còn chỗ
sau là địa bàn pnpm và bị dọn khi người dùng chạy `dsh plugin add`.

**`npm run spike:webview`** — 12 mục, tất cả đạt. Ba kết quả đổi được quyết định thiết kế:

- Thẻ `<webview>` **chạy được** trong đúng cấu hình cửa sổ của app, với trang nhúng nạp từ
  `http://127.0.0.1`. Đây là mục quyết định: nhờ nó mà phần Browser — kể cả việc agent bấm, gõ,
  đọc trang — nằm trọn trong plugin, không cần lớp CDP ở tiến trình chính như app tham chiếu
  (app đó tốn ~2500 dòng cho riêng việc này).
- **Giấu tab nền bằng `visibility:hidden` hoặc đẩy ra ngoài màn hình thì `capturePage()` TREO**
  vĩnh viễn — không trả ảnh rỗng, không ném lỗi. Bị một lớp khác che kín thì vẫn chụp được bình
  thường. Nên stage xếp chồng các tab và để tab trên che tab dưới; và mọi lệnh chụp phải có hạn
  giờ, nếu không một tool của agent sẽ treo mãi.
- `sendInputEvent` nhận toạ độ CSS pixel và **đúng ngay ở màn hình 137.5%**, không phải quy đổi
  theo `zoomFactor`. Nhưng ảnh của `capturePage()` là pixel vật lý (800×500 CSS → 1100×688), nên
  khi map toạ độ từ ảnh ngược về trang thì phải chia lại.

Ghi thêm hai điều nhỏ: `window.open` bị chặn từ trước khi tới `setWindowOpenHandler` khi
`allowpopups` tắt — muốn agent mở tab mới từ `target=_blank` thì phải bật rồi mới chặn bằng
handler. Và trên Electron 40, đổi cha thẻ `<webview>` **không** huỷ guest như tài liệu cũ mô tả;
dù vậy vẫn giữ thiết kế "stage nằm ngoài React", vì mối nguy thật là React unmount chứ không phải
đổi cha.

**Bẫy môi trường:** terminal tích hợp của VS Code đặt sẵn `ELECTRON_RUN_AS_NODE=1`, biến
`electron.exe` thành node.exe thường — không cửa sổ, `require('electron')` trả gói npm rỗng, mọi
API undefined mà không nói vì sao. `scripts/spike-webview.cjs` tự nhận ra và khởi động lại với môi
trường đã dọn. `npm run dev` chạy từ terminal đó cũng sẽ dính bẫy này.

## 2026-08-15 — Giai đoạn 1: khung plugin, vỏ panel, tab Files

Plugin `plugins/dock/` (gói `harness-desktop-dock`) đã chạy trong app. **Mức 1** — hai đăng ký, cả
hai vào slot loại `list` đang trống: `shell.overlay` (panel) và `sidebar.footer.action` (nút bật/tắt
ở chân thanh bên). Không chiếm slot nào có chủ.

**Cách panel thành một cột thật mà không sửa gì của upstream.** Panel dựng bằng `position: fixed`
bám mép trái, còn khung ba cột của app co lại nhờ một quy tắc CSS **của riêng ta**:
`#root { padding-left: var(--hdw-dock-w) }`. `#root` chỉ khai `height: 100%`, không position không
transform, nên chèn padding vào đó là đủ. Đóng panel → biến về `0px`, app trở lại y nguyên, không
còn dấu vết. Đã chụp màn hình xác nhận bốn cột nằm cạnh nhau, không cột nào bị che.

**Đóng lại mục "Còn treo" về React.** `react`/`react-dom` là external **theo hợp đồng của
upstream**: trình nạp cấp chúng qua bảng module đóng băng của shell, và bundle chỉ là một classic
script gọi `window.__ModuleLoader__.load({ id, factory })`. Danh sách external chép từ
`PLATFORM_MODULES` (`web/src/platform.ts`) cộng ngoại lệ `dsh-client-runtime/client`.
`plugins/dock/build.mjs` có **chốt chặn tự động**: build đỏ nếu một external bị nhồi vào bundle
hoặc thấy dấu vết bản React thứ hai — hỏng kiểu này chỉ hiện ra dưới dạng màn hình trắng, nên phải
bắt lúc build chứ không lúc chạy.

**Bốn thứ tự dựng vì upstream không có** (đã kiểm `ui-primitives/src/index.ts`, Luật 4): thanh tab
(ghép từ `Button` + ARIA tablist), tay kéo đổi bề rộng (dựng lại theo `DragHandle` của
`AppFrame.tsx`), nút chỉ-có-icon, và cây thư mục. Mọi màu đều là biến `--dsw-alias-*`, không một mã
màu cứng nào. Nội dung file hiển thị bằng `ReadBlock` — đúng component upstream dùng cho việc đó.

**Tab Files dùng `ctx.fs` của upstream, không dùng `node:fs`.** Ngoài chuyện nó đã lo realpath,
giải mã UTF-8 và từ chối file nhị phân, lý do quan trọng hơn là nó cho **đúng cái nhìn mà agent
đang có** — người dùng và model thấy cùng một thứ. Rào: `root` phải phân giải ra đúng một workspace
đã đăng ký (so sau khi phân giải, không so chuỗi — `C:/x` và `C:\x` là một chỗ), `lstat` trước
`resolve` để chặn symlink thoát ra ngoài, rồi `contains` chốt lại. Đã thử: thoát ra `C:\Windows`
trả 403, root lạ trả 403, `Host` giả trả 403.

**Quan sát khi chạy thử, không phải lỗi:** mở panel trên cửa sổ hẹp thì thanh bên tự thu về dải
icon 56px. Đó là luật co giãn của chính upstream (`SIDEBAR_AUTO_COLLAPSE`) chứ không phải panel
đẩy hỏng — cửa sổ rộng thì thanh bên vẫn mở.

**Còn treo:** nút chép trong khối xem file hiện chữ Trung ("复制") vì trang khai `lang="zh-CN"`,
trong khi phần còn lại của app là tiếng Anh. Đó là component của upstream, không phải của ta.

## 2026-08-15 — Panel chuyển sang bên PHẢI

Chủ dự án ban đầu yêu cầu panel bên trái, sau khi nhìn thấy thật thì nhận ra mình nhầm và muốn nó
bên phải, giống app tham chiếu `D:\AI\DeepSeek Agentic AI`. Đã đổi.

Sửa đúng ba chỗ, vì thiết kế chỉ phụ thuộc vào một mép bám: `#root` đổi từ `padding-left` sang
`padding-right`, panel đổi từ `left: 0` sang `right: 0` (viền cũng đổi cạnh), và tay kéo chuyển
sang cạnh trái của panel — kèm **đảo dấu phép tính bề rộng**, vì bây giờ kéo sang trái mới là rộng
ra. Không đụng gì tới nửa Node, tới cách đăng ký slot, hay tới cấu trúc component.

Bộ icon của upstream chỉ có `IconPanelLeftOutline16`, không có bản bên phải. Thay vì tự vẽ một icon
mới (Luật 4), **lật ngang icon có sẵn bằng CSS** (`transform: scaleX(-1)`) — vẫn đúng nét, đúng cỡ,
và vẫn đi theo mọi lần upstream chỉnh lại icon đó.

Bài học đáng giữ: đặt panel ở `shell.overlay` cộng một biến CSS khiến việc đổi bên là ba dòng chứ
không phải một lần viết lại. Nếu trước đó đi đường thay thế cả vùng giao diện thì đây đã là một
ngày làm lại.

## 2026-08-15 — Nút panel lên header phiên, icon và tay kéo về đúng tông

Bốn chỗ chủ dự án chỉ ra sau khi nhìn bản chạy thật. Tất cả đều là mức 1.

**Nút mở/đóng chuyển từ `sidebar.footer.action` sang `conversation.session.header.utilities`** —
đúng chỗ app tham chiếu đặt nó (phần tử cuối cùng bên phải header khung chat). Cái bẫy ở đây đáng
ghi lại: slot header thuộc **phạm vi phiên**, còn panel thuộc **phạm vi cửa sổ**, mà `defineStore`
phát cho mỗi phạm vi một instance riêng — chuyển thẳng sẽ được một cái nút bấm không có gì xảy ra
và không lỗi nào báo. Cách đúng là `createSnapshotStore` dựng **một** kho ở tầng plugin rồi chuyền
cho cả hai đăng ký qua `inject`; đó là cơ chế thượng nguồn tự dùng cho plugin agent-preset của họ.
Persist vẫn của thượng nguồn, cùng khoá `hdw.dock`, nên trạng thái cũ vẫn đọc lại được.

Hệ quả nói trước: màn hình chưa mở phiên nào thì chưa có header, nên chưa có nút. App tham chiếu
cũng đúng như vậy.

**Icon Terminal**: `IconCodeOutline16` (dấu `#`) sang `IconApiOutline14`. Không phải tự vẽ — đó
chính là icon thượng nguồn dán lên mọi thẻ tool `bash` trong hội thoại (bảng `VARIANT_ICONS` trong
`GenericToolCard.tsx`), một khung bo tròn chứa `>` và `_`.

**Icon từng file** (`src/client/file-icon.tsx`, mới): sáu nhóm, toàn icon có sẵn — shell
`IconApiOutline14`, trang web `IconGlobeOutline14`, dữ liệu/cấu hình `IconDataOutline16`, văn bản
`IconListPenOutline16`, mã nguồn `IconCodeOutline16`, còn lại `IconPaperclipOutline16`. Bộ 70 icon
**không có icon file** vì trình duyệt thư mục của thượng nguồn chỉ liệt kê thư mục, không bao giờ
hiện file — nên đây là mượn có cân nhắc chứ không phải thiếu sót của họ.

**Tay kéo**: bỏ vạch chạy suốt chiều cao tô `--dsw-alias-brand-primary`. Biến đó ở chế độ sáng quy
về `--dsw-static-neutral-bluish-1000`, tức gần như đen tuyền, nên panel có một vệt đen dọc mà không
chỗ nào khác trong app có. Thay bằng đúng công thức của thượng nguồn cho tay kéo cột phải
(`AppFrame.module.css`): dải bắt chuột 8px không sơn màu, cộng viên thuốc 12×32 ở giữa chiều cao
chỉ hiện khi rê chuột hoặc đang kéo. Dải dùng `position: fixed` chứ không `absolute` để cưỡi lên
mép panel mà không bị `overflow: hidden` cắt mất nửa ngoài.

**Đo được về system prompt** (trả lời câu hỏi của chủ dự án, không sinh code dự án): prompt không
nằm ở file nào, nó ráp lại mỗi lượt theo `order`. Persona đặt trong `cordis.patch.yml` của gói
bundle web-app, dòng 16-19. `ctx.systemPrompt.assemble()` không có phạm vi agent chỉ ra lớp toàn
cục (5 mục, 0 tool); các mảnh tool chỉ vào khi ráp trong phạm vi một agent do web app dựng qua
composition của phiên, nên `agentLoop.create()` trần vẫn ra 0 tool.

## 2026-08-15 — Giai đoạn 2: tab Terminal

Terminal thật trong panel: có màu, Ctrl+C dừng được, chạy được lệnh dài. Mức 1 — không đăng ký slot
mới nào, chỉ thay chỗ giữ chỗ bên trong panel đã có.

**Không dùng `ctx.terminals` của thượng nguồn.** Service đó tồn tại nhưng là bề mặt PTY cho *model*,
không cho *người*: gửi theo dòng chứ không theo phím, không có luồng chảy về, không có `resize`,
chủ sở hữu bắt buộc là một `Agent`. Nên `node-pty` 1.1.0 làm phụ thuộc riêng của plugin.

**`useConptyDll: true`, không phải mặc định.** Đường `kill` của nhánh mặc định fork một tiến trình
phụ để liệt kê console, và tiến trình phụ đó ném `AttachConsole failed` kèm stack ra stderr **mỗi
lần đóng terminal** — log engine đầy vệt lỗi giả, và mỗi lần đóng treo thêm một timer 5 giây. Nhánh
conpty.dll không fork gì cả. `scripts/spike-pty.mjs` chạy có và không có `HDW_CONPTY_DLL=1` là thấy
ngay khác biệt.

**Giao thức WebSocket, một biệt hoá, không base64**: khung nhị phân = byte màn hình hai chiều, khung
văn bản = JSON điều khiển (`resize` lên; `ready`/`exit`/`error` xuống). Tách theo *loại khung* chứ
không theo tiền tố trong nội dung, nên không chuỗi nào người dùng gõ bị hiểu nhầm thành lệnh.

**Terminal luôn nền tối, kể cả khi app ở chế độ sáng — quyết định có cân nhắc, không phải bỏ sót.**
Bảng 16 màu ANSI mà `npm`, `git`, `dir` dùng không có trong hệ token của DeepSeek: họ chỉ có amber,
blue, green, red, neutral — thiếu hẳn cyan và magenta, nên không map đủ. Hai lối: tự bịa một bảng 16
màu, hoặc dùng bảng mặc định của xterm. Bảng mặc định vẽ cho nền tối; đặt lên nền trắng thì "trắng
sáng" và "vàng sáng" gần như tàng hình. Chọn cách không bịa màu nào: giữ mặt terminal tối bằng chính
token `--dsw-static-*` (nhóm này cố ý không đổi theo sáng/tối), khung viền quanh vẫn theo chủ đề.
Đổi sang bám chủ đề là một dòng CSS, nếu chủ dự án muốn.

**Terminal không bị tháo khi chuyển tab, chỉ ẩn.** Tháo ra là đóng WebSocket, mà đóng WebSocket là
giết shell — liếc sang tab Files một cái sẽ giết mất `npm run dev` đang chạy dở. Đổi lại nó chỉ được
dựng khi người dùng thật sự vào tab Terminal lần đầu.

**Rào workspace tách ra `src/workspace-guard.ts`**, dùng chung cho cả tab Files lẫn tab Terminal.
Một rào an ninh bị chép làm hai bản là một rào sớm muộn lệch nhau.

**Đo được, dễ hiểu nhầm thành rào thủng**: dòng URL readiness của engine in ra **sớm hơn** lúc
registry workspace sẵn sàng (nó có hai phụ thuộc khởi động riêng). Hỏi ngay lúc thấy URL là gặp một
registry còn rỗng, và mọi đường dẫn đều bị từ chối — trông y hệt như rào hỏng ngược. `spike-pty-route.mjs`
vì vậy chờ tới khi `/hdw/fs/list` trả 200 rồi mới kiểm.

**Đo được về chụp màn hình khi phát triển**: `CopyFromScreen` chép pixel *đang hiển thị*, nên nếu
cửa sổ app nằm dưới cửa sổ khác thì ảnh ra là nội dung cửa sổ kia — đó là nguyên nhân thật của mấy
lần "chụp nhầm cửa sổ", bộ lọc tiến trình vẫn đúng. `PrintWindow` với cờ `PW_RENDERFULLCONTENT`
(0x2, bắt buộc với cửa sổ Chromium) đọc thẳng bộ đệm vẽ của chính cửa sổ đó, không cần kéo nó lên,
nên cũng không cướp tiêu điểm của người đang dùng máy. Ngược lại, **bấm chuột bằng máy thì không
có đường sạch**: Windows từ chối cho tiến trình nền đổi tiền cảnh kể cả sau `AttachThreadInput`, và
`PostMessage` thông điệp chuột vào `Chrome_RenderWidgetHostHWND` bị Chromium bỏ qua.

### Còn treo — cần chủ dự án quyết

**Panel quên hết trạng thái sau mỗi lần mở lại app.** `src/main/engine.ts:166` khởi động engine với
`--port 0`, tức xin hệ điều hành cấp cổng bất kỳ. Cổng đổi thì gốc trang đổi (`http://127.0.0.1:<cổng>`),
mà trình duyệt khoá `localStorage` theo gốc — nên bề rộng panel, tab đang chọn, trạng thái mở đều
mất. Bằng chứng: `Local Storage/leveldb` của app đang giữ **13 gốc khác nhau**, mỗi lần mở app một
cái. Điều này ảnh hưởng cả trạng thái mà thượng nguồn tự lưu, không riêng panel. Cách chữa là ghim
một cổng cố định, đánh đổi là phải xử lý khi cổng đó đã có người dùng. Chưa làm — nằm ngoài phạm vi
giai đoạn 2 và thuộc lớp vỏ. **Chủ dự án đã quyết: không cần sửa**, không có nhu cầu nhớ bề rộng
hay tab đang chọn qua các lần mở app.

## 2026-08-15 — Giai đoạn 3 (phần 1): trình duyệt trong panel

Chủ dự án yêu cầu học kỹ `D:\AI\DeepSeek Agentic AI` — dự án đó đã được thiết kế giống trình duyệt
của app Claude. Phần dưới ghi cả cái học được lẫn chỗ cố ý làm khác.

**Đổi sang dải pill động, bỏ ba tab cố định.** Files, từng terminal, từng trang web nay là một
`Pane` ngang hàng trong một danh sách duy nhất. Chủ dự án hỏi làm vậy có phải tự chế nhiều quá
không — kiểm rồi, **ngược lại**: `Pill` là component có sẵn của thượng nguồn và chú thích trong mã
của họ ghi đúng công dụng *"view switcher tabs"*; nút `+` dùng `Menu` có sẵn; thanh địa chỉ dùng
`Input` có sẵn; đủ 9 icon cần thiết. Bản ba tab cũ mới là bản phải bẻ `Button` thành tablist rồi tự
vẽ gạch chân. Đổi sang pill là **giảm** phần tự viết.

Lý do sâu hơn, học từ `browserStore.ts` của dự án tham chiếu: một danh sách và một chủ sở hữu. Bản
cũ sẽ có `tab` cố định cộng danh sách tab web riêng — hai mô tả về "đang xem cái gì", và hai mô tả
thì sớm muộn lệch nhau. Họ đã phải gỡ đúng lỗi đó.

**Lớp vỏ bật `webviewTag` cộng ba chốt an toàn** (`src/main/window.ts`): ép cấu hình guest ở
`will-attach-webview` (xoá preload, tắt nodeIntegration, bật sandbox, ép partition
`persist:hdw-browser`, bỏ `allowpopups`, tắt backgroundThrottling), chặn cửa sổ mới ở
`did-attach-webview`, và từ chối thẳng camera/micro/vị trí trên phiên duyệt web. Chốt phải nằm
ngoài tầm với của plugin — một chốt mà bên bị chặn tự đặt được thì không phải chốt.

**Webview sống NGOÀI cây React** (`browser-stage.ts`). Gỡ một `<webview>` khỏi DOM rồi cắm lại là
nạp lại trang từ đầu, mà React reconcile là chuyên gia gỡ-và-cắm-lại. React chỉ vẽ khung và chừa
một ô trống; sân khấu đo ô đó rồi bám theo. Đúng cách app tham chiếu đặt `bounds` cho
`WebContentsView`, kể cả mẹo nhỏ của họ: đo xong so với lần trước, giống thì thôi.

**Tab nền bị CHE, không bị ẩn — trái với kế hoạch ban đầu.** `spike-webview.cjs` đo được
`capturePage()` **treo vĩnh viễn** trên webview bị `visibility: hidden` hoặc bị đẩy ra ngoài khung
nhìn. Kế hoạch ghi `visibility: hidden`; làm theo thì lệnh chụp ảnh của agent nhắm vào tab nền sẽ
treo cả lượt hội thoại. Nay mọi tab xếp chồng một chỗ, tab đang xem `z-index: 1`, tab nền `0`.

**Sửa một lỗi của giai đoạn 2 phát hiện khi dựng phần này**: `DockPanel` trả `null` khi panel đóng,
tức **bấm đóng panel là giết luôn terminal đang chạy**. Nay panel chỉ ẩn; mọi pane vẫn sống.

**Khác dự án tham chiếu ở chỗ nào, và vì sao.** Họ dùng `WebContentsView` ở tiến trình chính; ta
dùng thẻ `<webview>` trong trang. Cái giá của đường họ đi được chính họ ghi lại trong
`browserVisibility.ts`: view gốc được vẽ ĐÈ LÊN MỌI LỚP HTML, nên mọi menu/hộp thoại của app chồng
lên vùng panel đều bị trang web che mất, và phải dựng cả một cơ chế "giữ chỗ" để tạm ẩn trang mỗi
lần mở menu. Thẻ `<webview>` nằm trong DOM nên theo `z-index` bình thường, không có vấn đề đó. Đổi
lại ta không có CDP — hệ quả ghi ở phần dưới.

**Công cụ mới, đáng giá hơn cả tính năng: `npm run spike:dock`.** Từ giai đoạn 1 tới giờ không có
cách nào kiểm giao diện bằng thao tác thật — Windows từ chối cho tiến trình nền giành tiêu điểm, và
gửi thông điệp chuột thẳng vào cửa sổ con của Chromium thì bị bỏ qua (đã thử cả hai). Cách gỡ: đừng
điều khiển cửa sổ app; dựng một cửa sổ Electron của riêng spike, cấu hình y hệt lớp vỏ, trỏ vào đúng
URL engine. Trong cửa sổ của mình thì bấm được và đọc được mọi thứ. Sáu mục, đạt hết: panel mở, dải
pill đúng, sân khấu chồng khít ô trống **lệch 0px**, trang thật nạp được, bấm pill đổi pane, đóng
pill gỡ luôn webview.

**Lỗi nút `+` không mở menu — và bài học về cách kiểm.** Chủ dự án bấm `+` thì không thấy gì. Nguyên
nhân: dải pill có `overflow-x: auto` để cuộn ngang, mà theo chuẩn CSS, đặt overflow cho một trục
biến trục kia từ `visible` thành `auto` — nên hộp menu (`position: absolute` bên trong) bị cắt cả
chiều dọc. Sửa bằng prop `portal` của `Menu`, đường upstream chừa sẵn đúng cho tình huống này.

Điều đáng ghi hơn là **cách phát hiện**. Một phép kiểm "menu có trong DOM không" sẽ PASS — menu vẫn
ở đó, đủ 218×129, đủ 3 mục, đúng trong khung nhìn. Phép kiểm đúng là **bắn tia vào giữa menu** bằng
`elementFromPoint`: nó chỉ trả về menu khi menu thật sự nhìn thấy và bấm được. Mục 8 (chọn "Terminal
mới") vẫn PASS suốt trong lúc lỗi còn nguyên, vì nó bấm thẳng vào nút trong DOM và đi vòng qua lớp
hit-test. Với giao diện, "có trong DOM" và "người dùng bấm được" là hai câu hỏi khác nhau.

`spike:dock` nay có 11 mục, gồm cả đường người dùng thật chưa từng được kiểm: mở tab web trống từ
`+` rồi **gõ** địa chỉ vào ô nhập của React (phải gọi setter gốc rồi phát sự kiện `input`, gán thẳng
`.value` thì React không thấy), và terminal mở từ `+` có chữ của shell chảy về thật.

**Lỗi trang nạp xong nhưng KHÔNG VẼ RA — và nó cũng là lời giải cho `capturePage` treo.** Chủ dự án
mở google.com: pill đổi tên thành "Google", thanh địa chỉ đúng, vùng trang trắng trơn. Máy đo đặt
vào đúng đường cho thấy sân khấu vẫn `display: none` — lệnh hiện nó nằm trong một
`requestAnimationFrame` **không bao giờ nổ**. Chromium ngừng cấp khung hình cho cửa sổ nó cho là
không ai nhìn, nên một lệnh KHỞI TẠO gửi qua `requestAnimationFrame` là một lệnh có thể không bao
giờ chạy. Điều này cũng giải thích luôn mục "còn treo" ở trên: `capturePage()` treo vì webview
KHÔNG hiển thị thật, đúng như `spike-webview.cjs` đã đo — một triệu chứng, hai biểu hiện.

Gốc rễ: tôi ghi trong chú thích là đã chép cách đo của app tham chiếu, nhưng **chép sót một dòng** —
họ gọi phép đo đầu tiên THẲNG rồi mới dùng bộ gộp khung hình cho các lần sau; tôi gộp cả lần đầu.
Nay bỏ hẳn `requestAnimationFrame`: `ResizeObserver` vốn đã phát tối đa một lần mỗi khung hình, và
phép so hình chữ nhật đã chặn mọi lần gửi thừa. Thử `useLayoutEffect` cũng sai — lúc đó panel chưa
được gán bề rộng nên ô trống rộng 0.

Cùng file, sửa một lỗi hiệu năng tự gây: ô trạng thái hỏi lại sân khấu mỗi 250ms và ghi thẳng object
mới trả về, nên cả pane vẽ lại 4 lần mỗi giây vĩnh viễn. Nay so từng trường rồi mới ghi.

**Bộ kiểm nay 13 mục**, và ba mục cuối là ba lần tôi phải sửa chính bài kiểm trước khi nó nói thật:

- "menu có trong DOM" PASS trong khi lỗi còn nguyên → đổi sang **bắn tia** `elementFromPoint`
- "chọn Terminal mới" PASS suốt vì nó bấm thẳng vào phần tử, đi vòng qua lớp hit-test
- "trang có chiếm chỗ" hỏng oan vì hộp thoại chào mừng của upstream che → câu hỏi đúng không phải
  "webview có ở trên cùng không" (hộp thoại che trang web là ĐÚNG) mà là **"webview có nằm trên
  `#root` không"**, đo bằng `elementsFromPoint` số nhiều

Bài học chung: với giao diện, *"có trong DOM"* và *"người dùng thấy và bấm được"* là hai câu hỏi
khác nhau, và chỉ câu thứ hai mới đáng kiểm.

**Kênh kiểm chứng mạnh nhất tìm được: CDP vào chính app thật.** Khi spike xanh mà app thật vẫn
trắng, mô phỏng thêm là vô ích — phải đo trên chính cửa sổ của chủ dự án. Cách làm: mở app bằng
`npm run dev -- --remote-debugging-port=9223` (cổng 9222 trên máy này đã có chương trình khác
chiếm), rồi một script Node nối WebSocket vào `http://127.0.0.1:9223/json/list`. Từ đó: chạy JS
trong trang thật, đi đúng thao tác tay (bấm `+`, chọn menu, gõ địa chỉ), và — quý nhất — **mỗi
`<webview>` hiện ra như một target CDP riêng**, `Page.captureScreenshot` chụp được pixel thật của
trang khách, thứ mà ảnh chụp cửa sổ không bao giờ thấy. Đã dùng kênh này xác nhận google.com và
bing.com vẽ ra đầy đủ trong app thật, qua cả đường tab dựng sẵn lẫn đường thao tác tay. Script mẫu
nằm trong thư mục nháp phiên làm việc (`cdp-diag.mjs`, `cdp-flow.mjs`) — chưa thành file dự án vì
mới dùng một lần; lần thứ hai cần tới thì đưa vào `scripts/`.

### Còn treo

- **`capturePage()` gọi từ trong trang làm treo cứng vòng lặp sự kiện** khi guest là một trang https
  ngoài đời — cả `setTimeout` bọc ngoài cũng không nổ. Cùng API đó gọi từ cùng vị trí đó trong
  `spike-webview.cjs` (trang khách cục bộ) thì trả về bình thường. Không chặn đường: lệnh chụp ảnh
  cho agent vốn dự kiến đi qua tiến trình chính.
- Chưa làm: cầu WebSocket cho agent, bộ tool, công tắc quyền, ảnh chụp.

## 2026-08-15 — Vùng trang web trắng trơn: panel tự sơn đè lên trang của mình

Triệu chứng: mở tab Browser vào google.com thì pill đổi tên thành "Google", thanh địa chỉ đúng
`https://www.google.com/`, mà vùng trang là một khoảng trắng.

Nguyên nhân: panel sống trong lớp `overlayLayer` của upstream, lớp đó khai **z-index 20**. Sân khấu
webview gắn thẳng vào `document.body` và khai **z-index 5**. Hai con số tranh nhau trong cùng một
bối cảnh xếp lớp nên 20 thắng, và **nền đục của cả cột panel được sơn đè lên trang web**. Trang vẫn
tải, vẫn có tiêu đề, vẫn được cấp 166 khung hình mỗi giây — chỉ là không ai nhìn thấy nó.

Sửa (mức 1, chỉ CSS của plugin): `.hdw-dock` bỏ nền, chuyển nền xuống từng phần con —
`.hdw-tabbar`, `.hdw-navbar`, `.hdw-files`, `.hdw-empty`; `.hdw-termwrap` vốn đã có nền riêng.
Kèm theo đó, mỗi tab **bắt buộc** phải có nền đục, vì nay chính tab đang xem mới là thứ che tab nền.

Không nâng sân khấu lên trên tầng 20 vì mọi menu, tooltip, hộp thoại của upstream cũng ở đúng lớp
đó — nâng lên là mỗi lần mở menu "+" nó lại chui xuống dưới trang web.

### Vì sao lỗi này sống sót qua 15 mục kiểm

Mọi thước đo đang có đều đo nhầm tầng. Đã thử và **đã loại bỏ ba thước**:

- `guest.capturePage()` — trả về hình guest **tự vẽ trong bộ nhớ**, nên nó báo "vẽ ra rồi" trong
  khi màn hình trắng. Tệ hơn: trên trang https thật nó treo vô hạn, và có lần làm **chết tiến trình
  trang**, kéo sập cả spike. Đã gỡ khỏi `spike-dock-ui.cjs`, đừng dựng lại.
- `PrintWindow` (WM_PRINT) — trả về cửa sổ trắng trơn cho mọi trường hợp, mất cả khối màu do chính
  trang chủ vẽ. Nội dung Chromium vẽ bằng GPU không đi qua đường đó.
- Chụp thẳng từ màn hình — cửa sổ spike không giành được tiêu điểm, nên ảnh thu về là màn hình của
  người đang ngồi máy. Vừa sai vừa không được phép.

**Đính chính mục "Còn treo" của lần trước:** kết luận *"google.com và bing.com vẽ ra đầy đủ trong
app thật"* là SAI, và sai vì đúng lý do trên — ảnh chụp từ target CDP của guest là hình guest tự
vẽ, không phải thứ hiện trên màn hình. Phép chụp đáng tin là `Page.captureScreenshot` trên target
của **trang chủ** (cửa sổ app), không phải trên target của trang khách.

Hai thước thay thế, cả hai đều rẻ và không treo được:

- **`requestAnimationFrame` đếm trong một giây** — trang có được cấp khung hình không.
- **mục 4d mới trong `spike-dock-ui.cjs`** — bắn tia vào giữa ô trang web, liệt kê mọi phần tử nằm
  trên nó, và **báo hỏng nếu có phần tử `hdw-*` nào có nền đục**. Đây là mục bắt được lỗi này.
  Phần tử của upstream (hộp thoại, mask) nằm trên thì không tính — chúng phải che.

`npm run spike:stage` (mới) là spike trần trả lời "lỗi ở code của ta hay ở chính thẻ `<webview>`":
`<webview>` mở google.com bình thường khi đứng một mình, nên lỗi ở panel.

**`spike:dock` nay tự chạy được, không cần biến môi trường.** Trước đó nó đòi `HDW_SEED_PATCH` trỏ
vào một file nằm trong thư mục nháp của một phiên làm việc — phiên đó đóng là spike gãy, mà không
ai đoán ra vì triệu chứng là *mọi* mục kiểm bị từ chối (giống hệt rào workspace hỏng ngược). Nay
plugin gieo workspace nằm trong repo (`scripts/spike-ws-seed.mjs`), còn file patch trỏ vào nó được
sinh ra ngay trong `DSH_HOME` tạm lúc chạy — vì nó phải chứa đường dẫn tuyệt đối, thứ khác nhau
trên mỗi máy. Biến `HDW_SEED_PATCH` vẫn còn để ghi đè khi cần.

## 2026-08-15 — Bấm và gõ được trên trang web, và cầu nối cho agent

### Nửa còn lại của lỗi "trang trắng"

Cùng một nguyên nhân đẻ ra HAI lỗi, và sửa cái này không sửa cái kia:

1. Nền đục của panel **sơn phủ** trang → thấy một khoảng trắng (đã sửa sáng nay).
2. Phần tử của panel **vẫn nuốt chuột** dù đã trong suốt → bấm và gõ không tới được trang.

Trong suốt là chuyện của mắt, `pointer-events` mới là chuyện của tay. Sửa: `.hdw-dock`,
`.hdw-body`, `.hdw-browser`, `.hdw-slot` đều `pointer-events: none`; các phần cần bấm
(`.hdw-tabbar`, `.hdw-navbar`, `.hdw-files`, `.hdw-termwrap`, `.hdw-empty`, `.hdw-resizer`)
nhận lại `auto`. Khai đích danh từng khối bao thay vì để kế thừa lan từ gốc: thứ thêm sau này
vào trong các khối đã bật thì tự bấm được, còn thứ đặt thẳng dưới `.hdw-dock` thì không — và
"không bấm được" là lỗi thấy ngay, khác hẳn một lỗ rò im lặng.

**Cho chuột đi qua không làm bàn phím đi theo.** Ba việc nữa phải làm, mỗi việc chống một lỗi
riêng:

- Thẻ `<webview>` cần `tabindex="-1"` mới `focus()` được. Thiếu nó thì `el.focus()` im lặng
  không làm gì — đo được: trang chủ vẫn báo `activeElement=BODY`, trang khách `hasFocus=false`.
- `xepChong()` phải **bàn giao tiêu điểm**. `z-index` chỉ đổi thứ tự sơn; tab nền thì bị che chứ
  không bị ẩn, nên thiếu bước này là người dùng gõ vào một trang web vô hình.
- Enter ở thanh địa chỉ phải trả bàn phím cho trang.

Ý định "người dùng vừa tự chọn tab" được **khai báo** (`setActive(id, traoBanPhim)`) chứ không
suy đoán từ tiêu điểm: bản đầu đoán bằng `document.activeElement`, và sai ngay ở đường `.click()`
— cách đó không dời tiêu điểm. Giành bàn phím vô điều kiện cũng sai: mở app lên mà panel khôi
phục một tab web thì bàn phím bị cướp khỏi ô nhập hội thoại.

Kèm: đóng menu "+" khi trang giành bàn phím (cú bấm vào trang không còn tới `document` của app
nữa, nên menu không tự đóng như trước), và bỏ `allowpopups="false"` — thuộc tính boolean, **có
mặt là bật**, dòng đó nói ngược điều nó định nói.

### Cầu nối `/hdw/bus` — nền móng cho agent điều khiển trình duyệt

Tool của agent sẽ chạy ở nửa Node, trang web sống ở nửa giao diện; cầu là đường duy nhất giữa
hai bên. `plugins/dock/src/bus-routes.ts` (sao khuôn `pty-routes.ts`) + `client/bus.ts`. Giao
thức JSON, khớp yêu cầu–trả lời bằng `id`, có số phiên bản trong khung chào.

Hai quyết định đáng nhớ:

- **Ai lái khi nhiều cửa sổ nối vào: cái đầu tiên, giữ tới khi socket của nó đóng.** Không phải
  "cái mới nhất" như phản xạ đầu tiên. `isTrustedRequest` là rào chống trang lạ, **không phải xác
  thực** — một tab Chrome mở `http://127.0.0.1:<cổng>` cũng qua được; luật "mới nhất lái" trao vô
  lăng cho tab đó, và agent sẽ mở trang trong một cửa sổ không ai nhìn.
- **`mo_trang` trả `pane_id`, KHÔNG hứa "đã tải xong"**: `openPane` chỉ đẩy pane vào kho, webview
  dựng ở lượt render sau. Hứa quá tay là tool đầu tiên sẽ báo thành công cho một địa chỉ 404.

Rào địa chỉ `net-policy.ts` port từ dự án tham chiếu, **chỉ chặn agent** — người dùng gõ tay vẫn
vào được router và server nội bộ. Ba lỗ hổng bản gốc đã trả giá để bịt, giữ nguyên cả ba:
`URL.hostname` của IPv6 còn **ngoặc vuông**; chặn **cả dải `127/8`** chứ không riêng `127.0.0.1`;
so IPv6 bằng **mặt nạ bit** chứ không `startsWith("fc")` — cách kia chặn oan `fc2.com`, mà một rào
chặn oan là một rào sẽ bị tắt.

### Bộ kiểm: 16 → 26 mục

Mục mới đáng kể nhất là **4f/4g/4h** và **14a–14e**. Ba bài học về phép đo:

- Hộp thoại chào mừng của upstream bật lên **sau** khi panel mount, và bản trước hỏi đúng một lần
  rồi kết luận "không có" — nên cả bài kiểm chạy dưới một lớp mask phủ kín, mà **mọi mục dùng
  `.click()` vẫn xanh** vì `.click()` gọi thẳng handler, không qua phép dò trúng đích. Giờ phải chờ
  nó xuất hiện, và chờ đủ lâu cho lệnh ghi xác nhận bay xong.
- **Cú bấm thì máy KHÔNG đo được.** `sendInputEvent` bắn thẳng vào widget trang chủ nên không tới
  trang khách (đo được: bắn kiểu đó trang khách đếm 0, bắn thẳng vào trang khách thì đếm 1).
  `Input.dispatchMouseEvent` qua DevTools cũng vậy — nhưng PHÍM thì tới nơi, vì phím đi tới widget
  đang giữ tiêu điểm chứ không qua bước dò toạ độ. Nên mục 4f đo thứ đo được và đúng là nguyên
  nhân đã gây lỗi: chuỗi phần tử phủ lên ô trang có còn cái nào bắt chuột không.
- Mục 9 (terminal có chữ của shell) **chập chờn** — cùng một mã, lúc xanh lúc đỏ. Chưa truy.

### Giai đoạn sau phải làm ĐẦU TIÊN

1. **Đường tới sân khấu webview.** Cầu sống ở tầng plugin nên thấy `dock.actions`, nhưng `stage`
   chỉ nằm trong `useRef` của `DockPanel`. Mọi lệnh điều khiển chính trang web — bấm, gõ, đọc nội
   dung, chụp ảnh — đều cần đường này.
2. **Chốt chuyển hướng theo từng tab.** Agent đưa một URL công cộng, trang trả 302 sang
   `http://127.0.0.1:<cổng engine>/` — rào lúc mở không cản được, và vì là điều hướng top-level nên
   `isTrustedRequest` cho qua. Agent có một tab điều khiển được đứng ngay trong giao diện engine.
   Chốt đúng chỗ là tầng điều hướng của guest trong `src/main/window.ts`, và phải phân biệt tab do
   agent mở với tab người dùng tự gõ.
3. **URL sống lại qua localStorage.** Kho panel có `persist`, nên địa chỉ agent mở được lưu lại và
   mở lại ở lần chạy sau, bỏ qua mọi phép kiểm ở lượt đó.

## 2026-08-15 — Truy ra mục kiểm terminal chập chờn: cửa sổ bị che

Mục 9 (`terminal có chữ của shell`) lúc xanh lúc đỏ với **cùng một mã**. Truy tới cùng:

Nguyên nhân: cửa sổ của spike bị cửa sổ khác **che kín**. Windows báo bị che, Chromium kết luận
không ai nhìn và **ngừng cấp khung hình**; xterm vẽ chữ trong một lượt `requestAnimationFrame`, nên
màn hình trống trơn. Kết quả phụ thuộc lúc chạy màn hình có bận hay không — không liên quan gì tới
mã đang kiểm.

Chuỗi bằng chứng, mỗi bước loại một nghi can:

1. Kết nối WebSocket bắt tay thành công (101), shell chạy thật (có `pid`), **banner và dấu nhắc về
   đủ** — nên không phải lỗi đường truyền.
2. Trong toàn bộ byte shell gửi về **không có lệnh xoá màn hình** — nên không phải bị xoá.
3. Trang nhận đủ 7 khung nhị phân đúng kiểu `ArrayBuffer`, socket vẫn mở — nên không phải tay nghe
   bị gỡ hay dữ liệu sai kiểu.
4. xterm dựng đủ 54 hàng, kích thước đúng, không bị ẩn — nhưng **0 hàng có chữ**.
5. `document.visibilityState` = **`"hidden"`** trong khi `win.isVisible()` = `true` và cửa sổ không
   thu nhỏ. Đây là chỗ duy nhất nói thật.
6. Ép cửa sổ lên trước: chữ hiện ra **đầy đủ ngay lập tức**, không cần shell gửi thêm gì.

Bước 6 trả lời câu hỏi quan trọng nhất với người dùng: **không mất dữ liệu**. Lượt vẽ chỉ nằm chờ,
và nó chạy khi cửa sổ hiện lại. Che app trong lúc terminal đang chạy rồi quay lại thì vẫn thấy đủ.

Sửa ở **bài kiểm**, không ở app: tắt phép dò bị-che (`CalculateNativeWinOcclusion`) để spike đo cái
app làm, chứ không đo cái trình quản lý cửa sổ làm. `HDW_CHE=1` bật lại phép dò đó khi cần tái hiện.

Bài học về phép đo, cùng họ với ba bài trước: `win.isVisible()` trả lời câu "hệ điều hành có coi cửa
sổ này là đang hiện không", **không** trả lời câu "Chromium có vẽ nó không". Hỏi sai câu thì được
một câu trả lời đúng và vô dụng.

Bộ kiểm nay **26/26 đạt**.

## 2026-08-15 — Trả tên về tiếng Anh, và chốt luật bằng hook

Luật dòng đầu CLAUDE.md vẫn luôn ghi "tên hàm giữ nguyên tiếng Anh", nhưng mã trong `plugins/dock/`
đã trôi khỏi nó qua nhiều phiên: **179 cái tên** tiếng Việt, tính cả tên hàm, tên kiểu, hằng số, và
— nặng nhất — **tên trường trong giao thức giữa hai nửa app** (`tham_so`, `ket_qua`, `ly_do`,
`phien_ban`) cùng đường dẫn HTTP `/hdw/bus/thu?mo=`. Đó là thứ một người khác đọc đầu tiên khi mở
dự án. `src/main/` thì sạch.

Đã đổi hết: `moCau` → `openBridge`, `xepChong` → `restack`, `laUrlCongCong` → `isPublicUrl`,
`chonTaiXe` → `pickDriver`, `MAX_DANG_CHO` → `MAX_PENDING`, khung tin `{ t: 'goi', lenh, tham_so }`
→ `{ t: 'call', cmd, params }`, route → `/hdw/bus/probe?open=`. **Chú thích tiếng Việt giữ nguyên
toàn bộ** — chúng là phần đúng luật và có giá trị nhất trong repo.

Bus lên phiên bản 2 vì hình dạng thông điệp đổi. Nếu bản cũ còn chạy đâu đó, nó bị từ chối kèm câu
"hãy tải lại trang" thay vì im lặng nói chuyện lệch nhau.

### Vì sao một dòng luật không đủ, và hook thì đủ

Vùng mã gốc DeepSeek không ai đụng suốt mấy tháng. Khác biệt duy nhất so với luật đặt tên: ở đó có
`guard-upstream.mjs` **chặn cứng**. Nên làm ba lớp cho luật đặt tên, đúng khuôn đó — Luật 7 trong
CLAUDE.md, `.claude/rules/naming.md`, và `.claude/hooks/guard-naming.mjs` chạy ở `PreToolUse`.

Hook chỉ soi **tên khai báo mới** trong nội dung sắp ghi, nên sửa một file cũ còn tên tiếng Việt vẫn
qua được — nó gác dòng mới chứ không bắt dọn cả file.

**Bài học nằm ở chính lần thử hook.** Bản đầu so chuỗi con, và khi chạy thử lên toàn bộ mã hiện có
thì chặn oan `handler`, `NotifierHandlers`, `reapOrphanEngine` — vì `han` nằm trong cả ba. Sửa thành
cắt tên ra từng đoạn theo camelCase rồi so bằng nhau. Phép thử "chạy rào lên chính mã đã đúng, phải
không ra dòng nào" đáng giữ lại cho mọi rào sau này: **một rào chặn oan là một rào sẽ bị tắt.**

Giới hạn đã ghi thẳng trong file rule: hook dò theo danh sách tiếng, không phải từ điển; bỏ lọt thì
thêm vào danh sách.

### Chỗ cố ý để lại

`scripts/spike-*` vẫn còn tên tiếng Việt. Đó là 900 dòng mã kiểm không có typecheck nào bắt lỗi, nên
đổi tên hàng loạt bằng regex ở đó là cách chắc chắn nhất để làm hỏng chính cái lưới an toàn dùng để
nghiệm thu mọi thay đổi khác. Dọn dần trong lúc thêm mục kiểm ở các giai đoạn sau.

Nghiệm thu: `npm run typecheck` sạch, `npm run spike:dock` **tất cả đạt**, và hook được thử cả hai
chiều — chặn tên tiếng Việt, không chặn mã tiếng Anh hiện có.

## 2026-08-15 — Agent với tới được trang web: đường nối, hai lớp rào, công tắc quyền

Ba giai đoạn, ba commit riêng. Trước đó cầu nối chỉ mở được tab mới; giờ nửa Node đọc và chạy được
mã trong chính trang web đang mở.

### Đo trước khi xây — và một phép đo đã đổi kiến trúc

Năm mục kiểm mới, đặt trước mọi dòng mã của tầng tool:

- **Cú bấm do máy gửi tới được trang KỂ CẢ khi cửa sổ app không ở trước mặt.** Tài liệu Electron
  ghi ngược lại. Nếu tin tài liệu thì đã tự áp một giới hạn không có thật — agent chỉ làm việc được
  khi người dùng đang nhìn.
- **Chụp ảnh: hai đường cùng tên hàm, kết quả khác hẳn.** Gọi từ tiến trình chính chạy 23KB trong
  5ms; gọi từ trong trang làm **treo cứng vòng lặp sự kiện của cả cửa sổ** trên trang https thật —
  `setTimeout` bọc ngoài cũng không nổ, không có cách nào tự cứu. Nên lệnh chụp ảnh **bắt buộc đi
  qua lớp vỏ**, và đó là một kết luận về kiến trúc chứ không phải một chi tiết.
- Vì lẽ đó, hai mục nữa đo **đúng đường plugin sẽ đi** (gọi từ trang chủ lên thẻ webview) thay vì
  suy ra từ đường tiến trình chính. Cả chạy mã lẫn gửi cú bấm đều tới nơi.

Bài học: **cùng một tên hàm, hai vị trí gọi, hai kết quả** — không được suy ra, phải đo riêng.

### Đường tới sân khấu: một cái ô, không phải một tham chiếu

Cầu mở trong `apply()`, tức trước khi panel tồn tại; và slot có thể dựng lại panel bất cứ lúc nào,
mỗi lần là một sân khấu mới còn cái cũ bị `destroy()`. Cầu giữ cứng một tham chiếu là cầm một sân
khấu đã chết — không lỗi nào báo, chỉ là từ đó agent nhờ gì cũng hết giờ. Một ô mutable giải quyết
cả hai chiều.

Sân khấu lộ thêm mười năng lực. Đáng nhớ nhất là `isDrawable` và `revealForInput`, chép từ dự án
tham chiếu: **tab không được vẽ vẫn nhận cú bấm và vẫn trả lời "xong", nhưng không làm gì cả.**
Không có phép kiểm đó thì agent báo thành công cho những thao tác chưa từng xảy ra.

### Hai lớp rào chuyển hướng, và kẽ hở còn lại

Lỗ nguy hiểm nhất không đi qua cửa mà rào địa chỉ canh: agent đưa một địa chỉ công cộng hợp lệ,
trang đó trả về lệnh chuyển hướng sang cổng engine. Phép kiểm lúc mở đã chạy xong và đã cho qua.

- **Lớp vỏ** chặn cứng gốc engine ở tầng request, cho mọi tab. Đặt ở lớp vỏ vì một chốt mà plugin
  tự đặt được thì plugin cũng tự gỡ được. Giá cho người dùng bằng không.
- **Plugin** từ chối mọi lệnh đọc và thao tác nếu tab đang mở địa chỉ nội bộ — bất kể tới đó bằng
  đường nào. Đây là chốt mạnh nhất vì nó chặn *lợi ích*, không chỉ chặn *lối vào*.

Kẽ hở còn lại, nói thẳng: **đúng một request** có thể kịp bay tới địa chỉ nội bộ trước khi tab bị
kéo về trang trắng. Bịt nốt thì phải tách kho cookie riêng cho tab agent; chủ dự án đã chọn dùng
chung để agent thừa hưởng phiên đăng nhập.

Địa chỉ agent mở cũng không sống lại sau khi tắt app nữa — kho panel có `persist`, và lượt mở lại
vốn không đi qua phép kiểm nào.

### Công tắc quyền

Cài đặt → General, **bật sẵn**. Đọc thì luôn cho phép: bịt mắt agent không ngăn được nó hành động,
chỉ làm nó hành động mù. Nguồn sự thật ở **nửa Node** nơi tool chạy; giao diện chỉ là chỗ bấm và
chỗ lưu, và nó đẩy giá trị sang mỗi lần nối cầu cũng như mỗi lần người dùng gạt.

**Không dùng cơ chế xin phép sẵn có của upstream** (`tools/pre-execute` → `ask`), dù đó là vật liệu
của hệ thống: nó chỉ cấp phép **một lần cho một lời gọi**, không có "cho phép luôn". Một chuỗi thao
tác bình thường có hàng chục cú bấm, nghĩa là hàng chục hộp thoại. Dòng cài đặt vẫn dựng bằng `Menu`
của upstream đúng khuôn `EnterBehaviorRow`, không tự vẽ công tắc gạt.

### Bộ kiểm thôi kiểm bằng bản sao

Bốn chốt an toàn của `src/main/window.ts` trước đây được **chép tay** sang bài kiểm, kèm chú thích
*"lệch là spike vô nghĩa"*. Nó đã lệch thật ngay lần đầu chạm tới: chốt mới không có trong bản chép,
nên mục kiểm báo đỏ trong khi app thì đúng. Giờ bài kiểm nạp thẳng hàm thật từ `dist/`, nên nó cũng
đồng thời xác nhận bản dựng còn chạy được.

**Một chốt an toàn được kiểm bằng bản sao của chính nó thì không kiểm được gì.**

Bộ kiểm nay **36/36 đạt**.

## 2026-08-15 — Mười hai tool: agent điều khiển được trình duyệt trong app

Bám bộ tool trình duyệt của app Claude: đọc trang có mã tham chiếu, tìm phần tử, lấy chữ, quản lý
tab, điều hướng, console, mạng, thao tác chuột/bàn phím, điền form, chạy mã, đổi khung nhìn, chụp
ảnh. Ba chỗ hụt so với bên đó đã ghi thẳng trong mô tả tool: cây trợ năng dựng từ DOM chứ không
phải cây thật của Chromium, mạng không có header, và không giả lập được cảm ứng — cả ba đều cần
giao thức gỡ rối của Chromium, thứ chỉ mở được bằng cách bật một cổng điều khiển toàn app trên máy.

### Không dùng `defineTool` của upstream

`defineTool` là một **import lúc chạy**, mà plugin nằm ngoài cây module của engine — engine chết
ngay lúc khởi động với `ERR_MODULE_NOT_FOUND`. Ba đường ra:

1. Nhồi gói đó vào bundle → kéo theo `cordis`, `dsh-llm`, `dsh-session`. Đúng bệnh "hai bản React",
   chỉ là ở nửa Node.
2. Khai làm phụ thuộc rồi `npm install` → một bản sao thứ hai, lệch phiên bản engine sau mỗi lần
   nâng cấp mà không có gì báo.
3. **Tự dựng object** — đã chọn. Hoá ra một tool chỉ là `{ name, description, parameters }` với
   `parameters` là JSON Schema, cộng `output` và `execute`. Nửa Node của plugin vì thế giữ đúng hai
   phụ thuộc lúc chạy như cũ: `node-pty` và `ws`.

Cái giá có thật và đã ghi trong mã: upstream nói rõ tool đăng ký bằng JSON Schema thô thì **tự lo
phần kiểm tham số**.

### Ba chi tiết quyết định một cú bấm đúng hay một cú bấm trượt

Chép từ dự án tham chiếu, và cả ba đều là lỗi họ đã trả giá:

- **Hỏi lại trang xem điểm sắp bấm có bị che không** rồi mới bấm. Một vòng `elementFromPoint` bắt
  được banner cookie, thanh dính, lớp phủ vô hình, nền mờ hộp thoại. Bị che thì **báo lỗi kèm tên
  thứ đang che**, thay vì bấm nhầm rồi báo thành công.
- **Đưa con trỏ tới nơi trước khi nhấn** — nhiều trang chỉ hiện nút sau khi chuột đi qua.
- **Nhấn thật phím bổ trợ**, không chỉ gắn cờ — trang nghe sự kiện trên chính phím Ctrl sẽ không
  thấy gì nếu chỉ có cờ.

Cộng phép kiểm "trang có đang được vẽ không" ở đầu mọi lệnh thao tác, và bước đưa tab lên trước rồi
trả màn hình về chỗ cũ.

Mã tham chiếu cấp lại từ đầu mỗi lần đọc và chết khi trang điều hướng; đo bằng **từng mảnh** của
phần tử chứ không bằng khung bao (liên kết xuống dòng có tâm khung bao rơi vào khe giữa hai dòng);
đưa vào tầm nhìn bằng cuộn **tức thì** chứ không cuộn mượt (cuộn mượt thì đo ngay sau đó ra vị trí
cũ). Điền form gán qua setter gốc của prototype, nếu không React ghi đè ngược ở lượt vẽ kế tiếp.

### Chụp ảnh: lệnh duy nhất phải nhờ lớp vỏ

Đo được: gọi `capturePage()` từ trong trang làm **treo cứng vòng lặp sự kiện của cả cửa sổ** trên
trang https thật — `setTimeout` bọc ngoài cũng không nổ. Đường tiến trình chính thì 23KB trong 5ms.

Nên lớp vỏ **tự gọi vào** engine qua route `/hdw/shell`, đúng cách nó vẫn nối để hiện thông báo
Windows. **Không mở thêm cổng nghe nào trên máy người dùng** — lớp vỏ là bên gọi đi. Và nó chỉ chụp
được đúng những trang trong panel: danh sách cho phép dựng từ `did-attach-webview`, id lạ bị từ chối.

Một tấm ảnh đi ba đường khác nhau, và đó là điểm mấu chốt: tới **model** chỉ khi model đọc được ảnh;
tới **nhật ký phiên** chỉ vài trường mô tả, không phải byte ảnh; tới **thẻ kết quả cho người dùng**
thì luôn luôn. Nhờ tách ba đường mà chủ dự án vẫn nhìn thấy agent vừa thấy gì ngay cả khi model
đang chạy không đọc được ảnh — đúng lúc việc nhìn thấy có giá trị nhất.

### Một chốt quyền, không phải hai

Công tắc quyền chặn trong chính `bus.call`, không phải ở tầng tool. Lý do: tầng tool không phải
đường duy nhất tới cầu — route chẩn đoán cũng gọi thẳng vào. Hai đường mà hai luật thì đường ít ai
nhìn sẽ bị quên.

Bộ kiểm bắt được ngay một lỗi thật của luật này: hai lệnh phục vụ chụp ảnh không nằm trong danh
sách "chỉ đọc", nên tắt công tắc là mất luôn ảnh chụp — trong khi mô tả tool nói ảnh luôn chụp
được. Sai lệch đó chỉ lộ ra khi có người thật đi tắt công tắc.

### Nghiệm thu

Mục quyết định đi trọn một vòng như người dùng thật trên trang https ngoài đời: đọc trang → tìm ô
tìm kiếm theo mã → gõ chữ → Enter → chờ tải → trang nhảy sang kết quả mang **đúng chuỗi đã gõ**.
Mục chụp ảnh đi trọn chuỗi ba tiến trình, không tắt đoạn nào.

Bộ kiểm nay **46/46 đạt**.

## 2026-08-15 — Bài kiểm cho tầng tool, và hai lỗi nó bắt được ngay

Bộ kiểm giao diện gọi thẳng vào cầu qua route chẩn đoán. Nó chứng minh được "lệnh chạm tới trang
thật", nhưng **không chứng minh được gì về đoạn từ model gọi xuống**: hình dạng schema, phép kiểm
tham số, rào địa chỉ ở tầng tool, câu chữ trả cho model, ba đường đi của tấm ảnh. Cả tầng đó chưa
từng chạy một lần nào.

`scripts/spike-tools.mjs` đo đúng đoạn ấy. Nó thay cầu, đường chụp ảnh và kho đính kèm bằng đồ giả
— không phải để né việc khó, mà để **đi tới được những nhánh app thật không đi tới**: model đưa địa
chỉ sai, model quên tham số bắt buộc, model chạy trên tuyến không đọc được ảnh. Muốn chạm tới những
nhánh đó trong app thật thì phải có một model chịu làm sai.

### Hai lỗi bắt được ngay lần chạy đầu

1. **Model đưa `example.com` trần thì tool từ chối thẳng.** Thanh địa chỉ của người dùng tự thêm
   `https://` từ đầu, tầng tool thì không — hai đường vào cùng một trình duyệt hiểu địa chỉ khác
   nhau. Câu lỗi trả về là "không phải URL hợp lệ": vừa đúng về kỹ thuật vừa vô dụng với người đọc.
2. Phép sửa lộ ra lỗi thứ hai, nặng hơn: cả hai đường đều nhận biết scheme bằng **dấu hai chấm**,
   nên `example.com:8080` bị đọc thành protocol `example.com:` và bị **chặn oan**. Một địa chỉ công
   cộng hoàn toàn hợp lệ.

Sửa: nhận biết scheme bằng `://`, và dùng **chung một hàm** cho cả hai đường. `javascript:alert(1)`
vẫn bị chặn — không có `://` nên nó thành `https://javascript:alert(1)`, và chuỗi đó không phân
tích được.

Mỗi lần nới một phép kiểm thì thêm ngay một mục đo cái vừa nới ra: `192.168.1.1` trần và
`localhost:3000` trần vẫn phải bị chặn, `example.com:8080` vẫn phải qua.

### Bài học

Hai bộ kiểm đo **hai đoạn khác nhau của cùng một đường**, và không bộ nào thay được bộ nào. Bộ giao
diện đo từ cầu xuống trang; bộ tool đo từ model xuống cầu. Chỗ nối giữa hai đoạn — đúng chỗ hai bên
hiểu địa chỉ khác nhau — là chỗ không bộ nào nhìn thấy cho tới khi có bộ thứ hai.

Nghiệm thu: `npm run spike:dock` **46/46**, `npm run spike:tools` **14/14**.

## 2026-08-15 — Chạy thật với model thật, và một chỗ hỏng lộ ra

Hai bộ kiểm tự động đều xanh, nhưng chưa lần nào có **model thật gọi tool thật**. Chạy app với
profile và API key của chủ dự án, hai lượt hội thoại với DeepSeek-V4-Flash:

- Lượt 1: mở `example.com`, đọc trang, trả lời đúng tiêu đề và câu đầu tiên.
- Lượt 2: chụp ảnh trang, mở DuckDuckGo, đọc trang, gõ chữ vào ô tìm kiếm, nhấn Enter, đọc lại, và
  đưa ra đúng địa chỉ trang kết quả.

**7 trong 12 tool đã chạy thật** — `browser_tabs`, `browser_navigate`, `browser_read_page`,
`browser_get_page_text`, `browser_form_input`, `browser_computer`, `browser_screenshot`. 11 bước,
17 giây.

### Chỗ hỏng: thẻ kết quả không dùng phần khai giao diện của tool

Ảnh chụp màn hình từ app thật cho thấy thẻ của `browser_screenshot` là **thẻ mặc định**: tiêu đề là
tên tool (`browser_screenshot · browser-2-…`) chứ không phải tiêu đề đã khai (`Chụp ảnh trang`), và
phần IN là JSON thô của tham số. Nghĩa là `presentCall` và `presentResult` **không được dùng tới** —
nên khối ảnh dành cho người dùng cũng không bao giờ hiện ra.

Hậu quả người dùng thấy: chụp ảnh chạy đúng, ảnh lưu đúng vào kho đính kèm, nhưng **không ai nhìn
thấy tấm ảnh** — model DeepSeek không đọc được ảnh, mà thẻ kết quả thì không vẽ nó ra. Lệnh chụp
ảnh hiện chỉ là một dòng chữ báo kích thước.

Chưa truy ra nguyên nhân. Hai giả thuyết chưa loại trừ: registry chỉ đọc phần khai giao diện từ
định nghĩa do `defineTool` dựng (dù mã của nó chỉ chép thẳng hai hàm đó sang), hoặc thẻ generic của
client không vẽ khối ảnh. Đường chắc ăn nếu phải làm lại: đăng ký `tool.call.toolview` theo đúng
tên tool của mình — mức 1, và là seat upstream chừa sẵn cho đúng việc này.

**Bài học lặp lại lần thứ hai trong ngày:** hai bộ kiểm tự động 60 mục đều xanh, và cái sai vẫn nằm
đúng chỗ không bộ nào nhìn tới — phần vẽ ra màn hình. Bộ kiểm tầng tool có kiểm `presentResult` trả
đúng khối ảnh, nhưng nó kiểm **hàm đó trả về gì**, không kiểm **có ai gọi nó không**.

## 2026-08-17 — Ảnh chụp hiện được ra màn hình, và cả 12 tool chạy thật một lượt

### Vì sao thẻ kết quả không dùng phần khai của tool — đã truy ra

Không phải plugin đăng ký sai. Đọc mã giao diện của upstream
(`packages/client/ui-tool/src/client/tool/toolviews/GenericToolCard.tsx`): hàng mặc định chỉ đọc
**năm** loại thẻ có cấu trúc riêng — terminal, đọc file, diff, tìm kiếm, web. Loại `generic` không
có ai đọc; hàng vẫn dựng từ tên tool và JSON tham số thô, đúng như ảnh chụp màn hình của chủ dự án.

Nghĩa là `presentCall`/`presentResult` loại `generic` là **mã chết** trong giao diện này. Đường ra
màn hình duy nhất là nhận slot `tool.call.toolview` theo tên tool của mình.

### Thẻ ảnh chụp — `client/ScreenshotCard.tsx`, mức 1

Nhận `tool.call.toolview` khoá `browser_screenshot`. Upstream ghi rõ trong khai báo slot: nhận một
khoá chưa ai giữ là **cộng thêm**, nhận khoá của tool có sẵn mới là chiếm chỗ. Mười một tool còn lại
cố ý không nhận — hàng mặc định vẽ chúng đủ dùng, và nhận thêm là tự gánh việc bảo trì một cái hàng
mà không đổi lại được gì.

Người dùng thấy gì: agent chụp ảnh xong thì **tấm ảnh hiện ngay trong dòng hội thoại**, bấm vào mở
ra cỡ gốc. Trước đó chỉ có một dòng chữ báo kích thước.

**Ngoại lệ Luật 4, đã kiểm trước:** gói `dsh-client-ui-tool` chỉ xuất `apply`, `inject` và mấy kiểu
— `ToolRow`/`GenericToolCard` **không xuất ra**, nên phần khung hàng buộc phải tự dựng. Mọi vật liệu
bên trong vẫn là đồ hệ thống: ảnh dùng `MessageImage` của `dsh-client-ui-attachment` (kèm sẵn hộp
xem cỡ gốc), icon từ `ui-primitives`, màu chỉ dùng biến `--dsw-alias-*`.

Đường lấy ảnh (`client/shot-loader.ts`) đi qua `session.readAttachment` — hàm CÓ trong hợp đồng
công bố. Service `conversation` có sẵn `resolveImage` tiện hơn, nhưng nó không nằm trong
`IConversation`; bám vào thứ upstream không hứa giữ thì lần nâng cấp sau nó hỏng im lặng.

### Cả 12 tool chạy thật một lượt — route `?tool=` và mục 20

Lượt chạy với model thật chỉ chạm 7/12 tool: model gọi cái nó thấy cần, không gọi cho đủ danh sách.
"Model không gọi tới" và "gọi tới thì hỏng" là hai chuyện khác nhau.

Thêm `?tool=<tên>&args=<json>` vào route chẩn đoán, chạy đúng định nghĩa tool mà engine chạy — nên
bài kiểm giao diện đi được trọn tầng tool với cầu thật, trang thật, lớp vỏ thật. 15 mục mới
(20a–20o); bộ kiểm giao diện lên **61 mục**.

### Hai lỗi bộ kiểm mới bắt được ngay lần chạy đầu

1. **`isDrawable` tin vào `document.visibilityState`, và nó sai.** Chính bộ kiểm này đã đo từ trước
   (mục 13): một tab báo `visibility=hidden` trong khi vẫn được cấp 167 khung hình mỗi giây. Hậu quả
   người dùng: agent mở tab, trang hiện ra rành rành, mà **mọi lệnh bấm và mọi lệnh chụp ảnh đều bị
   từ chối** với câu "trang này đang không được vẽ". Bỏ phép kiểm đó, chỉ hỏi
   `requestAnimationFrame` có chạy không — Chromium ngừng gọi nó khi ngừng vẽ, nên nó trả lời đúng
   câu hỏi thật.
2. Mục kiểm console đọc nhầm tên trường (`lines` thay vì `messages`) — lỗi của bài kiểm.

### Bộ kiểm thứ ba: `scripts/spike-card.cjs` (`npm run spike:card`)

Dựng `ScreenshotCard` trong một cửa sổ Electron thật, với React thật của engine, rồi **đo thẻ `<img>`
trên màn hình có kích thước lớn hơn không**. Bốn trạng thái: đang chụp, chụp xong, dữ liệu hỏng,
chụp lỗi. Kèm một ảnh chụp để nhìn bằng mắt (`HDW_ANH=<đường dẫn>`).

Đây là bộ kiểm mà sự vắng mặt của nó gây ra chính cái lỗi ở trên. Hai bộ cũ hỏi *hàm dựng thẻ trả về
gì*; không bộ nào hỏi *có ai gọi nó không*, và càng không bộ nào hỏi *trên màn hình có tấm ảnh nào
không*. Bài học đã ghi thành luật trong `.claude/rules/ui-slots.md`.

Tổng: **61 + 14 + 5 = 80 mục, tất cả đạt.**

## 2026-08-17 (chiều) — Lượt chạy thật với model thật, và bức tường cuối cùng

Thêm `npm run spike:live`: chạy engine trên **profile thật** của chủ dự án (có API key, có model),
gõ một câu nhờ vào ô soạn, gửi bằng phím Enter thật, rồi hỏi đúng một câu — **trong khung hội thoại
có tấm ảnh nào không**. Kèm ảnh chụp cửa sổ app để nhìn bằng mắt.

Nó bắt được hai thứ mà 80 mục kiểm kia không thể bắt, vì cả 80 mục đều chạy trên `DSH_HOME` tạm và
không có model nào.

### Lỗi 1: plugin chưa khai cần service `sessions`

Cordis chặn cứng việc đọc một service không khai trong `inject`. Câu chặn chỉ hiện trong console của
trang, nơi khối ảnh đã nuốt nó thành một dòng *"không tải được ảnh"*. Đã thêm một dòng in lỗi ngay
tại chỗ nuốt — không có nó thì người gỡ lỗi có đúng một câu vô nghĩa để làm việc.

### Lỗi 2: engine TỪ CHỐI cho giao diện đọc ảnh của chúng ta — và nó có lý

Câu từ chối: *"Image is not referenced by this session."* Đọc mã của họ thì ra một ràng buộc cứng,
ghép từ hai luật:

1. `api-proxy.ts` — giao diện chỉ được đọc một ảnh nếu nhật ký phiên có một khối `image` **mà model
   nhìn thấy**.
2. `tool-fs/src/read-image.ts` — một khối như thế chỉ được phép tồn tại khi tuyến model **đọc được
   ảnh**, vì kết quả tool đi vào lịch sử phiên và nhét ảnh vào tuyến không chở được ảnh là làm hỏng
   mọi lượt hỏi sau.

Cộng lại: **model DeepSeek không đọc được ảnh → ảnh không vào được nhật ký → giao diện không xin đọc
được nó.** Không có cách nào lách trong khuôn đó mà không nói dối về khả năng của model.

Lối ra: `plugins/dock/src/image-routes.ts` — route `/hdw/image` của chính plugin, đọc lại byte từ
kho đính kèm của engine (`attachments.readImage`) rồi phục vụ. Ảnh vẫn lưu content-addressed, vẫn
bền qua lần khởi động sau, vẫn không phình nhật ký. Nhờ vậy `client/shot-loader.ts` teo lại còn một
hàm ghép chuỗi — trình duyệt tự lo tải, đệm và huỷ.

**Đánh đổi, nói thẳng:** route này bỏ đúng phép kiểm "ảnh có thuộc phiên đang xem không" mà upstream
đặt ra. Thay chỗ nó là `isTrustedRequest` (như mọi route `/hdw/*`) và việc mã ảnh chính là sha256
của nội dung — muốn lấy được một ảnh thì phải biết trước băm của nó. Thứ mất đi là "một trang trong
app đọc được ảnh của phiên khác nếu đã biết băm", không phải "ai cũng đọc được ảnh".

### Kết quả

Model thật (DeepSeek-V4-Flash) tự mở tab, tự chụp, và **tấm ảnh hiện ra trong khung hội thoại** —
440×1113, bấm vào mở ra cỡ gốc.

Bài học của cả ngày, gọn lại một câu: **mỗi lớp kiểm chỉ nhìn thấy được lớp nó chạy trong.** Bộ kiểm
tầng tool có cầu giả nên không thấy giao diện; bộ kiểm giao diện có `DSH_HOME` tạm nên không thấy
luật cấp quyền của engine; bộ kiểm thẻ có React thật nhưng không có engine nào. Chỉ lượt chạy thật
mới thấy được cả bốn lớp cùng lúc — và nó tìm ra lỗi ở lớp thứ tư trong ba phút.

## 2026-08-17 (tối) — Tám việc đời thường, model thật làm hết

`npm run spike:live` mở rộng thành bộ kịch bản. Mỗi kịch bản là **một câu tiếng Việt người dùng thật
sẽ gõ**, cố ý không nêu tên tool nào — nếu phải chỉ tận tay thì tính năng chưa dùng được. Phép kiểm
nhìn vào **kết quả thấy được**: trang nào đang mở, khung nhìn trang tự khai bao nhiêu, ảnh nào hiện
ra, chữ nào xuất hiện trong câu trả lời.

| Việc | Kết quả |
|---|---|
| Đọc một trang và trả lời đúng nội dung | đạt |
| Gõ vào ô tìm kiếm rồi đọc kết quả | đạt — 5 kết quả thật, có trích nguồn |
| Bấm liên kết trên trang rồi sang trang mới | đạt — tới đúng `iana.org` |
| Chụp ảnh trang, ảnh hiện ra cho người dùng | đạt |
| Xem trang ở cỡ điện thoại rồi chụp lại | đạt — trang tự khai khung nhìn 375px |
| Mở nhiều tab và quản lý chúng | đạt |
| Gỡ lỗi: xem trang gọi request gì | đạt |
| Cuộn xuống và đọc phần dưới | đạt |

Ảnh từng kịch bản lưu ra thư mục tạm để nhìn bằng mắt (`HDW_ANH=<thư mục>`).

### Hai phép kiểm bản đầu SAI, và cách chúng suýt xanh oan

1. **"Cỡ điện thoại" đo bề rộng tấm ảnh.** Ảnh chụp ra theo pixel vật lý nên nhân thêm tỉ lệ màn
   hình: khung nhìn 375px cho ra tấm ảnh rộng 516px — trông chẳng giống điện thoại chút nào, mà vẫn
   lọt qua ngưỡng. Sửa: hỏi **chính trang** `innerWidth` của nó.
2. **"Nhiều tab" đếm số tab.** Panel trình duyệt thuộc về **cửa sổ**, không thuộc về phiên, nên bấm
   "New Session" không dọn tab — tab của kịch bản trước còn nguyên và phép đếm xanh nhờ chúng. Sửa:
   đòi đúng hai địa chỉ được yêu cầu, và dọn panel trước mỗi kịch bản.

Điểm 2 cũng là một hành vi đáng biết của sản phẩm, không chỉ của bài kiểm: **tab agent mở sẽ ở lại
qua các phiên hội thoại.** Giống một trình duyệt bình thường, nhưng nghĩa là chúng dồn dần và người
dùng phải tự đóng. Chưa sửa — đó là một quyết định về hành vi, không phải một lỗi.

## 2026-08-17 (khuya) — Năm việc nặng hơn, và một lỗi thật lộ ra ở trang chậm

Thêm năm kịch bản vào `npm run spike:live`, đúng những việc chủ dự án nêu: điền form nhiều ô, trích
dữ liệu từ bảng, tra một con số cụ thể, nghiên cứu nhiều nguồn, và trang cần đăng nhập.

| Việc | Kết quả |
|---|---|
| Điền form 6 ô rồi gửi | đạt — server echo lại đúng cả 6 giá trị |
| Trích ba nước đông dân nhất từ bảng Wikipedia | đạt |
| Tra năm Python ra bản đầu | đạt |
| Mở trang chủ Vite và Webpack rồi so sánh | đạt |
| Google Docs | đạt — tới trang đăng nhập và **báo đúng là chưa đăng nhập** |

### Lỗi sản phẩm: trang chậm làm mọi lệnh đọc treo đủ 25 giây

httpbin.org trả 503 và giữ kết nối mở. `executeJavaScript` trên một trang chưa dựng xong DOM **không
ném và cũng không trả lời** — nó nằm chờ. Nên `browser_read_page` treo hết hạn 25 giây rồi chết với
câu *"lệnh read_page quá 25000ms không có trả lời"*. Model đọc câu đó không biết làm gì nên thử lại,
và thử lại cũng treo 25 giây nữa. Đo được: hai lần liên tiếp, mất 50 giây cho hai câu lỗi vô nghĩa.

Sửa trong `client/bus.ts`: mọi lời gọi vào trang khách đi qua `withPageReady` — hạn 12 giây (ngắn
hơn hạn của tool để câu trả lời kịp về), và khi quá hạn thì nói **trang chưa tải xong**, kèm địa chỉ
và trạng thái tải, kèm gợi ý chờ hoặc tải lại.

### Hành vi đúng mà bài kiểm suýt chấm sai

Hai kịch bản đỏ ở lượt chạy đầu, và cả hai đều là agent **dừng lại hỏi người dùng**:

- Câu nhờ ghi liên kết tên "More information" trong khi trang chỉ có "Learn more" — agent đọc trang,
  thấy lệch, và hỏi lại thay vì bấm bừa.
- Gặp trang đăng nhập Google, agent báo đúng là chưa đăng nhập rồi hỏi muốn làm gì tiếp; nó **cố ý
  không tự nhập mật khẩu**, chỉ đề nghị điền email và để người dùng tự gõ mật khẩu.

Với app thì lượt vẫn "đang chạy" — nó đang chờ người. Bài kiểm ngồi chờ hết ngân sách rồi chấm đỏ.
Sửa: nhận ra thẻ câu hỏi và coi đó là một cách kết thúc hợp lệ, có ghi rõ *"agent DỪNG LẠI HỎI người
dùng"* trong dòng kết quả. Một bộ kiểm ổn định phải **gọi đúng tên** trạng thái này, không được gộp
nó vào "treo".

### Giới hạn phải nói thẳng: Google Docs/Sheets

Panel dùng **kho cookie riêng**, tách khỏi Chrome của người dùng. Đăng nhập Google trên Chrome không
giúp gì; phải đăng nhập một lần **ngay trong panel Browser của app**, và người dùng tự gõ — không
bao giờ để agent nhập mật khẩu hộ. Sau khi có phiên đăng nhập trong kho đó thì mới đo được các việc
thật trên Docs/Sheets.

### Lượt xác nhận cuối: 13/13

Chạy trọn bộ một lượt với mã đã sửa — 13 kịch bản, tất cả đạt. Mục "trích dữ liệu từ bảng" đỏ ở lượt
áp chót vì agent trả lời **bằng tiếng Việt** (Ấn Độ, Trung Quốc, Hoa Kỳ) còn phép kiểm dò chữ tiếng
Anh; đã nhận cả hai ngôn ngữ.

Đó là lần thứ ba trong bộ này một phép kiểm chấm sai một lượt chạy đúng, và cả ba cùng một gốc:
**đo lời văn của model thì mong manh, đo dấu vết nó để lại thì chắc.** Địa chỉ trang đang mở, tấm
ảnh trên màn hình, khung nhìn trang tự khai — ba thứ đó không phụ thuộc model diễn đạt thế nào, và
không mục nào dựa vào chúng bị chấm sai lần nào.

## 2026-08-17 (đêm) — Google Docs vào được, Sheets thì chưa; và một lỗi in ra terminal

### Thừa hưởng phiên đăng nhập của người dùng, bằng một BẢN CHÉP hồ sơ

Kho cookie của panel (`persist:hdw-browser`) nằm trong thư mục dữ liệu của app thật. Bài kiểm chạy
bằng binary electron trần nên Electron đặt tên thư mục khác — kho cookie TRẮNG. Đó là lý do mọi lượt
chạy trước đều gặp trang đăng nhập Google trong khi chủ dự án đã đăng nhập sẵn trong panel.

Trỏ thẳng vào hồ sơ thật thì hỏng theo kiểu tệ hơn: hai tiến trình Electron dùng chung một thư mục
hồ sơ sẽ phá hỏng nó. Nên bài kiểm **chép** phân vùng cookie và `Local State` (chứa khoá giải mã
cookie — thiếu nó thì cookie chép sang chỉ là rác) ra một thư mục tạm. Đo được: bản chép có đủ 19
cookie `.google.com`, gồm `SID`, `HSID`, `SAPISID`.

Một lưu ý về thời điểm: Chromium ghi cookie xuống đĩa theo đợt, nên **phải đóng app trước khi chép**
thì phiên vừa đăng nhập mới có trong bản chép.

| Việc | Kết quả |
|---|---|
| Google Docs: mở danh sách tài liệu bằng tài khoản thật | **đạt** |
| Google Sheets: tạo bảng tính, gõ vào ô A1 | **chưa được** — gõ được chữ, không chốt được ô |

### Sheets: agent chẩn đoán sai, và phép đo bác bỏ

Agent tự kết luận *"phím tới trang nhưng `key` và `code` rỗng nên Sheets không nhận diện được
Enter"*. Đã thêm mục kiểm 20p để đo thẳng: cài bộ nghe trong trang, gửi Enter qua đúng đường agent
đi, đọc lại. Kết quả: `{"key":"Enter","code":"Enter","which":13}` — **phím hoàn toàn đúng.**

Giả thuyết còn lại, chưa loại trừ: lệnh `type` dùng `insertText` chứ không gõ từng phím thật.
`insertText` đặt chữ vào ô nhưng KHÔNG sinh sự kiện bàn phím, nên một ứng dụng theo dõi từng phím
như Sheets không biết ô đang được soạn, và Enter sau đó bị hiểu là xuống dòng thay vì chốt ô. Với ô
nhập thường thì không sao — mọi mục kiểm trước đều dùng ô thường, nên chỗ này ẩn suốt.

Chưa sửa: sửa đúng nghĩa là thêm chế độ gõ từng phím thật, và đó là một quyết định về đánh đổi (chậm
hơn nhiều, và dễ sai trên bàn phím không phải tiếng Anh) chứ không phải một lỗi rõ ràng.

### Lỗi PowerShell in ra terminal lúc khởi động

`reapOrphanEngine` hỏi thời điểm tạo tiến trình bằng một câu PowerShell viết liền:
`(Get-CimInstance ...).CreationDate.ToFileTimeUtc()`. Khi engine của lần trước đã chết —
tức là trường hợp thường gặp nhất — `Get-CimInstance` không lỗi mà trả về RỖNG, nên `-ErrorAction
Stop` không cứu được gì và PowerShell in sáu dòng đỏ *"You cannot call a method on a null-valued
expression"* ngay giữa màn hình khởi động.

App vẫn xử lý đúng (hàm trả `undefined`, không diệt nhầm tiến trình nào); chỉ có người dùng là bị
doạ. Sửa: tách thành hai câu có kiểm null, và không cho stderr của PowerShell chảy thẳng ra terminal.

Dòng `Message 2 rejected by interface blink.mojom.Widget` là cảnh báo nội bộ của Chromium, vô hại.

## 2026-08-17 (rất khuya) — Công tắc bật/tắt plugin: đo trước khi dựng, và loader không nhớ

Trước khi viết plugin quản lý plugin, một câu hỏi phải trả lời bằng phép đo: gọi
`loader.update(id, { disabled: true })` thì thay đổi có được ghi lại không, và ghi vào file nào.
Bộ đo mới: `npm run spike:loader` (13 mục), chạy trên một `DSH_HOME` riêng ở `D:\tmp\hdw-spike-dsh`
nên không làm bẩn cấu hình thật của chủ dự án. Nó cần một đầu đo chạy *trong* engine
(`scripts/spike-loader-probe.mjs`) vì `loader` là service trong tiến trình và upstream cố ý chỉ mở
nửa đọc; đầu đo nạp bằng một `--patch` tạm trỏ đường dẫn `file://` — nửa Node không cần được phân
giải theo tên gói.

**Tắt sống thì được, nhớ thì không.** Tắt một plugin có hiệu lực trong 1–2ms, không cần khởi động
lại: tên gói của nó biến khỏi `__DSH_BOOT__` của trang ngay. Bật lại cũng vậy. Nhưng khởi động lại
engine thì **mọi thứ bật lại như cũ**.

**Chỗ nó ghi vào là chỗ bị xoá mỗi lần khởi động.** Một lần tắt làm
`~/.dsh/profiles/web/cordis.yml` phình từ 223 byte / 0 entry lên 14.599 byte / **131 entry** — cả
cây plugin bị nướng cứng vào file gốc. Rồi mỗi lần boot, `prepareProfile` của upstream ghi đè file
đó về `[]` vô điều kiện, cố ý, để insert của bundle không bị nhân đôi. `cordis.patch.yml` không hề
bị chạm tới.

**Đường lưu bền là lớp patch, và có đúng hai lớp khác nhau.** Ghi
`- id: <id>\n  disabled: true` vào `~/.dsh/profiles/web/cordis.patch.yml` có hiệu lực **sau ~1 giây
mà không cần khởi động lại** (watcher của upstream), và sống sót qua khởi động lại. Nhưng nó
**không tắt được `hdw-dock`** — lớp người dùng nằm *dưới* lớp phủ `--patch`, nên lúc nó áp thì dòng
đó chưa tồn tại. Muốn tắt plugin của chính ta thì cần một `--patch` thứ hai đứng **sau** patch của
dock; đo được: làm vậy thì `hdw-dock` tắt đúng lúc boot, các entry khác không bị ảnh hưởng.

**Id phải hỏi loader, đừng đọc từ file cấu hình.** Lượt đo đầu tiên chấm sai *toàn bộ* vì viết cứng
`ui-settings-plugin-inventory`, trong khi id thật trong cây là `include:ui-settings-plugin-inventory`
— mọi entry sống trong một subtree Include gắn với `cordis.yml`. Bộ đo giờ tra id theo tên gói.

## 2026-08-17 (rạng sáng) — Công tắc bật/tắt plugin, và ba lỗi chỉ trang thật mới lộ ra

Plugin mới `plugins/plugin-manager/` (gói `harness-desktop-plugin-manager`) thêm một tab **Bật/tắt**
vào Cài đặt → Plugins. **Mức 1** — `settings.plugins.tab` là slot loại `list`, hai tab của upstream
vẫn còn nguyên bên cạnh. Vật liệu đều của hệ thống: `Button`, `Pill`, `StateDot`, `Input`,
`RiskConfirmation`, `Tooltip`. Không tự vẽ công tắc gạt, cùng lý do đã ghi ở `AgentControlRow`.

**Kiến trúc hai lớp, do phép đo quyết định.** Mỗi lần gạt làm hai việc đi hai đường: `loader.update`
cho hiệu lực ngay, và một file patch riêng (`<DSH_HOME>/harness-desktop-plugins.cordis.yml`) cho lần
mở app sau. Lớp vỏ truyền **ba** `--patch` và **thứ tự là bắt buộc**: dock, công tắc, rồi file
trạng thái. Một lớp chỉ sửa được dòng đã tồn tại khi nó áp, nên đặt file trạng thái lên trước thì
người dùng không tắt được chính panel của app — mà không có lỗi nào báo.

**Ba lớp bảo vệ, danh sách khoá do đo mà có.** `npm run spike:guard` tắt lần lượt 134 plugin, mỗi
lần kiểm engine còn trả lời không, đường vào Cài đặt còn không, bật lại có về không. Kết quả: **119
an toàn, 15 mục có vấn đề** — 3 làm engine chết (`webserver`, `web-startup`, dòng `include`), 7 làm
mất đường vào Cài đặt (`modules`, `connection`, `client-runtime`, `ui-layout`, `ui-sidebar`,
`ui-settings`, `ui-settings-plugins`), 2 tắt được mà bật lại không về (`hmr`, `bash-sandbox`), 3 là
entry engine tự sinh id nên khoá bằng quy tắc. Plugin tự khoá chính nó. Nửa Node từ chối bằng HTTP
409 nên một request gửi tay cũng không lách được rào ở giao diện.

### Bộ đo tự bắt được ba lỗi của chính nó

Bài học của repo tái diễn ba lần trong một buổi, mỗi lần một dạng **dò chữ thay vì đo dấu vết**:

1. **Viết cứng id đọc từ file bundle.** Id thật trong cây là `include:ui-settings-plugin-inventory`,
   không phải id trần. Lượt đo đầu chấm FAIL toàn bộ. Bộ đo giờ tra id theo tên gói.
2. **So chuỗi con.** `…ui-settings` nằm trong `…ui-settings-models`, nên tắt trang Cài đặt vẫn được
   chấm "an toàn".
3. **Dò tên gói trong cả trang.** Sửa thành khớp trọn vẫn sai: tên gói của một plugin **đã tắt** còn
   nằm trong `inject` của những plugin phụ thuộc nó. Dấu vết đúng là `__DSH_BOOT__.entries[].id`,
   cộng một dấu vết độc lập: `/plugins/<gói>/client.js` trả **404** khi plugin tắt.

Còn một lỗi thứ tư thuộc loại khác: cùng một plugin cho hai kết luận trái nhau giữa lượt chạy đầy đủ
và lượt chạy riêng, vì bộ đo đọc trang trước khi engine tháo xong fiber. Nay nó **chờ đúng dấu vết
của chính hành động vừa làm** rồi mới chấm.

### Hai lỗi thật mà 13 mục kiểm xanh không thấy, trang thật thấy ngay

Mở engine lên trong trình duyệt và bấm bằng tay:

- **Bật một dòng mà bundle web đã tắt sẵn thì không được nhớ.** Bộ cấu hình web tắt sẵn hơn hai mươi
  dòng (`tool-bash`, `tool-fs`, `plan-mode`…). Bản đầu chỉ lưu danh sách "cần tắt", nên "bật" chỉ là
  xoá tên khỏi danh sách — lớp bundle bên dưới vẫn nói tắt. Sửa: file trạng thái lưu **cả hai
  hướng**, `disabled: true` và `disabled: false` tường minh. Mục kiểm 9b sinh ra từ lỗi này.
- **Dòng `include` hiện ra như một plugin** tên "include", không nói gì với người dùng, mà tắt là mất
  app. Nay ẩn theo `entry.subtree`, vẫn giữ trong danh sách khoá.

Và một sự thật về giao diện, đo được cả hai chiều: **engine gạt ngay, nhưng phần hiện trên màn hình
chỉ đổi theo sau khi tải lại trang.** Tắt panel thì nó vẫn còn đó, bật thì nó chưa hiện — trong khi
`client.js` đã đổi 200/404 tức thì. Không nói ra thì người dùng sẽ tưởng công tắc không ăn và bấm
lại. Nay tab hiện một dòng nhắn kèm nút **Tải lại ngay**, chỉ cho những plugin thật sự có nửa giao
diện (hỏi bằng `HEAD /plugins/<gói>/client.js` **trước** khi gạt, vì sau khi tắt thì route đó trả
404 cho mọi gói).

### ĐƯỜNG THOÁT HIỂM

App không mở được sau khi tắt một plugin: mở `%USERPROFILE%\.dsh\harness-desktop-plugins.cordis.yml`,
xoá hết nội dung, thay bằng đúng hai ký tự `[]`, rồi mở lại app. Mọi plugin trở về mặc định. Đường
này cũng được in ngay trong tab Bật/tắt.

### Nghiệm thu

`npm run spike:manager` **13/13 đạt** (gồm cả khởi động lại engine thật và request gửi tay vào plugin
bị khoá). `npm run spike:loader` 13 phép đo về hành vi loader. `npm run spike:guard` 134 entry.
`npm run spike:dock` và `npm run spike:tools` vẫn **tất cả đạt** — công tắc không làm hỏng panel.
`npm run typecheck` sạch.

**Chưa tự động hoá:** phần giao diện (tab hiện ra, bấm nút, hộp xác nhận chặn khi chưa tích ô, dòng
nhắn tải lại) được xác nhận **bằng tay** trên trang thật, chưa có spike Electron riêng như
`spike:dock`. Việc đó đáng làm ở lượt sau.

### Đổi luật ngôn ngữ, cùng ngày

Chủ dự án chỉ ra: giao diện app là tiếng Anh (của DeepSeek), nên nhãn tiếng Việt chen vào trông chắp
vá; và chú thích trong mã cũng nên tiếng Anh. **Luật 7 đã đổi** — trước đây ngược lại.

| Thứ này | Trước | Nay |
|---|---|---|
| Tên hàm, biến, file, class CSS, trường JSON | tiếng Anh | **tiếng Anh** (không đổi) |
| Chú thích trong mã | tiếng Việt | **tiếng Anh** |
| Chữ hiện trên màn hình, câu lỗi | tiếng Việt | **tiếng Anh** |
| Tài liệu `.md`, câu trả lời cho chủ dự án | tiếng Việt | **tiếng Việt** (không đổi) |

Đã sửa: `CLAUDE.md` (dòng mở đầu + Luật 7), `.claude/rules/naming.md` (bảng, mục "Vì sao", mục ghi
lại việc đổi luật), `.claude/hooks/session-rules.mjs` (bản rút gọn in ra mỗi phiên). Hook
`guard-naming.mjs` **không phải sửa** — nó chỉ chặn TÊN tiếng Việt, và điều đó không đổi.

Toàn bộ `plugins/plugin-manager/` cùng phần mới trong `src/main/` đã viết lại theo luật mới. Giao
diện nay là: tab **On/off**, hai nhóm **Harness Desktop plugins** / **DeepSeek core plugins**, nút
**Disable** / **Enable**, ô **Search plugins**, hộp xác nhận *"Disable ui-settings-plugin-inventory?"*
với ô tích *"I understand the app may lose some functionality"*. Xác nhận lại trên trang thật: 134
dòng, nút của plugin bị khoá vẫn `disabled`, nút xác nhận vẫn bị chặn tới khi tích ô.

**Hai vùng còn tiếng Việt, cố ý:**

- `plugins/dock/` và `src/main/` — chú thích và vài nhãn cũ (`'Đóng panel'`, `'Cho agent điều khiển
  trình duyệt'`). Dọn dần trong lúc sửa từng file; dịch hàng loạt bằng regex sẽ làm mất đúng phần ghi
  lại *vì sao* mỗi quyết định được chọn, mà đó là phần giá trị nhất.
- `scripts/spike-*.mjs` — chữ **in ra terminal** giữ tiếng Việt: đó là báo cáo cho chủ dự án đọc, chỉ
  tình cờ đi qua stdout. Ngoại lệ này đã ghi vào `.claude/rules/naming.md`.

`npm run typecheck` sạch, `npm run spike:manager` **13/13 đạt** sau khi đổi.

### Toàn bộ app sang tiếng Anh, và một lỗi chủ dự án bắt được trong app thật

Chủ dự án chỉ vào dòng *"Cho agent điều khiển trình duyệt"* trong Cài đặt và nói: app trình bày bằng
tiếng Anh đi. Đã dịch **mọi chữ người dùng thấy**, không chỉ phần mới:

- `plugins/dock/src/client/` — nhãn tab (`New web page`, `New terminal`), nút (`Close panel`,
  `Open more`, `Reload`, `Back`, `Forward`, `Reopen`), nhãn trợ năng, placeholder, câu trạng thái
  (`This folder is empty.`, `The terminal session closed.`), dòng cài đặt của panel, thẻ ảnh chụp.
- `src/main/` — menu khay hệ thống (`Open data folder`, `Open engine log`, `About`, `Quit`), thông
  báo Windows (`The agent needs your approval`, `The agent is done`…), trạng thái khay (`Starting…`,
  `Running`, `Failed to start`).
- `resources/` — splash, trang lỗi khởi động, trang Giới thiệu; cả `lang="vi"` → `lang="en"`.

**Ba bộ kiểm phải sửa theo, và hai trong ba đã đỏ trước khi sửa** — đúng loại phụ thuộc mà việc đổi
nhãn làm lộ ra:

- `spike:dock` **dừng giữa đường** ở mục 8 vì nó dò `textContent.includes('Terminal')`, mà nhãn nay
  là `New terminal`. Nay dò không phân biệt hoa thường theo từ khoá ổn định.
- `spike:card` đỏ 3/5 mục vì dò `'đang chụp'`, `'không có ảnh'`, `'chụp không được'`.
- Cả hai đều xanh lại: `spike:dock` **62/62**, `spike:card` **5/5**.

### Lỗi: bật lại một plugin thì không có nút tải lại, và panel không trở về

Chủ dự án thử trong app thật: tắt `include:hdw-dock` → có nút tải lại → bấm → panel mất thật. Nhưng
**bật lại thì không thấy nút tải lại và panel không trở về.** Mười ba mục kiểm đều xanh khi đó.

Nguyên nhân: tab hỏi *"plugin này có phần hiện trên màn hình không"* bằng cách xem engine có phục vụ
`client.js` của nó không — và chỉ hỏi **trước** cú gạt. Nhưng engine chỉ phục vụ bundle khi plugin
đang bật, nên dấu vết đó **đảo chiều** theo hướng gạt:

| | trước cú gạt | sau cú gạt |
|---|---|---|
| tắt | 200 (có) | 404 |
| bật | 404 | 200 (có) |

Hỏi một phía thì chiều tắt đúng, chiều bật luôn ra "không có nửa giao diện" → không lời nhắn, không
nút tải lại. Sửa: hỏi **cả hai phía**, `servedBefore || servedAfter`. Xác nhận lại trên trang thật cả
hai chiều, và bấm nút tải lại thì panel trở về (`.hdw-dock` có lại trong DOM, gói dock có lại trong
`__DSH_BOOT__`).

Thêm mục kiểm **7b** neo đúng sự thật đó (`client.js: 200 → 404 → 200`), nên lần sau ai hỏi một phía
sẽ đọc thấy lý do ngay tại chỗ. `npm run spike:manager` nay **14/14 đạt**.

**Bài học lặp lại lần thứ ba trong dự án này:** bộ kiểm HTTP xanh hết mà tính năng vẫn hỏng ở chỗ
người dùng chạm vào. Lần này lỗi nằm trong logic của component, mà không mục kiểm nào chạy component
đó. Bộ kiểm giao diện tự động cho tab này (kiểu `spike:dock`) là việc còn thiếu, và đây là lần thứ hai
nó chứng minh mình cần thiết.

## 2026-08-17 — Bộ kiểm bấm thật vào tab Bật/tắt, và lỗi nó bắt được ngay lượt đầu

`scripts/spike-switch-ui.cjs` (`npm run spike:switch`, 13 mục). Mở một cửa sổ Electron thật, nạp trang
thật, bấm vào Cài đặt → Plugins → tab Bật/tắt, rồi gạt công tắc bằng chuột.

Vì sao: hai lần trong dự án này một lỗi người dùng thấy ngay đã đi qua toàn bộ bộ kiểm — thẻ ảnh chụp
không hiện ra (60 mục xanh), và bật lại plugin thì không có nút Reload (13 mục xanh). Cả hai lần lỗi
nằm trong **logic của thành phần giao diện**, mà không mục kiểm nào mở trang và bấm. Dự án đã có đúng
loại bộ kiểm cần thiết từ lâu (`spike-dock-ui.cjs`); nó chỉ chưa bao giờ được chỉ sang trang Cài đặt.

**Nghiệm thu chính cái lưới, không chỉ nghiệm thu app.** Thả lại con lỗi cũ vào `PluginSwitchTab.tsx`
(chỉ hỏi `hasClientHalf` trước cú gạt) thì mục 5 và 6 vẫn xanh còn mục 7 và 8 chuyển đỏ — khớp từng
chữ với điều chủ dự án báo. Hoàn nguyên thì 13/13. Một bộ kiểm chưa từng đỏ thì chưa chứng minh được gì.

**Lỗi thật nó bắt được ngay lượt chạy đúng đầu tiên:** lý do một plugin bị khoá **không bao giờ hiện ra
được**. Nút bị khoá là `disabled`, mà nút `disabled` không phát sự kiện chuột và không nhận được tiêu
điểm — nên tooltip không có đường bật lên, trong khi chính câu giới thiệu của tab bảo người dùng rê
chuột vào nút để xem lý do. Sửa: neo tooltip vào một lớp bọc (`.hdw-pm-lock`), cho nó nhận được cả
chuột (`pointer-events: none` trên nút) lẫn bàn phím (`tabindex`).

Ba cái bẫy đáng ghi, cả ba chỉ lộ khi chạy thật:

- Hộp chào mừng của upstream đặt `#root.inert = true`. Ở trạng thái đó `.click()` **bị bỏ qua trong im
  lặng** — không lỗi, không cảnh báo. Nên mục kiểm số 0 phải chờ tới khi `inert` tắt mới đi tiếp.
- Các hộp onboarding **thay chỗ nhau một-đổi-một**, nên phép đếm "số hộp giảm" không bao giờ đúng. Phải
  đo bằng danh tính hộp trên cùng.
- Mục Plugins trong nav **không có thuộc tính nào ổn định** và nhãn thì đổi theo ngôn ngữ. Bám bằng hệ
  quả: bấm thử từng mục nav rồi dừng khi tab của ta xuất hiện. Tab của ta thì bám được chính xác —
  upstream dựng `id` của tab từ id đăng ký, nên `hdw-switch` có thật trong DOM.

## 2026-08-17 — App nói tiếng Anh trọn vẹn: chữ cho agent, chữ trên màn hình, và 1849 dòng chú thích

`src/main/` và `plugins/dock/` nay không còn một chữ tiếng Việt nào. Ba lớp:

1. **Chữ agent đọc** — mô tả 12 tool và mọi câu lỗi đi về tới model. Ba chỗ trong mô tả tool là hợp
   đồng hành vi chứ không phải văn xuôi, nên giữ nguyên ý từng chữ: câu chặn tiêm lệnh, quy tắc mã
   tham chiếu được cấp lại mỗi lần đọc, và lời hứa báo tên kẻ đang che thay vì bấm trượt.
2. **Mười chỗ vẫn hiện trên màn hình** mà lượt dịch trước sót — xem `.claude/rules/naming.md`.
3. **1849 dòng chú thích**, dịch tay từng khối. Khoảng 40% nằm trong khối `@module` dài 15–42 dòng ghi
   lại *vì sao* một cách làm bị loại, và dẫn ra bằng chứng không suy lại được từ mã.

Ba chỗ chú thích đã **nói sai so với mã**, sửa chứ không dịch: một đoạn bảo chữ trong thẻ ảnh là tiếng
Việt (đã là tiếng Anh từ lâu), và hai chỗ đếm sai số tool.

Sáu mục kiểm phải sửa theo vì chúng dò chữ tiếng Việt của app. Một chỗ suýt lọt: mục 18f dò chữ `TẮT`
— viết hoa, không dấu nào ở chữ thường, nên mọi phép quét theo dấu đều đi qua nó. **Quét theo dấu là
chưa đủ.**

Và hai mục kiểm vốn đã **nói dối từ trước**, cùng lộ ra khi chụp mốc: `spike:dock` mục 19d dò một câu
đã dịch, `spike:plugin` mục 2 dò một dòng log không còn tồn tại — mục sau còn báo sai theo chiều nguy
hiểm hơn (nửa Node vẫn luôn chạy, nó bảo là KHÔNG). Nay đo bằng dấu vết thật.

`scripts/` dọn được 4 file rồi chủ dự án chốt DỪNG — xem mục dưới.

## 2026-08-17 — Lượt chạy model thật sau khi dịch: 14/16, và phép đo A/B cho mục đỏ

`npm run spike:live` với `~/.dsh` thật, sau khi mô tả 12 tool đổi sang tiếng Anh. **14/16 đạt.** Model
vẫn làm xong việc: đọc trang, gõ vào ô tìm kiếm rồi đọc kết quả, bấm liên kết, chụp ảnh và ảnh hiện
ra, xem trang ở cỡ điện thoại, mở nhiều tab, xem danh sách request, cuộn và đọc phần dưới, trích dữ
liệu từ bảng, tra một con số, mở nhiều nguồn để so sánh, và báo đúng khi một trang cần đăng nhập.

Hai mục đỏ, và **cả hai đều không phải do việc dịch**:

- **Google Docs** — chưa đăng nhập Google trong panel ở lượt chạy này. Bộ kiểm nói thẳng lý do đó.
- **Điền form rồi gửi** — agent điền xong rồi **dừng lại hỏi người dùng** thay vì bấm gửi. Mục này
  từng đạt trong sổ, nên không loại trừ được ngay là do chữ mới. Đã **đo A/B**: trả `tools.ts` về đúng
  bản tiếng Việt của commit trước, dựng lại, chạy lại riêng mục đó — **đỏ y hệt**. Vậy nguyên nhân
  nằm ở hành vi của agent trước một việc gửi đi không hoàn tác được, không nằm ở ngôn ngữ mô tả tool.

Bài học về cách kết luận: một mục đỏ ngay sau một thay đổi lớn *trông* như hậu quả của thay đổi đó.
Cách duy nhất biết được là hoàn nguyên đúng một thứ rồi đo lại — tốn một lượt gọi model, và đổi lại là
một câu trả lời chắc chắn thay vì một lời phỏng đoán ghi vào sổ.

## 2026-08-17 — Chốt: bộ kiểm trong `scripts/` để nguyên tiếng Việt

Chủ dự án quyết không đổi tên trong các file bộ kiểm. Ghi lại vì đây là **một quyết định, không phải
việc còn tồn** — người đọc sổ sau này đừng "dọn nốt cho đủ bộ".

Lý do đứng vững: `scripts/` là mã kiểm, không có bộ kiểm nào bắt lỗi cho chính nó, nên đổi tên ở đó là
nhận rủi ro mà không đổi lấy được gì. Nặng nhất là `spike-dock-ui.cjs` — vừa mang ~120 tên tiếng Việt,
vừa chính là cái lưới dùng nghiệm thu mọi thay đổi khác.

Bốn file đã dọn trước khi có quyết định thì để vậy, đã chạy lại và đạt. Không hoàn nguyên: hoàn nguyên
cũng là một lần sửa có rủi ro, mà không được gì.

Luật cập nhật theo ở `.claude/rules/naming.md`: trong `scripts/`, tiếng Việt là hợp lệ — chú thích, tên
hàm, chữ in ra terminal. Mã của app thì không có ngoại lệ nào.

## 2026-08-17 — Bộ lọc thẻ `<think>` cho model bên thứ ba

Nằm ở `plugins/think-tags/`. **Không có giao diện** — nó làm việc ở tầng dữ liệu, nên không cắm vào
slot nào và không thuộc mức 1/2/3. Chỗ móc là `llm/stream`, một waterfall upstream chừa sẵn để plugin
bọc lấy dòng chữ model gửi về trước khi nó tới màn hình.

**Triệu chứng:** MiniMax M3 hiện nguyên `<think> … </think>` ở đầu câu trả lời, đồng thời ô Think bên
dưới lặp lại đúng chữ đó.

**Vì sao:** giao thức có một trường riêng cho phần suy nghĩ (`reasoning_content`), và pi-ai đọc đúng
trường đó — đã kiểm trong `pi-ai/dist/api/openai-completions.js`, nó nhận `reasoning_content`,
`reasoning`, `reasoning_text` và **không** đọc thẻ `<think>` trong nội dung. MiniMax viết phần nghĩ
vào thẳng nội dung, bọc thẻ. Không có công tắc cấu hình nào chữa được: `compat.thinkingFormat` của
pi-ai quyết định cách **gửi đi** mức suy nghĩ, không phải cách **đọc về**.

**Hai luật giữ cho nó không bắt nhầm:**

1. Chỉ thẻ **mở đầu** câu trả lời mới tính. Thẻ nằm giữa bài là chữ thật — chính dự án này có những
   lượt hội thoại nhắc tới `<think>` — và nó ở nguyên chỗ cũ.
2. Mỗi lượt chỉ một nguồn suy nghĩ sống sót, nguồn nào tới trước thì thắng. Nhà cung cấp gửi hai lần
   (đúng hình dạng trong ảnh chụp màn hình) thì chỉ còn một ô Think.

**Phần lịch sử.** Bản đầu bỏ `replayState` của nhà cung cấp mỗi khi có sửa — bắt buộc, vì nó tự đối
chiếu từng mục với các khối trong tin nhắn, mà ta vừa tách một khối thành hai. Cái giá là model không
còn đọc được phần nghĩ của chính nó ở lượt sau.

Đã thử chữa bằng cách **xếp lại danh sách mục** cho khớp. Chạy được, đo được (model chép lại nguyên
văn phần nghĩ cũ). **Đã hoàn nguyên** sau khi chủ dự án hỏi vì sao không làm theo triết lý plugin —
câu hỏi đúng: cấu trúc đó upstream ghi rõ là *adapter-private*, không hook nào của dự án canh được,
và nó sẽ hỏng trong im lặng ở một bản engine sau. Chỗ chữa thật nằm ở `plugins/minimax-relay/` bên
dưới, và khi trạm đó chạy thì bộ cắt thẻ này **không bao giờ nổ** — nó chỉ còn là lưới đỡ cho model
khác có cùng tật.



## 2026-08-17 — Trạm chuyển tiếp MiniMax: chữa từ gốc thay vì chữa hậu quả

Nằm ở `plugins/minimax-relay/`. Không giao diện, không cắm vào slot nào.

**Một dòng tóm tắt:** MiniMax có sẵn tham số `reasoning_split`; bật lên là nó trả phần nghĩ ra đúng
trường `reasoning_content` mà engine vốn đã đọc. Plugin dựng một trạm nhỏ trên chính cổng của engine,
đổi `baseURL` của tuyến MiniMax trỏ vào đó, và thêm đúng tham số ấy vào mỗi yêu cầu. Từ đó **không
còn gì phải cắt, sửa hay đoán**: ô Think, trí nhớ của model, bộ nhớ đệm đều chạy bằng đường gốc.

### Ba đường đã dò, và vì sao chọn đường này

| Đường | Vì sao không / vì sao có |
|---|---|
| Khai `reasoning_split` trong cấu hình | **Không có chỗ khai.** Hồ sơ tuyến của `llm-pi-ai` chỉ nhận địa chỉ, khoá, header, thời gian chờ, `compat`; pi-ai không có `extraBody`. Đây là việc của upstream — một dòng bên họ là plugin này biến mất |
| Sửa lịch sử ở `llm/stream` | **Bị chặn có chủ ý.** Yêu cầu do agent loop dựng là `deepFreeze`; tài liệu ghi *"listeners read it, never rewrite it"*; `agent/request` cũng ghi *"cannot mutate messages"*. Nội dung yêu cầu phải là hàm thuần của session log |
| Tự nắm tuyến model bằng `PiAiAdapter` | Gói có export `PiAiAdapter`, nhưng **không export bộ phân giải hồ sơ**, nên phải dựng lại toàn bộ phần đó — bám sâu hơn hẳn — và mất trang Settings → Models cho tuyến đó |
| **Trạm chuyển tiếp** | Không đụng thứ riêng tư của ai. Thứ duy nhất bám vào là một tham số **công khai** trong tài liệu MiniMax |

Lỗi này cũng đã có người báo cho chính pi-ai: *"MiniMax-M3 thinking content leaks into the assistant
text response"*.

### Ba chỗ dễ sai, đã trả giá để biết

- **Plugin ngoài cây engine KHÔNG import được gói của engine lúc chạy.** Node phân giải từ đường dẫn
  thật, đi tới `node_modules` của app chứ không phải của engine. Mọi `import` từ `@deepseek-ai/*` ở
  đây phải là **import kiểu**. Lần đầu dùng `settingsNamespace()` thật và plugin chết ngay khi nạp.
- **Cổng của engine đổi mỗi lần khởi động**, nên địa chỉ đã lưu luôn cũ. Giải: **nhét địa chỉ thật
  của MiniMax vào chính đường dẫn** (`/hdw/minimax/https%3A%2F%2F…`). Trạm không giữ trạng thái gì,
  nhận ra chữ viết của chính mình ở lần chạy sau, và người mở `settings.yaml` vẫn đọc được nó trỏ
  đâu.
- **Plugin này nạp trước khi bảng cấu hình model kịp có mặt** — hai bên không khai thứ tự với nhau.
  Lần chạy đầu địa chỉ không đổi mà chẳng có lỗi nào. Giải: quét lại theo nhịp trong lúc khởi động,
  và bám sự kiện `settings/updated` sau đó — cũng nhờ vậy mà thêm một tuyến MiniMax mới lúc đang chạy
  là nó tự nhận, không cần khởi động lại.

### Giá phải trả, nói thẳng

- Mọi chữ đi qua mã của ta, kể cả khoá API — **nhưng trạm không đọc khoá**, pi-ai đã gắn sẵn, ta chỉ
  chuyển tiếp nguyên văn.
- Trạm nằm trên cổng của engine nên **chỉ nhận kết nối trong máy** và **chỉ chuyển tiếp tới
  api.minimax.io / api.minimaxi.com**. Thiếu hai rào này thì nó là một proxy mở.
- Tắt plugin thì địa chỉ thật được trả lại (disposer chạy). Mất điện giữa chừng thì địa chỉ trạm còn
  nằm trong `settings.yaml` — vô hại vì lần khởi động sau ghi lại, **trừ khi** plugin bị tắt trước
  lần đó. Sửa tay ở Settings → Models.

### Đã đo

`npm run spike:relay` — 14 mục. Gồm một MiniMax giả chạy trên socket thật để chứng minh **chữ chảy về
từng đoạn chứ không dồn một cục** (dồn cục là người dùng nhìn màn hình trống rồi cả bài hiện ra cùng
lúc), và mục canh cửa: không chuyển tiếp đi đâu ngoài MiniMax.

Chạy thật trong app, hai lượt liên tiếp: câu trả lời sạch thẻ, ô Think do **engine tự dựng từ trường
riêng**, và lượt sau model **chép lại nguyên văn phần nghĩ lượt trước** — kể cả con số nó chỉ ghi
trong đầu. `Cache hit 51%`. Không còn một dòng nào của ta can thiệp vào nội dung.

### Hai lỗi lộ ra khi dùng thật, cùng ngày

**1. Thẻ ĐÓNG lạc lõng.** Bật `reasoning_split` rồi, MiniMax gửi phần nghĩ ở trường riêng — nhưng
vẫn để rơi cái thẻ đóng vào câu trả lời, mỗi bước một cái: `</think>`, và cả biến thể có tên miền
`</mm:think>`. Bộ cắt thẻ cũ chỉ biết thẻ MỞ nên không đụng tới.

Sửa ở `plugins/think-tags/`: một thẻ **đóng** đứng đầu khối chữ mà chẳng có thẻ mở nào chính là dấu
vết của tình huống này — không có phần nghĩ nào để dời đi, chỉ là một cái dấu thừa, nên bỏ. Cả hai
lối viết `think` và `mm:think` đều được nhận, ở cả thẻ mở lẫn thẻ đóng. Thẻ nằm **giữa** câu trả lời
vẫn là chữ thật, không đụng vào.

**2. Ký tự lạ giữa chữ tiếng Việt** — `Các bư?c đã thực hiện`. Một chữ tiếng Việt dài 2–3 byte; gói
dữ liệu đứt ngay giữa nó; bên đọc dịch từng gói riêng lẻ nên ra dấu hỏi. Thêm một chặng chuyển tiếp
làm chỗ đứt rơi vào những vị trí khác trước đây, nên lỗi này lộ ra.

Sửa ở `plugins/minimax-relay/`: **cắt lại dòng theo ranh giới sự kiện**. Mỗi sự kiện kết thúc bằng
một dòng trống, mỗi sự kiện chở một token, nên chữ vẫn về từng token một — mà mảnh nào giao đi cũng
là trọn dòng, trọn chữ. Bộ kiểm cắt một sự kiện tiếng Việt ra **từng byte một** rồi ghép lại: đủ
byte, không mảnh nào chứa ký tự hỏng.

Cả hai đã đo lại: `npm run spike:think` 15 mục, `npm run spike:relay` 19 mục, và chạy thật trong app
— câu trả lời tiếng Việt có dấu đầy đủ, không còn thẻ nào sót.

## 2026-08-18 — Panel bên phải tách theo từng chat, và trang web nằm im thì ngủ đông

Nằm ở `plugins/dock/`, vẫn đúng bốn slot cũ (`shell.overlay`,
`conversation.session.header.utilities`, `settings.general.item`, `tool.call.toolview`), **mức 1**.
Thêm một hàng trong Settings > General: *"Put idle web pages to sleep"*.

Trước đây cả app dùng **một** dải tab. Trang web mở trong một chat hiện ở mọi chat, mọi workspace —
đúng cái chủ dự án gặp. Nay dải tab khoá theo id chat (`byChat` trong `store.ts`); riêng độ rộng
panel, công tắc cho agent và hẹn giờ ngủ vẫn dùng chung cả app, vì chúng là tuỳ chọn chứ không phải
việc đang làm dở.

Ba quyết định đáng nhớ:

**Panel vẫn dựng panes của MỌI chat, chỉ ẩn cái không thuộc chat đang xem.** Bỏ panes của chat khác
ra khỏi cây React là giết terminal của chat đó ngay lập tức. Đây chính là bệnh nặng nhất của bản cũ:
thư mục gốc lấy theo chat đang xem, nên đổi sang chat ở workspace khác là socket đứt và **shell đang
chạy bị giết, không báo gì**. Nay mỗi pane lấy thư mục từ chat của chính nó.

**Lệnh của agent mang theo id chat, bơm bằng `AsyncLocalStorage`.** Không luồn `exec` qua hơn ba
mươi chỗ gọi `read`/`act`: chỗ thứ ba mươi mốt sẽ bị quên, và quên thì không lỗi — chỉ là agent
lặng lẽ chạm vào tab của chat khác. Buộc một lần ở chỗ lời gọi đi vào, đọc một lần ở chỗ gửi đi.

**`lastSeen` giữ nguyên qua các lần mở app, không đặt lại.** Nó trả lời "lần cuối nhìn thấy trang
này là bao giờ", và câu đó không bắt đầu lại chỉ vì app khởi động lại. Đặt lại thì một trang không
bao giờ được ngó tới vẫn thức mãi, miễn người dùng tắt mở app đủ thường xuyên.

Ngủ đông chỉ áp cho trang web, **không bao giờ cho terminal**: giết một shell để tiết kiệm bộ nhớ là
mất luôn lệnh đang chạy. Hai ngoại lệ giống Chrome — trang **đang phát tiếng** và trang **đang giữ
chữ người dùng gõ vào**. Trang đánh thức lại vẫn còn đăng nhập (các trang dùng chung một kho
`persist:hdw-browser` trên đĩa); thứ mất là chỗ đang cuộn.

Nghiệm thu: bộ kiểm cũ `npm run spike:dock` 62/62 đạt, và bộ mới `npm run spike:chats` 16/16 đạt —
dựng hai phiên thật rồi đo dải pill, terminal chat nền, ngủ và đánh thức, và việc tab agent mở rơi
đúng chat agent khai. Phiên thứ hai phải gieo từ phía engine (`scripts/spike-session-seed.mjs`):
bấm "New Session" trong app không sinh phiên mới, vì app khởi động vốn đã ở một phiên trống.

**Hai hàng Settings thêm vào lúc đầu KHÔNG khớp với trang, và sai ở bốn chỗ cùng lúc** — mắt thường
chỉ thấy "trông lệch lệch", nên phải đo. Gốc rễ: CSS của hàng được **bịa số** thay vì lấy số của
upstream. Đọc rule đã dựng của `EnterBehaviorRow` — hàng nằm ngay phía trên hàng của ta trên cùng
trang đó — ra bốn khác biệt:

| Chỗ | Bản đầu (bịa) | Upstream |
|---|---|---|
| Đường kẻ giữa các hàng | không có | `border-bottom` 1px `--dsw-alias-border-l2` |
| Khoảng thở dọc | không có | `padding: 16px 0` |
| Ô chọn | hộp viền 1px, bo 6px, nền `bg-layer-1`, chữ 12px | viên thuốc cao 36px, bo 18px, không viền, nền `bg-module-platform`, chữ 14px |
| Tiêu đề | 13px | 14px |

Thiếu đường kẻ cộng thiếu padding là thứ làm hai hàng dính liền thành một khối, trong khi mọi hàng
xung quanh đều tách bạch. Ngoài ra ô chọn còn **tràn 45px ra ngoài mép phải**: nhãn *"After 30
minutes"* quá dài so với nhãn ngắn của upstream (*"Queue"*), và `Menu` bọc nút trong một lớp vỏ riêng
— chính lớp vỏ đó mới là phần co giãn, và nó bị bóp nhỏ hơn nút.

Nay mọi số lấy từ upstream, nhãn rút thành *"30 min"*, mô tả rút còn một dòng như các hàng khác, và
bỏ icon cảnh báo (hàng của upstream không có icon nào). CSS của họ nằm trong CSS module mà plugin
không import được, nên khớp nghĩa là **chép lại số**; điều không chấp nhận được là bịa số khác. Mục
kiểm 8a/8b/8c nay canh cả ba: không tràn, đúng khoảng cách và đường kẻ, mô tả không quá hai dòng.

**Bấm được nút bật panel bằng máy, sau ba lần tắc.** Nút nằm trong thanh tiêu đề phiên, mà app chỉ
dựng thanh đó cho phiên ĐÃ CÓ nội dung — phiên trống thì nó bày màn hình soạn tin lớn và nút không có
chỗ mọc. Bấm "New Session" không sinh phiên mới (app vốn đã ở phiên trống); thanh bên không liệt kê
phiên nào để bấm vào. Đường đi được: gieo ở phía engine một phiên có sẵn tin nhắn, rồi ghi thẳng id
đó vào khoá `dsh.sessions.current` — nơi app nhớ phiên đang mở — và nạp lại. Khoá này tìm ra bằng
cách đổ toàn bộ localStorage ra xem.

Mục 0 không chỉ hỏi "panel có mở không" mà đòi dải tab sinh ra mang ĐÚNG id phiên đó. Nút không nhận
được id thì panel vẫn mở, trông như chạy đúng, nhưng trạng thái rơi vào một ngăn không thuộc chat
nào — loại hỏng im lặng mà chỉ con số mới lộ ra.

Hai mục kiểm trong `spike-dock-ui.cjs` phải sửa chỗ gieo dữ liệu theo khuôn mới. Mục 17b đáng chú ý:
gieo theo khuôn cũ thì nó vẫn đỏ, nhưng đỏ vì *"không có tab tên đó"* chứ không phải vì rào địa chỉ
nội bộ đã chặn — một mục kiểm hỏng vì lý do khác với điều nó khai là một mục kiểm nói dối.

## 2026-08-18 — Soul và Memory: app bắt đầu nhớ chủ dự án là ai

Plugin mới `plugins/growth/`, cắm vào `settings.section` — **mức 1**, một trang Settings mới tên
**Growth**. Đây là giai đoạn 1 của bốn trụ cột kiểu Hermes Agent (Soul, Memory, Skills, Cron); hai
trụ sau còn để dành, thang chống bỏ sót cũng vậy.

**Soul** là một file `~/.dsh/growth/SOUL.md` chủ dự án tự viết, được nạp vào **phần đầu của system
prompt** (`systemPrompt.section`, order 20 — dải trống giữa persona của bản triển khai ở 0 và hướng
dẫn tool từ 100). **Memory** là những mẩu sự thật model tự lưu bằng tool `remember`, nạp vào bằng
`systemPrompt.context` chứ **không** phải `section`. Khác biệt này là cả thiết kế: `section` nằm
trong phần đã đệm sẵn nên chỉ hợp với thứ không đổi giữa phiên; `context` phát ra sau lịch sử và
**im lặng hoàn toàn khi nội dung không đổi**, nên danh sách mẩu nhớ đổi giữa chừng không phá bộ đệm.
Hệ quả cứng: văn bản render ra không được chứa ngày giờ hay bất cứ thứ gì đổi theo đồng hồ, nếu
không mỗi bước model lại sinh thêm một bản chụp gần giống hệt.

Memory chia hai tầng: chung, và riêng theo thư mục dự án (khớp `session.header.cwd`, chuẩn hóa
không phân biệt hoa thường vì Windows coi `D:\proj` và `d:\proj\` là một). Soul chỉ có một bản
chung — giọng điệu không đổi theo thư mục, thứ đổi theo thư mục là sự thật, và Memory đã lo.

**Bẫy đáng nhớ nhất: `{{ }}` giết cả lượt chat.** Engine nội suy `{{ten}}` rất nghiêm, gặp biến lạ
là ném lỗi khi render và hỏng lượt, không có cú pháp thoát. Cả hai nguồn đều có thể mang nó: SOUL.md
là văn xuôi người viết, còn mẩu nhớ thì **chính model viết ra** — nghĩa là model có thể tự lưu một
mẩu làm chết mọi cuộc trò chuyện sau đó cho tới khi ai đó sửa tay file JSON. Hàm `neutralize()` bẻ
`{{` và `}}`, áp **cả lúc ghi lẫn lúc đọc**. Đã thử thật: lưu `{{name}}` xong, lượt chat vẫn chạy.

Cũng vì HTML comment không lồng được: bản đầu của file mẫu có câu giải thích *chứa* dấu đóng
comment, nên khối chú thích đóng sớm và một dòng rác lọt vào prompt của mọi cuộc trò chuyện. Lỗi
này chỉ lộ ra khi mở app xem `preview` — typecheck và build đều xanh.

Ba thứ không import lúc chạy, vì plugin nằm ngoài cây module của engine và import giá trị làm engine
**chết lúc khởi động** với `ERR_MODULE_NOT_FOUND`: `defineTool`, `defineDomain`, `renderPrompt`. Tool
và domain spec đều dựng bằng object literal; bộ kiểm tra bản ghi viết tay thay zod và **không bao giờ
ném** — một `parse` ném lỗi sẽ làm hỏng `open`, hỏng `apply`, và giết plugin chỉ vì một dòng JSON
hỏng. `build.mjs` có thêm chốt thứ tư quét đúng lỗi này ở nửa Node (nửa client được miễn, vì ở đó
các gói ấy là import giá trị hợp lệ do shell cấp).

Kho dữ liệu: domain `harness_desktop_growth`, một bảng `facts`, rơi vào backend `json` mặc định của
profile web — `~/.dsh/storages/harness_desktop_growth.json`, người đọc được. Giữ `version: 1` và
không khai trước bảng nào chưa dùng: backend JSON coi bảng thiếu là bảng rỗng, nên giai đoạn 2 thêm
hàng đợi duyệt skill không cần nâng version cũng không cần chuyển đổi dữ liệu.

Sáu lớp `--patch` thay vì năm; lớp của growth đứng trước lớp lựa chọn người dùng, để tắt được.

## 2026-08-18 — Vòng tự cải thiện: app tự đúc kết kỹ năng sau khi làm việc xong

Giai đoạn 2 của `plugins/growth/`. Thêm hai thứ vào cùng trang **Settings → Growth** (vẫn mức 1,
vẫn một chỗ cắm `settings.section` duy nhất): hàng đợi **skill chờ duyệt**, và **vòng chạy nền** tự
nhìn lại cuộc trò chuyện vừa xong.

**Vòng nền không phải thứ ta tự dựng.** Engine đã có sẵn hai nhà cung cấp agent con, và một trong
hai là `fork` — nó tạo agent con **mang theo nguyên các lượt đã hoàn tất của phiên cha**. Đó đúng
bằng cơ chế Hermes Agent dùng (đọc thẳng `agent/background_review.py` của họ). Nên phần "nhân bản
để nhìn lại" chỉ là một lời gọi `ctx.subagents.start('fork', …)`, không có mã điều phối nào của ta.

Ba chốt chặn, mỗi cái chặn một kiểu hỏng khác nhau:

- **Ngưỡng 10 lượt gọi công cụ.** Đo thật: mỗi lần chạy tốn 30–60 nghìn token. Chạy sau mọi câu chat
  là đốt tiền. Phiên hỏi đáp nhẹ không kích hoạt gì.
- **`toolFilter: { allow: ['remember', 'propose_skill'] }`.** Đây là cơ chế của engine, không phải
  lời dặn trong prompt: hai tool đó là tất cả những gì agent nền **nhìn thấy**, mọi tool khác biến
  mất khỏi prompt của nó **và** bị từ chối lúc chạy. Nó không sửa được file, không chạy được lệnh.
- **Bỏ qua phiên con và phiên review.** Không có chốt này thì mỗi lần review lại sinh một review.

**Skill đi đường khác memory, có chủ ý.** Memory ghi thẳng; skill chỉ **xếp hàng**. Một mẩu nhớ sai
là một câu sai, xóa một cú bấm. Một skill sai là chỉ thị thường trực mà agent sẽ tuân theo trong mọi
việc cùng loại. Trang Settings hiện đủ ba thứ trước khi nút Approve với tới được: file sẽ ghi ở đâu,
nội dung đầy đủ sẽ ghi, và **nội dung đang có nếu việc duyệt là ghi đè**.

Duyệt xong thì ghi vào **chính thư mục skill của engine** (`~/.dsh/skills` hoặc
`<dự án>/.dsh/skills`) — nơi engine vốn đã quét và theo dõi thay đổi. Nghĩa là plugin không có một
dòng mã tìm kiếm skill nào, và skill vừa duyệt dùng được ngay ở **phiên chat kế tiếp** (không phải
phiên đang mở: danh mục skill được chụp ở đầu phiên).

**Đã chạy thật, không phải suy luận.** Một phiên chat 10 lệnh + một quy tắc làm việc → vòng nền tự
khởi động (thanh tiêu đề hiện "1 subagent", 30–60K token, 4–7 giây) → nó tự ghi một mẩu nhớ và tự
viết skill `dsh-release-check` gồm bốn bước cùng năm cạm bẫy → duyệt → file `SKILL.md` xuất hiện
đúng chỗ → phiên chat mới liệt kê skill đó trong danh sách của mình.

Cũng đã thấy đúng thứ mà bước duyệt sinh ra để chặn: skill nó viết trộn vài chi tiết **không có
thật** (lệnh `pnpm`, một cổng máy chủ, một cấu trúc thư mục) suy diễn từ ngữ cảnh khác. Nếu ghi
thẳng thì từ đó về sau agent tin những điều đó. Đây là lập luận sống cho việc skill phải chờ duyệt.

Bảng `pending_skills` thêm vào domain cũ, **giữ nguyên `version: 1`**: backend JSON đọc bảng thiếu
trong file là bảng rỗng, nên không cần nâng phiên bản cũng không cần chuyển đổi dữ liệu. Nâng
version sẽ làm engine từ chối đúng cái file mà mọi người dùng hiện có đang giữ.

## 2026-08-18 — Vòng nền báo cáo ngay dưới ô nhập, và mọi thứ đã nhớ đều truy được nguồn

Chủ dự án bấm vào nút "1 subagent" và hỏi: có cần một trang riêng như vậy không, chỉ cần một dòng
gọn là đủ. Đúng — nên thêm hai thứ, không bỏ thứ nào.

**Một dòng ngay dưới ô nhập** (`conversation.composer.dock`, **mức 1**): *"Growth review · remembered
1 · proposed 1 skill · 2m ago · 1 waiting for you"* kèm nút **Preview** mở hộp so sánh **cũ/mới**
ngay tại chỗ. Chỗ này là dải mà upstream đã để dòng thống kê của họ; slot loại `list` nên hai bên
ngồi cạnh nhau, không ai chiếm của ai.

Đã cân nhắc chỗ **cuối lượt chat** (`conversation.chat.turnTail`) vì đó là chỗ chủ dự án mô tả, và
loại nó vì một lý do đo được: slot đó hỏi plugin một câu **đồng bộ** ngay lúc vẽ — *"lượt này có gì
không?"* — trong khi vòng nền chạy sau khi lượt đã đóng và mất 4–7 giây. Dòng sẽ chỉ xuất hiện ở
lần mở lại phiên sau, tức đúng chỗ nhưng sai lúc.

**Truy nguồn trên mọi bản ghi.** Mỗi mẩu nhớ và mỗi skill nay hiện *"3m ago · chat 0a9aa32b"*, rê
chuột ra giờ tuyệt đối và id phiên đầy đủ. Kèm theo là một sửa lỗi thật: bản ghi do vòng nền tạo
trước đây mang id của **phiên fork** — thứ người dùng chưa bao giờ nhìn thấy và không tra được.
Nay nó ghi id của **cuộc trò chuyện gốc**. Vì thế `reviewSessions` đổi từ `Set` sang `Map` con → cha:
cần cả hai dữ kiện, một để đóng dấu `source: 'review'`, một để trả lời "việc này đến từ chat nào".

Dải chỉ hỏi lại máy chủ **khi đang có một vòng chạy**, xong thì ngưng. Một bộ đếm giờ thường trực
dưới mọi cuộc trò chuyện là chi phí không ai nhìn thấy.

Đã chạy thử: dải hiện đúng, Preview mở ra đủ ba phần (đích ghi file, nội dung đang có, nội dung sẽ
ghi). **Lưu ý vận hành:** giao diện plugin chỉ gắn vào khi trang tải — sau khi build lại, phải tải
lại trang mới thấy, đúng như nút "Reload now" ở tab bật/tắt plugin đã cảnh báo.

## 2026-08-18 — Dòng Growth chỉ hiện sau khi tải lại trang: đã sửa

Chủ dự án hỏi "sao tôi không thấy dòng Growth nào?" và câu hỏi đó chỉ ra một lỗi thật, không phải
hiểu nhầm.

Dòng dưới ô nhập hỏi máy chủ **đúng một lần, lúc trang vừa mở**. Sau đó nó chỉ hỏi lại khi *đã thấy*
một vòng nền đang chạy. Nhưng vòng nền **luôn khởi động sau khi lượt chat đóng lại** — nghĩa là ở
thời điểm trang hỏi, câu trả lời luôn là "chưa có gì", và trang không bao giờ hỏi lại nữa. Kết quả:
dòng chỉ xuất hiện nếu người dùng tình cờ tải lại trang. Đó chính xác là điều đã xảy ra khi thử.

Sửa: dòng đọc thêm cờ **lượt chat đang chạy hay đã xong** từ chính khung soạn tin (slot đã đưa sẵn
dữ liệu này và tự vẽ lại, không cần đăng ký lắng nghe gì). Khi lượt vừa chuyển từ *đang chạy* sang
*đã xong*, nó theo dõi thêm **90 giây** — đúng khoảng thời gian vòng nền có thể khởi động — rồi
ngưng hẳn. Thấy vòng chạy xong thì ngưng sớm.

Vì sao không đơn giản là hỏi lại mỗi vài giây: một bộ đếm giờ thường trực dưới **mọi** cuộc trò
chuyện đang mở là chi phí không ai nhìn thấy và không ai tắt được. Cửa sổ 90 giây gắn với một sự
kiện có thật thì chỉ tốn khi thật sự có việc.

## 2026-08-18 — USER.md, buổi hỏi đáp lần đầu, và sửa được ngay trên trang Growth

Chủ dự án chỉ ra một chỗ lệch: **SOUL.md là linh hồn của trợ lý, không phải hồ sơ của người dùng.**
Đúng. Rà lại OpenClaw thì họ tách hẳn hai file — `SOUL.md` cho trợ lý, `USER.md` cho người — nên
làm theo.

**`USER.md`, trần 3000 ký tự.** Thấp hơn `SOUL.md` (8000) có chủ ý: hồ sơ dài hơn thế đã thành nhật
ký, mà mỗi ký tự đều phải trả tiền ở **mọi tin nhắn của mọi cuộc trò chuyện**. OpenClaw để 4000; chủ
dự án chọn hạ xuống 3000.

**Trợ lý chỉ được nối thêm, không được viết đè.** Mọi dòng nó ghi đều nằm dưới một đề mục riêng
(`## Notes from the assistant`) và **có ngày tháng**. Phần trên là chữ của người dùng, không bao giờ
bị chạm tới. Lý do không phải lịch sự mà là an toàn: một model được quyền viết lại cả trang là một
model có thể lặng lẽ xoá đúng những giới hạn nó vừa được dặn phải tuân theo. Có ngày tháng thì một
dòng đã cũ mới nhìn ra được.

**Buổi hỏi đáp lần đầu, bằng một file tự xoá.** Lần chạy đầu tiên sinh ra `START.md`; khi nào nó còn
đó thì nội dung của nó nằm trong prompt và trợ lý mở lời hỏi bốn câu. Ghi hồ sơ xong là file bị xoá,
không bao giờ hỏi lại. **Sự tồn tại của file chính là cờ "chưa cài đặt"** — không có biến đếm nào,
không có ô trạng thái nào có thể mâu thuẫn với đĩa. Muốn hỏi lại thì chỉ việc đặt file về chỗ cũ.

Khác OpenClaw một điểm và đây là chủ ý: họ hỏi **từng câu một**, ta hỏi **cả bốn câu trong một tin
nhắn**. Người ta mở app lên là để làm việc, bắt họ đi bốn vòng trước khi được việc gì là cái giá thật.

**Sửa ngay trên trang, không phải mở Notepad nữa.** Đây là **thứ duy nhất trong plugin tự vẽ**, và
đã kiểm tra kỹ trước khi viết: bộ primitive của DeepSeek **không có ô nhập nhiều dòng**. Chính chú
thích đầu file `Input.tsx` của họ nói rõ *"textareas are NOT this atom — they live with the
conversation package"*, mà cái ở gói kia thì hàn chết trong khung soạn tin và không xuất ra ngoài.
Nên ô soạn thảo ở đây là một `<textarea>` trần, bọc **đúng theo khuôn `Input` của họ**, dùng lại
nguyên bộ biến `--dsw-*` cho viền, nền, chữ và màu khi focus — vì thế nó vẫn theo chế độ sáng/tối
như mọi ô nhập khác. Trần ký tự chặn ở **hai lớp**: nút Save mờ đi khi vượt, và máy chủ vẫn từ chối
một lần nữa nếu ai đó gọi thẳng.

**Hai lỗi thật, cả hai chỉ lộ ra khi mở app chạy thử:**

1. *Đề mục rỗng lọt vào prompt.* Sau khi trợ lý ghi dòng đầu tiên, file không còn "chỉ có đề mục"
   nữa, nên mấy đề mục mẫu chưa ai viết gì cũng đi theo — sáu dòng vô nghĩa, trả tiền ở mọi tin
   nhắn. Nay đề mục không có nội dung bên dưới thì bị bỏ.
2. *Ngày tháng lặp hai lần.* Model đọc file, thấy `- 2026-08-18 — …`, rồi viết lại đúng cái vỏ đó,
   trong khi phần vỏ do ta thêm — ra `- 2026-08-18 — 2026-08-18 — …`. Nay dấu đầu dòng và ngày ở
   đầu câu bị lột bỏ trước khi ghi.

**Chữ trên trang đã rút gọn** theo yêu cầu: ngắn nhưng đủ nghĩa. Ví dụ thẻ Soul từ ba dòng còn một —
*"How the assistant should behave with you. Read at the start of every conversation."*

Hai lỗi nữa, cũng chỉ lộ ra khi chạy thử thật:

3. *`remember` và `update_profile` giẫm chân nhau.* Bảo "ghi vào hồ sơ giúp tôi" mà model vẫn chọn
   `remember` — vì mô tả cũ của `remember` mở đầu bằng đúng chữ *"a durable fact about the user"*,
   tức là nó tự nhận luôn phần đất của tool kia. Đã tách lại ranh giới: `update_profile` lo **con
   người** và **luật hành xử**, `remember` lo **dự án và mã nguồn**. Thử lại thì vào đúng chỗ.
4. *Dòng mới rơi xuống dưới đề mục của người dùng.* Hàm ghi nối vào **cuối file**, mà cuối file chỉ
   trùng với cuối phần của trợ lý cho tới khi người dùng viết thêm một đề mục bên dưới — sau đó mọi
   dòng trợ lý ghi đều nằm dưới đề mục ấy, trông như chính người dùng viết. Nay nó chèn vào **cuối
   đúng phần của trợ lý**.

## 2026-08-18 — Bốn tab, sửa thẳng không cần bấm Edit, và cắt ngày tháng khỏi prompt

Chủ dự án soi ba chỗ, cả ba đều đúng.

**Bỏ ngày tháng khỏi phần model đọc.** Ngày là để **người** nhìn ra dòng nào đã cũ; model không làm
được gì với nó. Đã tra lại tài liệu chính thức của OpenClaw: họ **không** ghi ngày trong `USER.md` —
ngày chỉ nằm ở *tên file* nhật ký theo ngày. Phần ghi ngày trong dòng là ta tự thêm. Nay **ngày vẫn
nằm trên đĩa, nhưng bị lột trước khi đưa cho model**.

Cộng với hai thứ đã lọc từ trước — chú thích và đề mục rỗng — con số đo được: file `USER.md` **847
ký tự trên đĩa, chỉ 465 ký tự tới model**. Cắt 45%.

**Chú thích thì model có đọc được không — đã chứng minh, không phải nói suông.** Cắm hai mã vào
`USER.md`: một mã nằm trong chú thích, một mã nằm ở dòng thường. Hỏi model đọc cả hai. Nó trả lời
đúng mã ở dòng thường và nói thẳng *"không thấy ở bất kỳ đâu"* với mã trong chú thích. Cách tự kiểm
lại bất cứ lúc nào: mở **What the model sees** — đó chính là văn bản đã nạp, không phải bản mô tả
lại.

**Font chữ:** ô soạn thảo bỏ font mã nguồn, dùng font mặc định của app. Font mono biến một trang
viết về bản thân thành một hộp code.

**Bỏ nút Edit / Open file / Copy path.** Ô soạn thảo **chính là file** — gõ thẳng rồi bấm Save. Bắt
người ta bấm Edit trước khi gõ là bắt họ khai lại một ý định mà cú bấm đã khai rồi.

**Chia bốn tab** — About you · Soul · Skills · Remembered facts — vì bốn việc đó không liên quan gì
tới nhau trong cùng một lúc. **"What the model sees" nằm ngoài tab**, gập lại: nó trả lời câu hỏi
vắt qua cả bốn.

Không có component tab trong bộ của DeepSeek (cái trong app thuộc về khung Cài đặt và khung hội
thoại, đều không xuất ra). Nên hàng tab **ghép từ `Button`** — nút đang chọn giữ biến thể `primary`,
còn lại `ghost`. Không vẽ thêm gì, chỉ xếp chỗ và kẻ một đường phân cách. Phím mũi tên trái/phải
chuyển tab, và chỉ tab đang chọn nằm trong thứ tự Tab — đó là phần một hàng tab tự chế hay đánh mất.

**Một lỗi nữa lộ ra ngay tại chỗ:** bộ đếm ghi 774 trong khi ô soạn thảo chỉ có 754 ký tự. File đang
xuống dòng kiểu Windows — mỗi dòng cõng thêm một ký tự vô hình, tính vào trần và đi cả vào prompt,
còn ô soạn thảo của trình duyệt thì lặng lẽ bỏ nó đi. Nay mọi lần đọc và ghi đều quy về một kiểu
xuống dòng, hai con số khớp nhau.

Dọn theo: route mở file bằng trình soạn ngoài và hàm gọi nó đã xoá, vì không còn nút nào gọi tới.

## 2026-08-18 — Hàng tab dựng theo đúng khuôn của DeepSeek, và ô soạn thảo tràn viền

Chủ dự án gửi kèm ảnh chụp tab của chính DeepSeek và chỉ ra hai chỗ. Cả hai đều đúng, và cả hai chỉ
nhìn ra được bằng mắt.

**Hàng tab.** Bản đầu tôi ghép từ `Button`, nút đang chọn để biến thể `primary` — ra một viên thuốc
tô đậm nằm cạnh những hàng tab gạch chân của họ, trông như của app khác. Mở mã gốc ra xem thì tab của
họ (`PluginsSettingsSection.module.css`) **không dùng component `Button`**: là `<button>` trần, chữ
màu `label-tertiary`, gạch chân 2px bằng `::after` cho tab đang chọn, khoảng cách 22px, đường kẻ
`border-bottom` dưới cả hàng. Nay chép lại **từng dòng CSS một**, kèm cả hợp đồng bàn phím của họ:
mũi tên trái/phải, Home, End, và tiêu điểm đi theo.

Bài học: *"dùng vật liệu của hệ thống"* không chỉ là component xuất ra được. Khi upstream đã dựng
sẵn đúng thứ mình cần bằng CSS trần, thì bản mẫu chính là chỗ đó.

**Ô soạn thảo tràn qua viền phải đúng 22px.** `width: 100%` cộng `padding` 10+10 cộng viền 1+1, mà
`box-sizing` mặc định là `content-box` — nên bề rộng thật là 586 trong khung 564. Đo được, không phải
đoán. Thêm `box-sizing: border-box` là hết.

**Rà lại luôn những gì đã sửa**, theo yêu cầu, và ra thêm ba chỗ lệch:

1. *Thiếu tiêu đề mục.* Mọi trang cài đặt của họ mở đầu bằng `h2` 18px/600 rồi một dòng giới thiệu
   màu nhạt; trang Growth nhảy thẳng vào hàng tab. Đã thêm cho khớp.
2. *Khoảng cách giữa các khối* để 20px trong khi họ dùng 12px. Đã sửa.
3. *Tiêu đề lặp.* Tab đã ghi "Remembered facts" rồi mà thẻ bên dưới ghi lại lần nữa. Bỏ hai `h3`.

Đã quét lại toàn bộ bốn tab bằng cách đo từng phần tử so với khung chứa: **không phần tử nào còn
tràn**. Ghi thử một dòng rồi xoá đi, file vẫn đúng số ký tự và vẫn một kiểu xuống dòng.

## 2026-08-19 — Plugins thành trang riêng ở chân thanh bên, mỗi plugin có icon và mô tả

Trước: muốn bật/tắt một plugin phải vào `Settings → Plugins → tab "On/off"`, và ở đó mỗi plugin chỉ
là một dòng gồm tên rút gọn cộng một mã dài (`dsh-base:1a2b`) — không có gì nói plugin đó làm gì.

Nay: **một nút "Plugins" ở chân thanh bên, ngay trên Settings**, mở ra một trang chiếm cả cửa sổ.
Mỗi plugin là một **thẻ có icon + tên + một dòng mô tả**, xếp lưới hai cột. Tab "On/off" cũ trong
Settings **đã bỏ** — một việc thì một chỗ làm. Tab "Plugin list" chỉ-đọc của DeepSeek vẫn nguyên.

Ở `plugins/plugin-manager/`, **mức 1**, cắm vào `sidebar.footer.action`.

**Ba quyết định đáng nhớ:**

*Trang vẽ bằng một lớp phủ tự trải, không phải `Modal`.* Upstream không có router và không có slot
nào dành cho một trang. Ba vùng bố cục (`sidebar`, `conversation`, `details`) đều là slot `single`
đã có chủ — chiếm là mức 3, cấm. Cách upstream tự làm cho chính Settings là **vẽ một lớp
`position: fixed; inset: 0` ngay bên cạnh cái nút**, và panel Cordis của họ cũng vậy. Nên trang này
chép đúng khuôn đó: cùng hình dạng overlay/mask/panel, cùng ba lối đóng (nút X, bấm ra ngoài,
Escape), cùng việc đưa tiêu điểm về nút đóng khi mở. `Modal` là ứng viên còn lại và sai hình dạng:
nó là một thẻ hỏi-đáp ở giữa màn hình, không phải một mặt phẳng để duyệt.

*Mô tả lấy từ hồ sơ gói, không có bảng viết tay.* `src/pkg-meta.ts` đọc trường `description` trong
`package.json` của từng plugin, qua cây phân giải dưới `~/.dsh/profiles/node_modules`. Đọc thẳng
file thay vì `require.resolve` là cố ý — có gói không mở `./package.json` trong `exports`, và lỗi đó
trông y hệt "plugin không tồn tại". Kết quả đo được: **156/160 thẻ có mô tả riêng**.

*Icon chọn theo từ khoá trong tên gói, không liệt kê từng plugin.* Một bảng liệt kê là một danh sách
phải bảo trì; mỗi lần nâng cấp engine lại có gói mới không ai viết dòng cho nó, và tất cả rơi về
cùng một icon trống. Luật theo từ khoá cho gói mới một icon hợp lý ngay ngày nó xuất hiện. Toàn bộ
icon lấy từ bộ 70 của engine, ép về cùng cỡ 16 để glyph 14 và 20 không đứng lệch nét trong cùng lưới.

**Bộ kiểm `npm run spike:switch` cập nhật theo, và mọc thêm bốn mục** (13 → 17): mỗi thẻ có icon và
mô tả thật; Escape đóng trang, mở lại được, bấm ra ngoài cũng đóng; thu thanh bên thì nút thành icon
tròn 36px không nhãn mà rê chuột vẫn hiện tên; và Settings không còn tab "On/off" của ta.

Một bài học nhỏ nhưng tốn một vòng: mục kiểm rê chuột lên nút ở chế độ thanh bên thu **chập chờn**,
vì thao tác thu có hoạt ảnh và cú rê đầu tiên rơi vào lúc nút còn đang trượt. Nay thử lại tối đa ba
lần — một lần trượt không nói lên điều gì về việc người dùng có với tới được tooltip hay không.

## 2026-08-19 — Cài được plugin từ chợ cộng đồng, ngay trong app

Trang Plugins mọc thêm tab **Market**. Người dùng duyệt hơn **1.300 plugin** của cộng đồng, tìm
kiếm, lọc theo 12 nhóm, và **cài thẳng vào app** — trước đó app chỉ bật/tắt được 5 plugin do chính
dự án đóng gói sẵn, không thêm được cái thứ 6.

Toàn bộ nằm trong `plugins/plugin-manager/`, **mức 1**, không thêm vị trí giao diện nào: tab Market
dùng chung trang đã có.

### Bốn quyết định đáng nhớ

**Không tự viết trình cài đặt.** Engine đã có sẵn `dsh plugin --profile web add <gói>`, và nó làm
một việc mà tự viết lại sẽ hỏng dần sau mỗi lần nâng cấp: sau khi cài xong, nó đọc lại hồ sơ profile
và **tự cập nhật danh sách bundle** — mọi gói khai `dsh.bundle.patch` được thêm vào danh sách engine
nạp lúc khởi động. Ta gọi đúng lệnh đó. Hai thứ ta biết mà nó không biết đều là **sự thật về tiến
trình đang chạy**, không phải phỏng đoán: `process.execPath` chính là `node.exe` app đóng gói, và
`process.argv[1]` chính là file CLI mà engine được khởi động bằng.

**Không tin kho một chiều.** Kho nói gói đã kiểm chứng; trước khi ghi bất cứ thứ gì xuống đĩa,
`src/npm-check.ts` hỏi lại **chính npm** bốn câu, đều fail-closed: đúng phiên bản đó có tồn tại
không; gói có **chạy mã lúc cài** không (`preinstall`/`install`/`postinstall`/`prepare` → từ chối
thẳng); nó có trỏ ngược về **đúng repo mà người dùng đã nhìn thấy** không; và npm có phục vụ qua
https không. "Kho nói vậy" và "npm nói vậy" là hai lời khẳng định khác nhau, chỉ cái thứ hai nói về
những byte thật sự sẽ chạy.

**Hỏi vòng, không dựng WebSocket.** Việc cài chạy trong tiến trình engine nên nó **sống lâu hơn
trang** — đóng trang giữa chừng không huỷ gì và không mất nhật ký, mở lại là thấy tiếp. Vì vậy không
có gì cần một socket giữ mở: nửa giây một lần hỏi lại, tốn một request nội bộ. Cùng lý do đó, yêu
cầu **khởi động lại** đi bằng một request HTTP giữ mở (`/hdw/lifecycle/wait`) chứ không phải
WebSocket — plugin này hiện **không có phụ thuộc lúc chạy nào**, và giữ nguyên như vậy đáng giá hơn
việc kéo `ws` vào. Lớp vỏ **gọi ra**, không mở thêm cổng nào trên máy người dùng — đúng khuôn
`shot-link.ts` đã ghi lại lý do.

**Lối lùi khi engine không khởi động nổi.** Một plugin lạ viết cho phiên bản engine khác có thể làm
app không lên được, và đúng lúc đó trang Plugins vô dụng — vì nó nằm trong engine đang chết. Nên sau
mỗi lần cài, plugin ghi tên gói vào `~/.dsh/harness-desktop-last-install.json`; lớp vỏ **xoá tờ ghi
chú ngay khi một lần khởi động thành công**. Tờ ghi chú còn đó lúc engine chết nghĩa là chỉ có đúng
một nghi phạm, và trang lỗi mọc thêm nút **"Remove <tên> and retry"**. Không có nút đó, nước cờ cuối
cùng của người dùng là cài lại cả app.

### App tự mang theo pnpm — +19 MB

Lệnh cài của engine gọi `pnpm` từ PATH. Máy lập trình viên có; máy người cài một app desktop thì
không, và lỗi là `exit 127` kèm câu "pnpm not found on PATH" — vô nghĩa với người dùng. Nay app
đóng gói **pnpm bản JavaScript** và viết một wrapper một dòng vào `~/.dsh/tools/bin/pnpm.cmd`, rồi
chỉ thêm thư mục đó vào **PATH của tiến trình con**. Hai ranh giới cố ý:

- **Không đụng PATH của máy.** Một app sửa biến môi trường của người dùng làm đổi cách mọi chương
  trình khác tìm `pnpm`, và nó sống sót cả sau khi app bị gỡ.
- **Không ưu tiên pnpm sẵn có của người dùng.** Cùng một phiên bản ở mọi nơi nghĩa là cài chạy được
  ở đây thì chạy được ở đó; "cái pnpm nào đứng trước trên PATH" là cách một lỗi trở thành không tái
  hiện được.

Giá, đo trên bản dựng thật chứ không ước lượng: **452 file, 18,8 MB** trong thư mục app; bộ cài ra
**175,0 MB**. Đã cắt `artifacts/` (17,4 MB — đầu vào để pnpm dựng file exe độc lập của họ, ta không
dùng) khỏi bộ cài, và không dùng bản `@pnpm/win-x64` đứng một mình vì nó **93,6 MB**.

Wrapper `.cmd` là đủ vì CLI của engine gọi pnpm qua shell trên Windows. Nó sẽ **không** đủ cho một
plugin tự gọi `pnpm` bằng `spawn(shell: false)` — đáng nhớ, vì lúc đó cách sửa là một file thực thi
thật chứ không phải file batch.

### Kho lấy từ đâu

`https://deepseek1024.com/api/v1/plugins` — quét thẻ `dsh-plugin` trên GitHub. **Đây là đường ra
Internet mới của app**, chỉ tải danh mục, không gửi gì của người dùng đi. Tải nguyên khối một lần
(8,6 MB), **giữ lại chỉ mục có gói npm đã kiểm chứng** (6.096 → 1.314), cắt còn các trường thẻ cần
(~350 KB), nhớ đệm ra đĩa 24 giờ. Gõ tìm kiếm **không** gửi request nào ra ngoài — lọc tại chỗ.

Kho **không có icon riêng cho từng plugin**, nên thẻ dùng bộ 70 icon đơn sắc của engine, chọn theo
nhóm rồi mới tới từ khoá trong tên.

### Bộ kiểm

`npm run spike:switch` từ 17 lên **28 mục**, và giờ nó **cài thật một plugin rồi gỡ đi**
(`dsh-plugin-vetting` — không phụ thuộc, không script lúc cài, repo khớp). Nó cũng chạy **đúng hàm
lớp vỏ gọi khi engine chết** chứ không phải bản sao của hàm đó, và đo màu ở chế độ tối thay vì tin
là đúng: nền trang 1.00 → 0.17, nền thẻ 0.14, chữ 0.70.

Ba bài học trả giá trong lúc làm, ghi lại vì cả ba đều **không** hiện ra dưới dạng lỗi:

1. *Chụp màn hình cửa sổ chạy ẩn bắt phải khung hình cũ.* Chromium không vẽ khi không ai nhìn, nên
   ảnh chụp ngay sau khi đổi tab lại ra tab trước đó. Phải cho nó kịp vẽ.
2. *Regex trong chuỗi template mất dấu gạch chéo.* `\d` trong một template literal thành `d`, và mục
   kiểm phiên bản đỏ trong khi app đúng.
3. *Đọc DOM sau khi nó đã đổi.* Giữ tham chiếu phần tử rồi bấm tiếp rồi mới đọc — mục kiểm phân
   trang khi đó so một thứ với chính nó và luôn sai.

## 2026-08-19 — Mở app thật ra dùng, và năm lỗi chỉ chịu lộ ra ở đó

Bộ kiểm 28 mục đã xanh hết. Rồi mở app thật, cài hai plugin từ chợ
(`dsh-find-plugin`, `@anionex/dsh-turn-rewind`), khởi động lại, bật tắt, gỡ đi — **năm lỗi rơi ra**,
và không lỗi nào trong số đó bộ kiểm cũ nhìn thấy được. Ghi lại vì cái *hình dạng* của chúng lặp
lại: cả năm đều nằm ở khoảng sau khi việc cài kết thúc — chỗ mà bộ kiểm dừng, còn người dùng thì
không.

**1. Nhật ký cài hiện chữ Trung Quốc.** `TerminalBlock` của upstream có nhãn mặc định là tiếng
Trung (`已完成`, `复制`), và **mọi chỗ gọi nó bên trong upstream đều truyền nhãn đã dịch**. Ta không
truyền, nên giữa một trang tiếng Anh có hai chữ Trung. Đúng loại lỗi Luật 7 sinh ra để chặn, và
không có kiểm lỗi kiểu nào bắt được. Nay truyền `labels` tiếng Anh.

**2. Khởi động lại engine ném người dùng vào trang lỗi — tuỳ lúc.** Bấm "Restart now" thì log ghi
`engine: exited unexpectedly with code 1` chen vào giữa hai dòng khởi động bình thường. Nguyên nhân:
`stopEngine()` giết engine cũ, nhưng **Windows báo cái chết đó bất đồng bộ**, thường là sau khi
engine mới đã chạy — mà `startEngine` đã kịp đặt lại cờ `stopping = false`. Thế là cái chết của
engine cũ bị tính cho engine mới, và app bật trang "không khởi động được" **đè lên một engine đang
chạy tốt**. Nay mỗi trình xử lý gắn với đúng tiến trình sinh ra nó, và bỏ qua tin tức về một tiến
trình đã bị thay. Đo lại sau khi sửa: dòng đó biến mất.

**3. Plugin cài từ chợ không có mô tả.** `pkg-meta.ts` chỉ tìm trong cây gói của profile gốc, còn
trình quản lý gói đặt thứ nó cài vào cây gói của riêng profile `web`. Kết quả: đúng những plugin mà
cái tên nói lên ít nhất lại là những cái có thẻ trống. Nay tìm cả hai gốc.

**4. App nói sai với người dùng.** Một plugin **họ vừa tự cài từ chợ** bị xếp vào nhóm "DeepSeek
core plugins", và bấm tắt thì hiện hộp xác nhận nói rằng *"đây là một trong các plugin lõi của
DeepSeek"*. Câu đó sai. Gốc rễ: mã chỉ biết hai loại — của ta, và của DeepSeek. Nay có **ba**:
`ours` / `market` / `core`, phân loại theo danh sách phụ thuộc của profile. Ba hệ quả:

- Tab Installed có nhóm thứ ba, **"Installed from the market"**, luôn hiện kể cả khi rỗng — đó là
  chỗ người dùng sẽ đi tìm thứ họ vừa cài.
- Chỉ plugin **lõi thật** mới hỏi xác nhận khi tắt.
- Thẻ plugin từ chợ mọc thêm nút **Remove** ngay tại tab Installed. Trước đó muốn gỡ phải mò lại
  trong danh sách chợ 1.300 mục — một lối đi không ai chọn.

**5. File lựa chọn bật/tắt tích rác.** Gỡ một plugin xong, dòng bật/tắt của nó vẫn nằm lại mãi mãi.
Hai cái giá đều lặng lẽ: file phình theo tuổi đời của app, và một plugin sau này trùng `id` sẽ thừa
hưởng một trạng thái mà người dùng chưa từng chọn. Nay gỡ xong thì xoá luôn các dòng ấy — lấy id từ
**hai** nguồn: những gì loader đang gán cho gói đó, **và** những gì chính gói khai trong
`cordis.patch.yml` của nó. Chỉ nguồn thứ nhất là chưa đủ: một gói vừa cài mà chưa khởi động lại thì
chưa được nạp, và đó đúng là lúc người ta hay đổi ý.

### Bộ kiểm học được gì

28 → **31 mục**. Nhưng cái mới quan trọng nhất không phải ba mục đó, mà là **bộ kiểm giờ tự khởi
động lại engine giữa chừng**. Trước đây nó dừng ngay khi lệnh cài chạy xong — nên toàn bộ vùng "sau
khi cài, plugin thật sự được nạp" chưa từng bị soi, và đó chính là nơi ba trong năm lỗi trên nằm.

Bài học chung, đáng nhớ hơn từng lỗi riêng lẻ: **"cài xong" không phải là đích của người dùng.**
Đích của họ là *dùng được thứ vừa cài*, và giữa hai điểm ấy có một lần khởi động lại mà bộ kiểm cũ
không bước qua.

### Lỗi thứ sáu, do chủ dự án tìm ra: "cài xong rồi, sao không thấy đâu?"

Chủ dự án cài `modlens` trong app thật, chuyển sang tab Installed, và thấy
**"Installed from the market (0)"**. Câu hỏi của anh — *"nó nằm bên nào? sao tôi không thấy nó?"* —
chính là lời mô tả chuẩn xác nhất của lỗi: **anh vừa cài, mà trang lại nói là chưa có gì.**

Hai nguyên nhân chồng lên nhau, và cả hai đều phải sửa:

**a. Danh sách Installed chỉ biết những gì engine đang nạp.** Engine đọc danh sách bundle **một lần
duy nhất, lúc khởi động** — nên plugin cài trong lúc app đang chạy thì có trên đĩa và không có ở
đâu khác. Trang bỏ qua khoảng đó, và thành ra nói sai. Nay `/hdw/plugins/list` trả thêm danh sách
**đã cài nhưng chưa nạp** (hiệu của "profile phụ thuộc gì" trừ đi "cây plugin đang có gì"), và tab
Installed vẽ chúng thành thẻ riêng: nhãn **"not loaded yet"**, không có công tắc (không có gì đang
chạy để mà tắt), **vẫn gỡ được** — vì đổi ý trước khi khởi động lại là chuyện bình thường — kèm một
dòng thông báo *"N plugins are installed but not loaded yet. Restart the app to finish."* và nút
**Restart now** ngay đó.

**b. Tab bị ẩn vẫn cầm dữ liệu cũ.** Tab Installed **cố ý** không bị gỡ khỏi trang khi chuyển sang
Market — để ô tìm kiếm của anh không mất. Nhưng nó cũng vì thế mà giữ nguyên danh sách đọc từ lúc
mở, nên cài ở tab Market xong quay lại thì vẫn là ảnh chụp cũ. Nay nó đọc lại mỗi lần được đưa ra
màn hình.

Mục kiểm **21c** khoá đúng tình huống này lại: cài xong, **chưa** khởi động lại, chuyển sang tab
Installed — phải thấy thẻ, thấy nhãn "not loaded yet", thấy nút gỡ, và thấy lời mời khởi động lại.
Bộ kiểm: 31 → **32 mục**.

Đây là lần thứ hai trong cùng một ngày cùng một khoảng trống sinh ra lỗi: **giữa "lệnh cài chạy
xong" và "plugin thật sự dùng được" có một lần khởi động lại**, và mọi thứ nằm trong khoảng đó đều
từng bị bỏ sót.

## 2026-08-21 — Đo trước khi dựng: trang ngoài phiên có bấm nút chạy skill được không

Plugin sắp làm (`seo-pipeline`, dây chuyền nội dung SEO cho thị trường Philippines) đứng trên một
giả định phải kiểm trước khi viết một dòng giao diện nào.

Chủ dự án chọn dựng dashboard thành **trang riêng toàn cửa sổ** mở từ chân thanh bên, đúng khuôn
trang Plugins. Hệ quả kỹ thuật: trang đó nằm **ngoài phạm vi phiên**. Mọi thành phần trong phiên
được engine trao sẵn `inputActions` để đặt chữ vào ô nhập rồi gửi; trang ngoài phiên thì không —
`sidebar.footer.action` chỉ nhận đúng một cờ `wide`.

Nếu không có đường thay thế thì **mọi nút trên trang là nút chết**, và cả thiết kế phải đổi. Đó
đúng loại hỏng im lặng mà bộ luật dự án sinh ra để chống, nên nó bị đóng lại bằng một phép thử chứ
không bằng việc đọc code cho kỹ.

**Đường thay thế có thật, và không phải đồ tự chế.** Upstream cho plugin lấy agent theo id
(`ctx.agents.get(id)`) rồi gọi `followup(message)` — "xếp một tin nhắn lượt kế tiếp và đánh thức bộ
chạy". Phiên do app web mở cũng do `ctx.agents` giữ (`packages/api/remotes/src/agent-lookup.ts`
tái dùng agent đang sống trước khi nghĩ tới việc resume), nên id lấy từ phía client dùng được ngay.

Còn một cái lợi ngoài dự tính: phía client có `ctx.workspaces.startSession()` — chính hàm nút "New
session" của thanh bên gọi. Nên **nút mở được một chat mới cho từng công đoạn**, và vì app tự tạo
chat theo cách của nó nên model, thư mục làm việc và mức quyền đều đúng, không phải đoán. Việc này
giải luôn nỗi lo phình ngữ cảnh: mỗi công đoạn một chat, không chat nào cõng lịch sử chat trước.

Bộ kiểm: `npm run spike:seo` (`scripts/spike-seo-agent.mjs` + plugin gieo `scripts/spike-seo-probe.mjs`),
**8/8 mục đạt**. Nó đo bằng dấu vết chứ không bằng lời văn — mục nặng nhất đọc lại nhật ký sự kiện
của phiên để xác nhận tin nhắn thật sự rơi vào đó, thay vì tin rằng lời gọi không ném lỗi là xong.

Một lỗi bắt được ngay trong lúc dựng chính bộ kiểm: bản đầu đọc model từ `provider.models` và nhận
mảng rỗng, nên bài kiểm **bỏ qua đúng phần lõi mà vẫn in ra màu xanh**. Model phải hỏi riêng bằng
`ctx.llm.listModels(id)`. Bài học cũ lặp lại ở một chỗ mới: một mục kiểm bỏ qua trông giống hệt một
mục kiểm đạt, nếu không ai đọc kỹ dòng SKIP.

### Khung plugin `seo-pipeline` dựng xong

`plugins/seo-pipeline/` — nút **SEO** ở chân thanh bên, mở một lớp phủ toàn cửa sổ. **Mức 1, chỉ
cộng thêm**: một đăng ký vào `sidebar.footer.action`, cùng cột với nút Plugins và nút Settings của
upstream, `order` 30 nên nằm dưới cả hai. Hình dạng lớp phủ, ba đường đóng (nút header, bấm nền mờ,
phím Escape) và việc đưa tiêu điểm về nút đóng đều sao theo trang Plugins, vốn sao theo Settings của
upstream.

Lớp `--patch` thứ sáu trong `src/main/engine.ts`, chèn **trước** lớp lưu lựa chọn người dùng — lớp
đó vẫn phải đứng cuối, nếu không thì plugin mới không tắt được mà chẳng có lỗi nào báo.

Bản sao **thứ ba** của rào tin cậy trình duyệt (`src/trust.ts`), sau `dock` và `plugin-manager`.
Logic ba bản y hệt nhau, chỉ khác chú thích. Không gộp được: plugin phân giải module từ thư mục của
chính nó và không import chéo nhau được. **Sau mỗi lần nâng cấp engine phải so lại cả ba** với bản
gốc của upstream — một cái rào lệch khỏi bản gốc còn tệ hơn không có rào, vì nó vẫn trông như một
cái rào.

Route `/hdw/seo/health` tồn tại để làm **dấu vết**, không phải để trang trí: một plugin có nửa Node
nạp hỏng trông y hệt một plugin chạy tốt, trang chỉ đơn giản là không bao giờ điền dữ liệu vào.

Bộ kiểm `npm run spike:seo` lên **10 mục**, thêm hai mục cho chính khung này: nửa Node đã nạp (route
sống), và nửa giao diện được phục vụ đúng dạng bundle qua **tên gói** — chỗ hỏng im lặng kinh điển
khi junction đặt sai hoặc `exports` thiếu.

### Lỗi chủ dự án tìm ra ngay khi mở app: nút SEO là một mẩu tròn cụt ở mép

Bộ kiểm `spike:seo` **xanh toàn bộ 10/10** trong khi nút SEO trên màn hình thật là một hình tròn bị
cắt, không nhãn, dí sát mép phải thanh bên. Lần thứ ba trong dự án cùng một khoảng trống sinh ra
lỗi: **"engine phục vụ đúng file" và "người dùng thấy đúng thứ" là hai câu khác nhau**, và khoảng
giữa chúng là bố cục — thứ chỉ tồn tại khi có trang thật mở ra và CSS thật chạy.

**Nguyên nhân.** `sidebar.footer.action` là slot `list`, và khung chứa nó (`.footerActions` trong
`SidebarRoot.module.css` của upstream) là **hàng ngang `display: flex` không xuống dòng**. Nút
Plugins lấy `width: calc(100% + 8px)` — đúng khi nó ở đó một mình, sai ngay khi có nút thứ hai: nút
mới bị đẩy khỏi mép và cắt cụt. CSS của upstream không phải của ta để mà thêm `flex-wrap`.

**Cách sửa.** Hai nút **chia nhau một hàng** thay vì tranh nhau: `flex: 1 1 0` chia đều,
`min-width: 0` cho nhãn co lại bằng dấu ba chấm thay vì ép tràn. Đổi ở cả `plugin-manager` lẫn
`seo-pipeline`. Chân thanh bên nay là `[Plugins] [SEO]` trên một hàng, `Settings` ở dưới.

**Bộ kiểm mới: `npm run spike:seo-ui`** (`scripts/spike-seo-ui.cjs`, 11 mục) — mở BrowserWindow
thật trỏ vào engine thật, đóng hộp thoại chào mừng, rồi **đo hình học** của hai nút và bấm thật vào
nút SEO. Theo đúng phương pháp `spike-dock-ui.cjs` đã đặt ra. Nó cũng **chụp ảnh** chân thanh bên ra
`tmp/seo-sidebar.png` — số đo bắt được lỗi bố cục, nhưng chỉ có mắt mới bắt được nhãn xấu, icon lệch
tông, hai nút chật chội.

Hai bài học nhỏ trả giá trong lúc dựng chính bộ kiểm đó:

- **Bản đầu so với `parentElement` và in ra "mép cha 0".** Slot bọc phần tử trong những div không có
  hộp, nên phép so vô nghĩa — nó bắt trúng lỗi vì lý do sai, tức là lần sau sẽ bắt trượt. Nay đi
  ngược lên tới tổ tiên đầu tiên có bề rộng thật.
- **Chụp ảnh ngay sau khi bấm Escape ra một tấm xám mờ**, vì tấm nền còn đang tan. Ảnh vẫn "chụp
  được" nhưng vô dụng đúng ở việc nó sinh ra để làm.

### Kho dữ liệu và máy trạng thái năm công đoạn

`plugins/seo-pipeline/src/` — `paths.ts`, `store.ts`, `artifacts.ts`, `knowledge.ts`, `stage.ts`.
Đây là chỗ đặt luật của cả plugin, và luật nằm trong mã chứ không nằm trong prompt: dây chuyền chạy
bằng DeepSeek và MiniMax, mà model rẻ không tuân thủ một danh sách luật dài, mỗi model lại hỏng ở
chỗ khác nhau. Một câu từ chối chỉ đúng dòng sai thì model nào cũng sửa được mà không phải thuộc gì.

**Trạng thái đọc từ đĩa, không ghi nhớ.** Một công đoạn xong khi file nó sinh ra có mặt. Không chỗ
nào ghi "brand research: done", vì hai bản ghi cùng một sự thật rồi sẽ lệch nhau — và bản được ghi
nhớ luôn là bản nói dối, vẫn báo xong cho một file người dùng đã xoá tay. Đây cũng là thứ làm phiên
chat thành đồ dùng xong bỏ: phiên mới hỏi một câu là biết cả tình hình, nên mỗi công đoạn chạy được
trong một chat riêng mà không cõng lịch sử chat trước.

Thứ duy nhất đĩa không suy ra được là **cổng duyệt** — có người nhìn bản đồ chủ đề và gật hay chưa.
Đó là phán đoán của con người, nên nó nằm trong `_index.json`.

**Kho kiến thức chia hai vùng bằng một ranh giới cứng**: vùng nghiên cứu plugin ghi đè thoải mái,
vùng ghi chú của người dùng **plugin không bao giờ chạm tới**. Không có ranh giới đó thì lần làm mới
tự động đầu tiên xoá sạch kinh nghiệm chủ dự án gõ vào — và xoá trong im lặng, chỉ phát hiện ra rất
lâu sau, nếu có.

Bộ kiểm `npm run spike:seo-store` — **24 mục**, không cần engine. Nó đi được cả những nhánh app thật
khó dựng lại: model gửi câu thiếu nguồn, model nhảy cóc công đoạn, đường dẫn cố thoát khỏi
workspace, hai lượt ghi chỉ mục cùng lúc.

**Lại một mục đạt vì lý do sai, bắt được ngay trong ngày.** Mục "thiếu đối thủ và từ khoá thì bản đồ
chưa xong" đo SAU khi file bản đồ đã tồn tại, nên nó xanh nhờ file có mặt chứ không nhờ luật thứ tự
— tức là nó sẽ vẫn xanh kể cả khi luật thứ tự hỏng hẳn. Đã tách làm hai mục, đo trước và đo sau.
Cùng bài học với `spike:seo` sáng nay: **một mục kiểm đạt vì lý do sai còn nguy hơn một mục kiểm
đỏ.**

### Chín tool, và cái guard đóng cửa sau

`plugins/seo-pipeline/src/tools.ts` + `guard.ts` + `geo.ts` + `keywords-csv.ts`.

**Hai luật được làm thành cấu trúc chứ không phải phép kiểm.** `seo_fact_write` nhận mỗi sự thật
dưới dạng `{ text, confidence, source }` rồi tự dựng dòng biên lai — model **không có chỗ nào để đặt
một sự thật không nguồn**. Mạnh hơn hẳn việc soi văn bản sau khi đã viết. Tương tự, `seo_keywords_import`
đọc CSV xuất từ Ahrefs: ô trống thành `not stated`, không bao giờ thành một con số bịa.

**Cửa sau — do chủ dự án hỏi mà lòi ra.** Mọi hàng rào ở trên chỉ ràng buộc model nào chịu đi qua
tool của ta. App còn có tool sửa file dùng chung, và model hoàn toàn có thể ghi thẳng `brand.md` bằng
nó. Cả 34 mục kiểm vẫn xanh, file bịa vẫn nằm đó. Model rẻ không đi cửa sau vì ác ý — nó đi sau khi
cửa trước từ chối hai lần, mà chính bộ luật này tạo ra tình huống đó.

`ctx.tools.guard()` đóng lại: chạy trước mọi lần gọi tool, trả về một câu là chặn. Nó **chỉ chặn
được, không cho phép được**, nên không plugin nào đăng ký sau gỡ được lệnh chặn. Câu chặn nêu đích
danh tool cần dùng — model bị nói "không" thì thử biến thể khác, model được chỉ cửa thì đi qua cửa đó.

**Một phát hiện về môi trường:** bundle web của upstream TẮT `tool-fs`, `tool-fs-search`,
`tool-str-replace-editor`, `tool-bash`, `tool-pwsh` ở tầng chung — chúng nằm sau agent preset. Nên
trong spike agent trần chúng không tồn tại, còn trong app thật với preset thì có. Guard đăng ký ở
context chung nên phủ cả hai.

**Ba lần liên tiếp cùng một bệnh trong một ngày, lần này nặng nhất.** Mục kiểm "cửa sau bị chặn" báo
ĐỎ trong khi guard đã chạy đúng ngay từ đầu — vì engine **không ném ngoại lệ** khi guard chặn, nó
trả về một kết quả mang cờ `isError`, mà bài kiểm chỉ bắt ngoại lệ. Suýt nữa thì đi sửa một thứ
không hỏng. Cùng lượt đó còn hai tên tôi đoán sai: `ctx.tools.list()` không tồn tại (phải là
`schemas()`), và mục kiểm "file thường không bị chặn oan" đạt nhờ tool không tồn tại chứ không nhờ
guard thả.

Bài học gộp lại một câu: **khi một mục kiểm đỏ, nghi bài kiểm trước, nghi mã sau.**

Bộ kiểm: `spike:seo` 10 → **13 mục** (thêm: chín tool đã đăng ký, cửa sau bị chặn, đường thường không
bị chặn oan). `spike:seo-store` 24 → **34 mục** (thêm bảy mục guard và ba mục đọc CSV).

### Trang SEO chạy được: chọn workspace, thêm domain, bảng công đoạn, nút giao việc

Trang giờ làm thật: chọn workspace trong danh sách engine đã biết, thêm domain bằng form, xem bảng
năm công đoạn của từng site với nút sáng tắt theo thứ tự, và bấm một nút là app **mở một chat mới**
rồi giao việc vào đó.

**Nút giao việc đi bằng đường của chính app.** Trang gọi `ctx.workspaces.connectWorkspace()` — đúng
hàm nút "New Session" ở thanh bên gọi — nên model, thư mục làm việc và mức quyền là thứ app tự chọn,
không phải thứ ta đoán. Rồi route `/hdw/seo/run` giao đúng một dòng vào chat đó bằng
`agent.followup`. Mỗi công đoạn một chat, không chat nào cõng lịch sử chat trước.

**Cổng duyệt bản đồ hiện nội dung, không chỉ hiện đường dẫn.** Route `/hdw/seo/map` trả về bản đồ
dạng chữ, hộp thoại dựng bằng `MarkdownText` của upstream. Một cái cổng chỉ đưa đường dẫn để mở nơi
khác là cái cổng người ta bấm qua cho xong.

Bộ kiểm `spike:seo-ui` 11 → **21 mục**: bộ chọn workspace, kho thị trường báo thiếu, mở form, **thiếu
URL chính chủ bị từ chối ngay trên màn hình**, thêm domain hợp lệ, thứ tự khoá đúng, thanh độ tin
cậy, bấm nút chạy thì trang đóng và việc sang chat.

**Một lỗi thật, bắt được vì hai đường đi lệch nhau.** Thêm domain từ TRANG chỉ ghi vào chỉ mục, còn
thêm bằng TOOL thì ghi thêm `site.md` — nên site thêm từ trang bị báo "Site setup chưa xong" và mọi
công đoạn sau khoá cứng, không có lối ra. Nay cả hai gọi chung một hàm `registerSite`. Bài học: **hai
đường vào cùng một trạng thái thì phải đi qua cùng một hàm**, nếu không chúng sẽ lệch, và lệch âm
thầm.

**Bốn lần liên tiếp phép đo sai chứ không phải mã sai.** Lần này nặng nhất: mục kiểm chờ một chuỗi
chữ trong `document.body` và **thua cuộc đua với lần tải đầu**, báo đỏ trong khi trang hoàn toàn
đúng. Tôi đã kịp thêm một vòng thử lại để "sửa" — rồi số liệu cứng cho thấy giả thiết sai và tôi gỡ
nó ra. Suýt nữa để lại một đoạn mã thừa vá cho một lỗi không tồn tại.

Nhưng cuộc đua đó lộ ra **một lỗi thật của trang**: lúc chưa tải xong, nó nói *"No workspace yet"* —
một câu sai. Nay có trạng thái "đang đọc" riêng: `null` là chưa biết, `[]` mới là không có.

**Hai lỗi chỉ MẮT bắt được, số đo mù hoàn toàn.** Ảnh chụp cho thấy "Needs first: PH market research"
**dính liền** vào "Not browsing from the Philippines" thành một dòng chạy liền, và nhãn nút
"Research PH market" bị bẻ đôi dòng. DOM đúng, nội dung đúng, 21/21 xanh. Đây chính là lý do bộ kiểm
phải chụp ảnh chứ không chỉ đếm.

Và một bẫy của chính việc chụp: cửa sổ probe chạy ẩn nên Chromium **giữ lại khung hình cũ** — lần
chụp đầu ra một trang chưa có site trong khi số đo ngay trước đó đã đọc đủ các hàng. Phải chụp hai
lần, bỏ lần đầu.

### "country unknown" — chủ dự án bắt được ngay lần mở app đầu

Trên máy chủ dự án, dải trên cùng của trang SEO hiện **"country unknown"** màu cam.

**Nguyên nhân đo được, không phải đoán:** dịch vụ tra IP tôi chọn (`ipapi.co`) trả về **HTTP 429 —
hết hạn mức miễn phí**. Ba dịch vụ khác gọi từ đúng runtime của engine đều chạy và đều báo `VN`.

**Nhưng lỗi nặng hơn nằm ở thiết kế của tôi.** Trang coi *"không tra được"* và *"đang ở nước khác"*
là một: `geoBlocked = !inPh`. Nên một bên thứ ba hết hạn mức **khoá luôn nút Brand research**, và
người dùng không có cách nào biết vì sao hay đi tiếp. Một dịch vụ miễn phí ngoài tầm kiểm soát không
bao giờ được phép chặn cả dây chuyền.

Hai chỗ sửa:

- **Bốn dịch vụ nối tiếp** (`api.country.is` → `ifconfig.co` → `ipinfo.io` → `ipapi.co`), lấy cái đầu
  tiên trả về mã hai chữ cái. Cái đang hỏng bị đẩy xuống cuối chứ không bỏ hẳn — nó sẽ hồi hạn mức.
- **Thêm cờ `blocked` tách bạch với `!inPh`**: chỉ bật khi BIẾT CHẮC đang ở nước khác. Không tra được
  thì không chặn gì cả, và dòng chữ chuyển sang màu thường kèm *"not blocking"* — màu cam là tin xấu,
  không phải là thiếu thông tin. Tô cam một thứ người dùng không sửa được chỉ khiến họ đi tìm một cái
  lỗi không phải của họ.

Bộ kiểm `spike:seo` 13 → **15 mục**: tra được nước qua chuỗi dự phòng, và không tra được thì không
chặn.

### Gỡ bỏ hẳn phần kiểm tra IP

Chủ dự án hỏi *"tra IP làm gì? đâu có cần đâu nhỉ?"* — và câu hỏi đó đúng.

Phần này là **tôi đề xuất, không phải chủ dự án yêu cầu**. Lý do ban đầu có thật: nhiều nhà cái
Philippines phục vụ nội dung khác nhau tuỳ IP, nên nghiên cứu từ Việt Nam có thể ra một `brand.md`
mạch lạc mà không phải thứ người Philippines thấy. Nhưng lập luận đó yếu ở ba chỗ:

- **Nó đoán, không đo.** IP ở PH không chứng minh nhà cái đã phục vụ nội dung PH, và ngược lại.
- **Nó gọi ra bên thứ ba từ máy người dùng** mỗi lần mở trang — một phụ thuộc bên ngoài mà dây
  chuyền không cần để chạy.
- **Nó đã gây hại thật:** dịch vụ hết hạn mức → trang khoá luôn nút Brand research.

Đã gỡ: `geo.ts`, tool `seo_geo_check` (9 → **8 tool**), route `/hdw/seo/geo`, dòng chữ trên dải
workspace, và cả ba prop cổng geo trong bảng công đoạn. Bộ kiểm `spike:seo` về **13 mục**.

Cách giải đúng vấn đề gốc để dành cho skill nghiên cứu brand: mở trang nhà cái rồi **tự nhìn** đơn vị
tiền tệ, phương thức nạp rút, ngôn ngữ — đo thứ thật sự quan trọng thay vì đoán qua IP.

Bài học chung, đáng nhớ hơn cả đoạn mã vừa gỡ: **một tính năng do tôi tự nghĩ ra, người dùng chỉ gật
trong một menu tôi đưa, là tính năng cần bị hỏi lại.** Nó đã kịp gây một lỗi trước khi ai kịp dùng nó
một lần.

### Skill đầu tiên: `seo-brand-research`

Dựng theo `casino-brand-playbook` của kho `SEO IE VN` — bản đó 387 dòng skill cộng 1.100 dòng
reference, chạy cho thị trường Việt Nam trong Claude Code. Bản này chạy cho Philippines, trong app,
trên model rẻ.

**Skill nằm trong plugin, không chép vào `~/.dsh/skills`.** Đăng ký qua `ctx.skills.registerProvider`,
nên tắt plugin là skill biến mất theo; bật lại thì có. Chép file ra ngoài thì tắt plugin xong skill
vẫn nằm trong bảng lệnh, trỏ vào những tool không còn tồn tại — và không có lỗi nào báo.

**Chia hai tầng để tiết kiệm ngữ cảnh.** `SKILL.md` là cách làm; `references/browser-recipes.md` là
lệnh gọi cụ thể, chỉ đọc khi tới lúc cần. Engine trao cho model đường dẫn thư mục gốc của skill
(`resourceBase`), model tự mở file reference. Nhét cả hai vào một file thì mỗi lượt nghiên cứu brand
phải cõng thêm 200 dòng công thức mà phần lớn lượt không dùng tới.

**Điểm khác lớn nhất so với bản gốc: skill không còn là nơi giữ luật.** Bản `SEO IE VN` viết *"bạn
là tầng lưu trữ — mọi artifact ghi bằng `Write`/`Edit`"*, và mọi kỷ luật về nguồn nằm trong lời văn.
Bản này ghi qua `seo_fact_write` và `seo_artifact_write`; ghi tay vào `brand.md` bị guard chặn và
trả về đúng tên tool phải dùng. Skill làm chất lượng tốt lên, tool giữ chất lượng không tụt xuống
dưới đáy — và chỉ tầng dưới mới còn nguyên khi model đọc lướt.

**Đã sửa lại theo đúng tool của app này**, không bê nguyên tên tool của Claude Code. Bốn chỗ khác
nhau và cả bốn đều hỏng im lặng nếu bê nguyên: `duration` tính bằng **mili-giây**; `url_pattern` là
**regex** chứ không phải glob `*api*`; **không có** cách lấy body theo `requestId` (chỉ giữ 5 body
gần nhất, 8 KB mỗi cái, và chỉ của `fetch()`); **không có** zoom ảnh chụp. Đường đáng tin để lấy JSON
của site là tự gọi `fetch()` trong trang bằng `browser_javascript`.

**Phần kiểm tra IP đã gỡ được thay bằng thứ đo được thật:** skill mở trang nhà cái rồi tự nhìn đơn vị
tiền tệ (PHP/₱), phương thức nạp rút (GCash, Maya, InstaPay), và ngôn ngữ (English/Taglish). Thấy
VND với danh sách ngân hàng Việt Nam thì dừng lại hỏi, chứ không lặng lẽ nghiên cứu nhầm thị trường.

**Chữ trong artifact là tiếng Anh** — khác bản gốc viết tiếng Việt. Thị trường Philippines dùng tiếng
Anh, giao diện app tiếng Anh, và Luật 7 của dự án cũng vậy. Chuỗi tiếng Tagalog/Taglish trên site thì
giữ **nguyên văn**, vì chính nó là từ khoá.

Bộ kiểm mở rộng, **13 → 18 mục** cho `spike:seo` và **21 → 23 mục** cho `spike:seo-ui`:

- Engine có nhìn thấy skill không, thân có nạp được không, front-matter đã cắt chưa.
- `resourceBase` có trỏ tới thư mục có thật, có kèm file reference không. Sai đường dẫn ở đây không
  sinh lỗi nào: model đọc chỉ dẫn "mở `references/browser-recipes.md`", mở không được, rồi tự xoay
  xở bằng trí nhớ — đúng kiểu hỏng mà không ai thấy.
- Mọi tên tool skill nhắc tới có tồn tại thật không: `seo_*` đối chiếu registry, `browser_*` đối
  chiếu mã nguồn của plugin dock.
- **Và trong app thật**: gõ `/seo-` vào ô nhập thì skill có hiện trong bảng lệnh không, kèm một ảnh
  chụp để mắt xác nhận. Engine thấy skill mà `userInvocable` sai thì hai phép đo đó tách đôi — engine
  xanh, bảng lệnh trống trơn, không lỗi nào báo.

Một chi tiết bắt được nhờ nhìn ảnh chứ không nhờ số đo: engine nhồi **danh mục skill vào ngữ cảnh
mỗi lượt**, và nó cắt mô tả ở **500 ký tự**. Mô tả đầu tiên của tôi dài 578 — phần bị cắt đúng là câu
"RESEARCH ONLY", tức là phần quan trọng nhất cho việc định tuyến. Đã rút còn 435.

Lại một lần nữa: hai mục kiểm đỏ, và cả hai lần lỗi nằm ở **mục kiểm**, không ở mã. Lần này là một
ký tự backspace lọt vào biểu thức tìm kiếm, khiến nó không khớp gì hết và báo "skill không nhắc tới
tool nào".


### Nâng `brand.md` lên đúng chuẩn bản mẫu `SEO IE VN/brands/alo789`

Chủ dự án chỉ vào bộ mẫu và yêu cầu kết quả cuối phải kỹ như vậy. Đối chiếu thì bản của ta thiếu bốn
thứ, và cả bốn đều là thiếu ở **công cụ**, không phải ở skill:

| Bản mẫu có | Ta có trước đó |
|---|---|
| `brand.md` **mười hai mục đánh số cố định** | một danh sách gạch đầu dòng phẳng |
| **Bảng** cho sảnh game, nhà cung cấp, khuyến mãi, thanh toán, kiểm kê nội dung | chỉ có bullet |
| Front-matter mang số độ phủ: `routes_scanned`, `surfaces_scanned`, `fact_count`, `high_confidence_pct`… | `{brand, updated_at}` |
| `playbook.md` — trang một mặt: tóm tắt, độ phủ, độ tươi, việc chưa giải quyết, bàn giao | không có |

**Vì sao mười hai mục phải do công cụ viết, không phải model.** Công đoạn viết bài về sau gọi thẳng
"§6 khuyến mãi, §7 thanh toán". Một model được bảo "dựng lại mười hai tiêu đề" sẽ dựng đủ mười một
cái, hoặc đảo hai cái, ở một số lượt chứ không phải mọi lượt — và **không có gì báo**: file vẫn đẹp,
chỉ là mọi tham chiếu về sau trỏ nhầm chỗ. Nên model không viết tiêu đề nữa: nó **gọi tên mục**, công
cụ đặt dữ kiện vào đúng chỗ. `brand-file.ts` mới giữ việc đó.

**Bảng cũng phải mang nguồn, chỉ là ở hình dạng khác.** `seo_fact_write` nhận thêm `table`, và **từ
chối bảng không khai cột `source`**, từ chối cả hàng có ô `source` trống. Cùng một luật với biên lai
của bullet — một tuyên bố tới cùng bằng chứng, hoặc không tới.

**§12 và mười một mục kia là hai chiều ngược nhau, và trộn chúng là cách một phỏng đoán được rửa
thành dữ kiện.** Nên tool chặn **cả hai chiều**: một `fact` có nguồn không được nằm ở §12 (nó thuộc
về mục nó nói tới), và một `note` không nguồn không được nằm ở §1–§11 dưới bất kỳ cách diễn đạt nào.

**Một chỗ ta làm chặt hơn bản mẫu.** Bản mẫu để model tự ghi `fact_count: 118` và
`high_confidence_pct: 86` vào front-matter. Bản này **đếm từ chính file** — một model vừa viết mười
một dòng là thứ cuối cùng nên hỏi nó đã viết bao nhiêu dòng. Model khai đè cũng không được; mục kiểm
40 đo đúng điều đó.

Thêm loại artifact `playbook`, và guard bảo vệ luôn `playbook.md`.

Bộ kiểm `spike:seo-store` **34 → 40 mục**. Mục 37 đỏ, và lần này là **lỗi thật, không phải lỗi bộ
kiểm**: mục rỗng được ghi kèm dòng `_Not researched yet._`, và lượt đọc lại giữ luôn dòng đó — nên
dữ kiện đầu tiên ghi vào một mục sẽ nằm **ngay dưới** một dòng nói rằng chưa ai nghiên cứu mục này.
File tự mâu thuẫn với chính nó mà không có lỗi nào báo. Đã sửa: dòng đó sinh lúc ghi, cắt lúc đọc.

### Chạy thật trên site Philippines: 14/14

`npm run spike:seo-run` — app Electron thật, engine thật, model thật (MiniMax M3), site thật
(`arionplay.com`), IP Philippines thật. Bộ kiểm mới, **14 mục, đạt cả 14**.

Model nạp skill qua tool `skill`, gọi `seo_stage_read` trước, đọc năm file `_knowledge/`, mở đúng
`references/browser-recipes.md`, đóng bộ route, dừng ở GATE A hỏi phạm vi quét, rồi quét. Để lại
**17 file bằng chứng** và một `brand.md` **41 dòng, 41/41 mang biên lai nguồn**.

Ba điều lượt chạy này chứng minh, mà không bộ kiểm tĩnh nào chứng minh nổi:

- **Tool từ chối, model tự sửa.** Model ghi bản kiểm kê thiếu nguồn → tool trả lỗi → model viết lại
  kèm biên lai → qua. Nếu luật đó chỉ nằm trong lời văn của skill, file đã ra đời với những dòng
  không nguồn và không ai biết.
- **Bị chặn thì không bịa.** Ở lượt trước đó, IP còn là Việt Nam, `arionplay.com` trả về trang
  "Access Restricted" có logo, có huy hiệu PAGCOR, có dòng 21+ — thừa nguyên liệu để viết một
  `brand.md` mạch lạc và sai hoàn toàn. Model tự mở `ifconfig.co`, xác nhận IP là Bến Tre/Viettel,
  **dừng lại hỏi người dùng**, và **không ghi một dòng nào**.
- **Kỷ luật nguồn giữ được ở chỗ khó nhất.** Trang FAQ của chính nhà cái ghi *"Our license number is
  `[LICENSE-NUMBER]`"* — placeholder chưa thay. Model ghi `medium`, phrase là *claim*, và thêm một
  dòng `low` riêng nói rõ chưa mở register của PAGCOR.

**Bốn lỗi trong lượt này, cả bốn nằm ở BỘ KIỂM chứ không ở app.** Cửa sổ probe thiếu `webviewTag`
nên trình duyệt của agent hỏng (app thật có bật; probe thì quên — nay probe gọi chính
`guardWebviews` trong `dist/`). Đếm phiên bằng `sessions.values()` trong khi engine dùng `list()`.
Mục "model có dừng lại hỏi không" dò chuỗi chữ trong lời model nói, mà phần trích chữ của probe trả
rỗng — nay đo bằng lời gọi `ask_user_question`. Và bộ chọn tự trả lời cổng duyệt chỉ dò
`role="radio"`/`li`/`label` trong khi các dòng phương án là `div` thường, nên lượt chạy đứng chín
phút ở GATE A **mà log vẫn sạch bong** — vì nó chỉ in khi trả lời được. Nay in cả khi trượt.

Thêm một lỗi của riêng tôi, đáng ghi vì nó xoá sạch bằng chứng: chạy nền với `| tail -80` thì chỉ
phần đuôi được giữ, và phần đuôi toàn tiếng ồn của Electron — mất trắng mọi dòng PASS/FAIL. Ghi
thẳng ra file bằng `>` thì không.

**Quyết định của chủ dự án: cho agent bấm cổng tuổi.** Mọi site casino PH mở đầu bằng một modal
Responsible Gaming che toàn trang, chỉ có `Exit` và `I AGREE ALL`. Không bấm thì skill dừng ở trang
chủ mọi lần. Quyền này được khoanh hẹp trong skill: **đúng một modal, đúng một cú bấm, và phải ghi
lại** vào file bằng chứng — nhãn nút, nội dung modal, ngày. Vẫn cấm tuyệt đối: tạo tài khoản, đăng
nhập, mọi xác nhận thứ hai trong luồng nạp/rút/KYC, opt-in marketing, cookie không thiết yếu. Và nếu
cổng bắt **gõ** ngày sinh hay tên thì đó không còn là một cú bấm — skill dừng, nhờ người tự qua.

### Đào ra nguyên nhân thật: model chưa hỏng lần nào, là bộ kiểm cắt sớm

Sáu lượt chạy thật, hai lượt ra `brand.md`, bốn lượt "hỏng". Tôi đã hai lần đề xuất **sửa kiến
trúc** — tách công đoạn brand research làm đôi — để chữa cái tỉ lệ đó.

Chủ dự án bắt đào nguyên nhân thay vì né. Đếm sự kiện `llm/retry` có payload `failure` trên cả sáu
lượt:

```
run-log2 0 · run-m3 0 · run-m3b 0 · run-m3c 0 · run-m3d 0 · run-final 0
```

**Không một lượt nào model hỏng.** Mọi lượt "thất bại" đều là lượt tôi cắt ngang.

| Lượt | Lời gọi tool | Kết quả |
|---|---|---|
| m3b | 178 | 13/18 — tôi cắt |
| m3 | 195 | 13/18 — tôi cắt |
| m3d | 205 | 13/18 — tôi cắt |
| log2 | 250 | 13/18 — hết trần 18 phút |
| m3c | 285 | 15/18 — tôi cắt ở dòng `brand.md` đầu tiên |
| **final** | **339** | **18/18** |

Quan hệ đơn điệu, không có ngưỡng gãy: **càng nhiều lời gọi càng đầy đủ.** Phân bố của lượt thành
công giải thích vì sao — quét hết 238 lời gọi, **riêng phần ghi cần thêm 47** (27 `seo_fact_write`
+ 20 `seo_artifact_write`). Mọi lượt cắt ở 178-285 đều đã tiêu hết vào quét và **chưa bắt đầu ghi**.
Model không hết sức; nó chưa tới lượt.

Ba nhát cắt, cả ba của tôi: trần 18 phút (site này cần ~35 phút) · bộ dò đứng máy 30 giây rồi 2 phút
(giết lượt khoẻ mạnh giữa lúc model suy luận) · dừng khi thấy `brand.md` (dừng ở lời gọi **thứ 1
trong 27**).

**Đề xuất tách đôi công đoạn đã rút lại** — nó chữa một bệnh không tồn tại.

Bài học, và nó đắt: **một phép đo bị cắt ngang không phải là một kết quả.** Tôi đọc mấy mục đỏ như
lời khai của sản phẩm, trong khi chúng là lời khai của cái đồng hồ bấm giờ tôi tự đặt. Bốn lần liên
tiếp. Dấu hiệu đáng ra phải nhận ra sớm hơn nhiều: **tôi sửa bộ kiểm nhiều hơn sửa skill.**

Còn một cái bẫy y hệt nằm chờ, đã sửa: điều kiện bỏ cuộc cuối cùng hỏi `types.includes('llm/retry')`,
mà `types` gom **mọi loại sự kiện đã từng xảy ra** — nên hỏi nó là hỏi "đã từng có lần nào chưa".
Một retry thoáng qua ở bước 3 làm điều kiện đó đúng vĩnh viễn. Nay chỉ bỏ cuộc khi có retry **mới kể
từ lần tiến lên gần nhất**.

### Lỗi thật duy nhất của buổi: `web_fetch` không tồn tại

```
Error: unknown tool "web_fetch"
```

Skill bảo model dùng `web_fetch` cho rung 1 (robots.txt), rung 2 (sitemap) và quét bundle JS. App
này **không có** tool đó — tôi bê tên từ kho `SEO IE VN` (chạy trong Claude Code, ở đó có `WebFetch`)
mà không kiểm. Bảng đếm nói rõ hậu quả: `web_search` gọi 4 lần (có thật), `web_fetch` gọi **1 lần**
rồi thôi, và `browser_javascript` **81 lần** — model tự chế đường thay thế.

Đã đổi sang `fetch()` chạy trong trang bằng `browser_javascript`, và đó thật ra là đường **tốt hơn**:
nó giữ nguyên origin và cookie site mong đợi.

**Lỗ trong bộ kiểm:** mục 17 gác `seo_*`, mục 18 gác `browser_*`, giữa hai cái đó tôi để hở đúng
phần còn lại. Thêm mục 19 quét mọi tên tool trong skill, đối chiếu với danh sách **đo được** (mỗi tên
là một tool đã chạy trót lọt thật) cộng một danh sách đen ghi rõ `web_fetch` và `browser_search`.

Mục 19 bắt oan ngay lần đầu — nó tóm chính dòng cảnh báo *"There is NO `web_fetch` here"*. **Một rào
chặn oan là một rào sẽ bị tắt**, nên nó được dạy phân biệt lời *sai khiến gọi* với lời *nhắc rằng
không có*.

Cùng lượt, mục 11 cũng lộ ra là mục kiểm đứng yên: nó chỉ hỏi "tám tool này có mặt không", nên tool
thứ chín ra đời mà nó vẫn xanh và vẫn in "tám tool". Nay đếm **hai chiều** — bắt cả thiếu lẫn thừa.

### Rửa thẻ markup lọt vào `source`

Lượt chạy thành công để lại mười biên lai dạng `source: research/home-20260822.md</source>` — model
tự bọc giá trị trong cặp thẻ, chỉ nửa đóng sống sót. Không có gì hỏng ra mặt: file vẫn ghi, biên lai
vẫn trông đúng, chỉ là đường dẫn thôi không mở được ở mọi công đoạn sau.

Rửa trong công cụ (`cleanSource`, áp cho cả bullet lẫn ô bảng), không phải bằng lời dặn trong skill —
**một luật model phải nhớ là một luật sẽ có model quên.**

### Thanh tiến độ quét trên trang SEO

Chủ dự án chọn phương án có thanh, sau khi tôi nêu điểm yếu của nó: **mẫu số lấy ở đâu.** Nên mẫu số
được làm cho chính xác chứ không ước lượng.

**Mức 1 — chỉ cộng thêm.** Thanh nằm trong hàng `.hdw-seo-stage` của chính plugin, không đụng slot
nào của upstream.

**Tự vẽ một component** (`ScanProgressBar`), theo Luật 4: upstream không có thanh tiến độ — đã kiểm,
gần nhất là `StateDot` với bốn trạng thái, không phải một tỉ lệ. Dựng bằng `div` + biến `--dsw-*`,
cùng khuôn với `ConfidenceBar` đã có.

Cơ chế, hai đầu đều đọc từ đĩa:

- **Mẫu số** — tool mới `seo_scan_plan` ghi danh sách route người dùng duyệt ở GATE A vào
  `<domain>/.scan-plan.json`. Không đọc số từ file kiểm kê do model viết: đếm hàng trong văn xuôi
  model viết là phép đo sẽ sai âm thầm, và **một thanh người dùng học được là không đáng tin thì thà
  đừng có còn hơn** — một lượt chạy sai là đủ để dạy điều đó.
- **Tử số** — mỗi file bằng chứng tự khai `route:` trong front-matter (`seo_artifact_write` nhận thêm
  đối số `route`). Một file phục vụ nhiều route thì khai cả danh sách, và mỗi mục được tính.

`.scan-plan.json` được guard bảo vệ: sửa tay nó là làm thanh nói dối về việc chưa ai duyệt.

Trang **tự đọc lại đĩa mỗi 5 giây trong lúc quét**, và chỉ trong lúc quét — điều kiện "đang chạy"
cũng nằm sẵn trên đĩa (đã duyệt kế hoạch, công đoạn chưa xong). Thiếu nó thì thanh vẽ một lần rồi
nói dối suốt nửa tiếng, mà **một thanh đứng im đọc ra là một lượt chạy đứng im.**

**Hai lỗi chỉ MẮT bắt được, số đo xanh hết:**

- Công đoạn **Blocked** mà vẫn vẽ thanh 75% — hai thứ nói ngược nhau trên cùng một hàng. Nay công
  đoạn bị chặn không vẽ thanh.
- Màu: tôi chọn `--dsw-alias-brand-primary`, tưởng là màu nhấn. Nó là token **chữ** (đen ở nền sáng,
  trắng ở nền tối) nên vẽ ra một vệt đen trông như bôi xoá. Màu nhấn thật là
  `--dsw-alias-state-business-primary` (xanh DeepSeek, tự đảo theo sáng/tối). Và xanh lá chỉ dành cho
  lúc **xong** — mắt đọc màu trước khi đọc số, nên một thanh xanh lá ở 75% đọc ra là "thành công"
  trong khi việc còn dở.

Bộ kiểm: `spike:seo` **19/19** · `spike:seo-store` **46/46** · `spike:seo-ui` **28/28**.

### Kho kiến thức thị trường: từ hàng rào thành vòng tự lớn

Chủ dự án thêm site vào workspace thật của mình, rồi báo: **nút Brand research không bấm được.**

Lý do trên màn hình là `Needs first: PH market research` — một công đoạn **chưa ai viết**. Tôi đã
dựng kho `_knowledge/` thành điều kiện tiên quyết, rồi để cái nút duy nhất dẫn tới nó trỏ vào chỗ
trống. Người dùng không có đường đi tiếp, và trang thì nói cứ như có.

Chủ dự án hỏi thẳng một câu chấm dứt tranh luận: *bên `D:\Work\SEO IE VN` có bước đó không?* Đi đọc:
kho mẫu chỉ có **hai** skill (`casino-brand-playbook`, `topical-map`), **không có** skill nghiên cứu
thị trường nào cả. Mấy file `_knowledge/` bên đó mang dấu `contributing_brands: [alo789]` — chúng
**lớn lên TỪ** lượt nghiên cứu brand, không đứng trước nó.

Sửa theo đúng hình đó:

- **Bỏ cổng chặn.** `readBoard` không còn nhận `MarketView`; hàng "PH market knowledge" trên trang
  thành **bảng báo**, không phải điều kiện — và **nút "Research PH market" bị gỡ**. Một cái nút bấm
  được mà đằng sau trống rỗng thì tệ hơn không có nút.
- **Phase 1 tự gieo.** Kho trống thì skill gieo từ `references/ph-market-checklist.md` (mới, ~150
  dòng: PAGCOR vs Curaçao vs POGO, GCash/Maya/InstaPay/7-Eleven, sabong/color game/tongits,
  JILI/FaChai, mùa "ber months" và lương tháng 13). Mọi dòng gieo mang
  `confidence: medium; source: skill-reference` — vốn từ khởi đầu, và nhãn nói đúng điều đó.
- **Phase 7 ghi ngược.** Quét xong thì mang thứ đã xác minh về kho, **chỉ phần chung của thị
  trường**. "ArionPlay rút tiền trong 5 phút" là chuyện brand; "site PH nào cũng dẫn đầu bằng GCash"
  là chuyện thị trường.
- **Không cho hạ cấp.** `mergeResearched`: cùng một câu, bằng chứng tốt hơn thì thay, kém hơn thì
  **bị bỏ**. Luật nằm trong công cụ, không nằm trong lời dặn — nâng `medium` → `high` là ý đồ, còn
  `high` → `low` thì kho càng dùng càng tệ mà không ai biết.

### Rào chắn chỉ gác một cánh cửa — và mã gốc có ba

`guard.ts` khai đúng **một** tool ghi file: `str_replace_editor`. Lượt chạy thật đếm ra
**3 lần `write` + 1 lần `edit`** — engine có sẵn hai cái đó, model với tay sang và đi thẳng qua.

Hậu quả đo được: `research/home.md` ghi tay, không biên lai, không dòng `route:`, và thanh tiến độ
lặng lẽ ngừng đếm một route đã quét xong. Hậu quả **chưa** xảy ra nhưng vẫn mở toang: cùng đường đó
ghi được thẳng vào `brand.md`, tức là toàn bộ luật "mọi câu phải có nguồn" có một cửa sau từ ngày
đầu.

Bộ kiểm không thấy vì nó hỏi sai câu: mục 24-28 kiểm `protectedFile` — **phép tính đường dẫn** — mà
chưa bao giờ hỏi guard có **nhận ra cái tool đang ghi** hay không. Nay có mục 28b hỏi đúng câu đó.

Cùng lượt, `research/*.md` chuyển sang **được bảo vệ**. Trước đó tôi cố ý để ngỏ với lý do "đây là
ghi chú thô" — lý do ấy đúng cho tới khi file đó bắt đầu nuôi một con số người dùng đọc.

### Ba lỗi của chính bộ kiểm, đắt hơn mọi lỗi sản phẩm trong buổi

**1. Bài kiểm tự dọn đường cho mình.** Nó gieo sẵn năm file `_knowledge/` rồi mới bấm chạy — tức là
**nhảy qua cổng thay vì mở cổng**. Nó xanh suốt trong khi workspace thật của chủ dự án đứng im. Nay
lượt chạy bắt đầu từ **trống trơn**, đúng cảnh một người mở app lần đầu.

**2. In "ANSWERED" trong khi không trả lời được gì.** Hàm trả lời hộ ở cổng duyệt đi ngược từ nút
Submit lên trên tới khi gặp chữ "Skip this question" — mà Skip và Submit là **hai nút anh em** trong
cùng một khung, nên nó dừng ngay ở khung chỉ chứa hai cái nút. Ô nhập và danh sách phương án nằm ở
khối bên cạnh. Gõ vào hư không, chọn vào hư không, Submit mờ suốt.

Nó in **403 dòng "ANSWERED"**, rồi báo mười mục đỏ như thể sản phẩm hỏng. Giá: 35 phút và một lượt
gọi model thật, đổi lấy một bản báo cáo sai. Nay neo vào `data-question-scroll` (thuộc tính upstream
đặt trên đúng khối thân câu hỏi), **kiểm nút Submit có sáng lên rồi mới bấm**, trả về `STUCK: …` khi
không làm được, và bỏ cuộc sau một phút kèm dòng nói rõ *"bài kiểm hỏng, không phải skill"*.

**3. Lại đo quá sớm.** Vòng theo dõi dừng khi thấy `playbook.md` — sản phẩm **Phase 6** — nên Phase 7
bị chấm "vòng chưa khép" trước khi kịp chạy. Đúng loại lỗi đã cắt ở dòng đầu tiên của `brand.md` hôm
trước, chỉ dịch xuống một phase. Nay chờ tới khi kho nhận được một dòng **không phải dòng gieo sẵn**,
hoặc hết hai phút.

Ba cái này cùng một họ với bài học hôm trước, và họ đó có tên: **một phép đo bị cắt ngang, hoặc tự
dọn đường, không phải là một kết quả.**

### `routes_scanned` thôi không hỏi model nữa

Một lượt chạy thật đơn giản là không gửi `coverage.routes_scanned`, và front-matter mất trắng con số
đó — không gì lên tiếng. Nay `routes_scanned` và `routes_planned` do **công cụ đếm** từ kế hoạch quét
và dòng `route:` của từng file bằng chứng, và model gửi số vào thì bị bỏ qua. Cùng khuôn với
`fact_count` và `high_confidence_pct` đã làm trước đó: **cái gì công cụ đếm được thì công cụ đếm.**

### Nghiệm thu: 23/23 trên workspace trống trơn

Một lượt, bắt đầu từ không có gì ngoài site record:

| | |
|---|---|
| Kho kiến thức | tự gieo **5/5** file, Phase 7 ghi ngược vào `ph-market.md` **5 dòng có URL thật** |
| `brand.md` | **92 dữ kiện, 92 có biên lai**, 12 mục đúng thứ tự, **7 bảng** có cột `source` |
| Thanh tiến độ | **10 / 10 routes** |
| Bằng chứng | 8/8 file sau kế hoạch đều khai `route:` |
| Lời gọi `write`/`edit` | **0** — rào chắn đã bịt, mọi thứ đi qua tool |

Thứ Phase 7 mang về đúng loại: *"PH-facing casino SPA hay khai trong sitemap nhiều vertical hơn số
thực sự dựng — đối chiếu với endpoint navigation_v2 trước khi tin sitemap"* — kiến thức thị trường
dùng lại được cho brand sau, không phải chuyện riêng của ArionPlay.

Bộ kiểm: `spike:seo` **19/19** · `spike:seo-store` **51/51** · `spike:seo-ui` **29/29** ·
`spike:seo-run` **23/23**.

### Bịt mấy nút rỗng: công đoạn chưa có skill thì nói thật

Chủ dự án thêm site rồi đâm vào một ngõ cụt: hàng công đoạn mời bấm, bấm xong mở ra một chat không có
gì đằng sau — vì bảng liệt kê tên skill mà chưa ai viết. Một cái nút bấm được là một lời hứa; hứa mà
không có gì đằng sau thì tệ hơn im lặng.

Nay công đoạn nào không có skill trên đĩa thì hiện **`Not built yet`**, nút mờ hẳn, kèm dòng
`No skill for this stage yet`. Danh sách skill đọc từ **thư mục thật** (`builtSkills()`), không từ một
hằng số viết cạnh bảng — viết tay hai lần thì sớm muộn hai bản nói khác nhau, và cái được nhớ luôn là
cái nói dối. Viết xong một skill là hàng đó tự sáng, không phải sửa thêm chỗ nào.

Công đoạn **đã xong** thì miễn: Site setup xong ngay lúc thêm domain (form ghi `site.md`), dù skill
của nó chưa bao giờ tồn tại — "chưa dựng" cạnh một việc đã xong là nói dối theo chiều ngược lại.

Và hiện **cả hai lý do** khi cả hai cùng đúng: một hàng có thể vừa chưa tới lượt (thứ tự) vừa chưa có
skill (nút chết). Bỏ vế nào cũng mất thông tin.

Một lỗi chỉ **ảnh chụp** bắt được: nhãn `Not built yet` bị bẻ đôi thành `Not built / yet`, làm một
hàng cao hơn hàng bên, đọc ra lởm chởm. Mọi mục kiểm xanh — DOM đúng, chữ đúng. Cột tên 200px không
đủ; nới lên 260px và cấm chữ trạng thái xuống dòng.

### Tách `seo-pipeline` thành repo riêng, mang theo cả bộ kiểm

Plugin rời khỏi app, thành `D:\AI\seo-pipeline` — repo riêng, có git. Cơ chế đã có sẵn upstream:
khai `dsh.bundle.patch` trong `package.json` là engine tự nạp khi plugin nằm trong hồ sơ. Ba chỗ nối
vào `src/main/` (`paths.ts`, `engine.ts`, `plugin-link.ts`) không cần nữa — và vì chúng chưa từng được
commit, gỡ ra là app **trở về đúng nguyên trạng đã commit**, không để lại một dấu vết nào.

Ba trong bốn bộ kiểm khởi động engine thật, một bộ lái Electron thật có trình duyệt thật bên trong.
Nhân đôi engine với Electron sang repo mới là vài trăm MB đổi lấy không gì, nên **repo mượn app làm
hàng xóm**: `scripts/host.cjs` tìm app ở thư mục anh em, hoặc theo `HDW_APP`. Thiếu thứ gì bên app,
bộ kiểm **dừng ngay và nói rõ phải chạy lệnh nào** — thay vì để lỗi rơi xuống ba tầng rồi bắt người
đọc đi tìm bug trong plugin. Đúng bài học của cả buổi: một phép đo hỏng phải trông khác một sản phẩm
hỏng.

Bốn bộ kiểm chạy từ repo mới: `spike:store` **53/53** · `spike` **19/19** · `spike:ui` **31/31** ·
`spike:run` **23/23**, lượt cuối trên workspace trống trơn, VPN qua PH, ra `brand.md` 58 dữ kiện và
Phase 7 ghi ngược cả 5 file kiến thức.

### "Failed to load plugins" — không phải bug plugin, là engine cũ còn treo

Giữa lúc tách repo, app hiện màn hình đỏ `Failed to load plugins` kèm lỗi module-table về
`dsh-client-ui-theme`. Đào ra: `spike:ui` vẫn 31/31, và `spike:run` vẫn qua mục 0-6 sạch — plugin nạp
tốt. Nguyên nhân thật: spike chạy trên **cổng cố định 57931** (settings.yaml ghi cứng cổng đó vào
baseURL của MiniMax, không chọn ngẫu nhiên được). Lượt bị máy ngủ cắt để lại một engine treo trên
cổng ấy; cửa sổ mới nạp trúng cái engine nửa chết.

Thêm chốt `freePort()` vào `spike:run`: `netstat` tìm PID đang giữ cổng, `taskkill` kết liễu, rồi mới
bind. Máy ngủ giữa chừng lần nữa cũng không để lại engine ma.

### Split tunneling của VPN — traffic không đi qua VPN dù app báo "connected"

Trước khi chạy lượt thật, kiểm thấy `arionplay.com` trả 403 dù ProtonVPN báo đã nối sang PH. Đo IP
ra thật của shell: `171.251.233.14 · Viettel · VN` — không phải IP VPN. Split tunneling đang loại
trừ tiến trình khỏi đường VPN. Tắt split tunneling xong, IP ra thành `188.214.x` và `.com` trả 200.

Bài học cho những lượt sau: **VPN báo "connected" không có nghĩa traffic của mình đi qua nó.** Đo IP
ra thật, và đo phản hồi của chính site đích, trước khi tiêu nửa tiếng và tiền gọi model.

## 2026-08-24 — Panel bên phải kéo rộng được như Claude app

Bỏ trần cứng `MAX_WIDTH = 720px` của panel dock, thay bằng trần động theo cửa sổ:
panel kéo rộng tới đâu cũng được miễn còn chừa `MIN_CONVERSATION_WIDTH = 480px` cho cột
chat. Sửa trong `plugins/dock/src/client/store.ts` (`setWidth`). Mức 1, không đụng upstream.

Vì sao: người dùng thấy panel cũ mở tối đa chỉ được ~720px, chật khi xem trang web/terminal.
Claude app không chặn bằng con số cố định mà giữ một dải chat tối thiểu — làm y vậy, nên
màn hình càng rộng thì panel càng kéo rộng được.

## 2026-08-18 — Vòng nền không đề xuất lại skill đang chờ, và hiện phạm vi trên từng dòng

Chủ dự án thấy hai dòng `gsc` trong hàng đợi và hỏi vì sao có hai bản cải tiến. Hóa ra không phải
hai bản của một thứ: một cái **chỉ trong `D:\Work\GSC`**, một cái **mọi nơi** — hai file đích khác
nhau, từ hai cuộc trò chuyện cách nhau một ngày. Giao diện giấu mất phạm vi nên chúng trông y hệt.

**Hiện phạm vi trên từng dòng Skills.** Trước đây chỉ hộp Preview mới ghi "everywhere / this
project"; hàng trong danh sách thì không. Nay mỗi dòng có nhãn `everywhere` hoặc `only in <thư mục>`.
Đã xác nhận trên app: hai dòng giờ đọc là `only in GSC` và `everywhere`.

**Gốc rễ vì sao đề xuất bị lặp:** vòng nền chạy dưới dạng fork, nên nó *thấy* các skill đã duyệt qua
skill-catalog — nhưng một đề xuất **đang chờ** thì chưa nằm trên đĩa, nên nó **không thấy**. Thiếu
thông tin đó, mỗi cuộc GSC mới lại tưởng "chưa có skill gsc" và đề xuất lại.

Sửa hai lớp:

1. **Báo cho vòng nền biết cái gì đang chờ.** Prompt của lần rà nay đính kèm danh sách đề xuất đang
   chờ (tên + phạm vi + mô tả), kèm lệnh: *"những cái này đang chờ duyệt, đừng đề xuất lại; nếu một
   cái đã bao được thứ bạn định viết thì im lặng; chỉ gọi lại khi thật sự cải tiến được, và dùng
   đúng tên + phạm vi để bản mới thay bản cũ."* Danh sách đọc ngay lúc fork khởi động nên thấy cả
   thứ một lần rà trước đó vừa thêm.
2. **Chặn bản trùng y hệt ở tầng công cụ.** `propose_skill` giờ: nếu đã có đề xuất cùng tên + phạm
   vi + dự án **và cùng nội dung** thì trả về nguyên bản cũ, không ghi gì — hết cảnh một lần rà cứ
   đẩy lại đúng skill đó lên đầu với id và mốc thời gian mới. Bản khác nội dung (cải tiến thật) vẫn
   thay bản cũ như trước.

Đã chạy thử: mở một cuộc 12 lệnh để ép vòng nền chạy trong lúc hai `gsc` đang chờ → review chạy
xong, "nothing kept", không crash, hàng đợi vẫn đúng hai `gsc`, không đẻ thêm cái thứ ba.

## 2026-08-18 — Skill "thay bản cũ" hiện diff đỏ/xanh, chỉ dòng đổi

Chủ dự án hỏi: một skill cải tiến thì làm sao biết đổi gì — ngồi dò từng chữ giữa hai khối à? Đúng,
hai khối "Now on disk" / "Would become" xếp chồng bắt người đọc so tay. Sửa.

Hệ thống có sẵn `DiffBlock` (đỏ cho dòng bỏ, xanh cho dòng thêm) — nhưng nó chỉ *tô*, không tự tính
chỗ khác nhau: đưa nguyên khối cũ + khối mới thì nó bôi cả khối cũ đỏ, cả khối mới xanh, vẫn là bức
tường chữ. Nên phần tính khác biệt làm ở `client/linediff.ts`: một thuật toán LCS theo dòng, gom
thành từng cụm đổi, **bỏ các dòng không đổi**. Thứ đưa cho `DiffBlock` chỉ còn đúng những dòng khác
nhau. Chân khối tự có dòng tổng `+thêm -bỏ · N file` — chính là "dòng tổng kết đã sửa gì" theo lượng.

`linediff.ts` là logic thuần (không phải giao diện), nên tự viết là hợp lệ — phần *hiển thị* vẫn là
`DiffBlock` của upstream. Skill "mới" (chưa có trên đĩa) thì không có gì để so, vẫn hiện nguyên khối
"Would be written" như cũ.

Đã chạy thử với một skill dựng riêng để kiểm (`difftest`): đổi một dòng + thêm một dòng → diff hiện
đúng dòng cũ màu đỏ, dòng mới màu xanh, dòng thêm màu xanh, hai dòng không đổi bị ẩn, chân ghi
`+2 -1 · 1 file`. Dọn sạch dữ liệu thử sau đó, chỉ còn lại hai `gsc` thật của chủ dự án.

## 2026-08-18 — Thêm dòng tóm tắt "đã sửa gì" bằng ngôn ngữ của người dùng

Chủ dự án muốn thêm một câu tổng: skill này cải tiến **cái gì**, viết bằng tiếng người dùng đang trò
chuyện (họ nói tiếng Việt thì câu đó tiếng Việt).

Chỉ có model — lúc nó cải tiến skill — mới biết nó đổi gì và vì sao, nên để nó tự viết. Thêm tham số
`changeNote` cho tool `propose_skill`: một câu, **bằng đúng ngôn ngữ của cuộc trò chuyện**, chỉ dùng
khi cải tiến skill đã có (bản mới hoàn toàn thì bỏ trống — không có gì để "đổi"). Prompt vòng nền
được dặn kèm câu này mỗi khi patch. Câu đó hiện **ngay trên diff**, viền trái màu nhấn, đọc là hiểu
ngay không cần dò đỏ/xanh.

Về luật ngôn ngữ: nhãn cố định trên giao diện vẫn tiếng Anh; câu tóm tắt này là **nội dung do model
viết**, cùng loại với các mẩu nhớ tiếng Việt đang hiện — nên nó theo ngôn ngữ người dùng là nhất
quán, không phá luật.

Đã chạy thử (ca `difftest` dựng riêng, có `changeNote` tiếng Việt): câu *"Sửa lại bước 2 cho rõ hơn
và thêm bước 4 kiểm tra kết quả cuối."* hiện đúng phía trên diff, dưới là đỏ/xanh và chân `+2 -1 · 1
file`. Dọn sạch sau đó.

## 2026-08-29 — Nâng engine lên 0.1.1-rc.2, và một tính năng mới của DeepSeek suýt giết panel

Nhảy bốn bản một lượt: `0.1.0-rc.6` → `rc.7` → `rc.8` → `0.1.1-rc.1` → `rc.2`. Người dùng app được
thêm: gửi ảnh vào hội thoại và model nhìn được ảnh (`DeepSeek-V4-Flash-Vision-Exp`), menu `@` tham
chiếu được cả file lẫn phiên cũ, PowerShell chạy liên tục trên Windows, Codex và Claude Code làm
subagent, plugin tự đăng ký được thẻ trong Settings, và mức suy luận `low` cho model DeepSeek.

### Ba chỗ phải sửa theo API mới

**1. `ui-primitives` và `ui-slots` biến mất khỏi bản cài.** Upstream chuyển hai gói này từ
`peerDependencies` sang `devDependencies` — bản dựng web của họ đã nhúng sẵn nên họ chỉ cần chúng lúc
biên dịch. Mà `npm run engine:install` chạy với `--omit=dev`, nên hai gói nền tảng mà **toàn bộ giao
diện của ta** dựa vào không được tải về nữa: 33 lỗi kiểu ngay lượt kiểm đầu. Cách sửa: ghim thẳng hai
gói đó trong [engine/package.json](engine/package.json). Chúng vẫn được **trang web cấp lúc chạy** qua
bảng module; bản trên đĩa chỉ để có kiểu dữ liệu lúc biên dịch. Tốn thêm 0,5 MB trong bản cài.

**2. Upstream bỏ hẳn component ảnh dùng chung.** `MessageImage` từng được `ui-attachment` xuất ra và
thẻ ảnh chụp màn hình của ta dùng nó (kèm sẵn khung phóng to khi bấm). Nửa client của gói đó nay nói
thẳng một câu: *"Register attachment presentation without exporting React components as package
values."* Nó chuyển sang chỉ đổ vào slot `conversation.message.images`, mà slot đó thuộc về thân tin
nhắn, không phải thẻ kết quả tool.

Kiểm trước khi tự viết đúng theo Luật 4: cả 25 component trong `ui-primitives` không cái nào vẽ ảnh,
và không có service nào phát ra khung xem ảnh. Nên khối ảnh nay nằm ở
[ScreenshotImage.tsx](plugins/dock/src/client/ScreenshotImage.tsx) — nhưng **khung phóng to vẫn là
`Modal` của upstream**, và mọi màu vẫn là biến `--dsw-*`. Mức 1.

**3. Danh sách "module do trang cấp" đã đổi.** `dsh-client-web-react` và `dsh-client-schema-form` bị
xoá khỏi upstream; `react` và `react-dom` nay là gói thật. Quan trọng hơn: bảng module cố định trong
`packages/client/web/src/platform.ts` **không còn tồn tại** — thay bằng gói `dsh-client-modules` với
một bộ nạp CJS lười. Bảng nền nay chỉ còn bảy tên (react ×4, cordis, ui-primitives, ui-slots); mọi gói
dsh khác được giải qua **dòng trong đồ thị khởi động** theo tên gói. `CLIENT_EXTERNALS` trong ba file
`build.mjs` đã cập nhật, kèm nguồn tra cứu mới.

### Lỗi thật: engine mới tự mở trình duyệt, và nó cướp mất quyền điều khiển panel

Sau khi sửa xong ba chỗ trên, `npm run spike:dock` tụt từ **62/62 xuống 40/62**. Chia rất sạch: mọi
thứ **người dùng tự bấm** (mở tab, gõ địa chỉ, chuột, bàn phím, terminal, Files) đều đạt; mọi thứ
**agent tự điều khiển trang web** (đọc trang, chụp ảnh, điều hướng, điền form) đều hỏng, với cùng một
câu: `tab.el.executeJavaScript is not a function`.

Đường truy: chạy lại với mã nguồn cũ nguyên bản + engine mới → hỏng y hệt, nên không phải do ba sửa
đổi trên. Cài lại engine rc.6 → 62/62 trở lại, nên đúng là do bản mới. Đặt đầu đo vào chỗ ném lỗi:
thẻ webview ở đó là `HTMLElement` trơn, `customElements.get('webview')` trả *chưa đăng ký*. Đầu đo
thứ hai ghi lai lịch từng thẻ được tạo: cái stage mà cầu nối đang nói chuyện **chỉ tạo đúng một thẻ**,
không có tab mà panel đang hiện — tức là có hai trang cùng chạy plugin, và cầu nối nói với trang sai.

Thủ phạm là một tính năng mới trong ghi chú phát hành rc.8, đọc thì vô hại: *"opening the browser
automatically for local `dsh web` runs"*. App khởi động engine đúng bằng lệnh đó. Nên từ bản này, mỗi
lần mở app desktop thì **một tab trình duyệt cũng tự bật lên**; tab đó cũng tải plugin panel, cũng nối
vào cầu điều khiển, mà trình duyệt thường thì không có `<webview>` — nên lệnh của agent đi nhầm sang
đó rồi chết, trong khi panel trong cửa sổ app ngồi không.

Sửa: thêm cờ `--no-open` vào lệnh khởi động engine ở [src/main/engine.ts](src/main/engine.ts). Sau đó
`spike:dock` **62/62** trở lại, và mở app không còn bật tab trình duyệt nào.

Bài học ghi lại vì nó sẽ lặp: **một dòng trong ghi chú phát hành nói về trải nghiệm dòng lệnh vẫn có
thể là một thay đổi hành vi phá app.** Bảng đối chiếu tính năng mới không bắt được nó — chỉ có bộ kiểm
chạy thật mới bắt được, và nó bắt bằng cách hỏng ở một chỗ trông chẳng liên quan gì.

### Ba bộ kiểm đã nói dối, nay sửa lại

Cùng lượt này lộ ra ba chỗ bộ kiểm báo sai — nguy hiểm ngang lỗi thật, vì một cái lưới nói dối là cái
lưới sẽ bị bỏ.

- **`spike:loader`, `spike:manager`, `spike:plugin-guard`** dò bảng khởi động bằng
  `window.__DSH_BOOT__ = …`, mà bản mới ghi `globalThis["__DSH_BOOT__"] = …`. Đọc ra rỗng, nên mọi mục
  dựa vào nó báo đỏ oan trong khi tính năng chạy đúng. `spike:manager` từ 6 mục đỏ về **14/14**.
- **`spike:manager`** còn ôm hai khẳng định lỗi thời **của chính ta**, không liên quan tới nâng cấp:
  công tắc plugin đã rời Settings sang chân thanh bên, và `ours` kiểu boolean đã thành `origin` ba giá
  trị từ lúc thêm chợ plugin.
- **`spike:pty-route`** đòi biến môi trường `HDW_SEED_PATCH` mới đăng ký được workspace; chạy trần thì
  mục 4 luôn đỏ. Nay mặc định dùng `scripts/spike-ws-seed.mjs` như `spike:dock` vẫn làm → **6/6**.

Mười hai file `spike-*` khởi động engine đều đã thêm `--no-open`, cùng lý do với app.

### Còn một mục đỏ, và nó không thuộc về lượt này

`spike:switch` mục 20 dò gói mẫu `dsh-plugin-vetting` trong chợ cộng đồng. Gói vẫn còn trên npm nhưng
**đã bị gỡ khỏi danh mục chợ** — dữ liệu bên ngoài, rữa theo thời gian. Mục 20 thoát sớm nên mục 21 và
22 (cài thật rồi gỡ thật) âm thầm không chạy. Cần chọn gói mẫu khác, tách thành việc riêng.

### Nghiệm thu

`npm run typecheck` sạch. `spike:dock` **62/62**, `spike:manager` **14/14**, `spike:pty-route`
**6/6**, `spike:tools`, `spike:card`, `spike:chats`, `spike:think`, `spike:relay`, `spike:picker`,
`spike:plugin` đều đạt. Trong app thật: phiên cũ đọc được nguyên vẹn dù rc.8 đổi định dạng lưu trữ
SQLite, panel mở được, Files đọc thư mục, Terminal chạy shell thật, và agent đọc được nội dung trang
web trong panel. `spike:loader` còn 4 mục đỏ nhưng chính nó ghi ở chân báo cáo rằng mục đỏ ở đó là
**phép đo tính chất của engine**, không phải lỗi: engine không tự giữ trạng thái tắt qua lần khởi động
lại, nên plugin quản lý phải tự lưu — mà nó đang làm đúng vậy, và `spike:manager` chứng minh.

## 2026-08-29 — Bản đóng gói dựng ra được nhưng chết ngay khi mở, và không gì báo

Phát hiện lúc dựng bản phát hành đầu tiên cho người khác dùng. `npm run dist` chạy xong, exit code 0,
installer 171 MB nằm đó trông bình thường. Mở lên thì app hiện màn hình lỗi: engine chết với
`Cannot find package 'ws'`.

Nguyên nhân nằm ở [electron-builder.yml](electron-builder.yml). Hai thư viện lúc chạy của panel
(`ws`, `node-pty`) được khai bằng hai dòng kiểu `<thư mục gói>/<tên>/**/*` **bên trong** danh sách lọc
của mục chép `plugins/dock`. Danh sách đó là loại "chỉ lấy những thứ này" — và khi có một danh sách
như vậy, electron-builder **gạt cả thư mục gói ra trước khi đọc tới các dòng đó**. Kết quả: bản đóng
gói không mang theo thư viện nào của panel.

Tách thành hai mục chép riêng vẫn hỏng y hệt, chừng nào chúng còn mang lọc kiểu "chỉ lấy" (`- '**/*'`
cũng tính là một). Chỉ khi bỏ hết, để lại **thuần các dòng loại trừ** (`- '!**/*.pdb'`) thì mới chép
được — cũng chính là lý do mục chép cây phụ thuộc của engine phía trên luôn chạy đúng: nó không có lọc.

Hai điều đáng nhớ hơn cả bản thân lỗi:

- **Lỗi này chỉ tồn tại trong bản đóng gói.** `npm run dev` không bao giờ dính, vì lúc đó plugin được
  nạp thẳng từ thư mục dự án, nơi thư viện của nó nằm sẵn. Mọi bộ kiểm hiện có đều chạy trên cây dự
  án, nên **62/62 vẫn xanh trong khi thứ giao cho người dùng thì không mở nổi**.
- **Không có gì báo.** Không cảnh báo lúc dựng, không lỗi, không dòng log. Nên luật rút ra, đã ghi
  thẳng vào file cấu hình: *sau mỗi lần đụng vào phần đóng gói, phải CHẠY THỬ BẢN ĐÃ ĐÓNG GÓI — đọc
  log không chứng minh được gì.*

Nghiệm thu lần này làm đúng vậy: chạy cả `release/win-unpacked/Harness Desktop.exe` lẫn bản portable.
Cả hai đều lên engine, phục vụ đủ ba plugin có giao diện, mở được tab web và agent đọc được nội dung
trang, và mở được phiên terminal thật (`cmd.exe`, đúng thư mục, chữ của shell chảy về).
