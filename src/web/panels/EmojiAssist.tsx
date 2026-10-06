import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Smile, X } from 'lucide-react';
import { useApp } from '../store';
import { recentEmoji, rememberEmoji, searchEmoji, useEmojiData, type EmojiData, type EmojiEntry } from '../emoji';

type Field = HTMLInputElement | HTMLTextAreaElement;
type Token = { start: number; end: number; query: string };

/** Picker grid columns; "Recently used" keeps one row of them. */
const COLUMNS = 8;
/** Slack opens shortcode suggestions after a colon plus two characters. */
const MIN_QUERY = 2;
/** Apple HIG minimum touch target. */
const TOUCH_TARGET = 44;
const MOUSE_TARGET = 22;

const OPEN_TOKEN = new RegExp('(?:^|[\\s(\\[{>*_~"\'])(:([a-z0-9_+-]{' + MIN_QUERY + ',}))$', 'i');
const CLOSED_TOKEN = /:([a-z0-9_+-]+):$/i;

let pickerOpen = false;

/** Inline editors keep editing (instead of committing on blur) while focus is in the emoji UI or the picker is open. */
export function emojiUiOwns(next: EventTarget | null): boolean {
  return pickerOpen || (next instanceof Element && !!next.closest('.emoji-ui'));
}

function eligible(el: EventTarget | null): el is Field {
  if (!(el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === 'text'))) return false;
  return !el.readOnly && !el.disabled && !el.closest('[data-no-emoji], .emoji-ui');
}

/** Markdown code keeps its colons: inside a fenced block, or after an odd number of backticks on the line. */
function inCode(before: string): boolean {
  if ((before.match(/^\s*\x60{3}/gm) ?? []).length % 2) return true;
  return ((before.slice(before.lastIndexOf('\n') + 1)).match(/\x60/g) ?? []).length % 2 === 1;
}

function openToken(f: Field): Token | null {
  const end = f.selectionStart;
  if (end === null || end !== f.selectionEnd) return null;
  const before = f.value.slice(0, end);
  const m = OPEN_TOKEN.exec(before);
  if (!m || inCode(before)) return null;
  return { start: end - m[1].length, end, query: m[2] };
}

