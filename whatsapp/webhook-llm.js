// ─────────────────────────────────────────────────────────────
// Webhook do WhatsApp (Twilio Sandbox) — versão LLM (texto livre).
//
// Em vez de menus numerados, o cliente escreve em linguagem natural
// ("quanto gastei de imposto na PJ nos últimos 3 meses?") e o CLAUDE decide
// quais tools of_* chamar, executa via MCP em processo e responde em pt-BR.
//
//   WhatsApp ──POST /whatsapp──▶ este webhook
//        │  (responde 200 na hora — evita o timeout de ~15s do Twilio)
//        └─▶ Claude (loop agêntico) ⇄ tools of_* (MCP em processo)
//                └─▶ resposta final enviada de volta via Twilio REST API
//
// Por que assíncrono? O LLM leva 5–30s (raciocínio + tools), acima do limite
// síncrono do webhook. Por isso ESTA versão precisa de credenciais Twilio
// (Account SID + Auth Token) para enviar a resposta pela API — dentro da
// janela de 24h do WhatsApp, mensagem livre é permitida sem template.
//
// Rodar: npm run whatsapp:llm   (porta 3300)
//
// Variáveis de ambiente:
//   ANTHROPIC_API_KEY     (obrigatória)   — chave da API Anthropic
//   ANTHROPIC_MODEL       (opcional)      — default: claude-haiku-4-5-20251001
//   TWILIO_ACCOUNT_SID    (obrigatória*)  — para enviar a resposta assíncrona
//   TWILIO_AUTH_TOKEN     (obrigatória*)  — idem
//   TWILIO_WHATSAPP_FROM  (opcional)      — default: whatsapp:+14155238886
//   * sem elas, cai no modo síncrono (útil só p/ teste local; pode dar timeout).
// ─────────────────────────────────────────────────────────────

import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createBankingServer } from '../mcp/core.js';

const PORT = process.env.PORT || 3300;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const RIBBON = 'PROTÓTIPO · dados fictícios';
const DATE_REF = '2026-07-23'; // "hoje" no cenário simulado

// Tools que o LLM NÃO enxerga (destrutivas — pagamentos ficam fora nesta versão).
const BLOCKED_TOOLS = new Set(['of_create_payment_consent', 'of_initiate_pix_payment']);

const MAX_TURNS = 6;      // rodadas máximas de tool no loop agêntico
const MAX_HISTORY = 16;   // mensagens de histórico guardadas por usuário

// ── MCP em processo ──
const [ct, st] = InMemoryTransport.createLinkedPair();
const srv = createBankingServer(() => ({}));
await srv.connect(st);
const mcp = new Client({ name: 'wa-llm', version: '1.0.0' }, { capabilities: {} });
await mcp.connect(ct);

// Tools do MCP → formato de tools da API Anthropic (inputSchema → input_schema),
// excluindo as destrutivas.
const mcpToolList = (await mcp.listTools()).tools.filter((t) => !BLOCKED_TOOLS.has(t.name));
const anthropicTools = mcpToolList.map((t) => ({
  name: t.name,
  description: t.description || '',
  input_schema: t.inputSchema || { type: 'object', properties: {} },
}));
const callTool = async (name, args) => {
  const r = await mcp.callTool({ name, arguments: args || {} });
  return r.content?.[0]?.text ?? JSON.stringify(r.structuredContent ?? {});
};

// ── Anthropic ──
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `Você é o assistente bancário do Bradesco no WhatsApp — um PROTÓTIPO com DADOS FICTÍCIOS.

CONTEXTO DO CLIENTE (simulado):
- O cliente se chama Raul. Ele é titular de contas PESSOA FÍSICA (PF) e PESSOA JURÍDICA (PJ).
- Já está autenticado e o consentimento Open Finance está AUTHORISED — pode ler saldo, extrato, cartões, empréstimos e investimentos.
- A data de referência ("hoje") no cenário é ${DATE_REF}. Interprete "este mês", "últimos 3 meses" etc. a partir dessa data.

COMO AGIR:
- Descubra as contas/cartões com as tools (ex.: select_account, of_list_accounts, of_list_credit_cards) antes de pedir saldo/extrato — cada uma tem um accountId/creditCardAccountId próprio.
- Para períodos, use os filtros fromBookingDate/toBookingDate (formato AAAA-MM-DD) e creditDebitIndicator (CREDITO/DEBITO) do of_get_account_transactions. Para somar uma fatura inteira, use pageSize alto (ex.: 300).
- Para cruzar PF e PJ (fluxo de caixa consolidado, pró-labore, carga tributária), use analytics_cross_pf_pj.
- NUNCA invente números — use somente o que voltar das tools. Se uma tool não trouxer o dado, diga que não encontrou.

FORMATO DAS RESPOSTAS (WhatsApp):
- Português do Brasil, tom cordial e direto. Respostas CURTAS: use listas com "•", *negrito* (um asterisco de cada lado) só no essencial. Sem tabelas nem markdown pesado.
- Valores em reais no padrão pt-BR: R$ 46.820,44. Os montantes vêm como {amount:"...", currency:"BRL"} (string) — formate você.
- Datas em dd/mm.

LIMITES:
- Só fale sobre finanças deste cliente (saldo, extrato, cartões, empréstimos, investimentos, análises PF×PJ). Fora disso, recuse gentilmente.
- Pagamentos (PIX, TED, iniciação) estão DESABILITADOS neste protótipo. Se pedirem, explique que é só consulta.
- Não peça senha, token ou dados sensíveis. Não exponha números completos de conta/cartão/CPF (use os mascarados que vierem das tools).
- Na PRIMEIRA resposta de cada conversa, deixe claro em uma linha que é um protótipo com dados fictícios.`;

