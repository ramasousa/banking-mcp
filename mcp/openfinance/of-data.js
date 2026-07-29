// ─────────────────────────────────────────────────────────────
// Datasets fiéis ao Open Finance Brasil — CENÁRIO PF + PJ.
//
// Duas entidades do mesmo cliente:
//   PF  Raul Sousa (CPF)            → conta corrente + poupança, cartão, empréstimo
//   PJ  Sousa Tech Ltda (CNPJ)      → conta corrente, cartão corporativo, capital de giro + financiamento
//
// 12 meses de histórico (ago/2025 → jul/2026), transacionalidade complexa e
// cruzada (a PJ paga pró-labore para a PF; impostos, folha, recebíveis
// sazonais; PF com salário, gastos variados e investimentos). Determinístico.
// ─────────────────────────────────────────────────────────────

import { amt, amtStr, rate, REQ_DT, CNPJ_BRADESCO, BRAND } from './of-helpers.js';

const HOJE = { y: 2026, m: 7, d: 23 };
const CPF_PF = '12345678909';
const CNPJ_PJ = '41255036000199';

// ── PRNG determinístico ──
function rngFrom(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const val = (rng, min, max) => Number((min + rng() * (max - min)).toFixed(2));
const dd = (n) => String(n).padStart(2, '0');

// Janela de 12 meses (mais antigo → mais recente).
const MESES = (() => {
  const out = [];
  for (let k = 11; k >= 0; k--) {
    let m = HOJE.m - k, y = HOJE.y;
    while (m <= 0) { m += 12; y -= 1; }
    out.push({ y, m, ultimo: (y === HOJE.y && m === HOJE.m) ? HOJE.d : 28 });
  }
  return out;
})();

const iso = (y, m, d) => `${y}-${dd(m)}-${dd(d)}`;
const dt = (y, m, d, h = 10) => `${iso(y, m, d)}T${dd(h)}:00:00.000Z`;

// ── Entidades / contas ──
export const ENTITIES = {
  PF: { personType: 'PESSOA_NATURAL', name: 'RAUL SOUSA', document: CPF_PF, accounts: ['pf-cc-0001', 'pf-poup-0001'], cards: ['pf-card-0001'], loans: ['pf-loan-0001'], financings: [] },
  PJ: { personType: 'PESSOA_JURIDICA', name: 'SOUSA TECH LTDA', document: CNPJ_PJ, accounts: ['pj-cc-0001'], cards: ['pj-card-0001'], loans: ['pj-loan-0001'], financings: ['pj-fin-0001'] },
};

export const ACCOUNTS = [
  { accountId: 'pf-cc-0001', ownerType: 'PESSOA_NATURAL', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, type: 'CONTA_DEPOSITO_A_VISTA', compeCode: '237', branchCode: '1234', number: '567890', checkDigit: '0', currency: 'BRL' },
  { accountId: 'pf-poup-0001', ownerType: 'PESSOA_NATURAL', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, type: 'CONTA_POUPANCA', compeCode: '237', branchCode: '1234', number: '112233', checkDigit: '2', currency: 'BRL' },
  { accountId: 'pj-cc-0001', ownerType: 'PESSOA_JURIDICA', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, type: 'CONTA_DEPOSITO_A_VISTA', compeCode: '237', branchCode: '1234', number: '998877', checkDigit: '5', currency: 'BRL' },
];

// Saldos atuais (posição do dia).
const SALDO = {
  'pf-cc-0001': { availableAmount: 46820.44, blockedAmount: 450.0, automaticallyInvestedAmount: 0 },
  'pf-poup-0001': { availableAmount: 61230.18, blockedAmount: 0, automaticallyInvestedAmount: 0 },
  'pj-cc-0001': { availableAmount: 318740.92, blockedAmount: 12500.0, automaticallyInvestedAmount: 150000.0 },
};
export function accountBalances(accountId) {
  const s = SALDO[accountId] || SALDO['pf-cc-0001'];
  return { availableAmount: amt(s.availableAmount), blockedAmount: amt(s.blockedAmount), automaticallyInvestedAmount: amt(s.automaticallyInvestedAmount), updateDateTime: REQ_DT };
}
export function accountOverdraftLimits(accountId) {
  const lim = accountId === 'pj-cc-0001' ? 80000 : 15000;
  return { overdraftContractedLimit: amt(lim), overdraftUsedLimit: amt(0), unarrangedOverdraftAmount: amt(0) };
}

// ── Catálogo de estabelecimentos (PF) ──
const LOJAS_PF = [
  { cat: 'Supermercado', ic: 'CARTAO', lojas: ['Pão de Açúcar', 'Carrefour', 'Assaí'], min: 90, max: 680 },
  { cat: 'Restaurantes', ic: 'CARTAO', lojas: ['Outback', 'Coco Bambu', 'Madero'], min: 70, max: 640 },
  { cat: 'Delivery', ic: 'CARTAO', lojas: ['iFood', 'Rappi'], min: 28, max: 190 },
  { cat: 'Transporte', ic: 'CARTAO', lojas: ['Uber', '99'], min: 12, max: 110 },
  { cat: 'Combustível', ic: 'CARTAO', lojas: ['Shell', 'Ipiranga'], min: 150, max: 480 },
  { cat: 'Saúde', ic: 'CARTAO', lojas: ['Drogasil', 'Lab Fleury'], min: 40, max: 720 },
  { cat: 'Vestuário', ic: 'CARTAO', lojas: ['Renner', 'Zara', 'Nike'], min: 90, max: 950 },
  { cat: 'Eletrônicos', ic: 'CARTAO', lojas: ['Amazon', 'Magazine Luiza'], min: 180, max: 2200 },
];
// Fornecedores/rubricas (PJ)
const FORNEC_PJ = ['AWS Serviços de Nuvem', 'Google Cloud', 'Fornecedor Alpha Ltda', 'Distribuidora Beta', 'Locação Escritório', 'Contabilidade Sigma', 'Marketing Digital Ltda', 'Papelaria Central'];
const CLIENTES_PJ = ['Cliente Acme S.A.', 'Cliente Nexus Ltda', 'Cliente Orion ME', 'Cliente Vega Corp', 'Cliente Delta Ltda'];

function tId(pfx, y, m, i) { return `${pfx}${y}${dd(m)}${dd(i)}`; }

// ── Geração do extrato PF (conta corrente) ──
function gerarPF() {
  const rng = rngFrom(2025080101);
  const tx = [];
  MESES.forEach(({ y, m, ultimo }) => {
    let i = 0;
    const add = (d, name, type, cdt, amount, h) => tx.push({
      transactionId: tId('PF', y, m, i++), completedAuthorisedPaymentType: 'TRANSACAO_EFETIVADA',
      creditDebitType: cdt, transactionName: name.slice(0, 200), type, transactionAmount: amt(amount), transactionDateTime: dt(y, m, Math.min(d, ultimo), h),
    });
    // Crédito: pró-labore + salário vindos da PJ (cruzamento!)
    add(5, 'PRO-LABORE SOUSA TECH LTDA', 'PIX', 'CREDITO', 18000);
    if (m === 12) add(20, '13o SALARIO SOUSA TECH LTDA', 'PIX', 'CREDITO', 15000); // sazonalidade
    add(1, 'RENDIMENTO POUPANCA', 'RENDIMENTO_APLIC_FINANCEIRA', 'CREDITO', val(rng, 380, 620));
    if (rng() > 0.5) add(14 + Math.floor(rng() * 8), `PIX RECEBIDO ${pick(rng, ['Reembolso', 'Freelance', 'Venda usados'])}`, 'PIX', 'CREDITO', val(rng, 300, 2500));
    // Débitos fixos
    add(8, 'ALUGUEL IMOBILIARIA LAR', 'TED', 'DEBITO', 3200);
    add(8, 'CONDOMINIO ED AURORA', 'TED', 'DEBITO', 1180);
    add(10, 'ENEL ENERGIA', 'CONVENIO_ARRECADACAO', 'DEBITO', val(rng, 210, 460));
    add(11, 'SABESP AGUA', 'CONVENIO_ARRECADACAO', 'DEBITO', val(rng, 90, 180));
    add(15, 'VIVO FIBRA INTERNET', 'CONVENIO_ARRECADACAO', 'DEBITO', 159.9);
    add(12, 'PAGAMENTO FATURA CARTAO BRADESCO', 'CARTAO', 'DEBITO', val(rng, 6000, 14000));
    add(6, 'APLICACAO CDB BRADESCO', 'RESGATE_APLIC_FINANCEIRA', 'DEBITO', val(rng, 2000, 5000));
    // Compras variadas (débito)
    const n = 12 + Math.floor(rng() * 8);
    for (let k = 0; k < n; k++) { const c = pick(rng, LOJAS_PF); add(1 + Math.floor(rng() * ultimo), c.lojas[Math.floor(rng() * c.lojas.length)], 'CARTAO', 'DEBITO', val(rng, c.min, Math.min(c.max, 900))); }
    // PIX enviados
    for (let k = 0; k < 3; k++) add(1 + Math.floor(rng() * ultimo), `PIX ENVIADO ${pick(rng, ['Maria Souza', 'Diarista', 'Escola'])}`, 'PIX', 'DEBITO', val(rng, 40, 850));
  });
  return tx.reverse(); // mais recente primeiro
}

// ── Geração do extrato PJ (conta corrente) ──
function gerarPJ() {
  const rng = rngFrom(2025080202);
  const tx = [];
  MESES.forEach(({ y, m, ultimo }, idx) => {
    let i = 0;
    const add = (d, name, type, cdt, amount, h) => tx.push({
      transactionId: tId('PJ', y, m, i++), completedAuthorisedPaymentType: 'TRANSACAO_EFETIVADA',
      creditDebitType: cdt, transactionName: name.slice(0, 200), type, transactionAmount: amt(amount), transactionDateTime: dt(y, m, Math.min(d, ultimo), h),
    });
    // Recebíveis de clientes (sazonalidade: Nov/Dez mais forte)
    const fator = (m === 11 || m === 12) ? 1.6 : 1;
    const nRec = 6 + Math.floor(rng() * 6);
    for (let k = 0; k < nRec; k++) {
      const tipo = pick(rng, ['PIX', 'BOLETO', 'TED']);
      add(1 + Math.floor(rng() * ultimo), `RECEBIMENTO ${pick(rng, CLIENTES_PJ)}`, tipo, 'CREDITO', val(rng, 6000, 28000) * fator);
    }
    // Aporte de capital de giro (crédito) em fev/2026
    if (y === 2026 && m === 2) add(12, 'LIBERACAO CAPITAL DE GIRO', 'OPERACAO_CREDITO', 'CREDITO', 150000);
    // Folha de pagamento (vários funcionários)
    add(5, 'FOLHA DE PAGAMENTO - SALARIOS', 'FOLHA_PAGAMENTO', 'DEBITO', val(rng, 42000, 52000));
    if (m === 12) add(20, 'FOLHA 13o SALARIO', 'FOLHA_PAGAMENTO', 'DEBITO', val(rng, 40000, 50000));
    // Pró-labore para a PF (cruzamento com PF)
    add(5, 'PRO-LABORE RAUL SOUSA', 'PIX', 'DEBITO', 18000);
    if (m === 12) add(20, '13o RAUL SOUSA', 'PIX', 'DEBITO', 15000);
    // Impostos
    add(20, 'DARF - IRPJ/CSLL', 'CONVENIO_ARRECADACAO', 'DEBITO', val(rng, 8000, 22000) * fator);
    add(20, 'DAS - SIMPLES NACIONAL', 'CONVENIO_ARRECADACAO', 'DEBITO', val(rng, 6000, 14000));
    add(7, 'FGTS', 'CONVENIO_ARRECADACAO', 'DEBITO', val(rng, 3000, 4200));
    add(15, 'ISS MUNICIPAL', 'CONVENIO_ARRECADACAO', 'DEBITO', val(rng, 1500, 3800));
    // Custos fixos
    add(8, 'ALUGUEL COMERCIAL', 'TED', 'DEBITO', 9800);
    add(10, 'ENERGIA - CNPJ', 'CONVENIO_ARRECADACAO', 'DEBITO', val(rng, 1800, 3200));
    add(12, 'PAGAMENTO FATURA CARTAO CORPORATIVO', 'CARTAO', 'DEBITO', val(rng, 18000, 34000));
    add(10, 'PARCELA CAPITAL DE GIRO', 'OPERACAO_CREDITO', 'DEBITO', 8250.4);
    add(9, 'TARIFA PACOTE PJ', 'PACOTE_TARIFA_SERVICOS', 'DEBITO', 189.9);
    // Fornecedores
    const nForn = 8 + Math.floor(rng() * 8);
    for (let k = 0; k < nForn; k++) add(1 + Math.floor(rng() * ultimo), `FORNECEDOR ${pick(rng, FORNEC_PJ)}`, pick(rng, ['PIX', 'TED', 'BOLETO']), 'DEBITO', val(rng, 800, 12000));
  });
  return tx.reverse();
}

const TX = {
  'pf-cc-0001': gerarPF(),
  'pf-poup-0001': (() => { // poupança: rendimentos + aplicações/resgates
    const rng = rngFrom(777), tx = [];
    MESES.forEach(({ y, m }) => { let i = 0;
      tx.push({ transactionId: tId('PP', y, m, i++), completedAuthorisedPaymentType: 'TRANSACAO_EFETIVADA', creditDebitType: 'CREDITO', transactionName: 'RENDIMENTO POUPANCA', type: 'RENDIMENTO_APLIC_FINANCEIRA', transactionAmount: amt(val(rng, 300, 520)), transactionDateTime: dt(y, m, 1) });
      if (rng() > 0.5) tx.push({ transactionId: tId('PP', y, m, i++), completedAuthorisedPaymentType: 'TRANSACAO_EFETIVADA', creditDebitType: 'CREDITO', transactionName: 'DEPOSITO POUPANCA', type: 'DEPOSITO', transactionAmount: amt(val(rng, 1000, 4000)), transactionDateTime: dt(y, m, 6) });
    });
    return tx.reverse();
  })(),
  'pj-cc-0001': gerarPJ(),
};
export function accountTransactions(accountId) { return TX[accountId] || []; }

// ── Cartões (PF + PJ), com 12 faturas cada ──
export const CREDIT_CARDS = [
  { creditCardAccountId: 'pf-card-0001', ownerType: 'PESSOA_NATURAL', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, name: 'BRADESCO VISA INFINITE', productType: 'INFINITE_INTERNACIONAL', productAdditionalInfo: null, creditCardNetwork: 'VISA', networkAdditionalInfo: null },
  { creditCardAccountId: 'pj-card-0001', ownerType: 'PESSOA_JURIDICA', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, name: 'BRADESCO CORPORATE MASTERCARD', productType: 'BLACK', productAdditionalInfo: 'Cartão corporativo', creditCardNetwork: 'MASTERCARD', networkAdditionalInfo: null },
];
const CARD_LIMIT = { 'pf-card-0001': 45000, 'pj-card-0001': 180000 };

function faturasDoCartao(cardId) {
  const rng = rngFrom(cardId === 'pj-card-0001' ? 909090 : 424242);
  const lojas = cardId === 'pj-card-0001'
    ? [{ cat: 'Nuvem/SaaS', lojas: ['AWS', 'Google Cloud', 'Microsoft 365'], min: 500, max: 9000 }, { cat: 'Viagem Corp', lojas: ['Latam', 'Booking'], min: 800, max: 6000 }, { cat: 'Marketing', lojas: ['Meta Ads', 'Google Ads'], min: 1200, max: 12000 }, { cat: 'Equipamentos', lojas: ['Dell', 'Apple'], min: 900, max: 15000 }, { cat: 'Escritório', lojas: ['Kalunga', 'Amazon Business'], min: 200, max: 3000 }]
    : LOJAS_PF.map((x) => ({ cat: x.cat, lojas: x.lojas, min: x.min, max: x.max }));
  return MESES.map(({ y, m }) => {
    const lanc = [];
    const n = (cardId === 'pj-card-0001' ? 22 : 16) + Math.floor(rng() * 10);
    for (let k = 0; k < n; k++) { const c = pick(rng, lojas); lanc.push({ data: `${dd(1 + Math.floor(rng() * 27))}/${dd(m)}`, desc: pick(rng, c.lojas), cat: c.cat, val: val(rng, c.min, c.max) }); }
    const total = Number(lanc.reduce((s, l) => s + l.val, 0).toFixed(2));
    const mVenc = m === 12 ? 1 : m + 1;
    const status = (y === HOJE.y && m === HOJE.m) ? 'aberta' : (y === HOJE.y && m === HOJE.m - 1 ? 'fechada' : 'paga');
    return { billId: `bill-${cardId}-${y}-${dd(m)}`, competencia: `${y}-${dd(m)}`, dueDate: iso(mVenc === 1 ? y + 1 : y, mVenc, 7), status, total, lanc };
  }).reverse();
}
const FATURAS = { 'pf-card-0001': faturasDoCartao('pf-card-0001'), 'pj-card-0001': faturasDoCartao('pj-card-0001') };

export function creditCardLimits(cardId) {
  const limite = CARD_LIMIT[cardId] || 45000;
  const usado = FATURAS[cardId]?.[0]?.total || 0;
  return [{ creditLineLimitType: 'LIMITE_CREDITO_TOTAL', consolidationType: 'CONSOLIDADO', identificationNumber: cardId === 'pj-card-0001' ? '7777' : '5555', lineName: 'CREDITO_A_VISTA', lineNameAdditionalInfo: null, isLimitFlexible: false, limitAmountCurrency: 'BRL', limitAmount: amtStr(limite), usedAmountCurrency: 'BRL', usedAmount: amtStr(usado), availableAmountCurrency: 'BRL', availableAmount: amtStr(limite - usado) }];
}
export function creditCardBills(cardId) {
  return (FATURAS[cardId] || []).map((f) => ({
    billId: f.billId, dueDate: f.dueDate, billTotalAmount: amtStr(f.total), billTotalAmountCurrency: 'BRL',
    billMinimumAmount: amtStr(f.total * 0.15), billMinimumAmountCurrency: 'BRL', isInstalment: false,
    financeCharges: [{ type: 'JUROS_REMUNERATORIOS_ATRASO_PAGAMENTO_FATURA', additionalInfo: null, amount: amtStr(0), currency: 'BRL' }],
    payments: f.status === 'paga' ? [{ valueType: 'VALOR_PAGAMENTO_FATURA_REALIZADO', paymentDate: f.dueDate, paymentMode: 'DEBITO_CONTA_CORRENTE', amount: amtStr(f.total), currency: 'BRL' }] : [],
  }));
}
export function creditCardBillTransactions(cardId, billId) {
  const f = (FATURAS[cardId] || []).find((x) => x.billId === billId);
  if (!f) return [];
  return f.lanc.map((l, i) => ({ transactionId: `CCTX-${billId}-${dd(i)}`, identificationNumber: String(1000 + i), lineName: cardId === 'pj-card-0001' ? 'MASTERCARD' : 'VISA', transactionName: l.desc.slice(0, 100), billId, creditDebitType: 'DEBITO', transactionType: 'PAGAMENTO', transactionalAdditionalInfo: l.cat, paymentType: 'A_VISTA', feeType: null, otherCreditsType: null, brazilianAmount: amtStr(l.val), amount: amtStr(l.val), currency: 'BRL', transactionDateTime: `${f.competencia}-${l.data.slice(0, 2)}T12:00:00Z`, billPostDate: `${f.competencia}-${l.data.slice(0, 2)}`, payeeMCC: 5999 }));
}

// ── Empréstimos / Financiamentos (PF + PJ) ──
function loanContract({ id, num, productType, subtype, amount, outstanding, total, paid, taxAM, prox }) {
  return {
    contractId: id, contractNumber: num, ipocCode: `9279212601992927921265082222198931925257${id.slice(-4).replace(/\D/g, '0')}`,
    productName: productType === 'FINANCIAMENTOS' ? 'Financiamento' : (subtype.includes('GIRO') ? 'Capital de Giro' : 'Crédito Pessoal'),
    productType, productSubType: subtype, contractDate: '2024-09-15', disbursementDates: ['2024-09-16'], settlementDate: null,
    contractAmount: amtStr(amount), currency: 'BRL', dueDate: '2028-09-10', instalmentPeriodicity: 'MENSAL', instalmentPeriodicityAdditionalInfo: null,
    firstInstalmentDueDate: '2024-10-10', CET: rate(0.2489), amortizationScheduled: 'PRICE', amortizationScheduledAdditionalInfo: null,
    interestRates: [{ taxType: 'EFETIVA', interestRateType: 'SIMPLES', taxPeriodicity: 'AM', calculation: '30/360', referentialRateIndexerType: 'PRE_FIXADO', referentialRateIndexerSubType: 'PRE_FIXADO', preFixedRate: rate(taxAM), postFixedRate: rate(0), additionalInfo: null }],
    contractedFees: [{ feeName: 'Tarifa de Cadastro', feeCode: 'CADASTRO', feeChargeType: 'UNICA', feeCharge: 'FIXO', feeAmount: amtStr(0), feeRate: null }],
    contractedFinanceCharges: [{ chargeType: 'JUROS_MORA_ATRASO', chargeAdditionalInfo: null, chargeRate: rate(0.01) }, { chargeType: 'MULTA_ATRASO_PAGAMENTO', chargeAdditionalInfo: null, chargeRate: rate(0.02) }],
    _payments: { paidInstalments: paid, contractOutstandingBalance: amtStr(outstanding) },
    _instalments: { totalNumberOfInstalments: total, paidInstalments: paid, dueInstalments: total - paid, pastDueInstalments: 0, proxima: prox },
  };
}
export const LOANS = [
  loanContract({ id: 'pf-loan-0001', num: 'CTR-PF-2025-004417', productType: 'EMPRESTIMOS', subtype: 'CREDITO_PESSOAL_SEM_CONSIGNACAO', amount: 20000, outstanding: 11480.32, total: 24, paid: 9, taxAM: 1.89, prox: { valor: 962.15, venc: '2026-08-10' } }),
  loanContract({ id: 'pj-loan-0001', num: 'CTR-PJ-2026-000210', productType: 'EMPRESTIMOS', subtype: 'CAPITAL_GIRO_PRAZO_VENCIMENTO_SUPERIOR_365_DIAS', amount: 150000, outstanding: 121340.10, total: 36, paid: 5, taxAM: 1.42, prox: { valor: 8250.40, venc: '2026-08-10' } }),
];
export const FINANCINGS = [
  loanContract({ id: 'pj-fin-0001', num: 'CTR-PJ-2024-118820', productType: 'FINANCIAMENTOS', subtype: 'AQUISICAO_BENS_VEICULOS_AUTOMOTORES', amount: 220000, outstanding: 148900.55, total: 48, paid: 20, taxAM: 1.35, prox: { valor: 5980.40, venc: '2026-08-05' } }),
];
export function loanListItem(c) { return { contractId: c.contractId, brandName: BRAND, companyCnpj: CNPJ_BRADESCO, productType: c.productType, productSubType: c.productSubType, ipocCode: c.ipocCode }; }
export function loanPayments(c) { return { paidInstalments: c._payments.paidInstalments, contractOutstandingBalance: c._payments.contractOutstandingBalance, releases: [{ paymentId: `pay-${c.contractId}-1`, isOverParcelPayment: false, instalmentId: '1', paidDate: '2024-10-10', currency: 'BRL', paidAmount: c._instalments.proxima.valor.toFixed(2) }] }; }
export function loanInstalments(c) { return { typeNumberOfInstalments: 'MES', totalNumberOfInstalments: c._instalments.totalNumberOfInstalments, typeContractRemaining: 'MES', contractRemainingNumber: c._instalments.dueInstalments, paidInstalments: c._instalments.paidInstalments, dueInstalments: c._instalments.dueInstalments, pastDueInstalments: c._instalments.pastDueInstalments, balloonPayments: [] }; }

// ── Consent (agora PF + PJ, com business + resources) ──
export const CONSENT = {
  consentId: 'urn:bradesco:C1DD33123-3123-4c25-a3b7-3b1e4f9f6f01', status: 'AUTHORISED',
  statusUpdateDateTime: '2026-07-01T12:00:00Z', creationDateTime: '2026-07-01T11:58:00Z', expirationDateTime: '2027-01-01T00:00:00Z',
  permissions: ['ACCOUNTS_READ', 'ACCOUNTS_BALANCES_READ', 'ACCOUNTS_TRANSACTIONS_READ', 'ACCOUNTS_OVERDRAFT_LIMITS_READ', 'CREDIT_CARDS_ACCOUNTS_READ', 'CREDIT_CARDS_ACCOUNTS_LIMITS_READ', 'CREDIT_CARDS_ACCOUNTS_BILLS_READ', 'CREDIT_CARDS_ACCOUNTS_TRANSACTIONS_READ', 'CUSTOMERS_PERSONAL_IDENTIFICATIONS_READ', 'CUSTOMERS_PERSONAL_ADITTIONALINFO_READ', 'CUSTOMERS_BUSINESS_IDENTIFICATIONS_READ', 'CUSTOMERS_BUSINESS_ADITTIONALINFO_READ', 'LOANS_READ', 'LOANS_PAYMENTS_READ', 'LOANS_SCHEDULED_INSTALMENTS_READ', 'FINANCINGS_READ', 'RESOURCES_READ'],
};

// ── Customers ──
export const PERSONAL_IDENTIFICATION = { updateDateTime: REQ_DT, personalId: 'per-0001', brandName: BRAND, civilName: 'RAUL SOUSA', socialName: null, birthDate: '1988-04-12', maritalStatusCode: 'CASADO', sex: 'MASCULINO', documents: { cpfNumber: CPF_PF, passport: null }, hasBrazilianNationality: true, contacts: { postalAddresses: [{ isMain: true, address: 'AV PAULISTA 1000', townName: 'SAO PAULO', countrySubDivision: 'SP', postCode: '01310100', country: 'BRA' }], phones: [{ isMain: true, type: 'MOVEL', areaCode: '11', number: '999990089' }], emails: [{ isMain: true, email: 'raul@sousatech.com.br' }] } };
export const PERSONAL_QUALIFICATION = { updateDateTime: REQ_DT, occupationCode: 'RECEITA_FEDERAL', occupationDescription: 'Empresário', informedIncome: { frequency: 'MENSAL', amount: amtStr(18000), currency: 'BRL', date: '2026-07-01' }, informedPatrimony: { amount: amtStr(1250000), currency: 'BRL', year: 2025 } };
export const PERSONAL_FINANCIAL_RELATION = { updateDateTime: REQ_DT, startDate: '2015-03-01T00:00:00Z', productsServicesType: ['CONTA_DEPOSITO_A_VISTA', 'CONTA_POUPANCA', 'CARTAO_CREDITO', 'OPERACAO_CREDITO', 'INVESTIMENTO'], accounts: [{ compeCode: '237', branchCode: '1234', number: '567890', checkDigit: '0', type: 'CONTA_DEPOSITO_A_VISTA' }, { compeCode: '237', branchCode: '1234', number: '112233', checkDigit: '2', type: 'CONTA_POUPANCA' }] };

export const BUSINESS_IDENTIFICATION = { updateDateTime: REQ_DT, businessId: 'biz-0001', brandName: BRAND, companyName: 'SOUSA TECH LTDA', tradeName: 'Sousa Tech', incorporationDate: '2015-02-10', document: { identification: CNPJ_PJ, additionalInfo: 'CNPJ' }, companyCnpjNumber: [CNPJ_PJ], parties: [{ personType: 'PESSOA_NATURAL', type: 'SOCIO', civilName: 'RAUL SOUSA', cpfNumber: CPF_PF, shareholding: '80.0000', documentType: 'CPF' }], contacts: { postalAddresses: [{ isMain: true, address: 'AV FARIA LIMA 3000', townName: 'SAO PAULO', countrySubDivision: 'SP', postCode: '04538133', country: 'BRA' }], phones: [{ isMain: true, type: 'FIXO', areaCode: '11', number: '35550100' }], emails: [{ isMain: true, email: 'financeiro@sousatech.com.br' }] } };
export const BUSINESS_QUALIFICATION = { updateDateTime: REQ_DT, informedRevenue: { frequency: 'ANUAL', frequencyAdditionalInformation: null, amount: amtStr(2850000), currency: 'BRL', year: 2025 }, informedPatrimony: { amount: amtStr(3400000), currency: 'BRL', date: '2025-12-31' } };
export const BUSINESS_FINANCIAL_RELATION = { updateDateTime: REQ_DT, startDate: '2015-03-01T00:00:00Z', productsServicesType: ['CONTA_DEPOSITO_A_VISTA', 'CARTAO_CREDITO', 'OPERACAO_CREDITO', 'FINANCIAMENTO'], accounts: [{ compeCode: '237', branchCode: '1234', number: '998877', checkDigit: '5', type: 'CONTA_DEPOSITO_A_VISTA' }] };

// ── Investimentos (mantidos, atrelados à PF) ──
export const INVESTMENTS = {
  BANK_FIXED_INCOME: [{ investmentId: 'bfi-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, investmentType: 'CDB', updatedValue: { amount: amtStr(80000), currency: 'BRL' }, grossAmount: { amount: amtStr(80000), currency: 'BRL' }, netAmount: { amount: amtStr(78600), currency: 'BRL' }, dueDate: '2029-01-15' }],
  CREDIT_FIXED_INCOME: [{ investmentId: 'cfi-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, investmentType: 'LCI', updatedValue: { amount: amtStr(30000), currency: 'BRL' }, grossAmount: { amount: amtStr(30000), currency: 'BRL' }, netAmount: { amount: amtStr(30000), currency: 'BRL' }, dueDate: '2027-06-01' }],
  TREASURE_TITLE: [{ investmentId: 'tt-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, investmentType: 'TESOURO_SELIC', isinCode: 'BRSTNCLF1RA5', updatedValue: { amount: amtStr(52500), currency: 'BRL' }, grossAmount: { amount: amtStr(52500), currency: 'BRL' }, netAmount: { amount: amtStr(51800), currency: 'BRL' }, dueDate: '2029-03-01' }],
  FUND: [{ investmentId: 'fund-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, anbimaCategory: 'RENDA_FIXA', name: 'Bradesco FIC FI RF', updatedValue: { amount: amtStr(25229.18), currency: 'BRL' }, quotaQuantity: '1245.331200', quotaGrossPriceValue: { amount: '20.2600', currency: 'BRL' } }],
  VARIABLE_INCOME: [{ investmentId: 'vi-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, ticker: 'BBDC4', isinCode: 'BRBBDCACNPR8', updatedValue: { amount: amtStr(26004.93), currency: 'BRL' }, quantity: '1800.000000' }],
};

// ── Seleção de conta (extensão p/ a jornada) ──
export function accountSelection() {
  const rot = { 'pf-cc-0001': 'PF · Conta Corrente', 'pf-poup-0001': 'PF · Poupança', 'pj-cc-0001': 'PJ · Conta Corrente' };
  return Object.entries(ENTITIES).flatMap(([ent, e]) => e.accounts.map((accountId) => {
    const a = ACCOUNTS.find((x) => x.accountId === accountId);
    return { accountId, titular: e.name, personType: e.personType, documento: e.document, tipo: a.type, rotulo: rot[accountId], saldo_disponivel: amt(SALDO[accountId].availableAmount) };
  }));
}

// ── Cruzamento analítico PF × PJ (extensão) ──
function resumoEntidade(ent) {
  const e = ENTITIES[ent];
  const contaCorrente = e.accounts.find((a) => a.includes('-cc-'));
  const tx = TX[contaCorrente] || [];
  const porMes = {};
  const catDebito = {};
  let entradas = 0, saidas = 0;
  for (const t of tx) {
    const mes = t.transactionDateTime.slice(0, 7);
    const v = Number(t.transactionAmount.amount);
    porMes[mes] = porMes[mes] || { entradas: 0, saidas: 0 };
    if (t.creditDebitType === 'CREDITO') { entradas += v; porMes[mes].entradas += v; }
    else { saidas += v; porMes[mes].saidas += v; catDebito[t.type] = (catDebito[t.type] || 0) + v; }
  }
  const fluxo = Object.entries(porMes).sort().map(([mes, o]) => ({ mes, entradas: Number(o.entradas.toFixed(2)), saidas: Number(o.saidas.toFixed(2)), liquido: Number((o.entradas - o.saidas).toFixed(2)) }));
  const cartao = e.cards.reduce((s, c) => s + (FATURAS[c]?.[0]?.total || 0), 0);
  const divida = [...LOANS, ...FINANCINGS].filter((c) => c.contractId.startsWith(ent.toLowerCase() + '-')).reduce((s, c) => s + Number(c._payments.contractOutstandingBalance), 0);
  const saldo = e.accounts.reduce((s, a) => s + SALDO[a].availableAmount, 0);
  return {
    titular: e.name, personType: e.personType,
    saldo_disponivel_total: Number(saldo.toFixed(2)),
    entradas_12m: Number(entradas.toFixed(2)), saidas_12m: Number(saidas.toFixed(2)), fluxo_liquido_12m: Number((entradas - saidas).toFixed(2)),
    fatura_cartao_atual: Number(cartao.toFixed(2)), divida_total: Number(divida.toFixed(2)),
    top_saidas_por_tipo: Object.entries(catDebito).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([tipo, v]) => ({ tipo, valor: Number(v.toFixed(2)) })),
    fluxo_mensal: fluxo,
  };
}
export function analytics() {
  const pf = resumoEntidade('PF'), pj = resumoEntidade('PJ');
  // Cruzamento: pró-labore PJ→PF ao longo de 12 meses
  const proLabore = (TX['pj-cc-0001'] || []).filter((t) => /PRO-LABORE|RAUL SOUSA/.test(t.transactionName) && t.creditDebitType === 'DEBITO').reduce((s, t) => s + Number(t.transactionAmount.amount), 0);
  return {
    gerado_em: REQ_DT,
    entidades: { PF: pf, PJ: pj },
    consolidado: {
      saldo_disponivel_total: Number((pf.saldo_disponivel_total + pj.saldo_disponivel_total).toFixed(2)),
      divida_total: Number((pf.divida_total + pj.divida_total).toFixed(2)),
      patrimonio_liquido_aprox: Number((pf.saldo_disponivel_total + pj.saldo_disponivel_total - pf.divida_total - pj.divida_total).toFixed(2)),
    },
    cruzamentos: {
      pro_labore_pj_para_pf_12m: Number(proLabore.toFixed(2)),
      dependencia_pf_da_pj_pct: Number(((proLabore / (pf.entradas_12m || 1)) * 100).toFixed(1)),
      indice_liquidez_pj: Number((pj.saldo_disponivel_total / (pj.divida_total || 1)).toFixed(2)),
    },
  };
}
