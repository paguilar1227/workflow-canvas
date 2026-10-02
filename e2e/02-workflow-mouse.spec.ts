import { test, expect, type App, type Evidence } from './support/journey';

async function connectByHandle(app: App, ev: Evidence, from: string, fromSide: string, to: string, toSide: string, shot?: string) {
  const src = await app.nodeNamed(from);
  const dst = await app.nodeNamed(to);
  await app.topic(from).hover();
  const a = await app.center(app.rfNode(src.id).locator('.react-flow__handle[data-handlepos="' + fromSide + '"]'));
  const b = await app.center(app.rfNode(dst.id).locator('.react-flow__handle[data-handlepos="' + toSide + '"]'));
  await app.drag(a, b, {
    steps: 24,
    beforeRelease: async () => {
      await expect(app.page.locator('.react-flow__connection-path'), 'a live connector follows the pointer').toBeVisible();
      if (shot) await ev.snap(shot);
    },
  });
  await expect.poll(async () => (await app.doc()).edges.filter((e) => e.source === src.id && e.target === dst.id).length).toBe(1);
  const edge = (await app.doc()).edges.find((e) => e.source === src.id && e.target === dst.id)!;
  await expect(app.edge(edge.id)).toBeVisible();
  return edge.id;
}

test('sketch a workflow with the mouse', async ({ page, app, ev }) => {
  ev.proves('A mouse user adds topics from the toolbar and by double-clicking empty canvas, drags a topic to a new spot, draws connectors by dragging from a node handle to another node, labels connectors by double-clicking the line and via the inspector, and restyles a connector (bezier routing, dashed, arrows at both ends, animated flow) with visible results.');
  const docId = await app.newDoc('Order workflow');
  await app.open(docId);
  const pane = await app.paneBox();

  await test.step('add topics with the toolbar and by double-clicking the canvas', async () => {
    await page.getByTestId('add-topic').click();
    await app.type('Receive order');
    await page.mouse.dblclick(pane.x + pane.width * 0.8, pane.y + pane.height * 0.28);
    await app.type('Check stock');
    await page.mouse.dblclick(pane.x + pane.width * 0.22, pane.y + pane.height * 0.75);
    await app.type('Ship it');
    for (const t of ['Receive order', 'Check stock', 'Ship it']) await expect(app.topic(t)).toBeVisible();
    await ev.snap('three-topics-added');
  });

  await test.step('drag a topic to a new place', async () => {
    const before = await app.nodeNamed('Ship it');
    const boxBefore = await app.box(app.topic('Ship it'));
    const check = await app.box(app.topic('Check stock'));
    const from = await app.center(app.topic('Ship it'));
    const to = { x: check.x + check.width / 2, y: pane.y + pane.height * 0.72 };
    await app.drag(from, to);
    const after = await app.nodeNamed('Ship it');
    const boxAfter = await app.box(app.topic('Ship it'));
    expect(boxAfter.x - boxBefore.x, 'the topic moved on screen with the pointer').toBeGreaterThan((to.x - from.x) * 0.9);
    expect(after.x - before.x, 'the new position was saved').toBeGreaterThan(100);
    await ev.snap('topic-dragged');
  });

  let first = '';
  let second = '';
  await test.step('connect topics by dragging from a handle', async () => {
    first = await connectByHandle(app, ev, 'Receive order', 'right', 'Check stock', 'left', 'connector-being-dragged');
    second = await connectByHandle(app, ev, 'Check stock', 'bottom', 'Ship it', 'top');
    await ev.snap('two-connectors');
  });

  await test.step('label a connector by double-clicking it', async () => {
    const mid = await app.edgeMidpoint(first);
    await page.mouse.dblclick(mid.x, mid.y);
    await app.type('new order');
    await expect(page.getByTestId('edge-label-' + first)).toHaveText('new order');
    await ev.snap('connector-labelled-inline');
  });

  await test.step('label and restyle a connector in the inspector', async () => {
    const mid = await app.edgeMidpoint(second);
    await page.mouse.click(mid.x, mid.y);
    await expect(page.getByTestId('inspector-edge')).toBeVisible();
    await page.getByTestId('insp-edge-label').fill('in stock');
    await page.getByTestId('insp-edge-label').press('Enter');
    await expect(page.getByTestId('edge-label-' + second)).toHaveText('in stock');

    const path = app.edgePath(second);
    const smooth = await path.getAttribute('d');
    await page.getByTestId('routing-bezier').click();
    await expect.poll(() => path.getAttribute('d'), 'bezier routing redraws the line as a curve').toMatch(/C/);
    expect(await path.getAttribute('d')).not.toBe(smooth);
    await page.getByTestId('edgestyle-dashed').click();
    await expect(path).toHaveClass(/dashed/);
    await page.getByTestId('arrow-both').click();
    await expect(path).toHaveAttribute('marker-start', /wfc-arrow/);
    await expect(path).toHaveAttribute('marker-end', /wfc-arrow/);
    await ev.snap('connector-bezier-dashed-both-arrows');
    await page.getByTestId('edge-animated').click();
    await expect(path).toHaveClass(/animated/);
    await expect(page.getByTestId('edge-animated')).toHaveClass(/on/);
    const e = (await app.doc()).edges.find((x) => x.id === second)!;
    expect(e).toMatchObject({ label: 'in stock', routing: 'bezier', style: 'dashed', arrow: 'both', animated: true });
    await page.keyboard.press('Escape');
    await ev.snap('connector-animated');
  });
});

