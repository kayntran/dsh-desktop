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
