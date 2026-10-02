import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type APIRequestContext, type Download, type Locator, type Page, type TestInfo } from '@playwright/test';
import { EVIDENCE_DIR, slugOf } from './evidence';

export { expect };

export interface WNode {
  id: string; kind: string; title: string; x: number; y: number; width: number; height: number;
  subtitle?: string; notes?: string; badge?: string; icon?: string; shape?: string; color?: string | null;
  parentId?: string | null; frameId?: string | null; collapsed?: boolean; tags?: string[]; link?: string;
  status?: string | null; priority?: number; points?: [number, number][];
}
export interface WEdge { id: string; source: string; target: string; label?: string; style: string; arrow: string; routing: string; animated?: boolean; color?: string | null }
export interface WDoc { id: string; title: string; nodes: WNode[]; edges: WEdge[]; settings: { autoArrange: boolean; treeLayout: string } }
export interface WState {
  doc: WDoc | null; docId: string | null; connected: boolean; pending: number;
  selection: { nodes: string[]; edges: string[] }; editingId: string | null; editingEdgeId: string | null;
  session: { theme: string; mode: string; panels: Record<string, boolean>; search: string; zenMode?: boolean; viewMode?: boolean };
  canUndo: boolean; canRedo: boolean; documents: { id: string; title: string; nodeCount: number }[];
}
export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
export type Template = 'blank' | 'mindmap' | 'architecture' | 'workflow';

/** Screenshots and notes for one journey, written to EVIDENCE_DIR/<test-slug>/. */
export class Evidence {
  readonly dir: string;
  private seq = 0;
  constructor(private page: Page, private info: TestInfo) { this.dir = path.join(EVIDENCE_DIR, slugOf(info.title)); }
  reset() { fs.rmSync(this.dir, { recursive: true, force: true }); fs.mkdirSync(this.dir, { recursive: true }); }
  proves(text: string) { this.info.annotations.push({ type: 'proves', description: text }); }
  note(text: string) { this.info.annotations.push({ type: 'note', description: text }); }
  async snap(label: string, opts: { page?: Page; fullPage?: boolean; exactName?: boolean; target?: Locator } = {}) {
    const name = opts.exactName ? label : String(++this.seq).padStart(2, '0') + '-' + label;
    const file = path.join(this.dir, name + '.png');
    if (opts.target) await opts.target.screenshot({ path: file });
    else await (opts.page ?? this.page).screenshot({ path: file, fullPage: opts.fullPage });
    await this.info.attach(name, { path: file, contentType: 'image/png' });
    return file;
  }
  async keep(download: Download) {
    const file = path.join(this.dir, 'downloads', download.suggestedFilename());
    await download.saveAs(file);
    return file;
  }
}

/** What a user can do and see in one browser tab, plus REST setup for the "given" part of a journey. */
export class App {
  constructor(readonly page: Page, readonly request: APIRequestContext) {}

