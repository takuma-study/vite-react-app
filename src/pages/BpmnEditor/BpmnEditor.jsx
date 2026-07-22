import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import './BpmnEditor.css'

const LEGACY_STORAGE_KEY = 'bpmn-editor-data'
const FLOW_TABS = [
  { key: 'current', label: '現在フロー', storageKey: 'bpmn-editor-data-current' },
  { key: 'issue', label: '課題付与フロー', storageKey: 'bpmn-editor-data-issue' },
  { key: 'improved', label: '改善後フロー', storageKey: 'bpmn-editor-data-improved' },
]
const CANVAS_WIDTH = 1800
const CANVAS_HEIGHT = 1100
const DRAG_DATA_TYPE = 'application/bpmn-tool'
const RATIO_MIN = 0.05
const RATIO_MAX = 0.95
const LANE_DEFAULT_HEIGHT = 200
const LANE_MIN_HEIGHT = 60
const LANE_LABEL_WIDTH = 28
const LABEL_FONT = '12px sans-serif'
const LABEL_LINE_HEIGHT = 14
const ZOOM_MIN = 0.2
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1
const ISSUE_MIN_SIZE = 6
const IMPROVEMENT_MIN_SIZE = 6

const ELEMENT_DEFAULTS = {
  startEvent: { width: 40, height: 40, label: '開始' },
  endEvent: { width: 40, height: 40, label: '終了' },
  task: { width: 120, height: 60, label: 'タスク', time: 0 },
  gateway: { width: 50, height: 50, label: '' },
  note: { width: 140, height: 80, label: 'メモ' },
}

const TOOLS = [
  { type: 'startEvent', label: '開始イベント' },
  { type: 'endEvent', label: '終了イベント' },
  { type: 'task', label: 'タスク' },
  { type: 'gateway', label: 'ゲートウェイ' },
]

const NOTE_TOOL = { type: 'note', label: 'テキストボックス' }

let idCounter = 0
function nextId(prefix) {
  idCounter += 1
  return `${prefix}_${Date.now()}_${idCounter}`
}

// Number input that only commits on blur/Enter, so retyping a value doesn't
// resize the shape (and clamp to `min`) after every keystroke.
function NumberField({ label, value, min, onCommit, className = 'bpmn-properties-field' }) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  function commit() {
    let n = Number(draft)
    if (!Number.isFinite(n)) n = value
    if (min !== undefined) n = Math.max(min, n)
    setDraft(String(n))
    if (n !== value) onCommit(n)
  }

  return (
    <label className={className}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur()
        }}
      />
    </label>
  )
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
    case 'note':
      return (
        <svg className="bpmn-tool-icon" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="6.5" y1="9" x2="17.5" y2="9" stroke="currentColor" strokeWidth="1.5" />
          <line x1="6.5" y1="13" x2="17.5" y2="13" stroke="currentColor" strokeWidth="1.5" />
          <line x1="6.5" y1="17" x2="13" y2="17" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
    default:
      return null
  }
}

let measureCtx = null
function getMeasureContext() {
  if (!measureCtx && typeof document !== 'undefined') {
    measureCtx = document.createElement('canvas').getContext('2d')
  }
  return measureCtx
}

// Splits label text into render lines: respects manual newlines, and further
// breaks any line wider than maxWidth character-by-character (Japanese text
// has no spaces to word-wrap on).
function wrapLabelLines(label, maxWidth) {
  const paragraphs = (label ?? '').split('\n')
  const ctx = getMeasureContext()
  if (!ctx || !maxWidth) return paragraphs

  ctx.font = LABEL_FONT
  const lines = []
  for (const para of paragraphs) {
    if (para === '') {
      lines.push('')
      continue
    }
    let current = ''
    for (const ch of para) {
      const candidate = current + ch
      if (current !== '' && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current)
        current = ch
      } else {
        current = candidate
      }
    }
    lines.push(current)
  }
  return lines
}

function normalizeRect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
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

function loadInitialState(storageKey) {
  try {
    // The single-flow editor used to save under one shared key; let the first
    // ("current") tab adopt that pre-existing data instead of losing it.
    const raw = localStorage.getItem(storageKey) ?? (storageKey === FLOW_TABS[0].storageKey ? localStorage.getItem(LEGACY_STORAGE_KEY) : null)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed.elements || !parsed.connections) return null
    return parsed
  } catch {
    return null
  }
}

