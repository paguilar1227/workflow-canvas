import { useEffect } from 'react';
import { get, set } from './store';
import * as actions from './actions';
import { dispatch } from './sync';
import * as files from './files';

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/** Keys a focused button or bar in a side panel uses itself (move focus, press, adjust); other shortcuts still reach the canvas. */
const PANEL_CONTROL_KEYS = new Set(['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

function onPanelControl(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && PANEL_CONTROL_KEYS.has(e.key) && !!t.closest('.panel') && t.matches('button, a[href], [role="separator"], [tabindex]:not([tabindex="-1"])');
}

export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = get();
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape' && s.session.mode === 'draw') actions.setMode('select');
      if (e.key === 'Escape') { set({ placing: null, areaSelect: false, menu: null, openMenu: null, helpOpen: false, importOpen: false, aiOpen: false, editingId: null, editingEdgeId: null }); if (!isTyping(e)) set({ selection: { nodes: [], edges: [] } }); return; }
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); actions.openSearch(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void files.save({ as: e.shiftKey }); return; }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); void files.openFile(); return; }
      if (e.altKey && e.code === 'KeyZ') { e.preventDefault(); actions.toggleZen(); return; }
      if (e.altKey && e.code === 'KeyR') { e.preventDefault(); actions.toggleViewMode(); return; }
      if (isTyping(e) || onPanelControl(e) || s.editingId || s.editingEdgeId) return;
      const one = s.selection.nodes.length === 1 ? s.selection.nodes[0] : undefined;
      const k = e.key;
      if (s.placing && k === 'Enter' && !mod) { e.preventDefault(); actions.placeAt(); return; }
      if (s.session.viewMode) {
        if (k.startsWith('Arrow')) { e.preventDefault(); actions.navigate(k.slice(5).toLowerCase() as 'left'); }
        else if (k === '!' || (e.shiftKey && e.code === 'Digit1')) actions.fitView();
        else if (k === '?') set({ helpOpen: true });
        else if (mod && (k === '=' || k === '+')) { e.preventDefault(); actions.zoomIn(); }
        else if (mod && k === '-') { e.preventDefault(); actions.zoomOut(); }
        return;
      }
      if (mod) {
        switch (k.toLowerCase()) {
          case 'z': e.preventDefault(); e.shiftKey ? actions.redo() : actions.undo(); return;
          case 'y': e.preventDefault(); actions.redo(); return;
          case 'c': e.preventDefault(); actions.copy(); return;
          case 'x': e.preventDefault(); actions.cut(); return;
          case 'v': e.preventDefault(); actions.paste(); return;
          case 'd': e.preventDefault(); actions.duplicate(); return;
          case 'a': e.preventDefault(); actions.select((s.doc?.nodes ?? []).map((n) => n.id)); return;
          case 'g': e.preventDefault(); actions.frameSelection(); return;
          case '=': case '+': e.preventDefault(); actions.zoomIn(); return;
          case '-': e.preventDefault(); actions.zoomOut(); return;
          case '0': e.preventDefault(); actions.zoomTo(1); return;
        }
        return;
      }
      if (k === 'Tab') { e.preventDefault(); actions.addChild(one); return; }
      if (k === 'Enter') { e.preventDefault(); if (one) actions.addSibling(one); return; }
      if (k === 'F2') { e.preventDefault(); if (one) set({ editingId: one }); else if (s.selection.edges.length === 1) set({ editingEdgeId: s.selection.edges[0] }); return; }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); actions.deleteSelection(); return; }
      if (k === '/') { e.preventDefault(); actions.toggleCollapse(); return; }
      if (k === '?') { set({ helpOpen: true }); return; }
      if (k === '!' || (e.shiftKey && e.code === 'Digit1')) { actions.fitView(); return; }
      if (k === '@' || (e.shiftKey && e.code === 'Digit2')) { actions.focusNodes(s.selection.nodes); return; }
      if (k.startsWith('Arrow')) {
        e.preventDefault();
        const dir = k.slice(5).toLowerCase() as 'left' | 'right' | 'up' | 'down';
        if (e.shiftKey && s.selection.nodes.length && s.doc) {
          const dx = dir === 'left' ? -10 : dir === 'right' ? 10 : 0, dy = dir === 'up' ? -10 : dir === 'down' ? 10 : 0;
          dispatch({ type: 'move_nodes', includeContents: true, moves: s.selection.nodes.map((id) => { const n = s.doc!.nodes.find((x) => x.id === id)!; return { id, x: n.x + dx, y: n.y + dy }; }) });
        } else actions.navigate(dir);
        return;
      }
      const letter = k.length === 1 ? k.toLowerCase() : '';
      if (!e.altKey && 'nrdostfcvhp'.includes(letter) && letter) e.preventDefault();
      switch (letter) {
        case 'n': actions.insert('topic'); break;
        case 'r': actions.insert('topic', { shape: 'rectangle' }); break;
        case 'd': actions.insert('topic', { shape: 'diamond' }); break;
        case 'o': actions.insert('topic', { shape: 'circle' }); break;
        case 'p': actions.setMode('draw'); break;
        case 's': actions.insert('sticky'); break;
        case 't': actions.insert('text'); break;
        case 'f': actions.insert('frame'); break;
        case 'c': actions.connectSelected(); break;
        case 'v': actions.setMode('select'); break;
        case 'h': actions.setMode('pan'); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

