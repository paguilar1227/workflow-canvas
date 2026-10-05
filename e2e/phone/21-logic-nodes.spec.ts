import { test, expect, type App, type WEdge } from '../support/journey';
import { MIN_TARGET, type Phone } from '../support/phone';
import { DEFAULT_SESSION } from '../../src/shared/types';
import { ROLES, expectLabelReadable, expectLogicMarkdown, expectMarkerOnShape, expectPortsClearOfMarker, idsByTitle, markerSpot, seedLabelIntoTop } from '../support/logic';
import { portTouch } from '../support/neon';

const handle = (app: App, id: string, side: string) => app.rfNode(id).locator('.react-flow__handle[data-handlepos="' + side + '"]');

/** Every option of an open picker sheet is a full-size touch target, wholly on screen. */
async function expectTouchSheet(phone: Phone, testId: string, count: number) {
  const sheet = phone.page.getByTestId(testId);
  await expect(sheet).toBeVisible();
  await expect(sheet, 'on a phone it opens as a bottom sheet').toHaveClass(/sheet/);
  const vp = phone.page.viewportSize()!;
  const boxes = await sheet.getByRole('option').evaluateAll((os) => os.map((o) => { const r = o.getBoundingClientRect(); return { id: o.getAttribute('data-testid'), x: r.x, y: r.y, w: r.width, h: r.height }; }));
  expect(boxes.length).toBe(count);
  for (const b of boxes) {
    expect(Math.min(b.w, b.h), b.id + ' is at least ' + MIN_TARGET + 'px each way').toBeGreaterThanOrEqual(MIN_TARGET);
    expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= vp.width && b.y + b.h <= vp.height, b.id + ' is wholly on screen').toBe(true);
  }
  return boxes.map((b) => b.id);
}

/** Open the Logic bottom sheet from the toolbar and tap a role. */
async function pickLogic(phone: Phone, role: string) {
  await phone.tap(phone.page.getByTestId('add-logic'));
  await expect(phone.page.getByTestId('add-logic-options')).toBeVisible();
  await phone.tap(phone.page.getByTestId('role-' + role));
  await expect(phone.page.getByTestId('add-logic-options'), 'tapping a role closes the sheet').toHaveCount(0);
}

/** Tap the source so its ports show, then slide one finger from its port on one side to the target: one new connector, and the source has not moved. */
async function connectFromPort(app: App, phone: Phone, sourceId: string, side: string, targetId: string): Promise<WEdge> {
  const d0 = await app.doc();
  const before = new Set(d0.edges.map((e) => e.id));
  const n0 = d0.nodes.find((n) => n.id === sourceId)!;
  if ((await app.selection()).nodes.join() !== sourceId) await phone.tap(await phone.grab(app.rfNode(sourceId)));
  await expect.poll(async () => (await app.selection()).nodes, 'tapping selects the source').toEqual([sourceId]);
  const port = handle(app, sourceId, side);
  await expect.poll(() => port.evaluate((el) => getComputedStyle(el).opacity), 'the selected node shows its ' + side + ' port').toBe('1');
  const box0 = await app.box(app.rfNode(sourceId));
  await phone.drag(await app.center(port), await phone.grab(app.rfNode(targetId)), 24);
  await expect.poll(async () => (await app.doc()).edges.filter((e) => !before.has(e.id)).length, 'sliding from the ' + side + ' port adds one connector').toBe(1);
  const d1 = await app.doc();
  const edge = d1.edges.find((e) => !before.has(e.id))!;
  expect([edge.source, edge.target, edge.sourceSide], 'the connector runs from the ' + side + ' port to the drop target').toEqual([sourceId, targetId, side]);
  const n1 = d1.nodes.find((n) => n.id === sourceId)!;
  expect([n1.x, n1.y], 'sliding from the ' + side + ' port does not move the node').toEqual([n0.x, n0.y]);
  const box1 = await app.box(app.rfNode(sourceId));
  expect(Math.hypot(box1.x - box0.x, box1.y - box0.y), 'the node stays put on screen').toBeLessThan(0.5);
  await expect(app.edgePath(edge.id)).toHaveCount(1);
  expect(await app.edgePath(edge.id).evaluate((p) => (p as unknown as SVGPathElement).getTotalLength()), 'the connector is drawn').toBeGreaterThan(0);
  return edge;
}

