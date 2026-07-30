// ─────────────────────────────────────────────────────────────
// Webhook do WhatsApp (Twilio Sandbox) — jornada roteirizada.
//
// Recebe as mensagens do Twilio (POST urlencoded em /whatsapp), roda uma
// máquina de estados por usuário e responde via TwiML. Os DADOS vêm de verdade
// das tools of_* (MCP em processo) — extrato, saldo e cartões. Menus numerados
// (o Sandbox lida melhor com número/texto do que com botões interativos).
//
//   WhatsApp (Twilio Sandbox) ──POST /whatsapp──▶ este webhook
//                                                   │ mcp.callTool('of_*')
//                                                   ▼   TwiML <Message> de volta
//
// Rodar: npm run whatsapp   (porta 3300)
// ─────────────────────────────────────────────────────────────

import express from 'express';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createBankingServer } from '../mcp/core.js';

const PORT = process.env.PORT || 3300;

// ── MCP em processo ──
const [ct, st] = InMemoryTransport.createLinkedPair();
const srv = createBankingServer(() => ({}));
await srv.connect(st);
const mcp = new Client({ name: 'wa-proto', version: '1.0.0' }, { capabilities: {} });
await mcp.connect(ct);
const call = async (n, a = {}) => JSON.parse((await mcp.callTool({ name: n, arguments: a })).content[0].text);

// ── Helpers ──
const nf = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (v) => nf.format(Number(v));
const TIPO = { PIX: 'PIX', TED: 'TED', BOLETO: 'Boleto', CARTAO: 'Cartão', CONVENIO_ARRECADACAO: 'Arrecadação', FOLHA_PAGAMENTO: 'Folha', DEPOSITO: 'Depósito', SAQUE: 'Saque', RENDIMENTO_APLIC_FINANCEIRA: 'Rendimento', RESGATE_APLIC_FINANCEIRA: 'Aplicação', OPERACAO_CREDITO: 'Crédito', PACOTE_TARIFA_SERVICOS: 'Tarifa', OUTROS: 'Outros' };
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DATE_REF = '2026-07-23';
function fromBooking(period) { const dias = { '7d': 7, '30d': 30, '90d': 90 }[period] ?? 30; const d = new Date(DATE_REF + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - dias); return d.toISOString().slice(0, 10); }
const compFromBill = (b) => (String(b).match(/(\d{4})-(\d{2})$/) || [null, '', '']).slice(1);
const compLabel = (b) => { const [y, m] = compFromBill(b); return m ? `${MES[+m - 1]}/${y}` : ''; };
const escapeXml = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const twiml = (msgs) => `<?xml version="1.0" encoding="UTF-8"?><Response>${[].concat(msgs).map((m) => `<Message>${escapeXml(m)}</Message>`).join('')}</Response>`;

const sessions = new Map(); // from -> { step, ... }
const RIBBON = 'PROTÓTIPO · dados fictícios';

const greet = () => [
  `👋 Olá! Sou o assistente do *Bradesco* no WhatsApp _(protótipo)_.\n\nPara começar, você autoriza receber mensagens por aqui?\n\nResponda *SIM*.`,
];
const menuText = () => `O que você quer ver? 👇\n\n*1)* 🧾 Extrato\n*2)* 💳 Cartões\n\nResponda com o número. (digite *menu* a qualquer momento; *recomeçar* para reiniciar)`;

