import { build } from 'esbuild';
await build({
  entryPoints: { main: 'src/desktop/main.ts', server: 'src/desktop/server.ts', stdio: 'src/server/stdio.ts' },
  outdir: 'dist/desktop', outExtension: { '.js': '.mjs' }, bundle: true,
  platform: 'node', format: 'esm', target: 'node22', packages: 'external', sourcemap: true,
});
await build({ entryPoints: ['src/desktop/preload.ts'], outfile: 'dist/desktop/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node22' });
