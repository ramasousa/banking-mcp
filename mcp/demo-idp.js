// ─────────────────────────────────────────────────────────────
// IdP de DEMONSTRAÇÃO — faz o papel de um provedor de identidade (ex.: o
// banco) para exibir o fluxo completo do broker OAuth em sala de aula.
//
// Expõe um Authorization Server mínimo (Authorization Code + PKCE):
//   • GET  /idp/authorize  → tela de LOGIN + CONSENTIMENTO (neutra, "DEMO")
//   • POST /idp/decision   → emite o authorization code e volta ao broker
//   • POST /idp/token      → troca code + code_verifier por access_token
//
// Ligado por IDP_DEMO=true (ver mcp/http.js). O broker (mcp/auth.js) aponta
// para cá automaticamente. Quando você tiver o IdP real do Bradesco, basta
// definir IDP_AUTHORIZE_URL/IDP_TOKEN_URL/IDP_CLIENT_ID e desligar o demo.
//
// ⚠️ Marca NEUTRA e "DEMONSTRAÇÃO" explícita de propósito: não imitamos um
// banco real (isso seria classificado como phishing). Credenciais fictícias —
// a senha é ignorada; nada é validado, armazenado ou transmitido de verdade.
// ─────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import express from 'express';

const b64url = (buf) => buf.toString('base64url');
const rand = (n = 24) => b64url(crypto.randomBytes(n));
const now = () => Math.floor(Date.now() / 1000);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Store de codes do IdP (em memória, demo).
const idpCodes = new Map(); // code -> { redirectUri, codeChallenge, scope, sub, exp }

function verifyS256(verifier, challenge) {
  if (!verifier || !challenge) return false;
  const h = b64url(crypto.createHash('sha256').update(verifier).digest());
  try {
    return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(challenge));
  } catch {
    return false;
  }
}

// Descrições amigáveis dos escopos, para a tela de consentimento.
const SCOPE_LABELS = {
  openid: 'Identificar você (login)',
  profile: 'Seu nome e dados básicos de perfil',
  'contas.saldo.read': 'Consultar o saldo da sua conta',
  'contas.extrato.read': 'Consultar seu extrato e movimentações',
  'contas.gastos.read': 'Consultar seus gastos por categoria',
  'cartoes.fatura.read': 'Consultar a fatura do seu cartão',
};

// Nomes amigáveis por client_id (quem está pedindo).
const CLIENT_LABELS = {
  'demo-mcp-client': 'MCP Banking · assistente Claude',
};

export function demoIdpRouter() {
  const router = express.Router();

  // ── Login + consentimento ──
  router.get('/idp/authorize', (req, res) => {
    const {
      response_type,
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method = 'S256',
      scope = '',
      state = '',
    } = req.query;

    if (response_type !== 'code') return res.status(400).send('response_type deve ser "code".');
    if (!client_id || !redirect_uri) return res.status(400).send('client_id e redirect_uri são obrigatórios.');
    if (!code_challenge || code_challenge_method !== 'S256')
      return res.status(400).send('PKCE com code_challenge_method=S256 é obrigatório.');

    res.type('html').send(loginConsentPage({ client_id, redirect_uri, code_challenge, scope, state }));
  });

  // ── Decisão do usuário → emite o code e volta ao broker ──
  router.post('/idp/decision', express.urlencoded({ extended: true }), (req, res) => {
    const { acao, client_id, redirect_uri, code_challenge, scope = '', state = '', usuario } = req.body;

    let back;
    try {
      back = new URL(redirect_uri);
    } catch {
      return res.status(400).send('redirect_uri inválido.');
    }

    if (acao !== 'autorizar') {
      back.searchParams.set('error', 'access_denied');
      if (state) back.searchParams.set('state', state);
      return res.redirect(back.toString());
    }

    const code = rand(24);
    idpCodes.set(code, {
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      scope,
      clientId: client_id,
      sub: String(usuario || 'usuario-demo').slice(0, 40),
      exp: now() + 300,
    });
    back.searchParams.set('code', code);
    if (state) back.searchParams.set('state', state);
    res.redirect(back.toString());
  });

  // ── Token endpoint ──
  router.post('/idp/token', express.urlencoded({ extended: true }), (req, res) => {
    const { grant_type, code, code_verifier, redirect_uri } = req.body;

    if (grant_type !== 'authorization_code') return res.status(400).json({ error: 'unsupported_grant_type' });

    const rec = idpCodes.get(code);
    if (!rec || rec.exp < now()) return res.status(400).json({ error: 'invalid_grant' });
    if (rec.redirectUri !== redirect_uri)
      return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    if (!verifyS256(code_verifier, rec.codeChallenge))
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE falhou' });

    idpCodes.delete(code);
    res.json({
      access_token: `demo-idp-${rand(24)}`,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: rec.scope,
      sub: rec.sub,
    });
  });

  return router;
}

