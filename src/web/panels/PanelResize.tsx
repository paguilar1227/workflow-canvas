import { useCallback, useLayoutEffect, useState } from 'react';

/** Retain the existing usable panel width; extra width comes from free canvas space. */
export function usePanelWidth(side: 'left' | 'right', initial: number) {
  const key = 'wfc-panel-width-' + side;
  const [width, setWidth] = useState(() => Math.max(initial, Number(localStorage.getItem(key)) || initial));
  const max = useCallback(() => {
    const main = document.querySelector('.main');
    const other = document.querySelector('.column-slot.' + (side === 'left' ? 'right' : 'left'));
    const toolbar = document.querySelector('.toolbar');
    return Math.max(initial, (main?.clientWidth ?? window.innerWidth) - (other?.clientWidth ?? 0) - (toolbar?.scrollWidth ?? 0) - 16);
  }, [initial, side]);
  const apply = (value: number) => {
    const next = Math.round(Math.max(initial, Math.min(max(), value)));
    setWidth(next);
    localStorage.setItem(key, String(next));
  };
  useLayoutEffect(() => {
    const fit = () => setWidth((current) => Math.min(current, max()));
    window.addEventListener('resize', fit);
    fit();
    return () => window.removeEventListener('resize', fit);
  }, [max]);
  const resize = <div className={'panel-resize ' + side} role="separator" aria-orientation="vertical"
    aria-label={'Resize ' + (side === 'left' ? 'outline' : 'inspector') + ' panel'} aria-valuemin={initial} aria-valuenow={width}
    tabIndex={0} title="Drag to resize · double-click to reset" data-testid={'resize-' + side + '-panel'}
    onDoubleClick={() => apply(initial)}
    onKeyDown={(event) => {
      if (event.key === 'Home' || event.key === 'Enter') { event.preventDefault(); apply(initial); }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault(); event.stopPropagation();
      // One keyboard step matches a standard toolbar button's width.
      const step = document.querySelector('.toolbar .btn')?.getBoundingClientRect().width ?? 30;
      apply(width + (event.key === (side === 'left' ? 'ArrowRight' : 'ArrowLeft') ? step : -step));
    }}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      const start = event.clientX, before = width, el = event.currentTarget;
      const move = (e: PointerEvent) => apply(before + (e.clientX - start) * (side === 'left' ? 1 : -1));
      const end = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    }} />;
  return { width, resize };
}
