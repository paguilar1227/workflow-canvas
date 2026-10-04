import { expect, type Page } from '@playwright/test';
import type { App } from './journey';

/** Product contract (LeftPanel useDocsHeight): the chosen height is remembered per device under this key. */
export const DOCS_HEIGHT_KEY = 'wfc-docs-height';
/** Product contract (styles.css .doc-list max-height): the list's size until a person resizes it. */
export const DEFAULT_DOCS_HEIGHT = 210;

/** What a person sees of the Documents list and the Outline under it, measured from the live page. */
export async function docsLayout(page: Page) {
  return page.evaluate((key) => {
    const list = document.querySelector('[data-testid=doc-list]') as HTMLElement;
    const outline = document.querySelector('[data-testid=outline]') as HTMLElement;
    const panel = document.querySelector('[data-testid=left-panel]') as HTMLElement;
    const or = outline.getBoundingClientRect(), pr = panel.getBoundingClientRect(), lr = list.getBoundingClientRect();
    const shown = (e: Element | null | undefined, box: DOMRect) => {
      if (!e) return false;
      const r = e.getBoundingClientRect();
      return r.height > 0 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5 && r.top >= pr.top - 0.5 && r.bottom <= pr.bottom + 0.5 && r.bottom <= innerHeight + 0.5;
    };
    const last = list.lastElementChild as HTMLElement;
    const rows = outline.querySelectorAll('.outline-row');
    return {
      h: lr.height,
      row: (list.querySelector('.doc-item') as HTMLElement).offsetHeight,
      content: last.offsetTop + last.offsetHeight,
      docs: list.querySelectorAll('.doc-item').length,
      scrollable: list.scrollHeight > list.clientHeight + 1,
      panel: pr.height,
      titleShown: shown(outline.querySelector('.panel-title'), or),
      firstRowShown: shown(rows[0], or),
      secondRowShown: rows.length > 1 ? shown(rows[1], or) : null,
      firstDocShown: shown(list.querySelector('.doc-item'), lr),
      stored: localStorage.getItem(key),
      scroll: [document.scrollingElement?.scrollTop ?? 0, scrollY, panel.scrollTop, list.scrollTop],
    };
  }, DOCS_HEIGHT_KEY);
}

/** A document with a three-row outline, so the outline's "title and one row" bound is visible. */
export async function outlineDoc(app: App, title: string) {
  const docId = await app.newDoc(title);
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: 'dl-a', kind: 'topic', title: 'Collect feedback', x: 0, y: 0 },
    { id: 'dl-b', kind: 'topic', title: 'Sort themes', x: 0, y: 160 },
    { id: 'dl-c', kind: 'topic', title: 'Share summary', x: 0, y: 320 },
  ] });
  return docId;
}

/** Given more documents than the panel can show, the outline (not the list's content) limits how tall the list can get. */
export async function moreDocsThanFit(app: App, page: Page) {
  const l = await docsLayout(page);
  const need = Math.max(0, Math.ceil((l.panel - l.content) / l.row) + 3);
  for (let i = 1; i <= need; i++) await app.tool('create_document', { title: 'Reading list ' + String(i).padStart(2, '0'), open: false });
  await expect(page.locator('[data-testid=doc-list] .doc-item'), 'new documents appear in the list').toHaveCount(l.docs + need);
  await page.waitForTimeout(200);
  return need;
}

/** Contract checks for the largest size the list can take while the outline keeps its title and first row. */
export async function expectOutlineBound(page: Page, where: string) {
  const l = await docsLayout(page);
  expect(l.titleShown, where + ': the outline title stays visible').toBe(true);
  expect(l.firstRowShown, where + ': the first outline row stays visible').toBe(true);
  return l;
}

export const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

/** What a screen reader hears from the splitter: aria-valuemin, aria-valuemax and aria-valuenow. */
export async function splitterValues(page: Page) {
  return page.getByTestId('docs-splitter').evaluate((e) => {
    const num = (name: string) => (e.hasAttribute(name) ? Number(e.getAttribute(name)) : null);
    return { min: num('aria-valuemin'), max: num('aria-valuemax'), now: num('aria-valuenow') };
  });
}

/** The splitter's screen-reader values match the list's height and reachable bounds as laid out now. */
export async function expectSplitterValues(page: Page, where: string, want: { now: number; min?: number; max?: number }) {
  const fits = (have: number | null, w?: number) => w === undefined || (have !== null && near(have, w));
  await expect.poll(async () => {
    const v = await splitterValues(page);
    return fits(v.now, want.now) && fits(v.min, want.min) && fits(v.max, want.max) ? 'match' : JSON.stringify(v);
  }, { message: where + ': aria-valuemin/max/now match ' + JSON.stringify(want) }).toBe('match');
}
