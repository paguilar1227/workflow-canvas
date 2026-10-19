import { Checkbox } from '../components/Checkbox';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Textarea } from '../components/Textarea';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { AlignLeft, AlignCenterHorizontal, AlignRight, AlignStartVertical, AlignCenterVertical, AlignEndVertical, Columns3, Rows3, Frame, Link as LinkIcon, Trash2, Copy, ArrowLeftRight, X } from 'lucide-react';
import { useApp, set } from '../store';
import { Picker, priorityOptions, roleOptions, shapeOptions, statusOptions } from './Picker';
import * as actions from '../actions';
import { ColumnHeader } from './Chrome';
import { COLOR_NAMES, NODE_ROLES, NODE_SHAPES, NODE_STATUSES, EDGE_ROUTINGS, EDGE_STYLES, ARROW_MODES, type CanvasNode, type CanvasEdge, type ColorName } from '../../shared/types';

function Text({ label, value, onCommit, multiline, mono, testId, placeholder, noEmoji }: { label: string; value?: string; onCommit: (v: string) => void; multiline?: boolean; mono?: boolean; testId?: string; placeholder?: string; noEmoji?: boolean }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const commit = () => { if (v !== (value ?? '')) onCommit(v); };
  const common = {
    value: v, 'data-testid': testId, placeholder, 'aria-label': label, 'data-no-emoji': noEmoji || undefined,
    style: mono ? { fontFamily: 'var(--font-mono)', fontSize: 12 } : undefined,
    onChange: (e: { target: { value: string } }) => setV(e.target.value),
    onBlur: commit,
    onKeyDown: (e: KeyboardEvent) => { e.stopPropagation(); if (e.key === 'Enter' && !multiline) (e.target as HTMLElement).blur(); },
  };
  return <div className="field"><label>{label}</label>{multiline ? <Textarea {...common} /> : <Input {...common} />}</div>;
}

export function nodeKindLabel(n: CanvasNode) {
  return n.kind === 'frame' ? 'Frame' : n.kind === 'sticky' ? 'Sticky note' : n.kind === 'text' ? 'Text' : n.kind === 'drawing' ? 'Drawing' : 'Topic';
}

/** No priority, then P1 (highest) to P5: the levels the canvas marker shows. */
const PRIORITIES = [0, 1, 2, 3, 4, 5] as const;

function Colors({ value, onPick }: { value?: string; onPick: (c: ColorName | null) => void }) {
  return (
    <div className="field"><label>Color</label>
      <div className="swatches">
        {COLOR_NAMES.map((c) => (
          <Button key={c} className={'swatch-btn' + ((value ?? 'default') === c ? ' on' : '')} data-testid={'color-' + c} title={c} aria-label={'Color ' + c}
            style={{ background: c === 'default' ? 'var(--node-bg)' : 'var(--c-' + c + ')' }} onClick={() => onPick(c === 'default' ? null : c)} />
        ))}
      </div>
    </div>
  );
}

function Seg<T extends string>({ label, options, value, onPick, testPrefix }: { label: string; options: readonly T[]; value?: T; onPick: (v: T) => void; testPrefix?: string }) {
  return (
    <div className="field"><label>{label}</label>
      <div className="seg">{options.map((o) => <Button key={o} data-testid={testPrefix ? testPrefix + o : undefined} className={value === o ? 'on' : ''} onClick={() => onPick(o)}>{o}</Button>)}</div>
    </div>
  );
}

function LayerControls() {
  return <div className="field" role="group" aria-label="Arrange"><span className="field-label">Arrange</span><div className="seg layer-controls">
    <Button data-testid="bring-forward" onClick={() => actions.arrangeSelection('forward')}>Bring forward</Button>
    <Button data-testid="send-backward" onClick={() => actions.arrangeSelection('backward')}>Send backward</Button>
    <Button data-testid="bring-to-front" onClick={() => actions.arrangeSelection('front')}>Bring to front</Button>
    <Button data-testid="send-to-back" onClick={() => actions.arrangeSelection('back')}>Send to back</Button>
  </div></div>;
}