// ── Extrato ──
async function listAccounts(s) {
  s.accounts = (await call('select_account')).accounts;
  s.step = 'selConta';
  let t = 'De qual conta você quer ver o extrato?\n\n';
  s.accounts.forEach((a, i) => { t += `*${i + 1})* ${a.rotulo} — ${brl(a.saldo_disponivel.amount)}\n`; });
  return t + '\nResponda com o número.';
}
async function extratoView(s) {
  const acc = s.accounts.find((a) => a.accountId === s.accountId) || {};
  const bal = await call('of_get_account_balances', { accountId: s.accountId });
  const tx = (await call('of_get_account_transactions', { accountId: s.accountId, fromBookingDate: fromBooking(s.period), pageSize: 1000 })).data || [];
  let ent = 0, sai = 0;
  tx.forEach((t) => { const v = +t.transactionAmount.amount; if (t.creditDebitType === 'CREDITO') ent += v; else sai += v; });
  const rec = [...tx].sort((a, b) => b.transactionDateTime.localeCompare(a.transactionDateTime)).slice(0, 5);
  let t = `🧾 *${acc.rotulo}* · ${s.period}\nSaldo disponível: *${brl(bal.data.availableAmount.amount)}*\n\n_Últimos lançamentos:_\n`;
  rec.forEach((x) => { t += `${x.creditDebitType === 'CREDITO' ? '➕' : '➖'} ${brl(x.transactionAmount.amount)} — ${x.transactionName}\n`; });
  t += `\nEntradas ${brl(ent)} · Saídas ${brl(sai)}\n\n*1)* Filtrar período  *2)* Por categoria\n*3)* Trocar conta  *0)* Menu`;
  s.step = 'extratoMenu';
  return t;
}
async function categorias(s) {
  const tx = (await call('of_get_account_transactions', { accountId: s.accountId, fromBookingDate: fromBooking(s.period), creditDebitIndicator: 'DEBITO', pageSize: 1000 })).data || [];
  const m = {}; tx.forEach((t) => { m[t.type] = (m[t.type] || 0) + +t.transactionAmount.amount; });
  const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6);
  let t = `📊 Saídas por categoria · ${s.period}\n\n`;
  top.forEach(([k, v]) => { t += `• ${TIPO[k] || k}: ${brl(v)}\n`; });
  s.step = 'catMenu';
  return t + '\n*1)* Voltar ao extrato  *0)* Menu';
}

// ── Cartões ──
async function listCards(s) {
  s.cards = (await call('of_list_credit_cards')).data;
  s.step = 'selCartao';
  let t = 'Qual cartão?\n\n';
  s.cards.forEach((c, i) => { t += `*${i + 1})* ${c.ownerType === 'PESSOA_JURIDICA' ? '🏢' : '👤'} ${c.name} — ${c.creditCardNetwork}\n`; });
  return t + '\nResponda com o número.';
}
async function cartaoView(s) {
  const lim = (await call('of_get_credit_card_limits', { creditCardAccountId: s.cardId })).data[0] || {};
  const bills = (await call('of_get_credit_card_bills', { creditCardAccountId: s.cardId })).data || [];
  const c = s.cards.find((x) => x.creditCardAccountId === s.cardId) || {};
  const b = bills[0] || {};
  s.billId = b.billId || null; s.bills = bills;
  const usado = Number(lim.usedAmount || 0), limite = Number(lim.limitAmount || 0);
  const pct = limite ? Math.round((usado / limite) * 100) : 0;
  let t = `💳 *${c.name}* (${c.creditCardNetwork})\nLimite: *${brl(limite)}* · usado ${brl(usado)} (${pct}%)\nDisponível: *${brl(lim.availableAmount || 0)}*\n`;
  if (b.billId) t += `\n🧾 Fatura *${compLabel(b.billId)}* · ${b.payments && b.payments.length ? 'paga' : 'em aberto'}\nTotal: *${brl(b.billTotalAmount)}* · vence ${b.dueDate}\nMínimo ${brl(b.billMinimumAmount)}\n`;
  t += `\n*1)* Lançamentos da fatura  *2)* Faturas anteriores\n*3)* Trocar cartão  *0)* Menu`;
  s.step = 'cartaoMenu';
  return t;
}
async function faturaView(s) {
  const tx = (await call('of_get_credit_card_bill_transactions', { creditCardAccountId: s.cardId, billId: s.billId, pageSize: 300 })).data || [];
  const total = tx.reduce((a, t) => a + Number(t.amount), 0);
  const top = tx.slice(0, 8);
  let t = `🧾 Fatura *${compLabel(s.billId)}* · total ${brl(total)} (${tx.length} lançamentos)\n\n`;
  top.forEach((x) => { t += `➖ ${brl(x.amount)} — ${x.transactionName}\n`; });
  s.step = 'faturaMenu';
  return t + '\n*1)* Voltar ao cartão  *0)* Menu';
}
async function listFaturas(s) {
  const bills = s.bills || (await call('of_get_credit_card_bills', { creditCardAccountId: s.cardId })).data;
  s.bills = bills; s.step = 'faturasMenu';
  let t = 'Escolha uma fatura:\n\n';
  bills.slice(0, 6).forEach((b, i) => { t += `*${i + 1})* ${compLabel(b.billId)} — ${brl(b.billTotalAmount)} · ${b.payments && b.payments.length ? 'paga' : 'em aberto'}\n`; });
  return t + '\n*0)* Voltar ao cartão';
}

const numOf = (low) => { const m = low.match(/\d+/); return m ? parseInt(m[0], 10) : NaN; };

