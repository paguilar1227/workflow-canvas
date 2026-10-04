import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MousePointer2, Hand, Square, Frame, StickyNote, Type, Spline, Minus, Plus, Maximize, ChevronUp, ChevronDown, X, Bot, PenLine, Eye, Minimize2, BoxSelect, Maximize2, Pencil, CornerDownRight, ListPlus, SlidersHorizontal, MoreHorizontal, Trash2, Tag } from 'lucide-react';
import { useStore } from '@xyflow/react';
import { useApp, set, get } from '../store';
import * as actions from '../actions';
import { updateSession } from '../sync';
import { COLOR_NAMES } from '../../shared/types';

export function Toolbar() {
  const mode = useApp((s) => s.session.mode);
  const selCount = useApp((s) => s.selection.nodes.length);
  const placing = useApp((s) => s.placing?.kind);
  const coarse = useApp((s) => s.coarse);
  const areaSelect = useApp((s) => s.areaSelect);
  return (
    <div className="toolbar" role="toolbar" aria-label="Canvas tools" data-testid="toolbar">
      <button className={'btn icon' + (mode === 'select' && !areaSelect ? ' active' : '')} title="Select (V)" aria-label="Select tool" onClick={() => actions.setMode('select')}><MousePointer2 size={16} /></button>
      {coarse ? (
        <button className={'btn icon' + (areaSelect ? ' active' : '')} title="Select an area (one finger otherwise pans)" aria-label="Area select tool" aria-pressed={areaSelect} data-testid="tool-area" onClick={actions.toggleAreaSelect}><BoxSelect size={16} /></button>
      ) : (
        <button className={'btn icon' + (mode === 'pan' ? ' active' : '')} title="Hand / pan (H)" aria-label="Hand tool" data-testid="tool-pan" onClick={() => actions.setMode('pan')}><Hand size={16} /></button>
      )}
      <button className={'btn icon' + (mode === 'draw' ? ' active' : '')} title="Pen — freehand draw (P)" aria-label="Pen tool" data-testid="tool-pen" onClick={() => actions.setMode(mode === 'draw' ? 'select' : 'draw')}><PenLine size={16} /></button>
      <div className="sep" style={{ alignSelf: 'center' }} />
      <button className={'btn' + (placing === 'topic' ? ' active' : '')} title="Add topic (N) — click the canvas to place it, or it appears next to the selection" data-testid="add-topic" onClick={() => actions.insert('topic')}><Square size={15} />Topic</button>
      <button className={'btn' + (placing === 'frame' ? ' active' : '')} title="Add frame / lane (F) — wraps the selection, or click the canvas to place one" data-testid="add-frame" onClick={() => actions.insert('frame')}><Frame size={15} />Frame</button>
      <button className={'btn' + (placing === 'sticky' ? ' active' : '')} title="Add sticky note (S) — click the canvas to place it" data-testid="add-sticky" onClick={() => actions.insert('sticky')}><StickyNote size={15} />Sticky</button>
      <button className={'btn' + (placing === 'text' ? ' active' : '')} title="Add text (T) — click the canvas to place it" data-testid="add-text" onClick={() => actions.insert('text')}><Type size={15} />Text</button>
      {coarse ? null : <div className="sep" style={{ alignSelf: 'center' }} />}
      {coarse ? null : <button className="btn" title="Connect selected nodes (C)" data-testid="connect" disabled={selCount < 2} onClick={actions.connectSelected}><Spline size={15} />Connect</button>}
    </div>
  );
}

const PLACE_LABEL: Record<string, string> = { topic: 'topic', frame: 'frame', sticky: 'sticky note', text: 'text' };

