// ─────────────────────────────────────────────────────────────
// Catálogo OFICIAL de tools do Bradesco MCP Connector.
//
// Baseado na "Especificação Técnica v1.0 — Bradesco MCP Connector"
// (Bradesco Open Platform & BaaS). Cobre os 4 domínios da spec:
//   Conta & Saldo · PIX · Open Finance · Produtos Bancários.
//
// Cada tool traz `title` e ANOTAÇÕES (readOnlyHint/destructiveHint,
// openWorldHint) exigidas pelo Connectors Directory, e schema JSON.
//
// Fase 1 (submissão): apenas tools READONLY.
// Fase 2 (destructive): initiate_pix_transfer, revoke_consent — aqui incluídas
//   com destructiveHint, confirmação obrigatória e execução SIMULADA (mock).
//
// Minimização de dados (LGPD / Res. BCB): NÃO expomos número completo de
// conta, agência, CPF nem PAN de cartão — todos mascarados.
//
// Reaproveita os geradores ricos do mock-bank.js (extrato, fatura).
// ─────────────────────────────────────────────────────────────

import { CONTA, executores as mock } from '../mock-bank.js';

const AGORA = '2026-07-23T09:12:00-03:00';
const money = (n) => Number(Number(n).toFixed(2));

// ── Mock dos domínios sem gerador dedicado ──
const CONTAS = [
  { id: 'acc-cc-001', agencia_mascarada: '12**-*', numero_mascarado: '****9-0', tipo: 'corrente', status: 'ativa', titular_mascarado: 'R**** S****', limite_credito: CONTA.limite },
  { id: 'acc-poup-001', agencia_mascarada: '12**-*', numero_mascarado: '****1-2', tipo: 'poupança', status: 'ativa' },
];

const PIX_KEYS = [
  { tipo: 'CPF', chave_mascarada: '***.***.789-**', status: 'ativa', criada_em: '2024-03-10' },
  { tipo: 'email', chave_mascarada: 'r****@gmail.com', status: 'ativa', criada_em: '2024-05-22' },
  { tipo: 'celular', chave_mascarada: '+55 11 9****-**89', status: 'ativa', criada_em: '2023-11-02' },
  { tipo: 'EVP', chave_mascarada: 'a1b2c3**-****-****-****-**********', status: 'ativa', criada_em: '2025-01-15' },
];

const CONSENTIMENTOS = [
  { consent_id: 'urn:bradesco:consent:9f8a4b21', organizacao: 'Fintech XYZ', status: 'ativo', escopos: ['accounts', 'credit-cards-accounts'], criado_em: '2026-05-01', expira_em: '2026-11-01' },
  { consent_id: 'urn:bradesco:consent:2c1d77ee', organizacao: 'Investimentos ABC', status: 'ativo', escopos: ['investments'], criado_em: '2026-06-12', expira_em: '2026-12-12' },
  { consent_id: 'urn:bradesco:consent:77ee9012', organizacao: 'Seguros Delta', status: 'expirado', escopos: ['accounts'], criado_em: '2025-10-01', expira_em: '2026-04-01' },
];

const CREDIT_DATA = {
  limite_total: 15000.0,
  limite_utilizado: 4380.55,
  limite_disponivel: 10619.45,
  score_faixa: 'A',
  juros_rotativo_am: 0.1275,
  historico_utilizacao: [
    { mes: '2026-02', pct: 22 }, { mes: '2026-03', pct: 35 }, { mes: '2026-04', pct: 41 },
    { mes: '2026-05', pct: 29 }, { mes: '2026-06', pct: 33 }, { mes: '2026-07', pct: 29 },
  ],
};

const INVESTIMENTOS = {
  total: 198734.11,
  moeda: 'BRL',
  atualizado_em: '2026-07-23',
  renda_fixa: { valor: 132500.0, produtos: [{ nome: 'CDB Bradesco 110% CDI', valor: 80000.0 }, { nome: 'Tesouro Selic 2029', valor: 52500.0 }] },
  renda_variavel: { valor: 41004.93, produtos: [{ nome: 'Ações (B3)', valor: 26004.93 }, { nome: 'Fundos Imobiliários', valor: 15000.0 }] },
  previdencia: { valor: 25229.18, produtos: [{ nome: 'VGBL Bradesco', valor: 25229.18 }] },
};

