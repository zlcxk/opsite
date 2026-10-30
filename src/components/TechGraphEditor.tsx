import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  GitBranch,
  Maximize2,
  MousePointer2,
  Plus,
  Save,
  Search,
  StickyNote,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  TechGraphData,
  TechGraphEdge,
  TechGraphNode,
  TechNodeSummary,
  TechRelationType,
  TechView,
} from '@shared/types';
import { masteryColor, relationLabels, techNodeTypeLabels, truncate } from '../lib/tech';
import { Modal } from './ui';

const typeTone: Record<string, { fill: string; stroke: string; text: string }> = {
  domain: { fill: '#eef3ee', stroke: '#9aa89d', text: '#3f5347' },
  concept: { fill: '#eef2f5', stroke: '#9eafba', text: '#3f5764' },
  component: { fill: '#e9f1ec', stroke: '#87a795', text: '#2f5f4a' },
  resource: { fill: '#f7efe3', stroke: '#c4a276', text: '#6d4f28' },
  protocol: { fill: '#e9eef7', stroke: '#8d9fc2', text: '#3f5077' },
  practice: { fill: '#f2edf6', stroke: '#ac96bd', text: '#5a436b' },
  direction: { fill: '#fbeee9', stroke: '#d29a84', text: '#78442f' },
  note: { fill: '#fbf7e8', stroke: '#cbbd82', text: '#6b5c25' },
};

function toneFor(nodeType: string | null | undefined) {
  return typeTone[nodeType ?? 'note'] ?? typeTone.note;
}

