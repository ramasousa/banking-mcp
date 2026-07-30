// ─────────────────────────────────────────────────────────────
// Backend do protótipo "vivo" de extrato no WhatsApp.
//
// Conecta-se ao NOSSO MCP Server em processo (InMemoryTransport) e chama as
// tools of_* DE VERDADE (tools/call). Expõe uma "camada de projeção
// conversacional" em /api/* — valores já formatados em pt-BR, sem o ruído do
// envelope Open Finance — que a UI (proto/index.html) consome via fetch.
//
//   Navegador (WhatsApp proto)  ── fetch /api/... ──▶  este backend
//                                                          │ mcp.callTool('of_*')
//                                                          ▼
//                                                   MCP Server (core.js)
//
// Rodar:  npm run proto   → http://localhost:3200
// ─────────────────────────────────────────────────────────────

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createBankingServer } from '../mcp/core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3200;

// ── Cliente MCP em processo ──
const [clientT, serverT] = InMemoryTransport.createLinkedPair();
const mcpServer = createBankingServer(() => ({}));
await mcpServer.connect(serverT);
const mcp = new Client({ name: 'proto-extrato', version: '1.0.0' }, { capabilities: {} });
await mcp.connect(clientT);
const call = async (name, args = {}) => JSON.parse((await mcp.callTool({ name, arguments: args })).content[0].text);

// ── Helpers de projeção conversacional ──
const nf = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (v) => nf.format(Number(v));
const EMOJI = { 'PESSOA_NATURAL': '👤', 'PESSOA_JURIDICA': '🏢' };
// Rótulos amigáveis para os enums de tipo de transação do Open Finance.
const TIPO_LABEL = {
  PIX: 'PIX', TED: 'TED', DOC: 'DOC', BOLETO: 'Boleto', CARTAO: 'Cartão',
  CONVENIO_ARRECADACAO: 'Arrecadação', FOLHA_PAGAMENTO: 'Folha', DEPOSITO: 'Depósito',
  SAQUE: 'Saque', RENDIMENTO_APLIC_FINANCEIRA: 'Rendimento', RESGATE_APLIC_FINANCEIRA: 'Aplicação/Resgate',
  OPERACAO_CREDITO: 'Crédito', PACOTE_TARIFA_SERVICOS: 'Tarifa', OUTROS: 'Outros',
};
const DATE_REF = '2026-07-23';
function fromBooking(period) {
  const dias = { '7d': 7, '30d': 30, 'mes': 31, '90d': 90 }[period] ?? 30;
  const d = new Date(DATE_REF + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}
const dataCurta = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

const app = express();
app.use(express.static(__dirname)); // serve proto/index.html em /

app.get('/api/health', async (_req, res) => {
  const t = await mcp.listTools();
  res.json({ ok: true, tools: t.tools.length });
});

// Consentimento (of_get_consent)
app.get('/api/consent', async (_req, res) => {
  const r = await call('of_get_consent');
  res.json({ status: r.data.status, permissions: r.data.permissions.length, expira: r.data.expirationDateTime });
});

// Seleção de conta (select_account)
app.get('/api/accounts', async (_req, res) => {
  const r = await call('select_account');
  res.json(r.accounts.map((a) => ({
    accountId: a.accountId, rotulo: a.rotulo, titular: a.titular,
    personType: a.personType, emoji: EMOJI[a.personType] || '•',
    saldoFmt: brl(a.saldo_disponivel.amount),
  })));
});

// Extrato projetado (of_get_account_balances + of_get_account_transactions)
app.get('/api/extrato', async (req, res) => {
  const { accountId, period = '30d' } = req.query;
  if (!accountId) return res.status(400).json({ erro: 'accountId obrigatório' });
  try {
    const bal = await call('of_get_account_balances', { accountId });
    const tx = await call('of_get_account_transactions', { accountId, fromBookingDate: fromBooking(period), pageSize: 1000 });
    const arr = tx.data || [];
    let entradas = 0, saidas = 0;
    for (const t of arr) {
      const v = Number(t.transactionAmount.amount);
      if (t.creditDebitType === 'CREDITO') entradas += v; else saidas += v;
    }
    // Ordena por data desc para "últimos lançamentos" refletir o mais recente.
    const recentes = [...arr].sort((a, b) => b.transactionDateTime.localeCompare(a.transactionDateTime));
    const lancamentos = recentes.slice(0, 6).map((t) => ({
      desc: t.transactionName,
      sub: `${TIPO_LABEL[t.type] || t.type} · ${dataCurta(t.transactionDateTime)}`,
      valorFmt: (t.creditDebitType === 'CREDITO' ? '+ ' : '− ') + brl(t.transactionAmount.amount).replace('R$ ', 'R$ '),
      pos: t.creditDebitType === 'CREDITO',
    }));
    const acc = (await call('select_account')).accounts.find((a) => a.accountId === accountId) || {};
    res.json({
      titulo: `${EMOJI[acc.personType] || ''} ${acc.rotulo || accountId}`.trim(),
      saldoFmt: brl(bal.data.availableAmount.amount),
      period, total: arr.length,
      lancamentos, entradasFmt: brl(entradas), saidasFmt: brl(saidas),
    });
  } catch (e) {
    res.status(500).json({ erro: e?.message || 'falha ao consultar' });
  }
});

// Saídas por categoria (agregação a partir das transações)
app.get('/api/categorias', async (req, res) => {
  const { accountId, period = '30d' } = req.query;
  if (!accountId) return res.status(400).json({ erro: 'accountId obrigatório' });
  const tx = await call('of_get_account_transactions', { accountId, fromBookingDate: fromBooking(period), creditDebitIndicator: 'DEBITO', pageSize: 1000 });
  const mapa = {};
  for (const t of tx.data || []) mapa[t.type] = (mapa[t.type] || 0) + Number(t.transactionAmount.amount);
  const itens = Object.entries(mapa).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([tipo, v]) => ({ cat: TIPO_LABEL[tipo] || tipo, valorFmt: brl(v) }));
  res.json({ itens });
});

app.listen(PORT, async () => {
  const t = await mcp.listTools();
  console.log(`\n  Protótipo "vivo" de extrato  →  http://localhost:${PORT}`);
  console.log(`  Backend chamando ${t.tools.length} tools MCP (of_*) em processo.\n`);
});
