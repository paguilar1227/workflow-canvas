/**
 * stdio MCP bridge for clients that only speak stdio (e.g. Claude Desktop).
 * It proxies every tool to the running server's REST tool API, so the tool set is identical.
 *   docker exec -i workflow-canvas node dist/server/stdio.js
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { SERVER_INFO, toMcpContent } from './mcp';
import { SERVER_INSTRUCTIONS } from './tools';

const base = (process.env.WFC_URL ?? 'http://localhost:' + (process.env.PORT ?? 8790)).replace(/\/$/, '');
const server = new Server(SERVER_INFO, { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const res = await fetch(base + '/api/tools');
  const body = (await res.json()) as { tools: { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> }[] };
  return { tools: body.tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: { type: 'object', ...t.inputSchema } as { type: 'object' }, annotations: t.annotations })) };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const clientName = server.getClientVersion()?.name ?? 'stdio';
  const res = await fetch(base + '/api/tools/' + encodeURIComponent(req.params.name), {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-client-name': clientName, ...(process.env.WFC_PUBLIC_URL ? { 'x-canvas-url': process.env.WFC_PUBLIC_URL } : {}) }, body: JSON.stringify(req.params.arguments ?? {}),
  });
  const body = (await res.json()) as { ok: boolean; result?: Parameters<typeof toMcpContent>[0]; error?: string };
  if (!body.ok || !body.result) return { isError: true, content: [{ type: 'text', text: 'Error: ' + (body.error ?? 'request failed') }] };
  return { content: toMcpContent(body.result) };
});

await server.connect(new StdioServerTransport());

