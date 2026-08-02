// ─────────────────────────────────────────────────────────────
// Fina Web Client — servidor Express que integra:
//   • Banking MCP Server (via InMemoryTransport, em processo)
//   • Claude API (loop agêntico com extended thinking)
//   • Browser (via Server-Sent Events — streaming em tempo real)
//
// Arquitetura de dados:
//
//   Browser  ─POST /api/chat───────────────────────────────▶ aqui
//            ◀ SSE (reasoning | tool_start | tool_done | text | done | error)
//            ─GET  /api/health──────────────────────────────▶ aqui
//
//   aqui ──InMemoryTransport──▶ Banking MCP Server (../mcp/core.js)
//        ──Claude API (tool_use loop)──▶ Anthropic
//
// Variáveis de ambiente:
//   ANTHROPIC_API_KEY   obrigatória
//   CLAUDE_MODEL        opcional (padrão claude-sonnet-4-6)
//   PORT                opcional (padrão 3300)
//   BANK_PROFILE        opcional — perfil mock: "default" | "mei" | "pj"
//                       ver ../mcp/openfinance/of-data.js para perfis
// ─────────────────────────────────────────────────────────────

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createBankingServer } from '../mcp/core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT   = process.env.PORT || 3300;
const MODEL  = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
let PROFILE = process.env.BANK_PROFILE || 'default';
const hasKey = !!process.env.ANTHROPIC_API_KEY;

// ── Conecta o MCP Server em processo via InMemoryTransport ────
// Criamos UM par de transports por servidor — o MCP Server é stateless,
// então a mesma instância atende todos os requests.
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const mcpServer = createBankingServer(() => ({ profile: PROFILE }));
await mcpServer.connect(serverTransport);

const mcp = new Client({ name: 'fina-web-client', version: '1.0.0' }, { capabilities: {} });
await mcp.connect(clientTransport);

// Cache das tools para o Claude (convertidas do formato MCP → Anthropic).
const { tools: mcpTools } = await mcp.listTools();
const anthropicTools = mcpTools.map(({ name, description, inputSchema }) => ({
  name,
  description,
  input_schema: inputSchema,
}));

// ── System prompt ─────────────────────────────────────────────
const SYSTEM = [
  'Você é Fina, uma assistente financeira conversacional de uma plataforma white-label.',
  'Ajude o cliente a entender suas finanças: saldos, extratos, faturas, investimentos, PIX e análises de gastos.',
  'Use SEMPRE as ferramentas disponíveis para obter dados reais — nunca invente valores.',
  'Responda em português do Brasil, de forma clara, cordial e concisa.',
  'Ao apresentar valores monetários, use o formato R$ 0.000,00.',
  'Quando exibir listas de transações, agrupe por tipo ou período quando fizer sentido.',
  'Ofereça sempre um próximo passo útil após cada resposta.',
  'Este ambiente usa dados fictícios de demonstração.',

  'REGRA PARA GRÁFICOS E ANÁLISE DE GASTOS:',
  'Quando o usuário pedir gráfico, análise de gastos por categoria, breakdown ou distribuição de despesas:',
  '(1) Agrupe as transações em categorias semânticas legíveis — ex: "Alimentação", "Transporte", "Moradia", "Vestuário", "Serviços", "Lazer", "Saúde", "Educação", "Investimentos". Nunca use tipos técnicos como PIX ou TED como categoria.',
  '(2) Emita um bloco de dados estruturados NO INÍCIO da resposta, antes de qualquer texto, exatamente neste formato (sem quebras de linha dentro do bloco): <!--FINA_CHART:{"type":"spend","title":"Seus gastos","period":"D de mês - D de mês","total":0,"categories":[{"label":"Categoria","pct":30,"amount":0}],"suggestions":["pergunta follow-up 1","pergunta follow-up 2","pergunta follow-up 3"]}-->',
  '(3) Máximo 8 categorias, ordenadas por valor decrescente. pct deve somar ~100.',
  '(4) As sugestões devem ser 3 perguntas curtas de follow-up contextuais ao que foi mostrado.',
  '(5) Após o bloco <!--FINA_CHART:-->, escreva APENAS UMA frase curta de resumo (ex: "Em julho você gastou R$ 23.118 — destaque para Cartão de Crédito (37%)."). PROIBIDO: tabelas markdown, listas com hífens, separadores ---, seções **Resumo por categoria**, sugestões em texto. Essas informações já estão no card visual — repeti-las é redundante e piora a experiência.',

  'REGRA PARA FATURA DO CARTÃO DE CRÉDITO:',
  'Quando o usuário pedir fatura, extrato do cartão, compras no cartão, bill ou quanto deve no cartão:',
  '(1) Consulte of_list_credit_cards para identificar o cartão, of_get_credit_card_limits para limite/últimos 4 dígitos, of_get_credit_card_bills para faturas.',
  '(2) Emita um bloco estruturado NO INÍCIO da resposta, antes de qualquer texto, exatamente neste formato (sem quebras de linha dentro do bloco): <!--FINA_BILL:{"holder":"NOME EM MAIÚSCULAS","number":"últimos 4 dígitos","expiry":"12/28","brand":"VISA","product":"VISA INFINITE","amount":0.00,"dueDate":"YYYY-MM-DD","minDue":0.00,"limit":0,"available":0}-->',
  '(3) holder: nome civil do titular (of_get_personal_identifications) em MAIÚSCULAS. number: campo identificationNumber dos limites do cartão PF. brand: creditCardNetwork em maiúsculas (VISA ou MASTERCARD). product: nome do produto sem o prefixo "BRADESCO " (ex: VISA INFINITE, MASTERCARD PLATINUM). minDue: aproximadamente 15% do total da fatura.',
  '(4) Após o bloco <!--FINA_BILL:-->, escreva APENAS UMA frase curta de resumo da fatura (ex: "Sua fatura de agosto é R$ 12.450 — vencimento dia 10."). PROIBIDO: tabelas markdown, listas, separadores ---.',
].join(' ');

