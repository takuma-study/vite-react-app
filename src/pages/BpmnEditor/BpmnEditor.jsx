import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import './BpmnEditor.css'

const STORAGE_KEY = 'bpmn-editor-data'
const CANVAS_WIDTH = 1800
const CANVAS_HEIGHT = 1100
const DRAG_DATA_TYPE = 'application/bpmn-tool'
const RATIO_MIN = 0.05
const RATIO_MAX = 0.95

const ELEMENT_DEFAULTS = {
  startEvent: { width: 40, height: 40, label: '開始' },
  endEvent: { width: 40, height: 40, label: '終了' },
  task: { width: 120, height: 60, label: 'タスク' },
  gateway: { width: 50, height: 50, label: '' },
}

const TOOLS = [
  { type: 'startEvent', label: '開始イベント' },
  { type: 'endEvent', label: '終了イベント' },
  { type: 'task', label: 'タスク' },
  { type: 'gateway', label: 'ゲートウェイ' },
]

let idCounter = 0
function nextId(prefix) {
  idCounter += 1
  return `${prefix}_${Date.now()}_${idCounter}`
}

function ToolIcon({ type }) {
  switch (type) {
    case 'startEvent':
      return (
        <svg className="bpmn-tool-icon" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
    case 'endEvent':
      return (
        <svg className="bpmn-tool-icon" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="3" />
        </svg>
      )
    case 'task':
      return (
        <svg className="bpmn-tool-icon" viewBox="0 0 24 24">
          <rect x="2" y="5" width="20" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
    case 'gateway':
      return (
        <svg className="bpmn-tool-icon" viewBox="0 0 24 24">
          <polygon points="12,2 22,12 12,22 2,12" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
    default:
      return null
  }
}

function getBoundaryPoint(el, towardX, towardY) {
  const cx = el.x + el.width / 2
  const cy = el.y + el.height / 2
  const dx = towardX - cx
  const dy = towardY - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }

  if (el.type === 'startEvent' || el.type === 'endEvent') {
    const r = el.width / 2
    const dist = Math.sqrt(dx * dx + dy * dy)
    const scale = r / dist
    return { x: cx + dx * scale, y: cy + dy * scale }
  }

  if (el.type === 'gateway') {
    const hw = el.width / 2
    const hh = el.height / 2
    const scale = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
    return { x: cx + dx * scale, y: cy + dy * scale }
  }

  const hw = el.width / 2
  const hh = el.height / 2
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh)
  return { x: cx + dx * scale, y: cy + dy * scale }
}

// Boundary point straight out from the element's center in one cardinal direction.
function getSidePoint(el, side) {
  const cx = el.x + el.width / 2
  const cy = el.y + el.height / 2
  switch (side) {
    case 'right':
      return getBoundaryPoint(el, cx + 1000, cy)
    case 'left':
      return getBoundaryPoint(el, cx - 1000, cy)
    case 'down':
      return getBoundaryPoint(el, cx, cy + 1000)
    default:
      return getBoundaryPoint(el, cx, cy - 1000)
  }
}

// Picks perpendicular exit/entry sides for an elbow connector, PowerPoint-style:
// shapes offset mostly horizontally connect left/right, mostly vertically connect top/bottom.
function getElbowLayout(from, to) {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  const dx = toCenter.x - fromCenter.x
  const dy = toCenter.y - fromCenter.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    const fromSide = dx >= 0 ? 'right' : 'left'
    const toSide = dx >= 0 ? 'left' : 'right'
    return { axis: 'x', fromPoint: getSidePoint(from, fromSide), toPoint: getSidePoint(to, toSide) }
  }
  const fromSide = dy >= 0 ? 'down' : 'up'
  const toSide = dy >= 0 ? 'up' : 'down'
  return { axis: 'y', fromPoint: getSidePoint(from, fromSide), toPoint: getSidePoint(to, toSide) }
}

function getElbowSegments(axis, fromPoint, toPoint, ratio) {
  if (axis === 'x') {
    const midX = fromPoint.x + (toPoint.x - fromPoint.x) * ratio
    return [fromPoint, { x: midX, y: fromPoint.y }, { x: midX, y: toPoint.y }, toPoint]
  }
  const midY = fromPoint.y + (toPoint.y - fromPoint.y) * ratio
  return [fromPoint, { x: fromPoint.x, y: midY }, { x: toPoint.x, y: midY }, toPoint]
}

