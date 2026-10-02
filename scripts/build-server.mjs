import { build } from 'esbuild';

await build({
  entryPoints: { index: 'src/server/index.ts', stdio: 'src/server/stdio.ts' },
  outdir: 'dist/server',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});