/** The node's properties. `scope` keeps its pickers apart from another copy on screen (the quick-edit popover); `onClose` adds a close button. */
export function NodeInspector({ n, scope = '', onClose }: { n: CanvasNode; scope?: string; onClose?: () => void }) {
  const up = (patch: Partial<CanvasNode>) => actions.updateNode(n.id, patch as never);
  return (
    <div data-testid="inspector-node">
      <div className="panel-title"><span>{nodeKindLabel(n)}</span><span className="panel-title-end"><span className="kbd">{n.id}</span>{onClose ? <Button className="btn icon" data-testid="node-popover-close" aria-label="Close" title="Close (Esc)" onClick={onClose}><X size={14} /></Button> : null}</span></div>
      <Text label="Title" value={n.title} onCommit={(v) => up({ title: v })} testId="insp-title" multiline={n.kind === 'sticky' || n.kind === 'text'} placeholder={n.kind === 'sticky' || n.kind === 'text' ? 'Markdown and :emoji: supported' : undefined} />
      {n.kind !== 'sticky' ? <Text label={n.kind === 'frame' ? 'Subtitle' : 'Subtitle (monospace line)'} value={n.subtitle} mono onCommit={(v) => up({ subtitle: v })} testId="insp-subtitle" /> : null}
      {n.kind === 'topic' ? (
        <div className="field-row">
          <Text label="Badge" value={n.badge} onCommit={(v) => up({ badge: v })} testId="insp-badge" placeholder="e.g. Proposed" />
          <Text label="Icon (emoji)" value={n.icon} onCommit={(v) => up({ icon: v })} testId="insp-icon" placeholder="e.g. ⚙️" />
        </div>
      ) : null}
      <Colors value={n.color} onPick={(c) => actions.setColor(c)} />
      {n.kind === 'topic' ? (
        <>
          <div className="field-row">
            <div className="field"><label>Logic role</label><Picker id={scope + 'insp-role'} label="Logic role" grid value={n.role ?? 'none'} options={roleOptions(NODE_ROLES, 'Step')} onPick={(r) => actions.setRole(r)} testId="role-picker" /></div>
            <div className="field"><label>Shape</label><Picker id={scope + 'insp-shape'} label="Shape" grid value={n.shape ?? 'card'} options={shapeOptions(NODE_SHAPES)} onPick={(s) => actions.setShape(s)} testId="shape-picker" /></div>
          </div>
          <div className="field-row">
            <div className="field"><label>Status</label><Picker id={scope + 'insp-status'} label="Status" value={n.status ?? 'none'} options={statusOptions(NODE_STATUSES)} onPick={(s) => actions.setStatus(s)} testId="status-picker" /></div>
            <div className="field"><label>Priority</label><Picker id={scope + 'insp-priority'} label="Priority" value={n.priority ?? 0} options={priorityOptions(PRIORITIES)} onPick={(p) => up({ priority: p })} testId="priority-picker" /></div>
          </div>
        </>
      ) : null}
      {n.kind !== 'frame' ? <Text label="Tags (comma separated)" value={(n.tags ?? []).join(', ')} onCommit={(v) => up({ tags: v.split(',').map((t) => t.trim()).filter(Boolean) })} testId="insp-tags" /> : null}
      <Text label="Link" value={n.link} onCommit={(v) => up({ link: v })} testId="insp-link" placeholder="https://" noEmoji />
      <Text label="Notes" value={n.notes} multiline onCommit={(v) => up({ notes: v })} testId="insp-notes" />
      <div className="field-row">
        <Text label="Width" value={String(n.width)} onCommit={(v) => Number(v) > 0 && up({ width: Number(v) })} noEmoji />
        <Text label="Height" value={String(n.height)} onCommit={(v) => Number(v) > 0 && up({ height: Number(v) })} noEmoji />
      </div>
      <label className="toggle-row"><span>Locked</span><Checkbox checked={!!n.locked} aria-label="Toggle lock" onChange={() => up({ locked: !n.locked })} /></label>
      <LayerControls />
      {n.link ? <a className="btn outline" href={n.link} target="_blank" rel="noreferrer"><LinkIcon size={14} />Open link</a> : null}
      <div className="seg" style={{ marginTop: 10 }}>
        {n.kind === 'frame' ? <Button onClick={() => actions.fitFrame(n.id)} data-testid="fit-frame"><Frame size={12} /> Fit to contents</Button> : null}
        <Button onClick={actions.duplicate}><Copy size={12} /> Duplicate</Button>
        <Button onClick={actions.deleteSelection} data-testid="insp-delete"><Trash2 size={12} /> Delete</Button>
      </div>
    </div>
  );
}

