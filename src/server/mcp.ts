import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { SERVER_INSTRUCTIONS, type ToolDef, type ToolOutput } from './tools';

export const SERVER_INFO = { name: 'workflow-canvas', version: '0.1.0' };

export function toMcpContent(out: ToolOutput) {
  const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [];
  if (out.image) content.push({ type: 'image', data: out.image.data, mimeType: out.image.mimeType });
  if (out.text !== undefined) content.push({ type: 'text', text: out.text });
  if (out.json !== undefined) content.push({ type: 'text', text: JSON.stringify(out.json, null, 1) });
  return content;
}

function buildServer(tools: ToolDef[]) {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {} } });
  for (const t of tools) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input, annotations: t.annotations }, async (args: unknown) => {
      const client = server.server.getClientVersion();
      const origin = 'ai:' + (client?.name ?? 'mcp');
      try {
        return { content: toMcpContent(await t.run(args, { origin })) };
      } catch (err) {
        return { isError: true, content: [{ type: 'text' as const, text: 'Error: ' + (err as Error).message }] };
      }
    });
  }
  return server;
}

export function mountMcp(app: Express, tools: ToolDef[]) {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post('/mcp', async (req: Request, res: Response) => {
    const sid = req.header('mcp-session-id');
    let transport = sid ? transports.get(sid) : undefined;
    if (!transport) {
      if (!isInitializeRequest(req.body)) {
        res.status(sid ? 404 : 400).json({ jsonrpc: '2.0', error: { code: -32000, message: sid ? 'Session not found; re-initialize.' : 'Bad request: initialize first.' }, id: null });
        return;
      }
      const t: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => { transports.set(id, t); },
      });
      t.onclose = () => { if (t.sessionId) transports.delete(t.sessionId); };
      await buildServer(tools).connect(t);
      transport = t;
    }
    await transport.handleRequest(req, res, req.body);
  });

  const sessionRequest = async (req: Request, res: Response) => {
    const sid = req.header('mcp-session-id');
    const transport = sid ? transports.get(sid) : undefined;
    if (!transport) { res.status(sid ? 404 : 400).send('Unknown or missing MCP session'); return; }
    await transport.handleRequest(req, res);
  };
  app.get('/mcp', sessionRequest);
  app.delete('/mcp', sessionRequest);
}

