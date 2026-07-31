// ─────────────────────────────────────────────────────────────
// Gerador de massa: expande um ESPECIFICAÇÃO MÍNIMA em um cfg completo.
//
// Você informa o essencial — nome e quais contas — e o resto (saldos, seeds/
// "offset", limites, empréstimos, cadastro PJ…) é derivado de forma
// DETERMINÍSTICA a partir de um hash do id. Mesmo id → mesma massa, sempre.
// Qualquer campo passado no spec tem prioridade sobre o valor derivado.
//
//   expandSpec({ primeiro:'João', tipo:'pfpj' })  → cfg completo p/ buildProfile
// ─────────────────────────────────────────────────────────────

// hash de string → uint32 (base do "offset" determinístico)
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function rngFrom(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const round2 = (v) => Number(v.toFixed(2));
const between = (rng, min, max) => round2(min + rng() * (max - min));
const intBetween = (rng, min, max) => Math.floor(min + rng() * (max - min + 1));
const pick = (rng, a) => a[Math.floor(rng() * a.length)];

export function slug(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const SOBRENOMES = ['SILVA', 'SANTOS', 'OLIVEIRA', 'SOUZA', 'LIMA', 'PEREIRA', 'COSTA', 'RIBEIRO', 'ALMEIDA', 'GOMES'];
const SETORES = [
  { setor: 'TECNOLOGIA', suf: 'TECH LTDA', trade: 'Tech', ocup: 'Empresário', varejo: false },
  { setor: 'COMERCIO', suf: 'COMERCIO LTDA', trade: 'Comércio', ocup: 'Comerciante', varejo: true },
  { setor: 'SERVICOS', suf: 'SERVICOS LTDA', trade: 'Serviços', ocup: 'Consultor', varejo: false },
  { setor: 'CONSULTORIA', suf: 'CONSULTORIA LTDA', trade: 'Consultoria', ocup: 'Consultor', varejo: false },
];
const EMPREGADORES = ['TECHNOVA SOFTWARE LTDA', 'GLOBEX SERVICOS LTDA', 'INICIATIVA DIGITAL SA', 'NORTE CONSULTORIA LTDA'];
const CIDADES = [['SAO PAULO', 'SP'], ['CAMPINAS', 'SP'], ['RIO DE JANEIRO', 'RJ'], ['CURITIBA', 'PR'], ['BELO HORIZONTE', 'MG'], ['PORTO ALEGRE', 'RS']];

function fakeDigits(rng, n) { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(rng() * 10); return s; }

// Conjunto de contas a partir de spec.contas | spec.tipo | spec.hasPJ.
function resolveContas(spec) {
  if (Array.isArray(spec.contas) && spec.contas.length) return spec.contas.slice();
  const pj = spec.hasPJ ?? (spec.tipo === 'pfpj' || spec.tipo === 'pj');
  const c = ['pf-cc'];
  if (spec.poupanca !== false) c.push('pf-poup');
  c.push('pf-card', 'pf-loan', 'pf-invest');
  if (pj) c.push('pj-cc', 'pj-card', 'pj-loan', 'pj-fin');
  return c;
}

/** Expande um spec mínimo em um cfg completo para buildProfile. */
export function expandSpec(spec) {
  if (!spec || !spec.primeiro) throw new Error('spec.primeiro (primeiro nome) é obrigatório');
  const id = spec.id || slug(spec.primeiro);
  const rng = rngFrom(hash32(id)); // "offset" determinístico por id
  const contas = resolveContas(spec);
  const has = (t) => contas.includes(t);
  const hasPJ = has('pj-cc');

  const sobren = pick(rng, SOBRENOMES);
  const nome = (spec.nome || `${spec.primeiro} ${sobren}`).toUpperCase();
  const setor = SETORES[hash32(id + 's') % SETORES.length];
  const [cidade, uf] = spec.cidade ? [spec.cidade, spec.uf || 'SP'] : pick(rng, CIDADES);

  const proLabore = spec.proLabore ?? intBetween(rng, 9, 28) * 1000;
  const rendaMensal = spec.rendaMensal ?? intBetween(rng, 4, 18) * 1000;
  const cardLimitPF = spec.cardLimitPF ?? intBetween(rng, 8, 50) * 1000;
  const cardLimitPJ = spec.cardLimitPJ ?? intBetween(rng, 8, 28) * 10000;
  const tierPF = cardLimitPF >= 40000 ? ['BRADESCO VISA INFINITE', 'VISA', 'INFINITE_INTERNACIONAL'] : cardLimitPF >= 25000 ? ['BRADESCO MASTERCARD PLATINUM', 'MASTERCARD', 'PLATINUM'] : ['BRADESCO VISA GOLD', 'VISA', 'GOLD'];

  const mkLoan = (min, max, tmin, tmax) => {
    const amount = intBetween(rng, min, max) * 1000;
    const total = intBetween(rng, tmin, tmax);
    const paid = intBetween(rng, Math.ceil(total * 0.1), Math.floor(total * 0.5));
    const prox = round2((amount / total) * 1.05);
    return { amount, outstanding: round2(amount * (1 - paid / total)), total, paid, taxAM: between(rng, 1.3, 2.4), prox };
  };

  const cfg = {
    id, primeiro: spec.primeiro, nome, hasPJ, contas,
    cpf: spec.cpf || fakeDigits(rng, 11),
    cidade, uf,
    email: spec.email || `${slug(spec.primeiro)}@email.com`,
    // PF
    saldoCC: spec.saldoCC ?? between(rng, 5000, 90000),
    saldoPoup: spec.saldoPoup ?? between(rng, 3000, 70000),
    ccBlocked: spec.ccBlocked ?? 0,
    proLabore, decimo: spec.decimo ?? (hasPJ ? proLabore * 0.85 : rendaMensal),
    rendaMensal, rendaLabel: spec.rendaLabel || 'SALARIO', empregador: spec.empregador || pick(rng, EMPREGADORES),
    cardLimitPF, cardPFName: spec.cardPFName || tierPF[0], cardPFNet: spec.cardPFNet || tierPF[1], cardPFProd: spec.cardPFProd || tierPF[2],
    ocupacao: spec.ocupacao || (hasPJ ? setor.ocup : 'Analista'),
    rendaInformada: spec.rendaInformada ?? (hasPJ ? proLabore : rendaMensal),
    patrimonioPF: spec.patrimonioPF ?? intBetween(rng, 15, 220) * 10000,
    investFactor: spec.investFactor ?? between(rng, 0.3, 1.5),
    loanPF: spec.loanPF || mkLoan(12, 40, 12, 48),
  };

  if (hasPJ) {
    Object.assign(cfg, {
      cnpj: spec.cnpj || fakeDigits(rng, 14),
      empresa: spec.empresa || `${sobren} ${setor.suf}`,
      tradeName: spec.tradeName || `${spec.primeiro} ${setor.trade}`,
      bizEmail: spec.bizEmail || `financeiro@${slug(sobren)}.com.br`,
      saldoPJ: spec.saldoPJ ?? between(rng, 60000, 600000),
      pjInvested: spec.pjInvested ?? intBetween(rng, 0, 25) * 10000,
      pjBlocked: spec.pjBlocked ?? intBetween(rng, 0, 25) * 1000,
      cardLimitPJ, cardPJName: spec.cardPJName || 'BRADESCO CORPORATE MASTERCARD', cardPJNet: spec.cardPJNet || 'MASTERCARD',
      faturamentoPJ: spec.faturamentoPJ ?? intBetween(rng, 100, 700) * 10000,
      patrimonioPJ: spec.patrimonioPJ ?? intBetween(rng, 80, 500) * 10000,
      varejo: spec.varejo ?? setor.varejo,
      recebRange: spec.recebRange || [intBetween(rng, 4, 10) * 1000, intBetween(rng, 20, 45) * 1000],
      folhaRange: spec.folhaRange || [intBetween(rng, 18, 45) * 1000, intBetween(rng, 46, 95) * 1000],
      aluguelPJ: spec.aluguelPJ ?? intBetween(rng, 6, 18) * 1000,
      loanPJ: spec.loanPJ || mkLoan(80, 350, 24, 48),
      finPJ: has('pj-fin') ? (spec.finPJ || mkLoan(200, 500, 48, 60)) : null,
    });
  }

  // Seeds ("offsets") derivados do id — cada série com um deslocamento distinto.
  const base = hash32(id + '#seed');
  cfg.seed = spec.seed || { pf: base, pj: (base ^ 0x9e3779b9) >>> 0, poup: (base + 101) >>> 0, cardPF: (base ^ 0x51ed270b) >>> 0, cardPJ: (base ^ 0x2545f491) >>> 0 };

  return cfg;
}
