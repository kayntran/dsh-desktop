---
name: kiem-tra-ranh-gioi
description: Rà soát xem mã gốc của DeepSeek còn nguyên vẹn không, có chỗ nào đã lệch khỏi luật dự án mà chưa ghi sổ không, và các hook bảo vệ còn sống không. Kích hoạt khi user hỏi có gì lệch không, muốn kiểm tra ranh giới, kiểm tra mã gốc, hoặc trước mỗi lần nâng cấp engine.
---

# Kiểm tra ranh giới

Chạy hết sáu mục, rồi báo cáo bằng một bảng. Đừng dừng ở mục đầu tiên phát hiện vấn đề — chủ dự án
cần thấy bức tranh đầy đủ, không phải một lỗi lẻ.

## 1. Bản clone tra cứu còn sạch không

```bash
cd _upstream_dsh && git status --porcelain && git log --oneline -1
```

Rỗng = chưa ai đụng. Có dòng nào = đã bị sửa, **đây là vấn đề nghiêm trọng**: báo ngay, liệt kê file,
và đề nghị `git checkout -- <file>` để trả về nguyên bản.

Thư mục không tồn tại = chỉ là chưa clone về, không phải lỗi.

## 2. Engine cài từ npm còn nguyên không

```bash
find engine/node_modules/@deepseek-ai -type f -printf "%TY-%Tm-%Td %TH:%TM\n" | sort | uniq -c
```

**Một mốc thời gian duy nhất** = chưa ai sửa sau khi cài. Nhiều mốc = có file bị đụng sau đó; tìm ra
bằng cách sắp theo thời gian giảm dần và xem file mới nhất.

Đây là bằng chứng mạnh chứ không tuyệt đối (đổi mốc thời gian thì qua mặt được), nhưng đủ dùng.

## 3. Phiên bản có khớp không

```bash
grep '"@deepseek-ai/dsh"' engine/package.json
grep -m1 '"version"' engine/node_modules/@deepseek-ai/dsh/package.json
```

Lệch nhau = đang chạy một bản khác với bản đã khai. Chạy `npm run engine:install` để đồng bộ lại.

## 4. Code của mình có nằm đúng chỗ không

```bash
git ls-files \
  | grep -vE '^(src/main/|plugins/|resources/|scripts/|\.claude/|\.github/)' \
  | grep -vE '^(\.gitignore|LICENSE|NOTICE\.md|README\.md|README\.vi\.md|CLAUDE\.md|MY-CHANGES\.md|package\.json|package-lock\.json|tsconfig\.json|electron-builder\.yml|engine/package\.json|engine/package-lock\.json)$'
```

Kết quả phải rỗng. Danh sách file ở gốc được liệt kê **theo tên** chứ không lọc theo phần mở rộng —
lọc theo đuôi file thì `.gitignore` và `LICENSE` lọt qua, và quan trọng hơn là một file lạ mới xuất
hiện ở gốc sẽ không bị phát hiện.

Có kết quả = có thứ đặt sai chỗ; hỏi chủ dự án nên dời vào `plugins/` hay đó là ngoại lệ có chủ ý.

## 5. Có chỗ nào chiếm slot bị cấm không

```bash
grep -rn "register(" plugins/ --include=*.ts --include=*.tsx 2>/dev/null | \
  grep -E "'(sidebar|conversation|details|conversation\.session|conversation\.session\.header|conversation\.details\.tool|conversation\.composer\.bar)'"
```

Rỗng = chưa có mức 3 nào. Có kết quả = **đã có vùng giao diện ngừng nhận cập nhật**. Đối chiếu với
[MY-CHANGES.md](../../../MY-CHANGES.md): nếu chủ dự án đã cho phép và có ghi sổ thì đúng quy trình;
nếu không có trong sổ thì đây là vi phạm, phải báo.

Danh sách slot cấm đầy đủ ở `.claude/rules/ui-slots.md`.

## 6. Hàng rào còn sống không

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'));console.log('settings hợp lệ')"
ls .claude/hooks/
echo '{"tool_name":"Edit","tool_input":{"file_path":"_upstream_dsh/README.md"}}' | node .claude/hooks/guard-upstream.mjs
```

Lệnh cuối **phải** in ra JSON có `"permissionDecision":"deny"`. Không in gì = hàng rào đã hỏng, và
mọi thứ vẫn trông bình thường — đây đúng là loại hỏng im lặng mà cả bộ luật này dựng ra để chống.

## Báo cáo

| Mục | Kết quả |
|---|---|
| Bản clone tra cứu | sạch / đã bị sửa (kèm danh sách) |
| Engine cài từ npm | nguyên vẹn / có file bị đụng |
| Phiên bản | khớp / lệch |
| Vị trí code | đúng chỗ / có file lạ |
| Slot bị cấm | không có / có (đã ghi sổ hay chưa) |
| Hàng rào | còn sống / đã hỏng |

Rồi một câu kết bằng ngôn ngữ người dùng: *app còn nhận được cập nhật của DeepSeek bình thường
không, hay đã có chỗ tự tách ra.*

Nếu mọi mục đều sạch, nói thẳng là sạch. Đừng thêm cảnh báo cho có.