export function ModePill() {
  const s = useApp((st) => st.session);
  const placing = useApp((st) => st.placing);
  const touch = useApp((st) => st.compact || st.coarse);
  const area = useApp((st) => st.areaSelect);
  if (placing && !s.viewMode) return <div className="mode-pill" data-testid="place-pill"><MousePointer2 size={14} /><span className="pill-text">{touch ? 'Tap to place a ' + (PLACE_LABEL[placing.kind] ?? placing.kind) : <>Click the canvas to place a {PLACE_LABEL[placing.kind] ?? placing.kind} · Enter = centre</>}</span><button className="btn outline" onClick={actions.cancelPlacing}>{touch ? 'Cancel' : 'Cancel (Esc)'}</button></div>;
  if (area && !s.viewMode) return <div className="mode-pill" data-testid="area-pill"><BoxSelect size={14} /><span className="pill-text">Drag across nodes to select them</span><button className="btn outline" onClick={actions.toggleAreaSelect}>Cancel</button></div>;
  if (s.viewMode) return <div className="mode-pill" data-testid="view-pill"><Eye size={14} /><span className="pill-text">View mode — read-only</span><button className="btn outline" onClick={actions.toggleViewMode} data-testid="exit-view">{touch ? 'Edit' : 'Edit (Alt+R)'}</button></div>;
  if (s.zenMode) return <div className="mode-pill" data-testid="zen-pill"><Minimize2 size={14} /><span className="pill-text">Zen mode</span><button className="btn outline" onClick={actions.toggleZen} data-testid="exit-zen">{touch ? 'Exit' : 'Exit (Alt+Z)'}</button></div>;
  if (s.mode === 'draw') return <div className="mode-pill" data-testid="pen-pill"><PenLine size={14} /><span className="pill-text">Pen — drag to draw</span><button className="btn outline" onClick={() => actions.setMode('select')}>{touch ? 'Done' : 'Done (Esc)'}</button></div>;
  return null;
}

export function ZoomBar() {
  const zoom = useStore((s) => s.transform[2]);
  return (
    <div className="zoombar" data-testid="zoombar">
      <button className="btn icon" title="Zoom out (⌘-)" aria-label="Zoom out" data-testid="zoom-out" onClick={actions.zoomOut}><Minus size={15} /></button>
      <button className="pct" title="Reset to 100%" data-testid="zoom-pct" onClick={() => actions.zoomTo(1)}>{Math.round(zoom * 100)}%</button>
      <button className="btn icon" title="Zoom in (⌘+)" aria-label="Zoom in" data-testid="zoom-in" onClick={actions.zoomIn}><Plus size={15} /></button>
      <button className="btn icon" title="Fit to screen (⇧1)" aria-label="Fit view" data-testid="fit-view" onClick={actions.fitView}><Maximize size={14} /></button>
    </div>
  );
}

export function SearchBar() {
  const open = useApp((s) => s.searchOpen);
  const q = useApp((s) => s.session.search);
  const idx = useApp((s) => s.searchIndex);
  const doc = useApp((s) => s.doc);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t || !doc) return [] as string[];
    return doc.nodes.filter((n) => [n.title, n.subtitle, n.notes, n.badge, ...(n.tags ?? [])].some((v) => v?.toLowerCase().includes(t))).map((n) => n.id);
  }, [q, doc]);
  const cur = matches.length ? ((idx % matches.length) + matches.length) % matches.length : -1;
  useEffect(() => { if (open && cur >= 0) actions.focusNodes([matches[cur]]); }, [open, cur, matches.length]);
  if (!open) return null;
  return (
    <div className="searchbar" data-testid="searchbar">
      <input autoFocus data-no-emoji placeholder="Find topics, notes, tags…" aria-label="Search canvas" data-testid="search-input" value={q}
        onChange={(e) => { set({ searchIndex: 0 }); updateSession({ search: e.target.value }); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') set({ searchIndex: idx + (e.shiftKey ? -1 : 1) });
          if (e.key === 'Escape') actions.closeSearch();
        }} />
      <span className="count" data-testid="search-count">{matches.length ? cur + 1 + ' / ' + matches.length : '0 / 0'}</span>
      <button className="btn icon" aria-label="Previous match" onClick={() => set({ searchIndex: idx - 1 })}><ChevronUp size={14} /></button>
      <button className="btn icon" aria-label="Next match" onClick={() => set({ searchIndex: idx + 1 })}><ChevronDown size={14} /></button>
      <button className="btn icon" aria-label="Close search" onClick={actions.closeSearch}><X size={14} /></button>
    </div>
  );
}

