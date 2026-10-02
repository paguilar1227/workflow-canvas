import { useEffect, useState, type ReactNode } from 'react';
import { Undo2, Redo2, LayoutGrid, Palette, Download, Upload, PanelLeft, PanelRight, Map as MapIcon, HelpCircle, Bot, Search, ChevronDown, Check, Eye } from 'lucide-react';
import { useApp, set } from '../store';
import * as actions from '../actions';
import { THEMES } from '../../shared/themes';

export function Menu({ id, label, icon, children, align = 'right', testId }: { id: string; label?: string; icon: ReactNode; children: ReactNode; align?: 'left' | 'right'; testId?: string }) {
  const open = useApp((s) => s.openMenu === id);
  return (
    <div className="menu-anchor">
      <button className={'btn' + (open ? ' active' : '')} data-testid={testId} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); set({ openMenu: open ? null : id }); }}>
        {icon}{label ? <span>{label}</span> : null}<ChevronDown size={13} />
      </button>
      {open ? <div className={'menu ' + align} role="menu" onClick={(e) => e.stopPropagation()}>{children}</div> : null}
    </div>
  );
}

export function MenuItem({ children, onClick, kbd, active, testId }: { children: ReactNode; onClick: () => void; kbd?: string; active?: boolean; testId?: string }) {
  return (
    <button className={'menu-item' + (active ? ' active' : '')} role="menuitem" data-testid={testId} onClick={() => { set({ openMenu: null }); onClick(); }}>
      {children}{kbd ? <span className="kbd">{kbd}</span> : null}
    </button>
  );
}

function ThemeSwatch({ id }: { id: string }) {
  const t = THEMES.find((x) => x.id === id)!;
  const k = t.tokens;
  return (
    <span className="theme-swatch" style={{ background: k['--bg'] }}>
      <i style={{ left: 6, width: 18, background: k['--node-bg'], border: '1px solid ' + k['--node-border'] }} />
      <i style={{ left: 28, width: 10, background: k['--selection'] }} />
      <i style={{ left: 42, width: 8, background: k['--c-green'] }} />
    </span>
  );
}

