import { test, expect } from '../support/journey';

test('quick-edit a node in a popover beside it', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: the quick-edit popover is a mouse feature. On a phone a double-tap on a topic still opens the inline editor and no popover appears; an AI agent asking for the popover (set_ui quickEditNodeId) only selects the topic, and Style in the selection bar still opens the inspector drawer. Ergonomics are checked.');
  const docId = await app.newDoc('Quick edit');
  await app.tool('add_nodes', { documentId: docId, nodes: [{ id: 'pay', title: 'Payments API', x: 0, y: 0 }, { id: 'ledger', title: 'Ledger', x: 0, y: 220 }] });
  await app.open(docId);
  await phone.fit();
  const pop = page.getByTestId('node-popover');

  await test.step('a double-tap on a topic opens the inline editor, not the popover', async () => {
    await phone.doubleTap(await phone.grab(app.topic('Payments API')));
    await expect(app.editor(), 'double-tap edits the text inline').toBeVisible();
    await expect(pop, 'no quick-edit popover on a phone').toHaveCount(0);
    await ev.snap('double-tap-inline-editor');
    await page.keyboard.press('Escape');
    await expect(app.editor()).toHaveCount(0);
  });

  await test.step('set_ui quickEditNodeId only selects the topic; Style opens the inspector drawer', async () => {
    await app.tool('set_ui', { documentId: docId, quickEditNodeId: 'ledger' });
    await expect.poll(async () => (await app.selection()).nodes, 'the AI request selects the topic').toEqual(['ledger']);
    await expect(pop, 'no popover on a phone').toHaveCount(0);
    await phone.ergonomics('topic selected by the AI');
    await phone.sel('sel-style');
    await expect(phone.slot('inspector'), 'Style opens the inspector drawer').toHaveClass(/shown/);
    await expect(page.getByTestId('insp-title')).toHaveValue('Ledger');
    await ev.snap('style-opens-drawer');
  });
});
