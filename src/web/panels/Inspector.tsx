import { useEffect, useState, type KeyboardEvent } from 'react';
import { AlignLeft, AlignCenterHorizontal, AlignRight, AlignStartVertical, AlignCenterVertical, AlignEndVertical, Columns3, Rows3, Frame, Link as LinkIcon, Trash2, Copy, ArrowLeftRight } from 'lucide-react';
import { useApp } from '../store';
import * as actions from '../actions';
import { ColumnHeader } from './Chrome';
import { COLOR_NAMES, NODE_SHAPES, NODE_STATUSES, EDGE_ROUTINGS, EDGE_STYLES, ARROW_MODES, type CanvasNode, type CanvasEdge, type ColorName } from '../../shared/types';

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
  return <div className="field"><label>{label}</label>{multiline ? <textarea {...common} /> : <input {...common} />}</div>;
}

function Colors({ value, onPick }: { value?: string; onPick: (c: ColorName | null) => void }) {
  return (
    <div className="field"><label>Color</label>
      <div className="swatches">
        {COLOR_NAMES.map((c) => (
          <button key={c} className={'swatch-btn' + ((value ?? 'default') === c ? ' on' : '')} data-testid={'color-' + c} title={c} aria-label={'Color ' + c}
            style={{ background: c === 'default' ? 'var(--node-bg)' : 'var(--c-' + c + ')' }} onClick={() => onPick(c === 'default' ? null : c)} />
        ))}
      </div>
    </div>
  );
}

function Seg<T extends string>({ label, options, value, onPick, testPrefix }: { label: string; options: readonly T[]; value?: T; onPick: (v: T) => void; testPrefix?: string }) {
  return (
    <div className="field"><label>{label}</label>
      <div className="seg">{options.map((o) => <button key={o} data-testid={testPrefix ? testPrefix + o : undefined} className={value === o ? 'on' : ''} onClick={() => onPick(o)}>{o}</button>)}</div>
    </div>
  );
}

function NodeInspector({ n }: { n: CanvasNode }) {
  const up = (patch: Partial<CanvasNode>) => actions.updateNode(n.id, patch as never);
  return (
    <div data-testid="inspector-node">
      <div className="panel-title"><span>{n.kind === 'frame' ? 'Frame' : n.kind === 'sticky' ? 'Sticky note' : n.kind === 'text' ? 'Text' : n.kind === 'drawing' ? 'Drawing' : 'Topic'}</span><span className="kbd">{n.id}</span></div>
      <Text label="Title" value={n.title} onCommit={(v) => up({ title: v })} testId="insp-title" multiline={n.kind === 'sticky' || n.kind === 'text'} placeholder={n.kind === 'sticky' || n.kind === 'text' ? 'Markdown and :emoji: supported' : undefined} />
      {n.kind !== 'sticky' ? <Text label={n.kind === 'frame' ? 'Subtitle' : 'Subtitle (monospace line)'} value={n.subtitle} mono onCommit={(v) => up({ subtitle: v })} testId="insp-subtitle" /> : null}
      {n.kind === 'topic' ? (
        <div className="field-row">
          <Text label="Badge" value={n.badge} onCommit={(v) => up({ badge: v })} testId="insp-badge" placeholder="e.g. Proposed" />
          <Text label="Icon (emoji)" value={n.icon} onCommit={(v) => up({ icon: v })} testId="insp-icon" placeholder="e.g. ⚙️" />
        </div>
      ) : null}
      <Colors value={n.color} onPick={(c) => actions.setColor(c)} />
      {n.kind === 'topic' ? <Seg label="Shape" options={NODE_SHAPES} value={n.shape} onPick={(s) => actions.setShape(s)} testPrefix="shape-" /> : null}
      {n.kind === 'topic' ? <Seg label="Status" options={NODE_STATUSES} value={n.status ?? 'none'} onPick={(s) => actions.setStatus(s)} testPrefix="status-" /> : null}
      {n.kind === 'topic' ? (
        <div className="field"><label>Priority</label>
          <div className="seg">{[0, 1, 2, 3, 4, 5].map((p) => <button key={p} className={(n.priority ?? 0) === p ? 'on' : ''} onClick={() => up({ priority: p })}>{p === 0 ? '—' : 'P' + p}</button>)}</div>
        </div>
      ) : null}
      {n.kind !== 'frame' ? <Text label="Tags (comma separated)" value={(n.tags ?? []).join(', ')} onCommit={(v) => up({ tags: v.split(',').map((t) => t.trim()).filter(Boolean) })} testId="insp-tags" /> : null}
      <Text label="Link" value={n.link} onCommit={(v) => up({ link: v })} testId="insp-link" placeholder="https://" noEmoji />
      <Text label="Notes" value={n.notes} multiline onCommit={(v) => up({ notes: v })} testId="insp-notes" />
      <div className="field-row">
        <Text label="Width" value={String(n.width)} onCommit={(v) => Number(v) > 0 && up({ width: Number(v) })} noEmoji />
        <Text label="Height" value={String(n.height)} onCommit={(v) => Number(v) > 0 && up({ height: Number(v) })} noEmoji />
      </div>
      <div className="toggle-row"><span>Locked</span><button className={'switch' + (n.locked ? ' on' : '')} aria-label="Toggle lock" onClick={() => up({ locked: !n.locked })} /></div>
      {n.link ? <a className="btn outline" href={n.link} target="_blank" rel="noreferrer"><LinkIcon size={14} />Open link</a> : null}
      <div className="seg" style={{ marginTop: 10 }}>
        {n.kind === 'frame' ? <button onClick={() => actions.fitFrame(n.id)} data-testid="fit-frame"><Frame size={12} /> Fit to contents</button> : null}
        <button onClick={actions.duplicate}><Copy size={12} /> Duplicate</button>
        <button onClick={actions.deleteSelection} data-testid="insp-delete"><Trash2 size={12} /> Delete</button>
      </div>
    </div>
  );
}

