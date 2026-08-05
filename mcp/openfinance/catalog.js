// ─────────────────────────────────────────────────────────────
// Catálogo MCP FIEL às APIs do Open Finance Brasil.
// Cada tool mapeia 1:1 a um endpoint oficial e devolve o envelope
// { data, links, meta } no formato do padrão (Bacen).
// ─────────────────────────────────────────────────────────────

import { listEnv, singleEnv, amtStr, REQ_DT, OF_BASE, CNPJ_BRADESCO } from './of-helpers.js';
import { getProfile } from './of-data.js';

const RO = { readOnlyHint: true, openWorldHint: false };
const DESTR = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
const obj = (properties = {}, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const stripInternal = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));
const pg = (i) => ({ page: i.page ?? 1, pageSize: i.pageSize ?? 25 });

// Resources agregados a partir de todos os recursos disponíveis do perfil.
function buildResources(D) {
  const r = [];
  D.ACCOUNTS.forEach((a) => r.push({ resourceId: a.accountId, type: 'ACCOUNT', status: 'AVAILABLE' }));
  D.CREDIT_CARDS.forEach((c) => r.push({ resourceId: c.creditCardAccountId, type: 'CREDIT_CARD_ACCOUNT', status: 'AVAILABLE' }));
  D.LOANS.forEach((c) => r.push({ resourceId: c.contractId, type: 'LOAN', status: 'AVAILABLE' }));
  D.FINANCINGS.forEach((c) => r.push({ resourceId: c.contractId, type: 'FINANCING', status: 'AVAILABLE' }));
  Object.entries(D.INVESTMENTS).forEach(([tipo, arr]) => arr.forEach((x) => r.push({ resourceId: x.investmentId, type: tipo, status: 'AVAILABLE' })));
  return r;
}

const findLoan = (D, id) => D.LOANS.find((c) => c.contractId === id) || D.FINANCINGS.find((c) => c.contractId === id);

