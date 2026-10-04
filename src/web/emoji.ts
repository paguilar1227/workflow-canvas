import { useEffect, useState } from 'react';
import { buildShortcodeTable, type ShortcodeTable } from '../shared/emoji';

export interface EmojiEntry { emoji: string; label: string; codes: string[]; tags: string[]; group: number; order: number }
export interface EmojiGroup { id: number; label: string; icon: string }
export interface EmojiData { entries: EmojiEntry[]; groups: EmojiGroup[]; table: ShortcodeTable }

type Compact = { hexcode: string; label: string; unicode: string; group?: number; order?: number; tags?: string[]; skins?: { hexcode: string; unicode: string }[] };
type Messages = { groups: { key: string; message: string; order: number }[] };

/** Unicode's "component" group holds skin-tone and hair swatches, which are not emoji on their own. */
const COMPONENT_GROUP = 'component';

let loaded: EmojiData | null = null;
let loading: Promise<EmojiData> | null = null;

/** The emoji tables are a separate chunk, fetched the first time a text field is focused. */
export function loadEmojiData(): Promise<EmojiData> {
  loading ??= Promise.all([
    import('emojibase-data/en/compact.json'),
    import('emojibase-data/en/shortcodes/github.json'),
    import('emojibase-data/en/messages.json'),
  ]).then(([c, s, m]) => {
    const compact = (c.default ?? c) as unknown as Compact[];
    const shortcodes = (s.default ?? s) as unknown as Record<string, string | string[]>;
    const messages = (m.default ?? m) as unknown as Messages;
    const skip = messages.groups.find((g) => g.key === COMPONENT_GROUP)?.order;
    const entries: EmojiEntry[] = compact
      .filter((e) => e.group !== undefined && e.group !== skip)
      .map((e) => {
        const codes = shortcodes[e.hexcode];
        return { emoji: e.unicode, label: e.label, codes: codes === undefined ? [] : Array.isArray(codes) ? codes : [codes], tags: e.tags ?? [], group: e.group!, order: e.order ?? 0 };
      })
      .sort((a, b) => a.order - b.order);
    const groups = messages.groups
      .filter((g) => g.order !== skip)
      .map((g) => ({ id: g.order, label: g.message.charAt(0).toUpperCase() + g.message.slice(1), icon: entries.find((e) => e.group === g.order)?.emoji ?? '' }))
      .filter((g) => g.icon);
    loaded = { entries, groups, table: buildShortcodeTable(compact, shortcodes) };
    return loaded;
  });
  return loading;
}

export function useEmojiData(wanted: boolean): EmojiData | null {
  const [data, setData] = useState(loaded);
  useEffect(() => { if (!data && wanted) void loadEmojiData().then(setData); }, [data, wanted]);
  return data;
}

/** Shortcode matches first (exact, prefix, anywhere), then names and keywords, each in Unicode order. */
export function searchEmoji(data: EmojiData, query: string): EmojiEntry[] {
  const q = query.toLowerCase().trim().replace(/^:+|:+$/g, '');
  if (!q) return [];
  const ranked: [number, EmojiEntry][] = [];
  for (const e of data.entries) {
    const rank = e.codes.includes(q) ? 0
      : e.codes.some((c) => c.startsWith(q)) ? 1
      : e.codes.some((c) => c.includes(q)) ? 2
      : e.label.toLowerCase().includes(q) ? 3
      : e.tags.some((t) => t.startsWith(q)) ? 4 : -1;
    if (rank >= 0) ranked.push([rank, e]);
  }
  return ranked.sort((a, b) => a[0] - b[0] || a[1].order - b[1].order).map(([, e]) => e);
}

const RECENT_KEY = 'wfc-emoji-recent';

export function recentEmoji(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }
  catch { return []; }
}

/** Keeps as many as fit in one row of the picker grid. */
export function rememberEmoji(emoji: string, keep: number) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...recentEmoji().filter((e) => e !== emoji)].slice(0, keep))); }
  catch { /* storage unavailable: recents are a convenience only */ }
}