const PRODUTOS = [
  { tipo: 'conta_corrente', nome: 'Conta Corrente Bradesco', status: 'ativo' },
  { tipo: 'cartao_credito', nome: 'Cartão Bradesco Visa Infinite', status: 'ativo', anuidade: 1188.0 },
  { tipo: 'emprestimo', nome: 'Crédito Pessoal', status: 'ativo' },
  { tipo: 'seguro', nome: 'Seguro Auto Bradesco', status: 'ativo' },
  { tipo: 'previdencia', nome: 'VGBL Bradesco', status: 'ativo' },
  { tipo: 'investimento', nome: 'CDB / Tesouro Direto', status: 'ativo' },
];

const EMPRESTIMOS = [
  { contrato: 'CTR-2025-004417', tipo: 'Crédito Pessoal', valor_contratado: 20000.0, saldo_devedor: 11480.32, parcelas_totais: 24, parcelas_pagas: 9, taxa_am: 0.0189, proxima_parcela: { valor: 962.15, vencimento: '2026-08-10' } },
  { contrato: 'CTR-2024-118820', tipo: 'Financiamento de Veículo', valor_contratado: 68000.0, saldo_devedor: 39210.77, parcelas_totais: 48, parcelas_pagas: 20, taxa_am: 0.0155, proxima_parcela: { valor: 1740.4, vencimento: '2026-08-05' } },
];

