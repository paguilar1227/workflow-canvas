import type { CanvasDocument, CanvasNode, NodeRole, NodeShape } from './types';
import { NODE_ROLES } from './types';

export interface RoleInfo { label: string; noun: string; shape: NodeShape; title: string; meaning: string }

/** Logic roles, modelled on the core flowchart/BPMN elements: what each one means and how a new one looks. */
export const ROLE_INFO: Record<NodeRole, RoleInfo> = {
  start: { label: 'Start', noun: 'start point', shape: 'pill', title: 'Start', meaning: 'Entry point or trigger that begins the flow.' },
  end: { label: 'End', noun: 'end point', shape: 'pill', title: 'End', meaning: 'An outcome where the flow stops.' },
  decision: { label: 'Decision', noun: 'decision', shape: 'diamond', title: 'Decision?', meaning: 'A yes/no or multi-way choice. Label each outgoing connector with its condition.' },
  parallel: { label: 'Parallel', noun: 'parallel split or join', shape: 'hexagon', title: 'In parallel', meaning: 'Split: every outgoing path runs at the same time. Join: waits until all incoming paths finish.' },
  wait: { label: 'Wait', noun: 'wait', shape: 'circle', title: 'Wait', meaning: 'Pauses until a timer, event or message arrives.' },
  data: { label: 'Data', noun: 'data input/output', shape: 'parallelogram', title: 'Data', meaning: 'An input or output such as a form, message, file or report.' },
  store: { label: 'Data store', noun: 'data store', shape: 'cylinder', title: 'Database', meaning: 'Persistent storage the flow reads from or writes to.' },
  subprocess: { label: 'Subprocess', noun: 'subprocess', shape: 'rounded', title: 'Subprocess', meaning: 'A reusable flow detailed elsewhere; link it to the document that defines it.' },
  external: { label: 'External', noun: 'external actor', shape: 'rectangle', title: 'External system', meaning: 'A person, team or outside system the flow interacts with.' },
};

/** True only for the nine roles (so stray values such as "step" or "constructor" from hand-edited files are ignored). */
export const isRole = (r: unknown): r is NodeRole => typeof r === 'string' && (NODE_ROLES as string[]).includes(r);

/** Shapes that carry a conventional meaning even when no role is set. */
const SHAPE_ROLE: Partial<Record<NodeShape, NodeRole>> = { diamond: 'decision', cylinder: 'store', parallelogram: 'data' };

export function roleOf(n: CanvasNode): { role?: NodeRole; inferred: boolean } {
  if (n.kind !== 'topic') return { inferred: false };
  if (isRole(n.role)) return { role: n.role, inferred: false };
  const r = n.shape ? SHAPE_ROLE[n.shape] : undefined;
  return r ? { role: r, inferred: true } : { inferred: false };
}

