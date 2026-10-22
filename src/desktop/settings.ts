import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const settingsSchema = z.object({
  closeToTray: z.boolean().default(true),
  openAtLogin: z.boolean().default(false),
  port: z.number().int().min(1024).max(65535).default(8790),
  shareUrl: z.union([z.literal(''), z.string().url().refine((value) => {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname.endsWith('.ts.net') && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash;
  }, 'Use the HTTPS address provided by Tailscale Serve.')]).default(''),
}).strict();
export type DesktopSettings = z.infer<typeof settingsSchema>;
export const defaults = settingsSchema.parse({});

export async function readSettings(directory: string): Promise<DesktopSettings> {
  try { return settingsSchema.parse(JSON.parse(await readFile(path.join(directory, 'desktop-settings.json'), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaults };
    throw new Error('Desktop settings could not be read. Your existing settings were preserved.', { cause: error });
  }
}
export async function writeSettings(directory: string, input: unknown): Promise<DesktopSettings> {
  const value = settingsSchema.parse(input);
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'desktop-settings.json');
  await writeFile(file + '.tmp', JSON.stringify(value, null, 2));
  await rename(file + '.tmp', file);
  return value;
}