export const executores = {
  // Pluggy Open Finance — consentimento real
  pluggy_initiate_consent(i = {}, ctx) {
    if (!process.env.PLUGGY_CLIENT_ID) {
      return { data: { error: 'Pluggy não configurado neste ambiente. Defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.' }, meta: 'config error' };
    }
    const baseUrl = (process.env.FINA_WEB_URL || 'https://fina-web-client-aix6.onrender.com').replace(/\/$/, '');
    const consentUrl = `${baseUrl}/pluggy-consent`;
    return {
      data: {
        consentUrl,
        instrucoes: 'Apresente este link ao usuário para que ele autorize o acesso aos dados bancários reais via Open Finance Brasil. Após autorizar, os dados reais estarão disponíveis nas demais tools.',
      },
      meta: 'Pluggy Connect — URL de consentimento',
    };
  },

  // Consents / Resources
  of_get_consent(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    const c = { ...D.CONSENT };
    if (i.consentId) c.consentId = i.consentId;
    return { data: singleEnv(`/consents/v3/consents/${c.consentId}`, c), meta: 'GET /consents/v3/consents/{consentId} · 200' };
  },
  of_list_resources(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    return { data: listEnv('/resources/v3/resources', buildResources(D), pg(i)), meta: 'GET /resources/v3/resources · 200' };
  },

  // Accounts
  of_list_accounts(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    return { data: listEnv('/accounts/v2/accounts', D.ACCOUNTS, pg(i)), meta: 'GET /accounts/v2/accounts · 200' };
  },
  of_get_account(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    const a = D.ACCOUNTS.find((x) => x.accountId === i.accountId);
    if (!a) return err('accountId não encontrado');
    return { data: singleEnv(`/accounts/v2/accounts/${a.accountId}`, a), meta: 'GET /accounts/v2/accounts/{accountId} · 200' };
  },
  of_get_account_balances(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    if (!i.accountId) return err('accountId é obrigatório');
    return { data: singleEnv(`/accounts/v2/accounts/${i.accountId}/balances`, D.accountBalances(i.accountId)), meta: 'GET /accounts/v2/accounts/{accountId}/balances · 200' };
  },
  of_get_account_transactions(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    if (!i.accountId) return err('accountId é obrigatório');
    let tx = D.accountTransactions(i.accountId);
    if (i.fromBookingDate) tx = tx.filter((t) => t.transactionDateTime.slice(0, 10) >= i.fromBookingDate);
    if (i.toBookingDate) tx = tx.filter((t) => t.transactionDateTime.slice(0, 10) <= i.toBookingDate);
    if (i.creditDebitIndicator) tx = tx.filter((t) => t.creditDebitType === i.creditDebitIndicator);
    return { data: listEnv(`/accounts/v2/accounts/${i.accountId}/transactions`, tx, { ...pg(i), transactions: true }), meta: 'GET /accounts/v2/accounts/{accountId}/transactions · 200' };
  },
  of_get_account_overdraft_limits(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    if (!i.accountId) return err('accountId é obrigatório');
    return { data: singleEnv(`/accounts/v2/accounts/${i.accountId}/overdraft-limits`, D.accountOverdraftLimits()), meta: 'GET /accounts/v2/accounts/{accountId}/overdraft-limits · 200' };
  },

  // Credit cards
  of_list_credit_cards(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    return { data: listEnv('/credit-cards-accounts/v2/accounts', D.CREDIT_CARDS, pg(i)), meta: 'GET /credit-cards-accounts/v2/accounts · 200' };
  },
  of_get_credit_card_limits(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    if (!i.creditCardAccountId) return err('creditCardAccountId é obrigatório');
    return { data: listEnv(`/credit-cards-accounts/v2/accounts/${i.creditCardAccountId}/limits`, D.creditCardLimits(i.creditCardAccountId), pg(i)), meta: 'GET /credit-cards-accounts/v2/accounts/{id}/limits · 200' };
  },
  of_get_credit_card_bills(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    if (!i.creditCardAccountId) return err('creditCardAccountId é obrigatório');
    return { data: listEnv(`/credit-cards-accounts/v2/accounts/${i.creditCardAccountId}/bills`, D.creditCardBills(i.creditCardAccountId), pg(i)), meta: 'GET /credit-cards-accounts/v2/accounts/{id}/bills · 200' };
  },
  of_get_credit_card_bill_transactions(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    if (!i.creditCardAccountId || !i.billId) return err('creditCardAccountId e billId são obrigatórios');
    const tx = D.creditCardBillTransactions(i.creditCardAccountId, i.billId);
    return { data: listEnv(`/credit-cards-accounts/v2/accounts/${i.creditCardAccountId}/bills/${i.billId}/transactions`, tx, { ...pg(i), transactions: true }), meta: 'GET .../bills/{billId}/transactions · 200' };
  },

  // Customers (personal)
  of_get_personal_identifications(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    return { data: listEnv('/customers/v2/personal/identifications', [D.PERSONAL_IDENTIFICATION]), meta: 'GET /customers/v2/personal/identifications · 200' };
  },
  of_get_personal_qualifications(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    return { data: singleEnv('/customers/v2/personal/qualifications', D.PERSONAL_QUALIFICATION), meta: 'GET /customers/v2/personal/qualifications · 200' };
  },
  of_get_personal_financial_relations(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    return { data: singleEnv('/customers/v2/personal/financial-relations', D.PERSONAL_FINANCIAL_RELATION), meta: 'GET /customers/v2/personal/financial-relations · 200' };
  },

  // Customers (business — PJ). Quando o perfil não tem PJ, retorna vazio.
  of_get_business_identifications(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    const arr = D.BUSINESS_IDENTIFICATION ? [D.BUSINESS_IDENTIFICATION] : [];
    return { data: listEnv('/customers/v2/business/identifications', arr), meta: 'GET /customers/v2/business/identifications · 200' };
  },
  of_get_business_qualifications(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    if (!D.BUSINESS_QUALIFICATION) return { data: { data: {}, meta: { requestDateTime: REQ_DT }, _aviso: 'Cliente sem PJ.' }, meta: 'GET /customers/v2/business/qualifications · 200 (sem PJ)' };
    return { data: singleEnv('/customers/v2/business/qualifications', D.BUSINESS_QUALIFICATION), meta: 'GET /customers/v2/business/qualifications · 200' };
  },
  of_get_business_financial_relations(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    if (!D.BUSINESS_FINANCIAL_RELATION) return { data: { data: {}, meta: { requestDateTime: REQ_DT }, _aviso: 'Cliente sem PJ.' }, meta: 'GET /customers/v2/business/financial-relations · 200 (sem PJ)' };
    return { data: singleEnv('/customers/v2/business/financial-relations', D.BUSINESS_FINANCIAL_RELATION), meta: 'GET /customers/v2/business/financial-relations · 200' };
  },

  // Loans
  of_list_loans(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    return { data: listEnv('/loans/v2/contracts', D.LOANS.map(D.loanListItem), pg(i)), meta: 'GET /loans/v2/contracts · 200' };
  },
  of_get_loan_contract(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    const c = findLoan(D, i.contractId);
    if (!c) return err('contractId não encontrado');
    return { data: singleEnv(`/loans/v2/contracts/${c.contractId}`, stripInternal(c)), meta: 'GET /loans/v2/contracts/{contractId} · 200' };
  },
  of_get_loan_payments(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    const c = findLoan(D, i.contractId);
    if (!c) return err('contractId não encontrado');
    return { data: singleEnv(`/loans/v2/contracts/${c.contractId}/payments`, D.loanPayments(c)), meta: 'GET /loans/v2/contracts/{contractId}/payments · 200' };
  },
  of_get_loan_scheduled_instalments(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    const c = findLoan(D, i.contractId);
    if (!c) return err('contractId não encontrado');
    return { data: singleEnv(`/loans/v2/contracts/${c.contractId}/scheduled-instalments`, D.loanInstalments(c)), meta: 'GET /loans/v2/contracts/{contractId}/scheduled-instalments · 200' };
  },

  // Financings
  of_list_financings(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    const items = D.FINANCINGS.map((c) => ({ ...D.loanListItem(c), productType: 'FINANCIAMENTOS', productSubType: 'AQUISICAO_BENS_VEICULOS_AUTOMOTORES' }));
    return { data: listEnv('/financings/v2/contracts', items, pg(i)), meta: 'GET /financings/v2/contracts · 200' };
  },

  // Investments (por tipo — cada um é um endpoint próprio)
  of_list_investments(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    const tipo = i.tipo || 'BANK_FIXED_INCOME';
    const arr = D.INVESTMENTS[tipo];
    if (!arr) return err(`tipo inválido. Use: ${Object.keys(D.INVESTMENTS).join(', ')}`);
    const path = {
      BANK_FIXED_INCOME: '/bank-fixed-incomes/v1/investments',
      CREDIT_FIXED_INCOME: '/credit-fixed-incomes/v1/investments',
      TREASURE_TITLE: '/treasure-titles/v1/investments',
      FUND: '/funds/v1/investments',
      VARIABLE_INCOME: '/variable-incomes/v1/investments',
    }[tipo];
    return { data: listEnv(path, arr, pg(i)), meta: `GET ${path} · 200` };
  },

  // ── Extensões (não fazem parte do padrão Open Finance) ──
  select_account(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    return { data: { accounts: D.accountSelection() }, meta: 'extensão · seleção de conta PF/PJ' };
  },
  analytics_cross_pf_pj(i = {}, ctx) {
    const D = getProfile(ctx?.profile);
    return { data: D.analytics(), meta: 'extensão · cruzamento analítico PF × PJ (12 meses)' };
  },

  // ── Payments (PIX) — DESTRUCTIVE, simuladas com confirmação ──
  of_create_payment_consent(i = {}) {
    const { valor, creditor_nome, creditor_cpfcnpj, pix_key, confirmacao } = i;
    if (!valor || valor <= 0 || !creditor_cpfcnpj) return err('valor (>0) e creditor_cpfcnpj são obrigatórios');
    if (!confirmacao) {
      return { data: { status: 'confirmacao_requerida', preview: { amount: amtStr(valor), currency: 'BRL', creditor: { name: creditor_nome || null, cpfCnpj: creditor_cpfcnpj } }, aviso: 'Reenvie com confirmacao=true. AMBIENTE DE DEMONSTRAÇÃO — nada real é criado.' }, meta: 'POST /payments/v4/consents (preview)' };
    }
    const consent = {
      consentId: 'urn:bradesco:pix:C-DEMO-0001',
      status: 'AWAITING_AUTHORISATION', // AWAITING_AUTHORISATION | AUTHORISED | REJECTED | CONSUMED
      creationDateTime: REQ_DT,
      statusUpdateDateTime: REQ_DT,
      payment: { amount: amtStr(valor), currency: 'BRL' },
      creditor: { personType: String(creditor_cpfcnpj).length > 11 ? 'PESSOA_JURIDICA' : 'PESSOA_NATURAL', cpfCnpj: String(creditor_cpfcnpj), name: creditor_nome || 'RECEBEDOR DEMO' },
      _aviso: 'AMBIENTE DE DEMONSTRAÇÃO — consentimento fictício.',
    };
    return { data: singleEnv('/payments/v4/consents/urn:bradesco:pix:C-DEMO-0001', consent), meta: 'POST /payments/v4/consents · 201 (simulado)' };
  },
  of_initiate_pix_payment(i = {}) {
    const { valor, proxy, creditor_ispb, creditor_number, creditor_accountType, confirmacao } = i;
    if (!valor || valor <= 0) return err('valor (>0) é obrigatório');
    if (!confirmacao) {
      return { data: { status: 'confirmacao_requerida', preview: { amount: amtStr(valor), currency: 'BRL', proxy: proxy || null }, aviso: 'Reenvie com confirmacao=true. AMBIENTE DE DEMONSTRAÇÃO — nenhum PIX real é feito.' }, meta: 'POST /payments/v4/pix/payments (preview)' };
    }
    const pay = {
      paymentId: 'urn:bradesco:pix:P-DEMO-0001',
      endToEndId: 'E60746948202607231200DEMO0001',
      status: 'ACSC', // RCVD|ACCP|ACPD|RJCT|ACSC|PDNG|SCHD  (ACSC = liquidado)
      creationDateTime: REQ_DT,
      statusUpdateDateTime: REQ_DT,
      localInstrument: proxy ? 'DICT' : 'MANU',
      proxy: proxy || null,
      cnpjInitiator: CNPJ_BRADESCO,
      payment: { amount: amtStr(valor), currency: 'BRL' },
      creditorAccount: { ispb: creditor_ispb || '00000000', number: creditor_number || '00000000', accountType: creditor_accountType || 'CACC' },
      _aviso: 'AMBIENTE DE DEMONSTRAÇÃO — nenhum PIX real foi realizado.',
    };
    return { data: singleEnv('/payments/v4/pix/payments/urn:bradesco:pix:P-DEMO-0001', pay), meta: 'POST /payments/v4/pix/payments · 201 (simulado)' };
  },
};

