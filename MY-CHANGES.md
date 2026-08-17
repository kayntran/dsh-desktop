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