/** The picker only ever inserts (at the end of any selection); suggestions replace the typed :name. */
/** Replace a range the way typing would, so React sees the change and the browser's undo stack keeps it. */
function insert(f: Field, start: number, end: number, text: string) {
  f.focus({ preventScroll: true });
  f.setSelectionRange(start, end);
  if (!document.execCommand('insertText', false, text)) {
    f.setRangeText(text, start, end, 'end');
    f.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function visibleBottom() {
  const vv = window.visualViewport;
  return vv ? vv.offsetTop + vv.height : window.innerHeight;
}

/** Below the anchor when it fits (or fits better), otherwise above it, growing upward. */
function floatStyle(r: DOMRect, width: number, height: number): CSSProperties {
  const bottom = visibleBottom();
  const left = Math.max(4, Math.min(r.left, window.innerWidth - width - 4));
  const room = bottom - r.bottom - 8;
  if (room >= height || room >= r.top) return { left, top: r.bottom + 4, maxHeight: Math.min(height, room) };
  return { left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(height, r.top - 8) };
}

function dockStyle(r: DOMRect, size: number): CSSProperties {
  const top = r.top - size - 2 >= 0 ? r.top - size - 2 : r.bottom + 2;
  const left = Math.max(0, Math.min(r.right - size, window.innerWidth - size));
  return { top, left, width: size, height: size };
}

const keep = (e: { preventDefault(): void }) => e.preventDefault();

function Grid({ items, onPick }: { items: EmojiEntry[]; onPick: (e: EmojiEntry) => void }) {
  return (
    <div className="emoji-grid" style={{ gridTemplateColumns: 'repeat(' + COLUMNS + ', 1fr)' }}>
      {items.map((e) => (
        <button key={e.emoji} className="emoji-cell" title={e.label + (e.codes[0] ? '  :' + e.codes[0] + ':' : '')} aria-label={e.label} data-emoji={e.emoji} onClick={() => onPick(e)}>{e.emoji}</button>
      ))}
    </div>
  );
}

function Picker({ data, sheet, style, onPick, onClose }: { data: EmojiData | null; sheet: boolean; style?: CSSProperties; onPick: (e: EmojiEntry) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => (data && q.trim() ? searchEmoji(data, q) : null), [data, q]);
  const groups = useMemo(() => (data ? data.groups.map((g) => ({ ...g, items: data.entries.filter((e) => e.group === g.id) })) : []), [data]);
  const recents = useMemo(() => {
    if (!data) return [];
    const byEmoji = new Map(data.entries.map((e) => [e.emoji, e]));
    return recentEmoji().map((e) => byEmoji.get(e)).filter((e): e is EmojiEntry => !!e);
  }, [data]);
  const gridRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div className="emoji-backdrop" data-testid="emoji-backdrop" onMouseDown={keep} onClick={onClose} />
      <div className={'emoji-picker' + (sheet ? ' sheet' : '')} style={style} role="dialog" aria-label="Emoji picker" data-testid="emoji-picker"
        onMouseDown={(e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }}>
        <div className="emoji-picker-head">
          <input data-no-emoji autoFocus={!sheet} placeholder="Search emoji" aria-label="Search emoji" data-testid="emoji-search" value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (results?.[0]) onPick(results[0]); } }} />
          <button className="emoji-close" aria-label="Close emoji picker" title="Close" onClick={onClose}><X size={16} /></button>
        </div>
        {data && !results ? (
          <div className="emoji-tabs" role="toolbar" aria-label="Emoji categories">
            {groups.map((g) => (
              <button key={g.id} title={g.label} aria-label={g.label} onClick={() => gridRef.current?.querySelector('[data-group="' + g.id + '"]')?.scrollIntoView({ block: 'start' })}>{g.icon}</button>
            ))}
          </div>
        ) : null}
        <div className="emoji-grid-wrap" ref={gridRef} data-testid="emoji-grid">
          {!data ? <div className="emoji-empty">Loading emoji…</div>
            : results ? (results.length ? <Grid items={results} onPick={onPick} /> : <div className="emoji-empty">No emoji match “{q}”</div>)
            : (
              <>
                {recents.length ? <section data-group="recent"><h4>Recently used</h4><Grid items={recents} onPick={onPick} /></section> : null}
                {groups.map((g) => <section key={g.id} data-group={g.id}><h4>{g.label}</h4><Grid items={g.items} onPick={onPick} /></section>)}
              </>
            )}
        </div>
      </div>
    </>
  );
}

/**
 * Emoji for every text field: ":name:" turns into the emoji as you type, ":na" offers matches (arrows + Enter/Tab),
 * and a small button docked above the focused field opens a searchable picker. Fields opt out with data-no-emoji.
 */
