import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useApp, set, get } from './store';
import { Canvas } from './canvas/Canvas';
import { TopBar } from './panels/TopBar';
import { LeftPanel } from './panels/LeftPanel';
import { Inspector } from './panels/Inspector';
import { Toolbar, ZoomBar, SearchBar, ActivityFeed, Toast, ContextMenu, HelpModal, AiModal, ImportModal, ModePill, SelectionBar } from './panels/Chrome';
import { useKeyboard } from './keyboard';
import { EmojiAssist } from './panels/EmojiAssist';
import { NodePopover } from './panels/NodePopover';
import { getTheme, THEMES } from '../shared/themes';

const ALL_TOKEN_KEYS = [...new Set(THEMES.flatMap((t) => Object.keys(t.tokens)))];

function useTheme() {
  const id = useApp((s) => s.session.theme);
  useEffect(() => {
    const t = getTheme(id);
    const root = document.documentElement;
    for (const k of ALL_TOKEN_KEYS) {
      const v = t.tokens[k];
      if (v === undefined) root.style.removeProperty(k); else root.style.setProperty(k, v);
    }
    root.dataset.theme = t.id;
    if (t.neon) root.dataset.neon = ''; else delete root.dataset.neon;
    root.dataset.mode = t.mode;
    root.style.colorScheme = t.mode;
  }, [id]);
}

/**
 * Drawer ("compact") layout whenever the docked columns and the toolbar cannot sit side by side: outline 268px +
 * inspector 292px + toolbar (measured 622px with a mouse, 502px with touch sizing) + 8px margins. Also any touch
 * screen shorter than a tablet (landscape phones are at most ~430px tall; the smallest iPad is 744px).
 * Touch sizing follows the pointer type, not the width.
 */
const COMPACT_QUERY = '(max-width: 1077px), (pointer: fine) and (max-width: 1197px), (pointer: coarse) and (max-height: 600px)';
const COARSE_QUERY = '(pointer: coarse)';

function useDeviceClass() {
  useEffect(() => {
    const compact = window.matchMedia(COMPACT_QUERY);
    const coarse = window.matchMedia(COARSE_QUERY);
    const apply = () => {
      const c = compact.matches;
      set({ compact: c, coarse: coarse.matches, ...(c ? {} : { drawer: null, drawerFull: false }) });
    };
    apply();
    compact.addEventListener('change', apply);
    coarse.addEventListener('change', apply);
    return () => { compact.removeEventListener('change', apply); coarse.removeEventListener('change', apply); };
  }, []);
}

const SLIDE_MS = 220;

/** Keeps a side column mounted while it slides closed, and opens it with a width + slide transition. */
function SlideColumn({ open, side, width, children }: { open: boolean; side: 'left' | 'right'; width: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [open]);
  if (!mounted) return null;
  return <div className={'column-slot ' + side + (shown ? ' shown' : '')} style={{ ['--slot-w' as string]: width, ['--slide-ms' as string]: SLIDE_MS + 'ms' }}>{children}</div>;
}

/**
 * Keeps the bottom chrome from overlapping: the toolbar stays centred, and the zoom bar, minimap and
 * activity feed lift above it only when the toolbar's measured box would collide with them.
 */
function useDockLayout(ref: RefObject<HTMLDivElement | null>, deps: unknown[]) {
  useLayoutEffect(() => {
    const wrap = ref.current;
    if (!wrap) return;
    const update = () => {
      const toolbar = wrap.querySelector<HTMLElement>('.toolbar');
      if (!toolbar) { delete wrap.dataset.dock; return; }
      const t = toolbar.getBoundingClientRect();
      const gap = 8;
      const clashes = (el: Element | null) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.left < t.right + gap && r.right > t.left - gap; };
      const raised = !get().compact && (clashes(wrap.querySelector('.zoombar')) || clashes(wrap.querySelector('.react-flow__minimap')));
      const lift = Math.round(wrap.getBoundingClientRect().bottom - t.top + gap);
      wrap.style.setProperty('--dock-lift', lift + 'px');
      // The touch selection bar sits above the toolbar, and above the zoom bar and minimap when those are lifted too.
      const lifted = raised ? Math.max(0, ...['.zoombar', '.react-flow__minimap'].map((s) => wrap.querySelector(s)?.getBoundingClientRect().height ?? 0)) : 0;
      wrap.style.setProperty('--bar-lift', (lifted ? lift + Math.round(lifted) + gap : lift) + 'px');
      if (raised) wrap.dataset.dock = 'raised'; else delete wrap.dataset.dock;
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    const toolbar = wrap.querySelector('.toolbar');
    if (toolbar) ro.observe(toolbar);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Docked width on desktop; on phones a drawer that leaves a 44px strip of canvas to tap, or the full width when expanded. */
function drawerWidth(compact: boolean, full: boolean, px: number) {
  if (!compact) return px + 'px';
  return full ? '100vw' : 'min(' + px + 'px, calc(100vw - 44px))';
}

export function App() {
  useTheme();
  useKeyboard();
  useDeviceClass();
  const compact = useApp((s) => s.compact);
  const drawer = useApp((s) => s.drawer);
  const drawerFull = useApp((s) => s.drawerFull);
  const panels = useApp((s) => s.session.panels);
  const zen = useApp((s) => s.session.zenMode);
  const viewMode = useApp((s) => s.session.viewMode);
  const doc = useApp((s) => s.doc);
  const minimap = useApp((s) => s.session.panels.minimap);
  const canvasRef = useRef<HTMLDivElement>(null);
  useDockLayout(canvasRef, [viewMode, zen, minimap, !!doc, compact]);
  return (
    <ReactFlowProvider>
      <div className={'app' + (zen ? ' zen' : '') + (viewMode ? ' view-mode' : '') + (compact ? ' compact' : '')} onClick={() => useApp.getState().menu && set({ menu: null })}>
        <TopBar />
        <div className="main">
          <SlideColumn open={compact ? drawer === 'outline' : panels.outline && !zen} side="left" width={drawerWidth(compact, drawerFull, 268)}><LeftPanel /></SlideColumn>
          <div className="canvas-wrap" data-testid="canvas" ref={canvasRef}>
            {doc ? <Canvas /> : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-3)' }}>Loading canvas…</div>}
            {viewMode ? null : <Toolbar />}
            <ModePill />
            {viewMode ? null : <SelectionBar />}
            <ZoomBar />
            <ActivityFeed />
            <SearchBar />
            <Toast />
          </div>
          <SlideColumn open={compact ? drawer === 'inspector' && !viewMode : panels.inspector && !zen && !viewMode} side="right" width={drawerWidth(compact, drawerFull, 292)}><Inspector /></SlideColumn>
          {compact ? <div className={'drawer-backdrop' + (drawer ? ' shown' : '')} data-testid="drawer-backdrop" aria-hidden={!drawer} onClick={() => set({ drawer: null, drawerFull: false })} /> : null}
        </div>
        <ContextMenu />
        <NodePopover />
        <HelpModal />
        <AiModal />
        <ImportModal />
        <EmojiAssist />
      </div>
    </ReactFlowProvider>
  );
}

