import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import './BpmnEditor.css'

const STORAGE_KEY = 'bpmn-editor-data'
const CANVAS_WIDTH = 1800
const CANVAS_HEIGHT = 1100

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
  const [pendingType, setPendingType] = useState(null)
  const [connectMode, setConnectMode] = useState(false)
  const [connectSource, setConnectSource] = useState(null)
  const [selection, setSelection] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editingKind, setEditingKind] = useState(null)
  const [editingValue, setEditingValue] = useState('')
  const [drag, setDrag] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const svgRef = useRef(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ elements, connections }))
  }, [elements, connections])

  useEffect(() => {
    if (!drag) return undefined

    function onMove(e) {
      const rect = svgRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      setElements((prev) =>
        prev.map((el) =>
          el.id === drag.id ? { ...el, x: x - drag.offsetX, y: y - drag.offsetY } : el,
        ),
      )
    }
    function onUp() {
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
    const newConn = { id: nextId('flow'), from: fromId, to: toId, label: '' }
    setConnections((prev) => [...prev, newConn])
  }

  function handleToolClick(type) {
    setConnectMode(false)
    setConnectSource(null)
    setSelection(null)
    setPendingType((prev) => (prev === type ? null : type))
  }

  function toggleConnectMode() {
    setPendingType(null)
    setConnectSource(null)
    setSelection(null)
    setConnectMode((prev) => !prev)
  }

  function handleCanvasClick(e) {
    if (e.target !== svgRef.current) return
    if (pendingType) {
      const rect = svgRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      placeElement(pendingType, x, y)
      setPendingType(null)
      return
    }
    setSelection(null)
  }

  function handleElementMouseDown(e, el) {
    if (pendingType || connectMode) return
    e.stopPropagation()
    setSelection({ kind: 'element', id: el.id })
    const rect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setDrag({ id: el.id, offsetX: x - el.x, offsetY: y - el.y })
  }

  function handleElementClick(e, el) {
    e.stopPropagation()
    if (pendingType) return
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

  function handleConnectionClick(e, conn) {
    e.stopPropagation()
    if (pendingType || connectMode) return
    setSelection({ kind: 'connection', id: conn.id })
  }

  function handleConnectionDoubleClick(e, conn) {
    e.stopPropagation()
    setEditingId(conn.id)
    setEditingKind('connection')
    setEditingValue(conn.label || '')
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
      connectionEditPos = {
        x: (from.x + from.width / 2 + to.x + to.width / 2) / 2 - 40,
        y: (from.y + from.height / 2 + to.y + to.height / 2) / 2 - 12,
      }
    }
  }

  return (
    <div className="bpmn-editor">
      <header className="bpmn-toolbar">
        <Link to="/" className="bpmn-back">
          ← ホーム
        </Link>
        <div className="bpmn-tools">
          {TOOLS.map((tool) => (
            <button
              key={tool.type}
              type="button"
              className={pendingType === tool.type ? 'active' : ''}
              onClick={() => handleToolClick(tool.type)}
            >
              {tool.label}
            </button>
          ))}
          <button type="button" className={connectMode ? 'active' : ''} onClick={toggleConnectMode}>
            矢印で接続
          </button>
          <button type="button" onClick={deleteSelection} disabled={!selection}>
            削除
          </button>
        </div>
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

      {pendingType && <div className="bpmn-hint">配置したい場所をクリックしてください</div>}
      {connectMode && (
        <div className="bpmn-hint">
          {connectSource ? '接続先の要素をクリックしてください' : '接続元の要素をクリックしてください'}
        </div>
      )}

      <div className="bpmn-canvas-wrapper">
        <svg
          ref={svgRef}
          className="bpmn-canvas"
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onClick={handleCanvasClick}
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
            const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
            const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
            const p1 = getBoundaryPoint(from, toCenter.x, toCenter.y)
            const p2 = getBoundaryPoint(to, fromCenter.x, fromCenter.y)
            const midX = (p1.x + p2.x) / 2
            const midY = (p1.y + p2.y) / 2
            const isSelected = selection?.kind === 'connection' && selection.id === conn.id
            return (
              <g key={conn.id}>
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke={isSelected ? '#1971ff' : '#333'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  markerEnd="url(#arrowhead)"
                  onClick={(e) => handleConnectionClick(e, conn)}
                  onDoubleClick={(e) => handleConnectionDoubleClick(e, conn)}
                  style={{ cursor: 'pointer' }}
                />
                {conn.label && editingId !== conn.id && (
                  <text x={midX} y={midY - 6} textAnchor="middle" className="bpmn-flow-label">
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
                style={{ cursor: pendingType ? 'default' : connectMode ? 'crosshair' : 'move' }}
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
  )
}

export default BpmnEditor
