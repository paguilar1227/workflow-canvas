import { useState } from 'react';
import { Plus, Copy, Trash2, ChevronRight, ChevronDown, FileText } from 'lucide-react';
import { useApp, set } from '../store';
import * as actions from '../actions';
import { openDocument } from '../sync';
import { childrenMap } from '../../shared/graph';
import type { CanvasNode } from '../../shared/types';
import { Menu, MenuItem } from './TopBar';

function OutlineNode({ n, depth, kids }: { n: CanvasNode; depth: number; kids: Map<string, CanvasNode[]> }) {
  const selected = useApp((s) => s.selection.nodes.includes(n.id));
  const children = kids.get(n.id) ?? [];
  const [editing, setEditing] = useState(false);
  return (
    <>
      <div
        className={'outline-row' + (selected ? ' selected' : '')}
        style={{ paddingLeft: 4 + depth * 14 }}
        data-testid={'outline-' + n.id}
        onClick={() => { actions.select([n.id]); actions.focusNodes([n.id]); }}
        onDoubleClick={() => setEditing(true)}
      >
        {children.length ? (
          <button className="twisty" aria-label={n.collapsed ? 'Expand' : 'Collapse'} onClick={(e) => { e.stopPropagation(); actions.toggleCollapse([n.id]); }}>
            {n.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : <span className="twisty" />}
        {n.color && n.color !== 'default' ? <span className="swatch" style={{ background: 'var(--c-' + n.color + ')' }} /> : null}
        {editing ? (
          <input autoFocus defaultValue={n.title} style={{ flex: 1, background: 'var(--panel-2)', border: '1px solid var(--selection)', borderRadius: 4, padding: '1px 4px' }}
            onBlur={(e) => { setEditing(false); if (e.target.value !== n.title) actions.updateNode(n.id, { title: e.target.value }); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
        ) : <span className="label">{n.icon ? n.icon + ' ' : ''}{n.title || (n.kind === 'sticky' ? 'Sticky note' : n.kind === 'drawing' ? '✏️ Freehand drawing' : 'Untitled')}</span>}
      </div>
      {!n.collapsed && children.map((c) => <OutlineNode key={c.id} n={c} depth={depth + 1} kids={kids} />)}
    </>
  );
}

export function LeftPanel() {
  const documents = useApp((s) => s.documents);
  const docId = useApp((s) => s.docId);
  const doc = useApp((s) => s.doc);
  const kids = doc ? childrenMap(doc) : new Map();
  const frames = doc ? doc.nodes.filter((n) => n.kind === 'frame').sort((a, b) => a.x - b.x || a.y - b.y) : [];
  const byPos = (a: CanvasNode, b: CanvasNode) => a.y - b.y || a.x - b.x;
  const roots = doc ? doc.nodes.filter((n) => n.kind !== 'frame' && (!n.parentId || !doc.nodes.some((p) => p.id === n.parentId))) : [];
  const loose = roots.filter((n) => !n.frameId || !frames.some((f) => f.id === n.frameId)).sort(byPos);

  return (
    <aside className="panel" data-testid="left-panel" onClick={() => set({ openMenu: null })}>
      <div className="panel-section">
        <div className="panel-title">
          <span>Documents</span>
          <Menu id="new-doc" icon={<Plus size={14} />} align="left" testId="new-doc">
            <div className="menu-label">New from template</div>
            <MenuItem testId="new-blank" onClick={() => actions.createDocument('Untitled canvas', 'blank')}>Blank canvas</MenuItem>
            <MenuItem testId="new-mindmap" onClick={() => actions.createDocument('New mind map', 'mindmap')}>Mind map</MenuItem>
            <MenuItem testId="new-architecture" onClick={() => actions.createDocument('New architecture', 'architecture')}>Architecture (lanes)</MenuItem>
            <MenuItem testId="new-workflow" onClick={() => actions.createDocument('New workflow', 'workflow')}>Workflow</MenuItem>
          </Menu>
        </div>
        <div className="doc-list">
          {documents.map((d) => (
            <div key={d.id} className={'doc-item' + (d.id === docId ? ' active' : '')} data-testid={'doc-' + d.id} onClick={() => d.id !== docId && openDocument(d.id)}>
              <FileText size={13} />
              <span className="name" title={d.title}>{d.title}</span>
              <span className="meta">{d.nodeCount}</span>
              <span className="doc-actions">
                <button title="Duplicate" aria-label={'Duplicate ' + d.title} onClick={(e) => { e.stopPropagation(); actions.duplicateDocument(d.id); }}><Copy size={12} /></button>
                <button title="Delete" aria-label={'Delete ' + d.title} onClick={(e) => { e.stopPropagation(); actions.deleteDocument(d.id); }}><Trash2 size={12} /></button>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel-section grow outline" data-testid="outline">
        <div className="panel-title"><span>Outline</span></div>
        {!doc || !doc.nodes.length ? <div className="outline-empty">Empty canvas. Double-click the canvas or press N to add a topic.</div> : null}
        {frames.map((f) => (
          <div key={f.id}>
            <div className="outline-row frame-row" onClick={() => { actions.select([f.id]); actions.focusNodes([f.id]); }} data-testid={'outline-' + f.id}>{f.title || 'Frame'}</div>
            {roots.filter((n) => n.frameId === f.id).sort(byPos).map((n) => <OutlineNode key={n.id} n={n} depth={0} kids={kids} />)}
          </div>
        ))}
        {frames.length && loose.length ? <div className="outline-row frame-row">Unframed</div> : null}
        {loose.map((n) => <OutlineNode key={n.id} n={n} depth={0} kids={kids} />)}
      </div>
    </aside>
  );
}

