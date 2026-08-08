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
//   ANTHROPIC_API_KEY      obrigatória
//   CLAUDE_MODEL           opcional (padrão claude-sonnet-4-6)
//   PORT                   opcional (padrão 3300)
//   BANK_PROFILE           opcional — perfil mock: "default" | "mei" | "pj"
//                          ver ../mcp/openfinance/of-data.js para perfis
//   PLUGGY_CLIENT_ID       opcional — habilita integração Pluggy Open Finance
//   PLUGGY_CLIENT_SECRET   opcional — par do PLUGGY_CLIENT_ID
//   PLUGGY_ITEM_ID         opcional — item pré-conectado (carregado na inicialização)
//   PLUGGY_WEBHOOK_SECRET  opcional — verifica assinatura HMAC dos webhooks Pluggy
// ─────────────────────────────────────────────────────────────

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createBankingServer } from '../mcp/core.js';
import { initPluggy, listProfiles, refreshPluggy, isPluggyReady } from '../mcp/openfinance/of-data.js';
import { log } from '../mcp/lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT   = process.env.PORT || 3300;
const MODEL  = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
let PROFILE = process.env.BANK_PROFILE || (process.env.PLUGGY_CLIENT_ID ? 'pluggy' : 'raul');
const hasKey = !!process.env.ANTHROPIC_API_KEY;

// ── Conecta o MCP Server em processo via InMemoryTransport ────
// Criamos UM par de transports por servidor — o MCP Server é stateless,
// então a mesma instância atende todos os requests.
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const mcpServer = createBankingServer(() => ({ profile: PROFILE }));
await mcpServer.connect(serverTransport);

// Inicializa Pluggy (no-op quando PLUGGY_CLIENT_ID não está definido)
await initPluggy();

const mcp = new Client({ name: 'fina-web-client', version: '1.0.0' }, { capabilities: {} });
await mcp.connect(clientTransport);

// Cache das tools para o Claude (convertidas do formato MCP → Anthropic).
const { tools: mcpTools } = await mcp.listTools();
const anthropicTools = mcpTools.map(({ name, description, inputSchema }) => ({
  name,
  description,
  input_schema: inputSchema,
}));

// ── RAG — busca semântica na knowledge base MEI/EI ────────────
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const QDRANT_URL     = (process.env.QDRANT_URL || '').trim();
const QDRANT_API_KEY = (process.env.QDRANT_API_KEY || '').trim();
const RAG_ENABLED    = !!(VOYAGE_API_KEY && QDRANT_URL && QDRANT_API_KEY);
const RAG_COLLECTION = 'mei-kb';
const RAG_TOP_K      = 5;

if (process.env.PLUGGY_CLIENT_ID) {
  anthropicTools.push({
    name: 'pluggy_initiate_consent',
    description:
      'Abre o widget Pluggy Connect para o usuário autorizar o acesso aos seus dados bancários ' +
      'reais via Open Finance. Use quando o usuário pedir para conectar o banco, vincular conta, ' +
      'ou quando os dados disponíveis são fictícios e o usuário quer dados reais. ' +
      'Após chamar esta tool, informe o usuário que o widget foi aberto na tela e ele deve ' +
      'seguir as instruções para concluir a autorização.',
    input_schema: { type: 'object', properties: {}, required: [] },
  });
}

if (RAG_ENABLED) {
  anthropicTools.push({
    name: 'mei_rag_search',
    description: 'Busca na base de conhecimento MEI/EI: legislação, limites de faturamento, ' +
      'DAS, DASN-SIMEI, desenquadramento, migração para ME, Simples Nacional, pró-labore, ' +
      'separação PF/PJ e obrigações fiscais. Use sempre que o usuário perguntar sobre ' +
      'regras do MEI, limites, teto de faturamento, impostos ou migração de regime.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Pergunta ou termos a buscar na base de conhecimento',
        },
      },
      required: ['query'],
    },
  });
}