test('build a decision flow with logic nodes and export its logic', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: on 390px, 375px and 360px-wide phones the toolbar, now with a Logic button, fits without overflow and every control is at least 44×44 (bug L2: at 390px the Logic button was cut off and the bar scrolled sideways). A person builds Start → Check payment → Paid? → (Yes) Ship order → Done, (No) Send reminder → back to Check payment: Start, the decision and End come from the Logic bottom sheet (nine roles, each a 44px+ target wholly on screen; tapping one shows "Tap to place …" and a tap drops it there), plain steps from Topic. Each logic node shows its role marker and shape. Connectors are drawn by sliding a finger from the selected node\'s port; the first two out of the decision are labelled Yes and No, and both labels can be read (no card drawn over them). More → Logic description (.md) downloads <doc>-logic.md with the numbered steps, the **Yes**/**No** branches, "loops back to step 2" and no issues. In Neon Flow a Yes label on a connector entering the top port of a card is drawn clear of the card (bug L1). Ergonomics are measured on each screen.');
  const title = 'Order flow';
  const docId = await app.newDoc(title);
  await app.open(docId);
  const pane = await app.paneBox();
  const spot = (fx: number, fy: number) => ({ x: pane.x + pane.width * fx, y: pane.y + pane.height * fy });
  const pill = page.getByTestId('place-pill');
  const deselect = async () => {
    if ((await app.selection()).nodes.length) await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.8 }));
    await expect.poll(async () => (await app.selection()).nodes).toEqual([]);
  };
  const placeLogic = async (role: string, label: string, name: string, at: { x: number; y: number }) => {
    await deselect();
    await pickLogic(phone, role);
    await expect(pill).toContainText('Tap to place ' + label);
    await phone.tap(at);
    await expect(pill).toHaveCount(0);
    await app.type(name);
  };
  const placeTopic = async (name: string, at: { x: number; y: number }) => {
    await deselect();
    await phone.place('add-topic', at);
    await app.type(name);
  };

  await test.step('the toolbar with the Logic button fits a 390px-wide phone, and 375px and 360px ones (bug L2)', async () => {
    const size = page.viewportSize()!;
    expect(size.width).toBe(390);
    const fits = async () => {
      const vw = page.viewportSize()!.width;
      const bar = await page.locator('.toolbar').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, ...JSON.parse(JSON.stringify(el.getBoundingClientRect())) }));
      const buttons = await page.locator('.toolbar button').evaluateAll((bs) => bs.filter((b) => b.getClientRects().length).map((b) => { const r = b.getBoundingClientRect(); return { id: b.getAttribute('data-testid') ?? b.getAttribute('aria-label'), l: r.left, r: r.right, w: r.width, h: r.height }; }));
      ev.note('toolbar at ' + vw + 'px: ' + Math.round(bar.width) + 'px wide, content ' + bar.sw + ' / visible ' + bar.cw + '; ' + buttons.map((b) => b.id + ' ' + Math.round(b.w) + '×' + Math.round(b.h)).join(', '));
      expect(bar.left, vw + 'px: the toolbar starts on screen').toBeGreaterThanOrEqual(0);
      expect(bar.right, vw + 'px: and ends on screen').toBeLessThanOrEqual(vw);
      expect(bar.sw, vw + 'px: nothing in the toolbar is scrolled out of view').toBeLessThanOrEqual(bar.cw + 1);
      expect(buttons.map((b) => b.id), vw + 'px: the Logic button is in the toolbar').toContain('add-logic');
      for (const b of buttons) {
        expect(b.l >= bar.left && b.r <= bar.right, vw + 'px: ' + b.id + ' is wholly inside the toolbar, on screen').toBe(true);
        expect(Math.min(b.w, b.h), vw + 'px: ' + b.id + ' is at least ' + MIN_TARGET + 'px each way').toBeGreaterThanOrEqual(MIN_TARGET);
      }
    };
    await fits();
    await phone.ergonomics('toolbar with Logic');
    await ev.snap('toolbar-with-logic-390');
    for (const width of [375, 360]) {
      await page.setViewportSize({ width, height: size.height });
      await page.waitForTimeout(300);
      await fits();
      await ev.snap('toolbar-with-logic-' + width);
    }
    await page.setViewportSize(size);
    await page.waitForTimeout(300);
  });

  await test.step('zoom out to make room for the flow', async () => {
    while ((await app.zoomPct()) > 62) await phone.tap(page.getByTestId('zoom-out'));
    await page.waitForTimeout(300);
  });

  await test.step('the Logic sheet lists every role as an easy touch target; tap Start, then tap where it goes', async () => {
    await phone.tap(page.getByTestId('add-logic'));
    expect(await expectTouchSheet(phone, 'add-logic-options', 9), 'all nine roles, in order').toEqual(ROLES.map((r) => 'role-' + r));
    await phone.ergonomics('Logic sheet');
    await ev.snap('logic-sheet');
    await phone.tap(page.getByTestId('role-start'));
    await expect(page.getByTestId('add-logic-options')).toHaveCount(0);
    await expect(pill, 'tapping Start arms placement').toContainText('Tap to place a start point');
    await phone.ergonomics('placing a start point');
    await ev.snap('start-armed');
    const at = spot(0.25, 0.12);
    await phone.tap(at);
    await expect(pill).toHaveCount(0);
    await app.type('Order received');
    const n = await app.nodeNamed('Order received');
    expect([n.role, n.shape], 'a start point is a pill').toEqual(['start', 'pill']);
    const b = await app.box(app.rfNode(n.id));
    expect(Math.hypot(b.x + b.width / 2 - at.x, b.y + b.height / 2 - at.y), 'centred on the tap').toBeLessThanOrEqual(2);
  });

  await test.step('place the steps, the decision and the end point', async () => {
    await placeTopic('Check payment', spot(0.72, 0.12));
    await placeLogic('decision', 'a decision', 'Paid?', spot(0.72, 0.34));
    await placeTopic('Send reminder', spot(0.25, 0.34));
    await placeTopic('Ship order', spot(0.72, 0.56));
    await placeLogic('end', 'an end point', 'Done', spot(0.25, 0.56));
    await deselect();
    for (const t of ['Order received', 'Check payment', 'Paid?', 'Ship order', 'Done', 'Send reminder']) expect(await app.inView(app.topic(t)), t + ' is on screen').toBe(true);
  });

  const ids = await idsByTitle(app, ['Order received', 'Check payment', 'Paid?', 'Ship order', 'Done', 'Send reminder']);

  await test.step('each logic node shows its role marker and shape', async () => {
    const node = (t: string) => app.rfNode(ids[t]).locator('.wfc-node');
    const marker = (t: string) => app.rfNode(ids[t]).getByTestId('role-marker');
    expect([(await app.nodeNamed('Paid?')).shape, (await app.nodeNamed('Done')).shape]).toEqual(['diamond', 'pill']);
    await expect(node('Order received')).toHaveClass(/shape-pill/);
    await expect(marker('Order received')).toHaveAttribute('data-role', 'start');
    await expect(node('Paid?')).toHaveClass(/shape-diamond/);
    await expect(node('Paid?').locator('.wfc-shape-svg polygon'), 'the decision is drawn as a diamond').toHaveCount(1);
    await expect(marker('Paid?')).toHaveAttribute('data-role', 'decision');
    await expect(node('Done')).toHaveClass(/shape-pill/);
    await expect(marker('Done')).toHaveAttribute('data-role', 'end');
    for (const t of ['Check payment', 'Ship order', 'Send reminder']) await expect(marker(t), t + ' is a plain step without a role marker').toHaveCount(0);
    for (const t of ['Order received', 'Paid?', 'Done']) await expect(marker(t)).toBeVisible();
    const decSpot = markerSpot(await app.box(marker('Paid?')), await app.box(node('Paid?')));
    ev.note('decision marker centre at ' + decSpot.fx.toFixed(3) + ', ' + decSpot.fy.toFixed(3) + ' of the diamond box');
    expect(Math.hypot(decSpot.fx - 0.25, decSpot.fy - 0.25), 'the decision marker sits on the diamond\'s upper-left edge').toBeLessThan(0.02);
    const border = (t: string) => node(t).evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
    expect(await border('Done'), 'End has a heavier outline than Start').toBeGreaterThan(await border('Order received'));
    await phone.ergonomics('logic nodes placed');
    await ev.snap('logic-nodes-placed');
  });

  await test.step('connect the flow by sliding from ports; the decision\'s branches are labelled Yes and No', async () => {
    const e1 = await connectFromPort(app, phone, ids['Order received'], 'right', ids['Check payment']);
    const e2 = await connectFromPort(app, phone, ids['Check payment'], 'bottom', ids['Paid?']);
    const yes = await connectFromPort(app, phone, ids['Paid?'], 'bottom', ids['Ship order']);
    expect(yes.label, 'the first connector out of the decision is labelled Yes').toBe('Yes');
    await expect(page.getByTestId('edge-label-' + yes.id)).toHaveText('Yes');
    const no = await connectFromPort(app, phone, ids['Paid?'], 'left', ids['Send reminder']);
    expect(no.label, 'the second is labelled No').toBe('No');
    await expect(page.getByTestId('edge-label-' + no.id)).toHaveText('No');
    await phone.ergonomics('decision selected');
    await ev.snap('yes-and-no-branches');
    const e5 = await connectFromPort(app, phone, ids['Ship order'], 'left', ids['Done']);
    const loop = await connectFromPort(app, phone, ids['Send reminder'], 'top', ids['Check payment']);
    for (const e of [e1, e2, e5, loop]) expect(e.label ?? '', 'connectors out of plain steps are not labelled').toBe('');
    await deselect();
    for (const [e, l] of [[yes, 'Yes'], [no, 'No']] as const) {
      const seen = await expectLabelReadable(app, e.id, [e.source, e.target], 'the "' + l + '" label');
      ev.note('"' + l + '" label hit test (centre, corners): ' + seen.hits.join(', ') + '; against its cards: ' + seen.covered.join(', '));
    }
    await ev.snap('flow-connected');
  });

  await test.step('More → Logic description (.md) describes the flow', async () => {
    const dl = page.waitForEvent('download');
    await phone.more('export-logic');
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
    await phone.fit();
    const wire = (await app.doc()).edges.find((e) => e.id === seeded.edge)!;
    expect([wire.sourceSide, wire.targetSide, wire.label], 'Paid? → Ship order leaves the right port and enters the top port, labelled Yes').toEqual(['right', 'top', 'Yes']);
    await expect(page.getByTestId('edge-label-' + seeded.edge)).toHaveText('Yes');
    const seen = await expectLabelReadable(app, seeded.edge, [seeded.source, seeded.target], 'Neon Flow, Yes into a top port');
    ev.note('Neon Flow, Yes label into Ship order\'s top port: hit test ' + seen.hits.join(', ') + '; against its cards: ' + seen.covered.join(', '));
    await phone.ergonomics('Yes label into a top port');
    await ev.snap('yes-label-into-top-port');
  });
});

