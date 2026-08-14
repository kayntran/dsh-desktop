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
