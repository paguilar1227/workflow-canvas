import { memo, useEffect, useRef, useState, type ReactElement } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { Link2, StickyNote } from 'lucide-react';
import type { CanvasNode } from '../../shared/types';
import * as actions from '../actions';
import { set } from '../store';
import { RoughShape, seedOf, strokePath, useSketch } from './sketch';
import { InlineMarkdown, Markdown, toggleTask } from '../markdown';
import { emojiUiOwns } from '../panels/EmojiAssist';
import { STATUS_GLYPH } from '../panels/Picker';
import { NeonBurst } from './neon';

export interface NodeData extends Record<string, unknown> {
  node: CanvasNode;
  childCount: number;
  childSide: 'right' | 'left' | 'bottom' | null;
  isRoot: boolean;
  editing: boolean;
  flashing: number;
  match: 'none' | 'match' | 'current';
  dropTarget: boolean;
}

const colorVar = (c?: string) => (c && c !== 'default' ? 'var(--c-' + c + ')' : undefined);

function Handles() {
  return (
    <>
      <Handle className="wfc-handle" type="source" position={Position.Top} id="top" />
      <Handle className="wfc-handle" type="source" position={Position.Right} id="right" />
      <Handle className="wfc-handle" type="source" position={Position.Bottom} id="bottom" />
      <Handle className="wfc-handle" type="source" position={Position.Left} id="left" />
    </>
  );
}

export function InlineEdit({ value, multiline, onDone, onTab, className = 'wfc-edit' }: { value: string; multiline?: boolean; onDone: (v: string | null) => void; onTab?: (v: string) => void; className?: string }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => { const el = ref.current; if (el) { el.focus(); el.select(); } }, []);
  useEffect(() => { const el = ref.current; if (el && !multiline) { el.style.height = '0px'; el.style.height = el.scrollHeight + 'px'; } }, [text, multiline]);
  const finish = (v: string | null) => { if (done.current) return; done.current = true; onDone(v); };
  return (
    <textarea
      ref={ref}
      className={className + ' nodrag nowheel nopan'}
      value={text}
      rows={1}
      aria-label="Edit text"
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => { if (!emojiUiOwns(e.relatedTarget)) finish(text); }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
        else if (e.key === 'Enter' && !e.shiftKey && !(multiline && !e.metaKey && !e.ctrlKey)) { e.preventDefault(); finish(text); }
        else if (e.key === 'Tab' && onTab) { e.preventDefault(); done.current = true; onTab(text); }
      }}
    />
  );
}

function commitTitle(n: CanvasNode, v: string | null) {
  set({ editingId: null });
  if (v !== null && v !== n.title) actions.updateNode(n.id, { title: v });
}

function toggle(n: CanvasNode) {
  return (line: number) => actions.updateNode(n.id, { title: toggleTask(n.title, line) });
}

function Markers({ n }: { n: CanvasNode }) {
  const status = n.status && n.status !== 'none' ? n.status : null;
  if (!status && !n.priority) return null;
  return (
    <div className="wfc-markers">
      {n.priority ? <span className="wfc-marker prio" title={'Priority ' + n.priority}>{n.priority}</span> : null}
      {status ? <span className={'wfc-marker st-' + status} title={status}>{STATUS_GLYPH[status]}</span> : null}
    </div>
  );
}

function Indicators({ n }: { n: CanvasNode }) {
  if (!n.notes && !n.link) return null;
  return (
    <div className="wfc-indicators">
      {n.notes ? <span title="Has notes"><StickyNote size={11} /></span> : null}
      {n.link ? <a className="nodrag" href={n.link} target="_blank" rel="noreferrer" title={n.link} onClick={(e) => e.stopPropagation()}><Link2 size={11} /></a> : null}
    </div>
  );
}

function ShapeSvg({ shape }: { shape: string }) {
  let el: ReactElement;
  if (shape === 'diamond') el = <polygon className="fill" points="50,1 99,50 50,99 1,50" />;
  else if (shape === 'circle') el = <ellipse className="fill" cx="50" cy="50" rx="49" ry="49" />;
  else if (shape === 'hexagon') el = <polygon className="fill" points="14,1 86,1 99,50 86,99 14,99 1,50" />;
  else el = (
    <g>
      <path className="fill" d="M1,14 A49,13 0 0,1 99,14 L99,86 A49,13 0 0,1 1,86 Z" />
      <path className="fill" d="M1,14 A49,13 0 0,0 99,14" style={{ fill: 'none' }} />
    </g>
  );
  return <svg className="wfc-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none">{el}</svg>;
}

