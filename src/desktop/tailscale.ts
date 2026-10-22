import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export type TailStatus = { available: boolean; connected: boolean; hostname: string; error?: string };
export async function executable(): Promise<string> {
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe')]
    : ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale', '/usr/bin/tailscale'];
  for (const file of candidates) { try { await access(file); return file; } catch {} }
  return 'tailscale';
}
async function run(args: string[]) { const { stdout } = await exec(await executable(), args, { windowsHide: true }); return stdout; }
export async function status(): Promise<TailStatus> {
  try {
    const data = JSON.parse(await run(['status', '--json']));
    return { available: true, connected: data.BackendState === 'Running', hostname: (data.Self?.DNSName || '').replace(/\.$/, '') };
  } catch (error) {
    return { available: false, connected: false, hostname: '', error: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Install Tailscale, sign in, then refresh.' : 'Tailscale is unavailable. Open Tailscale, sign in, then refresh.' };
  }
}
export function checkServeSlot(config: any, hostname: string, httpsPort: number, target: string) {
  const key = hostname + ':' + httpsPort;
  const handlers = config.Web?.[key]?.Handlers;
  const tcp = config.TCP?.[String(httpsPort)];
  if ((handlers && (Object.keys(handlers).length !== 1 || handlers['/']?.Proxy !== target)) || (tcp && !handlers)) {
    throw new Error('This Tailscale HTTPS port already serves another app. Choose another port.');
  }
  if (config.AllowFunnel?.[key]) throw new Error('This port has public Funnel access. Choose a private Serve port.');
}
export async function enable(localPort: number, httpsPort: number, onCreated?: (url: string, target: string) => Promise<void>) {
  if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65535) throw new Error('Choose an HTTPS port from 1 to 65535.');
  const state = await status();
  if (!state.connected || !state.hostname.endsWith('.ts.net')) throw new Error('Connect Tailscale and enable MagicDNS before sharing.');
  const target = 'http://127.0.0.1:' + localPort;
  const config = JSON.parse(await run(['serve', 'status', '--json']));
  checkServeSlot(config, state.hostname, httpsPort, target);
  await run(['serve', '--bg', '--https=' + httpsPort, target]);
  if (!config.Web?.[state.hostname + ':' + httpsPort]) await onCreated?.('https://' + state.hostname + ':' + httpsPort, target);
  const confirmed = JSON.parse(await run(['serve', 'status', '--json']));
  const actual = confirmed.Web?.[state.hostname + ':' + httpsPort]?.Handlers?.['/']?.Proxy;
  if (actual !== target) throw new Error('Tailscale did not confirm the new proxy. Check Tailscale Serve status.');
  return 'https://' + state.hostname + ':' + httpsPort;
}

export async function disable(localPort: number, url: string) {
  if (!url) return;
  const address = new URL(url);
  const state = await status();
  if (!state.connected || address.hostname !== state.hostname) throw new Error('Connect the Tailscale device that owns this phone link first.');
  const port = Number(address.port || 443);
  const config = JSON.parse(await run(['serve', 'status', '--json']));
  checkServeSlot(config, state.hostname, port, 'http://127.0.0.1:' + localPort);
  await run(['serve', '--https=' + port, 'off']);
  const after = JSON.parse(await run(['serve', 'status', '--json']));
  if (after.Web?.[state.hostname + ':' + port]) throw new Error('Tailscale still reports this route. Refresh and try again.');
}
