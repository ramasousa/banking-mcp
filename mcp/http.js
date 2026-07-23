// ─────────────────────────────────────────────────────────────
// Transporte HTTP (Streamable HTTP) — para uso REMOTO como Connector
// no Claude.ai (e em qualquer cliente MCP que fale HTTP).
//
//   Claude.ai ──(OAuth 2.1 + PKCE)──▶ /authorize, /token   (mcp/auth.js)
//   Claude.ai ──Bearer <token>──────▶ POST /mcp            (tools/list, tools/call)
//                                          │
//                                          ▼
//                                   mock-bank.js (dados fictícios)
//
// Publique este servidor em HTTPS e registre a URL /mcp como Custom
// Connector em Settings → Connectors no Claude.ai. Defina MCP_PUBLIC_URL
// com a URL pública (ex.: https://banking-mcp.suaempresa.com) para que
// os metadados de OAuth apontem para o host correto.
//
// Em desenvolvimento local, use MCP_REQUIRE_AUTH=false para testar as
// tools sem o fluxo de OAuth.
// ─────────────────────────────────────────────────────────────

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createBankingServer } from './core.js';
import { authRouter, requireAuth } from './auth.js';

const PORT = process.env.PORT || 3000;
const REQUIRE_AUTH = process.env.MCP_REQUIRE_AUTH !== 'false';

const app = express();

// Metadados de OAuth + endpoints /authorize e /token (sempre públicos).
app.use(authRouter());

// Endpoint MCP — protegido por Bearer (a menos que MCP_REQUIRE_AUTH=false).
const guard = REQUIRE_AUTH
  ? requireAuth
  : (_req, _res, next) => next();

app.post('/mcp', express.json({ limit: '512kb' }), guard, async (req, res) => {
  // Modo stateless: um server + transport efêmeros por request.
  const server = createBankingServer(() => ({
    accessToken: req.auth?.accessToken, // token do usuário p/ o Axway (mock ignora)
    sub: req.auth?.sub,
    scope: req.auth?.scope,
  }));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('Erro no /mcp:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Erro interno do servidor MCP.' },
        id: null,
      });
    }
  }
});

// No modo stateless não há sessão para GET (SSE) nem DELETE.
const methodNotAllowed = (_req, res) =>
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Método não permitido (servidor stateless).' },
    id: null,
  });
app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

app.listen(PORT, () => {
  console.log(`\n  Bradesco Banking MCP (HTTP)  →  http://localhost:${PORT}/mcp`);
  console.log(
    `  OAuth: ${REQUIRE_AUTH ? '2.1 + PKCE (esqueleto, dados fictícios)' : 'DESLIGADA (MCP_REQUIRE_AUTH=false)'}`,
  );
  console.log(
    `  Metadata: http://localhost:${PORT}/.well-known/oauth-protected-resource\n`,
  );
});