const SVG_SHAPES = new Set(['diamond', 'circle', 'hexagon', 'cylinder']);

export const TopicNode = memo(function TopicNode({ data, selected, width, height }: NodeProps) {
  const d = data as NodeData;
  const n = d.node;
  const shape = n.shape ?? 'card';
  const sketch = useSketch();
  const svg = SVG_SHAPES.has(shape) && !sketch;
  const cls = ['wfc-node', 'shape-' + shape, n.color && n.color !== 'default' ? 'has-color' : '', d.isRoot ? 'is-root' : '', svg ? 'svg-shape' : '',
    d.match === 'match' ? 'is-match' : '', d.match === 'current' ? 'is-current-match' : '', d.dropTarget ? 'drop-target' : '', d.flashing ? 'flash' : '', sketch ? 'sketch' : ''].filter(Boolean).join(' ');
  return (
    <>
      <NodeResizer isVisible={!!selected && !n.locked} minWidth={60} minHeight={32} onResizeEnd={(_e, p) => actions.updateNode(n.id, { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) })} />
      <div key={d.flashing} className={cls} style={{ ['--nc' as string]: colorVar(n.color) }} data-testid={'node-' + n.id} data-title={n.title}>
        {svg ? <ShapeSvg shape={shape} /> : null}
        {sketch ? <RoughShape shape={shape} w={width ?? n.width} h={height ?? n.height} seed={seedOf(n.id)} filled={!!n.color && n.color !== 'default'} strong={d.isRoot} /> : null}
        <Handles />
        <NeonBurst id={n.id} />
        {n.badge ? <span className="wfc-badge">{n.badge}</span> : null}
        <Markers n={n} />
        {shape === 'card' ? (
          <div className="wfc-icon">{n.icon ? n.icon : <span className="dots"><i /><i /><i /></span>}</div>
        ) : null}
        <div className="wfc-text">
          {d.editing ? (
            <InlineEdit value={n.title} onDone={(v) => commitTitle(n, v)} onTab={(v) => { commitTitle(n, v); actions.addChild(n.id); }} />
          ) : (
            <div className={'wfc-title' + (n.title ? '' : ' placeholder')}>{shape !== 'card' && n.icon ? <span className="wfc-inline-icon">{n.icon}</span> : null}{n.title ? <InlineMarkdown source={n.title} /> : 'Untitled'}</div>
          )}
          {n.subtitle ? <div className="wfc-sub">{n.subtitle}</div> : null}
        </div>
        {n.tags?.length ? <div className="wfc-tags">{n.tags.slice(0, 3).map((t) => <span key={t} className="wfc-tag">#{t}</span>)}</div> : null}
        <Indicators n={n} />
        {d.childCount > 0 && d.childSide ? (
          <button
            className={'wfc-collapse nodrag ' + d.childSide + (n.collapsed ? ' collapsed' : '')}
            title={n.collapsed ? 'Expand branch' : 'Collapse branch'}
            aria-label={n.collapsed ? 'Expand branch' : 'Collapse branch'}
            onClick={(e) => { e.stopPropagation(); actions.toggleCollapse([n.id]); }}
          >{n.collapsed ? '+' + d.childCount : '−'}</button>
        ) : null}
      </div>
    </>
  );
});

export const FrameNode = memo(function FrameNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const n = d.node;
  return (
    <>
      <NodeResizer isVisible={!!selected && !n.locked} minWidth={160} minHeight={100} onResizeEnd={(_e, p) => actions.updateNode(n.id, { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) })} />
      <div className={'wfc-frame' + (n.color && n.color !== 'default' ? ' has-color' : '') + (d.flashing ? ' flash' : '')} key={d.flashing} style={{ ['--nc' as string]: colorVar(n.color) }} data-testid={'frame-' + n.id}>
        <Handles />
        <NeonBurst id={n.id} />
        <div className="wfc-frame-label">
          {d.editing ? (
            <InlineEdit className="wfc-frame-edit" value={n.title} onDone={(v) => commitTitle(n, v)} />
          ) : (
            <span><InlineMarkdown source={n.title || 'Frame'} />{n.subtitle ? ' · ' + n.subtitle : ''}</span>
          )}
        </div>
      </div>
    </>
  );
});