export function ActivityFeed() {
  const activity = useApp((s) => s.activity);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const recent = activity.filter((a) => Date.now() - a.at < 6000).slice(-4);
  return (
    <div className="activity" data-testid="activity">
      {recent.map((a) => <div key={a.id} className="activity-item"><Bot size={14} /><span><b>{a.origin}</b> {a.summary}</span></div>)}
    </div>
  );
}

export function Toast() {
  const t = useApp((s) => s.toast);
  const connected = useApp((s) => s.connected);
  return (
    <>
      {t ? <div className="toast" data-testid="toast">{t}</div> : null}
      {!connected ? <div className="conn-banner">Reconnecting to server…</div> : null}
    </>
  );
}

export function ContextMenu() {
  const menu = useApp((s) => s.menu);
  const compact = useApp((s) => s.compact);
  const coarse = useApp((s) => s.coarse);
  const viewMode = useApp((s) => s.session.viewMode);
  if (!menu) return null;
  const close = () => set({ menu: null });
  const item = (label: string, fn: () => void, kbd?: string, testId?: string) => (
    <button className="menu-item" data-testid={testId} onClick={() => { close(); fn(); }}>{label}{kbd ? <span className="kbd">{kbd}</span> : null}</button>
  );
  const n = menu.nodeId ? get().doc?.nodes.find((x) => x.id === menu.nodeId) : undefined;
  const hasKids = n ? get().doc?.nodes.some((x) => x.parentId === n.id) : false;
  if (viewMode) {
    // Read-only: offer only what does not change the document.
    return (
      <div className={'ctx' + (compact ? ' sheet' : '')} style={compact ? undefined : { left: menu.x, top: menu.y }} data-testid="context-menu" onContextMenu={(e) => e.preventDefault()} onMouseLeave={coarse ? undefined : close}>
        {n ? item('Copy', actions.copy, '⌘C', 'ctx-copy') : null}
        {item('Select all', () => actions.select((get().doc?.nodes ?? []).map((x) => x.id)), '⌘A')}
        {item('Fit to screen', actions.fitView, '⇧1')}
      </div>
    );
  }
  return (
    <div className={'ctx' + (compact ? ' sheet' : '')} style={compact ? undefined : { left: menu.x, top: menu.y }} data-testid="context-menu" onContextMenu={(e) => e.preventDefault()} onMouseLeave={coarse ? undefined : close}>
      {n ? (
        <>
          {item('Edit text', () => set({ editingId: n.id }), 'F2', 'ctx-edit')}
          {n.kind === 'topic' ? item('Add child topic', () => actions.addChild(n.id), 'Tab', 'ctx-child') : null}
          {n.kind === 'topic' ? item('Add sibling topic', () => actions.addSibling(n.id), 'Enter', 'ctx-sibling') : null}
          {hasKids ? item(n.collapsed ? 'Expand branch' : 'Collapse branch', () => actions.toggleCollapse([n.id]), '/') : null}
          {item('Duplicate', actions.duplicate, '⌘D')}
          {item('Copy', actions.copy, '⌘C')}
          {item('Frame selection', actions.frameSelection, '⌘G')}
          {n.kind === 'frame' ? item('Fit frame to contents', () => actions.fitFrame(n.id)) : null}
          <div className="menu-label">Color</div>
          <div className="swatches" style={{ padding: '2px 8px 6px' }}>
            {COLOR_NAMES.map((c) => <button key={c} className="swatch-btn" aria-label={'Color ' + c} style={{ background: c === 'default' ? 'var(--node-bg)' : 'var(--c-' + c + ')' }} onClick={() => { close(); actions.setColor(c === 'default' ? null : c); }} />)}
          </div>
          <hr />
          {item('Delete', actions.deleteSelection, '⌫', 'ctx-delete')}
        </>
      ) : menu.edgeId ? (
        <>
          {item('Edit label', () => set({ editingEdgeId: menu.edgeId! }), undefined, 'ctx-edge-label')}
          {item('Reverse direction', () => actions.reverseEdge(menu.edgeId!))}
          {item('Toggle dashed', () => { const e = get().doc?.edges.find((x) => x.id === menu.edgeId); if (e) actions.updateEdge(e.id, { style: e.style === 'dashed' ? 'solid' : 'dashed' }); })}
          {item('Toggle animated flow', () => { const e = get().doc?.edges.find((x) => x.id === menu.edgeId); if (e) actions.updateEdge(e.id, { animated: !e.animated }); })}
          <hr />
          {item('Delete connector', actions.deleteSelection, '⌫')}
        </>
      ) : (
        <>
          {item('Add topic here', () => actions.addNode('topic', menu.flow), 'N', 'ctx-add-topic')}
          {item('Add sticky note here', () => actions.addNode('sticky', menu.flow), 'S')}
          {item('Add text here', () => actions.addNode('text', menu.flow), 'T')}
          {item('Add frame here', () => actions.addNode('frame', menu.flow), 'F')}
          {item('Paste', () => actions.paste(menu.flow), '⌘V')}
          <hr />
          {item('Select all', () => actions.select((get().doc?.nodes ?? []).map((x) => x.id)), '⌘A')}
          {item('Fit to screen', actions.fitView, '⇧1')}
        </>
      )}
    </div>
  );
}