// Returns render points + the adjustable "step" midpoint (elbow style) or line midpoint (straight style).
function getConnectionGeometry(conn, from, to) {
  if (conn.style === 'elbow') {
    const { axis, fromPoint, toPoint } = getElbowLayout(from, to)
    const ratio = conn.bendRatio ?? 0.5
    const points = getElbowSegments(axis, fromPoint, toPoint, ratio)
    const mid =
      axis === 'x'
        ? { x: fromPoint.x + (toPoint.x - fromPoint.x) * ratio, y: (fromPoint.y + toPoint.y) / 2 }
        : { x: (fromPoint.x + toPoint.x) / 2, y: fromPoint.y + (toPoint.y - fromPoint.y) * ratio }
    return { points, mid, axis }
  }
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  const p1 = getBoundaryPoint(from, toCenter.x, toCenter.y)
  const p2 = getBoundaryPoint(to, fromCenter.x, fromCenter.y)
  return { points: [p1, p2], mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, axis: null }
}

function loadInitialState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed.elements || !parsed.connections) return null
    return parsed
  } catch {
    return null
  }
}

function BpmnEditor() {
  const initial = loadInitialState()
  const [elements, setElements] = useState(initial?.elements ?? [])
  const [connections, setConnections] = useState(initial?.connections ?? [])
  const [connectMode, setConnectMode] = useState(false)
  const [connectStyle, setConnectStyle] = useState('straight')
  const [connectSource, setConnectSource] = useState(null)
  const [selection, setSelection] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editingKind, setEditingKind] = useState(null)
  const [editingValue, setEditingValue] = useState('')
  const [drag, setDrag] = useState(null)
  const [dropHover, setDropHover] = useState(false)
  const [fileInputKey, setFileInputKey] = useState(0)
  const svgRef = useRef(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ elements, connections }))
  }, [elements, connections])

  useEffect(() => {
    if (!drag) return undefined
    let moved = false

    function onMove(e) {
      const rect = svgRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      if (!moved && Math.hypot(x - drag.startX, y - drag.startY) >= 3) {
        moved = true
      }

      if (drag.kind === 'elbow') {
        if (!moved) return
        const coord = drag.axis === 'x' ? x : y
        const start = drag.axis === 'x' ? drag.from.x : drag.from.y
        const end = drag.axis === 'x' ? drag.to.x : drag.to.y
        const span = end - start
        let ratio = span !== 0 ? (coord - start) / span : 0.5
        ratio = Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio))
        setConnections((prev) =>
          prev.map((c) => (c.id === drag.id ? { ...c, style: 'elbow', bendRatio: ratio } : c)),
        )
        return
      }

      setElements((prev) =>
        prev.map((el) =>
          el.id === drag.id ? { ...el, x: x - drag.offsetX, y: y - drag.offsetY } : el,
        ),
      )
    }
    function onUp() {
      // A drag that ends over empty canvas still fires a native click afterward;
      // suppress the next background click so it doesn't clear the selection we just made.
      if (moved) suppressClickRef.current = true
      setDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (!selection) return
      e.preventDefault()
      deleteSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])

  function deleteSelection() {
    if (!selection) return
    if (selection.kind === 'element') {
      setElements((prev) => prev.filter((el) => el.id !== selection.id))
      setConnections((prev) => prev.filter((c) => c.from !== selection.id && c.to !== selection.id))
    } else {
      setConnections((prev) => prev.filter((c) => c.id !== selection.id))
    }
    setSelection(null)
  }

  function placeElement(type, x, y) {
    const defaults = ELEMENT_DEFAULTS[type]
    const newEl = {
      id: nextId(type),
      type,
      x: x - defaults.width / 2,
      y: y - defaults.height / 2,
      width: defaults.width,
      height: defaults.height,
      label: defaults.label,
    }
    setElements((prev) => [...prev, newEl])
    setSelection({ kind: 'element', id: newEl.id })
  }

  function createConnection(fromId, toId) {
    const exists = connections.some((c) => c.from === fromId && c.to === toId)
    if (exists || fromId === toId) return
    const newConn = {
      id: nextId('flow'),
      from: fromId,
      to: toId,
      label: '',
      style: connectStyle,
      bendRatio: connectStyle === 'elbow' ? 0.5 : null,
    }
    setConnections((prev) => [...prev, newConn])
  }

  function handleStraighten() {
    if (!selection || selection.kind !== 'connection') return
    setConnections((prev) =>
      prev.map((c) => (c.id === selection.id ? { ...c, style: 'straight', bendRatio: null } : c)),
    )
  }

  function toggleConnectMode(style) {
    setConnectSource(null)
    setSelection(null)
    setConnectMode((prev) => (prev && connectStyle === style ? false : true))
    setConnectStyle(style)
  }

  function handleToolDragStart(e, type) {
    e.dataTransfer.setData(DRAG_DATA_TYPE, type)
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleCanvasDragOver(e) {
    if (!e.dataTransfer.types.includes(DRAG_DATA_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropHover(true)
  }

  function handleCanvasDragLeave() {
    setDropHover(false)
  }

  function handleCanvasDrop(e) {
    const type = e.dataTransfer.getData(DRAG_DATA_TYPE)
    setDropHover(false)
    if (!type || !ELEMENT_DEFAULTS[type]) return
    e.preventDefault()
    const rect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    placeElement(type, x, y)
  }

  function handleCanvasClick(e) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (e.target !== svgRef.current) return
    setSelection(null)
  }

  function handleElementMouseDown(e, el) {
    if (connectMode) return
    e.stopPropagation()
    setSelection({ kind: 'element', id: el.id })
    const rect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setDrag({ kind: 'element', id: el.id, offsetX: x - el.x, offsetY: y - el.y, startX: x, startY: y })
  }

  function handleElementClick(e, el) {
    e.stopPropagation()
    if (connectMode) {
      if (!connectSource) {
        setConnectSource(el.id)
      } else if (connectSource !== el.id) {
        createConnection(connectSource, el.id)
        setConnectSource(null)
      } else {
        setConnectSource(null)
      }
      return
    }
  }

  function handleElementDoubleClick(e, el) {
    e.stopPropagation()
    setEditingId(el.id)
    setEditingKind('element')
    setEditingValue(el.label)
  }

  function handleConnectionMouseDown(e, conn) {
    if (connectMode) return
    e.stopPropagation()
    setSelection({ kind: 'connection', id: conn.id })
    const from = elements.find((el) => el.id === conn.from)
    const to = elements.find((el) => el.id === conn.to)
    if (!from || !to) return
    const { axis, fromPoint, toPoint } = getElbowLayout(from, to)
    const rect = svgRef.current.getBoundingClientRect()
    const startX = e.clientX - rect.left
    const startY = e.clientY - rect.top
    setDrag({ kind: 'elbow', id: conn.id, axis, from: fromPoint, to: toPoint, startX, startY })
  }

  function handleConnectionDoubleClick(e, conn) {
    e.stopPropagation()
    setEditingId(conn.id)
    setEditingKind('connection')
    setEditingValue(conn.label || '')
  }

  function handleElbowHandleDoubleClick(e, connId) {
    e.stopPropagation()
    setConnections((prev) => prev.map((c) => (c.id === connId ? { ...c, style: 'straight', bendRatio: null } : c)))
  }

  function commitEdit() {
    if (editingKind === 'element') {
      setElements((prev) => prev.map((el) => (el.id === editingId ? { ...el, label: editingValue } : el)))
    } else if (editingKind === 'connection') {
      setConnections((prev) => prev.map((c) => (c.id === editingId ? { ...c, label: editingValue } : c)))
    }
    setEditingId(null)
    setEditingKind(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingKind(null)
  }

  function handleExportJson() {
    const data = JSON.stringify({ elements, connections }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'diagram.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleExportSvg() {
    const svgEl = svgRef.current
    const clone = svgEl.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const svgString = new XMLSerializer().serializeToString(clone)
    const blob = new Blob([svgString], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'diagram.svg'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImportJson(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result)
        if (parsed.elements && parsed.connections) {
          setElements(parsed.elements)
          setConnections(parsed.connections)
          setSelection(null)
        } else {
          alert('JSONの形式が不正です')
        }
      } catch {
        alert('無効なJSONファイルです')
      }
    }
    reader.readAsText(file)
    setFileInputKey((k) => k + 1)
  }

  function handleClear() {
    if (elements.length === 0 && connections.length === 0) return
    if (!window.confirm('全ての要素を削除しますか？')) return
    setElements([])
    setConnections([])
    setSelection(null)
  }

  const editingElement = editingKind === 'element' ? elements.find((el) => el.id === editingId) : null
  const editingConnection = editingKind === 'connection' ? connections.find((c) => c.id === editingId) : null
  let connectionEditPos = null
  if (editingConnection) {
    const from = elements.find((el) => el.id === editingConnection.from)
    const to = elements.find((el) => el.id === editingConnection.to)
    if (from && to) {
      const { mid } = getConnectionGeometry(editingConnection, from, to)
      connectionEditPos = { x: mid.x - 40, y: mid.y - 12 }
    }
  }

  const selectedConnection =
    selection?.kind === 'connection' ? connections.find((c) => c.id === selection.id) : null

  return (
    <div className="bpmn-editor">
      <header className="bpmn-topbar">
        <Link to="/" className="bpmn-back">
          ← ホーム
        </Link>
        <div className="bpmn-actions">
          <button type="button" onClick={handleExportJson}>
            JSONエクスポート
          </button>
          <label className="bpmn-import-label">
            JSONインポート
            <input key={fileInputKey} type="file" accept="application/json" onChange={handleImportJson} />
          </label>
          <button type="button" onClick={handleExportSvg}>
            SVGエクスポート
          </button>
          <button type="button" onClick={handleClear}>
            クリア
          </button>
        </div>
      </header>

      {connectMode && (
        <div className="bpmn-hint">
          {connectSource ? '接続先の要素をクリックしてください' : '接続元の要素をクリックしてください'}
        </div>
      )}

      <div className="bpmn-body">
        <aside className="bpmn-sidebar">
          <div className="bpmn-sidebar-section">
            <h3>要素</h3>
            {TOOLS.map((tool) => (
              <div
                key={tool.type}
                className="bpmn-tool-item"
                draggable
                onDragStart={(e) => handleToolDragStart(e, tool.type)}
                title="ドラッグしてキャンバスに配置"
              >
                <ToolIcon type={tool.type} />
                <span>{tool.label}</span>
              </div>
            ))}
          </div>
          <div className="bpmn-sidebar-section">
            <h3>操作</h3>
            <button
              type="button"
              className={`bpmn-tool-action${connectMode && connectStyle === 'straight' ? ' active' : ''}`}
              onClick={() => toggleConnectMode('straight')}
            >
              直線で接続
            </button>
            <button
              type="button"
              className={`bpmn-tool-action${connectMode && connectStyle === 'elbow' ? ' active' : ''}`}
              onClick={() => toggleConnectMode('elbow')}
            >
              カギ線で接続
            </button>
            <button type="button" className="bpmn-tool-action" onClick={deleteSelection} disabled={!selection}>
              削除
            </button>
            <button
              type="button"
              className="bpmn-tool-action"
              onClick={handleStraighten}
              disabled={selectedConnection?.style !== 'elbow'}
            >
              直線に戻す
            </button>
            <p className="bpmn-sidebar-hint">矢印をドラッグするとカギ線に折り曲げられます</p>
          </div>
        </aside>

        <div className="bpmn-canvas-wrapper">
          <svg
            ref={svgRef}
            className={`bpmn-canvas${dropHover ? ' drop-hover' : ''}`}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            onClick={handleCanvasClick}
            onDragOver={handleCanvasDragOver}
            onDragLeave={handleCanvasDragLeave}
            onDrop={handleCanvasDrop}
          >
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="#333" />
              </marker>
            </defs>

            {connections.map((conn) => {
              const from = elements.find((el) => el.id === conn.from)
              const to = elements.find((el) => el.id === conn.to)
              if (!from || !to) return null
              const { points: pointList, mid: labelPos, axis } = getConnectionGeometry(conn, from, to)
              const points = pointList.map((p) => `${p.x},${p.y}`).join(' ')
              const isSelected = selection?.kind === 'connection' && selection.id === conn.id
              const isElbow = conn.style === 'elbow'
              return (
                <g key={conn.id}>
                  <polyline
                    points={points}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                    onMouseDown={(e) => handleConnectionMouseDown(e, conn)}
                    onDoubleClick={(e) => handleConnectionDoubleClick(e, conn)}
                    style={{ cursor: connectMode ? 'default' : 'pointer' }}
                  />
                  <polyline
                    points={points}
                    fill="none"
                    stroke={isSelected ? '#1971ff' : '#333'}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    markerEnd="url(#arrowhead)"
                    style={{ pointerEvents: 'none' }}
                  />
                  {isSelected && isElbow && (
                    <rect
                      x={labelPos.x - 5}
                      y={labelPos.y - 5}
                      width={10}
                      height={10}
                      transform={`rotate(45 ${labelPos.x} ${labelPos.y})`}
                      fill="#1971ff"
                      stroke="#fff"
                      strokeWidth={1.5}
                      onMouseDown={(e) => handleConnectionMouseDown(e, conn)}
                      onDoubleClick={(e) => handleElbowHandleDoubleClick(e, conn.id)}
                      style={{ cursor: axis === 'x' ? 'ew-resize' : 'ns-resize' }}
                    />
                  )}
                  {conn.label && editingId !== conn.id && (
                    <text x={labelPos.x} y={labelPos.y - 10} textAnchor="middle" className="bpmn-flow-label">
                      {conn.label}
                    </text>
                  )}
                </g>
              )
            })}

            {elements.map((el) => {
              const isSelected = selection?.kind === 'element' && selection.id === el.id
              const isConnectSource = connectSource === el.id
              const cx = el.x + el.width / 2
              const cy = el.y + el.height / 2
              const strokeColor = isSelected || isConnectSource ? '#1971ff' : '#333'
              return (
                <g
                  key={el.id}
                  onMouseDown={(e) => handleElementMouseDown(e, el)}
                  onClick={(e) => handleElementClick(e, el)}
                  onDoubleClick={(e) => handleElementDoubleClick(e, el)}
                  style={{ cursor: connectMode ? 'crosshair' : 'move' }}
                >
                  {el.type === 'startEvent' && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={el.width / 2}
                      fill="#fff"
                      stroke={strokeColor}
                      strokeWidth={isSelected || isConnectSource ? 2.5 : 1.5}
                    />
                  )}
                  {el.type === 'endEvent' && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={el.width / 2}
                      fill="#fff"
                      stroke={strokeColor}
                      strokeWidth={isSelected || isConnectSource ? 5 : 3.5}
                    />
                  )}
                  {el.type === 'task' && (
                    <rect
                      x={el.x}
                      y={el.y}
                      width={el.width}
                      height={el.height}
                      rx={8}
                      ry={8}
                      fill="#fff"
                      stroke={strokeColor}
                      strokeWidth={isSelected || isConnectSource ? 2.5 : 1.5}
                    />
                  )}
                  {el.type === 'gateway' && (
                    <polygon
                      points={`${cx},${el.y} ${el.x + el.width},${cy} ${cx},${el.y + el.height} ${el.x},${cy}`}
                      fill="#fff"
                      stroke={strokeColor}
                      strokeWidth={isSelected || isConnectSource ? 2.5 : 1.5}
                    />
                  )}
                  {el.label && editingId !== el.id && (
                    <text
                      x={cx}
                      y={el.type === 'task' ? cy : el.y + el.height + 14}
                      textAnchor="middle"
                      dominantBaseline={el.type === 'task' ? 'middle' : 'auto'}
                      className="bpmn-element-label"
                    >
                      {el.label}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>

          {editingElement && (
            <input
              className="bpmn-label-input"
              style={{
                left: editingElement.x,
                top:
                  editingElement.type === 'task'
                    ? editingElement.y + editingElement.height / 2 - 12
                    : editingElement.y + editingElement.height + 2,
                width: Math.max(editingElement.width, 60),
              }}
              autoFocus
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit()
                if (e.key === 'Escape') cancelEdit()
              }}
            />
          )}

          {editingConnection && connectionEditPos && (
            <input
              className="bpmn-label-input"
              style={{ left: connectionEditPos.x, top: connectionEditPos.y, width: 80 }}
              autoFocus
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit()
                if (e.key === 'Escape') cancelEdit()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default BpmnEditor
