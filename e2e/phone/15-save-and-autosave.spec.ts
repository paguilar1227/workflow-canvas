import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../support/journey';
import { CONTENT, FILE, roundTripDiffs, titleIn } from '../support/save-file';

test('save to a file and keep it autosaved', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: phone browsers cannot write files (iOS Safari and Android Chrome have no File System Access pickers; emulated by removing them), so the top-bar Save button says autosave needs Chrome or Edge and tapping it downloads a .excalidraw copy that reads back losslessly; edits by the person and the AI trigger no downloads and are in the next copy (More › Save); save_to_file tells the AI truthfully that this browser cannot write files and how the person gets a copy; More › Open .excalidraw… recreates the document from the downloaded file. Ergonomics are checked; the outline behaves as a drawer.');
  await page.addInitScript(() => {
    for (const name of ['showSaveFilePicker', 'showOpenFilePicker']) {
      delete (window as any)[name];
      if (typeof (window as any)[name] === 'function') Object.defineProperty(window, name, { value: undefined, configurable: true });
    }
  });
  const docId = await app.newDoc('Release plan');
  await app.tool('import_content', { documentId: docId, format: 'json', mode: 'replace', content: JSON.stringify(CONTENT) });
  await app.open(docId);
  await phone.fit();
  const save = page.getByTestId('save-file');
  let downloads = 0;
  page.on('download', () => downloads++);
  /** Run the action, take the .excalidraw it downloads and keep a copy with the evidence. */
  const download = async (label: string, act: () => Promise<void>) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), act()]);
    expect(dl.suggestedFilename(), 'the copy is named after the document').toBe(FILE);
    const file = path.join(ev.dir, 'downloads', label + '.excalidraw');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await dl.saveAs(file);
    return { file, text: fs.readFileSync(file, 'utf8') };
  };

  await test.step('the Save button says this browser downloads instead of autosaving', async () => {
    expect(await page.evaluate(() => typeof (window as any).showSaveFilePicker), 'no file picker, as on a real phone').toBe('undefined');
    await expect(save).toHaveAttribute('data-state', 'unsupported');
    await expect(save).toHaveText('Save');
    await expect(save).toHaveAttribute('title', /Autosave to a file needs Chrome or Edge/);
    await phone.ergonomics('top bar with Save');
    await ev.snap('save-button-on-a-phone');
  });

  await test.step('save_to_file tells the AI this browser cannot write files', async () => {
    const res = await app.tool('save_to_file', { documentId: docId });
    expect(res.ok, 'nothing is written').toBe(false);
    expect(res.ui.ok).toBe(false);
    expect(res.ui.reason, 'the AI is told why and what the person can do').toMatch(/cannot write files.*download a copy/);
  });

  let first = { file: '', text: '' };
  await test.step('tapping Save downloads an Excalidraw copy that reads back losslessly', async () => {
    first = await download('01-first-download', () => phone.tap(save));
    await expect(page.getByTestId('toast')).toContainText('Downloaded a copy');
    const scene = JSON.parse(first.text);
    expect(scene.type).toBe('excalidraw');
    expect(Array.isArray(scene.elements) && scene.elements.length > 0, 'the scene has elements').toBe(true);
    expect(await roundTripDiffs(app, first.text), 'every node and edge field survives the file').toEqual([]);
    await expect(save, 'no file is attached afterwards').toHaveAttribute('data-state', 'unsupported');
    await ev.snap('downloaded-a-copy');
  });

  await test.step('edits trigger no downloads and are in the next copy', async () => {
    await phone.selectTopic('Gate');
    await phone.sel('sel-edit');
    await page.keyboard.press('ControlOrMeta+a');
    await app.type('Ship gate');
    await app.tool('update_nodes', { documentId: docId, updates: [{ id: 'dia', title: 'Go / no-go?', color: 'red' }] });
    await app.tool('add_nodes', { documentId: docId, nodes: [{ id: 'ai-note', kind: 'sticky', title: 'Added by the AI', x: 1100, y: 40 }] });
    await expect(app.node('ai-note')).toHaveCount(1);
    await app.settled();
    await page.waitForTimeout(800);
    expect(downloads, 'edits do not download anything by themselves').toBe(1);
    const second = await download('02-after-ui-and-ai-edits', () => phone.more('file-save'));
    expect(titleIn(second.text, 'hex'), 'the person\'s rename is in the copy').toBe('Ship gate');
    expect(titleIn(second.text, 'dia'), 'the AI\'s rename is in the copy').toBe('Go / no-go?');
    expect(titleIn(second.text, 'ai-note'), 'the AI\'s sticky is in the copy').toBe('Added by the AI');
    expect(await roundTripDiffs(app, second.text), 'the copy matches the document exactly').toEqual([]);
    first = second;
    await ev.snap('edited-and-downloaded-again');
  });

  await test.step('More › Open .excalidraw… recreates the document from the downloaded file', async () => {
    const before = (await app.state()).documents.length;
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), phone.more('file-open')]);
    await chooser.setFiles(first.file);
    await expect(page.getByTestId('toast')).toContainText('Opened ' + path.basename(first.file) + ' (this browser cannot autosave back to it)');
    await expect.poll(async () => (await app.state()).documents.length, 'a new document was created').toBe(before + 1);
    await expect.poll(async () => (await app.state()).docId).not.toBe(docId);
    const opened = (await app.state()).docId!;
    await app.waitForDoc(opened);
    await expect.poll(async () => (await app.doc()).nodes.length).toBe(CONTENT.nodes.length + 1);
    expect((await app.doc()).title).toBe('Release plan');
    expect(await roundTripDiffs(app, first.text), 'the opened document equals the file').toEqual([]);
    await expect(save, 'the opened document offers downloads, not autosave').toHaveAttribute('data-state', 'unsupported');
    await phone.fit();
    await phone.ergonomics('opened from the file');
    await ev.snap('opened-from-file');
    await app.tool('delete_document', { documentId: opened });
  });

  await test.step('the outline behaves like a drawer', async () => {
    await app.open(docId);
    await phone.checkDrawer('outline', () => phone.tap(page.getByTestId('toggle-outline')));
  });
});
