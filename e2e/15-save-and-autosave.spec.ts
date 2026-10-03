import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './support/journey';
import { CONTENT, FILE, roundTripDiffs, titleIn } from './support/save-file';

/**
 * Runs in Google Chrome, the browser autosave targets. Playwright's bundled Chromium (153) closes the page as soon
 * as a file handle is read back from IndexedDB, which is exactly what restoring autosave after a reload does.
 */
test.use({ channel: 'chrome' });

/**
 * The real save/autosave path writes through File System Access handles. The pickers are swapped for
 * Origin Private File System handles (real FileSystemFileHandle objects with createWritable), and the
 * browser permission prompt is simulated: queryPermission answers 'prompt' while the e2e-perm flag is set,
 * as Chrome does after a restart, and requestPermission is the person clicking Allow.
 */
async function stubPickers(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__pickerCalls = [];
    w.__permissionRequests = 0;
    const dir = () => navigator.storage.getDirectory();
    w.showSaveFilePicker = async (opts: any = {}) => {
      w.__pickerCalls.push({ picker: 'save', opts: JSON.parse(JSON.stringify(opts)) });
      return (await dir()).getFileHandle(opts.suggestedName ?? 'canvas.excalidraw', { create: true });
    };
    w.showOpenFilePicker = async (opts: any = {}) => {
      w.__pickerCalls.push({ picker: 'open', opts: JSON.parse(JSON.stringify(opts)) });
      return [await (await dir()).getFileHandle(localStorage.getItem('e2e-open-file') ?? 'canvas.excalidraw')];
    };
    const proto = (w.FileSystemHandle ?? w.FileSystemFileHandle).prototype;
    const nativeQuery = proto.queryPermission;
    proto.queryPermission = async function (o: unknown) {
      if (localStorage.getItem('e2e-perm') === 'prompt') return 'prompt';
      return nativeQuery ? nativeQuery.call(this, o) : 'granted';
    };
    proto.requestPermission = async function () {
      w.__permissionRequests++;
      localStorage.removeItem('e2e-perm');
      return 'granted';
    };
  });
}

const readFile = (page: Page, name = FILE) => page.evaluate(async (n) => {
  try { return await (await (await (await navigator.storage.getDirectory()).getFileHandle(n)).getFile()).text(); } catch { return null; }
}, name);

