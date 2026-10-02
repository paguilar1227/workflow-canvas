import { create } from 'zustand';
import type { CanvasDocument, DocumentSummary, SessionState } from '../shared/types';
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
  overlay: Record<string, { x?: number; y?: number; width?: number; height?: number }>;
  dropTargetId: string | null;
  activity: Activity[];
  flashing: Record<string, number>;
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
  overlay: {},
  dropTargetId: null,
  activity: [],
  flashing: {},
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

