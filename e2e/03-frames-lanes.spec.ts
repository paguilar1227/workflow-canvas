import { test, expect } from './support/journey';

test('organize a diagram with frames and swimlanes', async ({ page, app, ev }) => {
  ev.proves('A user groups selected topics into a named frame with Cmd+G, adds an empty frame from the toolbar (arm the Frame button, Enter places it in free space at the view centre), drags topics into it so they become members, drags the frame and sees its members travel with it, and arranges the frames as side-by-side swimlanes from the Layout menu.');
  const docId = await app.newDoc('Checkout architecture');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { title: 'Web app', x: 0, y: 0 }, { title: 'Mobile app', x: 0, y: 140 },
    { title: 'Orders API', x: 960, y: -40 }, { title: 'Postgres', x: 960, y: 140 }, { title: 'Redis', x: 960, y: 300 },
  ] });
  await app.open(docId);
  await ev.snap('loose-topics');
  let clients = '';
  let data = '';

  await test.step('Cmd+G frames the selected topics and the frame is named inline', async () => {
    await app.topic('Web app').click();
    await app.topic('Mobile app').click({ modifiers: ['Shift'] });
    await expect.poll(async () => (await app.selection()).nodes.length, 'Shift+click adds to the selection').toBe(2);
    await page.keyboard.press('ControlOrMeta+g');
    await app.type('Clients');
    const d = await app.doc();
    const frame = d.nodes.find((n) => n.kind === 'frame' && n.title === 'Clients');
    expect(frame, 'a frame named Clients exists').toBeTruthy();
    clients = frame!.id;
    await expect(app.frame(clients)).toContainText('Clients');
    for (const t of ['Web app', 'Mobile app']) expect(d.nodes.find((n) => n.title === t)!.frameId, t + ' is a member of Clients').toBe(clients);
    const fb = await app.box(app.frame(clients));
    for (const t of ['Web app', 'Mobile app']) {
      const b = await app.box(app.topic(t));
      expect(b.x >= fb.x && b.y >= fb.y && b.x + b.width <= fb.x + fb.width && b.y + b.height <= fb.y + fb.height, t + ' sits inside the frame on screen').toBe(true);
    }
    await ev.snap('selection-framed');
  });

  await test.step('the toolbar Frame button adds an empty frame', async () => {
    await page.keyboard.press('Escape');
    await page.getByTestId('add-frame').click();
    await expect(page.getByTestId('place-pill'), 'with nothing selected the Frame button arms the placement cursor').toBeVisible();
    await page.keyboard.press('Enter');
    await app.type('Data stores');
    const frame = (await app.doc()).nodes.find((n) => n.kind === 'frame' && n.title === 'Data stores');
    expect(frame, 'a frame named Data stores exists').toBeTruthy();
    data = frame!.id;
    await expect(app.frame(data)).toBeVisible();
    await ev.snap('empty-frame-added');
  });

  await test.step('dragging topics into the frame makes them members', async () => {
    for (const [t, fy] of [['Postgres', 0.38], ['Redis', 0.72]] as const) {
      const fb = await app.box(app.frame(data));
      await app.drag(await app.center(app.topic(t)), { x: fb.x + fb.width / 2, y: fb.y + fb.height * fy });
      await expect.poll(async () => (await app.nodeNamed(t)).frameId, t + ' became a member of Data stores').toBe(data);
    }
    expect((await app.nodeNamed('Orders API')).frameId ?? null, 'untouched topics stay unframed').toBeNull();
    await expect(page.getByTestId('outline')).toContainText('Data stores');
    await ev.snap('topics-dropped-into-frame');
  });

  await test.step('dragging the frame moves its members with it', async () => {
    const before = await app.doc();
    const pos = (d: typeof before, t: string) => d.nodes.find((n) => n.title === t || n.id === t)!;
    const label = app.frame(data).locator('.wfc-frame-label');
    const from = await app.center(label);
    const pane = await app.paneBox();
    await app.drag(from, { x: from.x - 60, y: Math.min(from.y + 140, pane.y + pane.height - 300) });
    const after = await app.doc();
    const dx = pos(after, data).x - pos(before, data).x;
    const dy = pos(after, data).y - pos(before, data).y;
    expect(Math.abs(dx) + Math.abs(dy), 'the frame moved').toBeGreaterThan(40);
    for (const t of ['Postgres', 'Redis']) {
      expect(pos(after, t).x - pos(before, t).x, t + ' moved by the same x').toBe(dx);
      expect(pos(after, t).y - pos(before, t).y, t + ' moved by the same y').toBe(dy);
    }
    expect(pos(after, 'Orders API').x, 'non-members stay put').toBe(pos(before, 'Orders API').x);
    await ev.snap('frame-moved-with-members');
  });

  await test.step('Layout > Swimlanes lines the frames up as columns', async () => {
    await app.menu('menu-layout', 'layout-lanes');
    await page.waitForTimeout(900);
    const d = await app.doc();
    const [a, b] = [d.nodes.find((n) => n.id === clients)!, d.nodes.find((n) => n.id === data)!].sort((p, q) => p.x - q.x);
    expect(a.y, 'lanes share a top edge').toBe(b.y);
    expect(a.height, 'lanes share a height').toBe(b.height);
    expect(a.x + a.width, 'lanes do not overlap').toBeLessThanOrEqual(b.x);
    for (const m of d.nodes.filter((n) => n.frameId)) {
      const f = d.nodes.find((n) => n.id === m.frameId)!;
      expect(m.x >= f.x && m.x + m.width <= f.x + f.width && m.y >= f.y && m.y + m.height <= f.y + f.height, m.title + ' sits inside its lane').toBe(true);
    }
    const sa = await app.box(app.frame(a.id));
    const sb = await app.box(app.frame(b.id));
    expect(Math.abs(sa.y - sb.y), 'lanes are aligned on screen').toBeLessThan(2);
    expect(sa.x + sa.width, 'lanes are side by side on screen').toBeLessThanOrEqual(sb.x + 1);
    await ev.snap('swimlanes');
  });
});
