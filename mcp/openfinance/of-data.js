// ─────────────────────────────────────────────────────────────
// Datasets fiéis ao Open Finance Brasil — MULTI-PERFIL (massa de teste).
//
// Cada PERFIL é um cliente independente, com sua própria massa determinística
// de 12 meses (ago/2025 → jul/2026). Isso permite que várias pessoas do time
// testem no WhatsApp e cada uma veja os "seus próprios" dados.
//
//   raul    PF + PJ  (Sousa Tech)      — empresário de tecnologia
//   heitor  PF + PJ  (Almeida Alim.)   — comércio/varejo (sazonal, folha maior)
//   cadimo  PF + PJ  (Pereira Consult.)— serviços/consultoria (volume menor)
//   patz    PF       (sem PJ)          — CLT/freelancer → exercita "sugerir PJ"
//
// O perfil é selecionado por `ctx.profile` (ver core.js/catalog.js). Sem ctx,
// cai no DEFAULT_PROFILE ('raul') — comportamento idêntico ao anterior para os
// canais que não passam perfil (connector do Claude, protótipo web).
// ─────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { amt, amtStr, rate, REQ_DT, CNPJ_BRADESCO, BRAND } from './of-helpers.js';
import { expandSpec } from './profile-spec.js';

const HOJE = { y: 2026, m: 7, d: 23 };

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
const tId = (pfx, y, m, i) => `${pfx}${y}${dd(m)}${dd(i)}`;

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
const FORNEC_PJ = ['AWS Serviços de Nuvem', 'Google Cloud', 'Fornecedor Alpha Ltda', 'Distribuidora Beta', 'Locação Escritório', 'Contabilidade Sigma', 'Marketing Digital Ltda', 'Papelaria Central'];
const CLIENTES_PJ = ['Cliente Acme S.A.', 'Cliente Nexus Ltda', 'Cliente Orion ME', 'Cliente Vega Corp', 'Cliente Delta Ltda'];

// ── Contrato de empréstimo/financiamento (puro; recebe params do perfil) ──
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
function loanListItem(c) { return { contractId: c.contractId, brandName: BRAND, companyCnpj: CNPJ_BRADESCO, productType: c.productType, productSubType: c.productSubType, ipocCode: c.ipocCode }; }
function loanPayments(c) { return { paidInstalments: c._payments.paidInstalments, contractOutstandingBalance: c._payments.contractOutstandingBalance, releases: [{ paymentId: `pay-${c.contractId}-1`, isOverParcelPayment: false, instalmentId: '1', paidDate: '2024-10-10', currency: 'BRL', paidAmount: c._instalments.proxima.valor.toFixed(2) }] }; }
function loanInstalments(c) { return { typeNumberOfInstalments: 'MES', totalNumberOfInstalments: c._instalments.totalNumberOfInstalments, typeContractRemaining: 'MES', contractRemainingNumber: c._instalments.dueInstalments, paidInstalments: c._instalments.paidInstalments, dueInstalments: c._instalments.dueInstalments, pastDueInstalments: c._instalments.pastDueInstalments, balloonPayments: [] }; }

// Deriva o conjunto de contas/produtos quando o cfg não traz `contas` explícito
// (preserva o comportamento dos perfis internos).
function deriveContas(cfg) {
  const c = ['pf-cc'];
  if (cfg.poupanca !== false) c.push('pf-poup');
  c.push('pf-card', 'pf-loan', 'pf-invest');
  if (cfg.hasPJ) { c.push('pj-cc', 'pj-card', 'pj-loan'); if (cfg.finPJ) c.push('pj-fin'); }
  return c;
}

