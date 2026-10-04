import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Plus, Copy, Trash2, ChevronRight, ChevronDown, FileText } from 'lucide-react';
import { useApp, set } from '../store';
import * as actions from '../actions';
import { openDocument } from '../sync';
import { childrenMap } from '../../shared/graph';
import type { CanvasNode } from '../../shared/types';
import { Menu, MenuItem } from './TopBar';
import { ColumnHeader } from './Chrome';
import { InlineMarkdown, firstLine } from '../markdown';
import { emojiUiOwns } from './EmojiAssist';

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
        onClick={() => { actions.select([n.id]); actions.focusNodes([n.id]); actions.revealCanvas(); }}
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
            onBlur={(e) => { if (emojiUiOwns(e.relatedTarget)) return; setEditing(false); if (e.target.value !== n.title) actions.updateNode(n.id, { title: e.target.value }); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
        ) : <span className="label">{n.icon ? n.icon + ' ' : ''}{n.title ? <InlineMarkdown source={firstLine(n.title)} /> : (n.kind === 'sticky' ? 'Sticky note' : n.kind === 'drawing' ? '✏️ Freehand drawing' : 'Untitled')}</span>}
      </div>
      {!n.collapsed && children.map((c) => <OutlineNode key={c.id} n={c} depth={depth + 1} kids={kids} />)}
    </>
  );
}

const DOCS_HEIGHT_KEY = 'wfc-docs-height';

/**
 * Lets the person drag (or arrow-key) the line between Documents and Outline. Bounds come from the layout:
 * at least one document row, at most the list's own content, and the outline keeps its title and one row.
 * The height is remembered on this device; double-click or Enter resets it.
 */
type DocsMetrics = { min: number; max: number; now: number };

function useDocsHeight(panelRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLDivElement | null>, docCount: number) {
  /** What the person chose (remembered), and what fits the panel right now; layout changes never overwrite the choice. */
  const [pref, setPref] = useState<number | null>(() => { const v = Number(localStorage.getItem(DOCS_HEIGHT_KEY)); return v > 0 ? v : null; });
  const [fitted, setFitted] = useState<number | null>(pref);
  const [metrics, setMetrics] = useState<DocsMetrics | null>(null);
  /** The stylesheet's default size, read while no size is applied inline. */
  const cssDefault = useRef<number | null>(null);
  const bounds = useCallback(() => {
    const list = listRef.current, outline = panelRef.current?.querySelector<HTMLElement>('.outline');
    if (!list || !outline) return null;
    const last = list.lastElementChild as HTMLElement | null;
    const content = last ? last.offsetTop + last.offsetHeight : 0;
    const row = list.querySelector<HTMLElement>('.doc-item')?.offsetHeight ?? 0;
    const title = outline.querySelector<HTMLElement>('.panel-title');
    const firstRow = outline.querySelector<HTMLElement>('.outline-row, .outline-empty');
    const cs = getComputedStyle(outline);
    const keep = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + (title ? title.offsetHeight + parseFloat(getComputedStyle(title).marginBottom) : 0) + (firstRow?.offsetHeight ?? 0);
    // Room comes from where the outline actually starts and where the panel ends, so a shorter window re-clamps in one pass.
    const room = list.clientHeight + panelRef.current!.getBoundingClientRect().bottom - outline.getBoundingClientRect().top - keep;
    const max = Math.max(0, Math.min(content, room));
    return { min: Math.min(row, max), max, step: row || 1, now: list.clientHeight, content };
  }, [panelRef, listRef]);
  const clamp = useCallback((h: number) => { const b = bounds(); return Math.round(b ? Math.max(b.min, Math.min(b.max, h)) : h); }, [bounds]);
  const apply = useCallback((h: number | null) => {
    if (h === null) { setPref(null); setFitted(null); localStorage.removeItem(DOCS_HEIGHT_KEY); return; }
    const v = clamp(h);
    setPref(v); setFitted(v);
    localStorage.setItem(DOCS_HEIGHT_KEY, String(v));
  }, [clamp]);
  const measure = useCallback(() => {
    const b = bounds();
    setMetrics((m) => (!b || (m && m.min === b.min && m.max === b.max && m.now === b.now) ? m : { min: b.min, max: b.max, now: b.now }));
  }, [bounds]);
  /** Fit the chosen size, or the default size on a short screen, into the room the panel has now. */
  const fit = useCallback(() => {
    const list = listRef.current, b = bounds();
    if (!list || !b) return;
    if (pref !== null) { setFitted(Math.round(Math.max(b.min, Math.min(b.max, pref)))); return; }
    if (cssDefault.current === null && !list.style.height) cssDefault.current = parseFloat(getComputedStyle(list).maxHeight) || Infinity;
    setFitted(Math.min(b.content, cssDefault.current ?? Infinity) > b.max ? Math.round(Math.max(b.min, b.max)) : null);
  }, [bounds, listRef, pref]);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    fit();
    const ro = new ResizeObserver(() => { fit(); measure(); });
    ro.observe(panel);
    return () => ro.disconnect();
  }, [panelRef, fit, measure, docCount]);
  // Screen-reader values are read from the layout after each change, not during render.
  useLayoutEffect(measure);
  return { height: fitted, apply, bounds, metrics };
}