// ── Loop agêntico: mensagens[] entra, texto final sai ──
async function runAgent(history) {
  const messages = [...history];
  let finalText = '';
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: anthropicTools,
      messages,
    });
    // Guarda a vez do assistente (com possíveis tool_use).
    messages.push({ role: 'assistant', content: resp.content });
    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (text) finalText = text;

    const toolUses = resp.content.filter((b) => b.type === 'tool_use');
    if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) break;

    // Executa cada tool pedida e devolve os resultados.
    const results = [];
    for (const tu of toolUses) {
      let out;
      try {
        out = await callTool(tu.name, tu.input);
      } catch (e) {
        out = JSON.stringify({ error: e?.message || 'falha ao executar tool' });
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: out });
    }
    messages.push({ role: 'user', content: results });
  }
  // Devolve o texto final e o histórico atualizado (só as mensagens novas do modelo).
  return { finalText: finalText || 'Não consegui montar a resposta agora. Pode reformular?', messages };
}

// ── Envio assíncrono via Twilio REST ──
const TW_SID = process.env.TWILIO_ACCOUNT_SID;
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TW_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
const asyncMode = Boolean(TW_SID && TW_TOKEN);

async function sendWhatsApp(to, body) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`;
  const form = new URLSearchParams({ From: TW_FROM, To: to, Body: body });
  const auth = Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!r.ok) console.error('Twilio REST erro:', r.status, await r.text().catch(() => ''));
}

// ── Sessões (histórico por número) ──
const sessions = new Map(); // from -> { messages: [...] }
const escapeXml = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const twiml = (msg) => `<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${escapeXml(msg)}</Message>` : ''}</Response>`;

async function handleMessage(from, body) {
  let s = sessions.get(from);
  if (!s || /^(recome[çc]ar|reiniciar|reset|sair|limpar)$/i.test(body.trim())) {
    s = { messages: [] };
    sessions.set(from, s);
    if (/^(recome[çc]ar|reiniciar|reset|sair|limpar)$/i.test(body.trim())) {
      return '🔄 Conversa reiniciada. Pode perguntar sobre saldo, extrato, cartões ou uma análise PF×PJ.';
    }
  }
  s.messages.push({ role: 'user', content: body });
  const { finalText, messages } = await runAgent(s.messages);
  // Persiste o histórico (limitado), preservando pares tool_use/tool_result.
  s.messages = messages.slice(-MAX_HISTORY);
  return finalText;
}

// ── App ──
const app = express();
app.use(express.urlencoded({ extended: false }));
app.get('/', (_req, res) =>
  res.type('text/plain').send(`WhatsApp webhook LLM (${RIBBON}) — modo ${asyncMode ? 'assíncrono (Twilio REST)' : 'síncrono'} · POST em /whatsapp`)
);

app.post('/whatsapp', async (req, res) => {
  const from = req.body.From || 'anon';
  const body = req.body.Body || '';

  if (asyncMode) {
    // Responde já (evita timeout) e processa em segundo plano.
    res.type('text/xml').send(twiml(''));
    try {
      const reply = await handleMessage(from, body);
      await sendWhatsApp(from, reply);
    } catch (e) {
      console.error('erro (async):', e?.message || e);
      await sendWhatsApp(from, 'Ops, tive um problema no protótipo. Envie *recomeçar* para reiniciar.').catch(() => {});
    }
    return;
  }

  // Modo síncrono (fallback local sem credenciais Twilio) — pode estourar o timeout.
  try {
    const reply = await handleMessage(from, body);
    res.type('text/xml').send(twiml(reply));
  } catch (e) {
    console.error('erro (sync):', e?.message || e);
    res.type('text/xml').send(twiml('Ops, tive um problema no protótipo. Envie *recomeçar*.'));
  }
});

app.listen(PORT, () => {
  console.log(`\n  WhatsApp webhook LLM (Twilio Sandbox)  →  http://localhost:${PORT}/whatsapp`);
  console.log(`  Modelo: ${MODEL} · ${anthropicTools.length} tools of_* (payments fora) · ${RIBBON}`);
  console.log(`  Modo: ${asyncMode ? 'ASSÍNCRONO (Twilio REST configurado)' : 'SÍNCRONO (sem credenciais Twilio — só p/ teste local)'}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log('  ⚠️  ANTHROPIC_API_KEY não definida — as chamadas ao Claude vão falhar.');
  console.log('');
});
