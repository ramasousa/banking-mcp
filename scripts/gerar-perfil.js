// ─────────────────────────────────────────────────────────────
// Gerador de massa de teste — cria um PERFIL a partir do essencial.
//
// Você informa nome e quais contas; o resto (saldos, "offset"/seeds, limites,
// empréstimos, cadastro) é derivado deterministicamente. Imprime o spec pronto
// para colar na env EXTRA_PROFILES (Render) e, com --write, salva no arquivo
// mcp/openfinance/profiles.extra.json (carregado automaticamente).
//
// Exemplos:
//   node scripts/gerar-perfil.js --primeiro João --tipo pfpj
//   node scripts/gerar-perfil.js --primeiro Marina --contas pf-cc,pf-card,pf-loan
//   node scripts/gerar-perfil.js --primeiro Bruno --tipo pfpj --saldo-cc 15000 --write
//   node scripts/gerar-perfil.js --list
//
// Contas válidas: pf-cc pf-poup pf-card pf-loan pf-invest pj-cc pj-card pj-loan pj-fin
// (pj-cc implica PJ). --tipo pf | pfpj é um atalho para o conjunto padrão.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { expandSpec, slug } from '../mcp/openfinance/profile-spec.js';
import { listProfiles } from '../mcp/openfinance/of-data.js';

const EXTRA_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'openfinance', 'profiles.extra.json');

// ── parse de argumentos: --flag valor / --flag (boolean) ──
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { a[k] = true; } else { a[k] = next; i++; }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));

if (args.list) {
  console.log('\nPerfis atuais:');
  for (const p of listProfiles()) console.log(`  • ${p.id.padEnd(10)} ${p.primeiro.padEnd(10)} ${p.tipo}${p.empresa ? ' · ' + p.empresa : ''}`);
  console.log('');
  process.exit(0);
}

if (!args.primeiro || args.help) {
  console.log('Uso: node scripts/gerar-perfil.js --primeiro <Nome> [--tipo pf|pfpj] [--contas a,b,c] [--id x] [--nome "Nome Completo"] [overrides] [--write]');
  console.log('Overrides: --saldo-cc --saldo-poup --saldo-pj --pro-labore --renda-mensal --card-limite-pf --card-limite-pj --empresa --cnpj --cpf --cidade --uf');
  console.log('Ex.: node scripts/gerar-perfil.js --primeiro João --tipo pfpj --write');
  process.exit(args.help ? 0 : 1);
}

// ── monta o SPEC mínimo (só o que foi informado) ──
const num = (v) => (v === undefined ? undefined : Number(v));
const spec = {
  primeiro: args.primeiro,
  ...(args.id ? { id: args.id } : {}),
  ...(args.nome ? { nome: args.nome } : {}),
  ...(args.tipo ? { tipo: args.tipo } : {}),
  ...(args.contas ? { contas: String(args.contas).split(',').map((s) => s.trim()).filter(Boolean) } : {}),
  ...(args['saldo-cc'] !== undefined ? { saldoCC: num(args['saldo-cc']) } : {}),
  ...(args['saldo-poup'] !== undefined ? { saldoPoup: num(args['saldo-poup']) } : {}),
  ...(args['saldo-pj'] !== undefined ? { saldoPJ: num(args['saldo-pj']) } : {}),
  ...(args['pro-labore'] !== undefined ? { proLabore: num(args['pro-labore']) } : {}),
  ...(args['renda-mensal'] !== undefined ? { rendaMensal: num(args['renda-mensal']) } : {}),
  ...(args['card-limite-pf'] !== undefined ? { cardLimitPF: num(args['card-limite-pf']) } : {}),
  ...(args['card-limite-pj'] !== undefined ? { cardLimitPJ: num(args['card-limite-pj']) } : {}),
  ...(args.empresa ? { empresa: args.empresa } : {}),
  ...(args.cnpj ? { cnpj: String(args.cnpj) } : {}),
  ...(args.cpf ? { cpf: String(args.cpf) } : {}),
  ...(args.cidade ? { cidade: args.cidade } : {}),
  ...(args.uf ? { uf: args.uf } : {}),
};

// ── expande para prévia ──
let cfg;
try { cfg = expandSpec(spec); } catch (e) { console.error('Erro:', e.message); process.exit(1); }

const brl = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
console.log(`\n✅ Perfil "${cfg.id}" (${cfg.primeiro}) — ${cfg.hasPJ ? 'PF + PJ' : 'PF'}`);
console.log(`   contas: ${cfg.contas.join(', ')}`);
console.log(`   PF · saldo CC ${brl(cfg.saldoCC)}${cfg.contas.includes('pf-poup') ? ' · poupança ' + brl(cfg.saldoPoup) : ''} · limite cartão ${brl(cfg.cardLimitPF)}`);
if (cfg.hasPJ) console.log(`   PJ · ${cfg.empresa} · saldo ${brl(cfg.saldoPJ)} · limite cartão ${brl(cfg.cardLimitPJ)} · pró-labore ${brl(cfg.proLabore)}`);
console.log(`   seed/offset: ${JSON.stringify(cfg.seed)}`);

console.log('\n── Spec mínimo (guarde este JSON) ──');
console.log(JSON.stringify(spec));

if (args.write) {
  let arr = [];
  try { arr = JSON.parse(readFileSync(EXTRA_FILE, 'utf8')); if (!Array.isArray(arr)) arr = []; } catch { /* novo */ }
  const idExist = cfg.id;
  arr = arr.filter((s) => (s.id || slug(s.primeiro)) !== idExist); // substitui se já existir
  arr.push(spec);
  writeFileSync(EXTRA_FILE, JSON.stringify(arr, null, 2) + '\n');
  console.log(`\n💾 Salvo em mcp/openfinance/profiles.extra.json (${arr.length} perfil(is) extra). Commit + deploy para ativar.`);
} else {
  console.log('\n── Para o Render, coloque na env EXTRA_PROFILES um array com este spec ──');
  console.log(`EXTRA_PROFILES=${JSON.stringify([spec])}`);
  console.log('\n(ou rode de novo com --write para salvar no arquivo profiles.extra.json)');
}
console.log('');
