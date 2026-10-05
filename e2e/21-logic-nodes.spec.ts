import { test, expect, type App, type WEdge } from './support/journey';
import { DEFAULT_SESSION } from '../src/shared/types';
import { ROLES, expectLabelReadable, expectLogicMarkdown, expectMarkerOnShape, expectPortsClearOfMarker, idsByTitle, markerSpot, seedLabelIntoTop } from './support/logic';

/** Open the toolbar's Logic menu and pick a role. */
async function pickLogic(app: App, role: string) {
  await app.page.getByTestId('add-logic').click();
  await expect(app.page.getByTestId('add-logic-options'), 'the Logic button opens the role menu').toBeVisible();
  await app.page.getByTestId('role-' + role).click();
  await expect(app.page.getByTestId('add-logic-options'), 'picking a role closes the menu').toHaveCount(0);
}

/** Hover the source so its ports show, press its port on one side and drop on the target: one new connector, and the source has not moved. */
async function connectFromPort(app: App, sourceId: string, side: string, targetId: string): Promise<WEdge> {
  const d0 = await app.doc();
  const before = new Set(d0.edges.map((e) => e.id));
  const n0 = d0.nodes.find((n) => n.id === sourceId)!;
  await app.rfNode(sourceId).hover();
  const port = app.rfNode(sourceId).locator('.react-flow__handle[data-handlepos="' + side + '"]');
  await expect.poll(() => port.evaluate((el) => getComputedStyle(el).opacity), 'hovering shows the ' + side + ' port').toBe('1');
  const box0 = await app.box(app.rfNode(sourceId));
  await app.drag(await app.center(port), await app.center(app.rfNode(targetId)), { steps: 24 });
  await expect.poll(async () => (await app.doc()).edges.filter((e) => !before.has(e.id)).length, 'dragging from the ' + side + ' port adds one connector').toBe(1);
  const d1 = await app.doc();
  const edge = d1.edges.find((e) => !before.has(e.id))!;
  expect([edge.source, edge.target, edge.sourceSide], 'the connector runs from the ' + side + ' port to the drop target').toEqual([sourceId, targetId, side]);
  const n1 = d1.nodes.find((n) => n.id === sourceId)!;
  expect([n1.x, n1.y], 'dragging from the ' + side + ' port does not move the node').toEqual([n0.x, n0.y]);
  const box1 = await app.box(app.rfNode(sourceId));
  expect(Math.hypot(box1.x - box0.x, box1.y - box0.y), 'the node stays put on screen').toBeLessThan(0.5);
  await expect(app.edgePath(edge.id)).toHaveCount(1);
  expect(await app.edgePath(edge.id).evaluate((p) => (p as unknown as SVGPathElement).getTotalLength()), 'the connector is drawn').toBeGreaterThan(0);
  return edge;
}

