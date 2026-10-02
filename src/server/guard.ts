import type { IncomingMessage } from 'node:http';

const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'];

function allowedHosts(): string[] | null {
  const raw = (process.env.WFC_ALLOWED_HOSTS ?? '').trim();
  if (raw === '*') return null;
  return [...DEFAULT_HOSTS, ...raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)];
}

function hostname(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
  return h.split(':')[0];
}

/**
 * The app has no login, so only trust requests addressed to an allowed host name (blocks DNS rebinding)
 * and, when a browser sends an Origin, only same-origin pages (blocks other websites driving the tools or live sync).
 */
export function isTrustedRequest(req: IncomingMessage): boolean {
  const host = req.headers.host;
  if (!host) return false;
  const allowed = allowedHosts();
  if (allowed && !allowed.includes(hostname(host))) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host.toLowerCase() === host.toLowerCase(); } catch { return false; }
}

export const UNTRUSTED_MESSAGE = 'Forbidden: request from another website or an unlisted host name. Add the host to WFC_ALLOWED_HOSTS to allow it.';