async function ragSearch(query) {
  // 1. Embedding da query via Voyage AI
  const embRes = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'voyage-3-lite', input: [query], input_type: 'query' }),
  });
  if (!embRes.ok) throw new Error(`Voyage AI: ${await embRes.text()}`);
  const embData = await embRes.json();
  const vector = embData.data[0].embedding;

  // 2. Busca no Qdrant
  const srchRes = await fetch(`${QDRANT_URL}/collections/${RAG_COLLECTION}/points/search`, {
    method: 'POST',
    headers: {
      'api-key': QDRANT_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ vector, top: RAG_TOP_K, with_payload: true }),
  });
  if (!srchRes.ok) throw new Error(`Qdrant: ${await srchRes.text()}`);
  const srchData = await srchRes.json();

  // 3. Formata os chunks retornados
  const results = (srchData.result ?? []).map((r) => ({
    score: r.score,
    source: r.payload.source,
    text: r.payload.text,
  }));

  return JSON.stringify({ query, results });
}

// ── System prompt ─────────────────────────────────────────────
function buildSystem() {
  const realData = PROFILE === 'pluggy' && isPluggyReady();
  const dataCtx = realData
    ? 'Você está acessando dados REAIS de Open Finance do usuário, sincronizados via Pluggy. Nunca diga que são dados de demonstração ou fictícios — são dados bancários reais.'
    : 'Este ambiente usa dados fictícios de demonstração para fins de teste.';
  return [
  'Você é Fina, uma assistente financeira conversacional de uma plataforma white-label.',
  'Ajude o cliente a entender suas finanças: saldos, extratos, faturas, investimentos, PIX e análises de gastos.',
  'Use SEMPRE as ferramentas disponíveis para obter dados reais — nunca invente valores.',
  'Responda em português do Brasil, de forma clara, cordial e concisa.',
  'Ao apresentar valores monetários, use o formato R$ 0.000,00.',
  'Quando exibir listas de transações, agrupe por tipo ou período quando fizer sentido.',
  'Ofereça sempre um próximo passo útil após cada resposta.',
  dataCtx,

  'REGRA GERAL DE FORMATO: Em TODAS as respostas, sem exceção, é PROIBIDO usar markdown: sem **negrito**, sem _itálico_, sem ```código```, sem ## títulos, sem | tabelas |, sem hífens de lista, sem separadores ---. Escreva sempre em texto simples e direto.',

  'REGRA PARA GRÁFICOS E ANÁLISE DE GASTOS:',
  'Quando o usuário pedir gráfico, análise de gastos por categoria, breakdown ou distribuição de despesas:',
  '(1) Agrupe as transações em categorias semânticas legíveis — ex: "Alimentação", "Transporte", "Moradia", "Vestuário", "Serviços", "Lazer", "Saúde", "Educação", "Investimentos". Nunca use tipos técnicos como PIX ou TED como categoria.',
  '(2) Emita um bloco de dados estruturados NO INÍCIO da resposta, antes de qualquer texto, exatamente neste formato (sem quebras de linha dentro do bloco): <!--FINA_CHART:{"type":"spend","title":"Seus gastos","period":"D de mês - D de mês","total":0,"categories":[{"label":"Categoria","pct":30,"amount":0,"transactions":[{"name":"Estabelecimento","date":"YYYY-MM-DD","amount":0}]}],"suggestions":["pergunta follow-up 1","pergunta follow-up 2","pergunta follow-up 3"]}-->',
  '(3) Máximo 8 categorias, ordenadas por valor decrescente. pct deve somar ~100.',
  '(3b) Para cada categoria, inclua no campo "transactions" as top-3 transações que a compõem (name: nome do estabelecimento limpo, date: YYYY-MM-DD, amount: valor positivo). Se não tiver dados de transação disponíveis para uma categoria, omita o campo transactions dessa categoria.',
  '(4) As sugestões devem ser 3 perguntas curtas de follow-up contextuais ao que foi mostrado.',
  '(5) Após o bloco <!--FINA_CHART:-->, escreva APENAS UMA frase curta de resumo (ex: "Em julho você gastou R$ 23.118 — destaque para Cartão de Crédito (37%)."). PROIBIDO: tabelas markdown, listas com hífens, separadores ---, seções **Resumo por categoria**, sugestões em texto. Essas informações já estão no card visual — repeti-las é redundante e piora a experiência.',

  'REGRA PARA FATURA DO CARTÃO DE CRÉDITO:',
  'Quando o usuário pedir fatura, extrato do cartão, compras no cartão, bill ou quanto deve no cartão:',
  '(1) Consulte of_list_credit_cards para identificar o cartão, of_get_credit_card_limits para limite/últimos 4 dígitos, of_get_credit_card_bills para faturas.',
  '(2) Emita um bloco estruturado NO INÍCIO da resposta, antes de qualquer texto, exatamente neste formato (sem quebras de linha dentro do bloco): <!--FINA_BILL:{"holder":"NOME EM MAIÚSCULAS","number":"últimos 4 dígitos","expiry":"12/28","brand":"VISA","product":"VISA INFINITE","amount":0.00,"dueDate":"YYYY-MM-DD","minDue":0.00,"limit":0,"available":0}-->',
  '(3) holder: nome civil do titular (of_get_personal_identifications) em MAIÚSCULAS. number: campo identificationNumber dos limites do cartão PF. brand: creditCardNetwork em maiúsculas (VISA ou MASTERCARD). product: nome do produto sem o prefixo "BRADESCO " (ex: VISA INFINITE, MASTERCARD PLATINUM). minDue: aproximadamente 15% do total da fatura.',
  '(4) Após o bloco <!--FINA_BILL:-->, escreva APENAS UMA frase curta de resumo da fatura (ex: "Sua fatura de agosto é R$ 12.450 — vencimento dia 10."). PROIBIDO: tabelas markdown, listas, separadores ---.',

  'REGRA PARA CARTEIRA DE INVESTIMENTOS:',
  'Quando o usuário pedir lista de investimentos, carteira, portfólio, títulos, aplicações ou rendimentos:',
  '(1) Consulte of_list_investments para listar toda a carteira de investimentos. A ferramenta retorna todos os tipos: renda fixa (CDB, LCI, LCA, Tesouro), fundos e renda variável.',
  '(2) Emita NO INÍCIO da resposta, antes de qualquer texto: <!--FINA_INVEST:{"total":0,"items":[{"type":"CDB","label":"CDB Bradesco","value":0,"gross":0,"dueDate":"YYYY-MM-DD"},{"type":"LCI","label":"LCI","value":0,"taxFree":true,"dueDate":"YYYY-MM-DD"},{"type":"SELIC","label":"Tesouro Selic","value":0,"dueDate":"YYYY-MM-DD"},{"type":"FUND","label":"Nome do Fundo","value":0,"shares":0}],"suggestions":["follow-up 1","follow-up 2","follow-up 3"]}-->',
  '(3) Campos: type = um de CDB|LCI|LCA|SELIC|IPCA|PRFIX|FUND|STOCK|CRI|CRA|DEB. label = nome comercial limpo. value = valor líquido atual. gross = valor bruto antes de IR/IOF (omitir se igual a value ou não disponível). taxFree:true apenas para LCI/LCA/CRI/CRA. dueDate YYYY-MM-DD. shares para fundos quando disponível.',
  '(4) Calcule total como soma dos values. Após o bloco <!--FINA_INVEST:-->, escreva APENAS UMA frase curta de resumo. PROIBIDO: tabelas markdown, listas com hífens, separadores ---.',

  'REGRA PARA PERGUNTAS SOBRE MEI, LIMITES, IMPOSTOS E MIGRAÇÃO:',
  'Quando o usuário perguntar sobre: limite do MEI, teto de faturamento, DAS, DASN-SIMEI, desenquadramento, migração para ME, Simples Nacional, pró-labore, separação PF/PJ, obrigações fiscais, CNAE ou qualquer regra tributária do empreendedor individual:',
  '(1) SEMPRE use a tool mei_rag_search para buscar a informação correta antes de responder.',
  '(2) Baseie a resposta exclusivamente no que retornar da busca — não invente valores ou prazos.',
  '(3) Cite a fonte quando relevante (ex: "Conforme LC 128/2008...").',
  '(4) Se o contexto retornado não for suficiente, informe ao usuário que a informação não foi encontrada na base e sugira consultar um contador ou gov.br/mei.',
  ].join(' ');
}