// ═════════════════════════════════════════════════════════════
// FÁBRICA DE PERFIL — recebe a config e devolve o "bundle" de dados D.
// `cfg.contas` (opcional) controla QUAIS contas/produtos existem:
//   pf-cc, pf-poup, pf-card, pf-loan, pf-invest, pj-cc, pj-card, pj-loan, pj-fin
// ═════════════════════════════════════════════════════════════
function buildProfile(cfg) {
  const contas = new Set(cfg.contas && cfg.contas.length ? cfg.contas : deriveContas(cfg));
  const has = (t) => contas.has(t);
  const hasPJ = has('pj-cc');

  // ── Entidades / contas ──
  const ENTITIES = {
    PF: {
      personType: 'PESSOA_NATURAL', name: cfg.nome, document: cfg.cpf,
      accounts: ['pf-cc-0001', ...(has('pf-poup') ? ['pf-poup-0001'] : [])],
      cards: has('pf-card') ? ['pf-card-0001'] : [], loans: has('pf-loan') ? ['pf-loan-0001'] : [], financings: [],
    },
  };
  if (hasPJ) ENTITIES.PJ = {
    personType: 'PESSOA_JURIDICA', name: cfg.empresa, document: cfg.cnpj,
    accounts: ['pj-cc-0001'], cards: has('pj-card') ? ['pj-card-0001'] : [],
    loans: has('pj-loan') ? ['pj-loan-0001'] : [], financings: has('pj-fin') ? ['pj-fin-0001'] : [],
  };

  const ACCOUNTS = [
    { accountId: 'pf-cc-0001', ownerType: 'PESSOA_NATURAL', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, type: 'CONTA_DEPOSITO_A_VISTA', compeCode: '237', branchCode: '1234', number: '567890', checkDigit: '0', currency: 'BRL' },
  ];
  if (has('pf-poup')) ACCOUNTS.push({ accountId: 'pf-poup-0001', ownerType: 'PESSOA_NATURAL', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, type: 'CONTA_POUPANCA', compeCode: '237', branchCode: '1234', number: '112233', checkDigit: '2', currency: 'BRL' });
  if (hasPJ) ACCOUNTS.push({ accountId: 'pj-cc-0001', ownerType: 'PESSOA_JURIDICA', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, type: 'CONTA_DEPOSITO_A_VISTA', compeCode: '237', branchCode: '1234', number: '998877', checkDigit: '5', currency: 'BRL' });

  const SALDO = {
    'pf-cc-0001': { availableAmount: cfg.saldoCC, blockedAmount: cfg.ccBlocked || 0, automaticallyInvestedAmount: 0 },
  };
  if (has('pf-poup')) SALDO['pf-poup-0001'] = { availableAmount: cfg.saldoPoup, blockedAmount: 0, automaticallyInvestedAmount: 0 };
  if (hasPJ) SALDO['pj-cc-0001'] = { availableAmount: cfg.saldoPJ, blockedAmount: cfg.pjBlocked || 0, automaticallyInvestedAmount: cfg.pjInvested || 0 };

  function accountBalances(accountId) {
    const s = SALDO[accountId] || SALDO['pf-cc-0001'];
    return { availableAmount: amt(s.availableAmount), blockedAmount: amt(s.blockedAmount), automaticallyInvestedAmount: amt(s.automaticallyInvestedAmount), updateDateTime: REQ_DT };
  }
  function accountOverdraftLimits(accountId) {
    const lim = accountId === 'pj-cc-0001' ? 80000 : 15000;
    return { overdraftContractedLimit: amt(lim), overdraftUsedLimit: amt(0), unarrangedOverdraftAmount: amt(0) };
  }

  // ── Extrato PF (conta corrente) ──
  function gerarPF() {
    const rng = rngFrom(cfg.seed.pf);
    const tx = [];
    MESES.forEach(({ y, m, ultimo }) => {
      let i = 0;
      const add = (d, name, type, cdt, amount, h) => tx.push({
        transactionId: tId('PF', y, m, i++), completedAuthorisedPaymentType: 'TRANSACAO_EFETIVADA',
        creditDebitType: cdt, transactionName: name.slice(0, 200), type, transactionAmount: amt(amount), transactionDateTime: dt(y, m, Math.min(d, ultimo), h),
      });
      // Renda principal: pró-labore (se tem PJ) ou salário do empregador (CLT/freelancer).
      if (hasPJ) {
        add(5, `PRO-LABORE ${cfg.empresa}`, 'PIX', 'CREDITO', cfg.proLabore);
        if (m === 12) add(20, `13o ${cfg.empresa}`, 'PIX', 'CREDITO', cfg.decimo);
      } else {
        add(5, `${cfg.rendaLabel || 'SALARIO'} ${cfg.empregador}`, 'FOLHA_PAGAMENTO', 'CREDITO', cfg.rendaMensal);
        if (m === 12) add(20, `13o SALARIO ${cfg.empregador}`, 'FOLHA_PAGAMENTO', 'CREDITO', cfg.decimo);
      }
      add(1, 'RENDIMENTO POUPANCA', 'RENDIMENTO_APLIC_FINANCEIRA', 'CREDITO', val(rng, 380, 620));
      if (rng() > 0.5) add(14 + Math.floor(rng() * 8), `PIX RECEBIDO ${pick(rng, ['Reembolso', 'Freelance', 'Venda usados'])}`, 'PIX', 'CREDITO', val(rng, 300, 2500));
      // Débitos fixos
      add(8, 'ALUGUEL IMOBILIARIA LAR', 'TED', 'DEBITO', cfg.aluguelPF || 3200);
      add(8, 'CONDOMINIO ED AURORA', 'TED', 'DEBITO', 1180);
      add(10, 'ENEL ENERGIA', 'CONVENIO_ARRECADACAO', 'DEBITO', val(rng, 210, 460));
      add(11, 'SABESP AGUA', 'CONVENIO_ARRECADACAO', 'DEBITO', val(rng, 90, 180));
      add(15, 'VIVO FIBRA INTERNET', 'CONVENIO_ARRECADACAO', 'DEBITO', 159.9);
      add(12, 'PAGAMENTO FATURA CARTAO BRADESCO', 'CARTAO', 'DEBITO', val(rng, cfg.cardLimitPF * 0.13, cfg.cardLimitPF * 0.31));
      add(6, 'APLICACAO CDB BRADESCO', 'RESGATE_APLIC_FINANCEIRA', 'DEBITO', val(rng, 2000, 5000));
      // Compras variadas
      const n = 12 + Math.floor(rng() * 8);
      for (let k = 0; k < n; k++) { const c = pick(rng, LOJAS_PF); add(1 + Math.floor(rng() * ultimo), c.lojas[Math.floor(rng() * c.lojas.length)], 'CARTAO', 'DEBITO', val(rng, c.min, Math.min(c.max, 900))); }
      for (let k = 0; k < 3; k++) add(1 + Math.floor(rng() * ultimo), `PIX ENVIADO ${pick(rng, ['Maria Souza', 'Diarista', 'Escola'])}`, 'PIX', 'DEBITO', val(rng, 40, 850));
    });
    return tx.reverse();
  }

  // ── Extrato PJ (conta corrente) ──
  function gerarPJ() {
    const rng = rngFrom(cfg.seed.pj);
    const tx = [];
    const [recMin, recMax] = cfg.recebRange || [6000, 28000];
    const [folMin, folMax] = cfg.folhaRange || [42000, 52000];
    MESES.forEach(({ y, m, ultimo }) => {
      let i = 0;
      const add = (d, name, type, cdt, amount, h) => tx.push({
        transactionId: tId('PJ', y, m, i++), completedAuthorisedPaymentType: 'TRANSACAO_EFETIVADA',
        creditDebitType: cdt, transactionName: name.slice(0, 200), type, transactionAmount: amt(amount), transactionDateTime: dt(y, m, Math.min(d, ultimo), h),
      });
      const fator = (m === 11 || m === 12) ? (cfg.varejo ? 1.9 : 1.6) : 1; // sazonalidade
      const nRec = 6 + Math.floor(rng() * 6);
      for (let k = 0; k < nRec; k++) {
        const tipo = pick(rng, ['PIX', 'BOLETO', 'TED']);
        add(1 + Math.floor(rng() * ultimo), `RECEBIMENTO ${pick(rng, CLIENTES_PJ)}`, tipo, 'CREDITO', val(rng, recMin, recMax) * fator);
      }
      if (y === 2026 && m === 2) add(12, 'LIBERACAO CAPITAL DE GIRO', 'OPERACAO_CREDITO', 'CREDITO', cfg.loanPJ.amount);
      add(5, 'FOLHA DE PAGAMENTO - SALARIOS', 'FOLHA_PAGAMENTO', 'DEBITO', val(rng, folMin, folMax));
      if (m === 12) add(20, 'FOLHA 13o SALARIO', 'FOLHA_PAGAMENTO', 'DEBITO', val(rng, folMin - 2000, folMax - 2000));
      add(5, `PRO-LABORE ${cfg.nome}`, 'PIX', 'DEBITO', cfg.proLabore);
      if (m === 12) add(20, `13o ${cfg.nome}`, 'PIX', 'DEBITO', cfg.decimo);
      add(20, 'DARF - IRPJ/CSLL', 'CONVENIO_ARRECADACAO', 'DEBITO', val(rng, 8000, 22000) * fator);
      add(20, 'DAS - SIMPLES NACIONAL', 'CONVENIO_ARRECADACAO', 'DEBITO', val(rng, 6000, 14000));
      add(7, 'FGTS', 'CONVENIO_ARRECADACAO', 'DEBITO', val(rng, 3000, 4200));
      add(15, 'ISS MUNICIPAL', 'CONVENIO_ARRECADACAO', 'DEBITO', val(rng, 1500, 3800));
      add(8, 'ALUGUEL COMERCIAL', 'TED', 'DEBITO', cfg.aluguelPJ || 9800);
      add(10, 'ENERGIA - CNPJ', 'CONVENIO_ARRECADACAO', 'DEBITO', val(rng, 1800, 3200));
      add(12, 'PAGAMENTO FATURA CARTAO CORPORATIVO', 'CARTAO', 'DEBITO', val(rng, cfg.cardLimitPJ * 0.10, cfg.cardLimitPJ * 0.19));
      add(10, 'PARCELA CAPITAL DE GIRO', 'OPERACAO_CREDITO', 'DEBITO', cfg.loanPJ.prox);
      add(9, 'TARIFA PACOTE PJ', 'PACOTE_TARIFA_SERVICOS', 'DEBITO', 189.9);
      const nForn = 8 + Math.floor(rng() * 8);
      for (let k = 0; k < nForn; k++) add(1 + Math.floor(rng() * ultimo), `FORNECEDOR ${pick(rng, FORNEC_PJ)}`, pick(rng, ['PIX', 'TED', 'BOLETO']), 'DEBITO', val(rng, 800, 12000));
    });
    return tx.reverse();
  }

  const TX = { 'pf-cc-0001': gerarPF() };
  if (has('pf-poup')) TX['pf-poup-0001'] = (() => {
    const rng = rngFrom(cfg.seed.poup), tx = [];
    MESES.forEach(({ y, m }) => {
      let i = 0;
      tx.push({ transactionId: tId('PP', y, m, i++), completedAuthorisedPaymentType: 'TRANSACAO_EFETIVADA', creditDebitType: 'CREDITO', transactionName: 'RENDIMENTO POUPANCA', type: 'RENDIMENTO_APLIC_FINANCEIRA', transactionAmount: amt(val(rng, 300, 520)), transactionDateTime: dt(y, m, 1) });
      if (rng() > 0.5) tx.push({ transactionId: tId('PP', y, m, i++), completedAuthorisedPaymentType: 'TRANSACAO_EFETIVADA', creditDebitType: 'CREDITO', transactionName: 'DEPOSITO POUPANCA', type: 'DEPOSITO', transactionAmount: amt(val(rng, 1000, 4000)), transactionDateTime: dt(y, m, 6) });
    });
    return tx.reverse();
  })();
  if (hasPJ) TX['pj-cc-0001'] = gerarPJ();
  function accountTransactions(accountId) { return TX[accountId] || []; }

  // ── Cartões ──
  const CREDIT_CARDS = [];
  if (has('pf-card')) CREDIT_CARDS.push({ creditCardAccountId: 'pf-card-0001', ownerType: 'PESSOA_NATURAL', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, name: cfg.cardPFName, productType: cfg.cardPFProd, productAdditionalInfo: null, creditCardNetwork: cfg.cardPFNet, networkAdditionalInfo: null });
  if (has('pj-card')) CREDIT_CARDS.push({ creditCardAccountId: 'pj-card-0001', ownerType: 'PESSOA_JURIDICA', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, name: cfg.cardPJName, productType: 'BLACK', productAdditionalInfo: 'Cartão corporativo', creditCardNetwork: cfg.cardPJNet, networkAdditionalInfo: null });
  const CARD_LIMIT = {};
  if (has('pf-card')) CARD_LIMIT['pf-card-0001'] = cfg.cardLimitPF;
  if (has('pj-card')) CARD_LIMIT['pj-card-0001'] = cfg.cardLimitPJ;

  function faturasDoCartao(cardId) {
    const isPJ = cardId === 'pj-card-0001';
    const rng = rngFrom(isPJ ? cfg.seed.cardPJ : cfg.seed.cardPF);
    const lojas = isPJ
      ? [{ cat: 'Nuvem/SaaS', lojas: ['AWS', 'Google Cloud', 'Microsoft 365'], min: 500, max: 9000 }, { cat: 'Viagem Corp', lojas: ['Latam', 'Booking'], min: 800, max: 6000 }, { cat: 'Marketing', lojas: ['Meta Ads', 'Google Ads'], min: 1200, max: 12000 }, { cat: 'Equipamentos', lojas: ['Dell', 'Apple'], min: 900, max: 15000 }, { cat: 'Escritório', lojas: ['Kalunga', 'Amazon Business'], min: 200, max: 3000 }]
      : LOJAS_PF.map((x) => ({ cat: x.cat, lojas: x.lojas, min: x.min, max: x.max }));
    return MESES.map(({ y, m }) => {
      const lanc = [];
      const n = (isPJ ? 22 : 16) + Math.floor(rng() * 10);
      for (let k = 0; k < n; k++) { const c = pick(rng, lojas); lanc.push({ data: `${dd(1 + Math.floor(rng() * 27))}/${dd(m)}`, desc: pick(rng, c.lojas), cat: c.cat, val: val(rng, c.min, c.max) }); }
      const total = Number(lanc.reduce((s, l) => s + l.val, 0).toFixed(2));
      const mVenc = m === 12 ? 1 : m + 1;
      const status = (y === HOJE.y && m === HOJE.m) ? 'aberta' : (y === HOJE.y && m === HOJE.m - 1 ? 'fechada' : 'paga');
      return { billId: `bill-${cardId}-${y}-${dd(m)}`, competencia: `${y}-${dd(m)}`, dueDate: iso(mVenc === 1 ? y + 1 : y, mVenc, 7), status, total, lanc };
    }).reverse();
  }
  const FATURAS = {};
  if (has('pf-card')) FATURAS['pf-card-0001'] = faturasDoCartao('pf-card-0001');
  if (has('pj-card')) FATURAS['pj-card-0001'] = faturasDoCartao('pj-card-0001');

  function creditCardLimits(cardId) {
    const limite = CARD_LIMIT[cardId] || cfg.cardLimitPF;
    const usado = FATURAS[cardId]?.[0]?.total || 0;
    return [{ creditLineLimitType: 'LIMITE_CREDITO_TOTAL', consolidationType: 'CONSOLIDADO', identificationNumber: cardId === 'pj-card-0001' ? '7777' : '5555', lineName: 'CREDITO_A_VISTA', lineNameAdditionalInfo: null, isLimitFlexible: false, limitAmountCurrency: 'BRL', limitAmount: amtStr(limite), usedAmountCurrency: 'BRL', usedAmount: amtStr(usado), availableAmountCurrency: 'BRL', availableAmount: amtStr(limite - usado) }];
  }
  function creditCardBills(cardId) {
    return (FATURAS[cardId] || []).map((f) => ({
      billId: f.billId, dueDate: f.dueDate, billTotalAmount: amtStr(f.total), billTotalAmountCurrency: 'BRL',
      billMinimumAmount: amtStr(f.total * 0.15), billMinimumAmountCurrency: 'BRL', isInstalment: false,
      financeCharges: [{ type: 'JUROS_REMUNERATORIOS_ATRASO_PAGAMENTO_FATURA', additionalInfo: null, amount: amtStr(0), currency: 'BRL' }],
      payments: f.status === 'paga' ? [{ valueType: 'VALOR_PAGAMENTO_FATURA_REALIZADO', paymentDate: f.dueDate, paymentMode: 'DEBITO_CONTA_CORRENTE', amount: amtStr(f.total), currency: 'BRL' }] : [],
    }));
  }
  function creditCardBillTransactions(cardId, billId) {
    const f = (FATURAS[cardId] || []).find((x) => x.billId === billId);
    if (!f) return [];
    return f.lanc.map((l, i) => ({ transactionId: `CCTX-${billId}-${dd(i)}`, identificationNumber: String(1000 + i), lineName: cardId === 'pj-card-0001' ? 'MASTERCARD' : 'VISA', transactionName: l.desc.slice(0, 100), billId, creditDebitType: 'DEBITO', transactionType: 'PAGAMENTO', transactionalAdditionalInfo: l.cat, paymentType: 'A_VISTA', feeType: null, otherCreditsType: null, brazilianAmount: amtStr(l.val), amount: amtStr(l.val), currency: 'BRL', transactionDateTime: `${f.competencia}-${l.data.slice(0, 2)}T12:00:00Z`, billPostDate: `${f.competencia}-${l.data.slice(0, 2)}`, payeeMCC: 5999 }));
  }

  // ── Empréstimos / Financiamentos ──
  const LOANS = [];
  if (has('pf-loan')) LOANS.push(loanContract({ id: 'pf-loan-0001', num: 'CTR-PF-2025-004417', productType: 'EMPRESTIMOS', subtype: 'CREDITO_PESSOAL_SEM_CONSIGNACAO', amount: cfg.loanPF.amount, outstanding: cfg.loanPF.outstanding, total: cfg.loanPF.total, paid: cfg.loanPF.paid, taxAM: cfg.loanPF.taxAM, prox: { valor: cfg.loanPF.prox, venc: '2026-08-10' } }));
  if (has('pj-loan')) LOANS.push(loanContract({ id: 'pj-loan-0001', num: 'CTR-PJ-2026-000210', productType: 'EMPRESTIMOS', subtype: 'CAPITAL_GIRO_PRAZO_VENCIMENTO_SUPERIOR_365_DIAS', amount: cfg.loanPJ.amount, outstanding: cfg.loanPJ.outstanding, total: cfg.loanPJ.total, paid: cfg.loanPJ.paid, taxAM: cfg.loanPJ.taxAM, prox: { valor: cfg.loanPJ.prox, venc: '2026-08-10' } }));
  const FINANCINGS = [];
  if (has('pj-fin') && cfg.finPJ) FINANCINGS.push(loanContract({ id: 'pj-fin-0001', num: 'CTR-PJ-2024-118820', productType: 'FINANCIAMENTOS', subtype: 'AQUISICAO_BENS_VEICULOS_AUTOMOTORES', amount: cfg.finPJ.amount, outstanding: cfg.finPJ.outstanding, total: cfg.finPJ.total, paid: cfg.finPJ.paid, taxAM: cfg.finPJ.taxAM, prox: { valor: cfg.finPJ.prox, venc: '2026-08-05' } }));

  // ── Consent ──
  const basePerms = ['ACCOUNTS_READ', 'ACCOUNTS_BALANCES_READ', 'ACCOUNTS_TRANSACTIONS_READ', 'ACCOUNTS_OVERDRAFT_LIMITS_READ', 'CREDIT_CARDS_ACCOUNTS_READ', 'CREDIT_CARDS_ACCOUNTS_LIMITS_READ', 'CREDIT_CARDS_ACCOUNTS_BILLS_READ', 'CREDIT_CARDS_ACCOUNTS_TRANSACTIONS_READ', 'CUSTOMERS_PERSONAL_IDENTIFICATIONS_READ', 'CUSTOMERS_PERSONAL_ADITTIONALINFO_READ', 'LOANS_READ', 'LOANS_PAYMENTS_READ', 'LOANS_SCHEDULED_INSTALMENTS_READ', 'RESOURCES_READ'];
  const bizPerms = ['CUSTOMERS_BUSINESS_IDENTIFICATIONS_READ', 'CUSTOMERS_BUSINESS_ADITTIONALINFO_READ', 'FINANCINGS_READ'];
  const CONSENT = {
    consentId: `urn:bradesco:C-${cfg.id.toUpperCase()}-3b1e4f9f6f01`, status: 'AUTHORISED',
    statusUpdateDateTime: '2026-07-01T12:00:00Z', creationDateTime: '2026-07-01T11:58:00Z', expirationDateTime: '2027-01-01T00:00:00Z',
    permissions: hasPJ ? [...basePerms, ...bizPerms] : basePerms,
  };

  // ── Customers (PF) ──
  const PERSONAL_IDENTIFICATION = { updateDateTime: REQ_DT, personalId: `per-${cfg.id}`, brandName: BRAND, civilName: cfg.nome, socialName: null, birthDate: '1988-04-12', maritalStatusCode: 'CASADO', sex: 'MASCULINO', documents: { cpfNumber: cfg.cpf, passport: null }, hasBrazilianNationality: true, contacts: { postalAddresses: [{ isMain: true, address: 'AV PAULISTA 1000', townName: cfg.cidade, countrySubDivision: cfg.uf, postCode: '01310100', country: 'BRA' }], phones: [{ isMain: true, type: 'MOVEL', areaCode: '11', number: '999990089' }], emails: [{ isMain: true, email: cfg.email }] } };
  const PERSONAL_QUALIFICATION = { updateDateTime: REQ_DT, occupationCode: 'RECEITA_FEDERAL', occupationDescription: cfg.ocupacao, informedIncome: { frequency: 'MENSAL', amount: amtStr(cfg.rendaInformada), currency: 'BRL', date: '2026-07-01' }, informedPatrimony: { amount: amtStr(cfg.patrimonioPF), currency: 'BRL', year: 2025 } };
  const PERSONAL_FINANCIAL_RELATION = { updateDateTime: REQ_DT, startDate: '2015-03-01T00:00:00Z', productsServicesType: ['CONTA_DEPOSITO_A_VISTA', 'CONTA_POUPANCA', 'CARTAO_CREDITO', 'OPERACAO_CREDITO', 'INVESTIMENTO'], accounts: [{ compeCode: '237', branchCode: '1234', number: '567890', checkDigit: '0', type: 'CONTA_DEPOSITO_A_VISTA' }, { compeCode: '237', branchCode: '1234', number: '112233', checkDigit: '2', type: 'CONTA_POUPANCA' }] };

  // ── Customers (PJ) — null quando não há PJ ──
  let BUSINESS_IDENTIFICATION = null, BUSINESS_QUALIFICATION = null, BUSINESS_FINANCIAL_RELATION = null;
  if (hasPJ) {
    BUSINESS_IDENTIFICATION = { updateDateTime: REQ_DT, businessId: `biz-${cfg.id}`, brandName: BRAND, companyName: cfg.empresa, tradeName: cfg.tradeName, incorporationDate: '2015-02-10', document: { identification: cfg.cnpj, additionalInfo: 'CNPJ' }, companyCnpjNumber: [cfg.cnpj], parties: [{ personType: 'PESSOA_NATURAL', type: 'SOCIO', civilName: cfg.nome, cpfNumber: cfg.cpf, shareholding: '80.0000', documentType: 'CPF' }], contacts: { postalAddresses: [{ isMain: true, address: 'AV FARIA LIMA 3000', townName: cfg.cidade, countrySubDivision: cfg.uf, postCode: '04538133', country: 'BRA' }], phones: [{ isMain: true, type: 'FIXO', areaCode: '11', number: '35550100' }], emails: [{ isMain: true, email: cfg.bizEmail }] } };
    BUSINESS_QUALIFICATION = { updateDateTime: REQ_DT, informedRevenue: { frequency: 'ANUAL', frequencyAdditionalInformation: null, amount: amtStr(cfg.faturamentoPJ), currency: 'BRL', year: 2025 }, informedPatrimony: { amount: amtStr(cfg.patrimonioPJ), currency: 'BRL', date: '2025-12-31' } };
    BUSINESS_FINANCIAL_RELATION = { updateDateTime: REQ_DT, startDate: '2015-03-01T00:00:00Z', productsServicesType: ['CONTA_DEPOSITO_A_VISTA', 'CARTAO_CREDITO', 'OPERACAO_CREDITO', 'FINANCIAMENTO'], accounts: [{ compeCode: '237', branchCode: '1234', number: '998877', checkDigit: '5', type: 'CONTA_DEPOSITO_A_VISTA' }] };
  }

  // ── Investimentos (atrelados à PF, escalados por investFactor) ──
  const inv = (v) => amtStr(Number((v * (cfg.investFactor ?? 1)).toFixed(2)));
  const INVESTMENTS = !has('pf-invest') ? { BANK_FIXED_INCOME: [], CREDIT_FIXED_INCOME: [], TREASURE_TITLE: [], FUND: [], VARIABLE_INCOME: [] } : {
    BANK_FIXED_INCOME: [{ investmentId: 'bfi-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, investmentType: 'CDB', updatedValue: { amount: inv(80000), currency: 'BRL' }, grossAmount: { amount: inv(80000), currency: 'BRL' }, netAmount: { amount: inv(78600), currency: 'BRL' }, dueDate: '2029-01-15' }],
    CREDIT_FIXED_INCOME: [{ investmentId: 'cfi-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, investmentType: 'LCI', updatedValue: { amount: inv(30000), currency: 'BRL' }, grossAmount: { amount: inv(30000), currency: 'BRL' }, netAmount: { amount: inv(30000), currency: 'BRL' }, dueDate: '2027-06-01' }],
    TREASURE_TITLE: [{ investmentId: 'tt-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, investmentType: 'TESOURO_SELIC', isinCode: 'BRSTNCLF1RA5', updatedValue: { amount: inv(52500), currency: 'BRL' }, grossAmount: { amount: inv(52500), currency: 'BRL' }, netAmount: { amount: inv(51800), currency: 'BRL' }, dueDate: '2029-03-01' }],
    FUND: [{ investmentId: 'fund-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, anbimaCategory: 'RENDA_FIXA', name: 'Bradesco FIC FI RF', updatedValue: { amount: inv(25229.18), currency: 'BRL' }, quotaQuantity: '1245.331200', quotaGrossPriceValue: { amount: '20.2600', currency: 'BRL' } }],
    VARIABLE_INCOME: [{ investmentId: 'vi-0001', brandName: BRAND, companyCnpj: CNPJ_BRADESCO, ticker: 'BBDC4', isinCode: 'BRBBDCACNPR8', updatedValue: { amount: inv(26004.93), currency: 'BRL' }, quantity: '1800.000000' }],
  };

  // ── Seleção de conta ──
  function accountSelection() {
    const rot = { 'pf-cc-0001': 'PF · Conta Corrente', 'pf-poup-0001': 'PF · Poupança', 'pj-cc-0001': 'PJ · Conta Corrente' };
    return Object.entries(ENTITIES).flatMap(([, e]) => e.accounts.map((accountId) => {
      const a = ACCOUNTS.find((x) => x.accountId === accountId);
      return { accountId, titular: e.name, personType: e.personType, documento: e.document, tipo: a.type, rotulo: rot[accountId], saldo_disponivel: amt(SALDO[accountId].availableAmount) };
    }));
  }

  // ── Cruzamento analítico PF × PJ ──
  function resumoEntidade(ent) {
    const e = ENTITIES[ent];
    const contaCorrente = e.accounts.find((a) => a.includes('-cc-'));
    const tx = TX[contaCorrente] || [];
    const porMes = {}, catDebito = {};
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
  function analytics() {
    const pf = resumoEntidade('PF');
    if (!hasPJ) {
      return {
        gerado_em: REQ_DT,
        entidades: { PF: pf, PJ: null },
        consolidado: { saldo_disponivel_total: pf.saldo_disponivel_total, divida_total: pf.divida_total, patrimonio_liquido_aprox: Number((pf.saldo_disponivel_total - pf.divida_total).toFixed(2)) },
        cruzamentos: null,
        sugestao_pj: `${cfg.primeiro} ainda não possui conta PJ. Como já movimenta receitas recorrentes (${cfg.rendaLabel === 'PRO-LABORE' ? 'pró-labore' : 'salário/freelas'}), pode fazer sentido sugerir a abertura de uma conta PJ para separar finanças e reduzir carga tributária.`,
      };
    }
    const pj = resumoEntidade('PJ');
    const proLabore = (TX['pj-cc-0001'] || []).filter((t) => new RegExp(`PRO-LABORE|${cfg.nome}`).test(t.transactionName) && t.creditDebitType === 'DEBITO').reduce((s, t) => s + Number(t.transactionAmount.amount), 0);
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

  return {
    id: cfg.id, hasPJ,
    ENTITIES, ACCOUNTS, CREDIT_CARDS, LOANS, FINANCINGS, INVESTMENTS, CONSENT,
    PERSONAL_IDENTIFICATION, PERSONAL_QUALIFICATION, PERSONAL_FINANCIAL_RELATION,
    BUSINESS_IDENTIFICATION, BUSINESS_QUALIFICATION, BUSINESS_FINANCIAL_RELATION,
    accountBalances, accountOverdraftLimits, accountTransactions,
    creditCardLimits, creditCardBills, creditCardBillTransactions,
    loanListItem, loanPayments, loanInstalments,
    accountSelection, analytics,
  };
}

// ═════════════════════════════════════════════════════════════
// CONFIGURAÇÕES DOS PERFIS (dados fictícios; CPF/CNPJ inventados)
// ═════════════════════════════════════════════════════════════
const PROFILE_CFGS = [
  {
    id: 'raul', primeiro: 'Raul', nome: 'RAUL SOUSA', hasPJ: true,
    cpf: '12345678909', cnpj: '41255036000199', empresa: 'SOUSA TECH LTDA', tradeName: 'Sousa Tech',
    email: 'raul@sousatech.com.br', bizEmail: 'financeiro@sousatech.com.br', cidade: 'SAO PAULO', uf: 'SP',
    saldoCC: 46820.44, saldoPoup: 61230.18, saldoPJ: 318740.92, pjInvested: 150000, pjBlocked: 12500, ccBlocked: 450,
    proLabore: 18000, decimo: 15000, cardLimitPF: 45000, cardLimitPJ: 180000,
    cardPFName: 'BRADESCO VISA INFINITE', cardPFNet: 'VISA', cardPFProd: 'INFINITE_INTERNACIONAL', cardPJName: 'BRADESCO CORPORATE MASTERCARD', cardPJNet: 'MASTERCARD',
    ocupacao: 'Empresário', rendaInformada: 18000, patrimonioPF: 1250000, faturamentoPJ: 2850000, patrimonioPJ: 3400000,
    seed: { pf: 2025080101, pj: 2025080202, poup: 777, cardPF: 424242, cardPJ: 909090 },
    loanPF: { amount: 20000, outstanding: 11480.32, total: 24, paid: 9, taxAM: 1.89, prox: 962.15 },
    loanPJ: { amount: 150000, outstanding: 121340.10, total: 36, paid: 5, taxAM: 1.42, prox: 8250.40 },
    finPJ: { amount: 220000, outstanding: 148900.55, total: 48, paid: 20, taxAM: 1.35, prox: 5980.40 },
    investFactor: 1, recebRange: [6000, 28000], folhaRange: [42000, 52000], aluguelPJ: 9800,
  },
  {
    id: 'heitor', primeiro: 'Heitor', nome: 'HEITOR ALMEIDA', hasPJ: true,
    cpf: '23456789010', cnpj: '52366147000122', empresa: 'ALMEIDA COMERCIO DE ALIMENTOS LTDA', tradeName: 'Almeida Alimentos',
    email: 'heitor@almeidaalimentos.com.br', bizEmail: 'financeiro@almeidaalimentos.com.br', cidade: 'CAMPINAS', uf: 'SP',
    saldoCC: 28950.10, saldoPoup: 15600.00, saldoPJ: 512300.75, pjInvested: 250000, pjBlocked: 23000, ccBlocked: 0,
    proLabore: 25000, decimo: 22000, cardLimitPF: 32000, cardLimitPJ: 260000,
    cardPFName: 'BRADESCO MASTERCARD PLATINUM', cardPFNet: 'MASTERCARD', cardPFProd: 'PLATINUM', cardPJName: 'BRADESCO CORPORATE VISA', cardPJNet: 'VISA',
    ocupacao: 'Comerciante', rendaInformada: 25000, patrimonioPF: 2100000, faturamentoPJ: 6200000, patrimonioPJ: 4800000,
    seed: { pf: 1111, pj: 2222, poup: 3333, cardPF: 4444, cardPJ: 5555 },
    loanPF: { amount: 35000, outstanding: 28900.00, total: 36, paid: 6, taxAM: 1.99, prox: 1320.00 },
    loanPJ: { amount: 300000, outstanding: 264500.00, total: 48, paid: 8, taxAM: 1.55, prox: 9800.00 },
    finPJ: { amount: 450000, outstanding: 389200.00, total: 60, paid: 14, taxAM: 1.28, prox: 9950.00 },
    investFactor: 1.4, recebRange: [10000, 45000], folhaRange: [70000, 95000], aluguelPJ: 16500, varejo: true,
  },
  {
    id: 'cadimo', primeiro: 'Cadimo', nome: 'CADIMO PEREIRA', hasPJ: true,
    cpf: '34567890121', cnpj: '63477258000133', empresa: 'PEREIRA SERVICOS DE CONSULTORIA LTDA', tradeName: 'Pereira Consultoria',
    email: 'cadimo@pereiraconsultoria.com.br', bizEmail: 'financeiro@pereiraconsultoria.com.br', cidade: 'RIO DE JANEIRO', uf: 'RJ',
    saldoCC: 12480.55, saldoPoup: 8300.00, saldoPJ: 97650.40, pjInvested: 40000, pjBlocked: 5000, ccBlocked: 200,
    proLabore: 12000, decimo: 9000, cardLimitPF: 18000, cardLimitPJ: 90000,
    cardPFName: 'BRADESCO VISA GOLD', cardPFNet: 'VISA', cardPFProd: 'GOLD', cardPJName: 'BRADESCO CORPORATE MASTERCARD', cardPJNet: 'MASTERCARD',
    ocupacao: 'Consultor', rendaInformada: 12000, patrimonioPF: 620000, faturamentoPJ: 1150000, patrimonioPJ: 980000,
    seed: { pf: 6161, pj: 7272, poup: 8383, cardPF: 9494, cardPJ: 1055 },
    loanPF: { amount: 15000, outstanding: 9800.00, total: 18, paid: 7, taxAM: 2.15, prox: 980.00 },
    loanPJ: { amount: 80000, outstanding: 64200.00, total: 24, paid: 6, taxAM: 1.75, prox: 3850.00 },
    finPJ: null, investFactor: 0.6, recebRange: [4000, 18000], folhaRange: [18000, 26000], aluguelPJ: 6200,
  },
  {
    id: 'patz', primeiro: 'Patz', nome: 'PATRICIA ZANETTI', hasPJ: false,
    cpf: '45678901232', email: 'patricia.zanetti@email.com', cidade: 'CURITIBA', uf: 'PR',
    saldoCC: 7650.20, saldoPoup: 23400.00, ccBlocked: 0,
    rendaMensal: 9500, rendaLabel: 'SALARIO', empregador: 'TECHNOVA SOFTWARE LTDA', decimo: 9500,
    cardLimitPF: 12000, cardPFName: 'BRADESCO VISA GOLD', cardPFNet: 'VISA', cardPFProd: 'GOLD',
    ocupacao: 'Analista de Sistemas', rendaInformada: 9500, patrimonioPF: 180000,
    seed: { pf: 1212, poup: 3434, cardPF: 5656 },
    loanPF: { amount: 12000, outstanding: 7200.00, total: 12, paid: 5, taxAM: 2.30, prox: 1080.00 },
    investFactor: 0.3,
  },
];

export const DEFAULT_PROFILE = 'raul';

// ── Perfis extras carregados dinamicamente (sem editar código) ──
//   1) arquivo mcp/openfinance/profiles.extra.json  (array de specs)
//   2) env EXTRA_PROFILES  (array de specs em JSON) — ideal p/ Render
// Cada spec é expandido (expandSpec) → massa determinística por id.
function loadExtraSpecs() {
  const specs = [];
  try {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const arr = JSON.parse(readFileSync(join(__dir, 'profiles.extra.json'), 'utf8'));
    if (Array.isArray(arr)) specs.push(...arr);
  } catch { /* arquivo é opcional */ }
  try {
    const arr = JSON.parse(process.env.EXTRA_PROFILES || '[]');
    if (Array.isArray(arr)) specs.push(...arr);
  } catch (e) { console.error('EXTRA_PROFILES inválido (ignorado):', e.message); }
  return specs;
}
const EXTRA_CFGS = loadExtraSpecs()
  .map((s) => { try { return expandSpec(s); } catch (e) { console.error('perfil extra ignorado:', e.message); return null; } })
  .filter(Boolean);

// Perfis internos + extras. Em caso de id repetido, o extra sobrescreve.
const ALL_CFGS = [...PROFILE_CFGS, ...EXTRA_CFGS];
const PROFILES = Object.fromEntries(ALL_CFGS.map((c) => [c.id, buildProfile(c)]));

// ── Pluggy Open Finance integration ──────────────────────────────────────────
// When PLUGGY_CLIENT_ID is set, initPluggy() pre-fetches real account data and
// caches it. getProfile() then returns the live Pluggy profile transparently.
// The MCP core.js calls executors synchronously, so this pre-fetch + cache
// pattern is the only way to inject async data without touching core.js.

let _pluggyProfile = null;
let _pluggyTimer = null;

export async function initPluggy() {
  const clientId     = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  const itemId       = process.env.PLUGGY_ITEM_ID || null;
  if (!clientId || !clientSecret) {
    console.log('[Pluggy] desabilitado — PLUGGY_CLIENT_ID não configurado, usando perfis mock');
    return;
  }

  const { buildPluggyProfile } = await import('../pluggy/pluggy-profile.js');

  async function refresh() {
    try {
      _pluggyProfile = await buildPluggyProfile(clientId, clientSecret, itemId);
      console.log('[Pluggy] perfil carregado — contas:', _pluggyProfile.ACCOUNTS.length);
    } catch (err) {
      console.error('[Pluggy] erro ao carregar perfil:', err.message);
    }
  }

  await refresh();
  // Refresh every 10 minutes to keep data reasonably fresh
  _pluggyTimer = setInterval(refresh, 10 * 60 * 1000);
}

/** Devolve o bundle de dados do perfil (ou o default se id inválido/ausente). */
export function getProfile(id) {
  if (id === 'pluggy') return _pluggyProfile || PROFILES[DEFAULT_PROFILE];
  return PROFILES[id] || PROFILES[DEFAULT_PROFILE];
}

/** Metadados dos perfis (para o seletor no WhatsApp). Id repetido → último vence. */
export function listProfiles() {
  const mockProfiles = [...new Map(ALL_CFGS.map((c) => [c.id, {
    id: c.id, primeiro: c.primeiro, nome: c.nome,
    tipo: c.hasPJ ? 'PF + PJ' : 'PF', empresa: c.hasPJ ? c.empresa : null,
  }])).values()];
  if (!_pluggyProfile) return mockProfiles;
  const pluggyEntry = {
    id: 'pluggy',
    primeiro: _pluggyProfile.PERSONAL_IDENTIFICATION?.civilName?.split(' ')[0] ?? 'Usuário',
    nome: _pluggyProfile.PERSONAL_IDENTIFICATION?.civilName ?? 'Usuário Pluggy',
    tipo: _pluggyProfile.hasPJ ? 'PF + PJ' : 'PF',
    empresa: _pluggyProfile.BUSINESS_IDENTIFICATION?.companyName ?? null,
    real: true,
  };
  return [pluggyEntry, ...mockProfiles];
}