const TOUCH_ROWS: [string, string][] = [
  ['Pan / zoom', 'Drag empty canvas / pinch'], ['Box-select', 'Area tool, then drag'],
  ['Select / move', 'Tap / drag a node'], ['Edit, add child or sibling, style, delete', 'Action bar above the toolbar'],
  ['Context menu', 'Long-press'], ['Add a topic', 'Double-tap empty canvas, or Topic then tap'], ['Connect', 'Tap a dot on the selected node, then the target'], ['Tick a task', 'Tap its box, or select the note and tap the task'],
  ['Outline / inspector', '☰ and Style; close with × or tap outside'],
];

const FORMAT_ROWS: [string, string][] = [
  ['Bold / italic / strikethrough', '**bold** *italic* ~~strike~~'], ['Code / link', '\u0060code\u0060 [text](https://…)'],
  ['Heading / quote (sticky & text)', '# Heading  > quote'], ['List / task list (sticky & text)', '- item  1. item  - [ ] task'],
  ['Table / code block (sticky & text)', '| a | b |  \u0060\u0060\u0060'], ['Emoji by name', ':rocket: or :ro… then ↑↓ Enter'], ['Emoji picker', '☺ button above the field you are typing in'],
];

export function HelpModal() {
  const open = useApp((s) => s.helpOpen);
  const touch = useApp((s) => s.compact || s.coarse);
  if (!open) return null;
  const rows: [string, string][] = [
    ['Add child topic', 'Tab'], ['Add sibling topic', 'Enter'], ['Edit selected', 'F2 / double-click'], ['Delete', 'Delete / ⌫'],
    ['Collapse / expand branch', '/'], ['Navigate between topics', 'Arrow keys'], ['Nudge selection', 'Shift + arrows'], ['Undo / redo', '⌘Z / ⇧⌘Z'],
    ['Copy / cut / paste', '⌘C / ⌘X / ⌘V'], ['Duplicate', '⌘D'], ['Select all', '⌘A'], ['Frame (group) selection', '⌘G'],
    ['Connect selected in order', 'C'], ['New topic / sticky / text / frame (click to place; beside the selection if any)', 'N / S / T / F'], ['Place at view centre / cancel placing', 'Enter / Esc'], ['Select / hand tool', 'V / H'], ['Pan', 'Scroll, Space + drag, middle-drag'],
    ['Zoom', '⌘ + scroll, pinch, ⌘+ / ⌘-'], ['Fit to screen / selection', '⇧1 / ⇧2'], ['Search', '⌘F'], ['This help', '?'],
    ['Rectangle / diamond / ellipse', 'R / D / O'], ['Pen (freehand)', 'P, Esc to finish'], ['Zen mode', 'Alt+Z'], ['View (read-only) mode', 'Alt+R'],
  ];
  return (
    <div className="modal-backdrop" onClick={() => set({ helpOpen: false })}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="help-modal">
        <h2>{touch ? 'Touch, keyboard & mouse' : 'Keyboard & mouse'}</h2>
        {touch ? <><h3>Touch</h3><div className="shortcut-grid" data-testid="touch-help">{TOUCH_ROWS.map(([a, b]) => <div className="shortcut" key={a}><span>{a}</span><span className="kbd">{b}</span></div>)}</div><h3>Keyboard</h3></> : null}
        <p className="lead">XMind-style editing on an infinite canvas. Everything here is also available to AI agents as MCP tools.</p>
        <div className="shortcut-grid">{rows.map(([a, b]) => <div className="shortcut" key={a}><span>{a}</span><span className="kbd">{b}</span></div>)}</div>
        <h3>Markdown & emoji</h3>
        <p className="lead">Sticky notes and text take full Markdown, including clickable task lists. Topic and frame titles and connector labels take inline styling. Every text field accepts emoji.</p>
        <div className="shortcut-grid" data-testid="format-help">{FORMAT_ROWS.map(([a, b]) => <div className="shortcut" key={a}><span>{a}</span><span className="kbd">{b}</span></div>)}</div>
        <div className="modal-actions"><button className="btn primary" onClick={() => set({ helpOpen: false })}>Got it</button></div>
      </div>
    </div>
  );
}

