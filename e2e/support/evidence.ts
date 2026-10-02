import path from 'node:path';

export const EVIDENCE_DIR = path.resolve(process.env.EVIDENCE_DIR ?? 'test-results/evidence');

export function slugOf(title: string) {
  return title.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
