import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
const client = new Client({ name: 'packaged-desktop-smoke', version: '1' });
const executable = process.env.WFC_TEST_EXECUTABLE || (process.platform === 'darwin' ? path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron') : process.platform === 'win32' ? path.resolve('node_modules/electron/dist/electron.exe') : path.resolve('node_modules/electron/dist/electron'));
const launcher = process.env.WFC_TEST_EXECUTABLE
  ? path.resolve(path.dirname(executable), process.platform === 'darwin' ? '../Resources' : 'resources', 'app.asar/dist/desktop/mcp.mjs')
  : path.resolve('dist/desktop/mcp.mjs');
const transport = new StdioClientTransport({
  command: executable,
  args: [launcher],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WFC_PORT: process.env.WFC_PORT || '8794', WFC_USER_DATA: process.env.WFC_USER_DATA || path.join(os.tmpdir(), 'wfc-mcp-smoke') },
});
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.ok(tools.some(t => t.name === 'create_document'));
  const result = await client.callTool({ name: 'get_canvas_state', arguments: {} });
  assert.notEqual(result.isError, true);
  console.log(JSON.stringify({ ok: true, tools: tools.length, result: result.content }));
} finally { await client.close(); }
