import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Undo2, Redo2, LayoutGrid, Palette, Download, Upload, PanelLeft, PanelRight, Map as MapIcon, HelpCircle, Bot, Search, ChevronDown, Check, Eye, Save, FolderOpen, MoreHorizontal } from 'lucide-react';
import * as files from '../files';
import { useApp, set } from '../store';
import * as actions from '../actions';
import { THEMES } from '../../shared/themes';

export function Menu({ id, label, icon, children, align = 'right', testId, chevron = true, ariaLabel }: { id: string; label?: string; icon: ReactNode; children: ReactNode; align?: 'left' | 'right'; testId?: string; chevron?: boolean; ariaLabel?: string }) {
  const open = useApp((s) => s.openMenu === id);
  return (
    <div className="menu-anchor">
      <button className={'btn' + (label || chevron ? '' : ' icon') + (open ? ' active' : '')} data-testid={testId} title={label ?? ariaLabel} aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); set({ openMenu: open ? null : id }); }}>
        {icon}{label ? <span className="menu-label-text">{label}</span> : null}{chevron ? <ChevronDown size={13} /> : null}
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
  const compact = useApp((s) => s.compact);
  const drawer = useApp((s) => s.drawer);
  const headerRef = useRef<HTMLElement>(null);
  /** 0: full bar; 1: icon-only labels; 2: everything but the essentials moves into More. Chosen by measured overflow. */
  const [fit, setFit] = useState(0);
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => { const on = () => { setFit(0); setVw(window.innerWidth); }; window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const [title, setTitle] = useState(doc?.title ?? '');
  useEffect(() => setTitle(doc?.title ?? ''), [doc?.title, doc?.id]);
  const aiLive = activity.length > 0 && Date.now() - activity[activity.length - 1].at < 15000;
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 5000); return () => clearInterval(t); }, []);

  useLayoutEffect(() => { setFit(0); }, [theme, aiLive, compact]);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el || compact || fit >= 2) return;
    if (el.scrollWidth > el.clientWidth + 1) setFit(fit + 1);
  }, [fit, vw, theme, aiLive, compact]);

  const titleInput = (
    <input
      className="doc-title" aria-label="Document title" data-testid="doc-title" value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => { if (doc && title.trim() && title !== doc.title) actions.renameDocument(title.trim()); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTitle(doc?.title ?? ''); (e.target as HTMLInputElement).blur(); } }}
    />
  );

  if (compact || fit >= 2) {
    const outlineOn = compact ? drawer === 'outline' : panels.outline;
    return (
      <header className={'topbar' + (compact ? '' : ' fit-2')} ref={headerRef} onClick={() => set({ openMenu: null })}>
        <button className={'btn icon' + (outlineOn ? ' active' : '')} aria-label="Toggle outline panel" aria-pressed={outlineOn} data-testid="toggle-outline" title="Documents & outline" onClick={(e) => { e.stopPropagation(); actions.togglePanel('outline'); }}><PanelLeft size={18} /></button>
        {titleInput}
        <button className="btn icon" title="Undo" aria-label="Undo" data-testid="undo" disabled={!canUndo || session.viewMode} onClick={actions.undo}><Undo2 size={18} /></button>
        <button className="btn icon" title="Redo" aria-label="Redo" data-testid="redo" disabled={!canRedo || session.viewMode} onClick={actions.redo}><Redo2 size={18} /></button>
        <SaveButton />
        <Menu id="more" icon={<MoreHorizontal size={18} />} chevron={false} ariaLabel="More" testId="menu-more">
          {session.viewMode ? null : <MenuItem testId="toggle-inspector" onClick={() => actions.togglePanel('inspector')}><PanelRight size={14} />Inspector</MenuItem>}
          {compact ? null : <MenuItem testId="toggle-minimap" active={panels.minimap} onClick={() => actions.togglePanel('minimap')}><MapIcon size={14} />Minimap</MenuItem>}
          <MenuItem testId="open-search" onClick={() => actions.openSearch()}><Search size={14} />Search</MenuItem>
          <MenuItem testId="open-import" onClick={() => set({ importOpen: true })}><Upload size={14} />Import…</MenuItem>
          <MenuItem testId="ai-chip" onClick={() => set({ aiOpen: true })}><Bot size={14} />{aiLive ? 'AI is editing · connect another' : 'Connect an AI agent (MCP)'}</MenuItem>
          <MenuItem testId="open-help" onClick={() => set({ helpOpen: true })}><HelpCircle size={14} />Help & gestures</MenuItem>
          <hr />
          <div className="menu-label">File</div>
          <FileItems />
          <hr />
          <LayoutItems />
          <hr />
          <div className="menu-label">View</div>
          <ViewItems />
          <hr />
          <ThemeItems />
        </Menu>
      </header>
    );
  }
  return (
    <header className={'topbar' + (fit ? ' fit-' + fit : '')} ref={headerRef} onClick={() => set({ openMenu: null })}>
      <div className="brand"><span className="brand-mark">◇</span><span className="brand-text">Workflow Canvas</span></div>
      {titleInput}
      <button className={'chip' + (aiLive ? ' live' : '')} data-testid="ai-chip" title="Connect an AI agent" onClick={(e) => { e.stopPropagation(); set({ aiOpen: true }); }}>
        <span className="dot" /><Bot size={13} /><span className="chip-label">{aiLive ? 'AI editing' : 'AI ready · MCP'}</span>
      </button>
      <div className="spacer" />
      <SaveButton />
      <button className="btn icon" title="Undo (⌘Z)" aria-label="Undo" data-testid="undo" disabled={!canUndo || session.viewMode} onClick={actions.undo}><Undo2 size={16} /></button>
      <button className="btn icon" title="Redo (⇧⌘Z)" aria-label="Redo" data-testid="redo" disabled={!canRedo || session.viewMode} onClick={actions.redo}><Redo2 size={16} /></button>
      <div className="sep" />
      <button className="btn icon" title="Search (⌘F)" aria-label="Search" data-testid="open-search" onClick={() => actions.openSearch()}><Search size={16} /></button>
      <Menu id="layout" label="Layout" icon={<LayoutGrid size={15} />} testId="menu-layout">
        <LayoutItems />
      </Menu>
      <Menu id="theme" label={THEMES.find((t) => t.id === theme)?.name ?? 'Theme'} icon={<Palette size={15} />} testId="menu-theme">
        <ThemeItems />
      </Menu>
      <Menu id="export" label="File" icon={<Download size={15} />} testId="menu-export">
        <FileItems />
      </Menu>
      <Menu id="view" label="View" icon={<Eye size={15} />} testId="menu-view">
        <ViewItems />
      </Menu>
      <button className="btn" data-testid="open-import" aria-label="Import" title="Import" onClick={() => set({ importOpen: true })}><Upload size={15} /><span className="menu-label-text">Import</span></button>
      <div className="sep" />
      <button className={'btn icon' + (panels.outline ? ' active' : '')} aria-label="Toggle outline panel" data-testid="toggle-outline" title="Outline & documents" onClick={() => actions.togglePanel('outline')}><PanelLeft size={16} /></button>
      <button className={'btn icon' + (panels.minimap ? ' active' : '')} aria-label="Toggle minimap" data-testid="toggle-minimap" title="Minimap" onClick={() => actions.togglePanel('minimap')}><MapIcon size={16} /></button>
      <button className={'btn icon' + (panels.inspector ? ' active' : '')} aria-label="Toggle inspector panel" data-testid="toggle-inspector" title="Inspector" onClick={() => actions.togglePanel('inspector')}><PanelRight size={16} /></button>
      <button className="btn icon" aria-label="Help and shortcuts" data-testid="open-help" title="Shortcuts (?)" onClick={() => set({ helpOpen: true })}><HelpCircle size={16} /></button>
    </header>
  );
}