// ── Máquina de estados ──
async function handle(from, raw) {
  const body = (raw || '').trim();
  const low = body.toLowerCase();
  let s = sessions.get(from);

  if (/^(recome[çc]ar|reiniciar|reset|sair)$/.test(low) || !s || /^(oi|ol[áa]|come[çc]ar|start|in[íi]cio)$/.test(low)) {
    s = { step: 'optin' }; sessions.set(from, s); return greet();
  }
  if (low === 'menu') { s.step = 'menu'; return menuText(); }
  const n = numOf(low);

  switch (s.step) {
    case 'optin':
      if (/(sim|autorizo)/.test(low) || n === 1) { s.step = 'auth'; return 'Perfeito! Antes de acessar seus dados, confirme sua identidade _(simulação)_.\n\nResponda *OK* para autenticar.'; }
      return 'Para continuar, responda *SIM*.';
    case 'auth':
      if (/(ok|autenticar)/.test(low)) { s.step = 'consent'; const c = await call('of_get_consent'); return `✅ Identidade confirmada, *Raul*.\n\nPreciso da sua autorização no *Open Finance* para ler *saldo, extrato e cartões* _(consentimento: ${c.data.status})_.\n\nResponda *AUTORIZAR*.`; }
      return 'Responda *OK* para autenticar.';
    case 'consent':
      if (/(autorizar|autorizo|sim)/.test(low)) { s.step = 'menu'; return ['✅ *Consentimento autorizado.* Tudo pronto!', menuText()]; }
      return 'Responda *AUTORIZAR* para compartilhar _(protótipo, dados fictícios)_.';
    case 'menu':
      if (n === 1 || /extrato/.test(low)) return await listAccounts(s);
      if (n === 2 || /cart/.test(low)) return await listCards(s);
      return menuText();
    case 'selConta':
      if (n >= 1 && n <= s.accounts.length) { s.accountId = s.accounts[n - 1].accountId; s.period = '30d'; return await extratoView(s); }
      return 'Responda com o número da conta.';
    case 'extratoMenu':
      if (n === 1) { s.step = 'periodoMenu'; return 'Qual período?\n\n*1)* 7 dias  *2)* 30 dias  *3)* 90 dias'; }
      if (n === 2) return await categorias(s);
      if (n === 3) return await listAccounts(s);
      if (n === 0) { s.step = 'menu'; return menuText(); }
      return 'Escolha uma opção (1, 2, 3 ou 0).';
    case 'periodoMenu':
      s.period = n === 1 ? '7d' : n === 3 ? '90d' : '30d'; return await extratoView(s);
    case 'catMenu':
      if (n === 1) return await extratoView(s);
      s.step = 'menu'; return menuText();
    case 'selCartao':
      if (n >= 1 && n <= s.cards.length) { s.cardId = s.cards[n - 1].creditCardAccountId; return await cartaoView(s); }
      return 'Responda com o número do cartão.';
    case 'cartaoMenu':
      if (n === 1) { if (!s.billId) return 'Sem fatura disponível.'; return await faturaView(s); }
      if (n === 2) return await listFaturas(s);
      if (n === 3) return await listCards(s);
      if (n === 0) { s.step = 'menu'; return menuText(); }
      return 'Escolha uma opção (1, 2, 3 ou 0).';
    case 'faturaMenu':
      if (n === 1) return await cartaoView(s);
      s.step = 'menu'; return menuText();
    case 'faturasMenu':
      if (n === 0) return await cartaoView(s);
      if (n >= 1 && n <= (s.bills || []).length) { s.billId = s.bills[n - 1].billId; return await faturaView(s); }
      return 'Responda com o número da fatura (ou 0 para voltar).';
    default:
      s.step = 'menu'; return menuText();
  }
}

// ── App ──
const app = express();
app.use(express.urlencoded({ extended: false }));
app.get('/', (_req, res) => res.type('text/plain').send(`WhatsApp webhook (${RIBBON}) — configure o Twilio Sandbox para POST em /whatsapp`));
app.post('/whatsapp', async (req, res) => {
  const from = req.body.From || 'anon';
  const body = req.body.Body || '';
  try {
    const reply = await handle(from, body);
    res.type('text/xml').send(twiml(reply));
  } catch (e) {
    console.error('erro:', e?.message || e);
    res.type('text/xml').send(twiml('Ops, tive um problema no protótipo. Digite *recomeçar*.'));
  }
});
app.listen(PORT, async () => {
  const t = await mcp.listTools();
  console.log(`\n  WhatsApp webhook (Twilio Sandbox)  →  http://localhost:${PORT}/whatsapp`);
  console.log(`  Roteiro fixo · ${t.tools.length} tools of_* em processo · dados fictícios\n`);
});
