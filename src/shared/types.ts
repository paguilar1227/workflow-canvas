export type NodeKind = 'topic' | 'frame' | 'sticky' | 'text' | 'drawing';
export type NodeShape = 'card' | 'rounded' | 'pill' | 'rectangle' | 'diamond' | 'circle' | 'hexagon' | 'cylinder' | 'parallelogram';
/** What a topic means in a flow, so people and AI can read the diagram's logic. A topic without a role is a plain step. */
export type NodeRole = 'start' | 'end' | 'decision' | 'parallel' | 'wait' | 'data' | 'store' | 'subprocess' | 'external';
export type ColorName = 'default' | 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'pink' | 'teal' | 'gray';
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type NodeStatus = 'none' | 'todo' | 'doing' | 'done' | 'blocked';
export type EdgeRouting = 'smooth' | 'bezier' | 'straight' | 'step';
export type EdgeStyle = 'solid' | 'dashed' | 'dotted';
export type ArrowMode = 'end' | 'start' | 'both' | 'none';
export type TreeLayout = 'mindmap' | 'right' | 'left' | 'down';

export const NODE_KINDS: NodeKind[] = ['topic', 'frame', 'sticky', 'text', 'drawing'];
export const NODE_SHAPES: NodeShape[] = ['card', 'rounded', 'pill', 'rectangle', 'diamond', 'circle', 'hexagon', 'cylinder', 'parallelogram'];
export const NODE_ROLES: NodeRole[] = ['start', 'end', 'decision', 'parallel', 'wait', 'data', 'store', 'subprocess', 'external'];
export const COLOR_NAMES: ColorName[] = ['default', 'blue', 'green', 'amber', 'red', 'purple', 'pink', 'teal', 'gray'];
export const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
export const NODE_STATUSES: NodeStatus[] = ['none', 'todo', 'doing', 'done', 'blocked'];
export const EDGE_ROUTINGS: EdgeRouting[] = ['smooth', 'bezier', 'straight', 'step'];
export const EDGE_STYLES: EdgeStyle[] = ['solid', 'dashed', 'dotted'];
export const ARROW_MODES: ArrowMode[] = ['end', 'start', 'both', 'none'];
export const TREE_LAYOUTS: TreeLayout[] = ['mindmap', 'right', 'left', 'down'];

export interface CanvasNode {
  id: string;
  kind: NodeKind;
  title: string;
  subtitle?: string;
  notes?: string;
  badge?: string;
  icon?: string;
  shape?: NodeShape;
  role?: NodeRole;
  color?: ColorName;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId?: string | null;
  frameId?: string | null;
  order: number;
  collapsed?: boolean;
  tags?: string[];
  link?: string;
  status?: NodeStatus;
  priority?: number;
  locked?: boolean;
  /** Freehand stroke (kind 'drawing'), relative to the node's top-left in its original size. */
  points?: [number, number][];
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  style: EdgeStyle;
  arrow: ArrowMode;
  routing: EdgeRouting;
  color?: ColorName;
  animated?: boolean;
  sourceSide?: Side | null;
  targetSide?: Side | null;
}

export interface DocSettings {
  autoArrange: boolean;
  treeLayout: TreeLayout;
}

export interface CanvasDocument {
  id: string;
  title: string;
  description?: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  settings: DocSettings;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSummary {
  id: string;
  title: string;
  description?: string;
  nodeCount: number;
  edgeCount: number;
  updatedAt: string;
}

export interface Viewport { x: number; y: number; zoom: number }

export interface Panels {
  inspector: boolean;
  outline: boolean;
  minimap: boolean;
}

export type BackgroundVariant = 'dots' | 'lines' | 'cross' | 'none';
export type InteractionMode = 'select' | 'pan' | 'draw';

/** Shared, human+AI co-driven UI session state. */
export interface SessionState {
  activeDocumentId: string | null;
  theme: string;
  selection: { nodes: string[]; edges: string[] };
  viewport: Viewport;
  viewportSize: { width: number; height: number };
  panels: Panels;
  snapToGrid: boolean;
  background: BackgroundVariant | 'theme';
  mode: InteractionMode;
  search: string;
  zenMode: boolean;
  viewMode: boolean;
}

export const DEFAULT_SESSION: SessionState = {
  activeDocumentId: null,
  theme: 'neon-flow',
  selection: { nodes: [], edges: [] },
  viewport: { x: 0, y: 0, zoom: 1 },
  viewportSize: { width: 0, height: 0 },
  panels: { inspector: true, outline: true, minimap: true },
  snapToGrid: false,
  background: 'theme',
  mode: 'select',
  search: '',
  zenMode: false,
  viewMode: false,
};

export const DEFAULT_SETTINGS: DocSettings = { autoArrange: true, treeLayout: 'mindmap' };

