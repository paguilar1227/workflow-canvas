import { test, expect, type Box, type Pt } from '../support/journey';

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

test('draw freehand notes with the pen', async ({ page, app, ev, phone }) => {
  ev.proves('Phone version: a person taps the Pen in the toolbar, underlines a topic with one finger (live ink follows the finger; the canvas neither pans nor selects), taps Done in the pen pill, taps the Pen again and circles another topic; each stroke is saved as a drawing exactly where it was drawn; Undo and Redo in the top bar remove and restore the last stroke; both strokes are still there after a reload and the outline drawer lists them. Ergonomics are checked while the pen is active; the outline behaves as a drawer.');
  const docId = await app.newDoc('Whiteboard notes');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: 'wb-api', title: 'API gateway', x: 0, y: 0 },
    { id: 'wb-db', title: 'Orders DB', shape: 'cylinder', x: 440, y: 0 },
  ] });
  await app.open(docId);
  await phone.fit();
  const vw = page.viewportSize()!.width;
  const drawings = async () => (await app.doc()).nodes.filter((n) => n.kind === 'drawing');
  const visible = (testId: string) => page.locator('[data-testid="' + testId + '"]:visible');
  await phone.ergonomics('before drawing');
  await ev.snap('before-drawing');

  /** One finger: press, trace the points with small pauses like a hand, lift. */
  const stroke = async (pts: Pt[], beforeRelease?: () => Promise<void>) => {
    await phone.touch('touchStart', [pts[0]]);
    for (const p of pts.slice(1)) { await phone.touch('touchMove', [p]); await page.waitForTimeout(12); }
    if (beforeRelease) await beforeRelease();
    await phone.touch('touchEnd', []);
    await page.waitForTimeout(200);
    await app.settled();
  };
  const strokeBox = (pts: Pt[]): Box => {
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  };
  const expectDrawnWhereTraced = async (id: string, traced: Box) => {
    const el = app.node(id);
    await expect(el, 'the stroke is on the canvas').toBeVisible();
    await expect(el.locator('path.wfc-stroke')).toHaveCount(1);
    const b = await app.box(el);
    for (const [got, want, what] of [[b.x, traced.x, 'left'], [b.y, traced.y, 'top'], [b.x + b.width, traced.x + traced.width, 'right'], [b.y + b.height, traced.y + traced.height, 'bottom']] as const) {
      expect(near(got, want, 6), 'the saved stroke\'s ' + what + ' edge (' + Math.round(got) + ') is where it was drawn (' + Math.round(want) + ')').toBe(true);
    }
  };

  await test.step('tap the pen in the toolbar', async () => {
    await phone.tap(page.getByTestId('tool-pen'));
    await expect(page.getByTestId('pen-pill'), 'a pill says the pen is active').toContainText('Pen');
    await expect(page.getByTestId('pen-pill').getByRole('button'), 'the pill button reads Done, without a keyboard hint on touch').toHaveText('Done');
    await expect(page.getByTestId('tool-pen')).toHaveClass(/active/);
    await expect(page.getByTestId('pen-layer')).toBeVisible();
    expect((await app.state()).session.mode).toBe('draw');
    await phone.ergonomics('pen active');
    await ev.snap('pen-active');
  });

  let underline = '';
  await test.step('underline a topic with one finger', async () => {
    const t = await app.box(app.topic('API gateway'));
    const y = t.y + t.height + 16;
    const pts: Pt[] = Array.from({ length: 31 }, (_, i) => ({ x: t.x + (t.width * i) / 30, y: y + Math.sin(i / 2.2) * 5 }));
    const vpBefore = await app.viewport();
    await stroke(pts, async () => {
      await expect(page.getByTestId('pen-layer').locator('path'), 'the ink follows the finger while drawing').toHaveCount(1);
      await ev.snap('underline-while-drawing');
    });
    await expect.poll(async () => (await drawings()).length, 'lifting the finger saves one drawing').toBe(1);
    const d = (await drawings())[0];
    underline = d.id;
    expect(d.points!.length, 'the stroke keeps its shape (many points, not a straight line)').toBeGreaterThan(10);
    await expectDrawnWhereTraced(d.id, strokeBox(pts));
    expect(await app.viewport(), 'a one-finger stroke does not pan or zoom the canvas').toEqual(vpBefore);
    expect((await app.selection()).nodes, 'drawing does not select topics').toEqual([]);
    expect((await app.state()).session.mode, 'the pen stays active for the next stroke').toBe('draw');
    await ev.snap('underline-drawn');
  });

  await test.step('Done in the pill leaves the pen; the toolbar brings it back', async () => {
    await phone.tap(page.getByTestId('pen-pill').getByRole('button', { name: /^Done/ }));
    await expect(page.getByTestId('pen-pill')).toHaveCount(0);
    await expect(page.getByTestId('pen-layer')).toHaveCount(0);
    await expect(page.getByTestId('tool-pen')).not.toHaveClass(/active/);
    expect((await app.state()).session.mode).toBe('select');
    await phone.tap(page.getByTestId('tool-pen'));
    await expect(page.getByTestId('pen-pill')).toBeVisible();
    await expect(page.getByTestId('pen-layer')).toBeVisible();
    expect((await app.state()).session.mode).toBe('draw');
    expect((await app.doc()).nodes.filter((n) => n.kind === 'topic'), 'no topic was added or changed by the pen taps').toHaveLength(2);
  });

  let circle = '';
  await test.step('circle another topic', async () => {
    const topic = await app.box(app.topic('Orders DB'));
    const c = { x: topic.x + topic.width / 2, y: topic.y + topic.height / 2 };
    const [rx, ry] = [topic.width / 2 + 14, topic.height / 2 + 18];
    const pts: Pt[] = Array.from({ length: 41 }, (_, i) => ({
      x: Math.min(vw - 4, Math.max(4, c.x + rx * Math.cos((i / 40) * 2 * Math.PI * 1.05))),
      y: c.y + ry * Math.sin((i / 40) * 2 * Math.PI * 1.05),
    }));
    await stroke(pts);
    await expect.poll(async () => (await drawings()).length).toBe(2);
    circle = (await drawings()).find((n) => n.id !== underline)!.id;
    await expectDrawnWhereTraced(circle, strokeBox(pts));
    const b = await app.box(app.node(circle));
    expect(b.x < topic.x && b.y < topic.y && b.x + b.width >= Math.min(vw - 5, topic.x + topic.width) && b.y + b.height > topic.y + topic.height, 'the loop encloses Orders DB').toBe(true);
    await expect(app.topic('Orders DB'), 'the topic under the ink is still visible').toBeVisible();
    await ev.snap('circle-drawn');
  });

  await test.step('Undo and Redo in the top bar remove and restore the last stroke', async () => {
    await phone.tap(visible('undo'));
    await expect(app.node(circle), 'Undo removes the circle').toHaveCount(0);
    await expect(app.node(underline), 'the underline stays').toBeVisible();
    await ev.snap('circle-undone');
    await phone.tap(visible('redo'));
    await expect(app.node(circle), 'Redo brings it back').toBeVisible();
    await app.settled();
    expect((await drawings()).map((n) => n.id).sort()).toEqual([underline, circle].sort());
  });

  await test.step('the drawings are saved', async () => {
    await phone.tap(page.getByTestId('pen-pill').getByRole('button', { name: /^Done/ }));
    const before = await drawings();
    await page.reload();
    await app.waitForDoc(docId);
    await phone.fit();
    const after = await drawings();
    expect(after.map((n) => ({ id: n.id, x: n.x, y: n.y, points: n.points }))).toEqual(before.map((n) => ({ id: n.id, x: n.x, y: n.y, points: n.points })));
    for (const id of [underline, circle]) {
      await expect(app.node(id)).toBeVisible();
      await expect(app.node(id).locator('path.wfc-stroke')).toHaveCount(1);
    }
    await ev.snap('after-reload');
    await phone.openDrawer('outline');
    await expect(page.getByTestId('outline'), 'the outline drawer lists the drawings').toContainText(/drawing/i);
    await ev.snap('outline-lists-drawings');
    await phone.closeDrawer('outline');
  });

  await test.step('the outline behaves like a drawer', async () => {
    await phone.checkDrawer('outline', () => phone.tap(page.getByTestId('toggle-outline')));
  });
});
