---
name: nang-cap-engine
description: Quy trình nhận bản cập nhật mới của DeepSeek cho engine dsh — nhánh riêng, đổi phiên bản, cài lại, kiểm lỗi, chạy thử, báo cáo. Kích hoạt khi user muốn nâng cấp engine, cập nhật dsh, lấy bản mới của DeepSeek, hoặc hỏi có bản mới không.
---

# Nâng cấp engine dsh

Engine ghim trong [engine/package.json](../../../engine/package.json). Upstream đang ở giai đoạn
`rc`, API còn đổi nhiều — nên quy trình này luôn làm trên **nhánh riêng**, để một bản nâng cấp hỏng
không kéo theo gì cả.

## 1. Chuẩn bị

```bash
git status --porcelain          # phải rỗng
```

Còn thay đổi chưa commit → dừng lại, hỏi chủ dự án muốn commit hay tạm cất. Không tự quyết.

Rồi chạy `/kiem-tra-ranh-gioi`. Nâng cấp khi mã gốc đã bị đụng là cách chắc chắn để gặp xung đột
không giải thích được.

## 2. Xem có gì mới

```bash
npm view @deepseek-ai/dsh versions --json | tail -20
npm view @deepseek-ai/dsh version                    # bản mới nhất
grep '"@deepseek-ai/dsh"' engine/package.json        # bản đang dùng
```

Nếu có bản clone tra cứu, xem phần đã đổi:

```bash
cd _upstream_dsh && git pull --ff-only && git log --oneline <cũ>..<mới> | head -40
```

Đọc để **hiểu ý đồ**, không phải để chép tay. Chú ý riêng những thay đổi chạm vào slot giao diện mà
`plugins/` đang dùng.

## 3. Nâng

```bash
git checkout -b nang-cap-engine-<phiên-bản>
```

Đổi **cả ba số** trong [engine/package.json](../../../engine/package.json) — `dsh`,
`dsh-client-ui-primitives`, `dsh-client-ui-slots` — sang cùng một phiên bản. Bỏ sót hai gói sau thì
không có gì báo: npm vẫn cài, typecheck vẫn sạch, nhưng plugin biên dịch theo hợp đồng slot cũ trong
khi engine phục vụ hợp đồng mới. Rồi:

```bash
npm run engine:install
```

Lệnh này ghi vào `engine/node_modules/` — đó là ngoại lệ hợp lệ duy nhất, hook đã chừa sẵn.

## 4. Kiểm chứng theo thứ tự

```bash
npm run typecheck    # 1. code còn hợp lệ không
npm run dev          # 2. app còn mở được không
```

Rồi bấm thử thật, theo thứ tự này:

1. Mở app, tạo một phiên mới
2. Gửi một tin nhắn, xem có trả lời không
3. Mở **từng tính năng trong `plugins/`** — đây là chỗ dễ vỡ nhất
4. Kiểm tra khay hệ thống và thông báo còn hoạt động

Typecheck báo lỗi → đưa lỗi cho AI sửa, đó là việc bình thường sau mỗi lần nâng. Nhưng **không sửa
bằng cách đụng vào mã gốc** — nếu thấy chỉ còn cách đó, dừng lại và báo.

## 5. Quyết định

| Kết quả | Làm gì |
|---|---|
| Mọi thứ xanh | `git checkout main && git merge nang-cap-engine-<v>` rồi `/commit` |
| Có lỗi sửa được | Sửa trên nhánh, kiểm lại từ bước 4 |
| Hỏng nặng | `git checkout main` — coi như chưa có gì xảy ra. Nhánh cứ để đó |

Ghi vào [MY-CHANGES.md](../../../MY-CHANGES.md) nếu bản nâng cấp có gì đáng nhớ: tính năng nào của
ta phải sửa theo, slot nào đổi tên, thứ gì phải bỏ.

## 6. Báo cáo cho chủ dự án

Bằng ngôn ngữ người dùng, ba ý:

- **Người dùng app được thêm gì** từ bản mới này
- **Có gì của mình phải sửa theo không**, và đã sửa xong chưa
- **Có gì hỏng chưa xử lý được không**

Không liệt kê tên file, không dán log. Nếu đã bỏ nhánh vì hỏng, nói thẳng là chưa nâng được và vì sao.

## Nhịp độ

Không có cơ chế nhắc tự động — chủ dự án tự quyết khi nào làm. Nhưng nguyên tắc thì cố định:
**nâng thường xuyên, mỗi lần một ít.** Dồn vài tháng rồi nâng một lần là tình huống khó gỡ nhất,
nhất là khi upstream còn ở `rc`.