function wrapLabel(label: string, width: number, maxLines = 2): string[] {
  const perLine = Math.max(6, Math.floor((width - 22) / 12));
  const chars = [...label];
  const lines: string[] = [];
  let current = '';
  let units = 0;
  for (const char of chars) {
    const cost = /[一-龥，。、；：（）]/.test(char) ? 2 : 1;
    if (units + cost > perLine * 2) {
      lines.push(current);
      current = '';
      units = 0;
      if (lines.length === maxLines) break;
    }
    current += char;
    units += cost;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (!lines.length) lines.push(label);
  if (lines.length === maxLines && [...label].length > lines.join('').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  }
  return lines;
}

function clampScale(value: number): number {
  return Math.min(Math.max(value, 0.25), 2.5);
}

function makeGraphId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Clip a center-to-center line at the node border so arrowheads stay visible. */
function boundaryPoint(node: TechGraphNode, towardX: number, towardY: number) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const scale = Math.min(
    dx ? (node.width / 2 + 4) / Math.abs(dx) : Number.POSITIVE_INFINITY,
    dy ? (node.height / 2 + 4) / Math.abs(dy) : Number.POSITIVE_INFINITY,
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

interface DragState {
  kind: 'node' | 'pan';
  nodeId?: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

export function TechGraphEditor({
  view,
  availableNodes,
  onSave,
  saving,
}: {
  view: TechView;
  availableNodes: TechNodeSummary[];
  onSave: (graph: TechGraphData) => Promise<boolean>;
  saving: boolean;
}) {
  const [graph, setGraph] = useState<TechGraphData>(view.graphData);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<'select' | 'connect'>('select');
  const [selected, setSelected] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [transform, setTransform] = useState({ k: 0.78, tx: 20, ty: 10 });
  const [addOpen, setAddOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const fittedRef = useRef(false);

  const nodeIndex = useMemo(
    () => new Map(availableNodes.map((node) => [node.id, node])),
    [availableNodes],
  );

  const selectedNode = selected?.kind === 'node' ? graph.nodes.find((node) => node.id === selected.id) : null;
  const selectedEdge = selected?.kind === 'edge' ? graph.edges.find((edge) => edge.id === selected.id) : null;

  const fit = () => {
    const el = containerRef.current;
    if (!el || !graph.nodes.length) return;
    const width = el.clientWidth;
    const height = el.clientHeight;
    const xs = graph.nodes.flatMap((node) => [node.x, node.x + node.width]);
    const ys = graph.nodes.flatMap((node) => [node.y, node.y + node.height]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const k = clampScale(Math.min((width - 80) / Math.max(maxX - minX, 1), (height - 80) / Math.max(maxY - minY, 1), 1.25));
    const tx = (width - (maxX - minX) * k) / 2 - minX * k;
    const ty = (height - (maxY - minY) * k) / 2 - minY * k;
    setTransform({ k, tx, ty });
  };

  useEffect(() => {
    if (fittedRef.current) return;
    const timer = window.setTimeout(() => {
      fittedRef.current = true;
      fit();
    }, 80);
    return () => window.clearTimeout(timer);
    // Fit once for the loaded view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React attaches wheel listeners passively, so zooming needs a native,
  // non-passive listener to keep the page itself from scrolling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setTransform((current) => {
        const nextScale = clampScale(current.k * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
        return {
          k: nextScale,
          tx: px - ((px - current.tx) * nextScale) / current.k,
          ty: py - ((py - current.ty) * nextScale) / current.k,
        };
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const mark = (next: TechGraphData) => {
    setGraph(next);
    setDirty(true);
  };

  const updateNode = (id: string, patch: Partial<TechGraphNode>) => {
    mark({ ...graph, nodes: graph.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)) });
  };

  const updateEdge = (id: string, patch: Partial<TechGraphEdge>) => {
    mark({ ...graph, edges: graph.edges.map((edge) => (edge.id === id ? { ...edge, ...patch } : edge)) });
  };

  const removeSelected = () => {
    if (!selected) return;
    if (selected.kind === 'node') {
      mark({
        nodes: graph.nodes.filter((node) => node.id !== selected.id),
        edges: graph.edges.filter((edge) => edge.source !== selected.id && edge.target !== selected.id),
      });
    } else {
      mark({ ...graph, edges: graph.edges.filter((edge) => edge.id !== selected.id) });
    }
    setSelected(null);
  };

  const centerWorld = () => {
    const el = containerRef.current;
    const width = el?.clientWidth ?? 800;
    const height = el?.clientHeight ?? 600;
    return {
      x: (width / 2 - transform.tx) / transform.k - 84,
      y: (height / 2 - transform.ty) / transform.k - 27,
    };
  };

  const addLinkedNode = (node: TechNodeSummary) => {
    const point = centerWorld();
    const graphNode: TechGraphNode = {
      id: makeGraphId('gn'),
      nodeId: node.id,
      label: node.name,
      x: Math.round(point.x),
      y: Math.round(point.y),
      width: 168,
      height: 54,
      note: null,
      nodeType: node.nodeType,
    };
    mark({ ...graph, nodes: [...graph.nodes, graphNode] });
    setSelected({ kind: 'node', id: graphNode.id });
    setAddOpen(false);
    setPickerSearch('');
  };

  const addNote = () => {
    const point = centerWorld();
    const graphNode: TechGraphNode = {
      id: makeGraphId('gn'),
      nodeId: null,
      label: '说明',
      x: Math.round(point.x),
      y: Math.round(point.y + 40),
      width: 230,
      height: 76,
      note: '补一句布局说明，不会被当成技术节点。',
      nodeType: null,
    };
    mark({ ...graph, nodes: [...graph.nodes, graphNode] });
    setSelected({ kind: 'node', id: graphNode.id });
  };

  const connectTo = (targetId: string) => {
    if (!connectSource) {
      setConnectSource(targetId);
      return;
    }
    if (connectSource === targetId) {
      setConnectSource(null);
      return;
    }
    const edge: TechGraphEdge = {
      id: makeGraphId('ge'),
      source: connectSource,
      target: targetId,
      label: '关联',
      relationType: 'related',
    };
    mark({ ...graph, edges: [...graph.edges, edge] });
    setSelected({ kind: 'edge', id: edge.id });
    setConnectSource(null);
  };

  const onNodePointerDown = (event: ReactPointerEvent, node: TechGraphNode) => {
    event.stopPropagation();
    if (tool === 'connect') {
      connectTo(node.id);
      return;
    }
    setSelected({ kind: 'node', id: node.id });
    dragRef.current = {
      kind: 'node',
      nodeId: node.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y,
    };
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  };

  const onBackgroundPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return;
    setSelected(null);
    dragRef.current = {
      kind: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.tx,
      originY: transform.ty,
    };
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (drag.kind === 'pan') {
      setTransform((current) => ({ ...current, tx: drag.originX + dx, ty: drag.originY + dy }));
      return;
    }
    if (!drag.nodeId) return;
    const nextX = Math.round(drag.originX + dx / transform.k);
    const nextY = Math.round(drag.originY + dy / transform.k);
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === drag.nodeId ? { ...node, x: nextX, y: nextY } : node,
      ),
    }));
    setDirty(true);
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const save = async () => {
    const ok = await onSave(graph);
    if (ok) setDirty(false);
  };

  const pickerNodes = useMemo(() => {
    const used = new Set(graph.nodes.map((node) => node.nodeId).filter(Boolean) as string[]);
    const term = pickerSearch.trim().toLowerCase();
    return availableNodes
      .filter((node) => !used.has(node.id))
      .filter(
        (node) =>
          !term ||
          node.name.toLowerCase().includes(term) ||
          (node.summary ?? '').toLowerCase().includes(term),
      )
      .slice(0, 80);
  }, [availableNodes, graph.nodes, pickerSearch]);

  return (
    <div className="tech-graph-shell">
      <div className="tech-graph-toolbar">
        <div className="segmented">
          <button
            className={tool === 'select' ? 'active' : ''}
            onClick={() => {
              setTool('select');
              setConnectSource(null);
            }}
            title="选择与拖拽"
          >
            <MousePointer2 size={13} /> 选择
          </button>
          <button
            className={tool === 'connect' ? 'active' : ''}
            onClick={() => {
              setTool('connect');
              setSelected(null);
            }}
            title="依次点击两个节点建立连线"
          >
            <GitBranch size={13} /> 连线
          </button>
        </div>
        <div className="tech-graph-toolbar-group">
          <button className="btn btn-ghost btn-sm" onClick={() => setAddOpen(true)}>
            <Plus size={13} /> 添加技术节点
          </button>
          <button className="btn btn-ghost btn-sm" onClick={addNote}>
            <StickyNote size={13} /> 添加注释
          </button>
        </div>
        <div className="tech-graph-toolbar-group ml-auto">
          <button className="icon-btn" onClick={() => setTransform((c) => ({ ...c, k: clampScale(c.k / 1.2) }))} title="缩小">
            <ZoomOut size={15} />
          </button>
          <span className="tech-graph-zoom mono">{Math.round(transform.k * 100)}%</span>
          <button className="icon-btn" onClick={() => setTransform((c) => ({ ...c, k: clampScale(c.k * 1.2) }))} title="放大">
            <ZoomIn size={15} />
          </button>
          <button className="icon-btn" onClick={fit} title="适应画布">
            <Maximize2 size={15} />
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={!dirty || saving}>
            <Save size={13} /> {saving ? '保存中…' : dirty ? '保存视图' : '已保存'}
          </button>
        </div>
      </div>

      <div className="tech-graph-body">
        <div className="tech-graph-canvas" ref={containerRef}>
          <svg
            className={`tech-graph-svg tool-${tool}`}
            onPointerDown={onBackgroundPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            role="application"
            aria-label="架构视图编辑器"
          >
            <defs>
              <marker id="tech-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#83918a" />
              </marker>
              <marker id="tech-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#e96538" />
              </marker>
              <pattern id="tech-grid" width="28" height="28" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="#d7ded5" />
              </pattern>
            </defs>
            <g transform={`translate(${transform.tx} ${transform.ty}) scale(${transform.k})`}>
              <rect x={-4000} y={-4000} width={9000} height={9000} fill="url(#tech-grid)" pointerEvents="none" />
              {graph.edges.map((edge) => {
                const source = graph.nodes.find((node) => node.id === edge.source);
                const target = graph.nodes.find((node) => node.id === edge.target);
                if (!source || !target) return null;
                const sourceCenter = {
                  x: source.x + source.width / 2,
                  y: source.y + source.height / 2,
                };
                const targetCenter = {
                  x: target.x + target.width / 2,
                  y: target.y + target.height / 2,
                };
                const start = boundaryPoint(source, targetCenter.x, targetCenter.y);
                const end = boundaryPoint(target, sourceCenter.x, sourceCenter.y);
                const sx = start.x;
                const sy = start.y;
                const tx = end.x;
                const ty = end.y;
                const active = selected?.kind === 'edge' && selected.id === edge.id;
                return (
                  <g
                    key={edge.id}
                    className={`tech-graph-edge ${active ? 'active' : ''}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSelected({ kind: 'edge', id: edge.id });
                    }}
                  >
                    <line
                      x1={sx}
                      y1={sy}
                      x2={tx}
                      y2={ty}
                      stroke={active ? '#e96538' : '#9aa79f'}
                      strokeWidth={active ? 2 : 1.3}
                      markerEnd={`url(#${active ? 'tech-arrow-active' : 'tech-arrow'})`}
                    />
                    <line x1={sx} y1={sy} x2={tx} y2={ty} stroke="transparent" strokeWidth={14} />
                    {edge.label && (
                      <text
                        x={(sx + tx) / 2}
                        y={(sy + ty) / 2 - 5}
                        textAnchor="middle"
                        className="tech-graph-edge-label"
                        fill={active ? '#c24d24' : '#66756c'}
                      >
                        {truncate(edge.label, 18)}
                      </text>
                    )}
                  </g>
                );
              })}
              {graph.nodes.map((node) => {
                const linked = node.nodeId ? nodeIndex.get(node.nodeId) : null;
                const tone = toneFor(linked?.nodeType ?? node.nodeType);
                const active =
                  (selected?.kind === 'node' && selected.id === node.id) || connectSource === node.id;
                const lines = wrapLabel(node.label, node.width, node.nodeId ? 2 : 1);
                const noteLines =
                  !node.nodeId && node.note ? wrapLabel(node.note, node.width, 2) : [];
                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x} ${node.y})`}
                    className={`tech-graph-node ${active ? 'active' : ''} ${node.nodeId ? '' : 'is-note'}`}
                    onPointerDown={(event) => onNodePointerDown(event, node)}
                    role={node.nodeId ? 'link' : 'note'}
                  >
                    <rect
                      width={node.width}
                      height={node.height}
                      rx={10}
                      fill={tone.fill}
                      stroke={active ? '#e96538' : tone.stroke}
                      strokeWidth={active ? 2 : 1.1}
                      strokeDasharray={node.nodeId ? undefined : '5 4'}
                    />
                    <rect width={4} height={node.height} rx={2} fill={tone.stroke} opacity={0.75} />
                    <text x={12} y={20} className="tech-graph-node-title" fill={tone.text}>
                      {lines.map((line, index) => (
                        <tspan key={index} x={12} dy={index === 0 ? 0 : 15}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                    {noteLines.length > 0 && (
                      <text x={12} y={38} className="tech-graph-node-note" fill={tone.text}>
                        {noteLines.map((line, index) => (
                          <tspan key={index} x={12} dy={index === 0 ? 0 : 12}>
                            {line}
                          </tspan>
                        ))}
                      </text>
                    )}
                    <text
                      x={12}
                      y={node.height - 9}
                      className="tech-graph-node-meta"
                      fill={tone.text}
                      opacity={0.78}
                    >
                      {node.nodeId
                        ? linked
                          ? `${techNodeTypeLabels[linked.nodeType]} · ${linked.name === node.label ? linked.name : truncate(linked.name, 16)}`
                          : '关联节点不可用'
                        : '布局注释'}
                    </text>
                    {linked && linked.focusLevel === 'focus' && (
                      <circle cx={node.width - 12} cy={12} r={4} fill="#e96538" />
                    )}
                    {linked && (
                      <circle
                        cx={node.width - 12}
                        cy={22}
                        r={3.5}
                        fill={masteryColor(linked.masteryStatus)}
                      />
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="tech-graph-hint">
            {tool === 'connect'
              ? connectSource
                ? '再点击目标节点完成连线'
                : '依次点击起点与终点节点'
              : '拖动节点调整布局 · 拖动空白处平移 · 滚轮缩放'}
          </div>
        </div>

        <aside className="tech-graph-inspector">
          {selectedNode ? (
            <>
              <div className="tech-graph-inspector-head">
                <span className="eyebrow">{selectedNode.nodeId ? 'Node' : 'Layout note'}</span>
                <strong>{selectedNode.nodeId ? '技术节点' : '布局注释'}</strong>
              </div>
              <label className="field">
                <span className="field-label">显示名称</span>
                <input
                  className="field-input"
                  value={selectedNode.label}
                  onChange={(event) => updateNode(selectedNode.id, { label: event.target.value })}
                />
              </label>
              {selectedNode.nodeId ? (
                <div className="tech-graph-linked">
                  {(() => {
                    const linked = nodeIndex.get(selectedNode.nodeId);
                    if (!linked) return <span className="text-[var(--muted)]">关联节点不可用</span>;
                    return (
                      <>
                        <span className={`pill type-${linked.nodeType}`}>{techNodeTypeLabels[linked.nodeType]}</span>
                        <strong>{linked.name}</strong>
                        <p>{linked.summary}</p>
                        <Link to={`/tech/nodes/${linked.id}`} className="btn btn-secondary btn-sm">
                          打开知识节点
                        </Link>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <label className="field">
                  <span className="field-label">注释内容</span>
                  <textarea
                    className="field-textarea"
                    rows={5}
                    value={selectedNode.note ?? ''}
                    onChange={(event) => updateNode(selectedNode.id, { note: event.target.value })}
                  />
                </label>
              )}
              <div className="tech-graph-inspector-actions">
                <button className="btn btn-danger btn-sm" onClick={removeSelected}>
                  <Trash2 size={12} /> 从视图中移除
                </button>
              </div>
            </>
          ) : selectedEdge ? (
            <>
              <div className="tech-graph-inspector-head">
                <span className="eyebrow">Connection</span>
                <strong>连线</strong>
              </div>
              <label className="field">
                <span className="field-label">关系类型</span>
                <select
                  className="field-input"
                  value={selectedEdge.relationType ?? 'related'}
                  onChange={(event) =>
                    updateEdge(selectedEdge.id, {
                      relationType: event.target.value as TechRelationType,
                      label:
                        selectedEdge.label && selectedEdge.label !== relationLabels[selectedEdge.relationType ?? 'related']
                          ? selectedEdge.label
                          : relationLabels[event.target.value as TechRelationType],
                    })
                  }
                >
                  {Object.entries(relationLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">连线标签</span>
                <input
                  className="field-input"
                  value={selectedEdge.label ?? ''}
                  onChange={(event) => updateEdge(selectedEdge.id, { label: event.target.value })}
                  placeholder="如 ruleSelector"
                />
              </label>
              <div className="tech-graph-inspector-actions">
                <button className="btn btn-danger btn-sm" onClick={removeSelected}>
                  <Trash2 size={12} /> 删除连线
                </button>
              </div>
            </>
          ) : (
            <div className="tech-graph-empty-inspector">
              <Check size={18} />
              <strong>选择图上的节点或连线</strong>
              <p>在这里修改显示名称、关系标签，或跳转到对应的技术知识节点。</p>
            </div>
          )}
        </aside>
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        wide
        eyebrow="Add to view"
        title="把技术节点放进架构图"
        description="同一个技术节点可以在多张视图中出现，知识内容只维护一份。"
      >
        <div className="inline-search mb-3">
          <Search size={13} />
          <input
            value={pickerSearch}
            onChange={(event) => setPickerSearch(event.target.value)}
            placeholder="搜索节点名称或摘要"
            autoFocus
          />
        </div>
        <div className="tech-graph-picker">
          {pickerNodes.length === 0 ? (
            <div className="p-4 text-center text-[0.75rem] text-[var(--muted)]">没有可添加的节点</div>
          ) : (
            pickerNodes.map((node) => (
              <button key={node.id} className="tech-graph-picker-row" onClick={() => addLinkedNode(node)}>
                <span className={`tech-type-dot type-${node.nodeType}`} />
                <span>
                  <strong>{node.name}</strong>
                  <em>{truncate(node.summary, 70)}</em>
                </span>
                <Plus size={14} />
              </button>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