function MultiInspector({ ids }: { ids: string[] }) {
  return (
    <div data-testid="inspector-multi">
      <div className="panel-title"><span>{ids.length} selected</span></div>
      <Colors onPick={(c) => actions.setColor(c)} />
      <Seg label="Shape" options={NODE_SHAPES} onPick={(s) => actions.setShape(s)} />
      <div className="field"><label>Align</label>
        <div className="seg">
          <button title="Align left" aria-label="Align left" data-testid="align-left" onClick={() => actions.align('left')}><AlignLeft size={13} /></button>
          <button title="Align centers" aria-label="Align centers" onClick={() => actions.align('center')}><AlignCenterHorizontal size={13} /></button>
          <button title="Align right" aria-label="Align right" onClick={() => actions.align('right')}><AlignRight size={13} /></button>
          <button title="Align top" aria-label="Align top" data-testid="align-top" onClick={() => actions.align('top')}><AlignStartVertical size={13} /></button>
          <button title="Align middles" aria-label="Align middles" onClick={() => actions.align('middle')}><AlignCenterVertical size={13} /></button>
          <button title="Align bottom" aria-label="Align bottom" onClick={() => actions.align('bottom')}><AlignEndVertical size={13} /></button>
        </div>
      </div>
      <div className="field"><label>Distribute & arrange</label>
        <div className="seg">
          <button onClick={() => actions.distribute('horizontal')} data-testid="distribute-h"><Columns3 size={13} /> Horizontal</button>
          <button onClick={() => actions.distribute('vertical')}><Rows3 size={13} /> Vertical</button>
          <button onClick={() => actions.layout('graph', 'LR')}>Flow</button>
          <button onClick={() => actions.layout('grid')}>Grid</button>
        </div>
      </div>
      <div className="seg">
        <button onClick={actions.connectSelected} data-testid="connect-selected">Connect in order</button>
        <button onClick={actions.frameSelection} data-testid="frame-selection"><Frame size={12} /> Frame selection</button>
        <button onClick={actions.duplicate}><Copy size={12} /> Duplicate</button>
        <button onClick={actions.deleteSelection}><Trash2 size={12} /> Delete</button>
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
      <Seg label="Routing" options={EDGE_ROUTINGS} value={e.routing} onPick={(v) => up({ routing: v })} testPrefix="routing-" />
      <Seg label="Line" options={EDGE_STYLES} value={e.style} onPick={(v) => up({ style: v })} testPrefix="edgestyle-" />
      <Seg label="Arrows" options={ARROW_MODES} value={e.arrow} onPick={(v) => up({ arrow: v })} testPrefix="arrow-" />
      <Colors value={e.color} onPick={(c) => up({ color: (c ?? null) as never })} />
      <div className="toggle-row"><span>Animated flow</span><button className={'switch' + (e.animated ? ' on' : '')} data-testid="edge-animated" aria-label="Toggle animation" onClick={() => up({ animated: !e.animated })} /></div>
      <div className="seg" style={{ marginTop: 10 }}>
        <button onClick={() => actions.reverseEdge(e.id)}><ArrowLeftRight size={12} /> Reverse</button>
        <button onClick={actions.deleteSelection}><Trash2 size={12} /> Delete</button>
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
      <div className="toggle-row"><span>Auto-arrange mind-map branches</span><button className={'switch' + (doc.settings.autoArrange ? ' on' : '')} aria-label="Toggle auto-arrange" onClick={() => actions.setDocSettings({ autoArrange: !doc.settings.autoArrange })} /></div>
      <SnapToggle />
      <p className="inspector-empty" style={{ marginTop: 14 }}>
        {touch
          ? <><b>Tip:</b> tap a topic, then use <b>Child</b> and <b>Sibling</b> in the bar above the toolbar. Long-press for more; double-tap empty canvas to add a topic.</>
          : <><b>Tip:</b> select a topic and press <span className="kbd">Tab</span> for a child, <span className="kbd">Enter</span> for a sibling. Drag from a node's edge dot to connect. Double-click empty canvas to add a topic.</>}
      </p>
    </div>
  );
}

function SnapToggle() {
  const snap = useApp((s) => s.session.snapToGrid);
  return <div className="toggle-row"><span>Snap to grid</span><button className={'switch' + (snap ? ' on' : '')} aria-label="Toggle snap to grid" data-testid="toggle-snap" onClick={actions.toggleSnap} /></div>;
}

export function Inspector() {
  const doc = useApp((s) => s.doc);
  const selection = useApp((s) => s.selection);
  const nodes = selection.nodes.map((id) => doc?.nodes.find((n) => n.id === id)).filter(Boolean) as CanvasNode[];
  const edge = selection.edges.length === 1 && !nodes.length ? doc?.edges.find((e) => e.id === selection.edges[0]) : undefined;
  return (
    <aside className="panel right" data-testid="inspector">
      <ColumnHeader panel="inspector" title="Inspector" />
      <div className="panel-section grow">
        {nodes.length === 1 ? <NodeInspector key={nodes[0].id} n={nodes[0]} /> : nodes.length > 1 ? <MultiInspector ids={nodes.map((n) => n.id)} /> : edge ? <EdgeInspector key={edge.id} e={edge} /> : <DocInspector />}
      </div>
    </aside>
  );
}