export function TopBar() {
  const doc = useApp((s) => s.doc);
  const canUndo = useApp((s) => s.canUndo);
  const canRedo = useApp((s) => s.canRedo);
  const theme = useApp((s) => s.session.theme);
  const panels = useApp((s) => s.session.panels);
  const session = useApp((s) => s.session);
  const settings = doc?.settings;
  const activity = useApp((s) => s.activity);
  const [title, setTitle] = useState(doc?.title ?? '');
  useEffect(() => setTitle(doc?.title ?? ''), [doc?.title, doc?.id]);
  const aiLive = activity.length > 0 && Date.now() - activity[activity.length - 1].at < 15000;
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 5000); return () => clearInterval(t); }, []);

  return (
    <header className="topbar" onClick={() => set({ openMenu: null })}>
      <div className="brand"><span className="brand-mark">◇</span>Workflow Canvas</div>
      <input
        className="doc-title" aria-label="Document title" data-testid="doc-title" value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => { if (doc && title.trim() && title !== doc.title) actions.renameDocument(title.trim()); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTitle(doc?.title ?? ''); (e.target as HTMLInputElement).blur(); } }}
      />
      <button className={'chip' + (aiLive ? ' live' : '')} data-testid="ai-chip" title="Connect an AI agent" onClick={(e) => { e.stopPropagation(); set({ aiOpen: true }); }}>
        <span className="dot" /><Bot size={13} />{aiLive ? 'AI editing' : 'AI ready · MCP'}
      </button>
      <div className="spacer" />
      <button className="btn icon" title="Undo (⌘Z)" aria-label="Undo" data-testid="undo" disabled={!canUndo} onClick={actions.undo}><Undo2 size={16} /></button>
      <button className="btn icon" title="Redo (⇧⌘Z)" aria-label="Redo" data-testid="redo" disabled={!canRedo} onClick={actions.redo}><Redo2 size={16} /></button>
      <div className="sep" />
      <button className="btn icon" title="Search (⌘F)" aria-label="Search" onClick={() => actions.openSearch()}><Search size={16} /></button>
      <Menu id="layout" label="Layout" icon={<LayoutGrid size={15} />} testId="menu-layout">
        <div className="menu-label">Mind map structure</div>
        <MenuItem testId="layout-mindmap" onClick={() => { actions.setDocSettings({ treeLayout: 'mindmap' }); actions.layout('tree', 'mindmap'); }} active={settings?.treeLayout === 'mindmap'}>Mind map (balanced)</MenuItem>
        <MenuItem testId="layout-right" onClick={() => { actions.setDocSettings({ treeLayout: 'right' }); actions.layout('tree', 'right'); }} active={settings?.treeLayout === 'right'}>Logic chart →</MenuItem>
        <MenuItem testId="layout-left" onClick={() => { actions.setDocSettings({ treeLayout: 'left' }); actions.layout('tree', 'left'); }} active={settings?.treeLayout === 'left'}>Logic chart ←</MenuItem>
        <MenuItem testId="layout-down" onClick={() => { actions.setDocSettings({ treeLayout: 'down' }); actions.layout('tree', 'down'); }} active={settings?.treeLayout === 'down'}>Org chart ↓</MenuItem>
        <MenuItem testId="layout-autoarrange" onClick={() => actions.setDocSettings({ autoArrange: !settings?.autoArrange })}>
          {settings?.autoArrange ? <Check size={14} /> : <span style={{ width: 14 }} />}Auto-arrange branches
        </MenuItem>
        <hr />
        <div className="menu-label">Diagram</div>
        <MenuItem testId="layout-graph-lr" onClick={() => actions.layout('graph', 'LR')}>Flow left → right</MenuItem>
        <MenuItem testId="layout-graph-tb" onClick={() => actions.layout('graph', 'TB')}>Flow top → bottom</MenuItem>
        <MenuItem testId="layout-lanes" onClick={() => actions.layout('lanes')}>Swimlanes (frames as columns)</MenuItem>
        <MenuItem testId="layout-grid" onClick={() => actions.layout('grid')}>Grid</MenuItem>
      </Menu>
      <Menu id="theme" label={THEMES.find((t) => t.id === theme)?.name ?? 'Theme'} icon={<Palette size={15} />} testId="menu-theme">
        <div className="menu-label">Theme · Refero styles + Excalidraw</div>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button key={t.id} className={'theme-option' + (t.id === theme ? ' active' : '')} data-testid={'theme-' + t.id} onClick={() => { actions.setTheme(t.id); }}>
              <ThemeSwatch id={t.id} />
              <span><div className="theme-name">{t.name}</div><div className="theme-src">{t.source.label}</div></span>
            </button>
          ))}
        </div>
      </Menu>
      <Menu id="export" label="Export" icon={<Download size={15} />} testId="menu-export">
        <MenuItem testId="export-png" onClick={() => actions.exportAs('png')}>PNG image</MenuItem>
        <MenuItem testId="export-svg" onClick={() => actions.exportAs('svg')}>SVG image</MenuItem>
        <MenuItem testId="export-markdown" onClick={() => actions.exportAs('markdown')}>Markdown outline</MenuItem>
        <MenuItem testId="export-mermaid" onClick={() => actions.exportAs('mermaid')}>Mermaid flowchart</MenuItem>
        <MenuItem testId="export-excalidraw" onClick={() => actions.exportAs('excalidraw')}>Excalidraw (.excalidraw)</MenuItem>
        <MenuItem testId="export-json" onClick={() => actions.exportAs('json')}>JSON</MenuItem>
        <hr />
        <MenuItem testId="copy-png" onClick={() => actions.copyPng()}>Copy PNG to clipboard</MenuItem>
      </Menu>
      <Menu id="view" label="View" icon={<Eye size={15} />} testId="menu-view">
        <MenuItem testId="view-zen" kbd="Alt+Z" onClick={actions.toggleZen} active={session.zenMode}>{session.zenMode ? <Check size={14} /> : <span style={{ width: 14 }} />}Zen mode</MenuItem>
        <MenuItem testId="view-readonly" kbd="Alt+R" onClick={actions.toggleViewMode} active={session.viewMode}>{session.viewMode ? <Check size={14} /> : <span style={{ width: 14 }} />}View mode (read-only)</MenuItem>
        <MenuItem testId="view-snap" onClick={actions.toggleSnap}>{session.snapToGrid ? <Check size={14} /> : <span style={{ width: 14 }} />}Snap to grid</MenuItem>
        <hr />
        <div className="menu-label">Canvas background</div>
        {(['theme', 'dots', 'lines', 'cross', 'none'] as const).map((b) => (
          <MenuItem key={b} testId={'bg-' + b} onClick={() => actions.setBackground(b)} active={session.background === b}>{session.background === b ? <Check size={14} /> : <span style={{ width: 14 }} />}{b === 'theme' ? 'Theme default' : b}</MenuItem>
        ))}
      </Menu>
      <button className="btn" data-testid="open-import" onClick={() => set({ importOpen: true })}><Upload size={15} />Import</button>
      <div className="sep" />
      <button className={'btn icon' + (panels.outline ? ' active' : '')} aria-label="Toggle outline panel" data-testid="toggle-outline" title="Outline & documents" onClick={() => actions.togglePanel('outline')}><PanelLeft size={16} /></button>
      <button className={'btn icon' + (panels.minimap ? ' active' : '')} aria-label="Toggle minimap" data-testid="toggle-minimap" title="Minimap" onClick={() => actions.togglePanel('minimap')}><MapIcon size={16} /></button>
      <button className={'btn icon' + (panels.inspector ? ' active' : '')} aria-label="Toggle inspector panel" data-testid="toggle-inspector" title="Inspector" onClick={() => actions.togglePanel('inspector')}><PanelRight size={16} /></button>
      <button className="btn icon" aria-label="Help and shortcuts" title="Shortcuts (?)" onClick={() => set({ helpOpen: true })}><HelpCircle size={16} /></button>
    </header>
  );
}