function LayoutItems() {
  const settings = useApp((s) => s.doc?.settings);
  return (
    <>
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
    </>
  );
}

function ThemeItems() {
  const theme = useApp((s) => s.session.theme);
  return (
    <>
      <div className="menu-label">Theme · Refero styles + Excalidraw</div>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button key={t.id} className={'theme-option' + (t.id === theme ? ' active' : '')} data-testid={'theme-' + t.id} onClick={() => { actions.setTheme(t.id); }}>
            <ThemeSwatch id={t.id} />
            <span><div className="theme-name">{t.name}</div><div className="theme-src">{t.source.label}</div></span>
          </button>
        ))}
      </div>
    </>
  );
}

function FileItems() {
  return (
    <>
      <MenuItem testId="file-open" kbd="⌘O" onClick={() => void files.openFile()}><FolderOpen size={14} />Open .excalidraw…</MenuItem>
      <MenuItem testId="file-save" kbd="⌘S" onClick={() => void files.save()}><Save size={14} />Save</MenuItem>
      <MenuItem testId="file-save-as" kbd="⇧⌘S" onClick={() => void files.save({ as: true })}><span style={{ width: 14 }} />Save as…</MenuItem>
      <hr />
      <div className="menu-label">Export</div>
      <MenuItem testId="export-png" onClick={() => actions.exportAs('png')}>PNG image</MenuItem>
      <MenuItem testId="export-svg" onClick={() => actions.exportAs('svg')}>SVG image</MenuItem>
      <MenuItem testId="export-markdown" onClick={() => actions.exportAs('markdown')}>Markdown outline</MenuItem>
      <MenuItem testId="export-logic" onClick={() => actions.exportAs('logic')}>Logic description (.md)</MenuItem>
      <MenuItem testId="export-mermaid" onClick={() => actions.exportAs('mermaid')}>Mermaid flowchart</MenuItem>
      <MenuItem testId="export-excalidraw" onClick={() => actions.exportAs('excalidraw')}>Excalidraw (.excalidraw)</MenuItem>
      <MenuItem testId="export-json" onClick={() => actions.exportAs('json')}>JSON</MenuItem>
      <hr />
      <MenuItem testId="copy-png" onClick={() => actions.copyPng()}>Copy PNG to clipboard</MenuItem>
    </>
  );
}