// ── Express ───────────────────────────────────────────────────
const app = express();

// ─────────────────────────────────────────────────────────────
// POST /api/pluggy/webhook
// Recebe eventos Pluggy (item/created, item/updated,
// transactions/created, transactions/updated, transactions/deleted).
// Registre este endpoint no dashboard Pluggy → Configurações → Webhooks.
//
// Variável de ambiente opcional:
//   PLUGGY_WEBHOOK_SECRET  — segredo definido no dashboard; ativa
//                            verificação de assinatura HMAC-SHA256.
// ─────────────────────────────────────────────────────────────
const PLUGGY_REFRESH_EVENTS = new Set([
  'item/created', 'item/updated', 'item/error',
  'transactions/created', 'transactions/updated', 'transactions/deleted',
]);

app.post(
  '/api/pluggy/webhook',
  express.raw({ type: 'application/json', limit: '256kb' }),
  async (req, res) => {
    const secret = process.env.PLUGGY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['pluggy-signature'] ?? '';
      const expected = createHmac('sha256', secret).update(req.body).digest('hex');
      try {
        if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
          console.warn('[pluggy/webhook] assinatura inválida');
          return res.status(401).json({ error: 'assinatura inválida' });
        }
      } catch {
        return res.status(401).json({ error: 'assinatura inválida' });
      }
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'body inválido' });
    }

    const { event, itemId } = payload ?? {};
    const willRefresh = !!(itemId && PLUGGY_REFRESH_EVENTS.has(event));
    log('info', 'webhook/pluggy', { event, itemId, willRefresh });

    // Responde imediatamente para Pluggy não marcar como falha.
    res.json({ received: true });

    if (willRefresh) {
      refreshPluggy(itemId).catch((err) =>
        log('error', 'webhook/pluggy_refresh_error', { itemId, error: err.message }),
      );
    }
  },
);

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
    pluggyEnabled: !!process.env.PLUGGY_CLIENT_ID,
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/profiles — lista perfis disponíveis (Pluggy real + mocks)
// POST /api/switch-profile — troca o perfil ativo (sem reiniciar)
// ─────────────────────────────────────────────────────────────
app.get('/api/profiles', (_req, res) => {
  const all = listProfiles();
  const profiles = all.map((p) => ({
    id: p.id,
    label: p.primeiro ?? p.nome,
    desc: p.real
      ? `${p.nome} · dados reais Open Finance`
      : `${p.nome} · ${p.tipo}`,
    real: p.real ?? false,
  }));
  res.json({ current: PROFILE, profiles });
});

