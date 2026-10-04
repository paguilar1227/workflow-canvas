import { create } from 'zustand';
import type { CanvasDocument, CanvasNode, ColorName, DocumentSummary, NodeKind, SessionState, Side } from '../shared/types';
import { DEFAULT_SESSION } from '../shared/types';
import { applyCommand, type Command } from '../shared/commands';

export interface Activity { id: number; origin: string; summary: string; at: number }
export interface ContextMenuState { x: number; y: number; flow: { x: number; y: number }; nodeId?: string; edgeId?: string }

export interface AppState {
  connected: boolean;
  clientId: string | null;
  documents: DocumentSummary[];
  docId: string | null;
  confirmed: CanvasDocument | null;
  version: number;
  pending: { opId: string; cmd: Command }[];
  doc: CanvasDocument | null;
  canUndo: boolean;
  canRedo: boolean;
  session: SessionState;
  selection: { nodes: string[]; edges: string[] };
  editingId: string | null;
  editingEdgeId: string | null;
  /** Toolbar/shortcut element waiting for a click on the canvas (per tab, not shared). */
  placing: { kind: NodeKind; extra: Partial<CanvasNode> } | null;
  /** The .excalidraw file this tab autosaves the open document to. */
  file: { docId: string | null; name: string | null; state: 'none' | 'saving' | 'saved' | 'paused' | 'error' | 'unsupported'; savedAt?: number; error?: string };
  /** Phone-width layout: columns become drawers over the canvas (per tab, not shared). */
  compact: boolean;
  /** Touch-first input (coarse pointer): selection action bar and long-press menus. */
  coarse: boolean;
  /** Which column drawer is open in the compact layout, and whether it is expanded to full width. */
  drawer: 'outline' | 'inspector' | null;
  drawerFull: boolean;
  /** Touch: the next one-finger drag on empty canvas box-selects instead of panning (per tab). */
  areaSelect: boolean;
  overlay: Record<string, { x?: number; y?: number; width?: number; height?: number }>;
  dropTargetId: string | null;
  activity: Activity[];
  flashing: Record<string, number>;
  /** Neon Flow: connectors that just appeared (edge id → time) and the cards they landed on, for the one-off connect animation. */
  newEdges: Record<string, number>;
  bursts: Record<string, { color: ColorName; side: Side; at: number }>;
  searchOpen: boolean;
  searchIndex: number;
  helpOpen: boolean;
  importOpen: boolean;
  aiOpen: boolean;
  menu: ContextMenuState | null;
  openMenu: string | null;
  toast: string | null;
}

export const useApp = create<AppState>(() => ({
  connected: false,
  clientId: null,
  documents: [],
  docId: null,
  confirmed: null,
  version: 0,
  pending: [],
  doc: null,
  canUndo: false,
  canRedo: false,
  session: { ...DEFAULT_SESSION },
  selection: { nodes: [], edges: [] },
  editingId: null,
  editingEdgeId: null,
  placing: null,
  file: { docId: null, name: null, state: 'none' },
  compact: false,
  coarse: false,
  drawer: null,
  drawerFull: false,
  areaSelect: false,
  overlay: {},
  dropTargetId: null,
  activity: [],
  flashing: {},
  newEdges: {},
  bursts: {},
  searchOpen: false,
  searchIndex: 0,
  helpOpen: false,
  importOpen: false,
  aiOpen: false,
  menu: null,
  openMenu: null,
  toast: null,
}));

export const get = () => useApp.getState();
export const set = useApp.setState;

export function recompute(confirmed: CanvasDocument | null, pending: { cmd: Command }[]) {
  if (!confirmed) return null;
  return pending.reduce((d, p) => applyCommand(d, p.cmd), confirmed);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string) {
  set({ toast: message });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => set({ toast: null }), 2600);
}

