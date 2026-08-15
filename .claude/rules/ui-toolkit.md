---
paths: ["plugins/**", "**/*.tsx", "**/*.jsx", "**/*.css"]
description: Bắt buộc dùng component, icon và biến màu có sẵn của upstream. Cấm tự vẽ lại thứ đã có.
---

# Vật liệu giao diện: dùng của hệ thống, không tự vẽ

## Luật

**Bắt buộc dùng component, icon và biến màu của upstream. Cấm tự viết lại thứ đã có sẵn.**

Áp dụng cho: nút, ô nhập, menu, hộp thoại, tooltip, thẻ, toast, khối mã, khối kết quả, icon, màu,
khoảng cách, bo góc, đổ bóng.

Chỉ được tự viết khi **đã kiểm tra và xác nhận upstream không có** — xem mục "Khi thật sự không có
sẵn" ở cuối.

## Vì sao là luật chứ không phải khuyến nghị

Nói theo hướng người dùng app thấy gì:

- **Tự vẽ thì lệch tông ngay lập tức.** Nút bạn tự viết sẽ khác nút bên cạnh vài pixel, khác sắc độ,
  khác kiểu chuyển động khi rê chuột. Người dùng không chỉ ra được chỗ nào sai, nhưng thấy "phần này
  trông không giống phần kia".
- **Tự vẽ thì không theo được chế độ sáng/tối.** Component của upstream đọc biến `--dsw-*` nên tự
  đổi theo. Màu viết cứng thì sáng lên là chói, tối đi là mất chữ.
- **Tự vẽ thì đứng yên.** DeepSeek tinh chỉnh giao diện qua từng bản; phần dùng đồ của họ đi theo
  miễn phí, phần tự vẽ thì càng ngày càng cũ.
- **Tự vẽ thì mất khả năng dùng bàn phím và trình đọc màn hình.** Menu, hộp thoại, tooltip của
  upstream đã xử lý bẫy tiêu điểm, phím Esc, nhãn trợ năng. Viết lại từ đầu gần như chắc chắn bỏ sót.

Thêm nữa, đây là lượng việc bị làm thừa: bộ có sẵn gồm **25 component và 70 icon**, đủ dựng gần như
mọi thứ mà không phải viết dòng CSS nào.

## Có gì sẵn

Mọi gói giao diện của upstream **đã nằm trong engine đã cài** (`engine/node_modules/@deepseek-ai/`),
nên plugin import trực tiếp được.

### Component — `@deepseek-ai/dsh-client-ui-primitives`

| Cần gì | Dùng |
|---|---|
| Nút | `Button` (có `ButtonVariant`) |
| Ô nhập | `Input` |
| Menu thả xuống | `Menu` (`MenuEntry`, `MenuItem`, `MenuSeparator`, `MenuLabel`) |
| Hộp thoại | `Modal` |
| Thẻ nổi khi rê chuột | `HoverCard` |
| Chú thích ngắn | `Tooltip` (`TooltipSide`) |
| Nhãn tròn nhỏ | `Pill` |
| Chấm trạng thái | `StateDot` |
| Thông báo trôi | `Toast` |
| Hàng gập/mở | `DisclosureRow` |
| Xác nhận việc nguy hiểm | `RiskConfirmation` |
| Băng báo mất kết nối | `ConnectionBanner` |
| Màn hình hướng dẫn lần đầu | `OnboardingSurface` |
| Hiện dữ liệu JSON | `JsonTree` |
| Kết quả dòng lệnh | `TerminalBlock` |
| Nội dung file | `ReadBlock` |
| So sánh thay đổi | `DiffBlock` |
| Kết quả tìm kiếm | `SearchBlock` |
| Kết quả web | `WebBlock` |
| Khối mã | `CodeBlock`, `JsonBlock` |
| Văn bản markdown | `MarkdownText`, `MessageText` |
| Chép vào clipboard | `writeClipboard` |
| Giới hạn chiều cao theo neo | `useAnchoredMaxHeight` |
| Logo, chữ thương hiệu | `FishLogo`, `BrandWordmark` |

### Icon — cùng gói, `export * from './icons'`

70 icon, tên theo quy ước `Icon<Tên><Kiểu><Cỡ>`: `IconPlusOutline16`, `IconCheckOutline14`,
`IconTrashOutline16`, `IconSettingsOutline16`, `IconSearchOutline16`, `IconCopyOutline16`,
`IconEditOutline16`, `IconCloseOutline16`, `IconChevronDownOutline14`, `IconRefreshOutline16`,
`IconWarningOutline16`, `IconLoadingOutline16`, `IconSendOutline16`, `IconFolderOpen16`,
`IconDownloadOutline16`, `IconShareOutline16`, `IconLinkOutline16`, `IconGlobeOutline14`…

