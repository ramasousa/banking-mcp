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
const PROFILE = process.env.BANK_PROFILE || 'default';
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
