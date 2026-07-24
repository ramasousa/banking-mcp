// ─────────────────────────────────────────────────────────────
// Esqueleto de OAuth 2.1 (Authorization Code + PKCE) para o MCP remoto.
//
// Saldo e extrato são DADOS PESSOAIS. Um Connector do Claude.ai só pode
// acessá-los em nome do usuário, com o consentimento dele. Este módulo
// implementa o mínimo do fluxo exigido pela especificação MCP:
//
//   • /.well-known/oauth-protected-resource  (RFC 9728)
//   • /.well-known/oauth-authorization-server (RFC 8414)
//   • /authorize   → consentimento + emissão do authorization code (PKCE)
//   • /token       → troca code + code_verifier por access_token (S256)
//   • /register    → Dynamic Client Registration (stub)
//   • requireAuth  → middleware que protege o endpoint /mcp
//
// Dois modos, escolhidos pelas variáveis de ambiente IDP_*:
//
//  A) MOCK (sem IDP_*): /authorize mostra uma tela de consentimento de
//     demonstração e emite um token fictício. Bom para testar o fluxo.
//
//  B) BROKER (com IDP_AUTHORIZE_URL/IDP_TOKEN_URL/IDP_CLIENT_ID): o servidor
//     delega o LOGIN e o CONSENTIMENTO ao IdP real (ex.: Bradesco). É AQUI que
//     o usuário vê QUEM está pedindo (seu client_id) e QUAIS escopos.
//
//     Claude ──/authorize──▶ [302] IdP do Bradesco (login + consentimento)
//                                      │  ?code&state
//     Claude ◀──/callback──────────────┘  (troca o code pelo token do usuário
//                                          no /token do IdP e emite NOSSO code)
//     Claude ──/token──▶ access_token ──/mcp Bearer──▶ tools ──▶ Axway
//
// ⚠️ Stores em memória e tokens de curta duração — em produção use Redis/DB,
//    trate refresh/expiração, e registre o SEU app no portal do Bradesco/Axway
//    (client_id próprio + redirect_uri = <PUBLIC_URL>/callback). NUNCA colete a
//    senha do usuário: o login acontece sempre no domínio do banco.
// ─────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import express from 'express';