export interface LogicLink { from: string; to: string; label?: string; via: 'connector' | 'branch'; edgeId?: string }
export interface LogicIssue { message: string; nodeId?: string; edgeId?: string }
export interface LogicStep { step: number; id: string; title: string; role: NodeRole | 'step'; roleInferred?: boolean; lane?: string; next: LogicLink[] }
export interface LogicReport {
  documentId: string;
  title: string;
  entries: string[];
  steps: LogicStep[];
  dataAccess: { nodeId: string; storeId: string; access: 'reads' | 'writes' | 'uses' }[];
  interactions: { nodeId: string; externalId: string; direction: 'sends to' | 'receives from' | 'interacts with' }[];
  loops: { from: string; to: string; exits: boolean }[];
  related: { a: string; b: string; label?: string }[];
  unconnected: string[];
  notes: { id: string; text: string; attachedTo?: string }[];
  issues: LogicIssue[];
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Read a canvas as a flow: numbered steps from each start, decision branches with their conditions, loops, merges,
 * parallel paths, lanes (frames) as owners, data stores, external actors and attached notes, plus a list of gaps
 * that leave the logic ambiguous. Shared by the AI tool and the UI export so both see the same reading.
 */
export function describeLogic(doc: CanvasDocument): { markdown: string; report: LogicReport } {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const topics = doc.nodes.filter((n) => n.kind === 'topic');
  const isTopic = (id?: string | null) => !!id && byId.get(id)?.kind === 'topic';
  const role = new Map<string, NodeRole>();
  const inferred = new Set<string>();
  const wired = new Set<string>();
  for (const t of topics) { const r = roleOf(t); if (r.role) role.set(t.id, r.role); if (r.inferred) inferred.add(t.id); }
  const sideOf = (id: string) => (role.get(id) === 'store' ? 'store' : role.get(id) === 'external' ? 'external' : 'flow');
  const report: LogicReport = { documentId: doc.id, title: doc.title, entries: [], steps: [], dataAccess: [], interactions: [], loops: [], related: [], unconnected: [], notes: [], issues: [] };
  const out = new Map<string, LogicLink[]>();
  const inc = new Map<string, LogicLink[]>();
  const touched = new Set<string>();
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => { const l = m.get(k) ?? []; l.push(v); m.set(k, l); };

  const link = (a: string, b: string, label: string | undefined, via: LogicLink['via'], edgeId?: string, directed = true) => {
    const sa = sideOf(a), sb = sideOf(b);
    touched.add(a); touched.add(b);
    if (sa === 'store' || sb === 'store') {
      if (sa === 'store' && sb === 'store') return;
      const store = sa === 'store' ? a : b, node = store === a ? b : a;
      report.dataAccess.push({ nodeId: node, storeId: store, access: !directed ? 'uses' : store === a ? 'reads' : 'writes' });
      return;
    }
    if (sa === 'external' || sb === 'external') {
      if (sa === 'external' && sb === 'external') return;
      const ext = sa === 'external' ? a : b, node = ext === a ? b : a;
      report.interactions.push({ nodeId: node, externalId: ext, direction: !directed ? 'interacts with' : ext === a ? 'receives from' : 'sends to' });
      return;
    }
    if (!directed) { report.related.push({ a, b, ...(label ? { label } : {}) }); return; }
    const l: LogicLink = { from: a, to: b, via, ...(label ? { label: oneLine(label) } : {}), ...(edgeId ? { edgeId } : {}) };
    push(out, a, l); push(inc, b, l);
    if (via === 'connector') { wired.add(a); wired.add(b); }
  };

  const ordered = [...topics].sort((a, b) => a.order - b.order);
  for (const n of ordered) if (n.parentId && isTopic(n.parentId)) link(n.parentId, n.id, undefined, 'branch');
  for (const e of doc.edges) {
    const s = byId.get(e.source), t = byId.get(e.target);
    if (!s || !t) continue;
    if (s.kind !== 'topic' || t.kind !== 'topic') {
      const note = s.kind === 'sticky' || s.kind === 'text' ? s : t.kind === 'sticky' || t.kind === 'text' ? t : undefined;
      const other = note === s ? t : s;
      if (note && other.kind === 'topic' && note.title.trim()) report.notes.push({ id: note.id, text: note.title.trim(), attachedTo: other.id });
      continue;
    }
    if (e.arrow === 'none') link(s.id, t.id, e.label, 'connector', e.id, false);
    else {
      if (e.arrow !== 'start') link(s.id, t.id, e.label, 'connector', e.id);
      if (e.arrow === 'start' || e.arrow === 'both') link(t.id, s.id, e.label, 'connector', e.id);
    }
  }
  const attached = new Set(report.notes.map((x) => x.id));
  for (const n of doc.nodes) if ((n.kind === 'sticky' || n.kind === 'text') && n.title.trim() && !attached.has(n.id)) report.notes.push({ id: n.id, text: n.title.trim() });

  const pos = (a: CanvasNode, b: CanvasNode) => (a.y - b.y) || (a.x - b.x);
  const flowNodes = topics.filter((t) => sideOf(t.id) === 'flow' && (out.has(t.id) || inc.has(t.id) || role.get(t.id) === 'start'));
  const starts = flowNodes.filter((t) => role.get(t.id) === 'start').sort(pos);
  const entries = starts.length ? starts : flowNodes.filter((t) => !inc.has(t.id)).sort(pos);
  const logicMode = [...role.keys()].some((id) => !inferred.has(id));
  const lane = (n: CanvasNode) => (n.frameId && byId.get(n.frameId)?.kind === 'frame' ? oneLine(byId.get(n.frameId)!.title || 'Frame') : undefined);
  const title = (id: string) => oneLine(byId.get(id)?.title || '') || 'Untitled';
  const q = (id: string) => '**' + title(id) + '**';
  const roleText = (id: string) => { const r = role.get(id); return r ? ROLE_INFO[r].label.toLowerCase() + (inferred.has(id) ? ' (from its shape)' : '') : 'step'; };

  const stepNo = new Map<string, number>();
  const path: string[] = [];
  const lines: string[] = [];
  const nameOf = (id: string) => 'step ' + stepNo.get(id) + ' (' + q(id) + ')';

  const details = (id: string, pad: string) => {
    const n = byId.get(id)!;
    const d: string[] = [];
    if ((inc.get(id)?.length ?? 0) > 1 && role.get(id) === 'parallel') d.push('joins: waits for all ' + inc.get(id)!.length + ' incoming paths');
    for (const a of report.dataAccess.filter((x) => x.nodeId === id)) d.push(a.access + ' ' + q(a.storeId));
    for (const x of report.interactions.filter((y) => y.nodeId === id)) d.push(x.direction + ' ' + q(x.externalId));
    for (const r of report.related.filter((y) => y.a === id || y.b === id)) d.push('related to ' + q(r.a === id ? r.b : r.a) + (r.label ? ': ' + oneLine(r.label) : ''));
    if (n.notes) d.push('notes: ' + oneLine(n.notes));
    for (const note of report.notes.filter((x) => x.attachedTo === id)) d.push('note: ' + oneLine(note.text));
    if (n.link) d.push('link: ' + n.link);
    for (const x of d) lines.push(pad + '- ' + x);
  };

  const headline = (id: string) => {
    const n = byId.get(id)!;
    const bits = [q(id) + ' · ' + roleText(id)];
    if (n.subtitle) bits.push('`' + oneLine(n.subtitle) + '`');
    if (n.badge) bits.push('[' + oneLine(n.badge) + ']');
    if (n.status && n.status !== 'none') bits.push('status: ' + n.status);
    if (n.priority) bits.push('P' + n.priority);
    if (n.tags?.length) bits.push(n.tags.map((t) => '#' + t).join(' '));
    const l = lane(n);
    if (l) bits.push('lane: ' + l);
    return bits.join(' · ');
  };

  const jump = (from: string, to: string) => {
    if (path.includes(to)) {
      const cycle = path.slice(path.indexOf(to));
      const set = new Set(cycle);
      const exits = cycle.some((c) => role.get(c) === 'end' || (out.get(c) ?? []).some((x) => !set.has(x.to)));
      report.loops.push({ from, to, exits });
      if (!exits && logicMode) report.issues.push({ nodeId: to, message: 'The loop ' + cycle.map(q).join(' → ') + ' → ' + q(to) + ' has no way out.' });
      return 'loops back to ' + nameOf(to);
    }
    return 'continues at ' + nameOf(to);
  };

  const walk = (start: string, pad: string) => {
    let cur = start;
    const mine: string[] = [];
    for (;;) {
      stepNo.set(cur, stepNo.size + 1);
      path.push(cur); mine.push(cur);
      const n = byId.get(cur)!;
      report.steps.push({ step: stepNo.get(cur)!, id: cur, title: title(cur), role: role.get(cur) ?? 'step', ...(inferred.has(cur) ? { roleInferred: true } : {}), ...(lane(n) ? { lane: lane(n) } : {}), next: out.get(cur) ?? [] });
      lines.push(pad + stepNo.get(cur) + '. ' + headline(cur));
      const sub = pad + '   ';
      details(cur, sub);
      const next = out.get(cur) ?? [];
      const r = role.get(cur);
      if (!next.length) break;
      if (next.length === 1 && r !== 'decision') {
        const l = next[0];
        if (stepNo.has(l.to)) { lines.push(sub + '→ ' + (l.label ? '_' + l.label + '_ → ' : '') + jump(cur, l.to)); break; }
        if (l.label) lines.push(sub + '→ _' + l.label + '_');
        cur = l.to;
        continue;
      }
      lines.push(sub + (r === 'parallel' ? 'In parallel, all of:' : r === 'decision' ? 'Depending on the answer:' : 'Then each of:'));
      for (const l of next) {
        const cond = l.label ? '**' + l.label + '**' : r === 'decision' ? '_(no condition label)_' : '';
        if (stepNo.has(l.to)) lines.push(sub + '- ' + (cond ? cond + ' → ' : '') + jump(cur, l.to));
        else { lines.push(sub + '- ' + (cond ? cond + ' →' : '→')); walk(l.to, sub + '  '); }
      }
      break;
    }
    path.splice(path.length - mine.length, mine.length);
  };

  for (const e of entries) {
    if (stepNo.has(e.id)) continue;
    report.entries.push(e.id);
    lines.push('', '### From ' + q(e.id) + (role.get(e.id) === 'start' ? '' : ' (no incoming connectors)'));
    walk(e.id, '');
  }
  const rest = flowNodes.filter((t) => !stepNo.has(t.id)).sort((a, b) => (inc.has(a.id) ? 1 : 0) - (inc.has(b.id) ? 1 : 0) || pos(a, b));
  if (rest.length) {
    for (const t of rest) {
      if (stepNo.has(t.id)) continue;
      if (starts.length) report.issues.push({ nodeId: t.id, message: q(t.id) + ' (and anything after it) cannot be reached from any Start.' });
      lines.push('', (starts.length ? '### Not reached from a start: ' : '### Also: ') + q(t.id));
      walk(t.id, '');
    }
  }

  for (const t of topics) if (!touched.has(t.id) && role.get(t.id) !== 'start') report.unconnected.push(t.id);

  for (const t of topics) {
    const r = role.get(t.id);
    const o = out.get(t.id) ?? [], i = inc.get(t.id) ?? [];
    if (r === 'decision' && (!inferred.has(t.id) || wired.has(t.id))) {
      if (o.length < 2) report.issues.push({ nodeId: t.id, message: 'Decision ' + q(t.id) + ' has ' + o.length + ' outgoing path' + (o.length === 1 ? '' : 's') + '; give it at least two, each labelled with its condition.' });
      for (const l of o) if (!l.label) report.issues.push({ nodeId: t.id, edgeId: l.edgeId, message: 'The branch from decision ' + q(t.id) + ' to ' + q(l.to) + ' has no condition label' + (l.via === 'branch' ? ' (it is a mind-map branch, which cannot carry a label; connect the two with a labelled connector instead).' : '.') });
    }
    if (r === 'start' && i.length) report.issues.push({ nodeId: t.id, message: 'Start ' + q(t.id) + ' has incoming connectors; a start should only lead out.' });
    if (r === 'end' && o.length) report.issues.push({ nodeId: t.id, message: 'End ' + q(t.id) + ' has outgoing connectors; an end should stop the flow.' });
    if (r === 'parallel' && o.length < 2 && i.length < 2) report.issues.push({ nodeId: t.id, message: 'Parallel ' + q(t.id) + ' neither splits into several paths nor joins several paths.' });
    if (logicMode && i.length && !o.length && r !== 'end' && r !== 'data' && sideOf(t.id) === 'flow') report.issues.push({ nodeId: t.id, message: 'The flow stops at ' + q(t.id) + ' without reaching an End.' });
  }
  if (logicMode && !starts.length && flowNodes.length) report.issues.unshift({ message: 'No Start node: entry points were inferred from topics with no incoming connectors' + (entries.length ? ' (' + entries.map((e) => q(e.id)).join(', ') + ')' : '') + '.' });
  report.issues = report.issues.filter((x, i, all) => all.findIndex((y) => y.message === x.message) === i);

  const count = (r: NodeRole) => [...role.values()].filter((x) => x === r).length;
  const md: string[] = ['# Logic of "' + oneLine(doc.title) + '"'];
  if (doc.description) md.push('', '> ' + oneLine(doc.description));
  md.push('', 'How to read this: steps are numbered in the order the arrows lead from each start. A decision lists each condition and where it goes; "loops back to" marks a cycle and "continues at" marks paths that merge. Lanes are the frames a step sits in (who or what owns it).');
  const summary = [report.steps.length + ' step' + (report.steps.length === 1 ? '' : 's')];
  const plural: Partial<Record<NodeRole, string>> = { parallel: 'parallel splits or joins' };
  for (const r of ['start', 'decision', 'parallel', 'wait', 'subprocess', 'end'] as NodeRole[]) { const c = count(r); if (c) summary.push(c + ' ' + (c === 1 ? ROLE_INFO[r].noun : plural[r] ?? ROLE_INFO[r].noun + 's')); }
  if (report.loops.length) summary.push(report.loops.length + ' loop' + (report.loops.length === 1 ? '' : 's'));
  summary.push(report.issues.length + ' issue' + (report.issues.length === 1 ? '' : 's'));
  md.push('', '**Summary:** ' + summary.join(', ') + '.');
  if (report.steps.length) md.push('', '## Flow', ...lines);
  else md.push('', '## Flow', '', 'No connected flow yet. Connect topics with arrows (and set roles such as start, decision and end) to describe the logic.');
  const frames = doc.nodes.filter((n) => n.kind === 'frame');
  const laneLines = frames.map((f) => { const steps = report.steps.filter((s) => byId.get(s.id)?.frameId === f.id); return steps.length ? '- **' + oneLine(f.title || 'Frame') + '**: steps ' + steps.map((s) => s.step).join(', ') : ''; }).filter(Boolean);
  if (laneLines.length) md.push('', '## Lanes (owners)', ...laneLines);
  const stores = topics.filter((t) => role.get(t.id) === 'store');
  if (stores.length) md.push('', '## Data stores', ...stores.map((s) => { const use = report.dataAccess.filter((a) => a.storeId === s.id); return '- ' + q(s.id) + (use.length ? ': ' + use.map((a) => (stepNo.has(a.nodeId) ? nameOf(a.nodeId) : q(a.nodeId)) + ' ' + a.access + ' it').join('; ') : ': not used by any step'); }));
  const exts = topics.filter((t) => role.get(t.id) === 'external');
  if (exts.length) md.push('', '## External actors and systems', ...exts.map((s) => { const use = report.interactions.filter((a) => a.externalId === s.id); return '- ' + q(s.id) + (use.length ? ': ' + use.map((a) => (stepNo.has(a.nodeId) ? nameOf(a.nodeId) : q(a.nodeId)) + ' ' + a.direction + ' it').join('; ') : ': no interactions drawn'); }));
  const freeNotes = report.notes.filter((x) => !x.attachedTo);
  if (freeNotes.length) md.push('', '## Notes on the canvas', ...freeNotes.map((x) => { const n = byId.get(x.id)!; const l = lane(n); return '- ' + (l ? '(' + l + ') ' : '') + x.text.split('\n').map((s, i) => (i ? '  ' : '') + s).join('\n'); }));
  const loose = report.unconnected.filter((id) => sideOf(id) === 'flow');
  if (loose.length) md.push('', '## Unconnected topics', ...loose.map((id) => '- ' + headline(id)));
  md.push('', '## Issues');
  md.push(...(report.issues.length ? report.issues.map((x) => '- ' + x.message) : ['- None found.']));
  return { markdown: md.join('\n') + '\n', report };
}