export function AiModal() {
  const open = useApp((s) => s.aiOpen);
  const activity = useApp((s) => s.activity);
  if (!open) return null;
  const url = location.origin + '/mcp';
  return (
    <div className="modal-backdrop" onClick={() => set({ aiOpen: false })}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="ai-modal">
        <h2>Connect an AI agent</h2>
        <p className="lead">The canvas exposes 35 MCP tools — documents, nodes, connectors, frames, layout, selection, viewport, themes, panels, undo/redo, import/export and screenshots. AI edits show up here live.</p>
        <h3>MCP endpoint (streamable HTTP)</h3>
        <div className="code">{url}</div>
        <h3>Codex CLI</h3>
        <div className="code">codex mcp add workflow-canvas --url {url}</div>
        <h3>Claude Code</h3>
        <div className="code">claude mcp add --transport http workflow-canvas {url}</div>
        <h3>stdio clients (Claude Desktop, etc.)</h3>
        <div className="code">docker exec -i workflow-canvas node dist/server/stdio.js</div>
        <h3>Plain HTTP</h3>
        <div className="code">GET {location.origin}/api/tools{'\n'}POST {location.origin}/api/tools/&lt;tool_name&gt;  (JSON body = arguments)</div>
        <h3>Recent AI activity</h3>
        {activity.length ? activity.slice(-6).reverse().map((a) => <div key={a.id} className="shortcut"><span><b>{a.origin}</b> {a.summary}</span><span className="kbd">{new Date(a.at).toLocaleTimeString()}</span></div>) : <p className="lead">No AI activity yet in this tab.</p>}
        <div className="modal-actions"><button className="btn primary" onClick={() => set({ aiOpen: false })}>Close</button></div>
      </div>
    </div>
  );
}

