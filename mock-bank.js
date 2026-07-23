// ─────────────────────────────────────────────────────────────
// Mock Bank — dados fictícios de saldo, extrato, gastos e PIX.
//
// Em produção, cada função aqui bateria no Core Bancário Bradesco
// via Axway, usando o token do usuário autenticado (Authorization
// Code + PKCE). Aqui devolvemos dados estáticos para a demo.
// ─────────────────────────────────────────────────────────────

export const CONTA = {
  ag: '1234-5',
  conta: '56789-0',
  disponivel: 8427.63,
  bloqueado: 120.0,
  limite: 5000.0,
};

const EXTRATO = [
  {
    day: 'Hoje · 23 jul',
    items: [
      { desc: 'PIX recebido · João P. Silva', cat: 'Transferência', val: 1200.0, dir: 'in', ic: '⚡' },
      { desc: 'Netflix.com', cat: 'Assinaturas', val: -44.9, dir: 'out', ic: '🎬' },
    ],
  },
  {
    day: 'Ontem · 22 jul',
    items: [
      { desc: 'Supermercado Pão de Açúcar', cat: 'Compra no débito', val: -342.18, dir: 'out', ic: '🛒' },
      { desc: 'iFood · Pedido #8842', cat: 'Alimentação', val: -78.5, dir: 'out', ic: '🍔' },
      { desc: 'Uber · Viagem', cat: 'Transporte', val: -23.4, dir: 'out', ic: '🚗' },
    ],
  },
  {
    day: '21 jul',
    items: [
      { desc: 'PIX enviado · Maria Souza', cat: 'Transferência', val: -500.0, dir: 'out', ic: '⚡' },
      { desc: 'Salário · Empresa XPTO Ltda', cat: 'Crédito em conta', val: 6500.0, dir: 'in', ic: '💼' },
    ],
  },
];

const PIX = [
  { desc: 'Recebido · João P. Silva', val: 1200.0, dir: 'in', when: 'Hoje 08:12', ic: '⚡' },
  { desc: 'Enviado · Maria Souza', val: -500.0, dir: 'out', when: '21 jul 19:40', ic: '⚡' },
  { desc: 'Enviado · Padaria do Zé', val: -32.0, dir: 'out', when: '20 jul 07:55', ic: '⚡' },
];

const GASTOS = [
  { cat: 'Alimentação', val: 721.08, color: '#CC092F', pct: 38 },
  { cat: 'Transporte', val: 284.3, color: '#ff7a45', pct: 15 },
  { cat: 'Assinaturas', val: 189.7, color: '#9b87f5', pct: 10 },
  { cat: 'Mercado', val: 642.18, color: '#4ea8de', pct: 34 },
];
const GASTO_TOTAL = 1837.26;

// Soma entradas/saídas do extrato (para o modelo ter os totais)
function totais(grupos) {
  let entradas = 0;
  let saidas = 0;
  for (const g of grupos) {
    for (const it of g.items) {
      if (it.val >= 0) entradas += it.val;
      else saidas += Math.abs(it.val);
    }
  }
  return { entradas: Number(entradas.toFixed(2)), saidas: Number(saidas.toFixed(2)) };
}

// ── "Executores" das tools ──────────────────────────────────────
// Cada um simula uma chamada Axway. Recebe o input parseado da tool
// e devolve { data, meta } — data alimenta o card no front, meta é
// o rótulo técnico (método/endpoint/latência) exibido no chip.

export const executores = {
  consultar_saldo() {
    return {
      data: { ...CONTA },
      meta: 'GET /contas/v1/saldo · apiId core-bancario-api · 312ms',
    };
  },

  consultar_extrato(input = {}) {
    const dias = input.dias ?? 3;
    const { entradas, saidas } = totais(EXTRATO);
    return {
      data: { dias, grupos: EXTRATO, entradas, saidas, conta: CONTA.conta },
      meta: `GET /contas/v1/extrato?dias=${dias} · apiId core-bancario-api · 287ms`,
    };
  },

  consultar_gastos(input = {}) {
    return {
      data: { periodo: input.periodo ?? '2026-07', gastos: GASTOS, total: GASTO_TOTAL, maior: 'Alimentação' },
      meta: 'GET /contas/v1/extrato?periodo=2026-07 · agregação por categoria · 341ms',
    };
  },

  consultar_pix() {
    const enviados = PIX.filter((p) => p.dir === 'out').length;
    const recebidos = PIX.filter((p) => p.dir === 'in').length;
    return {
      data: { pix: PIX, enviados, recebidos, conta: CONTA.conta },
      meta: 'GET /contas/v1/extrato?tipo=PIX · apiId core-bancario-api · 264ms',
    };
  },
};

// ── Definição das tools no formato da API da Anthropic ──────────
export const tools = [
  {
    name: 'consultar_saldo',
    description:
      'Retorna o saldo disponível e bloqueado da conta corrente do usuário autenticado, além do limite do cheque especial. Use quando o usuário perguntar sobre saldo, quanto tem na conta ou quanto está disponível.',
    input_schema: {
      type: 'object',
      properties: {
        tipo_conta: { type: 'string', enum: ['corrente', 'poupanca'], description: 'Tipo de conta a consultar.' },
      },
    },
  },
  {
    name: 'consultar_extrato',
    description:
      'Retorna as movimentações (lançamentos) da conta em um período recente, com créditos e débitos. Use quando o usuário pedir extrato, movimentações, últimos lançamentos ou histórico.',
    input_schema: {
      type: 'object',
      properties: {
        dias: { type: 'integer', description: 'Janela do extrato em dias. Ex: 3, 7, 30.' },
      },
    },
  },
  {
    name: 'consultar_gastos',
    description:
      'Retorna os gastos do mês agregados por categoria (alimentação, transporte, etc.) e o total. Use quando o usuário perguntar quanto gastou, sobre despesas ou gastos por categoria.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', description: 'Mês no formato AAAA-MM. Ex: 2026-07.' },
      },
    },
  },
  {
    name: 'consultar_pix',
    description:
      'Retorna as movimentações PIX recentes (enviados e recebidos). Use quando o usuário perguntar sobre PIX.',
    input_schema: { type: 'object', properties: {} },
  },
];
