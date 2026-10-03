import { test, expect } from '../support/journey';

test('organize a diagram with frames and swimlanes', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: instead of Shift+click and Cmd+G, a person Area-selects two topics and taps Frame in the selection bar, then names the frame. They add an empty frame with the toolbar Frame button and a tap, drag topics into it with one finger, drag the frame (its members move with it), and line the frames up as swimlanes from the More sheet. Ergonomics are checked throughout; the outline drawer behaves as a drawer.');
  const docId = await app.newDoc('Checkout architecture');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { title: 'Web app', x: 0, y: 0 }, { title: 'Mobile app', x: 0, y: 140 },
    { title: 'Orders API', x: 960, y: -40 }, { title: 'Postgres', x: 960, y: 140 }, { title: 'Redis', x: 960, y: 300 },
  ] });
  await app.open(docId);
  await phone.fit();
  await phone.ergonomics('loose topics');
  await ev.snap('loose-topics');
  let clients = '';
  let data = '';

  await test.step('Area-select two topics and tap Frame in the selection bar', async () => {
    const [w, m] = [await app.box(app.topic('Web app')), await app.box(app.topic('Mobile app'))];
    await phone.areaSelect({ x: w.x - 12, y: w.y - 12 }, { x: Math.max(w.x + w.width, m.x + m.width) + 12, y: m.y + m.height + 12 });
    await expect.poll(async () => (await app.selection()).nodes.length, 'Area selected both topics').toBe(2);
    await phone.sel('sel-frame');
    await app.type('Clients');
    const d = await app.doc();
    clients = d.nodes.find((n) => n.kind === 'frame' && n.title === 'Clients')?.id ?? '';
    expect(clients, 'a frame named Clients exists').toBeTruthy();
    for (const t of ['Web app', 'Mobile app']) expect(d.nodes.find((n) => n.title === t)!.frameId, t + ' is a member of Clients').toBe(clients);
    await ev.snap('selection-framed');
  });

  await test.step('the toolbar Frame button and a tap add an empty frame', async () => {
    await phone.tap(await app.emptyPoint({ x: 0.5, y: 0.1 }));
    const before = (await app.doc()).nodes.filter((n) => n.kind === 'frame').length;
    await phone.place('add-frame', await app.emptyPoint({ x: 0.5, y: 0.75 }));
    if (await app.editor().isVisible()) await app.type('Data');
    else { await phone.sel('sel-edit'); await page.keyboard.press('ControlOrMeta+a'); await app.type('Data'); }
    const frames = (await app.doc()).nodes.filter((n) => n.kind === 'frame');
    expect(frames.length).toBe(before + 1);
    data = frames.find((n) => n.title === 'Data')!.id;
    await expect(app.frame(data)).toBeVisible();
    await ev.snap('empty-frame-added');
  });

  await test.step('dragging topics into the frame with one finger makes them members', async () => {
    for (const t of ['Orders API', 'Postgres']) {
      await phone.fit();
      const f = await app.box(app.frame(data));
      const from = await phone.grab(app.topic(t));
      const target = { x: f.x + f.width / 2, y: f.y + f.height * (t === 'Orders API' ? 0.4 : 0.7) };
      await phone.drag(from, target, 24);
      await expect.poll(async () => (await app.nodeNamed(t)).frameId, t + ' joins the Data frame').toBe(data);
    }
    await phone.ergonomics('frames');
    await ev.snap('topics-dragged-into-frame');
  });

  await test.step('dragging the frame moves its members with it', async () => {
    await phone.fit();
    const [f0, m0] = [(await app.doc()).nodes.find((n) => n.id === data)!, await app.nodeNamed('Postgres')];
    const fb = await app.box(app.frame(data));
    const grip = { x: fb.x + fb.width / 2, y: fb.y + 10 };
    await phone.drag(grip, { x: grip.x, y: grip.y + 60 }, 20);
    const [f1, m1] = [(await app.doc()).nodes.find((n) => n.id === data)!, await app.nodeNamed('Postgres')];
    expect(f1.y - f0.y, 'the frame moved').toBeGreaterThan(20);
    expect(Math.round(m1.y - m0.y), 'its member moved by the same amount').toBe(Math.round(f1.y - f0.y));
    await ev.snap('frame-dragged-with-members');
  });

  await test.step('More › Swimlanes lines the frames up as columns', async () => {
    await phone.more('layout-lanes');
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
    await phone.fit();
    await phone.ergonomics('swimlanes');
    await ev.snap('swimlanes');
  });

  await test.step('the outline drawer behaves like a drawer', async () => {
    await phone.checkDrawer('outline', () => phone.tap(page.getByTestId('toggle-outline')));
  });
});
