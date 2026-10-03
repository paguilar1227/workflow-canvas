import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useApp, set } from './store';
import { Canvas } from './canvas/Canvas';
import { TopBar } from './panels/TopBar';
import { LeftPanel } from './panels/LeftPanel';
import { Inspector } from './panels/Inspector';
import { Toolbar, ZoomBar, SearchBar, ActivityFeed, Toast, ContextMenu, HelpModal, AiModal, ImportModal, ModePill } from './panels/Chrome';
import { useKeyboard } from './keyboard';
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
    root.dataset.mode = t.mode;
    root.style.colorScheme = t.mode;
  }, [id]);
}

const SLIDE_MS = 220;

/** Keeps a side column mounted while it slides closed, and opens it with a width + slide transition. */
function SlideColumn({ open, side, width, children }: { open: boolean; side: 'left' | 'right'; width: number; children: ReactNode }) {
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
  return <div className={'column-slot ' + side + (shown ? ' shown' : '')} style={{ ['--slot-w' as string]: width + 'px', ['--slide-ms' as string]: SLIDE_MS + 'ms' }}>{children}</div>;
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
      const clashes = (el: Element | null) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.left < t.right + gap && r.right > t.left - gap; };
      const raised = clashes(wrap.querySelector('.zoombar')) || clashes(wrap.querySelector('.react-flow__minimap'));
      wrap.style.setProperty('--dock-lift', Math.round(wrap.getBoundingClientRect().bottom - t.top + gap) + 'px');
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

export function App() {
  useTheme();
  useKeyboard();
  const panels = useApp((s) => s.session.panels);
  const zen = useApp((s) => s.session.zenMode);
  const viewMode = useApp((s) => s.session.viewMode);
  const doc = useApp((s) => s.doc);
  const minimap = useApp((s) => s.session.panels.minimap);
  const canvasRef = useRef<HTMLDivElement>(null);
  useDockLayout(canvasRef, [viewMode, zen, minimap, !!doc]);
  return (
    <ReactFlowProvider>
      <div className={'app' + (zen ? ' zen' : '') + (viewMode ? ' view-mode' : '')} onClick={() => useApp.getState().menu && set({ menu: null })}>
        <TopBar />
        <div className="main">
          <SlideColumn open={panels.outline && !zen} side="left" width={268}><LeftPanel /></SlideColumn>
          <div className="canvas-wrap" data-testid="canvas" ref={canvasRef}>
            {doc ? <Canvas /> : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-3)' }}>Loading canvas…</div>}
            {viewMode ? null : <Toolbar />}
            <ModePill />
            <ZoomBar />
            <ActivityFeed />
            <SearchBar />
            <Toast />
          </div>
          <SlideColumn open={panels.inspector && !zen && !viewMode} side="right" width={292}><Inspector /></SlideColumn>
        </div>
        <ContextMenu />
        <HelpModal />
        <AiModal />
        <ImportModal />
      </div>
    </ReactFlowProvider>
  );
}

