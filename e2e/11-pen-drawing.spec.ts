import { test, expect, type Box, type Pt } from './support/journey';

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

test('draw freehand notes with the pen', async ({ page, app, ev }) => {
  ev.proves('A user picks the Pen from the toolbar, underlines a topic with a freehand stroke (a live preview follows the pointer, the canvas neither pans nor marquee-selects), leaves the pen with Esc, comes back with the P shortcut and circles another topic; each stroke is saved as a drawing exactly where it was drawn, Cmd+Z / Shift+Cmd+Z remove and restore the last stroke, and both strokes are still there after a reload.');
  const docId = await app.newDoc('Whiteboard notes');
  await app.tool('add_nodes', { documentId: docId, nodes: [
    { id: 'wb-api', title: 'API gateway', x: 0, y: 0 },
    { id: 'wb-db', title: 'Orders DB', shape: 'cylinder', x: 440, y: 0 },
  ] });
  await app.open(docId);
  await app.fit();
  const drawings = async () => (await app.doc()).nodes.filter((n) => n.kind === 'drawing');
  await ev.snap('before-drawing');

  /** Press, trace the points with small pauses like a hand, release. */
  const stroke = async (pts: Pt[], beforeRelease?: () => Promise<void>) => {
    const m = page.mouse;
    await m.move(pts[0].x, pts[0].y);
    await m.down();
    for (const p of pts.slice(1)) { await m.move(p.x, p.y); await page.waitForTimeout(12); }
    if (beforeRelease) await beforeRelease();
    await m.up();
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

  await test.step('pick the pen from the toolbar', async () => {
    await page.getByTestId('tool-pen').click();
    await expect(page.getByTestId('pen-pill'), 'a pill says the pen is active').toContainText('Pen');
    await expect(page.getByTestId('tool-pen')).toHaveClass(/active/);
    await expect(page.getByTestId('pen-layer')).toBeVisible();
    expect((await app.state()).session.mode).toBe('draw');
  });

  let underline = '';
  await test.step('underline a topic with a freehand stroke', async () => {
    const t = await app.box(app.topic('API gateway'));
    const y = t.y + t.height + 16;
    const pts: Pt[] = Array.from({ length: 31 }, (_, i) => ({ x: t.x + (t.width * i) / 30, y: y + Math.sin(i / 2.2) * 5 }));
    const vpBefore = await app.viewport();
    await stroke(pts, async () => {
      await expect(page.getByTestId('pen-layer').locator('path'), 'the ink follows the pointer while drawing').toHaveCount(1);
      await ev.snap('underline-while-drawing');
    });
    await expect.poll(async () => (await drawings()).length, 'releasing saves one drawing').toBe(1);
    const d = (await drawings())[0];
    underline = d.id;
    expect(d.points!.length, 'the stroke keeps its shape (many points, not a straight line)').toBeGreaterThan(10);
    await expectDrawnWhereTraced(d.id, strokeBox(pts));
    expect(await app.viewport(), 'drawing does not pan or zoom the canvas').toEqual(vpBefore);
    expect((await app.selection()).nodes, 'drawing does not marquee-select topics').toEqual([]);
    expect((await app.state()).session.mode, 'the pen stays active for the next stroke').toBe('draw');
    await ev.snap('underline-drawn');
  });

  await test.step('Esc leaves the pen; P brings it back', async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pen-pill')).toHaveCount(0);
    await expect(page.getByTestId('pen-layer')).toHaveCount(0);
    await expect(page.getByTestId('tool-pen')).not.toHaveClass(/active/);
    expect((await app.state()).session.mode).toBe('select');
    await page.keyboard.press('p');
    await expect(page.getByTestId('pen-pill')).toBeVisible();
    await expect(page.getByTestId('pen-layer')).toBeVisible();
    expect((await app.state()).session.mode).toBe('draw');
    expect((await app.doc()).nodes.filter((n) => n.kind === 'topic'), 'the P shortcut did not type into or add a topic').toHaveLength(2);
  });

  let circle = '';
  const circleAroundDb = async () => {
    const t = await app.box(app.topic('Orders DB'));
    const c = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
    const [rx, ry] = [t.width / 2 + 26, t.height / 2 + 22];
    const pts: Pt[] = Array.from({ length: 41 }, (_, i) => ({ x: c.x + rx * Math.cos((i / 40) * 2 * Math.PI * 1.05), y: c.y + ry * Math.sin((i / 40) * 2 * Math.PI * 1.05) }));
    await stroke(pts);
    return { pts, topic: t };
  };

  await test.step('circle another topic', async () => {
    const { pts, topic } = await circleAroundDb();
    await expect.poll(async () => (await drawings()).length).toBe(2);
    circle = (await drawings()).find((n) => n.id !== underline)!.id;
    await expectDrawnWhereTraced(circle, strokeBox(pts));
    const b = await app.box(app.node(circle));
    expect(b.x < topic.x && b.y < topic.y && b.x + b.width > topic.x + topic.width && b.y + b.height > topic.y + topic.height, 'the loop encloses Orders DB').toBe(true);
    await expect(app.topic('Orders DB'), 'the topic under the ink is still visible').toBeVisible();
    await ev.snap('circle-drawn');
  });

  await test.step('undo and redo the last stroke', async () => {
    await page.keyboard.press('Meta+z');
    await expect(app.node(circle), 'Cmd+Z removes the circle').toHaveCount(0);
    await expect(app.node(underline), 'the underline stays').toBeVisible();
    await ev.snap('circle-undone');
    await page.keyboard.press('Shift+Meta+z');
    await expect(app.node(circle), 'Shift+Cmd+Z brings it back').toBeVisible();
    await app.settled();
    expect((await drawings()).map((n) => n.id).sort()).toEqual([underline, circle].sort());
  });

  await test.step('the drawings are saved', async () => {
    await page.keyboard.press('Escape');
    const before = await drawings();
    await page.reload();
    await app.waitForDoc(docId);
    await app.fit();
    const after = await drawings();
    expect(after.map((n) => ({ id: n.id, x: n.x, y: n.y, points: n.points }))).toEqual(before.map((n) => ({ id: n.id, x: n.x, y: n.y, points: n.points })));
    for (const id of [underline, circle]) {
      await expect(app.node(id)).toBeVisible();
      await expect(app.node(id).locator('path.wfc-stroke')).toHaveCount(1);
    }
    await expect(page.getByTestId('outline'), 'the outline lists the drawings').toContainText(/drawing/i);
    await ev.snap('after-reload');
  });
});