export function EmojiAssist() {
  const touch = useApp((s) => s.coarse || s.compact);
  const coarse = useApp((s) => s.coarse);
  const [field, setField] = useState<Field | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [token, setToken] = useState<Token | null>(null);
  const [active, setActive] = useState(0);
  const [picker, setPicker] = useState<{ field: Field; start: number; end: number } | null>(null);
  const data = useEmojiData(!!field || !!picker);
  const items = useMemo(() => (data && token ? searchEmoji(data, token.query) : []), [data, token]);
  const dismissed = useRef<{ field: Field; start: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const live = useRef({ field, token, items, active, picker, data, touch });
  live.current = { field, token, items, active, picker, data, touch };

  const refresh = (f: Field) => {
    const t = openToken(f);
    const d = dismissed.current;
    if (t && d && d.field === f && d.start === t.start) { setToken(null); return; }
    if (!t) dismissed.current = null;
    setToken((prev) => (prev && t && prev.start === t.start && prev.query === t.query ? prev : t));
  };

  const pickSuggestion = (e: EmojiEntry) => {
    const { field: f, token: t } = live.current;
    if (!f || !t) return;
    insert(f, t.start, t.end, e.emoji);
    rememberEmoji(e.emoji, COLUMNS);
    setToken(null);
  };

  const openPicker = () => {
    const f = live.current.field;
    if (!f) return;
    pickerOpen = true;
    const at = f.selectionEnd ?? f.value.length;
    setPicker({ field: f, start: at, end: at });
    setToken(null);
    if (live.current.touch) f.blur();
  };

  const closePicker = () => {
    const p = live.current.picker;
    pickerOpen = false;
    setPicker(null);
    if (p?.field.isConnected) { p.field.focus({ preventScroll: true }); p.field.setSelectionRange(p.start, p.end); }
  };

  const pickFromPicker = (e: EmojiEntry) => {
    const p = live.current.picker;
    pickerOpen = false;
    setPicker(null);
    rememberEmoji(e.emoji, COLUMNS);
    if (p?.field.isConnected) insert(p.field, p.start, p.end, e.emoji);
  };

  useEffect(() => setActive(0), [token?.query]);
  useEffect(() => { listRef.current?.querySelector('.emoji-option.active')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => { if (eligible(e.target)) { setField(e.target); refresh(e.target); } };
    const onFocusOut = (e: FocusEvent) => {
      if (emojiUiOwns(e.relatedTarget) || eligible(e.relatedTarget)) return;
      setField((f) => (f === e.target ? null : f));
      setToken(null);
    };
    const onInput = (e: Event) => {
      const f = e.target;
      if (!eligible(f)) return;
      const ie = e as InputEvent;
      const d = live.current.data;
      if (d && ie.inputType === 'insertText' && ie.data?.endsWith(':')) {
        const end = f.selectionStart ?? 0;
        const before = f.value.slice(0, end);
        const m = CLOSED_TOKEN.exec(before);
        const emoji = m && !inCode(before) ? d.table.get(m[1].toLowerCase()) : undefined;
        if (m && emoji) { setToken(null); queueMicrotask(() => insert(f, end - m[0].length, end, emoji)); return; }
      }
      refresh(f);
    };
    const onCaret = (e: Event) => { if (e.target === live.current.field && e.target instanceof HTMLElement && eligible(e.target)) refresh(e.target); };
    const stop = (e: KeyboardEvent) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const onKey = (e: KeyboardEvent) => {
      const s = live.current;
      if (s.picker) { if (e.key === 'Escape') { stop(e); closePicker(); } return; }
      if (!s.token || !s.items.length || e.target !== s.field || e.isComposing) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { stop(e); setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + s.items.length) % s.items.length); }
      else if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.metaKey && !e.ctrlKey) { stop(e); pickSuggestion(s.items[Math.min(s.active, s.items.length - 1)]); }
      else if (e.key === 'Escape') { stop(e); if (s.field) dismissed.current = { field: s.field, start: s.token.start }; setToken(null); }
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keyup', onCaret, true);
    document.addEventListener('mouseup', onCaret, true);
    window.addEventListener('keydown', onKey, true);
    const current = document.activeElement;
    if (eligible(current)) setField(current);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('keyup', onCaret, true);
      document.removeEventListener('mouseup', onCaret, true);
      window.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Follow the field while it is focused (the canvas can pan or zoom under it); drop it once it unmounts. */
  useEffect(() => {
    const f = picker?.field ?? field;
    if (!f) { setRect(null); return; }
    let raf = 0;
    let last = '';
    const tick = () => {
      if (!f.isConnected) {
        if (live.current.picker) { pickerOpen = false; setPicker(null); }
        setField(null);
        setToken(null);
        return;
      }
      const r = f.getBoundingClientRect();
      const key = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
      if (key !== last) { last = key; setRect(r); }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [field, picker]);

  if ((!field && !picker) || !rect) return null;
  return createPortal(
    <div className="emoji-ui">
      {!picker && field ? (
        <button className="emoji-dock" style={dockStyle(rect, coarse ? TOUCH_TARGET : MOUSE_TARGET)} aria-label="Insert emoji" title="Insert emoji (or type :name)" data-testid="emoji-button"
          onMouseDown={keep} onClick={openPicker}><Smile size={coarse ? 20 : 14} /></button>
      ) : null}
      {!picker && token && items.length ? (
        <div className="emoji-suggest" role="listbox" aria-label="Emoji suggestions" data-testid="emoji-suggest" ref={listRef} style={floatStyle(rect, 260, 240)} onMouseDown={keep}>
          {items.map((e, i) => (
            <button key={e.emoji} role="option" aria-selected={i === active} className={'emoji-option' + (i === active ? ' active' : '')} data-emoji={e.emoji}
              onMouseEnter={() => setActive(i)} onClick={() => pickSuggestion(e)}>
              <span className="glyph">{e.emoji}</span><span className="emoji-code">{e.codes[0] ? ':' + e.codes[0] + ':' : e.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {picker ? <Picker data={data} sheet={touch} style={touch ? undefined : floatStyle(rect, 328, 380)} onPick={pickFromPicker} onClose={closePicker} /> : null}
    </div>,
    document.body,
  );
}
