/**
 * Log của lớp vỏ app — tách khỏi log của engine.
 *
 * App phát hành cho nhiều người, và những sự cố hay gặp nhất ("thông báo không
 * hiện", "mở lên trắng bóc") không để lại dấu vết nào trên màn hình. Không có
 * file này thì mọi báo lỗi của người dùng đều thành phỏng đoán.
 * @module
 */

import { app } from 'electron'
import { appendFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Cắt log khi vượt ngưỡng này, để nó không phình vô hạn trên máy chạy dài ngày. */
const MAX_BYTES = 1_000_000

/** Đường dẫn log của lớp vỏ, để menu khay mở ra được. */
export function shellLogPath(): string {
  return join(app.getPath('userData'), 'shell.log')
}

/** Ghi một dòng kèm dấu thời gian. Không bao giờ ném lỗi. */
export function logShell(message: string): void {
  const path = shellLogPath()
  try {
    if ((statSync(path, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) writeFileSync(path, '')
    appendFileSync(path, `${new Date().toISOString()}  ${message}\n`)
  } catch {
    // Không ghi được log thì cũng không được làm hỏng việc đang chạy.
  }
}
