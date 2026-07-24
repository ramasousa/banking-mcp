// Transporte HTTP (Streamable HTTP) do MCP SAP-OData — para Connector no
// Claude.ai. Modo exemplo: sem OAuth (conexão direta). Para exigir consentimento
// e repassar o token do usuário ao SAP, reutilize o broker do banking (mcp/auth.js):
// o ctx.accessToken já é enviado como Bearer pelo cliente OData.
//
// Config: PORT, MCP_PUBLIC_URL, ODATA_BASE_URL, ODATA_VERSION, ODATA_BEARER, SAP_API_KEY.

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createSapServer } from './server.js';
import { odataConfig } from './odata-client.js';

const PORT = process.env.PORT || 3100;
const PUBLIC_URL = process.env.MCP_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

const app = express();

// CORS (o Claude descobre as tools pelo navegador).
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.header('Access-Control-Allow-Origin', origin || '*');
  if (origin) res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, mcp-session-id, mcp-protocol-version');
  res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.post('/mcp', express.json({ limit: '512kb' }), async (req, res) => {
  const server = createSapServer(() => ({ /* accessToken: req.auth?.accessToken (com broker) */ }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('Erro no /mcp:', err?.message || err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erro interno.' }, id: null });
  }
});

const notAllowed = (_req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Método não permitido (stateless).' }, id: null });
app.get('/mcp', notAllowed);
app.delete('/mcp', notAllowed);

app.listen(PORT, () => {
  console.log(`\n  SAP OData MCP (HTTP)  →  ${PUBLIC_URL}/mcp`);
  console.log(`  Serviço OData: ${odataConfig().base} (${odataConfig().version})\n`);
});
