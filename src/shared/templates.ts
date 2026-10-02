import type { CanvasDocument } from './types';
import { DEFAULT_SETTINGS } from './types';
import { applyCommand, normalizeCommand, type CommandInput } from './commands';

export const TEMPLATE_IDS = ['blank', 'mindmap', 'architecture', 'workflow'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export function emptyDocument(id: string, title: string, now = new Date().toISOString()): CanvasDocument {
  return { id, title, nodes: [], edges: [], settings: { ...DEFAULT_SETTINGS }, createdAt: now, updatedAt: now };
}

function build(doc: CanvasDocument, cmds: CommandInput[], genId: () => string): CanvasDocument {
  let d = doc;
  for (const c of cmds) d = applyCommand(d, normalizeCommand(d, c, { genId }));
  return d;
}

export function templateCommands(t: TemplateId): CommandInput[] {
  switch (t) {
    case 'blank':
      return [];
    case 'mindmap':
      return [
        { type: 'add_nodes', nodes: [{ id: 'central', title: 'Central topic', shape: 'pill', x: 0, y: 0, width: 240, height: 64 }] },
        { type: 'add_nodes', nodes: [
          { id: 'main-1', title: 'Main topic 1', parentId: 'central', color: 'blue' },
          { id: 'main-2', title: 'Main topic 2', parentId: 'central', color: 'green' },
          { id: 'main-3', title: 'Main topic 3', parentId: 'central', color: 'amber' },
          { id: 'main-4', title: 'Main topic 4', parentId: 'central', color: 'purple' },
        ] },
      ];
    case 'architecture':
      return [
        { type: 'add_nodes', nodes: [
          { id: 'lane-clients', kind: 'frame', title: 'Clients', subtitle: 'Who calls in', x: 0, y: 0, width: 320, height: 360 },
          { id: 'lane-services', kind: 'frame', title: 'Services', subtitle: 'What does the work', x: 352, y: 0, width: 320, height: 360 },
          { id: 'lane-data', kind: 'frame', title: 'Data', subtitle: 'Where state lives', x: 704, y: 0, width: 320, height: 360 },
          { id: 'web', title: 'Web app', subtitle: 'browser', icon: '🖥️', badge: 'Client', frameId: 'lane-clients', x: 40, y: 72 },
          { id: 'api', title: 'API service', subtitle: 'REST + auth', icon: '⚙️', badge: 'Service', frameId: 'lane-services', x: 392, y: 72 },
          { id: 'db', title: 'Database', subtitle: 'primary store', icon: '🗄️', badge: 'Data', frameId: 'lane-data', x: 744, y: 72 },
        ] },
        { type: 'add_edges', edges: [
          { source: 'web', target: 'api', label: 'HTTPS' },
          { source: 'api', target: 'db', label: 'SQL' },
        ] },
      ];
    case 'workflow':
      return [
        { type: 'add_nodes', nodes: [
          { id: 'start', title: 'Start', shape: 'pill', color: 'green', x: 0, y: 0 },
          { id: 'step-1', title: 'Do the work', subtitle: 'owner: you', x: 0, y: 0 },
          { id: 'decide', title: 'Looks good?', shape: 'diamond', color: 'amber', x: 0, y: 0 },
          { id: 'fix', title: 'Revise', shape: 'rounded', x: 0, y: 0 },
          { id: 'done', title: 'Done', shape: 'pill', color: 'blue', x: 0, y: 0 },
        ] },
        { type: 'add_edges', edges: [
          { source: 'start', target: 'step-1' },
          { source: 'step-1', target: 'decide' },
          { source: 'decide', target: 'done', label: 'yes' },
          { source: 'decide', target: 'fix', label: 'no', style: 'dashed' },
          { source: 'fix', target: 'step-1' },
        ] },
        { type: 'layout', mode: 'graph', direction: 'LR' },
      ];
  }
}

export function createFromTemplate(id: string, title: string, t: TemplateId, genId: () => string): CanvasDocument {
  return build(emptyDocument(id, title), templateCommands(t), genId);
}

const ARCH_SEED: CommandInput[] = [
  { type: 'add_nodes', nodes: [
    { id: 'lane-drivers', kind: 'frame', title: 'People & agents', subtitle: 'Who drives the canvas', x: 0, y: 0 },
    { id: 'lane-doors', kind: 'frame', title: 'Interfaces', subtitle: 'Same commands, two doors', x: 600, y: 0 },
    { id: 'lane-core', kind: 'frame', title: 'Core', subtitle: 'One command model', x: 1200, y: 0 },
    { id: 'lane-state', kind: 'frame', title: 'State', subtitle: 'Persisted in a Docker volume', x: 1800, y: 0 },
  ] },
  { type: 'add_nodes', nodes: [
    { id: 'you', title: 'You, in the browser', subtitle: 'mouse · keyboard · menus', icon: '🧑', badge: 'Human', color: 'blue', frameId: 'lane-drivers', x: 24, y: 72 },
    { id: 'agent', title: 'AI agent', subtitle: 'Codex · Claude · any MCP', icon: '🤖', badge: 'AI', color: 'purple', frameId: 'lane-drivers', x: 24, y: 200 },
    { id: 'ws', title: 'Live sync', subtitle: '/sync · ops + view control', icon: '⚡', badge: 'Realtime', frameId: 'lane-doors', x: 624, y: 72 },
    { id: 'mcp', title: 'MCP server', subtitle: '/mcp · streamable HTTP', icon: '🧰', badge: '30+ tools', color: 'purple', frameId: 'lane-doors', x: 624, y: 200 },
    { id: 'rest', title: 'Tools REST API', subtitle: 'POST /api/tools/:name', icon: '🔌', badge: 'HTTP', frameId: 'lane-doors', x: 624, y: 328 },
    { id: 'normalize', title: 'Command normalizer', subtitle: 'ids · positions · defaults', icon: 'ƒ', badge: 'Shared', frameId: 'lane-core', x: 1224, y: 72 },
    { id: 'reducer', title: 'Reducer', subtitle: 'applyCommand(doc, cmd)', icon: 'λ', badge: 'Deterministic', color: 'green', frameId: 'lane-core', x: 1224, y: 200 },
    { id: 'layout', title: 'Layout engine', subtitle: 'tree · dagre · lanes · grid', icon: '⌗', badge: 'Shared', frameId: 'lane-core', x: 1224, y: 328 },
    { id: 'history', title: 'Undo / redo', subtitle: 'structural diff patches', icon: '↺', badge: 'History', frameId: 'lane-core', x: 1224, y: 456 },
    { id: 'docs', title: 'Documents', subtitle: '/data/documents/*.json', icon: '🗂️', badge: 'Volume', color: 'amber', frameId: 'lane-state', x: 1824, y: 72 },
    { id: 'session', title: 'Shared session', subtitle: 'theme · viewport · selection', icon: '🎛️', badge: 'Co-driven', color: 'amber', frameId: 'lane-state', x: 1824, y: 200 },
  ] },
  { type: 'add_edges', edges: [
    { source: 'you', target: 'ws', label: 'edits' },
    { source: 'agent', target: 'mcp', label: 'tool calls', color: 'purple', animated: true },
    { source: 'agent', target: 'rest', label: 'curl / fetch', style: 'dashed' },
    { source: 'ws', target: 'normalize', label: 'commands' },
    { source: 'mcp', target: 'normalize', label: 'same commands', color: 'purple' },
    { source: 'rest', target: 'normalize' },
    { source: 'normalize', target: 'reducer' },
    { source: 'layout', target: 'reducer', label: 'positions', style: 'dashed' },
    { source: 'reducer', target: 'history', label: 'diff' },
    { source: 'reducer', target: 'docs', label: 'persist', color: 'green', animated: true },
    { source: 'mcp', target: 'session', label: 'view control', style: 'dashed', color: 'purple' },
    { source: 'ws', target: 'session', label: 'broadcast', style: 'dashed' },
  ] },
  { type: 'layout', mode: 'lanes' },
];

const LAUNCH_SEED: CommandInput[] = [
  { type: 'add_nodes', nodes: [{ id: 'root', title: 'Product launch', shape: 'pill', icon: '🚀', x: 0, y: 0, width: 260, height: 72 }] },
  { type: 'add_nodes', nodes: [
    { id: 'research', title: 'Research', parentId: 'root', color: 'blue', icon: '🔎' },
    { id: 'build', title: 'Build', parentId: 'root', color: 'green', icon: '🛠️' },
    { id: 'market', title: 'Marketing', parentId: 'root', color: 'pink', icon: '📣' },
    { id: 'metrics', title: 'Metrics', parentId: 'root', color: 'amber', icon: '📈' },
  ] },
  { type: 'add_nodes', nodes: [
    { title: 'Customer interviews', parentId: 'research', status: 'done' },
    { title: 'Competitor scan', parentId: 'research', status: 'doing' },
    { title: 'MVP scope', parentId: 'build', priority: 1 },
    { title: 'Private beta', parentId: 'build', status: 'todo' },
    { title: 'Landing page', parentId: 'market' },
    { title: 'Launch post', parentId: 'market', tags: ['blog'] },
    { title: 'Activation', parentId: 'metrics' },
    { title: 'Retention', parentId: 'metrics', notes: 'Week-4 retention is the north-star check.' },
  ] },
];

export function seedDocuments(genId: () => string): CanvasDocument[] {
  const arch = build({ ...emptyDocument('how-it-works', 'Workflow Canvas — how it works'), description: 'The app visualised in itself: humans and AI agents drive one shared command model.' }, ARCH_SEED, genId);
  const launch = build({ ...emptyDocument('launch-plan', 'Product launch plan'), description: 'An XMind-style mind map. Select a topic and press Tab / Enter.' }, LAUNCH_SEED, genId);
  return [arch, launch];
}

