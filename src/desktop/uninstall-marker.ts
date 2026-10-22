import { existsSync, watch } from 'node:fs';
import path from 'node:path';
export const uninstallMarker = (userData: string) => path.join(userData, 'uninstalling.json');
export function watchUninstall(userData: string, stop: () => void = () => process.exit(0)) {
  if (existsSync(uninstallMarker(userData))) { stop(); return; }
  if (!existsSync(userData)) return;
  const watcher = watch(userData, { persistent: false }, (_event, filename) => { if (filename?.toString() === 'uninstalling.json' || existsSync(uninstallMarker(userData)) || !existsSync(userData)) { watcher.close(); stop(); } });
  watcher.on('error', () => { watcher.close(); stop(); });
  return () => watcher.close();
}
