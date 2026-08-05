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
import { authRouter, requireAuth, PUBLIC_URL } from './auth.js';
import { demoIdpRouter } from './demo-idp.js';
import { initPluggy } from './openfinance/of-data.js';

const PORT = process.env.PORT || 3000;
const REQUIRE_AUTH = process.env.MCP_REQUIRE_AUTH !== 'false';

const app = express();

// ── CORS ──────────────────────────────────────────────────────
// Clientes MCP baseados em navegador (ex.: o Claude.ai ao DESCOBRIR as
// ferramentas via tools/list) fazem a chamada pelo browser. Sem estes
// cabeçalhos, o navegador bloqueia a resposta e aparece "Não foi possível
// recarregar as ferramentas do servidor". Também respondemos ao preflight
// OPTIONS e expomos o Mcp-Session-Id / WWW-Authenticate.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.header('Access-Control-Allow-Origin', origin || '*');
  if (origin) res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Accept, mcp-session-id, mcp-protocol-version',
  );
  res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
  res.header('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// OAuth só entra em cena quando MCP_REQUIRE_AUTH=true. Com auth DESLIGADA
// (padrão do demo), NÃO anunciamos metadados nem endpoints de OAuth — assim o
// Claude conecta direto ao /mcp, sem tela de consentimento nem callback (que é
// onde o fluxo de OAuth pode falhar). Para demonstrar o OAuth+PKCE, basta ligar
// MCP_REQUIRE_AUTH=true.
if (REQUIRE_AUTH) {
  app.use(authRouter());
}

// IdP de DEMONSTRAÇÃO embutido (/idp/*). Ligado por IDP_DEMO=true — o broker
// (auth.js) aponta para cá automaticamente, exibindo o fluxo login+consentimento.
if (process.env.IDP_DEMO === 'true') {
  app.use(demoIdpRouter());
}

// Endpoint MCP — protegido por Bearer só quando REQUIRE_AUTH está ligada.
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

// Pré-carrega dados reais do Pluggy quando PLUGGY_CLIENT_ID está configurado.
// Sem isso, as tools retornam dados mock mesmo com credenciais presentes.
initPluggy().catch((err) => console.error('[Pluggy] falha na inicialização:', err.message));

app.listen(PORT, () => {
  const demo = process.env.IDP_DEMO === 'true';
  const idpReal = !!(process.env.IDP_AUTHORIZE_URL && process.env.IDP_TOKEN_URL && process.env.IDP_CLIENT_ID);
  const modo = !REQUIRE_AUTH
    ? 'DESLIGADA (MCP_REQUIRE_AUTH=false)'
    : idpReal
      ? 'broker → IdP real (IDP_*)'
      : demo
        ? 'broker → IdP de DEMONSTRAÇÃO (/idp)'
        : 'mock (tela de consentimento demo)';
  console.log(`\n  Bradesco Banking MCP (HTTP)  →  ${PUBLIC_URL}/mcp`);
  console.log(`  OAuth: ${modo}`);
  if (REQUIRE_AUTH && demo && !idpReal) console.log(`  IdP demo: ${PUBLIC_URL}/idp/authorize`);
  console.log(`  Metadata: ${PUBLIC_URL}/.well-known/oauth-protected-resource\n`);
});