test('change a topic\'s logic role in the inspector', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: with a plain topic selected, Style opens the inspector drawer, which shows a "Logic role" picker (Step) next to Shape (Card). Tapping it opens a bottom sheet with Step and the nine roles, each a 44px+ target wholly on screen; tapping Wait turns the topic into a circle with the wait marker, Data into the new parallelogram with the data marker, and Step removes the role and the marker but keeps the parallelogram. The Shape picker follows each change; ergonomics are measured on each screen.');
  const docId = await app.newDoc('Refund flow');
  await app.tool('add_nodes', { documentId: docId, nodes: [{ id: 'lr-step', title: 'Approve refund', x: 0, y: 0 }] });
  await app.open(docId);
  await phone.fit();
  const node = app.rfNode('lr-step').locator('.wfc-node');
  const marker = app.rfNode('lr-step').getByTestId('role-marker');
  const role = app.inspector().getByTestId('role-picker');
  const shape = app.inspector().getByTestId('shape-picker');
  const now = async () => { const n = await app.nodeNamed('Approve refund'); return [n.role ?? null, n.shape ?? null]; };
  const pick = async (r: string) => {
    await phone.tap(role);
    await expectTouchSheet(phone, 'role-picker-options', 10);
    await phone.tap(page.getByTestId('role-' + r));
    await expect(page.getByTestId('role-picker-options'), 'tapping a role closes the sheet').toHaveCount(0);
  };

  await test.step('Style opens the inspector with the Logic role picker next to Shape', async () => {
    await phone.selectTopic('Approve refund');
    await phone.sel('sel-style');
    await expect(phone.slot('inspector')).toHaveClass(/shown/);
    await expect(role).toHaveAttribute('aria-label', 'Logic role: Step');
    await expect(shape).toHaveAttribute('aria-label', 'Shape: Card');
    const [r, s] = [await app.box(role), await app.box(shape)];
    expect(Math.abs(r.y - s.y), 'Logic role and Shape share a row').toBeLessThanOrEqual(1);
    expect(r.x + r.width, 'Logic role sits left of Shape').toBeLessThanOrEqual(s.x);
    expect(Math.min(r.height, s.height), 'both pickers are 44px+ tall').toBeGreaterThanOrEqual(MIN_TARGET);
    await expect(marker, 'a plain step has no role marker').toHaveCount(0);
    await phone.ergonomics('inspector with a topic');
    await ev.snap('inspector-role-step');
  });

  await test.step('the role sheet is easy to use by touch; tap Wait: the topic becomes a circle', async () => {
    await phone.tap(role);
    expect(await expectTouchSheet(phone, 'role-picker-options', 10), 'Step, then the nine roles').toEqual(['role-none', ...ROLES.map((r) => 'role-' + r)]);
    await expect(page.getByTestId('role-none')).toContainText('Step');
    await phone.ergonomics('role picker sheet');
    await ev.snap('role-sheet');
    await phone.tap(page.getByTestId('role-wait'));
    await expect(page.getByTestId('role-picker-options')).toHaveCount(0);
    await expect.poll(now).toEqual(['wait', 'circle']);
    await expect(node).toHaveClass(/shape-circle/);
    await expect(node.locator('.wfc-shape-svg ellipse'), 'drawn as a circle').toHaveCount(1);
    await expect(marker).toHaveAttribute('data-role', 'wait');
    await expect(role).toHaveAttribute('aria-label', 'Logic role: Wait');
    await expect(shape).toHaveAttribute('aria-label', 'Shape: Circle');
    await ev.snap('role-wait-circle');
  });

  await test.step('tap Data: the topic becomes a parallelogram', async () => {
    await pick('data');
    await expect.poll(now).toEqual(['data', 'parallelogram']);
    await expect(node).toHaveClass(/shape-parallelogram/);
    await expect(node.locator('.wfc-shape-svg polygon'), 'drawn as a parallelogram').toHaveCount(1);
    await expect(marker).toHaveAttribute('data-role', 'data');
    await expect(shape).toHaveAttribute('aria-label', 'Shape: Parallelogram');
    await ev.snap('role-data-parallelogram');
  });

  await test.step('back to Step: the role and marker go, the shape stays', async () => {
    await pick('none');
    await expect.poll(now).toEqual([null, 'parallelogram']);
    await expect(marker).toHaveCount(0);
    await expect(role).toHaveAttribute('aria-label', 'Logic role: Step');
    await expect(shape).toHaveAttribute('aria-label', 'Shape: Parallelogram');
    await phone.closeDrawer('inspector');
    await expect(node).toHaveClass(/shape-parallelogram/);
    await expect(node).toBeVisible();
    await ev.snap('back-to-step-keeps-shape');
  });
});

