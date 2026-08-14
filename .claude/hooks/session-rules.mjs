/**
 * Nhắc lại luật cốt lõi ở đầu mỗi phiên làm việc.
 *
 * Chạy ở SessionStart. CLAUDE.md đã được nạp tự động, nhưng trong một phiên dài
 * nó có thể trôi khỏi ngữ cảnh; bản rút gọn này neo lại những điều không được quên.
 */
const RULES = `LUẬT DỰ ÁN HARNESS DESKTOP (bản rút gọn — bản đầy đủ ở CLAUDE.md):

1. Trả lời bằng tiếng Việt.
2. KHÔNG ghi vào _upstream_dsh/, node_modules/, engine/node_modules/, runtime/.
   Hệ thống đã chặn cứng. Bị chặn thì dừng lại và hỏi, không tìm đường đi vòng.
3. Tính năng riêng đặt trong plugins/<tên>/, không rải vào src/main/.
   src/main/ chỉ dành cho lớp vỏ: cửa sổ, khay hệ thống, thông báo, vòng đời tiến trình.
4. Giao diện CHỈ được cộng thêm vào các vị trí upstream chừa sẵn
   (shell.overlay, sidebar.footer.action, conversation.view, settings.section,
   conversation.input.*, conversation.session.header.actions, ...).
   CẤM đăng ký vào sidebar, conversation, details, conversation.session,
   conversation.session.header — đó là thay thế cả vùng và sẽ mất mọi cập nhật
   tương lai của vùng đó mà không có lỗi nào báo.
5. Mỗi lần đụng giao diện, nói rõ đang ở mức 1 (cộng thêm), mức 2 (chen có chọn
   lọc) hay mức 3 (thay thế — cấm).
6. Không sửa CSS của upstream; ghi đè biến --dsw-* trong CSS của mình.
7. Việc đáng nhớ thì ghi một dòng vào MY-CHANGES.md.

Chủ dự án không đọc code: giải thích theo hướng người dùng app sẽ thấy gì, và hỏi
trước khi làm những việc không hoàn tác được.`

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: RULES },
  suppressOutput: true,
}))