  async tool<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await this.request.post('/api/tools/' + name, { data: args });
    const body = await res.json();
    if (!body.ok) throw new Error(name + ' failed: ' + body.error);
    return body.result.json as T;
  }

  async newDoc(title: string, template: Template = 'blank') {
    return (await this.tool<{ documentId: string }>('create_document', { title, template, open: false })).documentId;
  }

  /** Theme, panels, modes and background are server-global session settings; every journey starts from the defaults. */
  async resetSession() {
    await this.tool('set_theme', { themeId: 'lens-dark' });
    await this.tool('set_ui', { inspector: true, outline: true, minimap: true, snapToGrid: false, mode: 'select', zenMode: false, viewMode: false, background: 'theme', search: '' });
  }

  async open(docId: string) {
    await this.page.goto('/?doc=' + encodeURIComponent(docId));
    await this.waitForDoc(docId);
  }

  async waitForDoc(docId: string) {
    await this.page.waitForFunction((id) => {
      const s = (window as any).__wfc?.state();
      return !!s?.connected && s?.doc?.id === id;
    }, docId);
    await expect(this.page.locator('.react-flow__pane')).toBeVisible();
    await this.page.waitForTimeout(500);
  }

  async state(): Promise<WState> {
    return this.page.evaluate(() => {
      const s = (window as any).__wfc.state();
      return JSON.parse(JSON.stringify({
        doc: s.doc, docId: s.docId, connected: s.connected, pending: s.pending.length, selection: s.selection,
        editingId: s.editingId, editingEdgeId: s.editingEdgeId, session: s.session, canUndo: s.canUndo, canRedo: s.canRedo, documents: s.documents,
      }));
    });
  }

  async doc(): Promise<WDoc> {
    const d = (await this.state()).doc;
    expect(d, 'a document is open').toBeTruthy();
    return d!;
  }

  async nodeNamed(title: string): Promise<WNode> {
    const n = (await this.doc()).nodes.find((x) => x.title === title);
    expect(n, 'node titled "' + title + '"').toBeTruthy();
    return n!;
  }

  async selection() { return (await this.state()).selection; }

  async settled() { await this.page.waitForFunction(() => (window as any).__wfc.state().pending.length === 0); }

  topic(title: string) { return this.page.locator('.wfc-node[data-title="' + title + '"]'); }
  node(id: string) { return this.page.getByTestId('node-' + id); }
  frame(id: string) { return this.page.getByTestId('frame-' + id); }
  rfNode(id: string) { return this.page.locator('.react-flow__node[data-id="' + id + '"]'); }
  edge(id: string) { return this.page.getByTestId('rf__edge-' + id); }
  edgePath(id: string) { return this.edge(id).locator('path.wfc-edge-path'); }
  editor() { return this.page.getByLabel('Edit text'); }
  inspector() { return this.page.getByTestId('inspector'); }

  /** Type into the inline editor that is open and commit with Enter, like a user naming a topic. */
  async type(text: string) {
    const ed = this.editor();
    await expect(ed).toBeFocused();
    await this.page.keyboard.type(text, { delay: 25 });
    await this.page.keyboard.press('Enter');
    await expect(ed).toHaveCount(0);
    await this.settled();
  }

  async box(l: Locator): Promise<Box> {
    const b = await l.boundingBox();
    expect(b, 'element is rendered on screen').toBeTruthy();
    return b!;
  }

  async center(l: Locator): Promise<Pt> {
    const b = await this.box(l);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }

  /** Human-like drag: press, move in small steps with short pauses, release. */
  async drag(from: Pt, to: Pt, opts: { steps?: number; beforeRelease?: () => Promise<void> } = {}) {
    const steps = opts.steps ?? 18;
    const m = this.page.mouse;
    await m.move(from.x, from.y);
    await this.page.waitForTimeout(100);
    await m.down();
    for (let i = 1; i <= steps; i++) {
      await m.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
      await this.page.waitForTimeout(20);
    }
    await this.page.waitForTimeout(120);
    if (opts.beforeRelease) await opts.beforeRelease();
    await m.up();
    await this.page.waitForTimeout(200);
    await this.settled();
  }

  async fit() {
    await this.page.getByTestId('fit-view').click();
    await this.page.waitForTimeout(500);
  }

  async menu(menuTestId: string, itemTestId: string) {
    await this.page.getByTestId(menuTestId).click();
    await this.page.getByTestId(itemTestId).click();
  }

  async paneBox(): Promise<Box> { return this.box(this.page.locator('.react-flow__pane')); }

  /** A point on empty canvas (no node, edge or floating chrome under it), scanning from a preferred spot. */
  async emptyPoint(prefer: Pt = { x: 0.5, y: 0.5 }): Promise<Pt> {
    const p = await this.page.evaluate((prefer) => {
      const pane = document.querySelector('.react-flow__pane')!.getBoundingClientRect();
      const cands: { x: number; y: number; d: number }[] = [];
      for (let fx = 0.08; fx <= 0.92; fx += 0.04) for (let fy = 0.08; fy <= 0.85; fy += 0.04) {
        cands.push({ x: pane.left + pane.width * fx, y: pane.top + pane.height * fy, d: Math.hypot(fx - prefer.x, fy - prefer.y) });
      }
      cands.sort((a, b) => a.d - b.d);
      const clear = (x: number, y: number) => {
        for (const [dx, dy] of [[0, 0], [-14, -14], [14, 14], [-14, 14], [14, -14]]) {
          const el = document.elementFromPoint(x + dx, y + dy);
          if (!el || !el.classList.contains('react-flow__pane')) return false;
        }
        return true;
      };
      const hit = cands.find((c) => clear(c.x, c.y));
      return hit ? { x: hit.x, y: hit.y } : null;
    }, prefer);
    expect(p, 'an empty spot on the canvas').toBeTruthy();
    return p!;
  }

  async viewport() {
    const t = await this.page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);
    const m = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)\s*scale\(([-\d.e]+)\)/.exec(t);
    expect(m, 'viewport transform: ' + t).toBeTruthy();
    return { x: Number(m![1]), y: Number(m![2]), zoom: Number(m![3]) };
  }

  async zoomPct() { return parseInt((await this.page.getByTestId('zoom-pct').innerText()).replace('%', ''), 10); }

  async cssVar(name: string) {
    return this.page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  }

  async edgeMidpoint(edgeId: string): Promise<Pt> {
    return this.edgePath(edgeId).evaluate((el) => {
      const p = el as unknown as SVGPathElement;
      const pt = p.getPointAtLength(p.getTotalLength() / 2);
      const s = new DOMPoint(pt.x, pt.y).matrixTransform(p.getScreenCTM()!);
      return { x: s.x, y: s.y };
    });
  }

  /** True when the element's box lies inside the visible canvas area. */
  async inView(l: Locator) {
    const [b, pane] = [await l.boundingBox(), await this.paneBox()];
    return !!b && b.x >= pane.x - 1 && b.y >= pane.y - 1 && b.x + b.width <= pane.x + pane.width + 1 && b.y + b.height <= pane.y + pane.height + 1;
  }
}

export const test = base.extend<{ app: App; ev: Evidence }>({
  app: async ({ page, request }, use) => {
    const app = new App(page, request);
    await app.resetSession();
    await use(app);
    await app.resetSession();
  },
  ev: async ({ page }, use, info) => {
    const ev = new Evidence(page, info);
    ev.reset();
    await use(ev);
  },
});
