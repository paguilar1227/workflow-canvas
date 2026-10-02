#!/usr/bin/env node
// Minimal MCP client for scripting and smoke tests.
//   node scripts/mcp-call.mjs list
//   node scripts/mcp-call.mjs call <tool> '<json args>' [--save image.png]
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.WFC_MCP_URL ?? 'http://localhost:8790/mcp';
const [cmd = 'list', tool, json = '{}', ...rest] = process.argv.slice(2);
const client = new Client({ name: process.env.WFC_CLIENT_NAME ?? 'mcp-call', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
if (cmd === 'list') {
  const { tools } = await client.listTools();
  console.log(tools.length + ' tools');
  for (const t of tools) console.log('- ' + t.name + ': ' + (t.description ?? '').split('. ')[0]);
  const info = client.getInstructions?.();
  if (info) console.log('\ninstructions:\n' + info);
} else {
  const res = await client.callTool({ name: tool, arguments: JSON.parse(json) });
  const save = rest.indexOf('--save');
  for (const c of res.content) {
    if (c.type === 'text') console.log(c.text);
    else if (c.type === 'image') {
      if (save >= 0) { writeFileSync(rest[save + 1], Buffer.from(c.data, 'base64')); console.log('[image saved to ' + rest[save + 1] + ']'); }
      else console.log('[image ' + c.mimeType + ', ' + c.data.length + ' b64 chars]');
    }
  }
  if (res.isError) process.exitCode = 1;
}
await client.close();