test('build a decision flow with logic nodes and export its logic', async ({ page, app, ev }) => {
  ev.proves('A mouse user builds Start → Check payment → Paid? → (Yes) Ship order → Done, (No) Send reminder → back to Check payment: Start, the decision and End come from the toolbar Logic menu (a popover listing all nine roles; picking one arms the placement cursor "Click the canvas to place …" and a click drops it there, or it spawns 48px beside the selected topic), plain steps from Topic. Each logic node shows its role marker and shape (Start pill, decision diamond with the marker on its upper-left edge, End pill with a heavy outline). Connectors are drawn by dragging from ports; the first two out of the decision are labelled Yes and No automatically, and both labels can be read (no card drawn over them). File → Logic description (.md) downloads <doc>-logic.md with the numbered steps, the **Yes**/**No** branches, "loops back to step 2" and no issues. In Neon Flow a Yes label on a connector entering the top port of a card is drawn clear of the card (bug L1: it used to sit under it).');
  const title = 'Order flow';
  const docId = await app.newDoc(title);
  await app.open(docId);
  const pane = await app.paneBox();
  const spot = (fx: number, fy: number) => ({ x: pane.x + pane.width * fx, y: pane.y + pane.height * fy });
  const pill = page.getByTestId('place-pill');
  const deselect = async () => { await page.keyboard.press('Escape'); await expect.poll(async () => (await app.selection()).nodes).toEqual([]); };
  const placeTopic = async (name: string, at: { x: number; y: number }) => {
    await deselect();
    await page.getByTestId('add-topic').click();
    await expect(pill).toContainText('Click the canvas to place a topic');
    await page.mouse.click(at.x, at.y);
    await app.type(name);
  };

  await test.step('zoom out to make room for the flow', async () => {
    while ((await app.zoomPct()) > 62) await page.getByTestId('zoom-out').click();
    await page.waitForTimeout(300);
  });

  await test.step('the Logic menu lists every logic role', async () => {
    await page.getByTestId('add-logic').click();
    const menu = page.getByTestId('add-logic-options');
    await expect(menu).toBeVisible();
    await expect(menu, 'on desktop the Logic menu is a popover').not.toHaveClass(/sheet/);
    expect(await menu.getByRole('option').evaluateAll((os) => os.map((o) => o.getAttribute('data-testid'))), 'all nine roles, in order').toEqual(ROLES.map((r) => 'role-' + r));
    await expect(page.getByTestId('role-decision')).toContainText('Decision');
    await ev.snap('logic-menu');
  });

  await test.step('pick Start and click the canvas to place it', async () => {
    const at = spot(0.1, 0.35);
    await page.getByTestId('role-start').click();
    await expect(pill, 'picking Start arms the placement cursor').toContainText('Click the canvas to place a start point');
    await expect(page.getByTestId('add-logic'), 'the Logic button shows it is armed').toHaveClass(/active/);
    await page.mouse.move(at.x, at.y, { steps: 6 });
    await ev.snap('start-armed');
    await page.mouse.click(at.x, at.y);
    await expect(pill).toHaveCount(0);
    await app.type('Order received');
    const n = await app.nodeNamed('Order received');
    expect([n.role, n.shape], 'a start point is a pill').toEqual(['start', 'pill']);
    const b = await app.box(app.rfNode(n.id));
    expect(Math.hypot(b.x + b.width / 2 - at.x, b.y + b.height / 2 - at.y), 'centred on the click').toBeLessThanOrEqual(2);
  });

  await test.step('a plain step, then a decision from the Logic menu spawns beside the selected step', async () => {
    await placeTopic('Check payment', spot(0.3, 0.35));
    const anchor = await app.nodeNamed('Check payment');
    expect((await app.selection()).nodes, 'the new step stays selected').toEqual([anchor.id]);
    await pickLogic(app, 'decision');
    await expect(pill, 'with a topic selected there is no placement cursor').toHaveCount(0);
    await app.type('Paid?');
    const dec = await app.nodeNamed('Paid?');
    expect([dec.role, dec.shape], 'a decision is a diamond').toEqual(['decision', 'diamond']);
    expect(dec.x, '48px to the right of the selected step').toBe(anchor.x + anchor.width + 48);
    expect(Math.abs(dec.y + dec.height / 2 - (anchor.y + anchor.height / 2)), 'level with it').toBeLessThanOrEqual(0.5);
  });

  await test.step('place the end point and the other steps', async () => {
    await deselect();
    await pickLogic(app, 'end');
    await expect(pill).toContainText('Click the canvas to place an end point');
    await page.mouse.click(spot(0.9, 0.35).x, spot(0.9, 0.35).y);
    await app.type('Done');
    await placeTopic('Ship order', spot(0.7, 0.35));
    const dec = await app.center(app.topic('Paid?'));
    await placeTopic('Send reminder', { x: dec.x, y: spot(0, 0.68).y });
    await deselect();
    for (const t of ['Order received', 'Check payment', 'Paid?', 'Ship order', 'Done', 'Send reminder']) expect(await app.inView(app.topic(t)), t + ' is on screen').toBe(true);
  });

  const ids = await idsByTitle(app, ['Order received', 'Check payment', 'Paid?', 'Ship order', 'Done', 'Send reminder']);

  await test.step('each logic node shows its role marker and shape', async () => {
    const node = (t: string) => app.rfNode(ids[t]).locator('.wfc-node');
    const marker = (t: string) => app.rfNode(ids[t]).getByTestId('role-marker');
    await expect(node('Order received')).toHaveClass(/shape-pill/);
    await expect(marker('Order received')).toHaveAttribute('data-role', 'start');
    await expect(node('Paid?')).toHaveClass(/shape-diamond/);
    await expect(node('Paid?').locator('.wfc-shape-svg polygon'), 'the decision is drawn as a diamond').toHaveCount(1);
    await expect(marker('Paid?')).toHaveAttribute('data-role', 'decision');
    await expect(node('Done')).toHaveClass(/shape-pill/);
    await expect(marker('Done')).toHaveAttribute('data-role', 'end');
    for (const t of ['Check payment', 'Ship order', 'Send reminder']) await expect(marker(t), t + ' is a plain step without a role marker').toHaveCount(0);
    for (const t of ['Order received', 'Paid?', 'Done']) await expect(marker(t)).toBeVisible();
    const startSpot = markerSpot(await app.box(marker('Order received')), await app.box(node('Order received')));
    expect(startSpot.fx, 'the Start marker sits at the top-left').toBeLessThan(0.5);
    expect(Math.abs(startSpot.fy), 'on the top edge').toBeLessThan(0.35);
    const decSpot = markerSpot(await app.box(marker('Paid?')), await app.box(node('Paid?')));
    ev.note('decision marker centre at ' + decSpot.fx.toFixed(3) + ', ' + decSpot.fy.toFixed(3) + ' of the diamond box');
    expect(Math.hypot(decSpot.fx - 0.25, decSpot.fy - 0.25), 'the decision marker sits on the diamond\'s upper-left edge').toBeLessThan(0.02);
    const border = (t: string) => node(t).evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
    const [startBorder, endBorder] = [await border('Order received'), await border('Done')];
    ev.note('outline: start ' + startBorder + 'px, end ' + endBorder + 'px');
    expect(endBorder, 'End has a heavier outline than Start').toBeGreaterThan(startBorder);
    await ev.snap('logic-nodes-placed');
  });

  await test.step('connect the flow from ports; the decision\'s branches are labelled Yes and No', async () => {
    const e1 = await connectFromPort(app, ids['Order received'], 'right', ids['Check payment']);
    const e2 = await connectFromPort(app, ids['Check payment'], 'right', ids['Paid?']);
    const yes = await connectFromPort(app, ids['Paid?'], 'right', ids['Ship order']);
    expect(yes.label, 'the first connector out of the decision is labelled Yes').toBe('Yes');
    await expect(page.getByTestId('edge-label-' + yes.id)).toHaveText('Yes');
    await ev.snap('yes-branch');
    const no = await connectFromPort(app, ids['Paid?'], 'bottom', ids['Send reminder']);
    expect(no.label, 'the second is labelled No').toBe('No');
    await expect(page.getByTestId('edge-label-' + no.id)).toHaveText('No');
    const e5 = await connectFromPort(app, ids['Ship order'], 'right', ids['Done']);
    const loop = await connectFromPort(app, ids['Send reminder'], 'left', ids['Check payment']);
    for (const e of [e1, e2, e5, loop]) expect(e.label ?? '', 'connectors out of plain steps are not labelled').toBe('');
    await page.keyboard.press('Escape');
    for (const [e, l] of [[yes, 'Yes'], [no, 'No']] as const) {
      const seen = await expectLabelReadable(app, e.id, [e.source, e.target], 'the "' + l + '" label');
      ev.note('"' + l + '" label hit test (centre, corners): ' + seen.hits.join(', ') + '; against its cards: ' + seen.covered.join(', '));
    }
    await ev.snap('flow-connected');
  });

  await test.step('File → Logic description (.md) describes the flow', async () => {
    await page.getByTestId('menu-export').click();
    await expect(page.getByTestId('export-logic')).toHaveText('Logic description (.md)');
    await ev.snap('file-menu-logic-description');
    const dl = page.waitForEvent('download');
    await page.getByTestId('export-logic').click();
    const download = await dl;
    expect(download.suggestedFilename()).toBe('order-flow-logic.md');
    const file = await ev.keep(download);
    const md = expectLogicMarkdown(file, title);
    ev.note('logic description: downloads/order-flow-logic.md (' + md.split('\n').length + ' lines)');
  });

  await test.step('in Neon Flow a Yes label on a connector into the top of a card is drawn clear of the card (bug L1)', async () => {
    const seeded = await seedLabelIntoTop(app);
    await app.pinTheme('neon-flow');
    await app.open(seeded.docId);
    await expect(page.locator('html'), 'the page is in Neon Flow mode').toHaveAttribute('data-neon', '');
    await app.fit();
    const wire = (await app.doc()).edges.find((e) => e.id === seeded.edge)!;
    expect([wire.sourceSide, wire.targetSide, wire.label], 'Paid? → Ship order leaves the right port and enters the top port, labelled Yes').toEqual(['right', 'top', 'Yes']);
    await expect(page.getByTestId('edge-label-' + seeded.edge)).toHaveText('Yes');
    const seen = await expectLabelReadable(app, seeded.edge, [seeded.source, seeded.target], 'Neon Flow, Yes into a top port');
    ev.note('Neon Flow, Yes label into Ship order\'s top port: hit test ' + seen.hits.join(', ') + '; against its cards: ' + seen.covered.join(', '));
    await ev.snap('yes-label-into-top-port');
  });
});