test('save to a file and keep it autosaved', async ({ page, app, ev, browser, baseURL }) => {
  ev.proves('A person presses Save, picks where the .excalidraw file goes (the save dialog asks for the Excalidraw type), and the file on disk is a valid Excalidraw scene that reads back losslessly; their own edits and AI/API edits are autosaved to it; save_to_file reports the file (and explains when no file is attached or autosave is paused, including right after an edit while another write is running); after a reload autosave resumes by itself, and when the browser asks for permission again one click on "Resume autosave" catches the file up; File > Open recreates the document from the file.');
  await stubPickers(page);
  const docId = await app.newDoc('Release plan');
  await app.tool('import_content', { documentId: docId, format: 'json', mode: 'replace', content: JSON.stringify(CONTENT) });
  await app.open(docId);
  await app.fit();
  const save = page.getByTestId('save-file');
  const keepFile = async (label: string) => {
    const text = await readFile(page);
    const file = path.join(ev.dir, 'downloads', label + '.excalidraw');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text ?? '');
    return text;
  };

  await test.step('without a file, save_to_file says the person has to press Save first', async () => {
    await expect(save).toHaveAttribute('data-state', 'none');
    await expect(save).toHaveText('Save');
    const res = await app.tool('save_to_file', { documentId: docId });
    expect(res.ok, 'nothing to save to yet').toBe(false);
    expect(res.ui.ok).toBe(false);
    expect(res.ui.reason, 'the AI is told why').toMatch(/press Save/);
    expect(await readFile(page), 'no file exists yet').toBeNull();
    await ev.snap('not-saved-yet');
  });

  await test.step('Save opens the picker for an .excalidraw file and writes it', async () => {
    await save.click();
    await expect(save).toHaveAttribute('data-state', 'saved');
    await expect(save).toHaveText('Saved');
    await expect(page.getByTestId('toast')).toContainText('Saved to ' + FILE);
    const calls = await page.evaluate(() => (window as any).__pickerCalls);
    expect(calls, 'the save dialog opened once').toHaveLength(1);
    expect(calls[0].picker).toBe('save');
    expect(calls[0].opts.suggestedName).toBe(FILE);
    expect(calls[0].opts.types[0].accept['application/vnd.excalidraw+json'], 'the dialog offers the Excalidraw type').toEqual(['.excalidraw']);
    await ev.snap('saved-with-autosave-on');
  });

  await test.step('the file is an Excalidraw scene that reads back losslessly', async () => {
    const text = await keepFile('01-first-save');
    expect(text, 'the file was written').toBeTruthy();
    const scene = JSON.parse(text!);
    expect(scene.type).toBe('excalidraw');
    expect(Array.isArray(scene.elements) && scene.elements.length > 0, 'the scene has elements').toBe(true);
    expect(await roundTripDiffs(app, text!), 'every node and edge field survives the file').toEqual([]);
  });

  await test.step('an edit in the UI autosaves', async () => {
    await app.topic('Gate').click();
    await page.keyboard.press('F2');
    await app.type('Ship gate');
    await expect.poll(async () => titleIn(await readFile(page), 'hex'), 'the rename reached the file').toBe('Ship gate');
    await expect(save).toHaveAttribute('data-state', 'saved');
    await ev.snap('ui-edit-autosaved');
  });

  await test.step('an AI/API edit autosaves', async () => {
    await app.tool('update_nodes', { documentId: docId, updates: [{ id: 'dia', title: 'Go / no-go?', color: 'red' }] });
    await app.tool('add_nodes', { documentId: docId, nodes: [{ id: 'ai-note', kind: 'sticky', title: 'Added by the AI', x: 1100, y: 40 }] });
    await expect.poll(async () => titleIn(await readFile(page), 'ai-note'), 'the AI-added sticky reached the file').toBe('Added by the AI');
    const text = await keepFile('02-after-ui-and-ai-edits');
    expect(titleIn(text, 'dia')).toBe('Go / no-go?');
    expect(await roundTripDiffs(app, text!), 'the autosaved file still matches the document exactly').toEqual([]);
    await ev.snap('ai-edit-autosaved');
  });

  await test.step('save_to_file reports the file, also right after each edit', async () => {
    const res = await app.tool('save_to_file', { documentId: docId });
    expect(res.ok).toBe(true);
    expect(res.ui).toMatchObject({ ok: true, file: FILE, autosave: true });
    const failures: string[] = [];
    for (let i = 0; i < 20; i++) {
      await app.tool('update_nodes', { documentId: docId, updates: [{ id: 'tx', title: 'Edit ' + i }] });
      const r = await app.tool('save_to_file', { documentId: docId });
      if (r.ok !== true || r.ui?.file !== FILE) failures.push(i + ': ' + JSON.stringify(r));
      await page.waitForTimeout(300);
    }
    expect(failures, 'every save_to_file straight after an edit succeeds (regression: ok:false while an autosave was writing)').toEqual([]);
    expect(titleIn(await keepFile('03-after-20-edit-and-save'), 'tx'), 'the file holds the last edit').toBe('Edit 19');
  });

  await test.step('with three tabs on one document, save_to_file writes through the tab that has the file', async () => {
    const sharedId = (await app.tool<{ documentId: string }>('create_document', { title: 'Three tabs', template: 'workflow', open: false })).documentId;
    const sharedFile = 'Three tabs.excalidraw';
    const tabs: Page[] = [];
    for (let i = 0; i < 3; i++) {
      const tab = await (await browser.newContext({ baseURL })).newPage();
      if (i === 0) await stubPickers(tab);
      await tab.goto('/?doc=' + sharedId + '&pin=1');
      await tab.waitForFunction((id) => (window as any).__wfc?.state().doc?.id === id, sharedId);
      tabs.push(tab);
    }
    const [fileTab, ...otherTabs] = tabs;
    await fileTab.getByTestId('save-file').click();
    await expect(fileTab.getByTestId('save-file'), 'one tab attaches the file').toHaveAttribute('data-state', 'saved');
    for (const tab of otherTabs) await expect(tab.getByTestId('save-file'), 'the other tabs have no file').toHaveAttribute('data-state', 'none');
    const failures: string[] = [];
    for (let i = 0; i < 10; i++) {
      await app.tool('update_nodes', { documentId: sharedId, updates: [{ id: 'step-1', title: 'Three tabs ' + i }] });
      const r = await app.tool('save_to_file', { documentId: sharedId });
      if (r.ok !== true || r.ui?.file !== sharedFile) failures.push(i + ': ' + JSON.stringify(r));
    }
    expect(failures, 'every save_to_file reaches the tab that has the file').toEqual([]);
    expect(titleIn(await readFile(fileTab, sharedFile), 'step-1'), 'the file holds the last edit').toBe('Three tabs 9');
    await fileTab.context().close();
    const after = await app.tool('save_to_file', { documentId: sharedId });
    expect(after.ok, 'with the file tab closed nothing is written').toBe(false);
    expect(after.ui?.reason, 'the AI is told the person has to press Save').toMatch(/press Save/);
    for (const tab of otherTabs) await tab.context().close();
    await app.tool('delete_document', { documentId: sharedId });
  });

  await test.step('after a reload autosave resumes by itself', async () => {
    await page.reload();
    await app.waitForDoc(docId);
    await expect(save).toHaveAttribute('data-state', 'saved');
    await expect(save).toHaveAttribute('title', new RegExp('Autosaving to ' + FILE));
    await app.tool('update_nodes', { documentId: docId, updates: [{ id: 'circ', title: 'Shipped' }] });
    await expect.poll(async () => titleIn(await readFile(page), 'circ'), 'edits after the reload still reach the file').toBe('Shipped');
    await ev.snap('resumed-after-reload');
  });

  await test.step('when the browser asks again, autosave pauses and one click resumes it', async () => {
    await page.evaluate(() => localStorage.setItem('e2e-perm', 'prompt'));
    await page.reload();
    await app.waitForDoc(docId);
    await expect(save).toHaveAttribute('data-state', 'paused');
    await expect(save).toHaveText('Resume autosave');
    await app.tool('update_nodes', { documentId: docId, updates: [{ id: 'st', title: 'Edited while paused' }] });
    await expect.poll(async () => (await app.nodeNamed('Edited while paused')).id).toBe('st');
    const res = await app.tool('save_to_file', { documentId: docId });
    expect(res.ok, 'a paused file is not written').toBe(false);
    expect(res.ui.file).toBe(FILE);
    expect(res.ui.reason).toMatch(/paused until the person clicks Save/);
    expect(titleIn(await readFile(page), 'st'), 'the paused edit is not on disk yet').toBe('Remember the risk');
    await ev.snap('paused-after-reload');
    await save.click();
    await expect(save).toHaveAttribute('data-state', 'saved');
    expect(await page.evaluate(() => (window as any).__permissionRequests), 'clicking asked the browser for permission').toBe(1);
    await expect.poll(async () => titleIn(await readFile(page), 'st'), 'the click caught the file up').toBe('Edited while paused');
    await ev.snap('resumed-by-click');
  });

  await test.step('File > Open recreates the document from the file', async () => {
    const text = await keepFile('04-opened');
    const before = (await app.state()).documents.length;
    await page.evaluate((f) => localStorage.setItem('e2e-open-file', f), FILE);
    await app.menu('menu-export', 'file-open');
    await expect.poll(async () => (await app.state()).documents.length, 'a new document was created').toBe(before + 1);
    await expect.poll(async () => (await app.state()).docId).not.toBe(docId);
    const opened = (await app.state()).docId!;
    await app.waitForDoc(opened);
    await expect(page.getByTestId('toast')).toContainText('Opened ' + FILE);
    const calls = await page.evaluate(() => (window as any).__pickerCalls);
    expect(calls.at(-1).picker).toBe('open');
    expect(calls.at(-1).opts.types[0].accept['application/vnd.excalidraw+json']).toContain('.excalidraw');
    await expect.poll(async () => (await app.doc()).nodes.length).toBe(CONTENT.nodes.length + 1);
    expect((await app.doc()).title).toBe('Release plan');
    expect(await roundTripDiffs(app, text!), 'the opened document equals the file').toEqual([]);
    await expect(save, 'the opened document autosaves back to its file').toHaveAttribute('data-state', 'saved');
    await app.fit();
    await ev.snap('opened-from-file');
  });
});
