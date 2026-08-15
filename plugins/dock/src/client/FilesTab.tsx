/**
 * Tab Files: cây thư mục của workspace phiên hiện tại, cộng ô xem nội dung.
 *
 * Chỉ đọc, giống app tham chiếu. Không có file watcher: cây tải khi mở thư mục
 * và khi bấm Tải lại. Agent sửa file thì cây không tự cập nhật — nói ra ở đây
 * để sau này không ai đi tìm một cái watcher không tồn tại.
 *
 * Cây dựng phẳng chứ không đệ quy component: mỗi hàng biết độ sâu của nó và tự
 * thụt vào. Cách này giữ số component không đổi theo độ sâu, và về sau muốn
 * ảo hoá danh sách cho thư mục khổng lồ thì không phải viết lại.
 * @module
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconFolderClose16,
  IconFolderOpen16,
  IconLoadingOutline16,
  IconRefreshOutline16,
  ReadBlock,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { fileIcon } from './file-icon.tsx'

/** Trần số dòng đưa vào DOM. File dài hơn vẫn xem được phần đầu. */
const MAX_LINES = 3000

interface DirEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  size?: number
}

interface FileContent {
  path: string
  size?: number
  truncated?: boolean
  text?: string
  binary?: boolean
}

/** Nối một đoạn đường dẫn. Windows nhận cả `/`, và server chuẩn hoá lại. */
function join(parent: string, name: string): string {
  return parent.endsWith('/') || parent.endsWith('\\') ? `${parent}${name}` : `${parent}/${name}`
}