Xem danh sách đầy đủ:

```bash
grep -oE "^export (const|function) Icon[A-Za-z0-9]+" \
  _upstream_dsh/packages/client/ui-primitives/src/icons/index.tsx
```

**Không nhúng SVG tự tìm ở ngoài, không cài thư viện icon khác.** Cỡ và nét của bộ này đã khớp với
phần còn lại của app.

### Gói khác dùng được

| Gói | Việc |
|---|---|
| `@deepseek-ai/dsh-client-ui-theme` | Biến màu, chế độ sáng/tối |
| `@deepseek-ai/dsh-client-ui-slots` | Đăng ký vào slot |
| `@deepseek-ai/dsh-client-locale` | Đa ngôn ngữ |
| `@deepseek-ai/dsh-client-runtime` | Lấy dữ liệu phiên, gọi về host |
| `@deepseek-ai/dsh-client-schema-form` | Xử lý dữ liệu form theo schema — **lưu ý: không render gì**, chỉ là lớp dữ liệu; phần hiển thị vẫn tự dựng bằng `Input`/`Button` |

## Màu và khoảng cách

Chỉ dùng biến `--dsw-*`. Bảng gốc:
`_upstream_dsh/packages/client/ui-theme/src/styles/design-platform.css`

Ba nhóm, tổng 162 biến: `--dsw-alias-*` (78 — **dùng nhóm này**), `--dsw-specific-*` (11),
`--dsw-static-*` (73 màu gốc, đừng dùng trực tiếp vì chúng không đổi theo sáng/tối).

```css
/* Đúng */
.the-cua-toi {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l1);
}

/* Sai — viết cứng thì chế độ tối vỡ */
.the-cua-toi { background: #ffffff; color: #111111; }
```

Tên hay dùng: `--dsw-alias-bg-base`, `--dsw-alias-bg-layer-1|2|3`, `--dsw-alias-bg-overlay`,
`--dsw-alias-label-primary|secondary|caption|dimmed`, `--dsw-alias-border-l1|l2`.

**Không sửa file CSS của upstream.** Muốn đổi diện mạo toàn app thì ghi đè biến trong CSS của mình.

Tìm tên biến đúng — chú ý `--` đứng riêng, thiếu nó thì `grep` hiểu nhầm là tham số của chính nó:

```bash
grep -oE -- "--dsw-alias-[a-z0-9-]+" \
  _upstream_dsh/packages/client/ui-theme/src/styles/design-platform.css | sort -u
```

## React: dùng bản của hệ thống

Component của upstream chạy trên React 18 mà gói `ui-primitives` mang theo. **Đừng thêm `react` /
`react-dom` vào phụ thuộc của plugin** — hai bản React trong cùng một trang làm hook vỡ, và lỗi hiện
ra rất khó hiểu (màn hình trắng, không thông báo rõ nguyên nhân).

Khi dựng plugin giao diện đầu tiên, xác nhận lại điểm này bằng cách khai `react` và `react-dom` là
external lúc đóng gói, rồi mở app kiểm tra. Ghi kết quả vào [MY-CHANGES.md](../../MY-CHANGES.md) để
lần sau không phải dò lại.

## Khi thật sự không có sẵn

Trước khi tự viết bất cứ thành phần giao diện nào, **bắt buộc** kiểm tra:

```bash
grep -n "export" _upstream_dsh/packages/client/ui-primitives/src/index.ts
```

Nếu chắc chắn không có:

1. **Nói cho chủ dự án biết** đang định tự viết cái gì và vì sao không dùng được đồ có sẵn.
2. Dựng bằng vật liệu cấp thấp hơn của chính hệ thống: biến `--dsw-*` cho màu, và ghép từ các
   primitive sẵn có thay vì viết từ số không.
3. Đặt trong `plugins/<tên>/` như mọi thứ khác.
4. Ghi một dòng vào [MY-CHANGES.md](../../MY-CHANGES.md): đã tự viết cái gì, vì sao.

Không có bước nào trong bốn bước trên được bỏ. "Tự viết cho nhanh" là lý do phổ biến nhất khiến một
app trông chắp vá, và nó không bao giờ hiện ra dưới dạng lỗi.