// Tela de login + consentimento — NEUTRA e claramente de demonstração.
function loginConsentPage({ client_id, redirect_uri, code_challenge, scope, state }) {
  const cliente = CLIENT_LABELS[client_id] || client_id;
  const escopos = String(scope)
    .split(/[+\s]+/)
    .filter(Boolean);
  const listaEscopos = escopos
    .map((s) => `<li><span class="dot"></span>${esc(SCOPE_LABELS[s] || s)} <code>${esc(s)}</code></li>`)
    .join('') || '<li>Acesso básico</li>';

  const hidden = { client_id, redirect_uri, code_challenge, scope, state };
  const hiddenInputs = Object.entries(hidden)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`)
    .join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Provedor de Identidade · Demonstração</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#eef2ff;
    margin:0;display:grid;place-items:center;min-height:100vh;color:#1e293b;padding:20px}
  .card{background:#fff;max-width:440px;width:100%;padding:30px;border-radius:18px;
    box-shadow:0 12px 44px rgba(30,41,59,.14)}
  .demo{display:inline-block;background:#fde68a;color:#92400e;font-size:11px;font-weight:800;
    padding:4px 10px;border-radius:999px;margin-bottom:12px;letter-spacing:.03em}
  .idp{display:flex;align-items:center;gap:10px;font-weight:800;font-size:16px;color:#4338ca}
  .idp .key{width:34px;height:34px;border-radius:9px;background:#4338ca;color:#fff;display:grid;place-items:center;font-size:18px}
  h1{font-size:16px;margin:16px 0 2px}
  p{color:#475569;font-size:13.5px;line-height:1.5;margin:6px 0}
  .cli{background:#f1f5f9;border-radius:10px;padding:10px 12px;font-size:13.5px;margin:10px 0}
  .cli b{color:#0f172a}
  label{display:block;font-size:12px;color:#64748b;margin:12px 0 4px;font-weight:600}
  input.txt{width:100%;padding:11px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px}
  ul{list-style:none;padding:0;margin:12px 0 4px}
  ul li{font-size:13.5px;color:#334155;padding:5px 0;display:flex;align-items:center;gap:8px}
  ul li code{background:#eef2ff;color:#4338ca;padding:1px 6px;border-radius:6px;font-size:11px;margin-left:auto}
  .dot{width:7px;height:7px;border-radius:50%;background:#22c55e;flex:0 0 auto}
  .row{display:flex;gap:10px;margin-top:18px}
  button{flex:1;padding:12px;border-radius:10px;font-weight:700;font-size:14px;border:0;cursor:pointer}
  .ok{background:#4338ca;color:#fff}
  .no{background:#e2e8f0;color:#334155}
  .warn{font-size:11.5px;color:#94a3b8;margin-top:14px;line-height:1.5}
</style></head><body>
  <form class="card" method="POST" action="/idp/decision">
    <span class="demo">PROVEDOR DE IDENTIDADE · DEMONSTRAÇÃO</span>
    <div class="idp"><span class="key">🔑</span> ID Provider (Demo)</div>

    <h1>Entrar para autorizar o acesso</h1>
    <div class="cli">O aplicativo <b>${esc(cliente)}</b> quer se conectar em seu nome.<br>
      <span style="color:#64748b">client_id: <code>${esc(client_id)}</code></span></div>

    <label>Usuário / CPF (fictício)</label>
    <input class="txt" type="text" name="usuario" value="123.456.789-00" autocomplete="off">
    <label>Senha (fictícia — ignorada nesta demo)</label>
    <input class="txt" type="password" name="senha" value="demo1234" autocomplete="off">

    <p style="margin-top:16px"><b>Permissões solicitadas</b></p>
    <ul>${listaEscopos}</ul>

    ${hiddenInputs}
    <div class="row">
      <button class="no" type="submit" name="acao" value="negar">Cancelar</button>
      <button class="ok" type="submit" name="acao" value="autorizar">Autorizar acesso</button>
    </div>

    <p class="warn">⚠️ Ambiente de <b>demonstração</b>. Provedor de identidade fictício —
      não é um banco real. Credenciais são de exemplo; a senha é ignorada e nenhum
      dado real é acessado.</p>
  </form>
</body></html>`;
}