function DocsSplitter({ docs }: { docs: ReturnType<typeof useDocsHeight> }) {
  const [dragging, setDragging] = useState(false);
  const b = docs.metrics;
  return (
    <div
      className={'panel-splitter' + (dragging ? ' dragging' : '')}
      role="separator" aria-orientation="horizontal" aria-label="Resize the documents list" tabIndex={0} data-testid="docs-splitter"
      aria-valuemin={b?.min} aria-valuemax={b?.max} aria-valuenow={b?.now}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        const start = docs.bounds();
        if (!start || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        const el = e.currentTarget, y0 = e.clientY, h0 = start.now;
        el.setPointerCapture(e.pointerId);
        setDragging(true);
        const move = (ev: PointerEvent) => docs.apply(h0 + ev.clientY - y0);
        const end = () => { setDragging(false); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
      }}
      onDoubleClick={() => docs.apply(null)}
      onKeyDown={(e) => {
        const k = docs.bounds();
        if (!k) return;
        const to = e.key === 'ArrowUp' ? k.now - k.step : e.key === 'ArrowDown' ? k.now + k.step : e.key === 'Home' ? k.min : e.key === 'End' ? k.max : undefined;
        if (to !== undefined) { e.preventDefault(); e.stopPropagation(); docs.apply(to); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); docs.apply(null); }
      }}
    >
      <span className="grip" />
    </div>
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
  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const docs = useDocsHeight(panelRef, listRef, documents.length);

  return (
    <aside className="panel" data-testid="left-panel" ref={panelRef} onClick={() => set({ openMenu: null })}>
      <ColumnHeader panel="outline" title="Documents & outline" />
      <div className="panel-section">
        <div className="panel-title">
          <span>Documents</span>
          <Menu id="new-doc" icon={<Plus size={14} />} align="left" testId="new-doc">
            <div className="menu-label">New from template</div>
            <MenuItem testId="new-blank" onClick={() => { actions.createDocument('Untitled canvas', 'blank'); actions.revealCanvas(); }}>Blank canvas</MenuItem>
            <MenuItem testId="new-mindmap" onClick={() => { actions.createDocument('New mind map', 'mindmap'); actions.revealCanvas(); }}>Mind map</MenuItem>
            <MenuItem testId="new-architecture" onClick={() => { actions.createDocument('New architecture', 'architecture'); actions.revealCanvas(); }}>Architecture (lanes)</MenuItem>
            <MenuItem testId="new-workflow" onClick={() => { actions.createDocument('New workflow', 'workflow'); actions.revealCanvas(); }}>Workflow</MenuItem>
          </Menu>
        </div>
        <div className="doc-list" ref={listRef} data-testid="doc-list" style={docs.height !== null ? { height: docs.height, maxHeight: 'none' } : undefined}>
          {documents.map((d) => (
            <div key={d.id} className={'doc-item' + (d.id === docId ? ' active' : '')} data-testid={'doc-' + d.id} onClick={() => { if (d.id !== docId) openDocument(d.id); actions.revealCanvas(); }}>
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
      <DocsSplitter docs={docs} />
      <div className="panel-section grow outline" data-testid="outline">
        <div className="panel-title"><span>Outline</span></div>
        {!doc || !doc.nodes.length ? <div className="outline-empty">Empty canvas. Double-click the canvas or press N to add a topic.</div> : null}
        {frames.map((f) => (
          <div key={f.id}>
            <div className="outline-row frame-row" onClick={() => { actions.select([f.id]); actions.focusNodes([f.id]); actions.revealCanvas(); }} data-testid={'outline-' + f.id}><InlineMarkdown source={f.title || 'Frame'} /></div>
            {roots.filter((n) => n.frameId === f.id).sort(byPos).map((n) => <OutlineNode key={n.id} n={n} depth={0} kids={kids} />)}
          </div>
        ))}
        {frames.length && loose.length ? <div className="outline-row frame-row">Unframed</div> : null}
        {loose.map((n) => <OutlineNode key={n.id} n={n} depth={0} kids={kids} />)}
      </div>
    </aside>
  );
}