/** Thư mục trước, file sau, trong mỗi nhóm thì theo bảng chữ cái. */
function sortEntries(entries: readonly DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if ((a.type === 'directory') !== (b.type === 'directory')) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/** Một hàng đã tính sẵn vị trí trong cây. */
interface Row {
  path: string
  name: string
  type: DirEntry['type']
  depth: number
}

export interface FilesTabProps {
  /** Thư mục gốc — đường dẫn workspace, đúng nguyên văn như registry giữ. */
  root: string | undefined
  /** Đang bị che vì pane khác đang hiện. Không tháo, chỉ ẩn — giữ nguyên cây
      đang mở và vị trí cuộn khi người dùng quay lại. */
  an: boolean
}

/**
 * Thân tab Files.
 * @param props - xem {@link FilesTabProps}.
 * @returns phần tử tab.
 */
export function FilesTab({ root, an }: FilesTabProps): React.JSX.Element {
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = useState<readonly string[]>([])
  const [dangTai, setDangTai] = useState<readonly string[]>([])
  const [current, setCurrent] = useState<string | undefined>(undefined)
  const [content, setContent] = useState<FileContent | undefined>(undefined)
  const [loi, setLoi] = useState<string | undefined>(undefined)

  const load = useCallback(async (path: string): Promise<void> => {
    if (root === undefined) return
    setDangTai((cu) => [...cu, path])
    try {
      const res = await fetch(`/hdw/fs/list?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`)
      const body = await res.json() as { entries?: DirEntry[], ly_do?: string }
      if (!res.ok) { setLoi(body.ly_do ?? `lỗi ${String(res.status)}`); return }
      setLoi(undefined)
      setChildren((cu) => ({ ...cu, [path]: sortEntries(body.entries ?? []) }))
    } catch (error) {
      setLoi(error instanceof Error ? error.message : 'không gọi được engine')
    } finally {
      setDangTai((cu) => cu.filter((p) => p !== path))
    }
  }, [root])

  // Đổi workspace thì bỏ hết trạng thái cũ và nạp lại từ gốc — giữ lại cây của
  // thư mục khác là cách chắc chắn để hiện nhầm dữ liệu.
  useEffect(() => {
    setChildren({})
    setExpanded([])
    setCurrent(undefined)
    setContent(undefined)
    setLoi(undefined)
    if (root !== undefined) void load(root)
  }, [root, load])

  const toggleDir = useCallback((path: string): void => {
    setExpanded((cu) => {
      if (cu.includes(path)) return cu.filter((p) => p !== path)
      if (children[path] === undefined) void load(path)
      return [...cu, path]
    })
  }, [children, load])

  const openFile = useCallback(async (path: string): Promise<void> => {
    if (root === undefined) return
    setCurrent(path)
    setContent(undefined)
    try {
      const res = await fetch(`/hdw/fs/read?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`)
      const body = await res.json() as FileContent & { ly_do?: string }
      if (!res.ok) { setLoi(body.ly_do ?? `lỗi ${String(res.status)}`); return }
      setLoi(undefined)
      setContent(body)
    } catch (error) {
      setLoi(error instanceof Error ? error.message : 'không gọi được engine')
    }
  }, [root])

  // Duyệt cây theo chiều sâu, chỉ đi vào những thư mục đang mở.
  const rows = useMemo((): Row[] => {
    if (root === undefined) return []
    const out: Row[] = []
    const walk = (dir: string, depth: number): void => {
      for (const entry of children[dir] ?? []) {
        const path = join(dir, entry.name)
        out.push({ path, name: entry.name, type: entry.type, depth })
        if (entry.type === 'directory' && expanded.includes(path)) walk(path, depth + 1)
      }
    }
    walk(root, 0)
    return out
  }, [root, children, expanded])

  if (root === undefined) {
    return <div className="hdw-empty" hidden={an}>Chưa có phiên nào đang mở, nên chưa biết lấy thư mục nào. Mở một phiên rồi quay lại.</div>
  }

  return (
    <div className="hdw-files" hidden={an}>
      <div className="hdw-tabbar">
        <span className="hdw-note" style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {root}
        </span>
        <Tooltip label="Tải lại" side="bottom">
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefreshOutline16 />}
            aria-label="Tải lại"
            onClick={() => {
              setChildren({})
              setExpanded([])
              void load(root)
            }}
          />
        </Tooltip>
      </div>

      {loi !== undefined && <div className="hdw-note">Không đọc được: {loi}</div>}

      <div className="hdw-tree">
        {rows.map((row) => (
          <button
            key={row.path}
            type="button"
            className="hdw-row"
            data-current={row.path === current}
            style={{ paddingLeft: `${String(8 + row.depth * 14)}px` }}
            onClick={() => {
              if (row.type === 'directory') toggleDir(row.path)
              else void openFile(row.path)
            }}
          >
            <span className="hdw-row-icon">
              {dangTai.includes(row.path)
                ? <IconLoadingOutline16 />
                : row.type === 'directory'
                  ? (expanded.includes(row.path) ? <IconFolderOpen16 /> : <IconFolderClose16 />)
                  : fileIcon(row.name)}
            </span>
            <span className="hdw-row-name">{row.name}</span>
          </button>
        ))}
        {rows.length === 0 && dangTai.length === 0 && <div className="hdw-note">Thư mục trống.</div>}
      </div>

      {current !== undefined && (
        <div className="hdw-viewer">
          {content === undefined
            ? <div className="hdw-note">Đang mở…</div>
            : content.binary === true
              ? <div className="hdw-note">Không xem trước được kiểu file này.</div>
              : <FileView content={content} />}
        </div>
      )}
    </div>
  )
}

/** Nội dung file, dựng bằng đúng component upstream dùng để hiện file. */
function FileView({ content }: { content: FileContent }): React.JSX.Element {
  const all = (content.text ?? '').split('\n')
  const lines = all.slice(0, MAX_LINES).map((text, i) => ({ number: i + 1, text }))
  const ext = content.path.split('.').pop()
  return (
    <>
      <ReadBlock
        label={content.path}
        lines={lines}
        totalLines={all.length}
        lang={ext}
        maxLines={lines.length}
      />
      {content.truncated === true && (
        <div className="hdw-note">File lớn — chỉ hiện phần đầu.</div>
      )}
    </>
  )
}
