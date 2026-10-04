import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import MarkdownIt from 'markdown-it';
import { useApp } from './store';

/**
 * GitHub-flavoured Markdown for text on the canvas: raw HTML is off (so typed or AI-written HTML stays text),
 * markdown-it's link validator drops javascript:/vbscript:/file: URLs, and newlines are line breaks like GitHub comments.
 */
const md = new MarkdownIt('default', { html: false, linkify: true, breaks: true });

const renderToken = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const t = tokens[idx];
  t.attrSet('target', '_blank');
  t.attrSet('rel', 'noopener noreferrer');
  t.attrJoin('class', 'nodrag');
  return renderToken(tokens, idx, options, env, self);
};

/** Chromium's multi-click interval: a second tap sooner than this after selecting is a double-tap (edit), not a tick. */
const DOUBLE_TAP_MS = 500;

const TASK = /^\[([ xX])\](?=\s|$)\s?/;

/** GFM task lists: "- [ ] item" becomes a checkbox that remembers which source line it came from. */
md.core.ruler.push('wfc_task_lists', (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    const item = tokens[i - 2];
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || item.type !== 'list_item_open') continue;
    const first = inline.children?.[0];
    const m = first?.type === 'text' ? TASK.exec(first.content) : null;
    if (!first || !m) continue;
    first.content = first.content.slice(m[0].length);
    const box = new state.Token('html_inline', '', 0);
    const line = item.map?.[0] ?? -1;
    box.content = '<input type="checkbox" class="md-task nodrag" data-line="' + line + '"' + (m[1] === ' ' ? '' : ' checked') + (state.env?.readOnly ? ' disabled' : '') + ' aria-label="Task">';
    inline.children!.unshift(box);
    item.attrJoin('class', 'task-list-item');
  }
});

/** Flip the "[ ]" / "[x]" on one source line. */
export function toggleTask(source: string, line: number): string {
  const lines = source.split('\n');
  if (line < 0 || line >= lines.length) return source;
  lines[line] = lines[line].replace(/\[([ xX])\]/, (_m, c: string) => (c === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
}

/** One line for compact places (outline rows): the first non-empty line without its block markers. */
export function firstLine(source: string): string {
  const line = source.split('\n').find((l) => l.trim()) ?? '';
  return line.trim().replace(/^(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+(\[[ xX]\]\s+)?)/, '');
}

function onLinkClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('a')) e.stopPropagation();
}

/**
 * On touch screens, once the note is selected, the whole task row is the tap target (the checkbox alone shrinks with
 * the canvas zoom); the first tap still selects the note, and a quick second tap is still a double-tap to edit.
 */
export function Markdown({ source, className, onToggleTask, rowTaps }: { source: string; className?: string; onToggleTask?: (line: number) => void; rowTaps?: boolean }) {
  const viewMode = useApp((s) => s.session.viewMode);
  const touch = useApp((s) => s.coarse);
  const readOnly = viewMode || !onToggleTask;
  const html = useMemo(() => md.render(source, { readOnly }), [source, readOnly]);
  const selectedAt = useRef(0);
  useEffect(() => { selectedAt.current = rowTaps ? performance.now() : 0; }, [rowTaps]);
  return (
    <div
      className={'md' + (className ? ' ' + className : '')}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        const box = t instanceof HTMLInputElement && t.classList.contains('md-task') ? t
          : touch && rowTaps && e.detail <= 1 && performance.now() - selectedAt.current >= DOUBLE_TAP_MS && !readOnly && !t.closest('a') ? t.closest('li.task-list-item')?.querySelector<HTMLInputElement>(':scope > .md-task, :scope > p > .md-task') : null;
        if (box) {
          e.preventDefault();
          e.stopPropagation();
          if (!readOnly) onToggleTask?.(Number(box.dataset.line));
          return;
        }
        onLinkClick(e);
      }}
      onDoubleClick={(e) => { if ((e.target as HTMLElement).closest('a, .md-task')) e.stopPropagation(); }}
    />
  );
}

export function InlineMarkdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => md.renderInline(source), [source]);
  return <span className={'md-inline' + (className ? ' ' + className : '')} dangerouslySetInnerHTML={{ __html: html }} onClick={onLinkClick} />;
}