function err(msg) {
  return { data: { errors: [{ code: 'PARAMETRO_INVALIDO', title: 'Requisição inválida', detail: msg }], meta: { requestDateTime: REQ_DT } }, meta: '400' };
}

// ── Catálogo de tools ──
const T = (name, title, description, input_schema, ann = RO) => ({ name, title, description, input_schema, annotations: { title, ...ann } });
const idProp = (d) => ({ type: 'string', description: d });
const pageProps = { page: { type: 'integer', description: 'Página (1..). Padrão 1.' }, pageSize: { type: 'integer', description: 'Itens por página. Padrão 25.' } };

export const tools = [
  T('pluggy_initiate_consent', 'Conectar banco (Open Finance real)',
    'Inicia a jornada de consentimento Pluggy para o usuário autorizar acesso aos dados bancários REAIS via Open Finance Brasil. ' +
    'Retorna uma URL que o usuário deve abrir no navegador. Use quando o usuário pedir para conectar o banco, ' +
    'vincular conta ou quando os dados disponíveis são fictícios e o usuário quer dados reais.',
    obj(), { readOnlyHint: false, openWorldHint: true }),

  T('of_get_consent', 'Consentimento (Open Finance)', 'GET /consents/v3/consents/{consentId} — retorna o consentimento com status e permissions. Sem parâmetro usa o consentimento ativo do usuário.',
    obj({ consentId: idProp('URN do consentimento. Ex.: urn:bradesco:C1DD...') })),
  T('of_list_resources', 'Recursos disponíveis', 'GET /resources/v3/resources — lista os recursos (ACCOUNT, CREDIT_CARD_ACCOUNT, LOAN, FINANCING, investimentos) e seu status.',
    obj({ ...pageProps })),

  T('of_list_accounts', 'Contas (lista)', 'GET /accounts/v2/accounts — lista as contas (corrente/poupança/pagamento) com type, compeCode, branchCode, number.',
    obj({ ...pageProps })),
  T('of_get_account', 'Conta (identificação)', 'GET /accounts/v2/accounts/{accountId} — dados de uma conta específica.',
    obj({ accountId: idProp('ID da conta. Ex.: acc-cc-0001.') }, ['accountId'])),
  T('of_get_account_balances', 'Saldos da conta', 'GET /accounts/v2/accounts/{accountId}/balances — availableAmount, blockedAmount, automaticallyInvestedAmount.',
    obj({ accountId: idProp('ID da conta.') }, ['accountId'])),
  T('of_get_account_transactions', 'Transações da conta', 'GET /accounts/v2/accounts/{accountId}/transactions — lançamentos com creditDebitType, type, transactionAmount. Filtros por data e crédito/débito.',
    obj({ accountId: idProp('ID da conta.'), fromBookingDate: idProp('Data inicial AAAA-MM-DD.'), toBookingDate: idProp('Data final AAAA-MM-DD.'), creditDebitIndicator: { type: 'string', enum: ['CREDITO', 'DEBITO'] }, ...pageProps }, ['accountId'])),
  T('of_get_account_overdraft_limits', 'Limites de cheque especial', 'GET /accounts/v2/accounts/{accountId}/overdraft-limits — limite contratado, utilizado e não contratado.',
    obj({ accountId: idProp('ID da conta.') }, ['accountId'])),

  T('of_list_credit_cards', 'Cartões de crédito (lista)', 'GET /credit-cards-accounts/v2/accounts — lista os cartões com creditCardNetwork, productType.',
    obj({ ...pageProps })),
  T('of_get_credit_card_limits', 'Limites do cartão', 'GET /credit-cards-accounts/v2/accounts/{id}/limits — limite total, utilizado e disponível.',
    obj({ creditCardAccountId: idProp('ID do cartão. Ex.: card-0001.'), ...pageProps }, ['creditCardAccountId'])),
  T('of_get_credit_card_bills', 'Faturas do cartão', 'GET /credit-cards-accounts/v2/accounts/{id}/bills — faturas com dueDate, billTotalAmount, billMinimumAmount, payments.',
    obj({ creditCardAccountId: idProp('ID do cartão.'), ...pageProps }, ['creditCardAccountId'])),
  T('of_get_credit_card_bill_transactions', 'Transações da fatura', 'GET /credit-cards-accounts/v2/accounts/{id}/bills/{billId}/transactions — lançamentos da fatura.',
    obj({ creditCardAccountId: idProp('ID do cartão.'), billId: idProp('ID da fatura. Ex.: bill-2026-07.'), ...pageProps }, ['creditCardAccountId', 'billId'])),

  T('of_get_personal_identifications', 'Cadastro — identificação (PF)', 'GET /customers/v2/personal/identifications — dados cadastrais do titular (nome, documentos, contatos).',
    obj()),
  T('of_get_personal_qualifications', 'Cadastro — qualificação (PF)', 'GET /customers/v2/personal/qualifications — ocupação, renda informada e patrimônio.',
    obj()),
  T('of_get_personal_financial_relations', 'Cadastro — relacionamento (PF)', 'GET /customers/v2/personal/financial-relations — produtos/serviços contratados e contas.',
    obj()),

  T('of_get_business_identifications', 'Cadastro — identificação (PJ)', 'GET /customers/v2/business/identifications — dados cadastrais da empresa (razão social, CNPJ, sócios, contatos).',
    obj()),
  T('of_get_business_qualifications', 'Cadastro — qualificação (PJ)', 'GET /customers/v2/business/qualifications — faturamento informado e patrimônio da empresa.',
    obj()),
  T('of_get_business_financial_relations', 'Cadastro — relacionamento (PJ)', 'GET /customers/v2/business/financial-relations — produtos/serviços e contas da empresa.',
    obj()),

  T('select_account', 'Selecionar conta (PF/PJ)', 'Extensão: lista as contas do cliente (PF e PJ) com titular, tipo e saldo, para o usuário ESCOLHER qual conta usar na jornada antes das demais consultas.',
    obj()),
  T('analytics_cross_pf_pj', 'Cruzamento analítico PF × PJ', 'Extensão: análise consolidada de 12 meses cruzando PF e PJ — saldos, fluxo de caixa mensal, entradas/saídas, dívida, fatura de cartão, além de indicadores cruzados (pró-labore PJ→PF, dependência da PF em relação à PJ, liquidez da PJ).',
    obj()),

  T('of_list_loans', 'Empréstimos (lista)', 'GET /loans/v2/contracts — contratos de empréstimo (productType, productSubType, ipocCode).',
    obj({ ...pageProps })),
  T('of_get_loan_contract', 'Empréstimo (detalhe)', 'GET /loans/v2/contracts/{contractId} — detalhe do contrato: valor, CET, taxas, encargos, amortização.',
    obj({ contractId: idProp('ID do contrato. Ex.: loan-0001.') }, ['contractId'])),
  T('of_get_loan_payments', 'Empréstimo — pagamentos', 'GET /loans/v2/contracts/{contractId}/payments — saldo devedor e releases (pagamentos).',
    obj({ contractId: idProp('ID do contrato.') }, ['contractId'])),
  T('of_get_loan_scheduled_instalments', 'Empréstimo — parcelas', 'GET /loans/v2/contracts/{contractId}/scheduled-instalments — parcelas pagas/vincendas/em atraso.',
    obj({ contractId: idProp('ID do contrato.') }, ['contractId'])),

  T('of_list_financings', 'Financiamentos (lista)', 'GET /financings/v2/contracts — contratos de financiamento.',
    obj({ ...pageProps })),

  T('of_list_investments', 'Investimentos', 'Lista investimentos por tipo (cada tipo é um endpoint próprio do Open Finance): bank-fixed-incomes, credit-fixed-incomes, treasure-titles, funds, variable-incomes.',
    obj({ tipo: { type: 'string', enum: ['BANK_FIXED_INCOME', 'CREDIT_FIXED_INCOME', 'TREASURE_TITLE', 'FUND', 'VARIABLE_INCOME'], description: 'Tipo de investimento. Padrão BANK_FIXED_INCOME.' }, ...pageProps })),

  T('of_create_payment_consent', 'Criar consentimento de pagamento PIX', '[DESTRUTIVA · fase 3] POST /payments/v4/consents — cria o consentimento de iniciação de pagamento PIX. Requer confirmacao=true. Execução SIMULADA.',
    obj({ valor: { type: 'number', description: 'Valor do pagamento (> 0).' }, creditor_nome: idProp('Nome do recebedor.'), creditor_cpfcnpj: idProp('CPF/CNPJ do recebedor (só dígitos).'), pix_key: idProp('Chave PIX do recebedor (opcional).'), confirmacao: { type: 'boolean', description: 'true para criar (simulado). Sem isso, retorna preview.' } }, ['valor', 'creditor_cpfcnpj']), DESTR),
  T('of_initiate_pix_payment', 'Iniciar pagamento PIX', '[DESTRUTIVA · fase 3] POST /payments/v4/pix/payments — inicia o pagamento PIX de um consentimento autorizado. Requer confirmacao=true. Execução SIMULADA.',
    obj({ valor: { type: 'number', description: 'Valor (> 0).' }, proxy: idProp('Chave PIX (proxy) do recebedor.'), creditor_ispb: idProp('ISPB da instituição do recebedor (8 dígitos).'), creditor_number: idProp('Número da conta do recebedor.'), creditor_accountType: { type: 'string', enum: ['CACC', 'SVGS', 'TRAN'], description: 'Tipo de conta do recebedor.' }, confirmacao: { type: 'boolean', description: 'true para iniciar (simulado).' } }, ['valor']), DESTR),
];
