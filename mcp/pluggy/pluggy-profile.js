// Adaptador Pluggy → Open Finance Brasil.
// Transforma os dados da API Pluggy no mesmo formato de perfil que o of-data.js
// produz (ACCOUNTS, CREDIT_CARDS, INVESTMENTS, accountBalances(), etc.), para
// que o catalog.js funcione sem nenhuma alteração.

import { PluggyClient } from './pluggy-client.js';

const REQ_DT = () => new Date().toISOString();

function fmtAmt(v) {
  return { amount: Number(v || 0).toFixed(2), currency: 'BRL' };
}

// Pluggy paymentMethod / type → OF transaction type
const PAYMENT_TYPE_MAP = {
  PIX: 'PIX', TED: 'TED', DOC: 'DOC', BOLETO: 'BOLETO',
  CREDIT_CARD: 'CARTAO', DEBIT_CARD: 'CARTAO',
  WAGE: 'FOLHA_PAGAMENTO', SALARY: 'FOLHA_PAGAMENTO',
  ATM: 'SAQUE', WITHDRAWAL: 'SAQUE',
  DEPOSIT: 'DEPOSITO', INVESTMENT: 'RENDIMENTO_APLIC_FINANCEIRA',
  FEE: 'PACOTE_TARIFA_SERVICOS',
};

function mapTxType(tx) {
  const method = tx.paymentData?.paymentMethod;
  if (method && PAYMENT_TYPE_MAP[method]) return PAYMENT_TYPE_MAP[method];
  return 'OUTROS';
}

