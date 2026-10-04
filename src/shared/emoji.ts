import type { Command } from './commands';

/** Shortcode (without colons, lower case) → emoji. Injected so the browser can load the table lazily. */
export type ShortcodeTable = ReadonlyMap<string, string>;

/** GitHub-style shortcodes, e.g. :rocket: or :+1:. */
export const SHORTCODE_PATTERN = /:([a-z0-9_+-]+):/gi;
/** Markdown code (fenced blocks and inline spans) keeps its colons as typed. */
const CODE = /(\x60{3,}[\s\S]*?(?:\x60{3,}|$)|\x60[^\x60\n]*\x60)/g;

/** Build the table from emojibase compact data plus one of its shortcode presets. */
export function buildShortcodeTable(emojis: { hexcode: string; unicode: string; skins?: { hexcode: string; unicode: string }[] }[], shortcodes: Record<string, string | string[]>): Map<string, string> {
  const byHex = new Map<string, string>();
  for (const e of emojis) {
    byHex.set(e.hexcode, e.unicode);
    for (const s of e.skins ?? []) byHex.set(s.hexcode, s.unicode);
  }
  const table = new Map<string, string>();
  for (const [hex, codes] of Object.entries(shortcodes)) {
    const unicode = byHex.get(hex);
    if (!unicode) continue;
    for (const code of Array.isArray(codes) ? codes : [codes]) table.set(code.toLowerCase(), unicode);
  }
  return table;
}

/** Replace known :shortcodes: with emoji everywhere except inside Markdown code. */
export function emojify(text: string, table: ShortcodeTable): string {
  if (!text || !text.includes(':')) return text;
  return text.split(CODE).map((part, i) => (i % 2 === 1 ? part : part.replace(SHORTCODE_PATTERN, (m, code: string) => table.get(code.toLowerCase()) ?? m))).join('');
}

type Texty = { title?: string; subtitle?: string; notes?: string; badge?: string; icon?: string; tags?: string[]; label?: string };
function emojifyFields<T extends Texty>(o: T, table: ShortcodeTable): T {
  let out = o;
  for (const k of ['title', 'subtitle', 'notes', 'badge', 'icon', 'label'] as const) {
    const v = o[k];
    if (typeof v === 'string') { const e = emojify(v, table); if (e !== v) out = { ...out, [k]: e }; }
  }
  if (Array.isArray(o.tags)) { const tags = o.tags.map((t) => emojify(t, table)); if (tags.some((t, i) => t !== o.tags![i])) out = { ...out, tags }; }
  return out;
}

/** Every text a person or an AI writes goes through here once, on the server, so all clients see the same emoji. */
export function emojifyCommand(cmd: Command, table: ShortcodeTable): Command {
  switch (cmd.type) {
    case 'add_nodes': return { ...cmd, nodes: cmd.nodes.map((n) => emojifyFields(n, table)) };
    case 'update_nodes': return { ...cmd, updates: cmd.updates.map((u) => emojifyFields(u, table)) };
    case 'add_edges': return { ...cmd, edges: cmd.edges.map((e) => emojifyFields(e, table)) };
    case 'update_edges': return { ...cmd, updates: cmd.updates.map((u) => emojifyFields(u, table)) };
    case 'replace_content': return { ...cmd, nodes: cmd.nodes.map((n) => emojifyFields(n, table)), edges: cmd.edges.map((e) => emojifyFields(e, table)) };
    case 'update_document': return { ...cmd, ...(cmd.title !== undefined ? { title: emojify(cmd.title, table) } : {}), ...(cmd.description !== undefined ? { description: emojify(cmd.description, table) } : {}) };
    case 'batch': return { ...cmd, commands: cmd.commands.map((c) => emojifyCommand(c, table)) };
    default: return cmd;
  }
}

