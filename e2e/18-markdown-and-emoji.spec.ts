import { test, expect } from './support/journey';
import { clashes } from './support/emoji';

/** Product contract (EmojiAssist MOUSE_TARGET): with a mouse the docked emoji button is 22×22. */
const DOCK_MOUSE = 22;
const NOTE = ['## Launch plan :rocket:', '**Owner** Sam, *draft* ~~Friday~~ \u0060v2\u0060', '- [ ] Write the tests', '- [ ] Ship it', '', '[Release notes](https://example.com/notes)'];

test('write Markdown notes and add emoji', async ({ page, app, ev }) => {
  ev.proves('A user places a sticky note and types Markdown into it (a heading, bold/italic/strike/code, a two-item task list and a link); typing :rocket: turns into 🚀 on the closing colon. The note renders as formatted Markdown on the canvas and its first line in the outline; clicking a task checkbox ticks it in the saved source and survives a reload. Double-clicking edits the raw Markdown, where :par offers emoji suggestions (↑/↓ move, Enter and Tab pick, Esc closes only the list) and :tada: converts live. The 22 px button docked above the field opens a searchable picker that inserts at the end of the selection while the editor stays open (× and the backdrop close it). Topic titles render inline Markdown; Width/Height opt out of emoji; the docked button covers no inspector control; tasks are read-only in View mode; Help lists the formatting.');
  const docId = await app.newDoc('Launch notes');
  await app.open(docId);
  const editor = app.editor();
  const dock = page.getByTestId('emoji-button');
  const suggest = page.getByTestId('emoji-suggest');
  const picker = page.getByTestId('emoji-picker');
  const grid = page.getByTestId('emoji-grid');
  let id = '';
  let celebrate = '';
  const title = async () => (await app.doc()).nodes.find((n) => n.id === id)!.title;

  await test.step('write a Markdown sticky with a task list; :rocket: converts as it is typed', async () => {
    const at = await app.emptyPoint({ x: 0.4, y: 0.4 });
    await page.getByTestId('add-sticky').click();
    await expect(page.getByTestId('place-pill'), 'Sticky arms the placement cursor').toBeVisible();
    await page.mouse.click(at.x, at.y);
    await expect(editor, 'a new sticky opens its editor').toBeFocused();
    id = (await app.state()).editingId!;
    await expect(dock, 'the emoji button docks above the focused field').toBeVisible();
    await page.keyboard.type(NOTE[0], { delay: 20 });
    await expect(editor, ':rocket: became 🚀 on the closing colon').toHaveValue(/^## Launch plan 🚀\uFE0F?$/);
    await expect(suggest, 'no suggestions after a completed code').toHaveCount(0);
    for (const line of NOTE.slice(1)) {
      await page.keyboard.press('Enter');
      await page.keyboard.type(line, { delay: 15 });
    }
    await ev.snap('typing-markdown');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(editor, 'Cmd/Ctrl+Enter finishes a sticky').toHaveCount(0);
    await app.settled();
    const src = await title();
    expect(src, 'the source keeps the Markdown, with the emoji instead of the code').toMatch(/^## Launch plan 🚀\uFE0F?\n/);
    expect(src).not.toContain(':rocket:');
    expect(src.split('\n').slice(1)).toEqual(NOTE.slice(1));

    const insp = page.getByTestId('inspector-node');
    await expect(insp).toBeVisible();
    for (const [label, value] of [['Width', '300'], ['Height', '230']]) {
      const f = insp.getByLabel(label, { exact: true });
      await f.click();
      await expect(dock, label + ' opts out of the emoji button').toHaveCount(0);
      await f.fill(value);
      await f.press('Enter');
      await app.settled();
    }
    expect((await app.doc()).nodes.find((n) => n.id === id), 'the sticky was resized to fit the note').toMatchObject({ width: 300, height: 230 });
  });

  const sticky = app.node(id);
  await test.step('the sticky renders the Markdown and the outline shows its first line', async () => {
    const md = sticky.locator('.md');
    await expect(md.locator('h2')).toHaveText(/^Launch plan 🚀/);
    await expect(md.locator('strong')).toHaveText('Owner');
    await expect(md.locator('em')).toHaveText('draft');
    await expect(md.locator('s')).toHaveText('Friday');
    await expect(md.locator('code')).toHaveText('v2');
    await expect(md.locator('input.md-task')).toHaveCount(2);
    for (const box of await md.locator('input.md-task').all()) await expect(box).not.toBeChecked();
    await expect(md.locator('li.task-list-item')).toHaveText(['Write the tests', 'Ship it']);
    const link = md.getByRole('link', { name: 'Release notes' });
    await expect(link).toHaveAttribute('href', 'https://example.com/notes');
    await expect(link, 'links open in a new tab').toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(md, 'no Markdown syntax is left on the canvas').not.toContainText('##');
    await expect(md).not.toContainText('**');
    const row = page.getByTestId('outline-' + id);
    await expect(row, 'the outline row shows the first line without its markers').toContainText('Launch plan 🚀');
    await expect(row).not.toContainText('#');
    await ev.snap('rendered-sticky');
  });

  await test.step('tick a task on the canvas', async () => {
    const boxes = sticky.locator('input.md-task');
    await boxes.first().click();
    await expect(boxes.first(), 'the clicked task is ticked').toBeChecked();
    await expect(boxes.nth(1)).not.toBeChecked();
    await app.settled();
    const src = await title();
    expect(src, 'ticking flips that line in the source').toContain('- [x] Write the tests');
    expect(src).toContain('- [ ] Ship it');
    expect((await app.state()).editingId, 'ticking does not open the editor').toBeNull();
    await page.reload();
    await app.waitForDoc(docId);
    await expect(sticky.locator('input.md-task').first(), 'the tick survives a reload').toBeChecked();
    await ev.snap('task-ticked');
  });

  await test.step('F2 edits the raw Markdown; :par suggests emoji, arrows move, Enter and Tab pick, Esc closes only the list, :tada: converts live', async () => {
    const before = await title();
    await sticky.locator('h2').click();
    await page.keyboard.press('F2');
    await expect(editor, 'F2 opens the editor').toBeFocused();
    await expect(editor, 'the editor shows the raw Markdown').toHaveValue(before);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Celebrate :par', { delay: 30 });
    const options = suggest.locator('.emoji-option');
    await expect(options.first(), ':par opens suggestions').toBeVisible();
    const emojis = await options.evaluateAll((els) => els.map((e) => e.getAttribute('data-emoji')!));
    expect(emojis.length, 'several matches for :par').toBeGreaterThan(1);
    const active = () => suggest.locator('.emoji-option.active');
    await expect(active()).toHaveAttribute('data-emoji', emojis[0]);
    await ev.snap('suggestions');
    await page.keyboard.press('ArrowDown');
    await expect(active(), '↓ moves to the next match').toHaveAttribute('data-emoji', emojis[1]);
    await page.keyboard.press('ArrowUp');
    await expect(active(), '↑ moves back').toHaveAttribute('data-emoji', emojis[0]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(suggest).toHaveCount(0);
    await expect(editor, 'Enter replaced :par with the highlighted emoji and kept editing').toHaveValue(before + '\nCelebrate ' + emojis[1]);
    await expect(editor).toBeFocused();

    await page.keyboard.type(' :thumbs', { delay: 30 });
    await expect(options.first()).toBeVisible();
    const thumbs = (await active().getAttribute('data-emoji'))!;
    await page.keyboard.press('Tab');
    await expect(editor, 'Tab picks too').toHaveValue(before + '\nCelebrate ' + emojis[1] + ' ' + thumbs);
    await expect(editor).toBeFocused();

    await page.keyboard.type(' :smi', { delay: 30 });
    await expect(options.first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(suggest, 'Esc closes the suggestions').toHaveCount(0);
    await expect(editor, '... but not the editor').toBeFocused();
    await expect(editor).toHaveValue(/ :smi$/);
    for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');

    await page.keyboard.type(' :tada:', { delay: 30 });
    celebrate = 'Celebrate ' + emojis[1] + ' ' + thumbs + ' 🎉';
    await expect(editor, ':tada: turns into 🎉 on the closing colon').toHaveValue(before + '\n' + celebrate);
    await expect(suggest).toHaveCount(0);
  });

  await test.step('the docked button opens a picker that inserts at the end of the selection and keeps the editor open', async () => {
    const edBox = await app.box(editor);
    const d = await app.box(dock);
    expect([Math.round(d.width), Math.round(d.height)], 'mouse-sized docked button').toEqual([DOCK_MOUSE, DOCK_MOUSE]);
    expect(d.y + d.height, 'the button sits above the field').toBeLessThanOrEqual(edBox.y + 1);
    await ev.snap('docked-emoji-button');
    let value = await editor.inputValue();

    await dock.click();
    await expect(picker, 'the button opens the picker').toBeVisible();
    await expect(page.getByTestId('emoji-search'), 'search is focused for typing').toBeFocused();
    await expect(editor, 'the editor stays open behind the picker').toHaveCount(1);
    await ev.snap('picker');
    await page.keyboard.type('heart', { delay: 30 });
    const heart = (await grid.locator('.emoji-cell').first().getAttribute('data-emoji'))!;
    await ev.snap('picker-search');
    await page.keyboard.press('Enter');
    await expect(picker, 'Enter picks the first result and closes the picker').toHaveCount(0);
    await expect(editor, 'the pick is inserted at the caret').toHaveValue(value + heart);
    await expect(editor).toBeFocused();
    value += heart;

    await page.keyboard.press('ControlOrMeta+a');
    await dock.click();
    await expect(picker).toBeVisible();
    const cell = grid.locator('section:not([data-group=recent]) .emoji-cell').nth(4);
    const pick = (await cell.getAttribute('data-emoji'))!;
    await cell.click();
    await expect(picker).toHaveCount(0);
    await expect(editor, 'with everything selected, the emoji goes after the selection instead of replacing it').toHaveValue(value + pick);
    value += pick;

    await dock.click();
    await page.getByRole('button', { name: 'Close emoji picker' }).click();
    await expect(picker, '× closes the picker').toHaveCount(0);
    await expect(editor, 'the editor is still open and unchanged').toHaveValue(value);
    await dock.click();
    await page.getByTestId('emoji-backdrop').click({ position: { x: 20, y: 20 } });
    await expect(picker, 'clicking outside closes the picker').toHaveCount(0);
    await expect(editor).toHaveValue(value);
    await expect(editor).toBeFocused();

    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(editor).toHaveCount(0);
    await app.settled();
    expect(await title(), 'the edit with every emoji is saved').toBe(value);
    await expect(sticky.locator('.md')).toContainText(celebrate + heart + pick);
    await expect(sticky.locator('input.md-task').first(), 'the tick is untouched').toBeChecked();
    await ev.snap('sticky-with-emoji');
  });

  await test.step('topic titles render inline Markdown and convert :codes:', async () => {
    const empty = await app.emptyPoint({ x: 0.5, y: 0.85 });
    await page.mouse.click(empty.x, empty.y);
    await expect.poll(async () => (await app.selection()).nodes, 'clicking empty canvas clears the selection').toEqual([]);
    const at = await app.emptyPoint({ x: 0.75, y: 0.4 });
    await page.getByTestId('add-topic').click();
    await expect(page.getByTestId('place-pill')).toBeVisible();
    await page.mouse.click(at.x, at.y);
    await app.type('**Ship** it :rocket:');
    const topic = (await app.selection()).nodes[0];
    expect((await app.doc()).nodes.find((n) => n.id === topic)!.title).toMatch(/^\*\*Ship\*\* it 🚀\uFE0F?$/);
    const t = app.node(topic).locator('.wfc-title');
    await expect(t.locator('strong'), 'bold renders in the topic title').toHaveText('Ship');
    await expect(t).toHaveText(/^Ship it 🚀/);
    await ev.snap('topic-inline-markdown');
  });

  await test.step('the docked button covers no inspector control', async () => {
    await sticky.locator('h2').click();
    const field = page.getByTestId('insp-title');
    await expect(field, 'a sticky title is multi-line in the inspector').toHaveJSProperty('tagName', 'TEXTAREA');
    await field.click();
    await expect(dock).toBeVisible();
    const d = await app.box(dock);
    expect(d.y + d.height, 'docked above the Title field').toBeLessThanOrEqual((await app.box(field)).y + 1);
    expect(await clashes(dock), 'controls under the docked emoji button').toEqual([]);
    await ev.snap('inspector-docked-button');
    const empty = await app.emptyPoint({ x: 0.5, y: 0.8 });
    await page.mouse.click(empty.x, empty.y);
    await expect(dock).toHaveCount(0);
  });

  await test.step('View mode: tasks cannot be ticked', async () => {
    const src = await title();
    await app.menu('menu-view', 'view-readonly');
    await expect(page.getByTestId('view-pill')).toBeVisible();
    const box = sticky.locator('input.md-task').nth(1);
    await expect(box, 'task checkboxes are disabled in View mode').toBeDisabled();
    await box.click({ force: true });
    await page.waitForTimeout(400);
    expect(await title(), 'a click in View mode changes nothing').toBe(src);
    await expect(box).not.toBeChecked();
    await ev.snap('view-mode-tasks');
    await page.getByTestId('exit-view').click();
    await expect(page.getByTestId('view-pill')).toHaveCount(0);
    await expect(box).toBeEnabled();
  });

  await test.step('Help lists the Markdown and emoji shortcuts', async () => {
    await page.keyboard.press('?');
    const help = page.getByTestId('format-help');
    await expect(help).toBeVisible();
    await expect(help).toContainText('task list');
    await expect(help).toContainText('Emoji by name');
    await expect(help).toContainText('Emoji picker');
    await ev.snap('format-help');
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(help).toHaveCount(0);
  });
});