test('change a topic\'s logic role in the inspector', async ({ page, app, ev }) => {
  ev.proves('With a plain topic selected, the Inspector shows a "Logic role" picker (Step) next to Shape (Card). Its popover lists Step and the nine roles; picking Wait turns the topic into a circle with the wait marker, picking Data into the new parallelogram shape with the data marker, and setting it back to Step removes the role and the marker but keeps the parallelogram. The Shape picker follows each change.');
  const docId = await app.newDoc('Refund flow');
  await app.tool('add_nodes', { documentId: docId, nodes: [{ id: 'lr-step', title: 'Approve refund', x: 0, y: 0 }] });
  await app.open(docId);
  await app.fit();
  const node = app.rfNode('lr-step').locator('.wfc-node');
  const marker = app.rfNode('lr-step').getByTestId('role-marker');
  const role = app.inspector().getByTestId('role-picker');
  const shape = app.inspector().getByTestId('shape-picker');
  const now = async () => { const n = await app.nodeNamed('Approve refund'); return [n.role ?? null, n.shape ?? null]; };

  await test.step('the Inspector shows the Logic role picker next to Shape', async () => {
    await app.topic('Approve refund').click();
    await expect(role).toHaveAttribute('aria-label', 'Logic role: Step');
    await expect(shape).toHaveAttribute('aria-label', 'Shape: Card');
    const [r, s] = [await app.box(role), await app.box(shape)];
    expect(Math.abs(r.y - s.y), 'Logic role and Shape share a row').toBeLessThanOrEqual(1);
    expect(r.x + r.width, 'Logic role sits left of Shape').toBeLessThanOrEqual(s.x);
    await expect(marker, 'a plain step has no role marker').toHaveCount(0);
    await ev.snap('inspector-role-step');
  });

  await test.step('pick Wait: the topic becomes a circle with the wait marker', async () => {
    await role.click();
    const opts = page.getByTestId('role-picker-options');
    await expect(opts).toBeVisible();
    expect(await opts.getByRole('option').evaluateAll((os) => os.map((o) => o.getAttribute('data-testid'))), 'Step, then the nine roles').toEqual(['role-none', ...ROLES.map((r) => 'role-' + r)]);
    await expect(page.getByTestId('role-none')).toContainText('Step');
    await ev.snap('role-picker-open');
    await page.getByTestId('role-wait').click();
    await expect.poll(now).toEqual(['wait', 'circle']);
    await expect(node).toHaveClass(/shape-circle/);
    await expect(node.locator('.wfc-shape-svg ellipse'), 'drawn as a circle').toHaveCount(1);
    await expect(marker).toHaveAttribute('data-role', 'wait');
    await expect(role).toHaveAttribute('aria-label', 'Logic role: Wait');
    await expect(shape).toHaveAttribute('aria-label', 'Shape: Circle');
    await ev.snap('role-wait-circle');
  });

  await test.step('pick Data: the topic becomes a parallelogram', async () => {
    await role.click();
    await page.getByTestId('role-data').click();
    await expect.poll(now).toEqual(['data', 'parallelogram']);
    await expect(node).toHaveClass(/shape-parallelogram/);
    await expect(node.locator('.wfc-shape-svg polygon'), 'drawn as a parallelogram').toHaveCount(1);
    await expect(marker).toHaveAttribute('data-role', 'data');
    await expect(shape).toHaveAttribute('aria-label', 'Shape: Parallelogram');
    await ev.snap('role-data-parallelogram');
  });

  await test.step('back to Step: the role and marker go, the shape stays', async () => {
    await role.click();
    await page.getByTestId('role-none').click();
    await expect.poll(now).toEqual([null, 'parallelogram']);
    await expect(marker).toHaveCount(0);
    await expect(node).toHaveClass(/shape-parallelogram/);
    await expect(role).toHaveAttribute('aria-label', 'Logic role: Step');
    await expect(shape).toHaveAttribute('aria-label', 'Shape: Parallelogram');
    await ev.snap('back-to-step-keeps-shape');
  });
});

