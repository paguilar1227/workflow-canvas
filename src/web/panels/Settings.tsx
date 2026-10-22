import { useEffect, useRef, useState } from 'react';
import { Settings, X, Monitor, Smartphone, Bot, BookOpen, FolderOpen, Copy, RefreshCw, Download } from 'lucide-react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Checkbox } from '../components/Checkbox';
import { useApp, set } from '../store';
import { updateSession } from '../sync';
import { THEMES } from '../../shared/themes';
import type { DesktopInfo, DesktopPreferences } from '../../shared/desktop';
import './settings.css';

type Tab = 'general' | 'phone' | 'agents' | 'skills';
type Integration = { version: string; publicUrl: string; skill: string; toolCount: number };
const sections: { id: Tab; label: string; icon: typeof Settings }[] = [
  { id: 'general', label: 'General', icon: Monitor }, { id: 'phone', label: 'Phone access', icon: Smartphone },
  { id: 'agents', label: 'AI connections', icon: Bot }, { id: 'skills', label: 'Skills & plugin', icon: BookOpen },
];

export function SettingsPanel() {
  const open = useApp((s) => s.settingsOpen);
  const theme = useApp((s) => s.session.theme);
  const [tab, setTab] = useState<Tab>('general');
  const [desktop, setDesktop] = useState<DesktopInfo | null>(null);
  const [draft, setDraft] = useState<DesktopPreferences | null>(null);
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [port, setPort] = useState('8791');
  const [harness, setHarness] = useState<'codex' | 'claude' | 'cursor'>('codex');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => set({ settingsOpen: false });
  const apply = (data: DesktopInfo) => { setDesktop(data); setDraft(data.preferences); };
  const refresh = async () => {
    const response = await fetch('/api/integration');
    if (!response.ok) throw new Error('Could not load app details. Check the connection and refresh.');
    setIntegration(await response.json());
    if (window.workflowDesktop) apply(await window.workflowDesktop.info());
  };
  useEffect(() => {
    if (!open) return;
    let active = true;
    const focus = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    setMessage(''); setError('');
    void refresh().catch((e) => { if (active) setError(e.message); });
    return () => { active = false; ref.current?.close(); focus?.focus(); };
  }, [open]);
  useEffect(() => window.workflowDesktop?.onSettings(() => set({ settingsOpen: true })), []);
  async function action(run: () => Promise<unknown>, success = '') {
    setBusy(true); setMessage(''); setError('');
    try { await run(); if (success) setMessage(success); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const copy = (text: string) => action(() => navigator.clipboard.writeText(text), 'Copied to clipboard.');
  const base = desktop?.localUrl || location.origin;
  const mcp = base + '/mcp';
  const phone = desktop?.preferences.shareUrl || integration?.publicUrl || '';
  const phoneUrl = phone ? phone + '/?doc=' + encodeURIComponent(useApp.getState().docId || '') : '';
  return (
    <dialog className="settings-dialog" ref={ref} aria-labelledby="settings-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="settings-header"><div><span className="settings-eyebrow">WORKFLOW CANVAS</span><h2 id="settings-title">Settings</h2></div><Button className="btn icon" aria-label="Close settings" onClick={close}><X size={20} /></Button></div>
      <div className="settings-layout">
        <nav aria-label="Settings sections" className="settings-nav">{sections.map(({ id, label, icon: Icon }) => <Button key={id} className={'settings-tab' + (tab === id ? ' active' : '')} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); setMessage(''); setError(''); }}><Icon size={17} /><span>{label}</span></Button>)}</nav>
        <section className="settings-content" aria-busy={busy}>
          {tab === 'general' && <>
            <h3>Make yourself at home</h3><p className="settings-lead">Your canvas, files, and desktop preferences.</p>
            <div className="settings-card"><label htmlFor="settings-theme">Appearance</label><select id="settings-theme" value={theme} onChange={(e) => updateSession({ theme: e.target.value })}>{THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select><p>Theme changes appear in your connected canvas windows.</p></div>
            {desktop && draft ? <>
              <div className="settings-card"><h4>Desktop behavior</h4>
                <label className="settings-check"><Checkbox checked={draft.closeToTray} onChange={(e) => setDraft({ ...draft, closeToTray: e.target.checked })} />Keep running when the window closes</label><p>Phone access and AI connections stay available from the menu bar or system tray.</p>
                <label className="settings-check"><Checkbox checked={draft.openAtLogin} onChange={(e) => setDraft({ ...draft, openAtLogin: e.target.checked })} />Open at login</label>
                <label htmlFor="settings-port">Local server port</label><Input id="settings-port" type="number" min={1024} max={65535} value={draft.port} onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) })} /><p>Port changes take effect after quitting and reopening the app. Update AI connections and phone sharing afterward.</p>
                <Button className="btn primary" disabled={busy} onClick={() => action(async () => apply(await window.workflowDesktop!.savePreferences(draft)), 'Desktop preferences saved.')}>Save preferences</Button>
              </div>
              <div className="settings-card"><h4>Your files</h4><p>Canvas documents are stored on this computer. Separate installations keep separate data.</p><code className="settings-path">{desktop.dataDir}</code><Button className="btn" onClick={() => action(() => window.workflowDesktop!.openDataFolder())}><FolderOpen size={15} />Open data folder</Button></div>
              <div className="settings-card"><h4>Remove Workflow Canvas</h4><p>Uninstall the app, its settings and caches, and the integrations it created. Choose whether to keep your canvases in a backup folder. Pre-existing and customized files are preserved.</p><Button kind="danger" disabled={busy} onClick={() => action(() => window.workflowDesktop!.uninstall())}>Uninstall Workflow Canvas…</Button></div>
              {desktop.startupWarning && <p role="alert" className="settings-error">{desktop.startupWarning}</p>}
            </> : <div className="settings-card"><h4>Browser session</h4><p>Desktop startup and file settings are available in the installed app. You can use this browser for the same canvas and live AI edits.</p></div>}
          </>}
          {tab === 'phone' && <>
            <h3>Take your canvas with you</h3><p className="settings-lead">Open the same live document on your phone through your private Tailscale network.</p>
            <div className="settings-card"><h4>{desktop ? (desktop.tailscale.connected ? 'Tailscale connected' : 'Connect Tailscale') : 'Private phone link'}</h4><p>Install Tailscale on this computer and your phone, sign in to your tailnet, and keep this computer awake. Anyone allowed to reach this service can edit its canvas and use its AI tools.</p>
              {desktop ? <><p>{desktop.tailscale.hostname || desktop.tailscale.error || 'Open Tailscale and sign in, then refresh.'}</p><Button className="btn" disabled={busy} onClick={() => action(refresh, 'Connection refreshed.')}><RefreshCw size={15} />Refresh connection</Button>
              <label htmlFor="sharing-port">Private HTTPS port</label><Input id="sharing-port" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} /><p>Choose an unused port. Existing Tailscale routes are preserved.</p><Button className="btn primary" disabled={busy || !desktop.tailscale.connected} onClick={() => action(async () => apply(await window.workflowDesktop!.enableSharing(Number(port))), 'Private phone access verified.')}><Smartphone size={15} />Enable phone access</Button></> : <p>Enable private sharing in the installed desktop app. The phone uses its browser; no extra canvas app is needed.</p>}
              {phoneUrl ? <><label>Current document link</label><code className="settings-code">{phoneUrl}</code><Button className="btn" onClick={() => copy(phoneUrl)}><Copy size={15} />Copy phone link</Button>{desktop && <Button className="btn" disabled={busy} onClick={() => action(async () => apply(await window.workflowDesktop!.disableSharing()), 'Phone access turned off.')}>Turn off phone access</Button>}</> : <p className="settings-note">No private link configured yet.</p>}
            </div><p className="settings-note">Closing the window can keep the app running. Quitting the app or sleeping the computer ends phone access.</p>
          </>}
          {tab === 'agents' && <>
            <h3>Connect your AI tools</h3><p className="settings-lead">AI agents work on the same documents you see here. {integration?.toolCount ?? 'All'} canvas tools are available through MCP.</p>
            <div className="settings-card"><h4>Streamable HTTP</h4><code className="settings-code">{mcp}</code><Button className="btn" onClick={() => copy(mcp)}><Copy size={15} />Copy endpoint</Button><p>Use this address for an agent on the serving computer. Remote agents use the private phone address with <code>/mcp</code>.</p></div>
            <div className="settings-card"><h4>Quick setup</h4><label>Codex CLI</label><code className="settings-code">codex mcp add workflow-canvas --url {mcp}</code><Button className="btn" onClick={() => copy('codex mcp add workflow-canvas --url ' + mcp)}>Copy Codex command</Button><label>Claude Code</label><code className="settings-code">claude mcp add --transport http workflow-canvas {mcp}</code><Button className="btn" onClick={() => copy('claude mcp add --transport http workflow-canvas ' + mcp)}>Copy Claude command</Button></div>
            <p className="settings-note">For clients that need stdio, export the desktop plugin in Skills & plugin. It starts or connects to this app without Docker.</p>
          </>}
          {tab === 'skills' && <>
            <h3>Give your agent the canvas skill</h3><p className="settings-lead">The bundled skill teaches an agent how to create, arrange, and read Workflow Canvas diagrams. MCP provides the tools; the skill provides guidance.</p>
            <div className="settings-card"><h4>Workflow Canvas</h4><p>Bundled with this app · version {integration?.version || desktop?.version || '—'}</p>
              {desktop ? <><label htmlFor="skill-harness">Install skill for</label><select id="skill-harness" value={harness} onChange={(e) => setHarness(e.target.value as typeof harness)}><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="cursor">Cursor</option></select>
              <Button className="btn primary" disabled={busy} onClick={() => action(async () => { const target = await window.workflowDesktop!.installSkill(harness); setMessage('Installed at ' + target + '. Restart your agent to load it.'); })}><BookOpen size={15} />Install skill</Button>
              <Button className="btn" disabled={busy} onClick={() => action(async () => { const target = await window.workflowDesktop!.exportPlugin(); if (target) setMessage('Plugin exported to ' + target + '. Add it through your agent’s plugin settings.'); })}><Download size={15} />Export desktop plugin…</Button><p>Existing customized skill files are preserved. The exported plugin includes this app’s stdio connection.</p></> : <p>Open the installed app to install the bundled skill or export a desktop plugin.</p>}
            </div><details className="settings-card"><summary>Read the bundled skill</summary><pre className="settings-skill">{integration?.skill || 'The bundled skill is unavailable in this server build.'}</pre></details>
          </>}
          {error && <p role="alert" className="settings-error">{error}</p>}
          {message && <p role="status" className="settings-success">{message}</p>}
        </section>
      </div>
      <div className="settings-footer"><span>Workflow Canvas {desktop?.version || integration?.version || ''}</span><span>{desktop ? 'Desktop app' : 'Connected browser'}</span></div>
    </dialog>
  );
}
