import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { EVIDENCE_DIR, slugOf } from './evidence';

const FFMPEG = process.env.FFMPEG ?? (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');

interface Row {
  test: string;
  slug: string;
  spec: string;
  status: string;
  durationMs: number;
  video: string | null;
  videos: string[];
  screenshots: string[];
  downloads: string[];
  proves: string[];
  notes: string[];
  error?: string;
}

const rel = (p: string) => path.relative(EVIDENCE_DIR, p).split(path.sep).join('/');

function toMp4(src: string, dest: string) {
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', dest]);
  return r.status === 0 && fs.existsSync(dest);
}

function sideBySide(a: string, b: string, dest: string) {
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', a, '-i', b, '-filter_complex', '[0:v]scale=960:600[l];[1:v]scale=960:600[r];[l][r]hstack=inputs=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dest]);
  return r.status === 0 && fs.existsSync(dest);
}

/** Copies each journey's videos (as H.264 MP4) and screenshots into EVIDENCE_DIR/<slug>/ and writes summary.json. */
export default class EvidenceReporter implements Reporter {
  private results = new Map<string, { test: TestCase; result: TestResult }>();
  private baseURL = '';
  private rootDir = '';

  onBegin(config: FullConfig) {
    this.baseURL = String(config.projects[0]?.use?.baseURL ?? '');
    this.rootDir = config.rootDir;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.results.set(test.id, { test, result });
  }

  async onEnd() {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const rows: Row[] = [];
    for (const { test, result } of this.results.values()) {
      const slug = slugOf(test.title);
      const dir = path.join(EVIDENCE_DIR, slug);
      fs.mkdirSync(dir, { recursive: true });
      const webms = result.attachments.filter((a) => a.path && a.contentType.startsWith('video/') && fs.existsSync(a.path));
      const videos: string[] = [];
      const used = new Set<string>();
      for (const v of webms) {
        let name = v.name;
        for (let i = 2; used.has(name); i++) name = v.name + '-' + i;
        used.add(name);
        const dest = path.join(dir, name + '.mp4');
        if (toMp4(v.path!, dest)) videos.push(dest);
      }
      const peer = webms.find((v) => v.name !== 'video');
      const own = webms.find((v) => v.name === 'video');
      if (peer && own) {
        const dest = path.join(dir, 'side-by-side.mp4');
        if (sideBySide(peer.path!, own.path!, dest)) videos.push(dest);
      }
      const finalShot = result.attachments.find((a) => a.name === 'screenshot' && a.path && fs.existsSync(a.path));
      if (finalShot) fs.copyFileSync(finalShot.path!, path.join(dir, 'zz-final-state.png'));
      const screenshots = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => rel(path.join(dir, f)));
      const dl = path.join(dir, 'downloads');
      const downloads = fs.existsSync(dl) ? fs.readdirSync(dl).sort().map((f) => rel(path.join(dl, f))) : [];
      const annotations = [...test.annotations, ...((result as { annotations?: typeof test.annotations }).annotations ?? [])];
      const uniq = (xs: string[]) => [...new Set(xs)];
      rows.push({
        test: test.title,
        slug,
        spec: path.relative(this.rootDir, test.location.file).split(path.sep).join('/'),
        status: result.status,
        durationMs: result.duration,
        video: videos[0] ? rel(videos[0]) : null,
        videos: videos.map(rel),
        screenshots,
        downloads,
        proves: uniq(annotations.filter((a) => a.type === 'proves').map((a) => a.description ?? '')),
        notes: uniq(annotations.filter((a) => a.type === 'note').map((a) => a.description ?? '')),
        error: result.error?.message?.replace(/\u001b\[[0-9;]*m/g, '').split('\n').slice(0, 6).join('\n'),
      });
    }
    const file = path.join(EVIDENCE_DIR, 'summary.json');
    let previous: Row[] = [];
    try { previous = JSON.parse(fs.readFileSync(file, 'utf8')).tests ?? []; } catch { /* first run */ }
    const bySlug = new Map(previous.map((r) => [r.slug, r]));
    for (const r of rows) bySlug.set(r.slug, r);
    const tests = [...bySlug.values()].sort((a, b) => a.spec.localeCompare(b.spec) || a.test.localeCompare(b.test));
    const summary = {
      generatedAt: new Date().toISOString(),
      baseURL: this.baseURL,
      evidenceDir: EVIDENCE_DIR,
      passed: tests.filter((t) => t.status === 'passed').length,
      failed: tests.filter((t) => t.status !== 'passed' && t.status !== 'skipped').length,
      tests,
    };
    fs.writeFileSync(file, JSON.stringify(summary, null, 2) + '\n');
  }

  printsToStdio() { return false; }
}
