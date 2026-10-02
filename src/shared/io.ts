import type { CanvasDocument, CanvasNode, NodeShape } from './types';
import { applyCommand, normalizeCommand, type CommandInput, type EdgeInput, type NodeInput } from './commands';
import { childrenMap } from './graph';
import { importExcalidraw } from './excalidraw';
import { edgeInputSchema, nodeInputSchema } from './schema';

const sortByPos = (a: CanvasNode, b: CanvasNode) => (a.y - b.y) || (a.x - b.x);

export function exportMarkdown(doc: CanvasDocument): string {
  const kids = childrenMap(doc);
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const lines: string[] = ['# ' + doc.title];
  if (doc.description) lines.push('', '> ' + doc.description);
  const line = (n: CanvasNode, depth: number) => {
    const bits = [n.kind === 'sticky' ? '📝 ' + n.title : '**' + (n.title || 'Untitled') + '**'];
    if (n.subtitle) bits.push('— ' + n.subtitle);
    if (n.badge) bits.push('[' + n.badge + ']');
    if (n.status && n.status !== 'none') bits.push('(' + n.status + ')');
    if (n.priority) bits.push('P' + n.priority);
    if (n.tags?.length) bits.push(n.tags.map((t) => '#' + t.replace(/\s+/g, '-')).join(' '));
    if (n.link) bits.push('<' + n.link + '>');
    lines.push('  '.repeat(depth) + '- ' + bits.join(' '));
    if (n.notes) for (const l of n.notes.split('\n')) lines.push('  '.repeat(depth + 1) + '> ' + l);
    for (const c of kids.get(n.id) ?? []) line(c, depth + 1);
  };
  const roots = doc.nodes.filter((n) => n.kind !== 'frame' && (!n.parentId || !byId.has(n.parentId)));
  const frames = doc.nodes.filter((n) => n.kind === 'frame').sort((a, b) => a.x - b.x);
  for (const f of frames) {
    lines.push('', '## ' + (f.title || 'Frame') + (f.subtitle ? ' · ' + f.subtitle : ''));
    for (const r of roots.filter((n) => n.frameId === f.id).sort(sortByPos)) line(r, 0);
  }
  const loose = roots.filter((n) => !n.frameId || !byId.has(n.frameId)).sort(sortByPos);
  if (loose.length) {
    if (frames.length) lines.push('', '## Other');
    else lines.push('');
    for (const r of loose) line(r, 0);
  }
  if (doc.edges.length) {
    lines.push('', '## Connections');
    for (const e of doc.edges) {
      const s = byId.get(e.source)?.title ?? e.source, t = byId.get(e.target)?.title ?? e.target;
      lines.push('- ' + s + (e.arrow === 'both' ? ' ↔ ' : e.arrow === 'none' ? ' — ' : ' → ') + t + (e.label ? ': ' + e.label : ''));
    }
  }
  return lines.join('\n') + '\n';
}

const SHAPE_TO_MERMAID: Record<string, [string, string]> = {
  card: ['["', '"]'], rounded: ['("', '")'], rectangle: ['["', '"]'], pill: ['(["', '"])'], diamond: ['{"', '"}'],
  circle: ['(("', '"))'], hexagon: ['{{"', '"}}'], cylinder: ['[("', '")]'],
};

