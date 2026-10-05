import fs from 'node:fs';
import { test, expect } from './support/journey';
import { getTheme } from '../src/shared/themes';

test('import diagrams and export them in every format', async ({ page, app, ev, browser }, info) => {
  ev.proves('A user imports a Mermaid flowchart (subgraphs become frames, labels/dashed links/database shapes kept) and a Markdown outline (becomes a mind map) through the Import dialog, then downloads PNG, SVG, Markdown, Mermaid, JSON and Excalidraw exports from the Export menu; every file is non-empty and has the expected content, the PNG is a real picture without black (unthemed) shapes, and the SVG contains every connector.');
  const docId = await app.newDoc('Imports');
  await app.open(docId);

  await test.step('import a Mermaid flowchart', async () => {
    await page.getByTestId('open-import').click();
    await expect(page.getByTestId('import-modal')).toBeVisible();
    await page.getByTestId('import-format-mermaid').click();
    await expect(page.getByTestId('import-text')).toHaveValue(/flowchart LR[\s\S]*subgraph web \[Frontend\]/);
    await ev.snap('mermaid-import-dialog');
    await page.getByTestId('import-submit').click();
    await expect(page.getByTestId('import-modal')).toHaveCount(0);
    await app.settled();
    await page.waitForTimeout(500);
    const d = await app.doc();
    const frame = (t: string) => d.nodes.find((n) => n.kind === 'frame' && n.title === t);
    const node = (t: string) => d.nodes.find((n) => n.kind !== 'frame' && n.title === t)!;
    expect(frame('Frontend'), 'subgraph Frontend became a frame').toBeTruthy();
    expect(frame('Backend'), 'subgraph Backend became a frame').toBeTruthy();
    await expect(app.frame(frame('Frontend')!.id)).toContainText('Frontend');
    await expect(app.frame(frame('Backend')!.id)).toContainText('Backend');
    // Mermaid assigns a node to the first subgraph that mentions it: the sample's "ui --> api" sits in Frontend.
    for (const t of ['Web app', 'API']) expect(node(t).frameId, t + ' is in Frontend').toBe(frame('Frontend')!.id);
    for (const t of ['Postgres', 'Redis']) expect(node(t).frameId, t + ' is in Backend').toBe(frame('Backend')!.id);
    expect(node('Postgres').shape, '[( )] becomes a database cylinder').toBe('cylinder');
    expect(d.edges).toHaveLength(3);
    const sql = d.edges.find((e) => e.label === 'SQL')!;
    expect(sql, 'the |SQL| link label is kept').toBeTruthy();
    await expect(page.getByTestId('edge-label-' + sql.id)).toHaveText('SQL');
    expect(d.edges.find((e) => e.target === node('Redis').id)!.style, '-.-> becomes a dashed connector').toBe('dashed');
    for (const t of ['Web app', 'API', 'Postgres', 'Redis']) await expect(app.topic(t)).toBeVisible();
    await ev.snap('mermaid-imported');
  });

  await test.step('import a Markdown outline as a mind map', async () => {
    await page.getByTestId('open-import').click();
    await page.getByTestId('import-format-markdown').click();
    await expect(page.getByTestId('import-text')).toHaveValue(/^# Q3 plan/);
    await page.getByTestId('import-submit').click();
    await app.settled();
    await page.waitForTimeout(500);
    const d = await app.doc();
    const node = (t: string) => d.nodes.find((n) => n.title === t)!;
    expect(node('Q3 plan').parentId ?? null, 'the heading is the root topic').toBeNull();
    for (const t of ['Goals', 'Risks']) expect(node(t).parentId).toBe(node('Q3 plan').id);
    for (const t of ['Ship v2', 'Grow activation']) expect(node(t).parentId).toBe(node('Goals').id);
    expect(node('Two open roles').parentId).toBe(node('Hiring').id);
    const outline = ['Q3 plan', 'Goals', 'Ship v2', 'Grow activation', 'Risks', 'Hiring', 'Two open roles', 'Scope creep'];
    const mine = d.nodes.filter((n) => outline.includes(n.title));
    const before = d.nodes.filter((n) => !outline.includes(n.title));
    const hit = (a: typeof d.nodes[number], b: typeof d.nodes[number]) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(mine.filter((n) => n.frameId).map((n) => n.title), 'the appended outline does not join the Mermaid frames').toEqual([]);
    expect(mine.flatMap((a) => before.filter((b) => hit(a, b)).map((b) => a.title + ' covers ' + b.title)), 'the appended outline is placed beside the existing diagram, not on top of it').toEqual([]);
    for (const t of ['Q3 plan', 'Goals', 'Risks', 'Two open roles']) await expect(app.topic(t)).toBeVisible();
    expect(await page.locator('.wfc-branch').count(), 'branch lines connect the outline').toBeGreaterThanOrEqual(7);
    await ev.snap('markdown-imported-as-mind-map');
  });

  const doc = await app.doc();
  const files: Record<string, string> = {};
  for (const fmt of ['png', 'svg', 'markdown', 'mermaid', 'json', 'excalidraw']) {
    await test.step('export ' + fmt, async () => {
      await page.getByTestId('menu-export').click();
      const dl = page.waitForEvent('download');
      await page.getByTestId('export-' + fmt).click();
      const file = await ev.keep(await dl);
      files[fmt] = file;
      expect(fs.statSync(file).size, fmt + ' export is not empty').toBeGreaterThan(0);
    });
  }

  await test.step('exported files contain the diagram', async () => {
    expect(Object.keys(files).map((k) => files[k].split('/').pop())).toEqual(['imports.png', 'imports.svg', 'imports.md', 'imports.mmd', 'imports.json', 'imports.excalidraw']);
    const png = fs.readFileSync(files.png);
    expect([...png.subarray(0, 4)], 'PNG signature').toEqual([0x89, 0x50, 0x4e, 0x47]);
    const svg = fs.readFileSync(files.svg, 'utf8');
    expect(svg).toMatch(/^<svg/);
    const edgePaths = svg.match(/wfc-edge-path/g)?.length ?? 0;
    expect(edgePaths, 'the SVG contains every connector').toBeGreaterThanOrEqual(doc.edges.length);
    for (const t of ['Web app', 'Postgres', 'Q3 plan', 'Two open roles']) expect(svg, 'SVG shows ' + t).toContain(t);
    const md = fs.readFileSync(files.markdown, 'utf8');
    expect(md).toContain('Q3 plan');
    expect(md).toContain('Two open roles');
    const mmd = fs.readFileSync(files.mermaid, 'utf8');
    expect(mmd).toMatch(/^(flowchart|graph) /m);
    expect(mmd).toContain('subgraph');
    expect(mmd).toContain('SQL');
    const json = JSON.parse(fs.readFileSync(files.json, 'utf8'));
    expect(json.nodes).toHaveLength(doc.nodes.length);
    expect(json.edges).toHaveLength(doc.edges.length);
    const ex = JSON.parse(fs.readFileSync(files.excalidraw, 'utf8'));
    expect(ex.type).toBe('excalidraw');
    expect(ex.elements.filter((e: { type: string }) => e.type === 'arrow').length, 'Excalidraw has an arrow per connector').toBeGreaterThanOrEqual(doc.edges.length);
  });

  await test.step('the exported PNG is a real picture of the diagram', async () => {
    const b64 = fs.readFileSync(files.png).toString('base64');
    const viewerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const viewer = await viewerCtx.newPage();
    await viewer.setContent('<body style="margin:0;background:#888"><img id="png" style="max-width:100vw;max-height:100vh"></body>');
    const stats = await viewer.evaluate(async (data) => {
      const img = document.getElementById('png') as HTMLImageElement;
      img.src = 'data:image/png;base64,' + data;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      const colors = new Set<number>();
      let black = 0;
      for (let i = 0; i < px.length; i += 4) {
        colors.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
        if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0 && px[i + 3] === 255) black++;
      }
      return { width: c.width, height: c.height, colors: colors.size, black };
    }, b64);
    ev.note('Exported PNG: ' + stats.width + 'x' + stats.height + ', ' + stats.colors + ' distinct colours, ' + stats.black + ' opaque pure-black pixels.');
    expect(stats.width).toBeGreaterThan(0);
    expect(stats.colors, 'the PNG is not a blank image').toBeGreaterThan(1);
    const theme = getTheme((await app.state()).session.theme);
    const blackTokens = Object.entries(theme.tokens).filter(([, v]) => /#000(000)?\b|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|\bblack\b/i.test(v));
    expect(blackTokens, theme.name + ', the active theme, has no pure-black colour').toEqual([]);
    expect(stats.black, theme.name + ' has no pure-black colour, so no shape may render pure black (unthemed fill)').toBe(0);
    await ev.snap('exported-png-opened', { page: viewer });
    await viewerCtx.close();
    await info.attach('exported-png', { path: files.png, contentType: 'image/png' });
  });
});
