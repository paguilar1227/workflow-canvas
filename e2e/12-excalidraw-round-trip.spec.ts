import fs from 'node:fs';
import { test, expect, type WDoc, type WNode } from './support/journey';

test('export to Excalidraw and import it back', async ({ page, app, ev }) => {
  ev.proves('A user exports a diagram (a lane frame with a subtitle, rounded/diamond/circle/cylinder topics with colours, a mind-map child, a sticky note, a labelled dashed connector and a pen drawing) with Export › Excalidraw (.excalidraw); the file is a valid Excalidraw scene; the user then loads that file into a new canvas with Import › Load file…, the dialog switches itself to the excalidraw format, and the re-imported canvas shows the same topics, frame title and subtitle, shapes, colours, child branch, sticky, connector label/style and drawing, laid out the same way.');
  const docId = await app.newDoc('Checkout flow');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: 'co-lane', kind: 'frame', title: 'Payments lane', subtitle: 'Owned by the payments team', x: -40, y: -60, width: 900, height: 340 },
    { id: 'co-cart', title: 'Cart', color: 'blue', x: 0, y: 0, frameId: 'co-lane' },
    { id: 'co-pay', title: 'Card valid?', shape: 'diamond', color: 'amber', x: 300, y: -10, frameId: 'co-lane' },
    { id: 'co-done', title: 'Paid', shape: 'circle', color: 'green', x: 600, y: 0, frameId: 'co-lane' },
    { id: 'co-ledger', title: 'Ledger', shape: 'cylinder', x: 600, y: 160, frameId: 'co-lane' },
    { id: 'co-note', kind: 'sticky', title: 'Ask legal about refunds', x: 0, y: 380 },
    { id: 'co-risks', title: 'Risks', x: 1000, y: 0 },
    { id: 'co-fraud', title: 'Fraud spikes', parentId: 'co-risks' },
    { id: 'co-ink', kind: 'drawing', points: [[300, 420], [340, 400], [380, 430], [420, 405], [460, 425]] },
  ] });
  await app.tool('add_edges', { documentId: docId, edges: [
    { id: 'co-e1', source: 'co-cart', target: 'co-pay', label: 'checkout' },
    { id: 'co-e2', source: 'co-pay', target: 'co-done', label: 'yes' },
    { id: 'co-e3', source: 'co-pay', target: 'co-cart', label: 'retry', style: 'dashed' },
    { id: 'co-e4', source: 'co-done', target: 'co-ledger' },
  ] });
  await app.open(docId);
  await app.fit();
  const original = await app.doc();
  await ev.snap('original-diagram');

  /** Each connector label is on screen and not hidden under another element (e.g. a reverse connector's label). */
  const labelsReadable = async (labels: string[]) => {
    for (const l of labels) {
      const el = page.locator('[data-testid^="edge-label-"]', { hasText: l });
      await expect(el).toBeVisible();
      const uncovered = await el.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!hit && node.contains(hit);
      });
      expect.soft(uncovered, 'the "' + l + '" connector label can be read (nothing is drawn over it)').toBe(true);
    }
  };

  await test.step('both connectors between Cart and Card valid? can be read', async () => {
    const at = await app.center(page.locator('[data-testid^="edge-label-"]', { hasText: 'retry' }));
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down('ControlOrMeta');
    for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); }
    await page.keyboard.up('ControlOrMeta');
    await page.waitForTimeout(400);
    await ev.snap('cart-and-card-check-connectors');
    await labelsReadable(['checkout', 'retry', 'yes']);
    await app.fit();
  });

  let file = '';
  await test.step('export the diagram as an Excalidraw file', async () => {
    await page.getByTestId('menu-export').click();
    await expect(page.getByTestId('export-excalidraw')).toContainText('Excalidraw (.excalidraw)');
    await ev.snap('export-menu');
    const dl = page.waitForEvent('download');
    await page.getByTestId('export-excalidraw').click();
    file = await ev.keep(await dl);
    expect(file.split('/').pop()).toBe('checkout-flow.excalidraw');
  });

  await test.step('the file is an Excalidraw scene of the diagram', async () => {
    const scene = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(scene).toMatchObject({ type: 'excalidraw', version: 2 });
    const els = scene.elements as { id: string; type: string; text?: string; name?: string; strokeStyle?: string; points?: unknown[] }[];
    const ids = els.map((e) => e.id);
    expect(new Set(ids).size, 'element ids are unique').toBe(ids.length);
    const texts = els.filter((e) => e.type === 'text').map((e) => e.text);
    for (const t of ['Cart', 'Card valid?', 'Paid', 'Ledger', 'Ask legal about refunds', 'Risks', 'Fraud spikes', 'checkout', 'yes', 'retry']) {
      expect(texts.some((x) => x?.split('\n')[0] === t), 'the scene has the text "' + t + '"').toBe(true);
    }
    expect(els.find((e) => e.type === 'frame')?.name).toBe('Payments lane');
    expect(els.filter((e) => e.type === 'diamond')).toHaveLength(1);
    expect(els.filter((e) => e.type === 'ellipse')).toHaveLength(1);
    expect(els.filter((e) => e.type === 'freedraw')).toHaveLength(1);
    expect(els.filter((e) => e.type === 'arrow' && e.strokeStyle === 'dashed'), 'the retry link is a dashed arrow').toHaveLength(1);
    expect(els.filter((e) => e.type === 'arrow').length, 'an arrow per connector plus the branch line').toBe(original.edges.length + 1);
  });

  const copyId = await app.newDoc('Checkout flow (from Excalidraw)');
  await test.step('load the file into a new canvas', async () => {
    await app.open(copyId);
    await page.getByTestId('open-import').click();
    await expect(page.getByTestId('import-modal')).toBeVisible();
    await expect(page.getByTestId('import-format-mermaid'), 'the dialog opens on another format').toHaveClass(/on/);
    await page.getByTestId('import-file').setInputFiles(file);
    await expect(page.getByTestId('import-format-excalidraw'), 'loading a .excalidraw file switches the format').toHaveClass(/on/);
    await expect(page.getByTestId('import-text')).toHaveValue(/"type": "excalidraw"/);
    await ev.snap('import-dialog-with-file');
    await page.getByTestId('import-submit').click();
    await expect(page.getByTestId('import-modal')).toHaveCount(0);
    await app.settled();
    await page.waitForTimeout(600);
    await app.fit();
    await ev.snap('re-imported-diagram');
  });

  await test.step('the re-imported canvas matches the original', async () => {
    const copy = await app.doc();
    const key = (n: WNode) => n.kind + ':' + (n.kind === 'drawing' ? 'ink' : n.title);
    const index = (d: WDoc) => new Map(d.nodes.map((n) => [key(n), n]));
    const [a, b] = [index(original), index(copy)];
    expect([...b.keys()].sort(), 'the same objects come back').toEqual([...a.keys()].sort());
    const frameA = a.get('frame:Payments lane')!, frameB = b.get('frame:Payments lane')!;
    expect(frameB.subtitle, 'the frame keeps its subtitle').toBe('Owned by the payments team');
    await expect(app.frame(frameB.id)).toContainText('Payments lane');
    await expect(app.frame(frameB.id)).toContainText('Owned by the payments team');
    for (const [k, n] of a) {
      const m = b.get(k)!;
      if (n.kind !== 'drawing') {
        expect.soft(m.shape ?? null, k + ' keeps its shape').toBe(n.shape ?? null);
        expect.soft(m.color ?? null, k + ' keeps its colour').toBe(n.color ?? null);
      }
      expect.soft(m.frameId ? 'in-lane' : 'free', k + ' keeps its lane membership').toBe(n.frameId ? 'in-lane' : 'free');
      expect.soft({ dx: m.x - frameB.x, dy: m.y - frameB.y }, k + ' keeps its place in the layout').toEqual({ dx: n.x - frameA.x, dy: n.y - frameA.y });
    }
    expect(b.get('topic:Fraud spikes')!.parentId, 'the mind-map child is still a branch of Risks').toBe(b.get('topic:Risks')!.id);
    expect(b.get('drawing:ink')!.points, 'the pen stroke keeps its shape').toEqual(a.get('drawing:ink')!.points);
    const title = (d: WDoc, id: string) => d.nodes.find((n) => n.id === id)!.title;
    const edgeKey = (d: WDoc) => d.edges.map((e) => title(d, e.source) + '->' + title(d, e.target) + ' [' + (e.label ?? '') + '] ' + e.style + ' ' + e.arrow).sort();
    expect(edgeKey(copy), 'the same connectors with their labels, style and arrows').toEqual(edgeKey(original));
    for (const t of ['Cart', 'Card valid?', 'Paid', 'Ledger', 'Risks', 'Fraud spikes']) await expect(app.topic(t)).toBeVisible();
    await expect(page.locator('.wfc-sticky')).toContainText('Ask legal about refunds');
    await labelsReadable(['checkout', 'yes', 'retry']);
    await expect(app.node(b.get('drawing:ink')!.id).locator('path.wfc-stroke')).toBeVisible();
    await expect(page.locator('.wfc-branch'), 'the branch line from Risks to Fraud spikes is drawn').toHaveCount(1);
  });
});