// URL pública do servidor. Em deploy (ex.: Render) é detectada sozinha via
// RENDER_EXTERNAL_URL; localmente cai no localhost. Exportada p/ o http.js logar.
export const PUBLIC_URL =
  process.env.MCP_PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${process.env.PORT || 3000}`;

const ISSUER = PUBLIC_URL;
const RESOURCE = `${ISSUER}/mcp`;
const SCOPES = ['contas.saldo.read', 'contas.extrato.read'];
const CALLBACK = `${ISSUER}/callback`;

// ── IdP externo (ex.: Bradesco) ────────────────────────────────
// Quando configurado, o servidor vira um BROKER: o /authorize redireciona
// para o IdP real (onde acontecem o login e o CONSENTIMENTO do usuário) e o
// /callback troca o code pelo token do usuário. Sem estas variáveis, usa a
// tela mock. Registre o SEU app no portal do Bradesco/Axway para obter o
// client_id e cadastrar o redirect_uri = <PUBLIC_URL>/callback.
// IDP_DEMO=true liga o IdP de demonstração embutido (mcp/demo-idp.js): o broker
// passa a apontar para /idp/* deste mesmo servidor, sem precisar de credenciais
// reais. Basta MCP_REQUIRE_AUTH=true + IDP_DEMO=true.
const DEMO_IDP = process.env.IDP_DEMO === 'true';
const IDP = {
  authorizeUrl: process.env.IDP_AUTHORIZE_URL || (DEMO_IDP ? `${ISSUER}/idp/authorize` : undefined),
  tokenUrl: process.env.IDP_TOKEN_URL || (DEMO_IDP ? `${ISSUER}/idp/token` : undefined),
  clientId: process.env.IDP_CLIENT_ID || (DEMO_IDP ? 'demo-mcp-client' : undefined),
  clientSecret: process.env.IDP_CLIENT_SECRET, // se o IdP exigir (client confidencial)
  scope: process.env.IDP_SCOPE || 'openid profile contas.saldo.read contas.extrato.read',
};
const IDP_ENABLED = !!(IDP.authorizeUrl && IDP.tokenUrl && IDP.clientId);

// Stores em memória (DEMO — troque por Redis/DB em produção).
const codes = new Map(); // code  -> { clientId, redirectUri, codeChallenge, method, userToken, scope, exp }
const tokens = new Map(); // token -> { clientId, sub, userToken, scope, exp }
const pendentes = new Map(); // upstreamState -> { claudeRedirect, claudeState, claudeChallenge, verifier, exp }

const now = () => Math.floor(Date.now() / 1000);
const b64url = (buf) => buf.toString('base64url');
const rand = (n = 32) => b64url(crypto.randomBytes(n));

/** Verifica o PKCE: BASE64URL(SHA256(verifier)) === challenge (método S256). */
function verifyPkce(verifier, challenge, method) {
  if (!verifier || !challenge) return false;
  if (method === 'plain') return verifier === challenge;
  const hash = b64url(crypto.createHash('sha256').update(verifier).digest());
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(challenge));
}

/** Router com os endpoints públicos de OAuth (metadata + authorize + token). */
export function authRouter() {
  const router = express.Router();

  // ── Metadata do Resource Server (RFC 9728) ──
  router.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
      scopes_supported: SCOPES,
    });
  });

  // ── Metadata do Authorization Server (RFC 8414) ──
  router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      registration_endpoint: `${ISSUER}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'], // cliente público (PKCE)
      scopes_supported: SCOPES,
    });
  });

  // ── Dynamic Client Registration (stub) ──
  router.post('/register', express.json(), (req, res) => {
    res.status(201).json({
      client_id: `demo-${rand(8)}`,
      redirect_uris: req.body?.redirect_uris || [],
      token_endpoint_auth_method: 'none',
    });
  });

  // ── /authorize — início do fluxo ──
  // É AQUI que o consentimento acontece. Com IdP configurado, redirecionamos
  // para o banco (login + consentimento no domínio dele). Sem IdP, mostramos a
  // tela mock de demonstração.
  router.get('/authorize', (req, res) => {
    const {
      redirect_uri,
      code_challenge,
      code_challenge_method = 'S256',
    } = req.query;

    if (!redirect_uri) return res.status(400).send('redirect_uri obrigatório');
    if (!code_challenge)
      return res.status(400).send('PKCE code_challenge obrigatório');
    if (code_challenge_method !== 'S256')
      return res.status(400).send('apenas code_challenge_method=S256 é suportado');

    // ── BROKER: redireciona para o IdP real (ex.: Bradesco) ──
    if (IDP_ENABLED) {
      // PKCE NOVO para a etapa servidor↔IdP (independente do PKCE do Claude).
      const verifier = rand(32);
      const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
      const upstreamState = rand(16);
      pendentes.set(upstreamState, {
        claudeRedirect: redirect_uri,
        claudeState: req.query.state || '',
        claudeChallenge: code_challenge, // PKCE do Claude, validado depois no /token
        verifier,
        exp: now() + 600,
      });

      const u = new URL(IDP.authorizeUrl);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('client_id', IDP.clientId);
      u.searchParams.set('scope', IDP.scope);
      u.searchParams.set('redirect_uri', CALLBACK); // cadastrado no IdP
      u.searchParams.set('code_challenge', challenge);
      u.searchParams.set('code_challenge_method', 'S256');
      u.searchParams.set('state', upstreamState);
      return res.redirect(u.toString());
    }

    // ── MOCK: tela de consentimento de demonstração ──
    const decision = new URL(`${ISSUER}/authorize/decision`);
    for (const k of ['client_id', 'redirect_uri', 'state', 'code_challenge', 'scope'])
      decision.searchParams.set(k, req.query[k] || '');
    res.type('html').send(consentPage(decision.toString(), req.query.scope));
  });

  // ── /callback — volta do IdP: troca o code pelo token do usuário ──
  // O banco redireciona para cá com ?code&state. Trocamos o code pelo token
  // real do usuário no /token do IdP e então emitimos NOSSO code para o Claude.
  router.get('/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;
    if (error)
      return res.status(400).send(`Erro do IdP: ${error} — ${error_description || ''}`);

    const p = pendentes.get(state);
    if (!p || p.exp < now())
      return res.status(400).send('state inválido ou expirado.');
    pendentes.delete(state);

    let userToken;
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code || ''),
        redirect_uri: CALLBACK,
        code_verifier: p.verifier,
        client_id: IDP.clientId,
      });
      const headers = { 'content-type': 'application/x-www-form-urlencoded' };
      if (IDP.clientSecret)
        headers.authorization =
          'Basic ' + Buffer.from(`${IDP.clientId}:${IDP.clientSecret}`).toString('base64');

      const r = await fetch(IDP.tokenUrl, { method: 'POST', headers, body });
      if (!r.ok) throw new Error(`token endpoint respondeu ${r.status}`);
      const tok = await r.json();
      userToken = tok.access_token;
      if (!userToken) throw new Error('resposta do IdP sem access_token');
    } catch (e) {
      console.error('Falha ao trocar code no IdP:', e?.message || e);
      return res.status(502).send('Falha ao concluir a autorização no IdP.');
    }

    // Emite NOSSO authorization code para o Claude, guardando o token do usuário.
    const ourCode = rand(24);
    codes.set(ourCode, {
      clientId: 'mcp-broker',
      redirectUri: p.claudeRedirect,
      codeChallenge: p.claudeChallenge,
      method: 'S256',
      userToken, // token REAL do usuário → usado pelos executores no Axway
      scope: SCOPES.join(' '),
      exp: now() + 300,
    });

    const back = new URL(p.claudeRedirect);
    back.searchParams.set('code', ourCode);
    if (p.claudeState) back.searchParams.set('state', p.claudeState);
    res.redirect(back.toString());
  });

  // ── Aprovação do consentimento → emite o authorization code ──
  router.get('/authorize/decision', (req, res) => {
    const { client_id, redirect_uri, state, code_challenge, scope } = req.query;
    const code = rand(24);
    codes.set(code, {
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      method: 'S256',
      // DEMO: token fictício do usuário. Em produção = token do IdP/Axway.
      userToken: `mock-user-token-${rand(6)}`,
      scope: scope || SCOPES.join(' '),
      exp: now() + 300, // code vale 5 min
    });

    const back = new URL(redirect_uri);
    back.searchParams.set('code', code);
    if (state) back.searchParams.set('state', state);
    res.redirect(back.toString());
  });

  // ── /token — troca code + code_verifier por access_token ──
  router.post('/token', express.urlencoded({ extended: true }), (req, res) => {
    const { grant_type, code, code_verifier, redirect_uri } = req.body;

    if (grant_type !== 'authorization_code')
      return res.status(400).json({ error: 'unsupported_grant_type' });

    const rec = codes.get(code);
    if (!rec || rec.exp < now())
      return res.status(400).json({ error: 'invalid_grant' });
    if (rec.redirectUri !== redirect_uri)
      return res
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    if (!verifyPkce(code_verifier, rec.codeChallenge, rec.method))
      return res
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'PKCE falhou' });

    codes.delete(code); // authorization code é de uso único

    const accessToken = rand(32);
    tokens.set(accessToken, {
      clientId: rec.clientId,
      sub: 'user-demo',
      userToken: rec.userToken,
      scope: rec.scope,
      exp: now() + 3600, // access token vale 1h
    });

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: rec.scope,
    });
  });

  return router;
}