function MultiInspector({ ids }: { ids: string[] }) {
  return (
    <div data-testid="inspector-multi">
      <div className="panel-title"><span>{ids.length} selected</span></div>
      <Colors onPick={(c) => actions.setColor(c)} />
      <LayerControls />
      <div className="field"><label>Shape</label><Picker id="multi-shape" label="Shape" grid placeholder="Set shape for all…" options={shapeOptions(NODE_SHAPES)} onPick={(s) => actions.setShape(s)} testId="shape-picker" /></div>
      <div className="field"><label>Align</label>
        <div className="seg">
          <Button title="Align left" aria-label="Align left" data-testid="align-left" onClick={() => actions.align('left')}><AlignLeft size={13} /></Button>
          <Button title="Align centers" aria-label="Align centers" onClick={() => actions.align('center')}><AlignCenterHorizontal size={13} /></Button>
          <Button title="Align right" aria-label="Align right" onClick={() => actions.align('right')}><AlignRight size={13} /></Button>
          <Button title="Align top" aria-label="Align top" data-testid="align-top" onClick={() => actions.align('top')}><AlignStartVertical size={13} /></Button>
          <Button title="Align middles" aria-label="Align middles" onClick={() => actions.align('middle')}><AlignCenterVertical size={13} /></Button>
          <Button title="Align bottom" aria-label="Align bottom" onClick={() => actions.align('bottom')}><AlignEndVertical size={13} /></Button>
        </div>
      </div>
      <div className="field"><label>Distribute & arrange</label>
        <div className="seg">
          <Button onClick={() => actions.distribute('horizontal')} data-testid="distribute-h"><Columns3 size={13} /> Horizontal</Button>
          <Button onClick={() => actions.distribute('vertical')}><Rows3 size={13} /> Vertical</Button>
          <Button onClick={() => actions.layout('graph', 'LR')}>Flow</Button>
          <Button onClick={() => actions.layout('grid')}>Grid</Button>
        </div>
      </div>
      <div className="seg">
        <Button onClick={actions.connectSelected} data-testid="connect-selected">Connect in order</Button>
        <Button onClick={actions.frameSelection} data-testid="frame-selection"><Frame size={12} /> Frame selection</Button>
        <Button onClick={actions.duplicate}><Copy size={12} /> Duplicate</Button>
        <Button onClick={actions.deleteSelection}><Trash2 size={12} /> Delete</Button>
      </div>
    </div>
  );
}

function EdgeInspector({ e }: { e: CanvasEdge }) {
  const up = (patch: Partial<CanvasEdge>) => actions.updateEdge(e.id, patch as never);
  return (
    <div data-testid="inspector-edge">
      <div className="panel-title"><span>Connector</span><span className="kbd">{e.id}</span></div>
      <Text label="Label" value={e.label} onCommit={(v) => up({ label: v })} testId="insp-edge-label" />
      <div className="field-row">
        <Text label="Label X offset" value={String(e.labelOffset?.x ?? 0)} noEmoji onCommit={(v) => { if (v.trim() && Number.isFinite(Number(v))) up({ labelOffset: { x: Number(v), y: e.labelOffset?.y ?? 0 } }); }} />
        <Text label="Label Y offset" value={String(e.labelOffset?.y ?? 0)} noEmoji onCommit={(v) => { if (v.trim() && Number.isFinite(Number(v))) up({ labelOffset: { x: e.labelOffset?.x ?? 0, y: Number(v) } }); }} />
      </div>
      <Button className="btn outline" data-testid="reset-label-position" onClick={() => up({ labelOffset: null as never })}>Reset label position</Button>
      <Button className="btn outline" data-testid="reset-connector-route" disabled={!e.routePoint} onClick={() => up({ routePoint: null as never })}>Reset connector route</Button>
      <LayerControls />
      <Seg label="Routing" options={EDGE_ROUTINGS} value={e.routing} onPick={(v) => up({ routing: v })} testPrefix="routing-" />
      <Seg label="Line" options={EDGE_STYLES} value={e.style} onPick={(v) => up({ style: v })} testPrefix="edgestyle-" />
      <Seg label="Arrows" options={ARROW_MODES} value={e.arrow} onPick={(v) => up({ arrow: v })} testPrefix="arrow-" />
      <Colors value={e.color} onPick={(c) => up({ color: (c ?? null) as never })} />
      <label className="toggle-row"><span>Animated flow</span><Checkbox checked={!!e.animated} data-testid="edge-animated" aria-label="Toggle animation" onChange={() => up({ animated: !e.animated })} /></label>
      <div className="seg" style={{ marginTop: 10 }}>
        <Button onClick={() => actions.reverseEdge(e.id)}><ArrowLeftRight size={12} /> Reverse</Button>
        <Button onClick={actions.deleteSelection}><Trash2 size={12} /> Delete</Button>
      </div>
    </div>
  );
}

