import type { Locator } from '@playwright/test';
import { test, expect } from '../support/journey';
import { MIN_TARGET } from '../support/phone';
import { clashes, covered } from '../support/emoji';

test('write Markdown notes and add emoji', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: a person places a sticky with the toolbar and a tap and types Markdown with the on-screen keyboard: :rock offers emoji suggestions (44 px rows, drawn above the toolbar) and a tap on :rocket: inserts 🚀; :tada: converts live. Tapping the canvas saves the note, which renders as Markdown with a two-item task list; tapping a checkbox ticks that task in the saved source. Edit in the selection bar reopens the raw Markdown; the 44 px emoji button docked above the field (covering no toolbar, selection bar or other control) opens a bottom sheet with 44 px targets that inserts after the selection while the editor stays open, and closes from × or the backdrop. In the inspector drawer the docked button covers no control and Width opts out. On a checklist-only note at the fitted zoom (where a checkbox is smaller than a touch target), a tap at the centre of the unselected note lands on a task row, selects the note and ticks nothing; tapping a task\'s words then ticks that task in the saved source, and tapping a link inside a task opens it without ticking. A double-tap on a task\'s words in the unselected checklist opens its raw Markdown in the editor and ticks nothing. Ergonomics are checked on every screen.');
  const docId = await app.newDoc('Launch notes');
  await app.open(docId);
  const editor = app.editor();
  const dock = page.getByTestId('emoji-button');
  const suggest = page.getByTestId('emoji-suggest');
  const picker = page.getByTestId('emoji-picker');
  const grid = page.getByTestId('emoji-grid');
  let id = '';
  const title = async () => (await app.doc()).nodes.find((n) => n.id === id)!.title;
  const checkDock = async (field: typeof editor, where: string) => {
    await expect(dock, where + ': the emoji button docks by the focused field').toBeVisible();
    const d = await app.box(dock);
    expect(Math.min(d.width, d.height), where + ': docked button is a 44 px touch target').toBeGreaterThanOrEqual(MIN_TARGET - 0.5);
    expect(d.y + d.height, where + ': docked above the field').toBeLessThanOrEqual((await app.box(field)).y + 1);
    expect(await clashes(dock), where + ': controls and chrome under the docked emoji button').toEqual([]);
  };
  const tapCanvas = async () => {
    const p = await app.emptyPoint({ x: 0.5, y: 0.8 });
    await phone.tap(p);
  };
  const nothingSelected = async () => {
    await tapCanvas();
    await expect.poll(async () => (await app.state()).selection.nodes, 'tapping empty canvas leaves nothing selected').toEqual([]);
  };
  const hitAt = (p: { x: number; y: number }) => page.evaluate(({ x, y }) => {
    const h = document.elementFromPoint(x, y);
    return { tag: h?.tagName ?? null, row: h?.closest('li.task-list-item')?.textContent?.trim() ?? null };
  }, p);
  /** The middle of a task's words (its first text outside a link): where a finger taps them. */
  const wordsAt = (row: Locator) => row.evaluate((li) => {
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim() || n.parentElement?.closest('a')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  });
  /** Where a finger on a task's words lands on those words (not its checkbox, a link, or chrome above the canvas), or null. */
  const wordsReachable = async (row: Locator, name: string) => {
    const at = await wordsAt(row);
    const hit = at && (await hitAt(at));
    return hit && hit.row === name && !/^(INPUT|A)$/.test(hit.tag ?? '') ? at : null;
  };
  let listId = '';
  const plain = ['Book the venue', 'Order the snacks', 'Print the badges', 'Thank the team'];

  await test.step('type a Markdown sticky; suggestions by touch and live :tada:', async () => {
    await phone.place('add-sticky', await app.emptyPoint({ x: 0.5, y: 0.35 }));
    await expect(editor, 'a new sticky opens its editor').toBeFocused();
    id = (await app.state()).editingId!;
    await checkDock(editor, 'new sticky');
    await phone.ergonomics('editing a new sticky');
    await page.keyboard.type('## Launch plan :rock', { delay: 30 });
    const rocket = suggest.locator('.emoji-option', { has: page.locator('.emoji-code', { hasText: /^:rocket:$/ }) });
    await expect(rocket, ':rock offers :rocket:').toBeVisible();
    expect(await covered(suggest), 'suggestions are drawn above the toolbar and selection bar').toEqual([]);
    await phone.ergonomics('emoji suggestions');
    await ev.snap('suggestions');
    await phone.tap(rocket);
    await expect(suggest).toHaveCount(0);
    await expect(editor, 'tapping a suggestion replaces :rock and keeps editing').toHaveValue(/^## Launch plan 🚀\uFE0F?$/);
    await expect(editor).toBeFocused();
    for (const line of ['**Owner** Sam, *draft*', '- [ ] Write the tests', '- [ ] Ship it :tada:']) {
      await page.keyboard.press('Enter');
      await page.keyboard.type(line, { delay: 20 });
    }
    await expect(editor, ':tada: turns into 🎉 on the closing colon').toHaveValue(/- \[ \] Ship it 🎉$/);
    await ev.snap('typing-markdown');
    await tapCanvas();
    await expect(editor, 'tapping the canvas finishes the note').toHaveCount(0);
    await app.settled();
    expect((await title()).split('\n').map((l) => l.replace(/\uFE0F/g, ''))).toEqual(['## Launch plan 🚀', '**Owner** Sam, *draft*', '- [ ] Write the tests', '- [ ] Ship it 🎉']);
  });

  const sticky = app.node(id);
  const selectNote = async () => phone.tap(await phone.grab(sticky.locator('.md h2')));
  await test.step('the note renders as Markdown; a tap ticks a task', async () => {
    const md = sticky.locator('.md');
    await expect(md.locator('h2')).toHaveText(/^Launch plan 🚀/);
    await expect(md.locator('strong')).toHaveText('Owner');
    await expect(md.locator('em')).toHaveText('draft');
    await expect(md.locator('li.task-list-item')).toHaveText(['Write the tests', 'Ship it 🎉']);
    const boxes = md.locator('input.md-task');
    await expect(boxes).toHaveCount(2);
    await selectNote();
    await expect(page.getByTestId('selection-bar'), 'tapping the note\'s heading selects it').toBeVisible();
    await phone.ergonomics('rendered note selected');
    await ev.snap('rendered-note');
    await phone.tap(boxes.first());
    await expect(boxes.first(), 'the tapped task is ticked').toBeChecked();
    await expect(boxes.nth(1)).not.toBeChecked();
    await app.settled();
    expect(await title(), 'ticking flips that line in the source').toContain('- [x] Write the tests');
    expect((await app.state()).editingId, 'ticking does not open the editor').toBeNull();
    await ev.snap('task-ticked');
  });

  await test.step('Edit reopens the raw Markdown; the emoji sheet inserts after the selection and keeps the editor open', async () => {
    const source = await title();
    await selectNote();
    await phone.sel('sel-edit');
    await expect(editor, 'Edit opens the raw Markdown').toHaveValue(source);
    await checkDock(editor, 'editing the note');
    await phone.tap(dock);
    await expect(picker, 'the button opens the emoji picker').toBeVisible();
    await expect(picker, 'on a phone the picker is a bottom sheet').toHaveClass(/sheet/);
    const vp = page.viewportSize()!;
    const sheet = await app.box(picker);
    expect([Math.round(sheet.x), Math.round(sheet.width), Math.round(sheet.y + sheet.height)], 'the sheet spans the bottom of the screen').toEqual([0, vp.width, vp.height]);
    await expect(editor, 'the editor stays open under the sheet').toHaveCount(1);
    expect(await covered(picker), 'nothing is drawn over the sheet').toEqual([]);
    const cells = grid.locator('section:not([data-group=recent]) .emoji-cell');
    const cell = await app.box(cells.first());
    expect(Math.min(cell.width, cell.height), 'emoji cells are 44 px targets').toBeGreaterThanOrEqual(MIN_TARGET - 0.5);
    await phone.ergonomics('emoji sheet');
    await ev.snap('emoji-sheet');
    const pick = (await cells.nth(4).getAttribute('data-emoji'))!;
    await phone.tap(cells.nth(4));
    await expect(picker, 'a tap picks and closes the sheet').toHaveCount(0);
    await expect(editor, 'the emoji is added after the selected text instead of replacing it').toHaveValue(source + pick);
    const value = source + pick;

    await phone.tap(dock);
    await expect(picker).toBeVisible();
    await phone.tap(page.getByRole('button', { name: 'Close emoji picker' }));
    await expect(picker, '× closes the sheet').toHaveCount(0);
    await expect(editor, 'the editor is still open and unchanged').toHaveValue(value);
    await phone.tap(dock);
    await expect(picker).toBeVisible();
    const top = (await app.box(picker)).y;
    await phone.tap({ x: vp.width / 2, y: top / 2 });
    await expect(picker, 'tapping the backdrop closes the sheet').toHaveCount(0);
    await expect(editor).toHaveValue(value);

    await tapCanvas();
    await expect(editor).toHaveCount(0);
    await app.settled();
    expect(await title(), 'the note is saved with the emoji').toBe(value);
    await expect(sticky.locator('.md')).toContainText(pick);
    await ev.snap('note-with-emoji');
  });

  await test.step('in the inspector drawer the docked button covers no control and Width opts out', async () => {
    await selectNote();
    await phone.sel('sel-style');
    await expect(phone.slot('inspector')).toHaveClass(/shown/);
    await page.waitForTimeout(300);
    const field = page.getByTestId('insp-title');
    await expect(field, 'a sticky title is multi-line in the inspector').toHaveJSProperty('tagName', 'TEXTAREA');
    await phone.tap(field);
    await checkDock(field, 'inspector Title');
    await phone.ergonomics('inspector Title focused');
    await ev.snap('inspector-docked-button');
    await phone.tap(page.getByTestId('inspector-node').getByLabel('Width', { exact: true }));
    await expect(dock, 'Width opts out of the emoji button').toHaveCount(0);
    await phone.closeDrawer('inspector');
  });

  await test.step('a checklist note: a first tap selects it and ticks nothing; then a tap on a task\'s words ticks it and a link only opens', async () => {
    await nothingSelected();
    await page.context().route('https://example.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>Invite</title><p>The invite</p>' }));
    await phone.place('add-sticky', await app.emptyPoint({ x: 0.5, y: 0.8 }));
    await expect(editor, 'a new sticky opens its editor').toBeFocused();
    listId = (await app.state()).editingId!;
    const lines = ['- [ ] Send the [invite](https://example.com/invite)', '- [ ] Book the venue', '- [ ] Order the snacks', '- [ ] Print the badges', '- [ ] Thank the team'];
    await page.keyboard.type(lines[0], { delay: 20 });
    for (const line of lines.slice(1)) {
      await page.keyboard.press('Enter');
      await page.keyboard.type(line, { delay: 20 });
    }
    await tapCanvas();
    await expect(editor, 'tapping the canvas finishes the note').toHaveCount(0);
    await app.settled();
    const list = app.node(listId);
    const listLines = async () => (await app.doc()).nodes.find((n) => n.id === listId)!.title.split('\n');
    expect(await listLines(), 'a checklist-only note').toEqual(lines);
    await nothingSelected();
    await phone.fit();
    const rows = list.locator('.md li.task-list-item');
    await expect(rows).toHaveText(['Send the invite', 'Book the venue', 'Order the snacks', 'Print the badges', 'Thank the team']);
    const box = await app.box(rows.first().locator('input.md-task'));
    expect(Math.max(box.width, box.height), 'at the fitted zoom a checkbox alone is smaller than a touch target').toBeLessThan(MIN_TARGET);

    const centre = await app.center(list);
    const atCentre = await hitAt(centre);
    expect(atCentre.tag, 'the note centre is not a checkbox or a link').not.toMatch(/^(INPUT|A)$/);
    expect(atCentre.row, 'the note centre is on a task row').toBeTruthy();
    await phone.tap(centre);
    expect(page.context().pages(), 'the first tap opens no link').toHaveLength(1);
    await expect(page.getByTestId('selection-bar'), 'the first tap selects the note').toBeVisible();
    expect((await app.state()).selection.nodes, 'the first tap selects the note').toEqual([listId]);
    await app.settled();
    expect(await listLines(), 'the first tap on an unselected note ticks nothing').toEqual(lines);
    await expect(list.locator('input.md-task:checked')).toHaveCount(0);
    await phone.ergonomics('checklist note selected');
    await ev.snap('checklist-selected-nothing-ticked');

    let target: { name: string; at: { x: number; y: number } } | null = null;
    for (const name of [...plain.filter((t) => t === atCentre.row), ...plain.filter((t) => t !== atCentre.row)]) {
      const at = await wordsReachable(rows.filter({ hasText: name }), name);
      if (at) { target = { name, at }; break; }
    }
    expect(target, 'a task\'s words (not its checkbox) are within reach of a finger in the selected note').toBeTruthy();
    const row = rows.filter({ hasText: target!.name });
    const ticked = lines.map((l) => (l.endsWith(target!.name) ? l.replace('- [ ]', '- [x]') : l));
    await phone.tap(target!.at);
    await expect(row.locator('input.md-task'), 'tapping the words of a task in the selected note ticks it').toBeChecked();
    await app.settled();
    expect(await listLines(), 'only that line flips to - [x]').toEqual(ticked);
    expect((await app.state()).editingId, 'tapping the words does not open the editor').toBeNull();
    await phone.ergonomics('task ticked by its words');
    await ev.snap('task-words-ticked');

    const invite = rows.filter({ hasText: 'Send the invite' });
    const link = invite.getByRole('link', { name: 'invite' });
    await expect(link).toHaveAttribute('href', 'https://example.com/invite');
    const inviteBox = invite.locator('input.md-task');
    const inviteTicked = await inviteBox.isChecked();
    const [tab] = await Promise.all([page.context().waitForEvent('page'), phone.tap(link)]);
    await expect(tab, 'tapping the link opens it in a new tab').toHaveURL('https://example.com/invite');
    await tab.close();
    await tab.video()?.delete();
    await page.bringToFront();
    await app.settled();
    await expect(inviteBox, 'tapping a link inside a task does not toggle it').toBeChecked({ checked: inviteTicked });
    expect(await listLines(), 'the link tap toggles nothing').toEqual(ticked);
    await ev.snap('link-opened-nothing-toggled');
  });

  await test.step('a double-tap on a task\'s words in an unselected checklist opens the raw Markdown and ticks nothing', async () => {
    const list = app.node(listId);
    const rows = list.locator('.md li.task-list-item');
    const boxes = rows.locator('input.md-task');
    const source = async () => (await app.doc()).nodes.find((n) => n.id === listId)!.title;
    const before = await source();
    const ticks = await boxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked));
    expect((await app.state()).selection.nodes, 'the checklist is still selected').toEqual([listId]);
    const unticked: string[] = [];
    for (const name of plain) if (!(await rows.filter({ hasText: name }).locator('input.md-task').isChecked())) unticked.push(name);
    const reachableSelected: string[] = [];
    for (const name of unticked) if (await wordsReachable(rows.filter({ hasText: name }), name)) reachableSelected.push(name);
    await nothingSelected();
    let target: { name: string; at: { x: number; y: number } } | null = null;
    for (const name of reachableSelected) {
      const at = await wordsReachable(rows.filter({ hasText: name }), name);
      if (at) { target = { name, at }; break; }
    }
    expect(target, 'an unticked task\'s words are within reach of a finger whether or not the note is selected').toBeTruthy();
    await phone.doubleTap(target!.at);
    await expect(editor, 'a double-tap on a task\'s words opens the note\'s editor').toBeFocused();
    expect((await app.state()).editingId, 'the double-tap edits the checklist note').toBe(listId);
    await expect(editor, 'the editor shows the raw Markdown with nothing ticked by the double-tap').toHaveValue(before);
    await phone.ergonomics('raw Markdown opened by a double-tap');
    await ev.snap('double-tap-raw-editor');
    await tapCanvas();
    await expect(editor, 'tapping the canvas finishes the note').toHaveCount(0);
    await app.settled();
    expect(await source(), 'the double-tap left the saved source unchanged').toBe(before);
    expect(await boxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked)), 'no checkbox changed').toEqual(ticks);
  });
});