export const StickyNode = memo(function StickyNode({ data, selected, width, height }: NodeProps) {
  const d = data as NodeData;
  const n = d.node;
  const sketch = useSketch();
  return (
    <>
      <NodeResizer isVisible={!!selected && !n.locked} minWidth={80} minHeight={60} onResizeEnd={(_e, p) => actions.updateNode(n.id, { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) })} />
      <div className={'wfc-sticky' + (n.color && n.color !== 'default' ? ' has-color' : '') + (d.flashing ? ' flash' : '')} key={d.flashing} style={{ ['--nc' as string]: colorVar(n.color) }} data-testid={'node-' + n.id}>
        {sketch ? <RoughShape shape="sticky" w={width ?? n.width} h={height ?? n.height} seed={seedOf(n.id)} filled={false} /> : null}
        <Handles />
        <NeonBurst id={n.id} />
        {d.editing ? <InlineEdit multiline value={n.title} onDone={(v) => commitTitle(n, v)} /> : n.title ? <Markdown className="sticky-text" source={n.title} onToggleTask={toggle(n)} rowTaps={!!selected} /> : <span className="placeholder">Double-click to write…</span>}
      </div>
    </>
  );
});

export const TextNode = memo(function TextNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const n = d.node;
  return (
    <>
      <NodeResizer isVisible={!!selected && !n.locked} minWidth={40} minHeight={24} onResizeEnd={(_e, p) => actions.updateNode(n.id, { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) })} />
      <div className={'wfc-text-node' + (n.color && n.color !== 'default' ? ' has-color' : '')} style={{ ['--nc' as string]: colorVar(n.color) }} data-testid={'node-' + n.id}>
        <Handles />
        <NeonBurst id={n.id} />
        {d.editing ? <InlineEdit value={n.title} onDone={(v) => commitTitle(n, v)} /> : n.title ? <Markdown source={n.title} onToggleTask={toggle(n)} rowTaps={!!selected} /> : 'Text'}
      </div>
    </>
  );
});

/** Drawn 1:1 in its own box so the stroke stays exactly where it was drawn; only an explicit resize scales it. */
function drawingPath(pts: [number, number][], w: number, h: number) {
  const natW = Math.max(4, Math.round(Math.max(0, ...pts.map((p) => p[0])))), natH = Math.max(4, Math.round(Math.max(0, ...pts.map((p) => p[1]))));
  const sx = Math.abs(w - natW) <= 1 ? 1 : w / natW, sy = Math.abs(h - natH) <= 1 ? 1 : h / natH;
  return strokePath(sx === 1 && sy === 1 ? pts : pts.map(([x, y]) => [x * sx, y * sy] as [number, number]));
}

export const DrawingNode = memo(function DrawingNode({ data, selected, width, height }: NodeProps) {
  const d = data as NodeData;
  const n = d.node;
  const pts = n.points ?? [];
  const w = width ?? n.width, h = height ?? n.height;
  return (
    <>
      <NodeResizer isVisible={!!selected && !n.locked} minWidth={8} minHeight={8} onResizeEnd={(_e, p) => actions.updateNode(n.id, { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) })} />
      <div className={'wfc-drawing' + (d.flashing ? ' flash' : '')} key={d.flashing} style={{ ['--nc' as string]: colorVar(n.color) }} data-testid={'node-' + n.id}>
        <Handles />
        <svg width={w} height={h} viewBox={'0 0 ' + w + ' ' + h}>
          <path d={drawingPath(pts, w, h)} className="wfc-stroke" />
        </svg>
      </div>
    </>
  );
});

export const nodeTypes = { topic: TopicNode, frame: FrameNode, sticky: StickyNode, text: TextNode, drawing: DrawingNode };