function DocInspector() {
  const doc = useApp((s) => s.doc);
  const touch = useApp((s) => s.compact || s.coarse);
  if (!doc) return null;
  const frames = doc.nodes.filter((n) => n.kind === 'frame').length;
  return (
    <div data-testid="inspector-doc">
      <div className="panel-title"><span>Document</span></div>
      <Text label="Title" value={doc.title} onCommit={(v) => actions.renameDocument(v)} />
      <Text label="Description" value={doc.description} multiline onCommit={(v) => actions.describeDocument(v)} />
      <div className="stat-grid">
        <div className="stat"><b>{doc.nodes.length - frames}</b><span>nodes</span></div>
        <div className="stat"><b>{doc.edges.length}</b><span>connectors</span></div>
        <div className="stat"><b>{frames}</b><span>frames</span></div>
        <div className="stat"><b>{doc.nodes.filter((n) => n.parentId).length}</b><span>branch topics</span></div>
      </div>
      <label className="toggle-row"><span>Auto-arrange mind-map branches</span><Checkbox checked={doc.settings.autoArrange} aria-label="Toggle auto-arrange" onChange={() => actions.setDocSettings({ autoArrange: !doc.settings.autoArrange })} /></label>
      <SnapToggle />
      <p className="inspector-empty" style={{ marginTop: 14 }}>
        {touch
          ? <><b>Tip:</b> tap a topic, then use <b>Child</b> and <b>Sibling</b> in the bar above the toolbar. Long-press for more; double-tap empty canvas to add a topic.</>
          : <><b>Tip:</b> select a topic and press <span className="kbd">Tab</span> for a child, <span className="kbd">Enter</span> for a sibling. Drag from a node's edge dot to connect. Double-click a node to edit it right beside it, or empty canvas to add a topic.</>}
      </p>
    </div>
  );
}

function SnapToggle() {
  const snap = useApp((s) => s.session.snapToGrid);
  return <label className="toggle-row"><span>Snap to grid</span><Checkbox checked={snap} aria-label="Toggle snap to grid" data-testid="toggle-snap" onChange={actions.toggleSnap} /></label>;
}

export function Inspector() {
  const doc = useApp((s) => s.doc);
  const selection = useApp((s) => s.selection);
  const nodes = selection.nodes.map((id) => doc?.nodes.find((n) => n.id === id)).filter(Boolean) as CanvasNode[];
  const edge = selection.edges.length === 1 && !nodes.length ? doc?.edges.find((e) => e.id === selection.edges[0]) : undefined;
  return (
    <aside className="panel right" data-testid="inspector" onClick={() => set({ openMenu: null })}>
      <ColumnHeader panel="inspector" title="Inspector" />
      <div className="panel-section grow">
        {nodes.length === 1 ? <NodeInspector key={nodes[0].id} n={nodes[0]} /> : nodes.length > 1 ? <MultiInspector ids={nodes.map((n) => n.id)} /> : edge ? <EdgeInspector key={edge.id} e={edge} /> : <DocInspector />}
      </div>
    </aside>
  );
}

