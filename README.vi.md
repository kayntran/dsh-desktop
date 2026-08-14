# Harness Desktop

App desktop Windows cho [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — cài xong, bấm icon là chạy. Không cần terminal, không cần cài Node.js.

🇬🇧 [English](README.md)

> **Không liên kết với DeepSeek.** Đây là lớp vỏ desktop không chính thức, do
> cộng đồng làm. Xem [NOTICE.md](NOTICE.md).

## Đây là gì

DeepSeek Harness (`dsh`) là một agent harness mã nguồn mở. Mặc định bạn chạy nó
bằng cách gõ `npx @deepseek-ai/dsh web` trong terminal rồi mở trình duyệt vào
`http://127.0.0.1:3080`.

Harness Desktop bỏ bước đó đi. Nó là một lớp vỏ Electron mỏng, khởi động đúng
engine ấy trên một cổng loopback riêng và hiện đúng giao diện ấy trong một cửa
sổ desktop. **Nó không sửa gì của thượng nguồn** — engine lấy nguyên trạng từ
npm, nên mọi tính năng và mọi bản vá đều về theo một lần nâng số phiên bản.

Phần vỏ đóng góp thêm:

- **Chỉ một bản app cùng lúc.** Bấm icon lần hai thì focus cửa sổ đang mở, thay
  vì dựng engine thứ hai làm hỏng lịch sử phiên chat.
- **Đóng về khay.** Nút X ẩn cửa sổ, agent làm tiếp. Chỉ lệnh *Thoát* trong menu
  khay mới dừng hẳn.
- **Thông báo Windows** khi agent cần bạn duyệt, đang hỏi bạn, làm xong lượt,
  hoặc gặp lỗi — chỉ hiện khi cửa sổ không ở trước mặt bạn.
- **Nhớ cửa sổ** vị trí và kích thước, và kéo về trong màn hình nếu bạn rút màn
  hình phụ ra.
- **Dọn sau khi tắt cứng** — nhận diện bằng danh tính tiến trình chứ không chỉ
  PID, nên không bao giờ diệt nhầm một tiến trình vô can được cấp lại số đó.
- **Báo khi có bản mới** (không bao giờ tự cài sau lưng bạn).

## Cài đặt

Tải `Harness Desktop-<phiên bản>-setup.exe` mới nhất ở
[Releases](../../releases) rồi chạy. Có cả bản `-portable.exe` nếu bạn không
muốn cài.

App chưa ký số nên Windows SmartScreen sẽ cảnh báo lần đầu: bấm
**More info → Run anyway**. Muốn hết cảnh báo thì phải mua chứng chỉ ký số.

Dữ liệu nằm ở `%USERPROFILE%\.dsh` — cùng chỗ với CLI `dsh`, nên app và CLI dùng
chung phiên và cấu hình. Gỡ cài đặt vẫn giữ nguyên thư mục đó.

## Build từ mã nguồn

Cần Node.js ≥ 22.19 và Windows.

```sh
git clone <kho này>
cd harness-desktop
npm install             # công cụ cho phần vỏ
npm run engine:install  # engine dsh, cài vào engine/node_modules
npm run runtime:install # Node runtime để engine chạy trên đó, vào runtime/
npm run icons           # sinh icon.ico và ảnh khay
npm run dev             # chạy thử
npm run dist            # dựng installer + portable vào release/
```

### Vì sao app mang theo `node.exe` riêng

Engine không chạy trên Node của Electron. V8 trong Electron bật memory cage,
nên N-API không tạo được external ArrayBuffer. `koffi` — đường mà thượng nguồn
gọi dialog chọn thư mục của Windows — cần đúng khả năng ấy, và khi thiếu thì
tiến trình chết hẳn (`FATAL ERROR: Error::New`) chứ không ném ra lỗi bắt được.
Dialog vẫn mở bình thường; chọn xong một thư mục là worker chết, và UI báo
*"win32 folder dialog worker exited before reporting a result"*.

Nên `npm run runtime:install` tải một `node.exe` chính thức (~88 MB, đối chiếu
SHA256 với nodejs.org) vào `runtime/`, và engine được spawn bằng nó. Thượng
nguồn spawn tiến trình con bằng `process.execPath` của chính nó, nên cả cây
engine thừa hưởng theo. Binary không commit; phiên bản ghim trong
[`scripts/fetch-node.ps1`](scripts/fetch-node.ps1).

### Vì sao `engine/` cài riêng

Các gói của dsh khai báo phụ thuộc thật bằng `peerDependencies`. Bộ thu thập
phụ thuộc của electron-builder chỉ đi theo `dependencies`, nên đóng gói engine
như một dependency bình thường đã âm thầm bỏ sót 214 gói và app chết ngay khi
khởi động với `ERR_MODULE_NOT_FOUND`. Cài engine dưới `engine/package.json`
riêng để npm tự phân giải trọn cây, còn trình đóng gói chỉ việc chép thư mục.
Nâng cấp dsh = đổi một số phiên bản ở đó rồi cài lại.

### Trước lần phát hành đầu tiên

Điền `REPOSITORY` trong [`src/main/updates.ts`](src/main/updates.ts) thành
`chu-so-huu/ten-kho` của bạn. Nó xuất xưởng để trống, và khi còn trống thì việc
kiểm tra bản mới bị bỏ qua hoàn toàn — không gọi mạng, không báo lỗi. Điền vào
là tính năng tự bật.

### Bố cục

| Đường dẫn | Nội dung |
|---|---|
| `src/main/` | toàn bộ lớp vỏ — vòng đời engine, cửa sổ, khay, notifier, cập nhật |
| `resources/` | trang chờ, trang lỗi, trang giới thiệu; icon được sinh ra |
| `engine/` | cây phụ thuộc riêng của engine dsh |
| `runtime/` | `node.exe` tải về, nơi engine chạy (không commit) |
| `scripts/` | sinh icon, tải Node, và các phép thử hợp đồng với thượng nguồn |

### Các phép thử (spike)

`scripts/spike*.mjs` không phải test — chúng là phép dò vào engine thật, dùng để
kiểm chứng những giả định mà lớp vỏ này dựa vào:

- `npm run spike` — engine khởi động được trên runtime đóng gói, phục vụ UI,
  trả lời RPC, và nhận kết nối WebSocket.
- `npm run spike:picker` — dialog chọn thư mục Win32 native mở được **và trả về
  đường dẫn**. Nó bấm nút xác nhận chứ không huỷ, vì chỉ nhánh xác nhận mới đọc
  kết quả ra khỏi bộ nhớ native, và chính chỗ đọc đó là thứ vỡ trên Node của
  Electron. Một phép dò chỉ huỷ dialog sẽ báo đạt trên đúng bản dựng đang hỏng.
- `npm run spike:frames` — in ra gói tin thô trên dây.

**Chạy cả ba sau mỗi lần nâng cấp `@deepseek-ai/dsh`.** Thượng nguồn nói rõ giao
thức RPC không mang số hiệu phiên bản và client với host phát hành gắn liền
nhau, nên phần xử lý frame của notifier là chỗ dễ lệch nhất.

## Giới hạn đã biết

- **Chỉ Windows.** macOS và Linux không được dựng và không được kiểm thử.
- **Thông báo không nhảy được vào đúng phiên.** UI thượng nguồn giữ lựa chọn
  phiên trong bộ nhớ, không có route riêng cho từng phiên, nên bấm thông báo mở
  được cửa sổ nhưng không chọn được phiên đã phát ra nó. Sửa việc này đòi hỏi
  can thiệp vào thượng nguồn — điều dự án cố ý không làm.
- **Bản mới chỉ được báo, không tự cài.** Đây là chủ ý.
- **Thượng nguồn đang ở giai đoạn developer preview** và nói rõ sẽ có thay đổi
  phá vỡ tương thích. Phiên bản engine được ghim cứng vì lý do đó.

## Giấy phép

MIT — xem [LICENSE](LICENSE) và [NOTICE.md](NOTICE.md).