// ── Executores ──────────────────────────────────────────────
export const executores = {
  // Domínio: Conta & Saldo
  get_account_balance(input = {}) {
    let contas = [
      { id: 'acc-cc-001', tipo: 'corrente', disponivel: CONTA.disponivel, bloqueado: CONTA.bloqueado, total: money(CONTA.disponivel + CONTA.bloqueado), moeda: 'BRL', atualizado_em: AGORA },
      { id: 'acc-poup-001', tipo: 'poupança', disponivel: CONTA.poupanca, bloqueado: 0, total: CONTA.poupanca, moeda: 'BRL', atualizado_em: AGORA },
    ];
    if (input.account_id) contas = contas.filter((c) => c.id === input.account_id);
    return { data: { accounts: contas }, meta: 'GET /openfinance/accounts/v2/balances · Axway · 214ms' };
  },

  get_account_statement(input = {}) {
    const grupos = mock.consultar_extrato({ dias: 180 }).data.grupos;
    let lanc = grupos.flatMap((g) =>
      g.items.map((it) => ({
        data: g.date,
        descricao: it.desc,
        categoria: it.cat,
        valor: it.val,
        tipo: it.val >= 0 ? 'credito' : 'debito',
      })),
    );
    if (input.data_inicio) lanc = lanc.filter((l) => l.data >= input.data_inicio);
    if (input.data_fim) lanc = lanc.filter((l) => l.data <= input.data_fim);
    if (input.tipo) lanc = lanc.filter((l) => l.tipo === input.tipo);
    if (input.valor_min != null) lanc = lanc.filter((l) => Math.abs(l.valor) >= input.valor_min);
    if (input.valor_max != null) lanc = lanc.filter((l) => Math.abs(l.valor) <= input.valor_max);

    const pagina = Math.max(1, input.pagina ?? 1);
    const tam = Math.min(100, input.tamanho_pagina ?? 20);
    const total = lanc.length;
    const inicio = (pagina - 1) * tam;
    const pageItems = lanc.slice(inicio, inicio + tam);
    return {
      data: { pagina, tamanho_pagina: tam, total, total_paginas: Math.ceil(total / tam) || 1, lancamentos: pageItems },
      meta: 'GET /openfinance/accounts/v2/transactions · Axway · 331ms',
    };
  },

  get_account_details() {
    return { data: { accounts: CONTAS }, meta: 'GET /openfinance/accounts/v2/identification · Axway · 189ms' };
  },

  // Domínio: PIX
  get_pix_keys() {
    return { data: { chaves: PIX_KEYS, total: PIX_KEYS.length }, meta: 'GET /pix/dict/v2/keys · Axway · 156ms' };
  },

  get_pix_transactions(input = {}) {
    let pix = mock.consultar_pix().data.pix.map((p) => ({
      descricao: p.desc,
      valor: p.val,
      direcao: p.dir === 'in' ? 'recebido' : 'enviado',
      quando: p.when,
    }));
    if (input.direcao) pix = pix.filter((p) => p.direcao === input.direcao);
    if (input.top) pix = pix.slice(0, input.top);
    return { data: { transacoes: pix, total: pix.length }, meta: 'GET /pix/spi/v2/transactions · Axway · 241ms' };
  },

  consult_pix_key(input = {}) {
    if (!input.chave) return { data: { erro: 'parâmetro "chave" é obrigatório.' }, meta: 'GET /pix/dict/v2/entries · Axway · 98ms' };
    return {
      data: { chave: input.chave, tipo: 'email', titular_mascarado: 'M**** S****', instituicao: 'Banco Bradesco S.A.', ispb: '60746948', status: 'ativa' },
      meta: 'GET /pix/dict/v2/entries · Axway · 173ms',
    };
  },

  // Domínio: Open Finance
  list_consents() {
    return { data: { consentimentos: CONSENTIMENTOS, ativos: CONSENTIMENTOS.filter((c) => c.status === 'ativo').length }, meta: 'GET /openfinance/consents/v2 · Axway · 132ms' };
  },

  get_credit_data() {
    return { data: CREDIT_DATA, meta: 'GET /openfinance/credit/v2/limits · Axway · 205ms' };
  },

  get_investments_summary() {
    return { data: INVESTIMENTOS, meta: 'GET /openfinance/investments/v1/portfolio · Axway · 288ms' };
  },

  // Domínio: Produtos Bancários
  list_products() {
    return { data: { produtos: PRODUTOS, total: PRODUTOS.length }, meta: 'GET /products/v1/catalog · Axway · 121ms' };
  },

  get_card_details() {
    const f = mock.consultar_fatura({}).data.fatura_atual;
    return {
      data: {
        cartao_mascarado: '**** **** **** 1234',
        bandeira: 'Visa Infinite',
        limite: 45000.0,
        limite_disponivel: f.limite_disponivel,
        fatura_atual: { competencia: f.competencia, total: f.total, vencimento: f.vencimento, status: f.status, qtd_lancamentos: f.qtd_lancamentos },
        melhor_dia_compra: 3,
      },
      meta: 'GET /products/v1/cards/details · Axway · 197ms',
    };
  },

  get_loan_details() {
    return { data: { contratos: EMPRESTIMOS, total: EMPRESTIMOS.length }, meta: 'GET /products/v1/loans · Axway · 176ms' };
  },

  // ── Fase 2 — DESTRUCTIVE (simuladas, com confirmação obrigatória) ──
  initiate_pix_transfer(input = {}) {
    const { chave_destino, valor, descricao, confirmacao } = input;
    if (!chave_destino || !valor || valor <= 0) {
      return { data: { erro: 'Informe "chave_destino" e "valor" (> 0).' }, meta: 'POST /pix/spi/v2/payments · validação · 12ms' };
    }
    if (!confirmacao) {
      return {
        data: {
          status: 'confirmacao_requerida',
          preview: { recebedor_mascarado: 'M**** S****', instituicao: 'Banco Bradesco S.A.', chave_destino_mascarada: mascararChave(chave_destino), valor: money(valor), descricao: descricao || null },
          aviso: 'Reenvie com confirmacao=true para prosseguir. AMBIENTE DE DEMONSTRAÇÃO — nenhuma transferência real é feita.',
        },
        meta: 'POST /pix/spi/v2/payments (preview) · Axway · 210ms',
      };
    }
    return {
      data: {
        status: 'simulado',
        executado: false,
        id_transacao: 'E60746948DEMO0000000000000001',
        valor: money(valor),
        chave_destino_mascarada: mascararChave(chave_destino),
        quando: AGORA,
        aviso: 'AMBIENTE DE DEMONSTRAÇÃO — nenhuma transferência real foi realizada.',
      },
      meta: 'POST /pix/spi/v2/payments · Axway · 402ms',
    };
  },

  revoke_consent(input = {}) {
    const { consent_id, confirmacao } = input;
    const c = CONSENTIMENTOS.find((x) => x.consent_id === consent_id);
    if (!c) return { data: { erro: `Consentimento ${consent_id} não encontrado.`, disponiveis: CONSENTIMENTOS.map((x) => x.consent_id) }, meta: 'DELETE /openfinance/consents/v2 · 12ms' };
    if (!confirmacao) {
      return { data: { status: 'confirmacao_requerida', consentimento: { consent_id: c.consent_id, organizacao: c.organizacao }, aviso: 'Reenvie com confirmacao=true para revogar. AMBIENTE DE DEMONSTRAÇÃO.' }, meta: 'DELETE /openfinance/consents/v2 (preview) · 88ms' };
    }
    return { data: { status: 'simulado', consent_id: c.consent_id, revogado: false, aviso: 'AMBIENTE DE DEMONSTRAÇÃO — o consentimento não foi realmente revogado.' }, meta: 'DELETE /openfinance/consents/v2 · Axway · 214ms' };
  },
};

