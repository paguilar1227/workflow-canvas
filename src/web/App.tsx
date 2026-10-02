import { useEffect } from 'react';
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

export function App() {
  useTheme();
  useKeyboard();
  const panels = useApp((s) => s.session.panels);
  const zen = useApp((s) => s.session.zenMode);
  const viewMode = useApp((s) => s.session.viewMode);
  const doc = useApp((s) => s.doc);
  return (
    <ReactFlowProvider>
      <div className={'app' + (zen ? ' zen' : '') + (viewMode ? ' view-mode' : '')} onClick={() => useApp.getState().menu && set({ menu: null })}>
        <TopBar />
        <div className="main">
          {panels.outline && !zen ? <LeftPanel /> : null}
          <div className="canvas-wrap" data-testid="canvas">
            {doc ? <Canvas /> : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-3)' }}>Loading canvas…</div>}
            {viewMode ? null : <Toolbar />}
            <ModePill />
            <ZoomBar />
            <ActivityFeed />
            <SearchBar />
            <Toast />
          </div>
          {panels.inspector && !zen && !viewMode ? <Inspector /> : null}
        </div>
        <ContextMenu />
        <HelpModal />
        <AiModal />
        <ImportModal />
      </div>
    </ReactFlowProvider>
  );
}

