/**
 * Ô chứa sân khấu webview — chỗ duy nhất cây cầu và panel gặp nhau.
 *
 * ## Vì sao phải là một cái ô, không phải một tham chiếu
 *
 * Cây cầu mở trong `apply()`, tức là **trước** khi panel được dựng: slot của
 * upstream chỉ mount component khi giao diện tới lượt vẽ nó. Nên lúc gọi
 * `openBridge()` chưa có sân khấu nào tồn tại để mà chuyền vào.
 *
 * Nặng hơn: slot có thể **dựng lại** component bất cứ lúc nào. Mỗi lần dựng lại
 * là một sân khấu mới, và sân khấu cũ bị `destroy()`. Nếu cầu giữ cứng một tham
 * chiếu thì từ giây đó nó cầm một sân khấu đã chết — không lỗi nào báo, chỉ là
 * mọi lệnh của agent bắt đầu im lặng thất bại.
 *
 * Một cái ô mutable giải quyết cả hai: cầu cầm ô, panel ghi vào ô lúc mount và
 * xoá lúc unmount, và cầu luôn đọc ra cái đang thật sự sống.
 *
 * ## Vì sao ô rỗng lại có câu lỗi riêng
 *
 * Ô rỗng là một trạng thái **bình thường**, không phải sự cố: người dùng chưa
 * mở panel Browser lần nào. Agent cần phân biệt được nó với "sân khấu hỏng", vì
 * cách xử lý khác hẳn nhau — cái trước chỉ cần mở một tab, cái sau là bug.
 * @module
 */

import type { Stage } from './browser-stage.ts'

/** Ô chứa sân khấu đang sống, nếu có. */
export interface StageHolder {
  /** Sân khấu đang sống, hoặc `undefined` khi panel chưa mount. */
  current: Stage | undefined
  /**
   * Lấy sân khấu, hoặc ném một câu người đọc hiểu được.
   * @returns sân khấu đang sống.
   * @throws khi panel chưa được dựng lần nào.
   */
  require: () => Stage
}

/**
 * Dựng một ô chứa rỗng.
 *
 * Gọi trong `apply()` chứ không ở cấp module: một ô ở cấp module là singleton
 * trá hình, sẽ mang sân khấu của lần nạp plugin trước sang bản mới.
 * @returns ô chứa.
 */
export function createStageHolder(): StageHolder {
  const holder: StageHolder = {
    current: undefined,
    require: () => {
      if (holder.current === undefined) {
        throw new Error(
          'No browser panel has been built in the app window yet. '
          + 'Open the right-hand panel (the button at the top of the session) and try again.',
        )
      }
      return holder.current
    },
  }
  return holder
}
