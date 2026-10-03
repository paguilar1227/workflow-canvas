import { test, expect, App } from '../support/journey';

test('co-edit a diagram live with a teammate', async ({ page: bobPage, app: bob, ev, phone, browser, request }, info) => {
  ev.proves('Phone version: Bob edits on a phone (taps and the selection bar) while Alice edits on a desktop browser. The topic Bob adds with the selection bar appears on Alice\'s screen, Alice\'s rename and colour change appear on Bob\'s phone without a reload, and undo/redo is one shared history: Bob\'s Undo button steps back through Alice\'s changes on both screens, and Alice\'s redo re-applies them for both. The phone chrome stays ergonomic while remote edits arrive.');
  const docId = await bob.newDoc('Sprint board');
  await bob.tool('add_nodes', { documentId: docId, nodes: [
    { id: 'sb-root', title: 'Sprint 42', shape: 'pill', x: 0, y: 0 },
    { id: 'sb-backlog', title: 'Backlog', parentId: 'sb-root' },
    { id: 'sb-doing', title: 'In progress', parentId: 'sb-root' },
  ] });

  const viewport = { width: 1440, height: 900 };
  const aliceCtx = await browser.newContext({ viewport, deviceScaleFactor: 1, baseURL: info.project.use.baseURL, recordVideo: { dir: info.outputPath('alice-video'), size: viewport } });
  const alicePage = await aliceCtx.newPage();
  const alice = new App(alicePage, request);
  const both = async (label: string) => {
    await ev.snap(label + '-alice', { page: alicePage });
    await ev.snap(label + '-bob', { page: bobPage });
  };
  const titleOnBoth = async (title: string, count: number) => {
    await expect(alice.topic(title), 'Alice sees "' + title + '"').toHaveCount(count);
    await expect(bob.topic(title), 'Bob sees "' + title + '"').toHaveCount(count);
  };

  try {
    await test.step('Alice and Bob open the same canvas', async () => {
      await alice.open(docId);
      await bob.open(docId);
      for (const a of [alice, bob]) for (const t of ['Sprint 42', 'Backlog', 'In progress']) await expect(a.topic(t)).toBeVisible();
      await both('both-open');
    });

    await test.step('a topic Bob adds appears on Alice\'s screen', async () => {
      await phone.selectTopic('Backlog');
      await phone.sel('sel-child');
      await bob.type('Write journeys');
      await expect(alicePage.getByTestId('outline'), 'Bob\'s new topic shows up in Alice\'s outline without a reload').toContainText('Write journeys');
      await expect(alice.topic('Write journeys'), 'and on Alice\'s canvas').toHaveCount(1);
      expect((await alice.nodeNamed('Write journeys')).parentId, 'it is a child of Backlog on Alice\'s side too').toBe('sb-backlog');
      await alice.fit();
      await phone.fit();
      for (const a of [alice, bob]) expect(await a.inView(a.topic('Write journeys')), 'after Fit view the new topic is in view').toBe(true);
      await phone.ergonomics('Bob added a topic');
      await both('bob-added-alice-sees');
    });

    await test.step('Alice renames and colours it; Bob sees both changes', async () => {
      await alice.topic('Write journeys').click();
      await alicePage.keyboard.press('F2');
      await alice.type('Write Playwright journeys');
      await titleOnBoth('Write journeys', 0);
      await titleOnBoth('Write Playwright journeys', 1);
      await alicePage.getByTestId('color-green').click();
      await expect(alice.topic('Write Playwright journeys')).toHaveClass(/has-color/);
      await expect(bob.topic('Write Playwright journeys'), 'Alice\'s colour reaches Bob').toHaveClass(/has-color/);
      await expect(bob.topic('Write Playwright journeys')).toHaveAttribute('style', /--c-green/);
      await phone.ergonomics('Alice\'s edits arrived');
      await both('alice-renamed-and-coloured');
    });

    await test.step('Bob\'s undo steps back through Alice\'s changes on both screens', async () => {
      await phone.tap(await bob.emptyPoint());
      await expect(bobPage.getByTestId('undo')).toBeEnabled();
      await phone.tap(bobPage.getByTestId('undo'));
      await expect(alice.topic('Write Playwright journeys'), 'undo removed the colour for Alice').not.toHaveClass(/has-color/);
      await expect(bob.topic('Write Playwright journeys')).not.toHaveClass(/has-color/);
      await phone.tap(bobPage.getByTestId('undo'));
      await titleOnBoth('Write Playwright journeys', 0);
      await titleOnBoth('Write journeys', 1);
      await expect(alicePage.getByTestId('redo'), 'Alice can redo what Bob undid').toBeEnabled();
      await both('bob-undid-twice');
    });

    await test.step('Alice\'s redo re-applies the changes for everyone', async () => {
      await alicePage.keyboard.press('Escape');
      await alicePage.keyboard.press('ControlOrMeta+Shift+z');
      await titleOnBoth('Write journeys', 0);
      await titleOnBoth('Write Playwright journeys', 1);
      await alicePage.getByTestId('redo').click();
      await expect(bob.topic('Write Playwright journeys'), 'the redone colour reaches Bob').toHaveClass(/has-color/);
      await expect(alice.topic('Write Playwright journeys')).toHaveClass(/has-color/);
      await alice.settled();
      await bob.settled();
      const saved = await bob.tool<{ nodes: { title: string; color?: string | null; parentId?: string | null }[] }>('get_document', { documentId: docId, format: 'json' });
      expect(saved.nodes.find((n) => n.title === 'Write Playwright journeys'), 'the server copy matches what both people see').toMatchObject({ color: 'green', parentId: 'sb-backlog' });
      for (const a of [alice, bob]) expect((await a.doc()).nodes.map((n) => n.title).sort()).toEqual(saved.nodes.map((n) => n.title).sort());
      await both('alice-redid');
    });

    await test.step('Bob\'s outline drawer shows the shared result and behaves like a drawer', async () => {
      await phone.openDrawer('outline');
      await expect(bobPage.getByTestId('outline')).toContainText('Write Playwright journeys');
      await phone.closeDrawer('outline');
      await phone.checkDrawer('outline', () => phone.tap(bobPage.getByTestId('toggle-outline')));
    });
  } finally {
    await aliceCtx.close();
    const video = alicePage.video();
    if (video) await info.attach('alice', { path: await video.path(), contentType: 'video/webm' });
  }
});
