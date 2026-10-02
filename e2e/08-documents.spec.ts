import { test, expect } from './support/journey';

test('manage documents and keep work after a reload', async ({ page, app, ev }) => {
  ev.proves('A user creates canvases from the Architecture, Workflow and Mind map templates in the Documents panel, renames one from the title bar, edits it, duplicates it, deletes the copy through the confirm dialog, switches back to the original and keeps editing (edits land in the open document), and after a page reload every change is still there.');
  const homeId = await app.newDoc('Docs home');
  await app.open(homeId);
  const openedFrom = async (testId: string, title: string) => {
    const before = (await app.state()).docId;
    await page.getByTestId('new-doc').click();
    await page.getByTestId(testId).click();
    await expect.poll(async () => { const s = await app.state(); return s.docId !== before && s.doc?.id === s.docId ? s.doc?.title : null; }).toBe(title);
    await app.settled();
    await page.waitForTimeout(400);
    return (await app.state()).docId!;
  };

  await test.step('create canvases from templates', async () => {
    const arch = await openedFrom('new-architecture', 'New architecture');
    for (const t of ['Clients', 'Services', 'Data']) await expect(page.locator('.wfc-frame-label', { hasText: t })).toBeVisible();
    await expect(page.getByTestId('doc-' + arch)).toHaveClass(/active/);
    await ev.snap('architecture-template');
    await openedFrom('new-workflow', 'New workflow');
    expect((await app.doc()).nodes.length, 'the workflow template has steps').toBeGreaterThan(1);
    await ev.snap('workflow-template');
  });

  let orig = '';
  await test.step('create a mind map, rename it and add a topic', async () => {
    orig = await openedFrom('new-mindmap', 'New mind map');
    await expect(app.topic('Central topic')).toBeVisible();
    const title = page.getByTestId('doc-title');
    await title.click();
    await title.fill('Team offsite');
    await title.press('Enter');
    await expect(page.getByTestId('doc-' + orig)).toContainText('Team offsite');
    await expect.poll(async () => (await app.tool<{ title: string }>('get_document', { documentId: orig, format: 'json' })).title).toBe('Team offsite');
    await app.topic('Central topic').click();
    await page.keyboard.press('Tab');
    await app.type('Venue');
    await expect(app.topic('Venue')).toBeVisible();
    await ev.snap('renamed-and-edited');
  });

  let copy = '';
  await test.step('duplicate the document', async () => {
    await page.getByTestId('doc-' + orig).hover();
    await page.getByRole('button', { name: 'Duplicate Team offsite', exact: true }).click();
    await expect.poll(async () => (await app.state()).doc?.title).toBe('Team offsite (copy)');
    copy = (await app.state()).docId!;
    expect(copy).not.toBe(orig);
    await expect(app.topic('Venue'), 'the copy has the same content').toBeVisible();
    await expect(page.getByTestId('doc-' + copy)).toHaveClass(/active/);
    await ev.snap('duplicated');
  });

  await test.step('delete the copy after confirming', async () => {
    let message = '';
    page.once('dialog', (d) => { message = d.message(); d.accept(); });
    await page.getByTestId('doc-' + copy).hover();
    await page.getByRole('button', { name: 'Delete Team offsite (copy)', exact: true }).click();
    await expect(page.getByTestId('doc-' + copy)).toHaveCount(0);
    expect(message).toContain('Delete "Team offsite (copy)"?');
    const list = await app.tool<{ documents: { id: string }[] }>('list_documents');
    expect(list.documents.map((d) => d.id)).not.toContain(copy);
    await expect.poll(async () => (await app.state()).docId, 'the UI leaves the deleted document').not.toBe(copy);
    await ev.snap('copy-deleted');
  });

  await test.step('switch back to the original and keep editing', async () => {
    await page.getByTestId('doc-' + orig).click();
    await app.waitForDoc(orig);
    await expect(page.getByTestId('doc-title')).toHaveValue('Team offsite');
    await app.topic('Central topic').click();
    await page.keyboard.press('Tab');
    await app.type('Catering');
    const saved = await app.tool<{ nodes: { title: string }[] }>('get_document', { documentId: orig, format: 'json' });
    expect(saved.nodes.map((n) => n.title), 'the edit landed in the open document').toEqual(expect.arrayContaining(['Venue', 'Catering']));
  });

  await test.step('reload: everything is still there', async () => {
    await page.reload();
    await app.waitForDoc(orig);
    await expect(page.getByTestId('doc-title')).toHaveValue('Team offsite');
    for (const t of ['Central topic', 'Venue', 'Catering']) await expect(app.topic(t)).toBeVisible();
    await expect(page.getByTestId('doc-' + orig)).toContainText('Team offsite');
    await expect(page.getByTestId('doc-' + copy)).toHaveCount(0);
    await ev.snap('after-reload');
  });
});
