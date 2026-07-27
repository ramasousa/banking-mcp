// ─────────────────────────────────────────────────────────────
// Datasets fiéis ao Open Finance Brasil (mock).
// Reaproveita os números do mock-bank.js remodelados para os campos e
// enums oficiais das APIs (accounts, credit-cards, customers, loans,
// financings, investments, consents, resources, payments).
// ─────────────────────────────────────────────────────────────

import { CONTA, executores as mock } from '../../mock-bank.js';
import { amt, amtStr, rate, REQ_DT, CNPJ_BRADESCO, BRAND } from './of-helpers.js';

// ── Consent (GET /consents/v3/consents/{id}) ──
export const CONSENT = {
  consentId: 'urn:bradesco:C1DD33123-3123-4c25-a3b7-3b1e4f9f6f01',
  status: 'AUTHORISED', // AUTHORISED | AWAITING_AUTHORISATION | REJECTED
  statusUpdateDateTime: '2026-07-01T12:00:00Z',
  creationDateTime: '2026-07-01T11:58:00Z',
  expirationDateTime: '2027-01-01T00:00:00Z',
  permissions: [
    'ACCOUNTS_READ', 'ACCOUNTS_BALANCES_READ', 'ACCOUNTS_TRANSACTIONS_READ', 'ACCOUNTS_OVERDRAFT_LIMITS_READ',
    'CREDIT_CARDS_ACCOUNTS_READ', 'CREDIT_CARDS_ACCOUNTS_LIMITS_READ', 'CREDIT_CARDS_ACCOUNTS_BILLS_READ',
    'CREDIT_CARDS_ACCOUNTS_TRANSACTIONS_READ',
    'CUSTOMERS_PERSONAL_IDENTIFICATIONS_READ', 'CUSTOMERS_PERSONAL_ADITTIONALINFO_READ',
    'LOANS_READ', 'LOANS_PAYMENTS_READ', 'LOANS_SCHEDULED_INSTALMENTS_READ', 'LOANS_WARRANTIES_READ',
    'FINANCINGS_READ',
    'BANK_FIXED_INCOMES_READ', 'CREDIT_FIXED_INCOMES_READ', 'FUNDS_READ', 'TREASURE_TITLES_READ', 'VARIABLE_INCOMES_READ',
    'RESOURCES_READ',
  ],
};

