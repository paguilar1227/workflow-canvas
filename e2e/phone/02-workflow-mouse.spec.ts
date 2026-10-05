import { test, expect } from '../support/journey';

test('sketch a workflow with the mouse', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: instead of mouse clicks and double-clicks, a person taps Topic and then a spot to place each topic, drags a topic with one finger, connects topics by dragging a connection dot of the selected topic and with Area select + Connect in the selection bar, labels a connector from the selection bar, then labels and restyles a connector in the inspector drawer (Style). Ergonomics are measured on each screen; the inspector drawer opens, expands, and closes from × and the backdrop.');
  const docId = await app.newDoc('Order workflow');
  await app.pinTheme('lens-dark');
  ev.note('Pinned to Lens Dark: this journey checks arrowheads on a restyled connector, which Neon Flow (the default theme) leaves out on purpose.');
  await app.open(docId);
  const pane = await app.paneBox();
  await phone.ergonomics('empty canvas');

  await test.step('tap Topic, then tap where each topic goes', async () => {
    const spots: [string, number, number][] = [['Receive order', 0.3, 0.2], ['Check stock', 0.7, 0.42], ['Ship it', 0.3, 0.62]];
    for (const [title, fx, fy] of spots) {
      if ((await app.selection()).nodes.length) await phone.tap(await app.emptyPoint({ x: 0.85, y: 0.08 }));
      await phone.place('add-topic', { x: pane.x + pane.width * fx, y: pane.y + pane.height * fy });
      await app.type(title);
    }
    for (const t of ['Receive order', 'Check stock', 'Ship it']) await expect(app.topic(t)).toBeVisible();
    await phone.ergonomics('three topics');
    await ev.snap('three-topics-added');
  });

  await test.step('drag a topic to a new place with one finger', async () => {
    const before = await app.nodeNamed('Ship it');
    const boxBefore = await app.box(app.topic('Ship it'));
    const from = await app.center(app.topic('Ship it'));
    const to = { x: from.x + pane.width * 0.3, y: from.y + pane.height * 0.08 };
    await phone.drag(from, to, 20);
    const after = await app.nodeNamed('Ship it');
    expect((await app.box(app.topic('Ship it'))).x - boxBefore.x, 'the topic followed the finger').toBeGreaterThan((to.x - from.x) * 0.8);
    expect(after.x - before.x, 'the new position was saved').toBeGreaterThan(50);
    await ev.snap('topic-dragged');
  });

  let first = '';
  let second = '';
  await test.step('connect by dragging a connection dot of the selected topic', async () => {
    const src = await app.nodeNamed('Receive order');
    const dst = await app.nodeNamed('Check stock');
    await phone.selectTopic('Receive order');
    const a = await app.center(app.rfNode(src.id).locator('.react-flow__handle[data-handlepos="right"]'));
    const b = await app.center(app.topic('Check stock'));
    await phone.drag(a, b, 24);
    await expect.poll(async () => (await app.doc()).edges.filter((e) => e.source === src.id && e.target === dst.id).length, 'a connector from Receive order to Check stock').toBe(1);
    first = (await app.doc()).edges.find((e) => e.source === src.id && e.target === dst.id)!.id;
    await expect(app.edge(first)).toBeVisible();
  });

  await test.step('Area select two topics and Connect them from the selection bar', async () => {
    const [c, s] = [await app.box(app.topic('Check stock')), await app.box(app.topic('Ship it'))];
    await phone.areaSelect({ x: Math.min(c.x, s.x) - 16, y: c.y - 16 }, { x: Math.max(c.x + c.width, s.x + s.width) + 16, y: s.y + s.height + 16 });
    const [cs, si] = [await app.nodeNamed('Check stock'), await app.nodeNamed('Ship it')];
    await expect.poll(async () => [...(await app.selection()).nodes].sort(), 'Area selected both topics').toEqual([cs.id, si.id].sort());
    await phone.ergonomics('two selected');
    await ev.snap('area-selected-two');
    await phone.sel('sel-connect');
    await expect.poll(async () => (await app.doc()).edges.filter((e) => [e.source, e.target].sort().join() === [cs.id, si.id].sort().join()).length).toBe(1);
    second = (await app.doc()).edges.find((e) => [e.source, e.target].includes(si.id))!.id;
    await expect(app.edge(second)).toBeVisible();
    await ev.snap('two-connectors');
  });

  await test.step('label a connector from the selection bar', async () => {
    await phone.tap(await app.emptyPoint({ x: 0.85, y: 0.08 }));
    await phone.tap(await app.edgeMidpoint(first));
    await expect.poll(async () => app.selection()).toEqual({ nodes: [], edges: [first] });
    await phone.sel('sel-edge-label');
    await app.type('new order');
    await expect(page.getByTestId('edge-label-' + first)).toHaveText('new order');
    await ev.snap('connector-labelled');
  });

  await test.step('label and restyle a connector in the inspector drawer', async () => {
    await phone.tap(await app.emptyPoint({ x: 0.85, y: 0.08 }));
    await phone.tap(await app.edgeMidpoint(second));
    await expect.poll(async () => app.selection()).toEqual({ nodes: [], edges: [second] });
    await phone.sel('sel-style');
    await expect(page.getByTestId('inspector-edge')).toBeVisible();
    await page.getByTestId('insp-edge-label').tap();
    await page.getByTestId('insp-edge-label').fill('in stock');
    await page.getByTestId('insp-edge-label').press('Enter');
    for (const id of ['routing-bezier', 'edgestyle-dashed', 'arrow-both', 'edge-animated']) await phone.tap(page.getByTestId(id));
    await phone.ergonomics('inspector with a connector');
    await ev.snap('inspector-drawer-connector');
    await expect.poll(async () => (await app.doc()).edges.find((x) => x.id === second)).toMatchObject({ label: 'in stock', routing: 'bezier', style: 'dashed', arrow: 'both', animated: true });
    await phone.closeDrawer('inspector');
    const path = app.edgePath(second);
    await expect(page.getByTestId('edge-label-' + second)).toHaveText('in stock');
    await expect(path, 'animated connectors render with the animated dash').toHaveClass(/animated/);
    await expect(path).toHaveAttribute('marker-start', /wfc-arrow/);
    await ev.snap('connector-restyled');
  });

  await test.step('the inspector drawer behaves like a drawer', async () => {
    await phone.checkDrawer('inspector', () => phone.more('toggle-inspector'));
  });
});
