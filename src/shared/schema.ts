import { z } from 'zod';
import { ARROW_MODES, COLOR_NAMES, EDGE_ROUTINGS, EDGE_STYLES, NODE_KINDS, NODE_SHAPES, NODE_STATUSES, SIDES, TREE_LAYOUTS } from './types';

export const colorSchema = z.enum(COLOR_NAMES as [string, ...string[]]);
export const sideSchema = z.enum(SIDES as [string, ...string[]]);

export const nodeFieldShape = {
  kind: z.enum(NODE_KINDS as [string, ...string[]]).optional().describe("'topic' (default box/card), 'frame' (lane/boundary container drawn behind nodes), 'sticky' (sticky note), 'text' (free text label), 'drawing' (freehand pen stroke; give points)"),
  title: z.string().optional().describe('Main label. For frames this is the lane/boundary heading; for stickies the note text.'),
  subtitle: z.string().nullable().optional().describe('Secondary monospace line under the title (e.g. file path, owner, example).'),
  notes: z.string().nullable().optional().describe('Long-form notes shown in the inspector (markdown-ish plain text).'),
  badge: z.string().nullable().optional().describe('Small pill label on the top-right edge (e.g. "Proposed", "v2", "Owner: API").'),
  icon: z.string().nullable().optional().describe('Emoji or short glyph shown in the icon square (e.g. "🗄️", "⚙️", "λ").'),
  shape: z.enum(NODE_SHAPES as [string, ...string[]]).nullable().optional().describe('Topic shape: card (icon+title+subtitle), rounded, pill, rectangle, diamond (decision), circle, hexagon, cylinder (database).'),
  color: colorSchema.nullable().optional().describe('Accent colour name from the active theme palette.'),
  x: z.number().optional().describe('Canvas x (top-left). Omit to auto-place.'),
  y: z.number().optional().describe('Canvas y (top-left). Omit to auto-place.'),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  parentId: z.string().nullable().optional().describe('Mind-map parent topic id (creates a hierarchical branch). null makes it a root.'),
  frameId: z.string().nullable().optional().describe('Frame (lane/boundary) this node belongs to. Moving the frame moves its members.'),
  collapsed: z.boolean().nullable().optional().describe('Collapse the branch (hides descendants).'),
  tags: z.array(z.string()).nullable().optional().describe('Labels shown as chips.'),
  link: z.string().nullable().optional().describe('Hyperlink URL.'),
  status: z.enum(NODE_STATUSES as [string, ...string[]]).nullable().optional().describe('Task marker.'),
  priority: z.number().int().min(0).max(9).nullable().optional().describe('Priority marker 1-9 (0 clears), as in XMind.'),
  locked: z.boolean().nullable().optional().describe('Locked nodes cannot be dragged in the UI.'),
  points: z.array(z.array(z.number()).length(2)).min(2).nullable().optional().describe("Freehand stroke for kind 'drawing'. On add_nodes without x/y these are absolute canvas coordinates; otherwise relative to the node's top-left."),
};

export const nodeInputSchema = z.object({ id: z.string().min(1).optional().describe('Optional stable id you choose (e.g. "api-gateway") so later calls/edges can reference it.'), ...nodeFieldShape });
export const nodePatchSchema = z.object({ id: z.string().min(1), ...nodeFieldShape });

export const edgeFieldShape = {
  label: z.string().nullable().optional().describe('Text shown in a pill on the connector.'),
  style: z.enum(EDGE_STYLES as [string, ...string[]]).optional(),
  arrow: z.enum(ARROW_MODES as [string, ...string[]]).optional().describe("Arrowheads: 'end' (default), 'start', 'both', 'none'."),
  routing: z.enum(EDGE_ROUTINGS as [string, ...string[]]).optional().describe("'smooth' orthogonal with rounded corners (default), 'bezier', 'straight', 'step'."),
  color: colorSchema.nullable().optional(),
  animated: z.boolean().nullable().optional().describe('Animated flowing dashes (good for data flow).'),
  sourceSide: sideSchema.nullable().optional().describe('Force the side the connector leaves from; omit for automatic.'),
  targetSide: sideSchema.nullable().optional(),
};

export const edgeInputSchema = z.object({ id: z.string().min(1).optional(), source: z.string().min(1), target: z.string().min(1), ...edgeFieldShape });
export const edgePatchSchema = z.object({ id: z.string().min(1), source: z.string().optional(), target: z.string().optional(), ...edgeFieldShape });

const canvasNodeSchema = z.object({
  id: z.string(), kind: z.enum(NODE_KINDS as [string, ...string[]]), title: z.string(), order: z.number(),
  points: z.array(z.array(z.number()).length(2)).optional(),
  x: z.number(), y: z.number(), width: z.number(), height: z.number(),
}).passthrough();
const canvasEdgeSchema = z.object({ id: z.string(), source: z.string(), target: z.string() }).passthrough();

const alignSchema = z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom']);
export const layoutModeSchema = z.enum(['tree', 'graph', 'grid', 'lanes']);
export const layoutDirectionSchema = z.enum(['mindmap', 'right', 'left', 'down', 'LR', 'TB', 'RL', 'BT']);

const settingsPatch = z.object({ autoArrange: z.boolean().optional(), treeLayout: z.enum(TREE_LAYOUTS as [string, ...string[]]).optional() });

export const commandSchema: z.ZodType<unknown> = z.lazy(() => z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_nodes'), nodes: z.array(canvasNodeSchema) }),
  z.object({ type: z.literal('update_nodes'), updates: z.array(nodePatchSchema) }),
  z.object({ type: z.literal('delete_nodes'), ids: z.array(z.string()), withDescendants: z.boolean().optional() }),
  z.object({ type: z.literal('move_nodes'), moves: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })) }),
  z.object({ type: z.literal('reparent'), id: z.string(), parentId: z.string().nullable() }),
  z.object({ type: z.literal('set_collapsed'), ids: z.array(z.string()), collapsed: z.boolean() }),
  z.object({ type: z.literal('add_edges'), edges: z.array(canvasEdgeSchema) }),
  z.object({ type: z.literal('update_edges'), updates: z.array(edgePatchSchema) }),
  z.object({ type: z.literal('delete_edges'), ids: z.array(z.string()) }),
  z.object({ type: z.literal('layout'), mode: layoutModeSchema, direction: layoutDirectionSchema.optional(), rootId: z.string().optional(), nodeIds: z.array(z.string()).optional(), spacing: z.number().positive().optional() }),
  z.object({ type: z.literal('align'), ids: z.array(z.string()), align: alignSchema }),
  z.object({ type: z.literal('distribute'), ids: z.array(z.string()), axis: z.enum(['horizontal', 'vertical']) }),
  z.object({ type: z.literal('fit_frame'), id: z.string(), padding: z.number().nonnegative().optional() }),
  z.object({ type: z.literal('update_document'), title: z.string().optional(), description: z.string().optional(), settings: settingsPatch.optional() }),
  z.object({ type: z.literal('replace_content'), nodes: z.array(canvasNodeSchema), edges: z.array(canvasEdgeSchema) }),
  z.object({ type: z.literal('batch'), commands: z.array(commandSchema) }),
]));