const SAMPLE_MERMAID = 'flowchart LR\n  subgraph web [Frontend]\n    ui[Web app] --> api\n  end\n  subgraph svc [Backend]\n    api[API] -->|SQL| db[(Postgres)]\n    api -.-> cache[(Redis)]\n  end';
const SAMPLE_EXCALIDRAW = JSON.stringify({ type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements: [
  { id: 'a', type: 'rectangle', x: 0, y: 0, width: 180, height: 70, strokeColor: '#1971c2', backgroundColor: '#a5d8ff', fillStyle: 'hachure', roundness: { type: 3 }, boundElements: [{ id: 'a-t', type: 'text' }, { id: 'arr', type: 'arrow' }] },
  { id: 'a-t', type: 'text', x: 20, y: 25, width: 140, height: 20, text: 'Idea', containerId: 'a' },
  { id: 'b', type: 'diamond', x: 300, y: -15, width: 160, height: 100, strokeColor: '#f08c00', backgroundColor: 'transparent', boundElements: [{ id: 'b-t', type: 'text' }, { id: 'arr', type: 'arrow' }] },
  { id: 'b-t', type: 'text', x: 330, y: 25, width: 100, height: 20, text: 'Worth it?', containerId: 'b' },
  { id: 'arr', type: 'arrow', x: 180, y: 35, width: 120, height: 0, points: [[0, 0], [120, 0]], startBinding: { elementId: 'a', focus: 0, gap: 4 }, endBinding: { elementId: 'b', focus: 0, gap: 4 }, endArrowhead: 'arrow', strokeStyle: 'dashed', boundElements: [{ id: 'arr-t', type: 'text' }] },
  { id: 'arr-t', type: 'text', x: 220, y: 25, width: 40, height: 20, text: 'test', containerId: 'arr' },
  { id: 'f', type: 'freedraw', x: 40, y: 120, width: 120, height: 30, points: [[0, 0], [30, 20], [60, 5], [90, 25], [120, 10]] },
] }, null, 2);
const SAMPLE_MD = '# Q3 plan\n## Goals\n- Ship v2\n- Grow activation\n## Risks\n- Hiring\n  - Two open roles\n- Scope creep';

export function ImportModal() {
  const open = useApp((s) => s.importOpen);
  const [format, setFormat] = useState<'mermaid' | 'markdown' | 'excalidraw' | 'json'>('mermaid');
  const [text, setText] = useState(SAMPLE_MERMAID);
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [err, setErr] = useState('');
  if (!open) return null;
  const pick = (f: typeof format) => { setFormat(f); setText(f === 'mermaid' ? SAMPLE_MERMAID : f === 'markdown' ? SAMPLE_MD : f === 'excalidraw' ? SAMPLE_EXCALIDRAW : ''); setErr(''); };
  return (
    <div className="modal-backdrop" onClick={() => set({ importOpen: false })}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="import-modal">
        <h2>Import</h2>
        <p className="lead">Paste a Mermaid flowchart (subgraphs become frames), a Markdown outline (becomes a mind map), an Excalidraw scene (.excalidraw) or Workflow Canvas JSON — or load a file.</p>
        <div className="seg" style={{ marginBottom: 10 }}>
          {(['mermaid', 'markdown', 'excalidraw', 'json'] as const).map((f) => <button key={f} className={format === f ? 'on' : ''} data-testid={'import-format-' + f} onClick={() => pick(f)}>{f}</button>)}
          <label className="btn outline small" data-testid="import-load-file">Load file…<input type="file" hidden accept=".mmd,.md,.markdown,.json,.txt,.excalidraw" data-testid="import-file" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const t = await f.text(); if (/\.excalidraw$/i.test(f.name) || t.includes('"type": "excalidraw"') || t.includes('"type":"excalidraw"')) setFormat('excalidraw'); setText(t); }} /></label>
        </div>
        <textarea className="import-text" data-no-emoji data-testid="import-text" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        {err ? <p style={{ color: 'var(--c-red)' }}>{err}</p> : null}
        <div className="modal-actions">
          <div className="seg" style={{ marginRight: 'auto' }}>
            <button className={mode === 'append' ? 'on' : ''} onClick={() => setMode('append')}>Append</button>
            <button className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')}>Replace canvas</button>
          </div>
          <button className="btn" onClick={() => set({ importOpen: false })}>Cancel</button>
          <button className="btn primary" data-testid="import-submit" onClick={() => {
            try { actions.importContent(format, text, mode); set({ importOpen: false }); setErr(''); }
            catch (e2) { setErr((e2 as Error).message); }
          }}>Import</button>
        </div>
      </div>
    </div>
  );
}


