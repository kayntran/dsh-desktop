---
description: Commit thay đổi rồi đẩy lên GitHub, sau khi đã kiểm lỗi.
argument-hint: "[ghi chú thêm cho message] hoặc 'skip' để bỏ bước kiểm tra"
allowed-tools: Bash(git status *), Bash(git diff *), Bash(git log *), Bash(git add *), Bash(git commit *), Bash(git push *), Bash(git rev-parse *), Bash(npm run typecheck)
---

# Commit và đẩy lên GitHub

## Bối cảnh (nạp sẵn)

- Nhánh hiện tại: !`git rev-parse --abbrev-ref HEAD`
- Trạng thái: !`git status --porcelain`
- Đã stage: !`git diff --cached --stat`
- Chưa stage: !`git diff --stat`
- 10 commit gần nhất (để bắt chước đúng giọng văn repo): !`git log --oneline -10`

## 1. Kiểm tra trước khi commit

Bỏ qua nếu user gõ `skip`.

- Có sửa file `.ts` → `npm run typecheck`, phải sạch.
- Fail thì **dừng lại, báo lỗi, không commit.** Đẩy code hỏng lên là thứ tốn thời gian nhất để dọn.

## 2. Chọn file để stage

- ⛔ **Không stage secret**: `**/.env*`, `*.pem`, `*.key`, file chứa token. Chúng đã gitignore —
  nếu thấy hiện ra thì **báo user**, đừng thêm.

  Kho này **public**: mọi thứ commit vào là công khai vĩnh viễn, kể cả sau khi xoá. Rà kỹ hơn bình
  thường.
- ⛔ **Không stage rác tạm**: file thử ở gốc repo, ảnh chụp màn hình, file scratch.
- ⛔ **Không bao giờ stage** `_upstream_dsh/`, `node_modules/`, `runtime/`, `dist/`, `release/`.
  Chúng đã gitignore; nếu hiện ra thì `.gitignore` đã hỏng — báo user thay vì tự sửa.
- File đang dở mà **user sửa chứ không phải mình sửa** thì hỏi trước khi gộp vào commit.

## 3. Viết commit message

Bắt chước giọng trong `git log` ở trên: **tiếng Việt, câu đầu nói cái gì đổi**, không liệt kê tên file.

Nói **cái gì đổi và vì sao nó quan trọng**:

- Tốt: `Nút xuất báo cáo ở đầu khung hội thoại, cắm vào conversation.session.header.actions`
- Tệ: `cap nhat plugins va engine.ts`

Thay đổi lớn thì viết thêm phần thân giải thích **vì sao**, không chỉ *cái gì*. Dùng heredoc cho
message nhiều dòng. Kết thúc bằng dòng:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

## 4. Ghi sổ nếu đáng nhớ

Commit này thêm tính năng, đổi kiến trúc, hay dùng một ngoại lệ so với [CLAUDE.md](../../CLAUDE.md)?
→ thêm một dòng vào [MY-CHANGES.md](../../MY-CHANGES.md) và stage cùng.

Sửa vặt thì bỏ qua bước này — sổ đầy chuyện vụn thì không ai đọc nữa.

## 5. Đẩy lên

```bash
git push
```

Đang ở nhánh khác `main` mà chưa có nhánh trên GitHub thì `git push -u origin <nhánh>`.

Push treo quá lâu = thiếu thông tin đăng nhập → `gh auth setup-git` rồi thử lại.

## 6. Báo cáo

Một câu bằng ngôn ngữ người dùng: đã commit gì, đã đẩy lên chưa. Không dán lại hash hay tên file.