// ── Accounts (GET /accounts/v2/accounts) ──
export const ACCOUNTS = [
  { accountId: 'acc-cc-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, type: 'CONTA_DEPOSITO_A_VISTA', compeCode: '237', branchCode: '1234', number: '567890', checkDigit: '0', currency: 'BRL' },
  { accountId: 'acc-poup-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, type: 'CONTA_POUPANCA', compeCode: '237', branchCode: '1234', number: '112233', checkDigit: '2', currency: 'BRL' },
];

export function accountBalances(accountId) {
  if (accountId === 'acc-poup-0001') {
    return { availableAmount: amt(CONTA.poupanca), blockedAmount: amt(0), automaticallyInvestedAmount: amt(0), updateDateTime: REQ_DT };
  }
  return { availableAmount: amt(CONTA.disponivel), blockedAmount: amt(CONTA.bloqueado), automaticallyInvestedAmount: amt(0), updateDateTime: REQ_DT };
}

export function accountOverdraftLimits() {
  return {
    overdraftContractedLimit: amt(CONTA.limite),
    overdraftUsedLimit: amt(0),
    unarrangedOverdraftAmount: amt(0),
  };
}

// Mapeia a categoria interna → enum de tipo de transação do Open Finance.
function tipoTransacao(it) {
  if (it.ic === '⚡' || it.cat === 'Transferência') return 'PIX';
  if (/Sal[áa]rio/i.test(it.desc)) return 'FOLHA_PAGAMENTO';
  if (it.cat === 'Cartão de crédito') return 'CARTAO';
  if (it.cat === 'Contas') return 'CONVENIO_ARRECADACAO';
  if (it.cat === 'Moradia') return 'TED';
  if (it.cat === 'Rendimentos') return 'RENDIMENTO_APLIC_FINANCEIRA';
  if (it.cat === 'Investimentos') return 'RESGATE_APLIC_FINANCEIRA';
  if (it.cat === 'Crédito em conta') return 'DEPOSITO';
  return 'CARTAO';
}

// Transações no formato Open Finance, derivadas do extrato interno.
export function accountTransactions() {
  const grupos = mock.consultar_extrato({ dias: 90 }).data.grupos;
  const out = [];
  for (const g of grupos) {
    g.items.forEach((it, i) => {
      out.push({
        transactionId: `TXN${g.date.replace(/-/g, '')}${String(i).padStart(2, '0')}`,
        completedAuthorisedPaymentType: 'TRANSACAO_EFETIVADA',
        creditDebitType: it.val >= 0 ? 'CREDITO' : 'DEBITO',
        transactionName: it.desc.slice(0, 200),
        type: tipoTransacao(it),
        transactionAmount: amt(Math.abs(it.val)),
        transactionDateTime: `${g.date}T10:00:00.000Z`,
      });
    });
  }
  return out;
}

// ── Credit cards (GET /credit-cards-accounts/v2/accounts) ──
export const CREDIT_CARDS = [
  {
    creditCardAccountId: 'card-0001',
    brandName: BRAND,
    companyCnpj: CNPJ_BRADESCO,
    name: 'BRADESCO VISA INFINITE',
    productType: 'INFINITE_INTERNACIONAL',
    productAdditionalInfo: null,
    creditCardNetwork: 'VISA',
    networkAdditionalInfo: null,
  },
];

export function creditCardLimits() {
  const f = mock.consultar_fatura({}).data.fatura_atual;
  return [
    {
      creditLineLimitType: 'LIMITE_CREDITO_TOTAL',
      consolidationType: 'CONSOLIDADO',
      identificationNumber: '5555',
      lineName: 'CREDITO_A_VISTA',
      lineNameAdditionalInfo: null,
      isLimitFlexible: false,
      limitAmountCurrency: 'BRL',
      limitAmount: amt(45000).amount,
      usedAmountCurrency: 'BRL',
      usedAmount: amt(45000 - f.limite_disponivel).amount,
      availableAmountCurrency: 'BRL',
      availableAmount: amt(f.limite_disponivel).amount,
    },
  ];
}

function vencToIso(venc) {
  const [d, m] = String(venc).split('/');
  return `2026-${m}-${d}`;
}

export function creditCardBills() {
  // as 4 competências, cada uma vira uma "bill"
  const comps = ['2026-07', '2026-06', '2026-05', '2026-04'];
  return comps.map((c) => {
    const f = mock.consultar_fatura({ competencia: c }).data;
    return {
      billId: `bill-${c}`,
      dueDate: vencToIso(f.vencimento),
      billTotalAmount: amtStr(f.total),
      billTotalAmountCurrency: 'BRL',
      billMinimumAmount: amtStr(f.total * 0.15),
      billMinimumAmountCurrency: 'BRL',
      isInstalment: false,
      financeCharges: [
        { type: 'JUROS_REMUNERATORIOS_ATRASO_PAGAMENTO_FATURA', additionalInfo: null, amount: amtStr(0), currency: 'BRL' },
      ],
      payments: f.status === 'paga'
        ? [{ valueType: 'VALOR_PAGAMENTO_FATURA_REALIZADO', paymentDate: vencToIso(f.vencimento), paymentMode: 'DEBITO_CONTA_CORRENTE', amount: amtStr(f.total), currency: 'BRL' }]
        : [],
    };
  });
}

export function creditCardBillTransactions(billId) {
  const comp = String(billId).replace('bill-', '');
  const f = mock.consultar_fatura({ competencia: comp }).data;
  if (!f || f.erro) return [];
  return f.lancamentos.map((l, i) => ({
    transactionId: `CCTX-${comp}-${String(i).padStart(3, '0')}`,
    identificationNumber: String(1000 + i),
    lineName: 'VISA',
    transactionName: l.desc.slice(0, 100),
    billId: `bill-${comp}`,
    creditDebitType: 'DEBITO',
    transactionType: 'PAGAMENTO',
    transactionalAdditionalInfo: l.cat,
    paymentType: 'A_VISTA',
    feeType: null,
    otherCreditsType: null,
    chargeIdentificator: null,
    chargeNumber: null,
    brazilianAmount: amtStr(l.val),
    amount: amtStr(l.val),
    currency: 'BRL',
    transactionDateTime: `2026-${comp.slice(5)}-${l.data.slice(0, 2)}T12:00:00Z`,
    billPostDate: `2026-${comp.slice(5)}-${l.data.slice(0, 2)}`,
    payeeMCC: 5999,
  }));
}

// ── Customers (personal) ──
export const PERSONAL_IDENTIFICATION = {
  updateDateTime: REQ_DT,
  personalId: 'per-0001',
  brandName: BRAND,
  civilName: 'RAUL SOUSA',
  socialName: null,
  birthDate: '1988-04-12',
  maritalStatusCode: 'CASADO',
  sex: 'MASCULINO',
  documents: { cpfNumber: '12345678909', passport: null },
  hasBrazilianNationality: true,
  contacts: {
    postalAddresses: [{ isMain: true, address: 'AV PAULISTA 1000', townName: 'SAO PAULO', countrySubDivision: 'SP', postCode: '01310100', country: 'BRA' }],
    phones: [{ isMain: true, type: 'MOVEL', areaCode: '11', number: '999990089' }],
    emails: [{ isMain: true, email: 'r****@gmail.com' }],
  },
};

export const PERSONAL_QUALIFICATION = {
  updateDateTime: REQ_DT,
  occupationCode: 'RECEITA_FEDERAL',
  occupationDescription: '01', // Assalariado (tabela RFB)
  informedIncome: { frequency: 'MENSAL', amount: amtStr(12500), currency: 'BRL', date: '2026-07-01' },
  informedPatrimony: { amount: amtStr(420000), currency: 'BRL', year: 2025 },
};

export const PERSONAL_FINANCIAL_RELATION = {
  updateDateTime: REQ_DT,
  startDate: '2015-03-01T00:00:00Z',
  productsServicesType: ['CONTA_DEPOSITO_A_VISTA', 'CONTA_POUPANCA', 'CARTAO_CREDITO', 'OPERACAO_CREDITO', 'INVESTIMENTO'],
  accounts: [
    { compeCode: '237', branchCode: '1234', number: '567890', checkDigit: '0', type: 'CONTA_DEPOSITO_A_VISTA' },
    { compeCode: '237', branchCode: '1234', number: '112233', checkDigit: '2', type: 'CONTA_POUPANCA' },
  ],
};

// ── Loans (GET /loans/v2/contracts) ──
function loanContract({ id, num, subtype, amount, outstanding, total, paid, taxAM, prox }) {
  return {
    contractId: id,
    contractNumber: num,
    ipocCode: `92792126019929279212650822221989319252576314${id.slice(-2)}`,
    productName: subtype === 'FINANCIAMENTO' ? 'Financiamento de Veículo' : 'Crédito Pessoal',
    productType: 'EMPRESTIMOS',
    productSubType: subtype,
    contractDate: '2024-09-15',
    disbursementDates: ['2024-09-16'],
    settlementDate: null,
    contractAmount: amtStr(amount),
    currency: 'BRL',
    dueDate: '2028-09-10',
    instalmentPeriodicity: 'MENSAL',
    instalmentPeriodicityAdditionalInfo: null,
    firstInstalmentDueDate: '2024-10-10',
    CET: rate(0.2489),
    amortizationScheduled: 'PRICE',
    amortizationScheduledAdditionalInfo: null,
    interestRates: [
      { taxType: 'EFETIVA', interestRateType: 'SIMPLES', taxPeriodicity: 'AM', calculation: '30/360',
        referentialRateIndexerType: 'PRE_FIXADO', referentialRateIndexerSubType: 'PRE_FIXADO',
        preFixedRate: rate(taxAM), postFixedRate: rate(0), additionalInfo: null },
    ],
    contractedFees: [
      { feeName: 'Tarifa de Cadastro', feeCode: 'CADASTRO', feeChargeType: 'UNICA', feeCharge: 'FIXO', feeAmount: amtStr(0), feeRate: null },
    ],
    contractedFinanceCharges: [
      { chargeType: 'JUROS_MORA_ATRASO', chargeAdditionalInfo: null, chargeRate: rate(0.01) },
      { chargeType: 'MULTA_ATRASO_PAGAMENTO', chargeAdditionalInfo: null, chargeRate: rate(0.02) },
    ],
    _payments: { paidInstalments: paid, contractOutstandingBalance: amtStr(outstanding) },
    _instalments: { totalNumberOfInstalments: total, paidInstalments: paid, dueInstalments: total - paid, pastDueInstalments: 0, proxima: prox },
  };
}

export const LOANS = [
  loanContract({ id: 'loan-0001', num: 'CTR-2025-004417', subtype: 'CREDITO_PESSOAL_SEM_CONSIGNACAO', amount: 20000, outstanding: 11480.32, total: 24, paid: 9, taxAM: 1.89, prox: { valor: 962.15, venc: '2026-08-10' } }),
];
export const FINANCINGS = [
  loanContract({ id: 'fin-0001', num: 'CTR-2024-118820', subtype: 'FINANCIAMENTO', amount: 68000, outstanding: 39210.77, total: 48, paid: 20, taxAM: 1.55, prox: { valor: 1740.40, venc: '2026-08-05' } }),
];

export function loanListItem(c) {
  return { contractId: c.contractId, brandName: BRAND, companyCnpj: CNPJ_BRADESCO, productType: c.productType, productSubType: c.productSubType, ipocCode: c.ipocCode };
}
export function loanPayments(c) {
  return {
    paidInstalments: c._payments.paidInstalments,
    contractOutstandingBalance: c._payments.contractOutstandingBalance,
    releases: [
      { paymentId: `pay-${c.contractId}-1`, isOverParcelPayment: false, instalmentId: '1', paidDate: '2024-10-10', currency: 'BRL', paidAmount: c._instalments.proxima.valor.toFixed(2) },
    ],
  };
}
export function loanInstalments(c) {
  return {
    typeNumberOfInstalments: 'MES',
    totalNumberOfInstalments: c._instalments.totalNumberOfInstalments,
    typeContractRemaining: 'MES',
    contractRemainingNumber: c._instalments.dueInstalments,
    paidInstalments: c._instalments.paidInstalments,
    dueInstalments: c._instalments.dueInstalments,
    pastDueInstalments: c._instalments.pastDueInstalments,
    balloonPayments: [],
  };
}

// ── Investments ──
export const INVESTMENTS = {
  BANK_FIXED_INCOME: [
    { investmentId: 'bfi-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, investmentType: 'CDB', isinCode: null,
      updatedValue: { amount: amtStr(80000), currency: 'BRL' }, grossAmount: { amount: amtStr(80000), currency: 'BRL' }, netAmount: { amount: amtStr(78600), currency: 'BRL' }, dueDate: '2029-01-15', clearingCode: null },
  ],
  CREDIT_FIXED_INCOME: [
    { investmentId: 'cfi-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, investmentType: 'LCI', isinCode: null,
      updatedValue: { amount: amtStr(30000), currency: 'BRL' }, grossAmount: { amount: amtStr(30000), currency: 'BRL' }, netAmount: { amount: amtStr(30000), currency: 'BRL' }, dueDate: '2027-06-01' },
  ],
  TREASURE_TITLE: [
    { investmentId: 'tt-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, investmentType: 'TESOURO_SELIC', isinCode: 'BRSTNCLF1RA5',
      updatedValue: { amount: amtStr(52500), currency: 'BRL' }, grossAmount: { amount: amtStr(52500), currency: 'BRL' }, netAmount: { amount: amtStr(51800), currency: 'BRL' }, dueDate: '2029-03-01' },
  ],
  FUND: [
    { investmentId: 'fund-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, anbimaCategory: 'RENDA_FIXA', name: 'Bradesco FIC FI RF',
      updatedValue: { amount: amtStr(25229.18), currency: 'BRL' }, quotaQuantity: '1245.331200', quotaGrossPriceValue: { amount: '20.2600', currency: 'BRL' } },
  ],
  VARIABLE_INCOME: [
    { investmentId: 'vi-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, ticker: 'BBDC4', isinCode: 'BRBBDCACNPR8',
      updatedValue: { amount: amtStr(26004.93), currency: 'BRL' }, quantity: '1800.000000' },
  ],
};