/**
 * Middleware que protege o /mcp. Valida o Bearer e, quando ok, injeta
 * req.auth = { sub, accessToken, scope } — o accessToken é o token do
 * usuário que os executores usariam para bater no Axway.
 */
export function requireAuth(req, res, next) {
  const challenge = () =>
    res
      .set(
        'WWW-Authenticate',
        `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`,
      )
      .status(401)
      .json({ error: 'invalid_token' });

  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return challenge();

  const rec = tokens.get(token);
  if (!rec || rec.exp < now()) return challenge();

  req.auth = { sub: rec.sub, accessToken: rec.userToken, scope: rec.scope };
  next();
}

// Tela de consentimento GENÉRICA de demonstração.
//
// IMPORTANTE: NÃO imite a marca de um banco real aqui (nome, logo, cores).
// Uma página em domínio de terceiro que se passa por um banco é classificada
// como phishing pelo Google Safe Browsing e bloqueada nos navegadores (e pode
// impedir a conexão do connector). Esta é uma tela neutra, claramente um demo.
function consentPage(approveUrl, scope) {
  const escaped = String(approveUrl).replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autorizar acesso · Demo MCP</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f4f6;
    margin:0;display:grid;place-items:center;min-height:100vh;color:#1a1a1a}
  .card{background:#fff;max-width:420px;width:92%;padding:32px;border-radius:16px;
    box-shadow:0 10px 40px rgba(0,0,0,.08)}
  .brand{color:#2563eb;font-weight:800;font-size:18px;margin:0 0 4px}
  .demo{display:inline-block;background:#fde68a;color:#92400e;font-size:11px;font-weight:700;
    padding:3px 8px;border-radius:999px;margin-bottom:8px;letter-spacing:.02em}
  h1{font-size:17px;margin:10px 0 4px}
  p{color:#555;font-size:14px;line-height:1.5}
  ul{font-size:14px;color:#333;padding-left:18px}
  a.btn{display:block;text-align:center;background:#2563eb;color:#fff;text-decoration:none;
    padding:12px;border-radius:10px;font-weight:600;margin-top:20px}
  .warn{font-size:12px;color:#999;margin-top:14px}
</style></head><body>
  <div class="card">
    <span class="demo">DEMONSTRAÇÃO · DADOS FICTÍCIOS</span>
    <p class="brand">Conta Demo · MCP</p>
    <h1>Autorizar o assistente (via MCP)</h1>
    <p>Esta é uma <strong>API de demonstração</strong> (não é um banco real). Ela está
       pedindo permissão para acessar dados <strong>fictícios</strong> de exemplo:</p>
    <ul><li>Saldo (fictício)</li><li>Extrato e movimentações (fictícias)</li></ul>
    <p><strong>Escopo:</strong> ${escaped ? (scope || 'contas.saldo.read contas.extrato.read') : ''}</p>
    <a class="btn" href="${escaped}">Autorizar acesso (demo)</a>
    <p class="warn">⚠️ Ambiente de demonstração — nenhuma instituição real é acessada e
       nenhum dado real é exposto.</p>
  </div>
</body></html>`;
}