app.post('/api/switch-profile', (req, res) => {
  const allowed = listProfiles().map((p) => p.id);
  const { profile } = req.body ?? {};
  if (!profile || !allowed.includes(profile)) {
    return res.status(400).json({ error: 'Invalid profile' });
  }
  PROFILE = profile;
  res.json({ profile: PROFILE });
});

// ─────────────────────────────────────────────────────────────
// GET /api/pluggy/connect-token
// Retorna um connect token temporário para abrir o Pluggy Connect Widget.
// ─────────────────────────────────────────────────────────────
app.get('/api/pluggy/connect-token', async (_req, res) => {
  const clientId     = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(404).json({ error: 'Pluggy não configurado neste ambiente' });
  }
  try {
    const { PluggyClient } = await import('../mcp/pluggy/pluggy-client.js');
    const client = new PluggyClient(clientId, clientSecret);
    const connectToken = await client.getConnectToken();
    res.json({ connectToken });
  } catch (err) {
    console.error('[pluggy/connect-token]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /pluggy-consent
// Página standalone aberta pelo usuário vindo do Claude.ai / Claude Desktop.
// Carrega o SDK Pluggy, abre o widget automaticamente e sincroniza o perfil.
// ─────────────────────────────────────────────────────────────
app.get('/pluggy-consent', (_req, res) => {
  const hasPluggy = !!(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectar banco — Fina</title>
<script src="/js/pluggy-connect-sdk.js"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0f0f13;
    color: #e8e8f0;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    padding: 2rem;
  }
  .logo { font-size: 2rem; font-weight: 800; letter-spacing: -0.04em; color: #fff; }
  .logo span { color: #7c6af7; }
  .card {
    background: #1a1a24;
    border: 1px solid #2a2a38;
    border-radius: 16px;
    padding: 2rem 2.5rem;
    max-width: 420px;
    width: 100%;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .status-icon { font-size: 2.5rem; }
  h2 { font-size: 1.25rem; font-weight: 700; }
  p { color: #8888a8; font-size: 0.9rem; line-height: 1.6; }
  .btn {
    margin-top: 0.5rem;
    background: #7c6af7;
    color: #fff;
    border: none;
    border-radius: 10px;
    padding: 0.75rem 1.5rem;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    width: 100%;
    transition: opacity .15s;
  }
  .btn:hover { opacity: .85; }
  .btn:disabled { opacity: .4; cursor: default; }
  .spinner {
    width: 36px; height: 36px;
    border: 3px solid #2a2a38;
    border-top-color: #7c6af7;
    border-radius: 50%;
    animation: spin .8s linear infinite;
    margin: 0 auto;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="logo">fi<span>na</span></div>
<div class="card" id="card">
  <div class="spinner" id="spinner"></div>
  <h2 id="title">Preparando widget…</h2>
  <p id="desc">Aguarde enquanto carregamos o ambiente de consentimento.</p>
</div>

<script>
${!hasPluggy ? `
  document.getElementById('spinner').style.display = 'none';
  document.getElementById('title').textContent = 'Integração não configurada';
  document.getElementById('desc').textContent = 'As credenciais Pluggy não estão configuradas neste servidor.';
` : `
(function () {
  var widget = null;

  function setState(icon, title, desc, btnLabel, btnFn) {
    var card = document.getElementById('card');
    var sp   = document.getElementById('spinner');
    if (sp) sp.style.display = 'none';
    card.innerHTML =
      '<div class="status-icon">' + icon + '</div>' +
      '<h2>' + title + '</h2>' +
      '<p>' + desc + '</p>' +
      (btnLabel ? '<button class="btn" onclick="(' + btnFn.toString() + ')()">'+btnLabel+'</button>' : '');
  }

  function sync(itemId) {
    setState('⏳', 'Sincronizando…', 'Estamos importando seus dados bancários.', null, null);
    fetch('/api/pluggy/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: itemId }),
    })
    .then(function(r) { return r.json(); })
    .then(function(res) {
      if (res.ok) {
        setState('✅', 'Conta conectada!',
          'Seus dados bancários foram importados com sucesso. Volte ao Claude e pergunte sobre seu saldo, investimentos ou gastos.',
          'Fechar esta aba', function() { window.close(); });
      } else {
        setState('⚠️', 'Erro ao sincronizar', res.error || 'Não foi possível importar os dados.',
          'Tentar novamente', function() { location.reload(); });
      }
    })
    .catch(function(err) {
      setState('⚠️', 'Erro de rede', err.message,
        'Tentar novamente', function() { location.reload(); });
    });
  }

  function openWidget(connectToken) {
    if (!window.PluggyConnectSDK || !window.PluggyConnectSDK.PluggyConnect) {
      setState('⚠️', 'SDK não carregou', 'Recarregue a página e tente novamente.',
        'Recarregar', function() { location.reload(); });
      return;
    }
    document.getElementById('title').textContent = 'Autorizando acesso…';
    document.getElementById('desc').textContent = 'Siga as instruções no widget para conectar sua conta.';

    widget = new window.PluggyConnectSDK.PluggyConnect({
      connectToken: connectToken,
      includeSandbox: true,
      onSuccess: function(itemData) {
        var itemId = (itemData && itemData.item && itemData.item.id) || (itemData && itemData.id);
        if (widget) { try { widget.destroy(); } catch(_) {} widget = null; }
        if (!itemId) {
          setState('⚠️', 'itemId ausente', 'Conexão realizada mas itemId não retornado. Feche e tente novamente.',
            'Fechar', function() { window.close(); });
          return;
        }
        sync(itemId);
      },
      onError: function(err) {
        setState('⚠️', 'Erro no widget', (err && err.message) || 'Tente novamente.',
          'Tentar novamente', function() { location.reload(); });
      },
      onClose: function() {
        if (!document.getElementById('spinner') || document.getElementById('spinner').style.display === 'none') return;
        setState('ℹ️', 'Widget fechado', 'Você fechou o widget antes de autorizar.',
          'Tentar novamente', function() { location.reload(); });
      },
    });
    widget.init();
  }

  fetch('/api/pluggy/connect-token')
    .then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'HTTP ' + r.status); });
      return r.json();
    })
    .then(function(d) {
      if (!d.connectToken) throw new Error('connectToken ausente');
      openWidget(d.connectToken);
    })
    .catch(function(err) {
      setState('⚠️', 'Não foi possível iniciar', err.message,
        'Tentar novamente', function() { location.reload(); });
    });
}());
`}
</script>
</body>
</html>`);
});

// ─────────────────────────────────────────────────────────────
// POST /api/pluggy/connect
// Body: { itemId: string }
// Chamado após o usuário autorizar no Pluggy Connect Widget.
// Atualiza o perfil Pluggy em cache e troca para o perfil 'pluggy'.
// ─────────────────────────────────────────────────────────────
app.post('/api/pluggy/connect', async (req, res) => {
  const { itemId } = req.body ?? {};
  if (!itemId) return res.status(400).json({ error: 'itemId obrigatório' });
  try {
    await refreshPluggy(itemId);
    PROFILE = 'pluggy';
    log('info', 'consent/completed', { channel: req.headers['x-fina-channel'] ?? 'fina-web', itemId });
    res.json({ ok: true, profile: 'pluggy' });
  } catch (err) {
    log('error', 'consent/error', { itemId, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /pluggy-callback
// Pluggy Connect Widget redireciona aqui após o usuário autorizar.
// Serve uma página leve que notifica a aba principal via BroadcastChannel.
// ─────────────────────────────────────────────────────────────
app.get('/pluggy-callback', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectando conta…</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f1117;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .box{text-align:center;padding:40px 32px;max-width:360px}
  .spinner{width:44px;height:44px;border:3px solid #2d3748;border-top-color:#3D7FEE;border-radius:50%;animation:spin .9s linear infinite;margin:0 auto 24px}
  @keyframes spin{to{transform:rotate(360deg)}}
  p{font-size:15px;color:#a0aec0;line-height:1.6}
  .ok{color:#68d391;font-size:22px;margin-bottom:16px}
  .err{color:#fc8181}
</style>
</head>
<body>
<div class="box">
  <div class="spinner" id="spinner"></div>
  <p id="msg">Sincronizando sua conta…</p>
</div>
<script>
(function () {
  var params  = new URLSearchParams(location.search);
  var itemId  = params.get('itemId');
  var spinner = document.getElementById('spinner');
  var msg     = document.getElementById('msg');

  if (!itemId) {
    spinner.style.display = 'none';
    msg.innerHTML = '<span class="err">Erro: itemId não encontrado na URL.</span>';
    return;
  }

  fetch('/api/pluggy/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId: itemId })
  })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    if (data.ok) {
      spinner.style.display = 'none';
      msg.innerHTML = '<div class="ok">✓</div>Conta conectada!<br>Fechando esta janela…';
      try {
        var bc = new BroadcastChannel('pluggy-connect');
        bc.postMessage({ type: 'pluggy-connected' });
        bc.close();
      } catch (_) {}
      setTimeout(function () { window.close(); }, 1200);
    } else {
      spinner.style.display = 'none';
      msg.innerHTML = '<span class="err">Erro ao sincronizar: ' + (data.error || 'tente novamente') + '</span>';
    }
  })
  .catch(function (err) {
    spinner.style.display = 'none';
    msg.innerHTML = '<span class="err">Erro de rede: ' + err.message + '</span>';
  });
}());
</script>
</body>
</html>`);
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
      mcpCall('of_list_investments'),
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
      accounts: { count: accounts.length + cardsList.length },
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

  const channel = req.headers['x-fina-channel'] ?? 'fina-web';
  const t0Chat = Date.now();
  const lastUserMsg = [...incoming].reverse().find((m) => m.role === 'user')?.content ?? '';
  const msgPreview = String(lastUserMsg).slice(0, 120);
  log('info', 'chat/start', { channel, profile: PROFILE, msgPreview });

  const client = new Anthropic();

  // Copia as mensagens para o array mutável do loop.
  const messages = incoming.map((m) => ({ role: m.role, content: m.content }));
  let fullText = '';
  const toolsUsed = [];

  try {
    // Loop agêntico: até 8 iterações (proteção contra loops infinitos).
    for (let i = 0; i < 8; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system: buildSystem(),
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
        log('info', 'chat/done', { channel, profile: PROFILE, totalDurationMs: Date.now() - t0Chat, toolsUsed, iterations: i + 1 });
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
        toolsUsed.push(block.name);
        const tTool = Date.now();

        let resultText;
        let toolOk = true;
        try {
          if (block.name === 'pluggy_initiate_consent') {
            const pluggyId     = process.env.PLUGGY_CLIENT_ID;
            const pluggySecret = process.env.PLUGGY_CLIENT_SECRET;
            if (!pluggyId || !pluggySecret) {
              resultText = JSON.stringify({ erro: 'Pluggy não configurado neste ambiente.' });
              toolOk = false;
            } else {
              const { PluggyClient } = await import('../mcp/pluggy/pluggy-client.js');
              const pluggyClient = new PluggyClient(pluggyId, pluggySecret);
              const connectToken = await pluggyClient.getConnectToken();
              send({ type: 'pluggy_connect', connectToken });
              log('info', 'consent/initiated', { channel, trigger: 'chat' });
              resultText = JSON.stringify({
                ok: true,
                message: 'Widget de consentimento aberto. Informe o usuário que deve seguir as instruções no widget para autorizar o acesso aos dados bancários.',
              });
            }
          } else if (block.name === 'mei_rag_search') {
            resultText = await ragSearch(block.input?.query ?? '');
          } else {
            const mcpResult = await mcp.callTool({ name: block.name, arguments: block.input ?? {} });
            resultText = mcpResult.content?.[0]?.text ?? '{}';
          }
        } catch (err) {
          toolOk = false;
          resultText = JSON.stringify({ erro: err?.message ?? 'Falha na tool' });
        }

        log('info', 'chat/tool_call', { channel, tool: block.name, durationMs: Date.now() - tTool, ok: toolOk });

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
    log('error', 'chat/error', { channel, profile: PROFILE, totalDurationMs: Date.now() - t0Chat, toolsUsed, error: err?.message });
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
    of_list_investments:          'Consultando carteira de investimentos…',
    of_get_bank_fixed_income:     'Carregando detalhes do título…',
    of_get_bank_fixed_income_transactions: 'Buscando movimentações do título…',
    of_list_treasure_titles:      'Consultando Tesouro Direto…',
    of_get_treasure_title:        'Carregando título do Tesouro…',
    of_list_funds:                'Listando fundos de investimento…',
    of_get_fund:                  'Carregando dados do fundo…',
    analytics_cross_pf_pj:        'Consolidando posição PF + MEI…',
    analytics_spend_by_category:  'Analisando gastos por categoria…',
    mei_rag_search:               'Consultando base de conhecimento MEI/EI…',
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
        of_list_investments: 'investimento',
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

// ─────────────────────────────────────────────────────────────
// POST /api/agents/run
// Body: { agentId: 'revenue-monitor' }
// ─────────────────────────────────────────────────────────────
app.post('/api/agents/run', async (req, res) => {
  const { agentId } = req.body ?? {};
  if (agentId === 'revenue-monitor') {
    try {
      const result = await runRevenueMonitor();
      res.json(result);
    } catch (err) {
      console.error('[agent:revenue-monitor]', err?.message);
      res.status(500).json({ error: err?.message ?? 'Erro interno' });
    }
  } else {
    res.status(400).json({ error: 'Agente não encontrado: ' + agentId });
  }
});

const MEI_LIMIT_2025 = 130500;

async function runRevenueMonitor() {
  const currentYear = new Date().getFullYear();
  const fromDate = `${currentYear}-01-01`;

  const accountsEnv = await mcpCall('of_list_accounts');
  const accounts = Array.isArray(accountsEnv.data) ? accountsEnv.data : [];

  // Prefer PJ accounts; fall back to all accounts
  const pjAccounts = accounts.filter((a) => a.ownerType === 'PESSOA_JURIDICA');
  const targets = pjAccounts.length > 0 ? pjAccounts : accounts;

  let totalRevenue = 0;
  for (const account of targets) {
    const txEnv = await mcpCall('of_get_account_transactions', {
      accountId: account.accountId,
      fromBookingDate: fromDate,
      pageSize: 200,
    });
    const txs = Array.isArray(txEnv.data) ? txEnv.data : [];
    const credits = txs
      .filter((t) => t.creditDebitType === 'CREDITO')
      .reduce((sum, t) => sum + Number(t.transactionAmount?.amount ?? 0), 0);
    totalRevenue += credits;
  }

  const pct = Math.round((totalRevenue / MEI_LIMIT_2025) * 100);
  const remaining = MEI_LIMIT_2025 - totalRevenue;

  let level, title, message;
  if (pct >= 100) {
    level = 'crit';
    title = 'Limite ultrapassado!';
    message = `Faturamento acumulado em ${currentYear}: ${agFmt(totalRevenue)}. O limite do MEI é ${agFmt(MEI_LIMIT_2025)} e você está ${agFmt(totalRevenue - MEI_LIMIT_2025)} acima. Consulte um contador para regularizar e avaliar a migração para ME.`;
  } else if (pct >= 85) {
    level = 'crit';
    title = `${pct}% do limite atingido`;
    message = `Faturamento em ${currentYear}: ${agFmt(totalRevenue)}. Restam apenas ${agFmt(remaining)} até o teto (${agFmt(MEI_LIMIT_2025)}). Recomendamos consultar um contador para planejar a migração para ME.`;
  } else if (pct >= 70) {
    level = 'warn';
    title = `${pct}% do limite atingido`;
    message = `Faturamento em ${currentYear}: ${agFmt(totalRevenue)}. Restam ${agFmt(remaining)} até o limite anual. Atenção: se ultrapassar 20% do limite no mês, o enquadramento no MEI é encerrado retroativamente.`;
  } else {
    level = 'ok';
    title = `${pct}% do limite utilizado`;
    message = `Faturamento acumulado em ${currentYear}: ${agFmt(totalRevenue)}. Você ainda tem ${agFmt(remaining)} de margem até o teto anual do MEI (${agFmt(MEI_LIMIT_2025)}).`;
  }

  return { level, title, message, pct, revenue: totalRevenue, limit: MEI_LIMIT_2025, remaining };
}

function agFmt(value) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

app.listen(PORT, () => {
  console.log(`\nFina Web Client rodando em http://localhost:${PORT}`);
  console.log(`  Modelo  : ${MODEL}`);
  console.log(`  Perfil  : ${PROFILE}`);
  console.log(`  API key : ${hasKey ? '✓ configurada' : '✗ AUSENTE — defina ANTHROPIC_API_KEY'}`);
  console.log(`  Tools   : ${mcpTools.length} disponíveis via Banking MCP Server\n`);
});