// ── Express ───────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '512kb' }));

// Serve os arquivos estáticos do frontend.
app.use(express.static(join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────
// GET /api/health
// O frontend usa isso para decidir entre modo real e simulado.
// ─────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  let toolCount = 0;
  try { toolCount = mcpTools.length; } catch (_) { /* ignora */ }
  res.json({
    ready: hasKey,
    model: MODEL,
    profile: PROFILE,
    tools: toolCount,
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/profiles — lista os perfis mock disponíveis
// POST /api/switch-profile — troca o perfil ativo (sem reiniciar)
// ─────────────────────────────────────────────────────────────
const PROFILE_META = [
  { id: 'raul',   label: 'Raul S.',   desc: 'Empresário · PF + PJ' },
  { id: 'heitor', label: 'Heitor A.', desc: 'Comércio · PF + PJ'   },
  { id: 'cadimo', label: 'Cadimo P.', desc: 'Consultoria · PF + PJ' },
  { id: 'patz',   label: 'Patz T.',   desc: 'CLT · PF'              },
];

app.get('/api/profiles', (_req, res) => {
  res.json({ current: PROFILE, profiles: PROFILE_META });
});

app.post('/api/switch-profile', (req, res) => {
  const allowed = PROFILE_META.map((p) => p.id);
  const { profile } = req.body ?? {};
  if (!profile || !allowed.includes(profile)) {
    return res.status(400).json({ error: 'Invalid profile' });
  }
  PROFILE = profile;
  res.json({ profile: PROFILE });
});

// ─────────────────────────────────────────────────────────────
// Helpers internos para o dashboard
// ─────────────────────────────────────────────────────────────
const TIPO_LABEL = {
  PIX: 'PIX', TED: 'TED', DOC: 'DOC', BOLETO: 'Boleto',
  CARTAO: 'Cartão de crédito', CONVENIO_ARRECADACAO: 'Arrecadação',
  FOLHA_PAGAMENTO: 'Folha de pagamento', DEPOSITO: 'Depósito',
  SAQUE: 'Saque', RENDIMENTO_APLIC_FINANCEIRA: 'Rendimento',
  RESGATE_APLIC_FINANCEIRA: 'Resgate', OPERACAO_CREDITO: 'Crédito',
  PACOTE_TARIFA_SERVICOS: 'Tarifa de serviços', OUTROS: 'Outros',
};

async function mcpCall(name, args = {}) {
  try {
    const r = await mcp.callTool({ name, arguments: args });
    return JSON.parse(r.content?.[0]?.text ?? '{}');
  } catch (err) {
    console.warn(`[dashboard] ${name} falhou:`, err?.message);
    return {};
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/dashboard
// Retorna dados reais do MCP Server para o painel financeiro.
// Resposta: { identity, totals, entities, period, accounts, categories, totalSpend, transactions }
// ─────────────────────────────────────────────────────────────
app.get('/api/dashboard', async (_req, res) => {
  if (!hasKey) return res.json({ demo: true });

  try {
    const [analyticsRaw, identEnv, accountsEnv, cardsEnv, bfiEnv] = await Promise.all([
      mcpCall('analytics_cross_pf_pj'),
      mcpCall('of_get_personal_identifications'),
      mcpCall('of_list_accounts'),
      mcpCall('of_list_credit_cards'),
      mcpCall('of_list_bank_fixed_incomes'),
    ]);

    const accounts = Array.isArray(accountsEnv.data) ? accountsEnv.data : [];
    const identity = Array.isArray(identEnv.data) ? identEnv.data[0] : (identEnv.data ?? {});

    const today = new Date();
    const thirtyAgo = new Date(today);
    thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    const fromDate = thirtyAgo.toISOString().slice(0, 10);

    const txArrays = await Promise.all(
      accounts.map((a) =>
        mcpCall('of_get_account_transactions', {
          accountId: a.accountId,
          fromBookingDate: fromDate,
          pageSize: 30,
        })
      )
    );

    const allTx = accounts
      .flatMap((a, i) => {
        const data = Array.isArray(txArrays[i]?.data) ? txArrays[i].data : [];
        return data.map((t) => ({ ...t, _ownerType: a.ownerType }));
      })
      .sort((a, b) => (b.transactionDateTime ?? '').localeCompare(a.transactionDateTime ?? ''));

    // Categorias de gasto (top_saidas de PF + PJ agregadas)
    const pfSaidas = analyticsRaw.entidades?.PF?.top_saidas_por_tipo ?? [];
    const pjSaidas = analyticsRaw.entidades?.PJ?.top_saidas_por_tipo ?? [];
    const spendMap = {};
    [...pfSaidas, ...pjSaidas].forEach(({ tipo, valor }) => {
      spendMap[tipo] = (spendMap[tipo] ?? 0) + valor;
    });
    const totalSpend = Object.values(spendMap).reduce((s, v) => s + v, 0);
    const categories = Object.entries(spendMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([tipo, valor], i) => ({
        tipo,
        label: TIPO_LABEL[tipo] ?? tipo,
        valor: Number(valor.toFixed(2)),
        pct: totalSpend > 0 ? Math.round((valor / totalSpend) * 100) : 0,
        colorIdx: i + 1,
      }));

    const cpfRaw = identity.documents?.cpfNumber ?? '';
    const cpfMasked =
      cpfRaw.length === 11
        ? `***.***.${cpfRaw.slice(6, 9)}-${cpfRaw.slice(9)}`
        : '***';

    const pfEnt = analyticsRaw.entidades?.PF ?? {};
    const pjEnt = analyticsRaw.entidades?.PJ ?? null;

    const fmtDate = (d, opts) =>
      d.toLocaleDateString('pt-BR', opts);

    // ── Cartão de crédito PF ──────────────────────────────────
    const cardsList = Array.isArray(cardsEnv.data) ? cardsEnv.data : [];
    const pfCard = cardsList.find((c) => c.ownerType === 'PESSOA_NATURAL') ?? cardsList[0] ?? null;
    let card = null;
    if (pfCard) {
      const [billsEnv2, limitsEnv2] = await Promise.all([
        mcpCall('of_get_credit_card_bills', { creditCardAccountId: pfCard.creditCardAccountId }),
        mcpCall('of_get_credit_card_limits', { creditCardAccountId: pfCard.creditCardAccountId }),
      ]);
      const bills2   = Array.isArray(billsEnv2.data) ? billsEnv2.data : [];
      const limits2  = Array.isArray(limitsEnv2.data) ? limitsEnv2.data : [];
      const curBill  = bills2[0] ?? null;
      const totLimit = limits2.find((l) => l.creditLineLimitType === 'LIMITE_CREDITO_TOTAL') ?? null;
      const billTotal = Number(curBill?.billTotalAmount ?? 0);
      const rawName   = pfCard.name ?? '';
      card = {
        name: rawName,
        product: rawName.replace(/^BRADESCO\s*/i, ''),
        network: pfCard.creditCardNetwork ?? 'VISA',
        last4: totLimit?.identificationNumber ?? '????',
        expiry: '12/28',
        holder: (identity.civilName ?? '').toUpperCase(),
        bill: curBill ? { total: billTotal, dueDate: curBill.dueDate ?? '' } : null,
        limitTotal: Number(totLimit?.limitAmount ?? 0),
        limitAvailable: Number(totLimit?.availableAmount ?? 0),
      };
    }

    // ── Investimentos (renda fixa bancária) ───────────────────
    const bfiList = Array.isArray(bfiEnv.data) ? bfiEnv.data : [];
    const investTotal = bfiList.reduce((s, inv) => s + Number(inv.updatedValue?.amount ?? 0), 0);
    const investItems = bfiList.slice(0, 5).map((inv) => ({
      type: inv.investmentType ?? 'CDB',
      value: Number(inv.updatedValue?.amount ?? 0),
      dueDate: inv.dueDate ?? '',
    }));

    res.json({
      identity: {
        name: identity.civilName ?? 'Usuário',
        cpf: cpfMasked,
      },
      totals: {
        position: analyticsRaw.consolidado?.saldo_disponivel_total ?? 0,
      },
      entities: {
        pf: {
          label: pfEnt.titular ?? 'Conta PF',
          name: pfEnt.titular ?? 'Conta PF',
          balance: pfEnt.saldo_disponivel_total ?? 0,
          type: 'CC + Poupança',
        },
        pj: pjEnt
          ? {
              label: pjEnt.titular ?? 'MEI',
              name: pjEnt.titular ?? 'MEI',
              balance: pjEnt.saldo_disponivel_total ?? 0,
              type: 'CC PJ + CDB',
            }
          : null,
      },
      period: {
        from: fmtDate(thirtyAgo, { day: 'numeric', month: 'short' }),
        to: fmtDate(today, { day: 'numeric', month: 'short', year: 'numeric' }),
      },
      accounts: { count: accounts.length },
      categories,
      totalSpend,
      card,
      investments: {
        total: Number(investTotal.toFixed(2)),
        items: investItems,
      },
      transactions: allTx.slice(0, 12).map((t) => ({
        name: t.transactionName ?? t.type ?? 'Transação',
        type: t.type ?? 'OUTROS',
        amount: Number(t.transactionAmount?.amount ?? 0),
        credit: t.creditDebitType === 'CREDITO',
        date: t.transactionDateTime?.slice(0, 10) ?? '',
      })),
    });
  } catch (err) {
    console.error('[dashboard] erro:', err?.message);
    res.status(500).json({ error: err?.message ?? 'Erro interno' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/chat
// Body: { messages: [{ role: "user"|"assistant", content: string }] }
//
// Responde com Server-Sent Events. Cada evento tem o formato:
//
//   data: {"type":"reasoning","text":"..."}
//   data: {"type":"tool_start","name":"of_get_account_balances","desc":"Consultando saldos…"}
//   data: {"type":"tool_done","name":"of_get_account_balances","summary":"2 contas encontradas"}
//   data: {"type":"text","chunk":"..."}
//   data: {"type":"done","text":"<resposta completa>"}
//   data: {"type":"error","message":"..."}
// ─────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  // SSE headers — o browser recebe eventos à medida que o loop agêntico avança.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx: desativa buffer

  const send = (obj) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  if (!hasKey) {
    send({ type: 'error', message: 'ANTHROPIC_API_KEY não configurada no servidor.' });
    return res.end();
  }

  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!incoming.length) {
    send({ type: 'error', message: 'Nenhuma mensagem recebida.' });
    return res.end();
  }

  const client = new Anthropic();

  // Copia as mensagens para o array mutável do loop.
  const messages = incoming.map((m) => ({ role: m.role, content: m.content }));
  let fullText = '';

  try {
    // Loop agêntico: até 8 iterações (proteção contra loops infinitos).
    for (let i = 0; i < 8; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system: SYSTEM,
        tools: anthropicTools,
        messages,
      });

      // Emite blocos de raciocínio (extended thinking) quando presentes.
      for (const block of response.content) {
        if (block.type === 'thinking') {
          send({ type: 'reasoning', text: block.thinking });
        }
      }

      // Fim do loop agêntico — o modelo deu a resposta final.
      if (response.stop_reason !== 'tool_use') {
        const textBlock = response.content.find((b) => b.type === 'text');
        fullText = textBlock?.text ?? '';
        // Simula streaming char a char para UX mais suave.
        const CHUNK = 18;
        for (let j = 0; j < fullText.length; j += CHUNK) {
          send({ type: 'text', chunk: fullText.slice(j, j + CHUNK) });
        }
        send({ type: 'done', text: fullText });
        break;
      }

      // O modelo quer usar tools — executa cada uma e devolve o resultado.
      messages.push({ role: 'assistant', content: response.content });
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        send({ type: 'tool_start', name: block.name, desc: toolDesc(block.name, block.input) });

        let resultText;
        try {
          const mcpResult = await mcp.callTool({ name: block.name, arguments: block.input ?? {} });
          resultText = mcpResult.content?.[0]?.text ?? '{}';
        } catch (err) {
          resultText = JSON.stringify({ erro: err?.message ?? 'Falha na tool' });
        }

        // Gera um resumo legível do resultado para o SSE (não enviamos o JSON bruto).
        const summary = buildSummary(block.name, resultText);
        send({ type: 'tool_done', name: block.name, summary });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultText,
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }
  } catch (err) {
    console.error('[fina] Erro no loop agêntico:', err?.message || err);
    send({ type: 'error', message: err?.message ?? 'Erro interno do servidor.' });
  }

  res.end();
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Descrição amigável do que a tool vai buscar (mostrada enquanto carrega). */
function toolDesc(name, input = {}) {
  const MAP = {
    of_get_consent:               'Verificando consentimento Open Finance…',
    of_list_resources:            'Listando recursos autorizados…',
    of_list_accounts:             'Buscando contas bancárias…',
    of_get_account:               'Carregando dados da conta…',
    of_get_account_balances:      'Consultando saldos…',
    of_get_account_transactions:  'Buscando transações…',
    of_get_account_overdraft_limits: 'Verificando limite de cheque especial…',
    of_list_credit_cards:         'Listando cartões de crédito…',
    of_get_credit_card_limits:    'Consultando limites do cartão…',
    of_get_credit_card_transactions: 'Buscando fatura do cartão…',
    of_get_personal_identifications: 'Carregando dados pessoais…',
    of_get_personal_financial_relations: 'Verificando relacionamento bancário…',
    of_get_personal_qualifications: 'Consultando qualificação financeira…',
    of_get_business_identifications: 'Carregando dados do CNPJ…',
    of_get_business_financial_relations: 'Verificando relacionamento PJ…',
    of_get_business_qualifications: 'Consultando qualificação PJ…',
    of_list_bank_fixed_incomes:   'Consultando renda fixa bancária…',
    of_get_bank_fixed_income:     'Carregando detalhes do título…',
    of_get_bank_fixed_income_transactions: 'Buscando movimentações do título…',
    of_list_treasure_titles:      'Consultando Tesouro Direto…',
    of_get_treasure_title:        'Carregando título do Tesouro…',
    of_list_funds:                'Listando fundos de investimento…',
    of_get_fund:                  'Carregando dados do fundo…',
    analytics_cross_pf_pj:        'Consolidando posição PF + MEI…',
    analytics_spend_by_category:  'Analisando gastos por categoria…',
  };
  return MAP[name] ?? `Executando ${name}…`;
}

/** Resumo do resultado de uma tool para exibir no SSE. */
function buildSummary(name, rawJson) {
  try {
    const d = JSON.parse(rawJson);

    // Lista paginada — usa totalRecords ou length do array de dados.
    if (d?.links?.self && Array.isArray(d?.data)) {
      const n = d.meta?.totalRecords ?? d.data.length;
      const label = {
        of_list_accounts: 'conta',
        of_list_credit_cards: 'cartão',
        of_get_account_transactions: 'transação',
        of_get_credit_card_transactions: 'lançamento',
        of_list_resources: 'recurso',
        of_list_bank_fixed_incomes: 'título de renda fixa',
        of_list_treasure_titles: 'título do Tesouro',
        of_list_funds: 'fundo',
      }[name] ?? 'item';
      return `${n} ${n === 1 ? label : label + 's'} encontrado${n === 1 ? '' : 's'}`;
    }

    // Saldo — extrai availableAmount quando presente.
    if (d?.data?.availableAmount !== undefined) {
      const v = Number(d.data.availableAmount).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL',
      });
      return `Saldo disponível: ${v}`;
    }

    // Consolidado cross PF+PJ.
    if (name === 'analytics_cross_pf_pj' && d?.totalPosition !== undefined) {
      const v = Number(d.totalPosition).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL',
      });
      return `Posição total: ${v}`;
    }

    // Gastos por categoria.
    if (name === 'analytics_spend_by_category' && Array.isArray(d?.categories)) {
      return `${d.categories.length} categorias analisadas`;
    }

    return 'Dados recebidos';
  } catch (_) {
    return 'Dados recebidos';
  }
}

app.listen(PORT, () => {
  console.log(`\nFina Web Client rodando em http://localhost:${PORT}`);
  console.log(`  Modelo  : ${MODEL}`);
  console.log(`  Perfil  : ${PROFILE}`);
  console.log(`  API key : ${hasKey ? '✓ configurada' : '✗ AUSENTE — defina ANTHROPIC_API_KEY'}`);
  console.log(`  Tools   : ${mcpTools.length} disponíveis via Banking MCP Server\n`);
});
