import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, CircleHelp, Database, FileText, Flag, Globe, Hourglass, Layers, Play, Split, type LucideIcon } from 'lucide-react';
import { useApp, set } from '../store';
import type { NodeRole, NodeShape, NodeStatus } from '../../shared/types';
import { ROLE_INFO } from '../../shared/logic';

export interface PickerOption<T extends string | number> { value: T; label: string; icon?: ReactNode; testId?: string; hint?: string }

/**
 * A compact property control: one button shows the current value and opens the choices in a popover
 * (a bottom sheet on phones). Arrow keys move between choices, Enter picks, Escape closes.
 */
export function Picker<T extends string | number>({ id, label, value, options, onPick, testId, grid, placeholder = 'Choose…', trigger, buttonClass }: {
  id: string; label: string; value?: T; options: PickerOption<T>[]; onPick: (v: T) => void; testId?: string; grid?: boolean; placeholder?: string;
  /** Custom button content (e.g. a toolbar menu); the picker then acts as a menu of actions. */
  trigger?: ReactNode; buttonClass?: string;
}) {
  const open = useApp((s) => s.openMenu === id);
  const sheet = useApp((s) => s.compact);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>();
  const current = options.find((o) => o.value === value);
  const close = (refocus = true) => { set({ openMenu: null }); if (refocus) btn.current?.focus({ preventScroll: true }); };

  useLayoutEffect(() => {
    if (!open) { setPos(undefined); return; }
    if (sheet || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
    const vertical: CSSProperties = below >= above ? { top: r.bottom + 4, maxHeight: below } : { bottom: window.innerHeight - r.top + 4, maxHeight: above };
    const horizontal: CSSProperties = r.left + r.width / 2 > window.innerWidth / 2 ? { right: window.innerWidth - r.right } : { left: r.left };
    setPos({ ...vertical, ...horizontal, minWidth: r.width });
  }, [open, sheet]);

  const shown = open && (sheet || !!pos);
  useEffect(() => {
    if (!shown) return;
    const focusTarget = pop.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? pop.current?.querySelector<HTMLElement>('[role="option"]');
    focusTarget?.focus({ preventScroll: true });
    focusTarget?.scrollIntoView({ block: 'nearest' });
    const onScroll = (e: Event) => { if (!pop.current?.contains(e.target as Node)) set({ openMenu: null }); };
    const onResize = () => set({ openMenu: null });
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize); };
  }, [shown]);

  const pick = (v: T) => { close(); onPick(v); };
  const onKey = (e: KeyboardEvent) => {
    const items = [...(pop.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const cols = grid ? Number(getComputedStyle(pop.current!.querySelector('.picker-options')!).gridTemplateColumns.split(' ').length) : 1;
    const go = (i: number) => { e.preventDefault(); items[Math.max(0, Math.min(items.length - 1, i))]?.focus(); };
    if (e.key === 'ArrowDown') go(at + cols);
    else if (e.key === 'ArrowUp') go(at - cols);
    else if (e.key === 'ArrowRight' && grid) go(at + 1);
    else if (e.key === 'ArrowLeft' && grid) go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') {
      // Like a native select: close and move on to the control after (or before) the picker's button.
      e.preventDefault();
      set({ openMenu: null });
      const order = [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !pop.current?.contains(el) && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0);
      const at = btn.current ? order.indexOf(btn.current) : -1;
      (order[at + (e.shiftKey ? -1 : 1)] ?? btn.current)?.focus();
    }
    e.stopPropagation();
  };

  return (
    <>
      <button ref={btn} className={(buttonClass ?? 'picker-btn') + (open ? ' open' : '')} data-testid={testId} aria-haspopup="listbox" aria-expanded={open} aria-label={trigger ? label : label + ': ' + (current?.label ?? placeholder)} title={trigger ? label : undefined}
        onClick={(e) => { e.stopPropagation(); set({ openMenu: open ? null : id }); }}
        onKeyDown={(e) => {
          // Like a native select; also keeps canvas shortcuts (Enter adds a sibling topic) from firing.
          if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); set({ openMenu: id }); }
        }}>
        {trigger ?? (
          <>
            {current?.icon ? <span className="picker-icon">{current.icon}</span> : null}
            <span className={'picker-value' + (current ? '' : ' placeholder')}>{current?.label ?? placeholder}</span>
            <ChevronDown size={14} className="picker-chevron" />
          </>
        )}
      </button>
      {shown ? createPortal(
        <>
          <div className={'picker-backdrop' + (sheet ? ' dim' : '')} data-testid="picker-backdrop" onClick={() => close()} />
          <div ref={pop} className={'picker-pop' + (sheet ? ' sheet' : '') + (grid ? ' grid' : '')} style={sheet ? undefined : pos} data-testid={testId ? testId + '-options' : undefined} onKeyDown={onKey} onClick={(e) => e.stopPropagation()}>
            {sheet ? <div className="picker-title">{label}</div> : null}
            <div className="picker-options" role="listbox" aria-label={label}>
              {options.map((o) => (
                <button key={String(o.value)} role="option" aria-selected={o.value === value} className={'picker-option' + (o.value === value ? ' on' : '')} data-testid={o.testId} title={o.hint} onClick={() => pick(o.value)}>
                  {o.icon ? <span className="picker-icon">{o.icon}</span> : null}
                  <span className="picker-label">{o.label}</span>
                  {!grid && o.value === value ? <Check size={14} className="picker-check" /> : null}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      ) : null}
    </>
  );
}

const SHAPE_PATHS: Record<NodeShape, ReactNode> = {
  card: <><rect x="2" y="5" width="20" height="14" rx="3" /><rect x="5" y="9" width="5" height="6" rx="1" /></>,
  rounded: <rect x="2" y="5" width="20" height="14" rx="4" />,
  pill: <rect x="2" y="6" width="20" height="12" rx="6" />,
  rectangle: <rect x="2" y="5" width="20" height="14" />,
  diamond: <polygon points="12,2 22,12 12,22 2,12" />,
  circle: <circle cx="12" cy="12" r="9.5" />,
  hexagon: <polygon points="6.5,3 17.5,3 22.5,12 17.5,21 6.5,21 1.5,12" />,
  cylinder: <><path d="M3,6 C3,3 21,3 21,6 L21,18 C21,21 3,21 3,18 Z" /><path d="M3,6 C3,9 21,9 21,6" /></>,
  parallelogram: <polygon points="6,5 23,5 18,19 1,19" />,
};

export function ShapeIcon({ shape, size = 18 }: { shape: NodeShape; size?: number }) {
  return <svg className="shape-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{SHAPE_PATHS[shape]}</svg>;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const shapeOptions = (shapes: readonly NodeShape[]): PickerOption<NodeShape>[] =>
  shapes.map((s) => ({ value: s, label: capital(s), icon: <ShapeIcon shape={s} size={22} />, testId: 'shape-' + s }));

/** The same glyphs and colours as the status markers on canvas nodes. */
export const STATUS_GLYPH: Record<Exclude<NodeStatus, 'none'>, string> = { todo: '○', doing: '◐', done: '✓', blocked: '!' };
const STATUS_LABEL: Record<NodeStatus, string> = { none: 'None', todo: 'To do', doing: 'Doing', done: 'Done', blocked: 'Blocked' };

export const statusOptions = (statuses: readonly NodeStatus[]): PickerOption<NodeStatus>[] =>
  statuses.map((s) => ({ value: s, label: STATUS_LABEL[s], icon: s === 'none' ? <span className="wfc-marker none">–</span> : <span className={'wfc-marker st-' + s}>{STATUS_GLYPH[s]}</span>, testId: 'status-' + s }));

const ROLE_ICONS: Record<NodeRole, LucideIcon> = { start: Play, end: Flag, decision: CircleHelp, parallel: Split, wait: Hourglass, data: FileText, store: Database, subprocess: Layers, external: Globe };

export function RoleIcon({ role, size = 12 }: { role: NodeRole; size?: number }) {
  const Icon = ROLE_ICONS[role];
  return <Icon size={size} strokeWidth={2.2} aria-hidden="true" />;
}

/** Logic roles with their icon; 'none' leaves an ordinary step. */
export const roleOptions = (roles: readonly NodeRole[], none?: string): PickerOption<NodeRole | 'none'>[] => [
  ...(none ? [{ value: 'none' as const, label: none, icon: <span className="wfc-marker none">–</span>, testId: 'role-none', hint: 'An ordinary action, or a plain topic with no special logic.' }] : []),
  ...roles.map((r) => ({ value: r, label: ROLE_INFO[r].label, icon: <span className={'wfc-marker role role-' + r}><RoleIcon role={r} /></span>, testId: 'role-' + r, hint: ROLE_INFO[r].meaning })),
];

export const priorityOptions = (levels: readonly number[]): PickerOption<number>[] =>
  levels.map((p) => ({ value: p, label: p === 0 ? 'None' : 'P' + p, icon: p === 0 ? <span className="wfc-marker none">–</span> : <span className="wfc-marker prio">{p}</span>, testId: 'priority-' + p }));