export function exportMermaid(doc: CanvasDocument, direction = 'LR'): string {
  const safe = new Map<string, string>();
  doc.nodes.forEach((n, i) => safe.set(n.id, /^[A-Za-z][A-Za-z0-9_]*$/.test(n.id) ? n.id : 'n' + i));
  const label = (n: CanvasNode) => (n.title || ' ').replace(/"/g, "'") + (n.subtitle ? '<br/><small>' + n.subtitle.replace(/"/g, "'") + '</small>' : '');
  const out = ['flowchart ' + direction];
  const def = (n: CanvasNode, indent: string) => {
    const [a, b] = SHAPE_TO_MERMAID[n.shape ?? 'card'] ?? SHAPE_TO_MERMAID.card;
    out.push(indent + safe.get(n.id) + a + label(n) + b);
  };
  const frames = doc.nodes.filter((n) => n.kind === 'frame');
  for (const f of frames) {
    out.push('  subgraph ' + safe.get(f.id) + ' ["' + (f.title || 'Frame').replace(/"/g, "'") + '"]');
    for (const n of doc.nodes.filter((m) => m.frameId === f.id && m.kind !== 'frame')) def(n, '    ');
    out.push('  end');
  }
  for (const n of doc.nodes.filter((m) => m.kind !== 'frame' && (!m.frameId || !frames.some((f) => f.id === m.frameId)))) def(n, '  ');
  for (const n of doc.nodes) if (n.parentId && safe.has(n.parentId)) out.push('  ' + safe.get(n.parentId) + ' --- ' + safe.get(n.id));
  for (const e of doc.edges) {
    const op = e.style === 'dashed' || e.style === 'dotted' ? (e.arrow === 'none' ? '-.-' : '-.->') : e.arrow === 'none' ? '---' : e.arrow === 'both' ? '<-->' : '-->';
    out.push('  ' + safe.get(e.source) + ' ' + op + (e.label ? '|"' + e.label.replace(/"/g, "'") + '"|' : '') + ' ' + safe.get(e.target));
  }
  return out.join('\n') + '\n';
}

/** Markdown outline (headings + nested bullets) -> mind-map nodes. */
export function importMarkdown(text: string, idPrefix: string): NodeInput[] {
  const out: NodeInput[] = [];
  const stack: { level: number; id: string }[] = [];
  let i = 0;
  let headingDepth = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(rawLine.trim());
    const b = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(rawLine);
    let level: number; let title: string;
    if (h) { level = h[1].length; headingDepth = level; title = h[2]; }
    else if (b) { level = headingDepth + 1 + Math.floor(b[1].replace(/\t/g, '  ').length / 2); title = b[2]; }
    else continue;
    title = title.replace(/\*\*(.*?)\*\*/g, '$1').replace(/^\[[ xX]\]\s*/, '').trim();
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const id = idPrefix + (++i);
    const parent = stack[stack.length - 1];
    const node: NodeInput = { id, title };
    if (parent) node.parentId = parent.id;
    else node.shape = 'pill';
    out.push(node);
    stack.push({ level, id });
  }
  return out;
}

export interface MermaidImport { direction: 'LR' | 'TB' | 'RL' | 'BT'; nodes: NodeInput[]; edges: EdgeInput[] }

const OPENERS: [string, string, NodeShape][] = [
  ['(((', ')))', 'circle'], ['((', '))', 'circle'], ['([', '])', 'pill'], ['[(', ')]', 'cylinder'], ['[[', ']]', 'rectangle'],
  ['{{', '}}', 'hexagon'], ['[/', '/]', 'rectangle'], ['[\\', '\\]', 'rectangle'], ['[', ']', 'rectangle'], ['(', ')', 'rounded'], ['{', '}', 'diamond'], ['>', ']', 'rectangle'],
];

export function importMermaid(text: string, idPrefix: string): MermaidImport {
  const res: MermaidImport = { direction: 'LR', nodes: [], edges: [] };
  const known = new Map<string, NodeInput>();
  const frameStack: string[] = [];
  let edgeN = 0;
  const idFor = (raw: string) => idPrefix + raw;
  const ensure = (raw: string, label?: string, shape?: NodeShape) => {
    const id = idFor(raw);
    let n = known.get(id);
    if (!n) {
      n = { id, title: label ?? raw, shape: shape ?? 'rounded' };
      if (frameStack.length) n.frameId = frameStack[frameStack.length - 1];
      known.set(id, n); res.nodes.push(n);
    } else if (label !== undefined) { n.title = label; if (shape) n.shape = shape; }
    return id;
  };
  const clean = (s: string) => s.trim().replace(/^"(.*)"$/, '$1').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/%%.*$/, '').trim().replace(/;$/, '');
    if (!line) continue;
    const head = /^(?:flowchart|graph)\s+(LR|RL|TB|TD|BT)?/i.exec(line);
    if (head) { const d = (head[1] ?? 'LR').toUpperCase(); res.direction = (d === 'TD' ? 'TB' : d) as MermaidImport['direction']; continue; }
    if (/^(classDef|class|style|linkStyle|click|direction)\b/.test(line)) continue;
    const sg = /^subgraph\s+([^\s\[]+)?\s*(?:\[(.*)\])?\s*(.*)$/.exec(line);
    if (sg) {
      const rawId = sg[1] ?? 'frame' + frameStack.length;
      const title = clean(sg[2] ?? (sg[3] || rawId));
      const id = idFor('frame_' + rawId);
      const f: NodeInput = { id, kind: 'frame', title };
      res.nodes.push(f); known.set(id, f);
      frameStack.push(id);
      continue;
    }
    if (line === 'end') { frameStack.pop(); continue; }
    let pos = 0;
    const parseNode = (): string | null => {
      const m = /^\s*([A-Za-z0-9_.\-\u00C0-\uFFFF]+)/.exec(line.slice(pos));
      if (!m) return null;
      pos += m[0].length;
      const raw = m[1];
      for (const [open, close, shape] of OPENERS) {
        if (line.startsWith(open, pos)) {
          const end = line.indexOf(close, pos + open.length);
          if (end < 0) continue;
          const label = clean(line.slice(pos + open.length, end));
          pos = end + close.length;
          const cls = /^:::[\w-]+/.exec(line.slice(pos)); if (cls) pos += cls[0].length;
          return ensure(raw, label, shape);
        }
      }
      const cls = /^:::[\w-]+/.exec(line.slice(pos)); if (cls) pos += cls[0].length;
      return ensure(raw);
    };
    const parseOp = (): { label?: string; dashed: boolean; arrow: 'end' | 'none' | 'both' } | null => {
      const rest = line.slice(pos);
      let m = /^\s*(<)?(--|==|-\.)\s+([^>|]+?)\s+(-->|==>|\.->|---|===|\.-)\s*/.exec(rest);
      if (m) { pos += m[0].length; return { label: clean(m[3]), dashed: m[2] === '-.', arrow: m[1] ? 'both' : m[4].endsWith('>') ? 'end' : 'none' }; }
      m = /^\s*(<)?(-{2,}>|-{3,}|={2,}>|={3,}|-\.+->|-\.+-|--[ox])\s*(?:\|([^|]*)\|)?\s*/.exec(rest);
      if (m) { pos += m[0].length; return { label: m[3] ? clean(m[3]) : undefined, dashed: m[2].includes('.'), arrow: m[1] ? 'both' : m[2].endsWith('>') ? 'end' : 'none' }; }
      return null;
    };
    let left = parseNode();
    if (!left) continue;
    while (pos < line.length) {
      const amp = /^\s*&\s*/.exec(line.slice(pos));
      if (amp) { pos += amp[0].length; parseNode(); continue; }
      const op = parseOp();
      if (!op) break;
      const right = parseNode();
      if (!right) break;
      res.edges.push({ id: idPrefix + 'e' + (++edgeN), source: left, target: right, label: op.label, style: op.dashed ? 'dashed' : 'solid', arrow: op.arrow });
      left = right;
    }
  }
  return res;
}


export type ImportFormat = 'mermaid' | 'markdown' | 'json' | 'excalidraw';

/** Shared by the UI import dialog and the AI import_content tool. */
/** Shift absolutely positioned imports so they land beside existing content instead of on top of it. */
function placeBeside(nodes: NodeInput[], existing?: { x: number; y: number; width: number; height: number } | null): { dx: number; dy: number } | null {
  if (!existing) return null;
  let minX = Infinity, minY = Infinity;
  for (const n of nodes) {
    if (n.points && n.x === undefined) for (const [px, py] of n.points) { minX = Math.min(minX, px); minY = Math.min(minY, py); }
    else if (typeof n.x === 'number' && typeof n.y === 'number') { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); }
  }
  if (!Number.isFinite(minX)) return null;
  const dx = Math.round(existing.x + existing.width + 160 - minX), dy = Math.round(existing.y - minY);
  for (const n of nodes) {
    if (n.points && n.x === undefined) n.points = n.points.map(([px, py]) => [px + dx, py + dy] as [number, number]);
    else if (typeof n.x === 'number' && typeof n.y === 'number') { n.x += dx; n.y += dy; }
  }
  return { dx, dy };
}

export function importCommands(format: ImportFormat, content: string, mode: 'append' | 'replace', prefix: string, existing?: { x: number; y: number; width: number; height: number } | null, applied?: { offset: { dx: number; dy: number } | null }): CommandInput {
  const cmds: CommandInput[] = [];
  if (mode === 'replace') cmds.push({ type: 'replace_content', nodes: [], edges: [] });
  if (format === 'markdown') {
    const nodes = importMarkdown(content, prefix);
    if (!nodes.length) throw new Error('No headings or bullet points found.');
    cmds.push({ type: 'add_nodes', nodes }, { type: 'layout', mode: 'tree', nodeIds: nodes.map((n) => n.id as string) });
  } else if (format === 'mermaid') {
    const m = importMermaid(content, prefix);
    if (!m.nodes.length) throw new Error('No Mermaid flowchart nodes found.');
    cmds.push({ type: 'add_nodes', nodes: m.nodes });
    if (m.edges.length) cmds.push({ type: 'add_edges', edges: m.edges });
    cmds.push({ type: 'layout', mode: 'graph', direction: m.direction, nodeIds: m.nodes.map((n) => n.id as string) });
  } else if (format === 'excalidraw') {
    const x = importExcalidraw(content, prefix);
    if (!x.nodes.length) throw new Error('Nothing importable found in the Excalidraw scene.');
    if (mode === 'append') { const o = placeBeside(x.nodes, existing); if (applied) applied.offset = o; }
    cmds.push({ type: 'add_nodes', nodes: x.nodes });
    if (x.edges.length) cmds.push({ type: 'add_edges', edges: x.edges });
  } else {
    const parsed = JSON.parse(content) as Partial<CanvasDocument>;
    if (!parsed || !Array.isArray(parsed.nodes)) throw new Error('JSON must contain a "nodes" array.');
    const map: Record<string, string> = {};
    for (const n of parsed.nodes) map[n.id] = prefix + n.id;
    parsed.nodes.forEach((n, i) => {
      const r = nodeInputSchema.safeParse(n);
      if (!r.success) throw new Error('nodes[' + i + '] (' + (n?.id ?? '?') + '): ' + r.error.issues.map((x) => x.path.join('.') + ' ' + x.message).join('; ') + (r.error.issues.some((x) => x.path[0] === 'points') ? '. Points must be [x, y] pairs.' : ''));
    });
    (parsed.edges ?? []).forEach((e, i) => {
      const r = edgeInputSchema.safeParse(e);
      if (!r.success) throw new Error('edges[' + i + '] (' + (e?.id ?? '?') + '): ' + r.error.issues.map((x) => x.path.join('.') + ' ' + x.message).join('; '));
    });
    const nodes: NodeInput[] = parsed.nodes.map(({ order: _o, ...n }) => ({ ...n, id: map[n.id], parentId: n.parentId ? map[n.parentId] ?? null : null, frameId: n.frameId ? map[n.frameId] ?? null : null }));
    if (mode === 'append') { const o = placeBeside(nodes, existing); if (applied) applied.offset = o; }
    cmds.push({ type: 'add_nodes', nodes });
    const edges = (parsed.edges ?? []).filter((e) => map[e.source] && map[e.target]).map((e) => ({ ...e, id: prefix + e.id, source: map[e.source], target: map[e.target] }));
    if (edges.length) cmds.push({ type: 'add_edges', edges });
  }
  return { type: 'batch', commands: cmds };
}

/**
 * Keep source ids (Mermaid/Excalidraw/JSON) unless they would collide with existing ids in append mode;
 * Markdown outlines have no ids of their own and are always prefixed.
 */
export function planImport(format: ImportFormat, content: string, mode: 'append' | 'replace', doc: CanvasDocument, makePrefix: () => string, placement: 'keep' | 'beside' = 'keep'): { cmd: CommandInput; prefix: string; offset: { dx: number; dy: number } | null } {
  const positionless = format === 'markdown' || format === 'mermaid';
  const area = mode === 'append' && doc.nodes.length && (placement === 'beside' || positionless) ? boundsOf(doc.nodes) : null;
  const applied = { offset: null as { dx: number; dy: number } | null };
  let planned: { cmd: CommandInput; prefix: string } | null = null;
  if (format !== 'markdown') {
    const cmd = importCommands(format, content, mode, '', area, applied);
    const taken = mode === 'append' ? new Set([...doc.nodes.map((n) => n.id), ...doc.edges.map((e) => e.id)]) : new Set<string>();
    if (!collectIds(cmd).some((x) => taken.has(x))) planned = { cmd, prefix: '' };
  }
  if (!planned) { const prefix = makePrefix(); planned = { cmd: importCommands(format, content, mode, prefix, area, applied), prefix }; }
  if (positionless && area) {
    const laidOut = layOutAlone(planned.cmd, doc, planned.prefix || makePrefix());
    applied.offset = placeBeside(laidOut.nodes, area);
    planned.cmd = { type: 'batch', commands: [{ type: 'add_nodes', nodes: laidOut.nodes }, ...(laidOut.edges.length ? [{ type: 'add_edges' as const, edges: laidOut.edges }] : [])] };
  }
  return { ...planned, offset: applied.offset };
}

/**
 * Outlines and Mermaid carry no coordinates: lay them out on an empty copy of the document first,
 * so they can be placed beside existing content as one block instead of being dropped onto it
 * (where they would overlap nodes and be captured by frames before the layout runs).
 */
function layOutAlone(cmd: CommandInput, doc: CanvasDocument, idPrefix: string): { nodes: NodeInput[]; edges: EdgeInput[] } {
  let seq = 0;
  const scratch = { ...doc, nodes: [], edges: [] } as CanvasDocument;
  const result = applyCommand(scratch, normalizeCommand(scratch, cmd, { genId: () => idPrefix + 'g' + ++seq }));
  return {
    nodes: result.nodes.map(({ order: _o, ...n }) => n as NodeInput),
    edges: result.edges.map((e) => ({ ...e }) as EdgeInput),
  };
}

function collectIds(cmd: CommandInput): string[] {
  if (cmd.type === 'batch') return cmd.commands.flatMap(collectIds);
  if (cmd.type === 'add_nodes') return cmd.nodes.map((n) => n.id ?? '').filter(Boolean);
  if (cmd.type === 'add_edges') return cmd.edges.map((e) => e.id ?? '').filter(Boolean);
  return [];
}

function boundsOf(nodes: CanvasNode[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x + n.width); maxY = Math.max(maxY, n.y + n.height); }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