function mascararChave(chave) {
  const s = String(chave);
  if (s.length <= 4) return '****';
  return s.slice(0, 2) + '****' + s.slice(-2);
}

// ── Anotações reutilizáveis ──
const RO = { readOnlyHint: true, openWorldHint: false };
const DESTR = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
const obj = (properties = {}, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });

// ── Catálogo de tools (formato Anthropic; core.js → inputSchema) ──
export const tools = [
  // Domínio: Conta & Saldo
  {
    name: 'get_account_balance',
    title: 'Consultar saldo de conta',
    description: 'Retorna saldo disponível, bloqueado e total das contas (corrente/poupança) do usuário autenticado. Use para "qual meu saldo / quanto tenho / quanto está disponível".',
    input_schema: obj({
      account_id: { type: 'string', description: 'ID da conta (omita para todas). Ex.: acc-cc-001.' },
      currency: { type: 'string', enum: ['BRL'], description: 'Moeda. Padrão BRL.' },
    }),
    annotations: { title: 'Consultar saldo de conta', ...RO },
  },
  {
    name: 'get_account_statement',
    title: 'Extrato da conta',
    description: 'Extrato de lançamentos da conta corrente com filtros por data, tipo (credito/debito) e valor, paginado. Use para extrato, movimentações e histórico.',
    input_schema: obj({
      data_inicio: { type: 'string', description: 'Data inicial AAAA-MM-DD.' },
      data_fim: { type: 'string', description: 'Data final AAAA-MM-DD.' },
      tipo: { type: 'string', enum: ['credito', 'debito'], description: 'Filtra por tipo de lançamento.' },
      valor_min: { type: 'number', description: 'Valor mínimo (em módulo).' },
      valor_max: { type: 'number', description: 'Valor máximo (em módulo).' },
      pagina: { type: 'integer', description: 'Página (1..). Padrão 1.' },
      tamanho_pagina: { type: 'integer', description: 'Itens por página (máx 100). Padrão 20.' },
    }),
    annotations: { title: 'Extrato da conta', ...RO },
  },
  {
    name: 'get_account_details',
    title: 'Dados da conta',
    description: 'Dados da(s) conta(s): agência e número (mascarados), tipo, status e limite de crédito. Use para dados cadastrais da conta.',
    input_schema: obj(),
    annotations: { title: 'Dados da conta', ...RO },
  },

  // Domínio: PIX
  {
    name: 'get_pix_keys',
    title: 'Chaves PIX cadastradas',
    description: 'Lista as chaves PIX cadastradas (CPF/CNPJ, e-mail, celular, EVP), mascaradas. Use para "minhas chaves PIX".',
    input_schema: obj(),
    annotations: { title: 'Chaves PIX cadastradas', ...RO },
  },
  {
    name: 'get_pix_transactions',
    title: 'Transações PIX',
    description: 'Histórico de transações PIX (enviadas e recebidas), com filtro por direção. Use para "meus PIX / PIX recentes".',
    input_schema: obj({
      direcao: { type: 'string', enum: ['enviado', 'recebido'], description: 'Filtra enviadas ou recebidas.' },
      top: { type: 'integer', description: 'Máximo de transações a retornar.' },
    }),
    annotations: { title: 'Transações PIX', ...RO },
  },
  {
    name: 'consult_pix_key',
    title: 'Consultar chave PIX (DICT)',
    description: 'Consulta os dados do recebedor a partir de uma chave PIX, via DICT (dados do titular mascarados). Use antes de uma transferência para conferir o destinatário.',
    input_schema: obj({ chave: { type: 'string', description: 'Chave PIX a consultar (CPF/CNPJ, e-mail, celular ou EVP).' } }, ['chave']),
    annotations: { title: 'Consultar chave PIX (DICT)', ...RO },
  },

  // Domínio: Open Finance
  {
    name: 'list_consents',
    title: 'Consentimentos Open Finance',
    description: 'Lista os consentimentos ativos do usuário no ecossistema Open Finance. Use para "quais apps/empresas têm acesso aos meus dados".',
    input_schema: obj(),
    annotations: { title: 'Consentimentos Open Finance', ...RO },
  },
  {
    name: 'get_credit_data',
    title: 'Dados de crédito',
    description: 'Dados de crédito compartilhados via consentimento ativo: limite total/utilizado/disponível e histórico de utilização.',
    input_schema: obj(),
    annotations: { title: 'Dados de crédito', ...RO },
  },
  {
    name: 'get_investments_summary',
    title: 'Resumo de investimentos',
    description: 'Posição consolidada de investimentos: renda fixa, renda variável e previdência. Use para "meus investimentos / minha carteira".',
    input_schema: obj(),
    annotations: { title: 'Resumo de investimentos', ...RO },
  },

  // Domínio: Produtos Bancários
  {
    name: 'list_products',
    title: 'Produtos bancários',
    description: 'Catálogo de produtos contratados/disponíveis para o perfil do cliente (cartões, crédito, seguros, previdência). Use para "quais produtos eu tenho".',
    input_schema: obj(),
    annotations: { title: 'Produtos bancários', ...RO },
  },
  {
    name: 'get_card_details',
    title: 'Dados do cartão de crédito',
    description: 'Dados do cartão de crédito (número mascarado): limite, limite disponível, fatura atual e vencimento. Use para "fatura / limite / vencimento do cartão".',
    input_schema: obj(),
    annotations: { title: 'Dados do cartão de crédito', ...RO },
  },
  {
    name: 'get_loan_details',
    title: 'Empréstimos e financiamentos',
    description: 'Detalhes dos contratos de empréstimo e financiamento ativos (saldo devedor, parcelas, próxima parcela). Use para "meus empréstimos / financiamentos".',
    input_schema: obj(),
    annotations: { title: 'Empréstimos e financiamentos', ...RO },
  },

  // ── Fase 2 — DESTRUCTIVE ──
  {
    name: 'initiate_pix_transfer',
    title: 'Iniciar transferência PIX',
    description: '[FASE 2 · destrutiva] Inicia uma transferência PIX. Requer confirmação explícita do usuário (confirmacao=true) antes da execução. Ambiente de demonstração: a execução é SIMULADA.',
    input_schema: obj({
      chave_destino: { type: 'string', description: 'Chave PIX do recebedor.' },
      valor: { type: 'number', description: 'Valor da transferência (> 0).' },
      descricao: { type: 'string', description: 'Descrição/observação opcional.' },
      confirmacao: { type: 'boolean', description: 'Deve ser true para executar. Sem isso, retorna apenas um preview para confirmação.' },
    }, ['chave_destino', 'valor']),
    annotations: { title: 'Iniciar transferência PIX', ...DESTR },
  },
  {
    name: 'revoke_consent',
    title: 'Revogar consentimento',
    description: '[FASE 2 · destrutiva] Revoga um consentimento de compartilhamento de dados (Open Finance). Requer confirmacao=true. Ambiente de demonstração: a revogação é SIMULADA.',
    input_schema: obj({
      consent_id: { type: 'string', description: 'ID do consentimento a revogar (ver list_consents).' },
      confirmacao: { type: 'boolean', description: 'Deve ser true para revogar. Sem isso, retorna preview.' },
    }, ['consent_id']),
    annotations: { title: 'Revogar consentimento', ...DESTR },
  },
];
