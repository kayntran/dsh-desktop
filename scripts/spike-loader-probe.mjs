/**
 * Đầu đo cây plugin — CHỈ dùng cho `npm run spike:loader`, không đóng gói vào app.
 *
 * Engine nạp file này như một plugin thường (patch tạm do bộ đo sinh ra, trỏ
 * bằng đường dẫn `file://` tuyệt đối). Nó mở ba route HTTP để bộ đo đứng ngoài
 * tiến trình engine đọc và sửa cây plugin — thứ duy nhất không đo được từ ngoài,
 * vì `loader` là service trong tiến trình và upstream cố ý không mở nửa ghi.
 *
 * Không có rào tin cậy ở đây: đầu đo chỉ sống trong lúc chạy spike, và bộ đo là
 * client duy nhất của nó. Đừng bao giờ nạp file này trong app thật.
 * @module
 */

import { IncomingMessage, ServerResponse } from 'node:http'

export const name = 'spike-loader-probe'

export const inject = ['loader', 'webServer']

/**
 * @param {ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(text)),
  })
  res.end(text)
}

/**
 * @param {IncomingMessage} req
 * @returns {URL}
 */
function requestUrl(req) {
  return new URL(req.url ?? '/', 'http://127.0.0.1')
}

/** Ảnh chụp một entry, đủ để bộ đo chấm mà không phải đoán. */
function snapshot(entry) {
  const tree = entry.parent.tree
  return {
    id: entry.id,
    moduleName: entry.options.name,
    group: entry.options.group === true,
    // `options.disabled` là thứ NẰM TRONG cấu hình (sẽ được ghi ra file);
    // `entry.disabled` là hiệu lực thật, tính cả cha bị tắt.
    rawDisabled: entry.options.disabled ?? null,
    effectiveDisabled: entry.disabled === true,
    fiberState: entry.fiber === undefined ? null : entry.fiber.state,
    // Tree nào sở hữu entry: có `filename` tức là một Include gắn với file trên
    // đĩa, và đó là file mà `write()` sẽ ghi vào.
    treeFile: typeof tree.filename === 'string' ? tree.filename : null,
  }
}

export function apply(ctx) {
  ctx.effect(() => {
    const offList = ctx.webServer.register({
      kind: 'exact',
      path: '/spike/loader/list',
      handler: (req, res) => {
        const entries = []
        for (const entry of ctx.loader.entries()) entries.push(snapshot(entry))
        json(res, 200, { entries })
      },
    })

    const offUpdate = ctx.webServer.register({
      kind: 'exact',
      path: '/spike/loader/update',
      handler: async (req, res) => {
        const url = requestUrl(req)
        const id = url.searchParams.get('id')
        const raw = url.searchParams.get('disabled')
        if (id === null || raw === null) {
          json(res, 400, { ok: false, reason: 'thiếu id hoặc disabled' })
          return
        }
        // Ba giá trị cần thử riêng: `true` để tắt, `false` và `null` là hai cách
        // bật lại khác nhau — upstream ghi `null` khi muốn xoá trường khỏi cấu hình.
        const disabled = raw === 'null' ? null : raw === 'true'
        const started = Date.now()
        try {
          await ctx.loader.update(id, { disabled })
          json(res, 200, { ok: true, ms: Date.now() - started, entry: snapshot(ctx.loader.resolve(id)) })
        } catch (error) {
          json(res, 200, { ok: false, ms: Date.now() - started, reason: String(error) })
        }
      },
    })

    // Tín hiệu sống trên stdout engine: bộ đo dùng nó để phân biệt "đầu đo chưa
    // chạy" với "đầu đo chạy mà trả lời sai".
    console.log('spike-loader-probe: đầu đo đã chạy')
    return () => { offList(); offUpdate() }
  }, 'spike-loader-probe: route đo cây plugin')
}
