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
