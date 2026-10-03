import { test, expect } from '../support/journey';

test('an AI client works over the API safely and predictably', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: while a person has a canvas open on a phone, an AI client\'s impossible requests fail clearly and change nothing on screen; the AI\'s additions, renames, recolours, connectors and deletions appear on the phone (canvas and outline drawer) as they happen; the AI reads exactly what the person selected with the Area tool, also after the AI re-opens the document and after the person switches documents in the outline drawer and back (the phone and the AI always agree). Ergonomics are checked with AI edits on screen; the outline behaves as a drawer.');
  const docId = await app.newDoc('AI API check');
  const otherId = await app.newDoc('AI API check (other)');
  await app.tool('add_nodes', { documentId: docId, nodes: [{ id: 'root', title: 'Root', x: 0, y: 0 }, { id: 'kid', title: 'Kid', parentId: 'root' }] });
  await app.open(docId);
  await phone.fit();

  await test.step('impossible requests fail clearly and change nothing on the phone', async () => {
    const before = await app.doc();
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ['reparent_node', { documentId: docId, id: 'root', parentId: 'kid' }, /descendant/],
      ['update_nodes', { documentId: docId, updates: [{ id: 'root', parentId: 'kid' }] }, /descendant/],
      ['delete_nodes', { documentId: docId, ids: ['nope'] }, /Unknown node ids/],
      ['delete_edges', { documentId: docId, ids: ['nope'] }, /Unknown edge ids/],
      ['set_ui', { documentId: docId, editNodeId: 'nope' }, /Unknown node ids/],
    ];
    for (const [name, args, message] of cases) {
      const body = await (await page.request.post('/api/tools/' + name, { data: args })).json();
      expect(body.ok, name + ' should fail').toBe(false);
      expect(body.error, name).toMatch(message);
    }
    await page.waitForTimeout(500);
    await app.settled();
    expect((await app.doc()).nodes, 'the phone shows the same document').toEqual(before.nodes);
    for (const t of ['Root', 'Kid']) await expect(app.topic(t)).toBeVisible();
    await expect(app.editor(), 'no editor opened for an unknown node').toHaveCount(0);
    await phone.ergonomics('after refused AI requests');
    await ev.snap('refused-requests-change-nothing');
  });

  await test.step('AI edits appear on the phone as they happen', async () => {
    await app.tool('add_nodes', { documentId: docId, nodes: [{ id: 'ai-step', title: 'Added by AI', parentId: 'root' }] });
    await expect(app.topic('Added by AI'), 'an AI addition appears').toHaveCount(1);
    await phone.fit();
    await expect(app.topic('Added by AI')).toBeVisible();
    await ev.snap('ai-added-a-topic');

    await app.tool('update_nodes', { documentId: docId, updates: [{ id: 'ai-step', title: 'Renamed by AI', color: 'green' }] });
    await expect(app.topic('Renamed by AI'), 'an AI rename appears').toBeVisible();
    await expect(app.topic('Added by AI')).toHaveCount(0);
    await expect(app.node('ai-step'), 'an AI recolour appears').toHaveAttribute('style', /--c-green/);

    await app.tool('add_edges', { documentId: docId, edges: [{ id: 'ai-edge', source: 'kid', target: 'ai-step', label: 'feeds' }] });
    await expect(app.edge('ai-edge'), 'an AI connector appears').toHaveCount(1);
    await expect(page.getByTestId('edge-label-ai-edge')).toHaveText('feeds');
    await phone.fit();
    await phone.ergonomics('AI edits on screen');
    await ev.snap('ai-renamed-recoloured-and-connected');

    await phone.openDrawer('outline');
    await expect(page.getByTestId('outline-ai-step'), 'the outline drawer lists the AI topic').toContainText('Renamed by AI');
    await app.tool('update_nodes', { documentId: docId, updates: [{ id: 'ai-step', title: 'Renamed again' }] });
    await expect(page.getByTestId('outline-ai-step'), 'the open drawer follows AI edits').toContainText('Renamed again');
    await ev.snap('outline-drawer-follows-ai');
    await phone.closeDrawer('outline');

    await app.tool('delete_nodes', { documentId: docId, ids: ['ai-step'] });
    await expect(app.node('ai-step'), 'an AI deletion disappears').toHaveCount(0);
    await expect(app.edge('ai-edge'), 'with its connector').toHaveCount(0);
    for (const t of ['Root', 'Kid']) await expect(app.topic(t)).toBeVisible();
    await ev.snap('ai-deleted-the-topic');
  });

  await test.step('the AI reads the person\'s selection, also after re-opening the document', async () => {
    await phone.fit();
    const boxes = [await app.box(app.node('root')), await app.box(app.node('kid'))];
    await phone.areaSelect(
      { x: Math.min(...boxes.map((b) => b.x)) - 14, y: Math.min(...boxes.map((b) => b.y)) - 14 },
      { x: Math.max(...boxes.map((b) => b.x + b.width)) + 14, y: Math.max(...boxes.map((b) => b.y + b.height)) + 14 },
    );
    const selected = async () => [...((await app.tool('get_canvas_state')).session.selections?.[docId]?.nodes ?? [])].sort();
    await expect.poll(selected).toEqual(['kid', 'root']);
    await app.tool('open_document', { documentId: docId });
    await page.waitForTimeout(600);
    expect(await selected()).toEqual(['kid', 'root']);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    await phone.ergonomics('selection read by the AI');
    await ev.snap('selection-read-by-ai');

    await phone.openDrawer('outline');
    await phone.tap(page.getByTestId('doc-' + otherId));
    await app.waitForDoc(otherId);
    await expect(phone.slot('outline'), 'the drawer closes to show the other canvas').toHaveCount(0);
    await phone.openDrawer('outline');
    await phone.tap(page.getByTestId('doc-' + docId));
    await app.waitForDoc(docId);
    await page.waitForTimeout(600);
    const shown = await page.locator('.react-flow__node.selected .wfc-node').evaluateAll((els) => els.map((e) => e.getAttribute('data-title')).sort());
    expect(shown, 'the phone shows the stored selection after switching back').toEqual(['Kid', 'Root']);
    expect(await selected(), 'the AI reads the same selection the phone shows').toEqual(['kid', 'root']);
    await ev.snap('selection-after-switching-away-and-back');
  });

  await test.step('the outline behaves like a drawer', async () => {
    await phone.checkDrawer('outline', () => phone.tap(page.getByTestId('toggle-outline')));
  });

  await app.tool('delete_document', { documentId: docId });
  await app.tool('delete_document', { documentId: otherId });
});

