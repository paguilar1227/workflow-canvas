import { test, expect } from '../support/journey';

test('manage documents and keep work after a reload', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: in the outline drawer a person creates canvases from the Architecture, Workflow and Mind map templates (the drawer closes to show each new canvas), renames one from the title bar, adds a topic with the selection bar, duplicates it and deletes the copy with the always-visible 44px row buttons (confirm dialog), switches back to the original by tapping its row and keeps editing, and after a reload everything is still there. Ergonomics are checked throughout; the outline behaves as a drawer.');
  const homeId = await app.newDoc('Docs home');
  await app.open(homeId);
  const openedFrom = async (testId: string, title: string) => {
    const before = (await app.state()).docId;
    await phone.openDrawer('outline');
    await phone.tap(page.getByTestId('new-doc'));
    await phone.tap(page.getByTestId(testId));
    await expect.poll(async () => { const s = await app.state(); return s.docId !== before && s.doc?.id === s.docId ? s.doc?.title : null; }).toBe(title);
    await expect(phone.slot('outline'), 'the drawer closes to show the new canvas').toHaveCount(0);
    await app.settled();
    await page.waitForTimeout(400);
    return (await app.state()).docId!;
  };

  await test.step('create canvases from templates', async () => {
    await phone.openDrawer('outline');
    await phone.tap(page.getByTestId('new-doc'));
    await expect(page.getByTestId('new-architecture')).toBeVisible();
    await phone.ergonomics('new-document menu');
    await ev.snap('new-document-menu');
    await phone.tap(page.getByTestId('outline').locator('.panel-title'));
    await expect(page.getByTestId('new-architecture'), 'tapping elsewhere in the drawer dismisses the menu').toBeHidden();
    await phone.closeDrawer('outline');
    const arch = await openedFrom('new-architecture', 'New architecture');
    for (const t of ['Clients', 'Services', 'Data']) await expect(page.locator('.wfc-frame-label', { hasText: t })).toBeVisible();
    await phone.ergonomics('architecture template');
    await ev.snap('architecture-template');
    await phone.openDrawer('outline');
    await expect(page.getByTestId('doc-' + arch)).toHaveClass(/active/);
    await phone.closeDrawer('outline');
    await openedFrom('new-workflow', 'New workflow');
    expect((await app.doc()).nodes.length, 'the workflow template has steps').toBeGreaterThan(1);
    await ev.snap('workflow-template');
  });

  let orig = '';
  await test.step('create a mind map, rename it and add a topic', async () => {
    orig = await openedFrom('new-mindmap', 'New mind map');
    await expect(app.topic('Central topic')).toBeVisible();
    const title = page.getByTestId('doc-title');
    await title.tap();
    await title.fill('Team offsite');
    await title.press('Enter');
    await expect.poll(async () => (await app.tool<{ title: string }>('get_document', { documentId: orig, format: 'json' })).title).toBe('Team offsite');
    await phone.selectTopic('Central topic');
    await phone.sel('sel-child');
    await app.type('Venue');
    await expect(app.topic('Venue')).toBeVisible();
    await phone.ergonomics('renamed and edited');
    await ev.snap('renamed-and-edited');
    await phone.openDrawer('outline');
    await expect(page.getByTestId('doc-' + orig)).toContainText('Team offsite');
  });

  let copy = '';
  await test.step('duplicate the document', async () => {
    await phone.ergonomics('documents list');
    await ev.snap('documents-list');
    await phone.tap(page.getByTestId('doc-' + orig).getByRole('button', { name: 'Duplicate Team offsite', exact: true }));
    await expect.poll(async () => (await app.state()).doc?.title).toBe('Team offsite (copy)');
    copy = (await app.state()).docId!;
    expect(copy).not.toBe(orig);
    await expect(page.getByTestId('doc-' + copy)).toHaveClass(/active/);
    if (await phone.slot('outline').count()) await phone.closeDrawer('outline');
    await expect(app.topic('Venue'), 'the copy has the same content').toBeVisible();
    await ev.snap('duplicated');
  });

  await test.step('delete the copy after confirming', async () => {
    let message = '';
    page.once('dialog', (d) => { message = d.message(); d.accept(); });
    await phone.openDrawer('outline');
    await phone.tap(page.getByTestId('doc-' + copy).getByRole('button', { name: 'Delete Team offsite (copy)', exact: true }));
    await expect(page.getByTestId('doc-' + copy)).toHaveCount(0);
    expect(message).toContain('Delete "Team offsite (copy)"?');
    const list = await app.tool<{ documents: { id: string }[] }>('list_documents');
    expect(list.documents.map((d) => d.id)).not.toContain(copy);
    await expect.poll(async () => (await app.state()).docId, 'the UI leaves the deleted document').not.toBe(copy);
    await ev.snap('copy-deleted');
  });

  await test.step('switch back to the original and keep editing', async () => {
    if (!(await phone.slot('outline').count())) await phone.openDrawer('outline');
    await phone.tap(page.getByTestId('doc-' + orig));
    await app.waitForDoc(orig);
    await expect(phone.slot('outline'), 'tapping a document closes the drawer').toHaveCount(0);
    await expect(page.getByTestId('doc-title')).toHaveValue('Team offsite');
    await phone.selectTopic('Central topic');
    await phone.sel('sel-child');
    await app.type('Catering');
    const saved = await app.tool<{ nodes: { title: string }[] }>('get_document', { documentId: orig, format: 'json' });
    expect(saved.nodes.map((n) => n.title), 'the edit landed in the open document').toEqual(expect.arrayContaining(['Venue', 'Catering']));
  });

  await test.step('reload: everything is still there', async () => {
    await page.reload();
    await app.waitForDoc(orig);
    await expect(page.getByTestId('doc-title')).toHaveValue('Team offsite');
    for (const t of ['Central topic', 'Venue', 'Catering']) await expect(app.topic(t)).toBeVisible();
    await phone.ergonomics('after reload');
    await ev.snap('after-reload');
    await phone.openDrawer('outline');
    await expect(page.getByTestId('doc-' + orig)).toContainText('Team offsite');
    await expect(page.getByTestId('doc-' + copy)).toHaveCount(0);
    await phone.closeDrawer('outline');
  });

  await test.step('the outline behaves like a drawer', async () => {
    await phone.checkDrawer('outline', () => phone.tap(page.getByTestId('toggle-outline')));
  });
});