test('drag a connector from every port of a decision and a wait node', async ({ page, app, ev }) => {
  ev.proves('Regression: the role marker never covers a port. The D shortcut arms a decision ("Click the canvas to place a decision"), and the Logic menu spawns a Wait circle beside it. On both, every press on each of the four ports\' dots reaches the port (the marker is not on top of any of them), in Neon Flow (the default theme), Lens Dark and Excalidraw Sketch, and each marker sits on its shape\'s upper-left outline (the sketch themes once drew it at the corner of the box). Dragging from each of the eight ports, including the decision\'s top port, draws a connector from that side to the drop target and never moves the node; the decision\'s first two connectors are labelled Yes and No.');
  const docId = await app.newDoc('Port check');
  await app.open(docId);
  const pane = await app.paneBox();
  const pill = page.getByTestId('place-pill');

  await test.step('D arms a decision; the Logic menu adds a Wait beside it', async () => {
    await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('d');
    await expect(pill, 'D arms the placement cursor for a decision').toContainText('Click the canvas to place a decision');
    await page.mouse.click(pane.x + pane.width * 0.35, pane.y + pane.height * 0.45);
    await app.type('Approved?');
    const dec = await app.nodeNamed('Approved?');
    expect([dec.role, dec.shape]).toEqual(['decision', 'diamond']);
    await pickLogic(app, 'wait');
    await app.type('Wait for reply');
    const wait = await app.nodeNamed('Wait for reply');
    expect([wait.role, wait.shape], 'a wait is a circle').toEqual(['wait', 'circle']);
    expect(wait.x, 'spawned 48px beside the decision').toBe(dec.x + dec.width + 48);
  });

  const dec = await app.nodeNamed('Approved?');
  const wait = await app.nodeNamed('Wait for reply');
  const T = { width: 120, height: 48 };
  const cx = (n: typeof dec) => n.x + n.width / 2, cy = (n: typeof dec) => n.y + n.height / 2;
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: 'pc-dtop', title: 'Above D', ...T, x: cx(dec) - 60, y: dec.y - 150 },
    { id: 'pc-dbottom', title: 'Below D', ...T, x: cx(dec) - 60, y: dec.y + dec.height + 100 },
    { id: 'pc-dleft', title: 'Left of D', ...T, x: dec.x - 230, y: cy(dec) - 24 },
    { id: 'pc-wtop', title: 'Above W', ...T, x: cx(wait) - 60, y: wait.y - 150 },
    { id: 'pc-wbottom', title: 'Below W', ...T, x: cx(wait) - 60, y: wait.y + wait.height + 100 },
    { id: 'pc-wright', title: 'Right of W', ...T, x: wait.x + wait.width + 110, y: cy(wait) - 24 },
  ] });
  await page.keyboard.press('Escape');
  await app.fit();

  for (const [theme, label] of [[DEFAULT_SESSION.theme, 'Neon Flow'], ['lens-dark', 'Lens Dark'], ['excalidraw-sketch', 'Excalidraw Sketch']] as const) {
    await test.step('the role marker covers none of the eight ports in ' + label, async () => {
      await app.pinTheme(theme);
      await expect.poll(async () => (await app.state()).session.theme).toBe(theme);
      await page.waitForTimeout(300);
      for (const [n, role] of [[dec, 'decision'], [wait, 'wait']] as const) {
        await app.rfNode(n.id).hover();
        await expect.poll(() => app.rfNode(n.id).locator('.react-flow__handle[data-handlepos="top"]').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
        await expectPortsClearOfMarker(page, n.id, role, label + ', ' + role);
        const spot = await expectMarkerOnShape(app, n.id, role, label + ', ' + role);
        ev.note(label + ', ' + role + ' marker centre at ' + spot.fx.toFixed(3) + ', ' + spot.fy.toFixed(3) + ' of the box');
        await ev.snap(theme + '-' + role + '-ports');
      }
    });
  }
  await app.pinTheme(DEFAULT_SESSION.theme);
  await expect.poll(async () => (await app.state()).session.theme).toBe(DEFAULT_SESSION.theme);

  await test.step('drag from each port of the decision: a connector, never a move; Yes then No', async () => {
    const top = await connectFromPort(app, dec.id, 'top', 'pc-dtop');
    expect(top.label, 'the first connector out of the decision is labelled Yes').toBe('Yes');
    await ev.snap('decision-top-port-connected');
    const right = await connectFromPort(app, dec.id, 'right', wait.id);
    expect(right.label, 'the second is labelled No').toBe('No');
    const bottom = await connectFromPort(app, dec.id, 'bottom', 'pc-dbottom');
    const left = await connectFromPort(app, dec.id, 'left', 'pc-dleft');
    expect([bottom.label ?? '', left.label ?? ''], 'Yes and No are used up; later branches start unlabelled').toEqual(['', '']);
  });

  await test.step('drag from each port of the wait circle: a connector, never a move', async () => {
    for (const [side, target] of [['top', 'pc-wtop'], ['right', 'pc-wright'], ['bottom', 'pc-wbottom'], ['left', dec.id]] as const) {
      const e = await connectFromPort(app, wait.id, side, target);
      expect(e.label ?? '', 'connectors out of a wait are not labelled').toBe('');
    }
    await page.keyboard.press('Escape');
    await ev.snap('eight-connectors');
    expect((await app.doc()).edges.length).toBe(8);
  });
});