test('drag a connector from every port of a decision and a wait node', async ({ page, app, ev, phone }) => {
  ev.proves('Regression, phone version: the role marker never covers a port. A decision placed from the Logic sheet and a Wait circle spawned beside it (Logic sheet with the decision selected) each show four ports once selected; on both, every touch on each port\'s dot reaches the port (the marker is not on top of any of them), nothing clips a port and each port\'s touch area is at least 44 card units each way, in Neon Flow (the default theme), Lens Dark and Excalidraw Sketch, and each marker sits on its shape\'s upper-left outline (the sketch themes once drew it at the corner of the box). Sliding a finger from each of the eight ports, including the decision\'s top port, draws a connector from that side to the drop target and never moves the node; the decision\'s first two connectors are labelled Yes and No.');
  const docId = await app.newDoc('Port check');
  await app.open(docId);
  const pane = await app.paneBox();

  await test.step('a decision from the Logic sheet; a Wait spawns beside the selected decision', async () => {
    await pickLogic(phone, 'decision');
    await expect(page.getByTestId('place-pill')).toContainText('Tap to place a decision');
    await phone.tap({ x: pane.x + pane.width * 0.3, y: pane.y + pane.height * 0.4 });
    await app.type('Approved?');
    const dec = await app.nodeNamed('Approved?');
    expect([dec.role, dec.shape]).toEqual(['decision', 'diamond']);
    expect((await app.selection()).nodes).toEqual([dec.id]);
    await pickLogic(phone, 'wait');
    await expect(page.getByTestId('place-pill'), 'with a node selected there is no placement').toHaveCount(0);
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
  await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.9 }));
  await phone.fit();

  for (const [theme, label] of [[DEFAULT_SESSION.theme, 'Neon Flow'], ['lens-dark', 'Lens Dark'], ['excalidraw-sketch', 'Excalidraw Sketch']] as const) {
    await test.step('the role marker covers none of the eight ports in ' + label + '; each is easy to touch', async () => {
      await app.pinTheme(theme);
      await expect.poll(async () => (await app.state()).session.theme).toBe(theme);
      await page.waitForTimeout(300);
      const zoom = (await app.viewport()).zoom;
      const dpr = await page.evaluate(() => devicePixelRatio);
      const step = 2 * (0.25 + 1 / dpr);
      for (const [n, role] of [[dec, 'decision'], [wait, 'wait']] as const) {
        if ((await app.selection()).nodes.join() !== n.id) await phone.tap(await phone.grab(app.rfNode(n.id)));
        await expect.poll(async () => (await app.selection()).nodes).toEqual([n.id]);
        await expect.poll(() => handle(app, n.id, 'top').evaluate((el) => getComputedStyle(el).opacity), 'the selected ' + role + ' shows its ports').toBe('1');
        await expectPortsClearOfMarker(page, n.id, role, label + ', ' + role);
        const spot = await expectMarkerOnShape(app, n.id, role, label + ', ' + role);
        ev.note(label + ', ' + role + ' marker centre at ' + spot.fx.toFixed(3) + ', ' + spot.fy.toFixed(3) + ' of the box');
        const ports = await portTouch(page, n.id);
        ev.note(label + ', ' + role + ' at zoom ' + zoom.toFixed(3) + ': touch areas ' + ports.map((q) => q.side + ' ' + (q.w / zoom).toFixed(1) + '×' + (q.h / zoom).toFixed(1)).join(', ') + ' in card units');
        for (const q of ports) {
          expect(q.clippedBy, label + ': the ' + role + "'s " + q.side + ' port is not clipped').toBeNull();
          expect([q.dot, q.inView], label + ': the whole ' + q.side + ' port of the ' + role + ' is on screen and nothing covers it').toEqual([true, true]);
          expect(Math.min(q.w, q.h), label + ': the ' + role + "'s " + q.side + ' touch area is at least ' + MIN_TARGET + ' card units each way').toBeGreaterThanOrEqual(MIN_TARGET * zoom - step);
        }
        await phone.ergonomics(label + ', ' + role + ' selected');
        await ev.snap(theme + '-' + role + '-ports');
      }
    });
  }
  await app.pinTheme(DEFAULT_SESSION.theme);
  await expect.poll(async () => (await app.state()).session.theme).toBe(DEFAULT_SESSION.theme);

  await test.step('slide from each port of the decision: a connector, never a move; Yes then No', async () => {
    const top = await connectFromPort(app, phone, dec.id, 'top', 'pc-dtop');
    expect(top.label, 'the first connector out of the decision is labelled Yes').toBe('Yes');
    await ev.snap('decision-top-port-connected');
    const right = await connectFromPort(app, phone, dec.id, 'right', wait.id);
    expect(right.label, 'the second is labelled No').toBe('No');
    const bottom = await connectFromPort(app, phone, dec.id, 'bottom', 'pc-dbottom');
    const left = await connectFromPort(app, phone, dec.id, 'left', 'pc-dleft');
    expect([bottom.label ?? '', left.label ?? ''], 'Yes and No are used up; later branches start unlabelled').toEqual(['', '']);
  });

  await test.step('slide from each port of the wait circle: a connector, never a move', async () => {
    for (const [side, target] of [['top', 'pc-wtop'], ['right', 'pc-wright'], ['bottom', 'pc-wbottom'], ['left', dec.id]] as const) {
      const e = await connectFromPort(app, phone, wait.id, side, target);
      expect(e.label ?? '', 'connectors out of a wait are not labelled').toBe('');
    }
    await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.9 }));
    await ev.snap('eight-connectors');
    expect((await app.doc()).edges.length).toBe(8);
  });
});