export async function buildPluggyProfile(clientId, clientSecret, forcedItemId = null) {
  const client = new PluggyClient(clientId, clientSecret);

  let items;
  if (forcedItemId) {
    console.log('[Pluggy] usando PLUGGY_ITEM_ID diretamente:', forcedItemId);
    items = [{ id: forcedItemId }];
  } else {
    items = await client.getItems();
    if (!items.length) {
      throw new Error('Nenhum item (instituição) encontrado no Pluggy sandbox. Conecte uma instituição em app.pluggy.ai.');
    }
  }

  // Busca dados de todos os itens em paralelo
  const itemsData = await Promise.all(items.map(async (item) => {
    const [accounts, identity, investments] = await Promise.all([
      client.getAccounts(item.id),
      client.getIdentity(item.id),
      client.getInvestments(item.id),
    ]);
    return { item, accounts, identity, investments };
  }));

  // Separa contas por tipo
  const checkingAccs = [];
  const savingsAccs  = [];
  const creditAccs   = [];

  let pfIdentity = null;
  let pjIdentity = null;
  let pfItemId   = null;
  let pjItemId   = null;

  for (const { item, accounts, identity } of itemsData) {
    if (identity) {
      const taxDoc = identity.taxNumber?.value || identity.document || '';
      const cleanDoc = taxDoc.replace(/\D/g, '');
      if (cleanDoc.length > 11) {
        pjIdentity = pjIdentity || identity;
        pjItemId   = pjItemId   || item.id;
      } else {
        pfIdentity = pfIdentity || identity;
        pfItemId   = pfItemId   || item.id;
      }
    }

    if (accounts.length) {
      console.log('[Pluggy] tipos de conta encontrados:', accounts.map((a) => `${a.type}(${a.subtype ?? '-'})`).join(', '));
    }
    for (const acc of accounts) {
      const t = acc.type?.toUpperCase() ?? '';
      const s = acc.subtype?.toUpperCase() ?? '';
      if (t === 'CREDIT') {
        creditAccs.push({ ...acc, _itemId: item.id });
      } else if (t === 'SAVINGS' || s === 'SAVINGS_ACCOUNT') {
        savingsAccs.push({ ...acc, _itemId: item.id });
      } else if (t === 'CHECKING' || s === 'CHECKING_ACCOUNT' || (t === 'BANK' && s !== 'SAVINGS_ACCOUNT')) {
        checkingAccs.push({ ...acc, _itemId: item.id });
      } else {
        console.log('[Pluggy] tipo de conta não mapeado:', t, s, '— tratando como CHECKING');
        checkingAccs.push({ ...acc, _itemId: item.id });
      }
    }
  }

  // ── ACCOUNTS (OF format) ──────────────────────────────────────
  const ACCOUNTS = [];
  for (const acc of checkingAccs) {
    ACCOUNTS.push({
      accountId: acc.id,
      ownerType: pjItemId === acc._itemId ? 'PESSOA_JURIDICA' : 'PESSOA_NATURAL',
      brandName: acc.institutionNumber ?? 'Pluggy Bank',
      companyCnpj: '00000000000000',
      type: 'CONTA_DEPOSITO_A_VISTA',
      compeCode: acc.bankData?.transferNumber?.slice(0, 3) ?? '001',
      branchCode: '0001',
      number: acc.number ?? acc.id.slice(-8),
      checkDigit: '0',
      currency: acc.currencyCode ?? 'BRL',
    });
  }
  for (const acc of savingsAccs) {
    ACCOUNTS.push({
      accountId: acc.id,
      ownerType: 'PESSOA_NATURAL',
      brandName: 'Pluggy Bank',
      companyCnpj: '00000000000000',
      type: 'CONTA_POUPANCA',
      compeCode: '001',
      branchCode: '0001',
      number: acc.number ?? acc.id.slice(-8),
      checkDigit: '0',
      currency: acc.currencyCode ?? 'BRL',
    });
  }

  // ── TRANSAÇÕES (busca 12 meses para todas as contas) ──────────
  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - 12);
  const fromStr = fromDate.toISOString().slice(0, 10);

  const txMap = {};
  await Promise.all(ACCOUNTS.map(async (acc) => {
    const rawTxs = await client.getTransactions(acc.accountId, { from: fromStr });
    txMap[acc.accountId] = rawTxs.map((t, idx) => ({
      _accountId: acc.accountId,
      transactionId: t.id ?? `tx-${acc.accountId}-${idx}`,
      completedAuthorisedPaymentType: 'TRANSACAO_EFETIVADA',
      creditDebitType: t.type === 'CREDIT' ? 'CREDITO' : 'DEBITO',
      transactionName: t.description || t.descriptionRaw || 'Transação',
      type: mapTxType(t),
      transactionAmount: fmtAmt(Math.abs(t.amount ?? 0)),
      transactionDateTime: t.date ?? new Date().toISOString(),
    })).sort((a, b) => b.transactionDateTime.localeCompare(a.transactionDateTime));
  }));

  // ── CREDIT CARDS ──────────────────────────────────────────────
  const CREDIT_CARDS = creditAccs.map((acc) => ({
    creditCardAccountId: acc.id,
    brandName: 'Pluggy Bank',
    companyCnpj: '00000000000000',
    name: acc.name ?? 'Cartão de Crédito',
    productType: 'CLASSICO',
    creditCardNetwork: (acc.creditData?.brand ?? 'VISA').toUpperCase(),
    ownerType: pjItemId === acc._itemId ? 'PESSOA_JURIDICA' : 'PESSOA_NATURAL',
  }));

  // ── INVESTMENTS ───────────────────────────────────────────────
  const bankFixedItems = itemsData
    .flatMap(({ investments }) => investments)
    .map((inv) => ({
      investmentId: inv.id,
      brandName: 'Pluggy Bank',
      companyCnpj: '00000000000000',
      investmentType: 'CDB',
      name: inv.name ?? 'Investimento',
      updatedValue: fmtAmt(inv.balance ?? 0),
      dueDate: inv.dueDate ? String(inv.dueDate).slice(0, 10) : null,
    }));

  const INVESTMENTS = {
    BANK_FIXED_INCOME: bankFixedItems,
    CREDIT_FIXED_INCOME: [],
    TREASURE_TITLE: [],
    FUND: [],
    VARIABLE_INCOME: [],
  };

  // ── IDENTITY helpers ──────────────────────────────────────────
  const pfName = pfIdentity?.fullName ?? pfIdentity?.name ?? 'Usuário Pluggy';
  const pfCpf  = (pfIdentity?.taxNumber?.value ?? pfIdentity?.document ?? '').replace(/\D/g, '');
  const pjName = pjIdentity?.fullName ?? pjIdentity?.name ?? null;
  const pjCnpj = (pjIdentity?.taxNumber?.value ?? pjIdentity?.document ?? '').replace(/\D/g, '');

  const PERSONAL_IDENTIFICATION = {
    personalId: `pluggy-pf-${pfCpf || '000'}`,
    brandName: 'Pluggy Bank',
    companyCnpj: '00000000000000',
    documents: { cpfNumber: pfCpf || '00000000000', passportNumber: '', socialNameNumber: '' },
    civilName: pfName,
    socialName: '',
    birthDate: pfIdentity?.birthDate ?? '1990-01-01',
    maritalStatusCode: 'SOLTEIRO',
    sex: 'MASCULINO',
    contacts: { postalAddresses: [], phones: [], emails: [] },
    nationality: [{ otherNationalitiesInfo: 'BRASILEIRO' }],
  };

  const PERSONAL_QUALIFICATION = {
    updateDateTime: REQ_DT(),
    companyCnpj: '00000000000000',
    occupationCode: 'EMPRESARIO',
    informedIncome: { frequency: 'MENSAL', amount: '10000.00', currency: 'BRL', date: REQ_DT().slice(0, 10) },
    informedPatrimony: { amount: '100000.00', currency: 'BRL', year: new Date().getFullYear() - 1 },
  };

  const PERSONAL_FINANCIAL_RELATION = {
    updateDateTime: REQ_DT(),
    startDate: '2020-01-01',
    productsServicesType: ['CONTA_DEPOSITO_A_VISTA'],
    productsServicesTypeAdditionalInfo: '',
    procurators: [],
    accounts: ACCOUNTS.map((a) => ({
      compeCode: a.compeCode, branchCode: a.branchCode,
      number: a.number, checkDigit: a.checkDigit, type: a.type,
    })),
  };

  const BUSINESS_IDENTIFICATION = pjName ? {
    businessId: `pluggy-pj-${pjCnpj || '000'}`,
    brandName: 'Pluggy Bank',
    companyCnpj: '00000000000000',
    cnpjNumber: pjCnpj || '00000000000000',
    companyName: pjName,
    tradeName: pjName,
    incorporationDate: '2015-01-01',
    activities: [{ economicActivityCode: '62.01-5', economicActivityText: 'Desenvolvimento de programas de computador sob encomenda' }],
    contacts: { postalAddresses: [], phones: [], emails: [] },
  } : null;

  const BUSINESS_QUALIFICATION = pjName ? {
    updateDateTime: REQ_DT(),
    companyCnpj: '00000000000000',
    economicActivities: [{ code: '6201500', isMain: true }],
    informedRevenue: { frequency: 'MENSAL', amount: '50000.00', currency: 'BRL', year: new Date().getFullYear() - 1 },
    informedPatrimony: { amount: '500000.00', currency: 'BRL', year: new Date().getFullYear() - 1 },
  } : null;

  const BUSINESS_FINANCIAL_RELATION = pjName ? {
    updateDateTime: REQ_DT(),
    startDate: '2020-01-01',
    productsServicesType: ['CONTA_DEPOSITO_A_VISTA'],
    procurators: [],
    accounts: ACCOUNTS.filter((a) => a.ownerType === 'PESSOA_JURIDICA').map((a) => ({
      compeCode: a.compeCode, branchCode: a.branchCode,
      number: a.number, checkDigit: a.checkDigit, type: a.type,
    })),
  } : null;

  const CONSENT = {
    consentId: 'urn:pluggy:consent:sandbox-001',
    status: 'AUTHORISED',
    creationDateTime: REQ_DT(),
    statusUpdateDateTime: REQ_DT(),
    permissions: [
      'ACCOUNTS_READ', 'ACCOUNTS_BALANCES_READ', 'ACCOUNTS_TRANSACTIONS_READ',
      'CREDIT_CARDS_ACCOUNTS_READ', 'CUSTOMERS_PERSONAL_IDENTIFICATIONS_READ',
      'INVESTMENTS_READ',
    ],
  };

  // ── Métodos do perfil (mesma interface de of-data.js) ─────────

  function accountBalances(accountId) {
    const acc = [...checkingAccs, ...savingsAccs].find((a) => a.id === accountId);
    return {
      availableAmount: fmtAmt(acc?.balance ?? 0),
      blockedAmount: fmtAmt(0),
      automaticallyInvestedAmount: fmtAmt(0),
      updateDateTime: REQ_DT(),
    };
  }

  function accountTransactions(accountId) {
    return txMap[accountId] ?? [];
  }

  function accountOverdraftLimits() {
    return {
      overdraftContractedLimit: fmtAmt(0),
      overdraftUsedLimit: fmtAmt(0),
      unarrangedOverdraftAmount: fmtAmt(0),
    };
  }

  function creditCardLimits(creditCardAccountId) {
    const acc = creditAccs.find((a) => a.id === creditCardAccountId);
    const limit     = Number(acc?.creditData?.creditLimit         ?? 0);
    const available = Number(acc?.creditData?.availableCreditLimit ?? 0);
    return [{
      creditLineLimitType: 'LIMITE_CREDITO_TOTAL',
      limitAmount:     limit.toFixed(2),
      availableAmount: available.toFixed(2),
      usedAmount:      (limit - available).toFixed(2),
      identificationNumber: acc?.number ?? '0000',
      currency: 'BRL',
    }];
  }

  function creditCardBills(creditCardAccountId) {
    const acc    = creditAccs.find((a) => a.id === creditCardAccountId);
    const amount = Math.abs(Number(acc?.balance ?? 0));
    const due    = new Date();
    due.setDate(10);
    if (due < new Date()) due.setMonth(due.getMonth() + 1);
    return [{
      billId: `bill-${creditCardAccountId}-001`,
      dueDate: due.toISOString().slice(0, 10),
      billTotalAmount: amount.toFixed(2),
      billMinimumAmount: (amount * 0.15).toFixed(2),
      isInstalment: false,
      currency: 'BRL',
    }];
  }

  function creditCardBillTransactions() { return []; }

  function loanListItem(c) { return c; }
  function loanPayments()  {
    return { paidInstalments: 0, contractOutstandingBalance: fmtAmt(0), currency: 'BRL' };
  }
  function loanInstalments() {
    return { typeNumberOfInstalments: 'MES', totalNumberOfInstalments: 0, instalmentPeriodicity: 'MENSAL', instalments: [] };
  }

  function accountSelection() {
    return ACCOUNTS.map((a) => {
      const raw = [...checkingAccs, ...savingsAccs].find((x) => x.id === a.accountId);
      return { accountId: a.accountId, type: a.type, ownerType: a.ownerType, balance: Number(raw?.balance ?? 0) };
    });
  }

  function analytics() {
    const allTx = Object.values(txMap).flat();
    const pfAccs = ACCOUNTS.filter((a) => a.ownerType === 'PESSOA_NATURAL');
    const pjAccs = ACCOUNTS.filter((a) => a.ownerType === 'PESSOA_JURIDICA');

    function balanceOf(acc) {
      const raw = [...checkingAccs, ...savingsAccs].find((x) => x.id === acc.accountId);
      return Number(raw?.balance ?? 0);
    }
    const pfTotal = pfAccs.reduce((s, a) => s + balanceOf(a), 0);
    const pjTotal = pjAccs.reduce((s, a) => s + balanceOf(a), 0);
    const investTotal = bankFixedItems.reduce((s, inv) => s + Number(inv.updatedValue?.amount ?? 0), 0);

    function resumoEntidade(accs, titular) {
      const ids = new Set(accs.map((a) => a.accountId));
      const txs = allTx.filter((t) => ids.has(t._accountId));
      const porMes = {}, catDebito = {};
      let entradas = 0, saidas = 0;
      for (const t of txs) {
        const mes = (t.transactionDateTime ?? '').slice(0, 7);
        const v = Number(t.transactionAmount.amount);
        porMes[mes] = porMes[mes] || { entradas: 0, saidas: 0 };
        if (t.creditDebitType === 'CREDITO') { entradas += v; porMes[mes].entradas += v; }
        else { saidas += v; porMes[mes].saidas += v; catDebito[t.type] = (catDebito[t.type] ?? 0) + v; }
      }
      const fluxo = Object.entries(porMes).sort().map(([mes, o]) => ({
        mes, entradas: Number(o.entradas.toFixed(2)), saidas: Number(o.saidas.toFixed(2)),
        liquido: Number((o.entradas - o.saidas).toFixed(2)),
      }));
      const saldo = accs.reduce((s, a) => s + balanceOf(a), 0);
      const saldoComInvest = saldo === 0 ? saldo + investTotal : saldo;
      return {
        titular,
        saldo_disponivel_total: Number(saldoComInvest.toFixed(2)),
        entradas_12m: Number(entradas.toFixed(2)),
        saidas_12m: Number(saidas.toFixed(2)),
        fluxo_liquido_12m: Number((entradas - saidas).toFixed(2)),
        fatura_cartao_atual: 0,
        divida_total: 0,
        top_saidas_por_tipo: Object.entries(catDebito)
          .sort((a, b) => b[1] - a[1]).slice(0, 6)
          .map(([tipo, valor]) => ({ tipo, valor: Number(valor.toFixed(2)) })),
        fluxo_mensal: fluxo,
      };
    }

    const pfEnt = resumoEntidade(pfAccs, pfName);
    const entidades = { PF: pfEnt };
    if (pjName && pjAccs.length) {
      entidades.PJ = resumoEntidade(pjAccs, pjName);
    }

    return {
      gerado_em: new Date().toISOString(),
      consolidado: {
        saldo_disponivel_total: Number((pfTotal + pjTotal + investTotal).toFixed(2)),
        divida_total: 0,
        patrimonio_liquido_aprox: Number((pfTotal + pjTotal + investTotal).toFixed(2)),
      },
      entidades,
      cruzamentos: pjName && pjAccs.length ? {
        pro_labore_pj_para_pf_12m: 0,
        dependencia_pf_da_pj_pct: 0,
        indice_liquidez_pj: Number((pjTotal / 1).toFixed(2)),
      } : null,
    };
  }

  return {
    id: 'pluggy',
    hasPJ: !!pjName,
    ACCOUNTS, CREDIT_CARDS,
    LOANS: [], FINANCINGS: [],
    INVESTMENTS, CONSENT,
    PERSONAL_IDENTIFICATION, PERSONAL_QUALIFICATION, PERSONAL_FINANCIAL_RELATION,
    BUSINESS_IDENTIFICATION, BUSINESS_QUALIFICATION, BUSINESS_FINANCIAL_RELATION,
    accountBalances, accountOverdraftLimits, accountTransactions,
    creditCardLimits, creditCardBills, creditCardBillTransactions,
    loanListItem, loanPayments, loanInstalments,
    accountSelection, analytics,
  };
}