function ViewItems() {
  const session = useApp((s) => s.session);
  return (
    <>
      <MenuItem testId="view-zen" kbd="Alt+Z" onClick={actions.toggleZen} active={session.zenMode}>{session.zenMode ? <Check size={14} /> : <span style={{ width: 14 }} />}Zen mode</MenuItem>
      <MenuItem testId="view-readonly" kbd="Alt+R" onClick={actions.toggleViewMode} active={session.viewMode}>{session.viewMode ? <Check size={14} /> : <span style={{ width: 14 }} />}View mode (read-only)</MenuItem>
      <MenuItem testId="view-snap" onClick={actions.toggleSnap}>{session.snapToGrid ? <Check size={14} /> : <span style={{ width: 14 }} />}Snap to grid</MenuItem>
      <hr />
      <div className="menu-label">Canvas background</div>
      {(['theme', 'dots', 'lines', 'cross', 'none'] as const).map((b) => (
        <MenuItem key={b} testId={'bg-' + b} onClick={() => actions.setBackground(b)} active={session.background === b}>{session.background === b ? <Check size={14} /> : <span style={{ width: 14 }} />}{b === 'theme' ? 'Theme default' : b}</MenuItem>
      ))}
    </>
  );
}

const SAVE_LABEL: Record<string, string> = { none: 'Save', saving: 'Saving…', saved: 'Saved', paused: 'Resume autosave', error: 'Save failed', unsupported: 'Save' };

/** Save state for the open document: Finder dialog on first save, then autosave to that .excalidraw file. */
function SaveButton() {
  const file = useApp((s) => s.file);
  const viewMode = useApp((s) => s.session.viewMode);
  if (viewMode) return null;
  const tip = file.state === 'none' ? 'Save to a .excalidraw file (⌘S); after that every change autosaves'
    : file.state === 'unsupported' ? 'Download a .excalidraw copy (⌘S). Autosave to a file needs Chrome or Edge.'
    : file.state === 'paused' ? 'Click to let the browser keep autosaving to ' + file.name
    : file.state === 'error' ? 'Saving to ' + (file.name ?? 'the file') + ' failed: ' + (file.error ?? 'unknown error') + '. Click to retry.'
    : 'Autosaving to ' + file.name + (file.savedAt ? ' · last saved ' + new Date(file.savedAt).toLocaleTimeString() : '');
  return (
    <button className={'btn save-btn ' + file.state} data-testid="save-file" data-state={file.state} title={tip} aria-label={SAVE_LABEL[file.state]} onClick={(e) => { e.stopPropagation(); void files.save(); }}>
      {file.state === 'saved' ? <Check size={15} /> : <Save size={15} />}<span className="menu-label-text">{SAVE_LABEL[file.state]}</span>
    </button>
  );
}