/** Header on each side column: dismiss it from the column itself, and on phones expand it to the full width. */
export function ColumnHeader({ panel, title }: { panel: 'outline' | 'inspector'; title: string }) {
  const compact = useApp((s) => s.compact);
  const full = useApp((s) => s.drawerFull);
  return (
    <div className="column-head">
      <span className="column-title">{title}</span>
      {compact ? (
        <button className={'btn icon' + (full ? ' active' : '')} data-testid={'expand-' + panel} aria-label={(full ? 'Shrink ' : 'Expand ') + title} aria-pressed={full} title={full ? 'Shrink' : 'Expand to full width'} onClick={actions.toggleDrawerFull}>
          {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      ) : null}
      <button className="btn icon" data-testid={'close-' + panel} aria-label={'Close ' + title} title="Close" onClick={() => actions.closePanel(panel)}><X size={16} /></button>
    </div>
  );
}

/** Touch replacement for the keyboard and right-click: what you can do with the current selection, one tap away. */
export function SelectionBar() {
  const touch = useApp((s) => s.compact || s.coarse);
  const sel = useApp((s) => s.selection);
  const doc = useApp((s) => s.doc);
  const busy = useApp((s) => !!s.editingId || !!s.editingEdgeId || !!s.placing || s.areaSelect || !!s.drawer || s.searchOpen || s.session.mode !== 'select');
  if (!touch || busy || !doc || (!sel.nodes.length && !sel.edges.length)) return null;
  const one = sel.nodes.length === 1 ? doc.nodes.find((n) => n.id === sel.nodes[0]) : undefined;
  const edgeOnly = !sel.nodes.length && sel.edges.length === 1 ? sel.edges[0] : undefined;
  const b = (label: string, icon: ReactNode, fn: () => void, testId: string, danger = false) => (
    <button className={'btn sel-btn' + (danger ? ' danger' : '')} data-testid={testId} aria-label={label} onClick={fn}>{icon}<span>{label}</span></button>
  );
  const more = (e: React.MouseEvent) => {
    // The app root closes an open menu on any click; this click opens one, so it must not reach the root.
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const target = sel.nodes[0];
    set({ menu: { x: r.left, y: r.top, flow: { x: 0, y: 0 }, nodeId: target, edgeId: target ? undefined : edgeOnly } });
  };
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selection actions" data-testid="selection-bar">
      {one && one.kind !== 'drawing' ? b('Edit', <Pencil size={16} />, () => set({ editingId: one.id }), 'sel-edit') : null}
      {edgeOnly ? b('Label', <Tag size={16} />, () => set({ editingEdgeId: edgeOnly }), 'sel-edge-label') : null}
      {one?.kind === 'topic' ? b('Child', <CornerDownRight size={16} />, () => actions.addChild(one.id), 'sel-child') : null}
      {one?.kind === 'topic' ? b('Sibling', <ListPlus size={16} />, () => actions.addSibling(one.id), 'sel-sibling') : null}
      {sel.nodes.length > 1 ? b('Frame', <Frame size={16} />, actions.frameSelection, 'sel-frame') : null}
      {sel.nodes.length > 1 ? b('Connect', <Spline size={16} />, actions.connectSelected, 'sel-connect') : null}
      {b('Style', <SlidersHorizontal size={16} />, () => actions.openDrawer('inspector'), 'sel-style')}
      <button className="btn sel-btn" data-testid="sel-more" aria-label="More actions" onClick={more}><MoreHorizontal size={16} /><span>More</span></button>
      {b('Delete', <Trash2 size={16} />, actions.deleteSelection, 'sel-delete', true)}
    </div>
  );
}