function FlowEditor({ storageKey, tabs }) {
  const initial = loadInitialState(storageKey)
  const [elements, setElements] = useState(initial?.elements ?? [])
  const [connections, setConnections] = useState(initial?.connections ?? [])
  const [lanes, setLanes] = useState(initial?.lanes ?? [])
  const [annualCount, setAnnualCount] = useState(initial?.annualCount ?? 0)
  const [issues, setIssues] = useState(initial?.issues ?? [])
  const [issueMode, setIssueMode] = useState(false)
  const [issueDraft, setIssueDraft] = useState(null)
  const [improvements, setImprovements] = useState(initial?.improvements ?? [])
  const [improvementMode, setImprovementMode] = useState(false)
  const [improvementDraft, setImprovementDraft] = useState(null)
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
  const [zoom, setZoom] = useState(1)
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [aiCopyDone, setAiCopyDone] = useState(false)
  const [improvementAiModalOpen, setImprovementAiModalOpen] = useState(false)
  const [improvementAiCopyDone, setImprovementAiCopyDone] = useState(false)
  const svgRef = useRef(null)
  const canvasWrapperRef = useRef(null)
  const suppressClickRef = useRef(false)
  const issueDraftRef = useRef(null)
  const improvementDraftRef = useRef(null)

  function getCanvasPoint(e) {
    const rect = svgRef.current.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom }
  }

  function zoomIn() {
    setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100))
  }

  function zoomOut() {
    setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100))
  }

  function zoomToFit() {
    const wrapper = canvasWrapperRef.current
    if (!wrapper) return
    const scale = Math.min(wrapper.clientWidth / CANVAS_WIDTH, wrapper.clientHeight / CANVAS_HEIGHT)
    setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(scale * 100) / 100)))
  }

  useEffect(() => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ elements, connections, lanes, annualCount, issues, improvements }),
    )
  }, [storageKey, elements, connections, lanes, annualCount, issues, improvements])

  useEffect(() => {
    if (!drag) return undefined
    let moved = false

    function onMove(e) {
      const rect = svgRef.current.getBoundingClientRect()
      const x = (e.clientX - rect.left) / zoom
      const y = (e.clientY - rect.top) / zoom
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

      if (drag.kind === 'lane-resize') {
        if (!moved) return
        const height = Math.max(LANE_MIN_HEIGHT, drag.startHeight + (y - drag.startY))
        setLanes((prev) => prev.map((l) => (l.id === drag.id ? { ...l, height } : l)))
        return
      }

      if (drag.kind === 'issue-draw') {
        if (!moved) return
        const rect = normalizeRect(drag.startX, drag.startY, x, y)
        issueDraftRef.current = rect
        setIssueDraft(rect)
        return
      }

      if (drag.kind === 'issue-move') {
        setIssues((prev) =>
          prev.map((i) => (i.id === drag.id ? { ...i, x: x - drag.offsetX, y: y - drag.offsetY } : i)),
        )
        return
      }

      if (drag.kind === 'improvement-draw') {
        if (!moved) return
        const rect = normalizeRect(drag.startX, drag.startY, x, y)
        improvementDraftRef.current = rect
        setImprovementDraft(rect)
        return
      }

      if (drag.kind === 'improvement-move') {
        setImprovements((prev) =>
          prev.map((i) => (i.id === drag.id ? { ...i, x: x - drag.offsetX, y: y - drag.offsetY } : i)),
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
      if (drag.kind === 'issue-draw') {
        const rect = issueDraftRef.current
        if (rect && rect.width >= ISSUE_MIN_SIZE && rect.height >= ISSUE_MIN_SIZE) {
          const newIssue = { id: nextId('issue'), label: '', ...rect }
          setIssues((prev) => [...prev, newIssue])
          setSelection({ kind: 'issue', id: newIssue.id })
        }
        issueDraftRef.current = null
        setIssueDraft(null)
      }
      if (drag.kind === 'improvement-draw') {
        const rect = improvementDraftRef.current
        if (rect && rect.width >= IMPROVEMENT_MIN_SIZE && rect.height >= IMPROVEMENT_MIN_SIZE) {
          const newImprovement = { id: nextId('improvement'), label: '', ...rect }
          setImprovements((prev) => [...prev, newImprovement])
          setSelection({ kind: 'improvement', id: newImprovement.id })
        }
        improvementDraftRef.current = null
        setImprovementDraft(null)
      }
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
  }, [drag, zoom])

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
    } else if (selection.kind === 'lane') {
      setLanes((prev) => prev.filter((l) => l.id !== selection.id))
    } else if (selection.kind === 'issue') {
      setIssues((prev) => prev.filter((i) => i.id !== selection.id))
    } else if (selection.kind === 'improvement') {
      setImprovements((prev) => prev.filter((i) => i.id !== selection.id))
    } else {
      setConnections((prev) => prev.filter((c) => c.id !== selection.id))
    }
    setSelection(null)
  }

  function addLane() {
    const newLane = { id: nextId('lane'), label: `レーン${lanes.length + 1}`, height: LANE_DEFAULT_HEIGHT }
    setLanes((prev) => [...prev, newLane])
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
      ...(type === 'task' ? { time: defaults.time } : {}),
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

  function toggleConnectMode(style) {
    setIssueMode(false)
    setImprovementMode(false)
    setConnectSource(null)
    setSelection(null)
    setConnectMode((prev) => (prev && connectStyle === style ? false : true))
    setConnectStyle(style)
  }

  function toggleIssueMode() {
    setConnectMode(false)
    setImprovementMode(false)
    setConnectSource(null)
    setSelection(null)
    setIssueMode((prev) => !prev)
  }

  function toggleImprovementMode() {
    setConnectMode(false)
    setIssueMode(false)
    setConnectSource(null)
    setSelection(null)
    setImprovementMode((prev) => !prev)
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
    const { x, y } = getCanvasPoint(e)
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

  function handleCanvasMouseDown(e) {
    if (!issueMode && !improvementMode) return
    // Elements/connections/lanes already no-op their own mousedown handlers while
    // issueMode/improvementMode is active, so any mousedown that reaches here (svg
    // background, a lane rect, or an element/connection that skipped its own
    // handler) should start a new frame, wherever it was drawn from.
    const { x, y } = getCanvasPoint(e)
    setSelection(null)
    setDrag({ kind: issueMode ? 'issue-draw' : 'improvement-draw', startX: x, startY: y })
  }

  function handleElementMouseDown(e, el) {
    if (connectMode || issueMode || improvementMode) return
    e.stopPropagation()
    setSelection({ kind: 'element', id: el.id })
    const { x, y } = getCanvasPoint(e)
    setDrag({ kind: 'element', id: el.id, offsetX: x - el.x, offsetY: y - el.y, startX: x, startY: y })
  }

  function handleElementClick(e, el) {
    e.stopPropagation()
    if (connectMode) {
      if (el.type === 'note') return
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
    if (connectMode || issueMode || improvementMode) return
    e.stopPropagation()
    setSelection({ kind: 'connection', id: conn.id })
    const from = elements.find((el) => el.id === conn.from)
    const to = elements.find((el) => el.id === conn.to)
    if (!from || !to) return
    const { axis, fromPoint, toPoint } = getElbowLayout(from, to)
    const { x: startX, y: startY } = getCanvasPoint(e)
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

  function handleLaneClick(e, lane) {
    if (connectMode || issueMode || improvementMode) return
    e.stopPropagation()
    setSelection({ kind: 'lane', id: lane.id })
  }

  function handleLaneDoubleClick(e, lane) {
    e.stopPropagation()
    setEditingId(lane.id)
    setEditingKind('lane')
    setEditingValue(lane.label)
  }

  function handleLaneResizeMouseDown(e, lane) {
    if (connectMode || issueMode || improvementMode) return
    e.stopPropagation()
    setSelection({ kind: 'lane', id: lane.id })
    const { x: startX, y: startY } = getCanvasPoint(e)
    setDrag({ kind: 'lane-resize', id: lane.id, startY, startHeight: lane.height, startX })
  }

  function handleIssueClick(e, issue) {
    if (issueMode || improvementMode) return
    e.stopPropagation()
    setSelection({ kind: 'issue', id: issue.id })
  }

  function handleIssueMouseDown(e, issue) {
    if (issueMode || improvementMode) return
    e.stopPropagation()
    setSelection({ kind: 'issue', id: issue.id })
    const { x, y } = getCanvasPoint(e)
    setDrag({ kind: 'issue-move', id: issue.id, offsetX: x - issue.x, offsetY: y - issue.y, startX: x, startY: y })
  }

  function handleIssueDoubleClick(e, issue) {
    e.stopPropagation()
    setEditingId(issue.id)
    setEditingKind('issue')
    setEditingValue(issue.label || '')
  }

  function handleImprovementClick(e, improvement) {
    if (issueMode || improvementMode) return
    e.stopPropagation()
    setSelection({ kind: 'improvement', id: improvement.id })
  }

  function handleImprovementMouseDown(e, improvement) {
    if (issueMode || improvementMode) return
    e.stopPropagation()
    setSelection({ kind: 'improvement', id: improvement.id })
    const { x, y } = getCanvasPoint(e)
    setDrag({
      kind: 'improvement-move',
      id: improvement.id,
      offsetX: x - improvement.x,
      offsetY: y - improvement.y,
      startX: x,
      startY: y,
    })
  }

  function handleImprovementDoubleClick(e, improvement) {
    e.stopPropagation()
    setEditingId(improvement.id)
    setEditingKind('improvement')
    setEditingValue(improvement.label || '')
  }

  function updateElement(id, patch) {
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, ...patch } : el)))
  }

  function updateLane(id, patch) {
    setLanes((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  function updateConnection(id, patch) {
    setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  function updateIssue(id, patch) {
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }

  function updateImprovement(id, patch) {
    setImprovements((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }

  function commitEdit() {
    if (editingKind === 'element') {
      setElements((prev) => prev.map((el) => (el.id === editingId ? { ...el, label: editingValue } : el)))
    } else if (editingKind === 'connection') {
      setConnections((prev) => prev.map((c) => (c.id === editingId ? { ...c, label: editingValue } : c)))
    } else if (editingKind === 'lane') {
      setLanes((prev) => prev.map((l) => (l.id === editingId ? { ...l, label: editingValue } : l)))
    } else if (editingKind === 'issue') {
      setIssues((prev) => prev.map((i) => (i.id === editingId ? { ...i, label: editingValue } : i)))
    } else if (editingKind === 'improvement') {
      setImprovements((prev) => prev.map((i) => (i.id === editingId ? { ...i, label: editingValue } : i)))
    }
    setEditingId(null)
    setEditingKind(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingKind(null)
  }

  function buildAiPrompt() {
    const data = JSON.stringify({ elements, connections, lanes, annualCount, issues, improvements }, null, 2)
    return `あなたは業務フロー改善のコンサルタントです。以下はBPMN風フロー図エディタで作成した業務フローのJSONデータです。

このフローを分析し、非効率な点・ボトルネック・無駄・リスクなど「課題」だと思われる箇所を見つけてください。
見つけた課題は、既存のJSONの "issues" 配列に要素を追加する形で表現してください。issues の各要素は以下の形式です。

{ "id": "一意な文字列", "label": "課題の説明文", "x": 数値, "y": 数値, "width": 数値, "height": 数値 }

x, y, width, height は、課題があると判断した elements（タスクなど）を赤枠で囲む座標・サイズにしてください（該当する要素の x, y, width, height を参考に、少し余白を持たせた範囲を指定してください）。

【重要な制約】
- elements, connections, lanes, annualCount は変更せず、そのまま出力してください。
- issues 配列にのみ、見つけた課題を追加してください（既存の issues も保持してください）。
- 出力は説明文などを含めず、上記形式の完全なJSONオブジェクトのみにしてください（コードブロックの \`\`\`json などの記号も不要です）。

【フローのJSONデータ】
${data}`
  }

  async function handleCopyAiPrompt() {
    const text = buildAiPrompt()
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setAiCopyDone(true)
    setTimeout(() => setAiCopyDone(false), 2000)
  }

  function buildImprovementAiPrompt() {
    const data = JSON.stringify({ elements, connections, lanes, annualCount, issues, improvements }, null, 2)
    return `あなたは業務フロー改善のコンサルタントです。以下はBPMN風フロー図エディタで作成した現在の業務フローのJSONデータです（issues に課題が付与されている場合があります）。

このフローの課題を踏まえて、改善後の業務フロー全体を新たに設計してください。改善後のフローは elements, connections, lanes, annualCount を使って表現してください。現在のフローの構成を参考にしつつ、業務改善のために要素の追加・削除・変更・接続の変更を自由に行ってください。

さらに、改善した箇所（追加・変更した要素や、まとめて自動化した箇所など）には improvements 配列で青枠を付けて説明してください。improvements の各要素は以下の形式です。

{ "id": "一意な文字列", "label": "改善内容の説明文", "x": 数値, "y": 数値, "width": 数値, "height": 数値 }

x, y, width, height は、改善した elements を青枠で囲む座標・サイズにしてください（該当する要素の x, y, width, height を参考に、少し余白を持たせた範囲を指定してください）。

【重要な制約】
- 出力は elements, connections, lanes, annualCount, issues, improvements をすべて含む完全なJSONオブジェクトにしてください。
- issues は空配列 [] にしてください（改善後フローには課題は不要です）。
- elements の x, y 座標は、幅1800×高さ1100程度のキャンバス内に収まるように配置してください。
- 出力は説明文などを含めず、上記形式の完全なJSONオブジェクトのみにしてください（コードブロックの \`\`\`json などの記号も不要です）。
- このJSONは「改善後フロー」タブの「JSONインポート」からそのまま読み込んで使用します。

【現在のフローのJSONデータ】
${data}`
  }

  async function handleCopyImprovementAiPrompt() {
    const text = buildImprovementAiPrompt()
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setImprovementAiCopyDone(true)
    setTimeout(() => setImprovementAiCopyDone(false), 2000)
  }

  function handleExportJson() {
    const data = JSON.stringify({ elements, connections, lanes, annualCount, issues, improvements }, null, 2)
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
          setLanes(parsed.lanes ?? [])
          setAnnualCount(parsed.annualCount ?? 0)
          setIssues(parsed.issues ?? [])
          setImprovements(parsed.improvements ?? [])
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
    if (
      elements.length === 0 &&
      connections.length === 0 &&
      lanes.length === 0 &&
      annualCount === 0 &&
      issues.length === 0 &&
      improvements.length === 0
    )
      return
    if (!window.confirm('全ての要素を削除しますか？')) return
    setElements([])
    setConnections([])
    setLanes([])
    setAnnualCount(0)
    setIssues([])
    setImprovements([])
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
  const selectedElement = selection?.kind === 'element' ? elements.find((el) => el.id === selection.id) : null
  const selectedLane = selection?.kind === 'lane' ? lanes.find((l) => l.id === selection.id) : null
  const selectedIssue = selection?.kind === 'issue' ? issues.find((i) => i.id === selection.id) : null
  const selectedImprovement =
    selection?.kind === 'improvement' ? improvements.find((i) => i.id === selection.id) : null

  let laneOffset = 0
  const laneLayouts = lanes.map((lane) => {
    const top = laneOffset
    laneOffset += lane.height
    return { ...lane, top }
  })

  const editingLane = editingKind === 'lane' ? laneLayouts.find((l) => l.id === editingId) : null
  const laneEditPos = editingLane ? { x: LANE_LABEL_WIDTH + 6, y: editingLane.top + 6 } : null

  const editingIssue = editingKind === 'issue' ? issues.find((i) => i.id === editingId) : null
  const issueEditPos = editingIssue ? { x: editingIssue.x, y: Math.max(0, editingIssue.y - 26) } : null

  const editingImprovement =
    editingKind === 'improvement' ? improvements.find((i) => i.id === editingId) : null
  const improvementEditPos = editingImprovement
    ? { x: editingImprovement.x, y: Math.max(0, editingImprovement.y - 26) }
    : null

  return (
    <div className="bpmn-editor">
      <header className="bpmn-topbar">
        <div className="bpmn-topbar-left">{tabs}</div>
        <div className="bpmn-topbar-right">
          <NumberField
            label="年間件数"
            min={0}
            value={annualCount}
            onCommit={setAnnualCount}
            className="bpmn-annual-count"
          />
          <div className="bpmn-actions">
            <button type="button" onClick={() => setAiModalOpen(true)}>
              AIに課題付与を依頼
            </button>
            <button type="button" onClick={() => setImprovementAiModalOpen(true)}>
              AIに改善後フローの作成を依頼
            </button>
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
        </div>
      </header>

      {connectMode && (
        <div className="bpmn-hint">
          {connectSource ? '接続先の要素をクリックしてください' : '接続元の要素をクリックしてください'}
        </div>
      )}
      {issueMode && <div className="bpmn-hint">ドラッグして課題の範囲を赤枠で囲んでください</div>}
      {improvementMode && (
        <div className="bpmn-hint">ドラッグして改善内容の範囲を青枠で囲んでください</div>
      )}

      <div className="bpmn-body">
        <aside className="bpmn-sidebar">
          <div className="bpmn-sidebar-section">
            <h3>レーン</h3>
            <button type="button" className="bpmn-tool-action" onClick={addLane}>
              スイムレーンを追加
            </button>
          </div>
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
            <h3>メモ</h3>
            <div
              className="bpmn-tool-item"
              draggable
              onDragStart={(e) => handleToolDragStart(e, NOTE_TOOL.type)}
              title="ドラッグしてキャンバスに配置"
            >
              <ToolIcon type={NOTE_TOOL.type} />
              <span>{NOTE_TOOL.label}</span>
            </div>
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
            <button
              type="button"
              className={`bpmn-tool-action${issueMode ? ' active' : ''}`}
              onClick={toggleIssueMode}
            >
              課題を追加
            </button>
            <button
              type="button"
              className={`bpmn-tool-action${improvementMode ? ' active' : ''}`}
              onClick={toggleImprovementMode}
            >
              改善内容を追加
            </button>
            <button type="button" className="bpmn-tool-action" onClick={deleteSelection} disabled={!selection}>
              削除
            </button>
            <p className="bpmn-sidebar-hint">矢印をドラッグするとカギ線に折り曲げられます</p>
          </div>
        </aside>

        <div className="bpmn-canvas-area">
        <div className="bpmn-canvas-wrapper" ref={canvasWrapperRef}>
          <div
            className="bpmn-canvas-scale-spacer"
            style={{ width: CANVAS_WIDTH * zoom, height: CANVAS_HEIGHT * zoom }}
          >
            <div
              className="bpmn-canvas-scale"
              style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `scale(${zoom})` }}
            >
          <svg
            ref={svgRef}
            className={`bpmn-canvas${dropHover ? ' drop-hover' : ''}`}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            style={{ cursor: issueMode || improvementMode ? 'crosshair' : undefined }}
            onClick={handleCanvasClick}
            onMouseDown={handleCanvasMouseDown}
            onDragOver={handleCanvasDragOver}
            onDragLeave={handleCanvasDragLeave}
            onDrop={handleCanvasDrop}
          >
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="#333" />
              </marker>
            </defs>

            {laneLayouts.map((lane, idx) => {
              const isSelected = selection?.kind === 'lane' && selection.id === lane.id
              return (
                <g key={lane.id}>
                  <rect
                    x={0}
                    y={lane.top}
                    width={CANVAS_WIDTH}
                    height={lane.height}
                    fill={idx % 2 === 0 ? '#ffffff' : '#fafbfc'}
                    stroke={isSelected ? '#1971ff' : '#999'}
                    strokeWidth={isSelected ? 2.5 : 1}
                    onClick={(e) => handleLaneClick(e, lane)}
                    style={{ cursor: connectMode ? 'default' : 'pointer' }}
                  />
                  <rect
                    x={0}
                    y={lane.top}
                    width={LANE_LABEL_WIDTH}
                    height={lane.height}
                    fill="#eef1f5"
                    stroke={isSelected ? '#1971ff' : '#999'}
                    strokeWidth={isSelected ? 2.5 : 1}
                    onClick={(e) => handleLaneClick(e, lane)}
                    style={{ cursor: connectMode ? 'default' : 'pointer' }}
                  />
                  {editingId !== lane.id && (
                    <text
                      x={LANE_LABEL_WIDTH / 2}
                      y={lane.top + lane.height / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      style={{ writingMode: 'vertical-rl' }}
                      className="bpmn-lane-label"
                      onClick={(e) => handleLaneClick(e, lane)}
                      onDoubleClick={(e) => handleLaneDoubleClick(e, lane)}
                    >
                      {lane.label}
                    </text>
                  )}
                  <rect
                    x={0}
                    y={lane.top + lane.height - 4}
                    width={CANVAS_WIDTH}
                    height={8}
                    fill="transparent"
                    onMouseDown={(e) => handleLaneResizeMouseDown(e, lane)}
                    style={{ cursor: 'ns-resize' }}
                  />
                </g>
              )
            })}

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
                    stroke="rgba(0,0,0,0.01)"
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
                    <text x={labelPos.x} textAnchor="middle" className="bpmn-flow-label">
                      {conn.label.split('\n').map((line, i, arr) => (
                        <tspan key={i} x={labelPos.x} y={labelPos.y - 10 - (arr.length - 1 - i) * LABEL_LINE_HEIGHT}>
                          {line || ' '}
                        </tspan>
                      ))}
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
                  {el.type === 'note' && (
                    <rect
                      x={el.x}
                      y={el.y}
                      width={el.width}
                      height={el.height}
                      fill="#fffde7"
                      stroke={isSelected || isConnectSource ? '#1971ff' : '#e0c14f'}
                      strokeWidth={isSelected || isConnectSource ? 2.5 : 1.5}
                    />
                  )}
                  {el.label &&
                    editingId !== el.id &&
                    (() => {
                      const isBox = el.type === 'task' || el.type === 'note'
                      const lines = isBox ? wrapLabelLines(el.label, el.width - 16) : el.label.split('\n')
                      const baseline = isBox ? 'middle' : 'auto'
                      const startY = isBox
                        ? cy - ((lines.length - 1) * LABEL_LINE_HEIGHT) / 2
                        : el.y + el.height + 14
                      return (
                        <text x={cx} textAnchor="middle" className="bpmn-element-label">
                          {lines.map((line, i) => (
                            <tspan key={i} x={cx} y={startY + i * LABEL_LINE_HEIGHT} dominantBaseline={baseline}>
                              {line || ' '}
                            </tspan>
                          ))}
                        </text>
                      )
                    })()}
                  {el.type === 'task' && el.time > 0 && editingId !== el.id && (
                    <text
                      x={el.x + el.width - 6}
                      y={el.y + el.height - 6}
                      textAnchor="end"
                      className="bpmn-time-label"
                    >
                      {el.time}分
                    </text>
                  )}
                </g>
              )
            })}

            {issues.map((issue) => {
              const isSelected = selection?.kind === 'issue' && selection.id === issue.id
              const color = isSelected ? '#be123c' : '#e11d48'
              return (
                <g key={issue.id}>
                  <rect
                    x={issue.x}
                    y={issue.y}
                    width={issue.width}
                    height={issue.height}
                    fill="none"
                    stroke="rgba(0,0,0,0.01)"
                    strokeWidth={14}
                    onMouseDown={(e) => handleIssueMouseDown(e, issue)}
                    onClick={(e) => handleIssueClick(e, issue)}
                    onDoubleClick={(e) => handleIssueDoubleClick(e, issue)}
                    style={{ cursor: issueMode || improvementMode ? 'crosshair' : 'move' }}
                  />
                  <rect
                    x={issue.x}
                    y={issue.y}
                    width={issue.width}
                    height={issue.height}
                    fill="none"
                    stroke={color}
                    strokeWidth={isSelected ? 3 : 2.5}
                    strokeDasharray="6 3"
                    style={{ pointerEvents: 'none' }}
                  />
                  {issue.label && editingId !== issue.id && (
                    <text x={issue.x} y={issue.y - 8} className="bpmn-issue-label">
                      {issue.label}
                    </text>
                  )}
                </g>
              )
            })}

            {issueDraft && (
              <rect
                x={issueDraft.x}
                y={issueDraft.y}
                width={issueDraft.width}
                height={issueDraft.height}
                fill="rgba(225,29,72,0.08)"
                stroke="#e11d48"
                strokeWidth={2}
                strokeDasharray="6 3"
                style={{ pointerEvents: 'none' }}
              />
            )}

            {improvements.map((improvement) => {
              const isSelected = selection?.kind === 'improvement' && selection.id === improvement.id
              const color = isSelected ? '#1d4ed8' : '#2563eb'
              return (
                <g key={improvement.id}>
                  <rect
                    x={improvement.x}
                    y={improvement.y}
                    width={improvement.width}
                    height={improvement.height}
                    fill="none"
                    stroke="rgba(0,0,0,0.01)"
                    strokeWidth={14}
                    onMouseDown={(e) => handleImprovementMouseDown(e, improvement)}
                    onClick={(e) => handleImprovementClick(e, improvement)}
                    onDoubleClick={(e) => handleImprovementDoubleClick(e, improvement)}
                    style={{ cursor: issueMode || improvementMode ? 'crosshair' : 'move' }}
                  />
                  <rect
                    x={improvement.x}
                    y={improvement.y}
                    width={improvement.width}
                    height={improvement.height}
                    fill="none"
                    stroke={color}
                    strokeWidth={isSelected ? 3 : 2.5}
                    strokeDasharray="6 3"
                    style={{ pointerEvents: 'none' }}
                  />
                  {improvement.label && editingId !== improvement.id && (
                    <text x={improvement.x} y={improvement.y - 8} className="bpmn-improvement-label">
                      {improvement.label}
                    </text>
                  )}
                </g>
              )
            })}

            {improvementDraft && (
              <rect
                x={improvementDraft.x}
                y={improvementDraft.y}
                width={improvementDraft.width}
                height={improvementDraft.height}
                fill="rgba(37,99,235,0.08)"
                stroke="#2563eb"
                strokeWidth={2}
                strokeDasharray="6 3"
                style={{ pointerEvents: 'none' }}
              />
            )}
          </svg>

          {editingElement && (
            <textarea
              className="bpmn-label-input"
              style={{
                left: editingElement.x,
                top:
                  editingElement.type === 'task'
                    ? editingElement.y + editingElement.height / 2 - 12
                    : editingElement.y + editingElement.height + 2,
                width: Math.max(editingElement.width, 60),
              }}
              rows={2}
              autoFocus
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelEdit()
              }}
            />
          )}

          {editingConnection && connectionEditPos && (
            <textarea
              className="bpmn-label-input"
              style={{ left: connectionEditPos.x, top: connectionEditPos.y, width: 80 }}
              rows={2}
              autoFocus
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelEdit()
              }}
            />
          )}

          {editingLane && laneEditPos && (
            <textarea
              className="bpmn-label-input"
              style={{ left: laneEditPos.x, top: laneEditPos.y, width: 120 }}
              rows={2}
              autoFocus
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelEdit()
              }}
            />
          )}

          {editingIssue && issueEditPos && (
            <textarea
              className="bpmn-label-input"
              style={{ left: issueEditPos.x, top: issueEditPos.y, width: Math.max(editingIssue.width, 100) }}
              rows={2}
              autoFocus
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelEdit()
              }}
            />
          )}

          {editingImprovement && improvementEditPos && (
            <textarea
              className="bpmn-label-input"
              style={{
                left: improvementEditPos.x,
                top: improvementEditPos.y,
                width: Math.max(editingImprovement.width, 100),
              }}
              rows={2}
              autoFocus
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelEdit()
              }}
            />
          )}
            </div>
          </div>
        </div>

          <div className="bpmn-zoom-controls">
            <button type="button" onClick={zoomOut} disabled={zoom <= ZOOM_MIN}>
              −
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={zoomIn} disabled={zoom >= ZOOM_MAX}>
              ＋
            </button>
            <button type="button" className="bpmn-zoom-fit" onClick={zoomToFit}>
              全体表示
            </button>
          </div>
        </div>

        {selection && (
          <aside className="bpmn-properties">
            <h3>プロパティ</h3>

            {selectedElement && (
              <>
                <div className="bpmn-properties-type">
                  {[...TOOLS, NOTE_TOOL].find((t) => t.type === selectedElement.type)?.label}
                </div>
                <label className="bpmn-properties-field">
                  <span>ラベル</span>
                  <textarea
                    rows={3}
                    value={selectedElement.label}
                    onChange={(e) => updateElement(selectedElement.id, { label: e.target.value })}
                  />
                </label>
                {selectedElement.type === 'task' && (
                  <NumberField
                    label="時間(分)"
                    min={0}
                    value={selectedElement.time ?? 0}
                    onCommit={(time) => updateElement(selectedElement.id, { time })}
                  />
                )}
                {selectedElement.type === 'startEvent' || selectedElement.type === 'endEvent' ? (
                  <NumberField
                    label="サイズ"
                    min={10}
                    value={selectedElement.width}
                    onCommit={(size) => updateElement(selectedElement.id, { width: size, height: size })}
                  />
                ) : (
                  <>
                    <NumberField
                      label="幅"
                      min={10}
                      value={selectedElement.width}
                      onCommit={(width) => updateElement(selectedElement.id, { width })}
                    />
                    <NumberField
                      label="高さ"
                      min={10}
                      value={selectedElement.height}
                      onCommit={(height) => updateElement(selectedElement.id, { height })}
                    />
                  </>
                )}
                <NumberField
                  label="X座標"
                  value={Math.round(selectedElement.x)}
                  onCommit={(x) => updateElement(selectedElement.id, { x })}
                />
                <NumberField
                  label="Y座標"
                  value={Math.round(selectedElement.y)}
                  onCommit={(y) => updateElement(selectedElement.id, { y })}
                />
              </>
            )}

            {selectedConnection && (
              <>
                <div className="bpmn-properties-type">矢印</div>
                <label className="bpmn-properties-field">
                  <span>ラベル</span>
                  <textarea
                    rows={2}
                    value={selectedConnection.label}
                    onChange={(e) => updateConnection(selectedConnection.id, { label: e.target.value })}
                  />
                </label>
              </>
            )}

            {selectedLane && (
              <>
                <div className="bpmn-properties-type">スイムレーン</div>
                <label className="bpmn-properties-field">
                  <span>ラベル</span>
                  <textarea
                    rows={2}
                    value={selectedLane.label}
                    onChange={(e) => updateLane(selectedLane.id, { label: e.target.value })}
                  />
                </label>
                <NumberField
                  label="高さ"
                  min={LANE_MIN_HEIGHT}
                  value={selectedLane.height}
                  onCommit={(height) => updateLane(selectedLane.id, { height })}
                />
              </>
            )}

            {selectedIssue && (
              <>
                <div className="bpmn-properties-type bpmn-properties-type-issue">課題</div>
                <label className="bpmn-properties-field">
                  <span>内容</span>
                  <textarea
                    rows={3}
                    value={selectedIssue.label}
                    onChange={(e) => updateIssue(selectedIssue.id, { label: e.target.value })}
                  />
                </label>
                <NumberField
                  label="幅"
                  min={ISSUE_MIN_SIZE}
                  value={selectedIssue.width}
                  onCommit={(width) => updateIssue(selectedIssue.id, { width })}
                />
                <NumberField
                  label="高さ"
                  min={ISSUE_MIN_SIZE}
                  value={selectedIssue.height}
                  onCommit={(height) => updateIssue(selectedIssue.id, { height })}
                />
                <NumberField
                  label="X座標"
                  value={Math.round(selectedIssue.x)}
                  onCommit={(x) => updateIssue(selectedIssue.id, { x })}
                />
                <NumberField
                  label="Y座標"
                  value={Math.round(selectedIssue.y)}
                  onCommit={(y) => updateIssue(selectedIssue.id, { y })}
                />
              </>
            )}

            {selectedImprovement && (
              <>
                <div className="bpmn-properties-type bpmn-properties-type-improvement">改善内容</div>
                <label className="bpmn-properties-field">
                  <span>内容</span>
                  <textarea
                    rows={3}
                    value={selectedImprovement.label}
                    onChange={(e) => updateImprovement(selectedImprovement.id, { label: e.target.value })}
                  />
                </label>
                <NumberField
                  label="幅"
                  min={IMPROVEMENT_MIN_SIZE}
                  value={selectedImprovement.width}
                  onCommit={(width) => updateImprovement(selectedImprovement.id, { width })}
                />
                <NumberField
                  label="高さ"
                  min={IMPROVEMENT_MIN_SIZE}
                  value={selectedImprovement.height}
                  onCommit={(height) => updateImprovement(selectedImprovement.id, { height })}
                />
                <NumberField
                  label="X座標"
                  value={Math.round(selectedImprovement.x)}
                  onCommit={(x) => updateImprovement(selectedImprovement.id, { x })}
                />
                <NumberField
                  label="Y座標"
                  value={Math.round(selectedImprovement.y)}
                  onCommit={(y) => updateImprovement(selectedImprovement.id, { y })}
                />
              </>
            )}
          </aside>
        )}
      </div>

      {aiModalOpen && (
        <div className="bpmn-modal-overlay" onClick={() => setAiModalOpen(false)}>
          <div className="bpmn-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bpmn-modal-header">
              <h2>AIに課題付与を依頼</h2>
              <button type="button" className="bpmn-modal-close" onClick={() => setAiModalOpen(false)}>
                ×
              </button>
            </div>
            <ol className="bpmn-modal-steps">
              <li>下のボタンでテキストをコピーします。</li>
              <li>ChatGPTなどのAIチャットに貼り付けて送信します。</li>
              <li>返ってきたJSONを保存し、「JSONインポート」から読み込むと課題付与済みのフローが反映されます。</li>
            </ol>
            <button type="button" className="bpmn-modal-copy" onClick={handleCopyAiPrompt}>
              {aiCopyDone ? 'コピーしました！' : 'テキストをコピー'}
            </button>
            <textarea className="bpmn-modal-preview" readOnly value={buildAiPrompt()} />
          </div>
        </div>
      )}

      {improvementAiModalOpen && (
        <div className="bpmn-modal-overlay" onClick={() => setImprovementAiModalOpen(false)}>
          <div className="bpmn-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bpmn-modal-header">
              <h2>AIに改善後フローの作成を依頼</h2>
              <button
                type="button"
                className="bpmn-modal-close"
                onClick={() => setImprovementAiModalOpen(false)}
              >
                ×
              </button>
            </div>
            <ol className="bpmn-modal-steps">
              <li>下のボタンでテキストをコピーします。</li>
              <li>ChatGPTなどのAIチャットに貼り付けて送信します。</li>
              <li>
                返ってきたJSONを保存し、「改善後フロー」タブに切り替えて「JSONインポート」から読み込むと、改善後フローと改善箇所を示す青枠が反映されます。
              </li>
            </ol>
            <button type="button" className="bpmn-modal-copy" onClick={handleCopyImprovementAiPrompt}>
              {improvementAiCopyDone ? 'コピーしました！' : 'テキストをコピー'}
            </button>
            <textarea className="bpmn-modal-preview" readOnly value={buildImprovementAiPrompt()} />
          </div>
        </div>
      )}
    </div>
  )
}

function BpmnEditor() {
  const [activeTab, setActiveTab] = useState(FLOW_TABS[0].key)
  const activeFlow = FLOW_TABS.find((tab) => tab.key === activeTab)

  const tabs = (
    <>
      <Link to="/" className="bpmn-back">
        ← ホーム
      </Link>
      <div className="bpmn-tabs">
        {FLOW_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`bpmn-tab${tab.key === activeTab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </>
  )

  return <FlowEditor key={activeFlow.key} storageKey={activeFlow.storageKey} tabs={tabs} />
}

export default BpmnEditor
