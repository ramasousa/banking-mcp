// ─────────────────────────────────────────────────────────────
// Multi-perfil para os webhooks do WhatsApp.
//
// Mantém UM cliente MCP em processo POR PERFIL (cada servidor recebe
// getContext → { profile }), de modo que as tools of_* devolvem a massa de
// dados daquela pessoa. Também resolve "quem é você" por número de telefone.
//
// Assim, várias pessoas do time testam no WhatsApp e cada uma vê os "seus"
// dados fictícios (raul, heitor, cadimo, patz).
// ─────────────────────────────────────────────────────────────

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createBankingServer } from '../mcp/core.js';
import { listProfiles, DEFAULT_PROFILE } from '../mcp/openfinance/of-data.js';

export const profiles = listProfiles(); // [{ id, primeiro, nome, tipo, empresa }]
export { DEFAULT_PROFILE };

// ── Um cliente MCP por perfil ──
const clients = {};
for (const p of profiles) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const srv = createBankingServer(() => ({ profile: p.id }));
  await srv.connect(st);
  const c = new Client({ name: `wa-${p.id}`, version: '1.0.0' }, { capabilities: {} });
  await c.connect(ct);
  clients[p.id] = c;
}

/** Executa uma tool of_* no cliente do perfil indicado e devolve o JSON já parseado. */
export const callFor = async (profileId, name, args = {}) => {
  const c = clients[profileId] || clients[DEFAULT_PROFILE];
  return JSON.parse((await c.callTool({ name, arguments: args })).content[0].text);
};

/** Lista de tools (idêntica entre perfis) — usada pelo webhook LLM. */
export const toolList = async () => (await clients[DEFAULT_PROFILE].listTools()).tools;

export const profileMeta = (id) => profiles.find((p) => p.id === id) || profiles.find((p) => p.id === DEFAULT_PROFILE);

// ── Resolução por número de telefone ──
// Prioridade: escolha em memória (comando "sou <nome>") > mapa via env > default.
const envMap = (() => { try { return JSON.parse(process.env.WA_PROFILE_MAP || '{}'); } catch { return {}; } })();
const chosen = new Map(); // from -> profileId

export function profileFor(from) { return chosen.get(from) || envMap[from] || null; }
export function setProfile(from, id) { chosen.set(from, id); }
export function hasProfile(from) { return chosen.has(from) || Boolean(envMap[from]); }

/**
 * Interpreta comandos de troca de perfil: "sou heitor", "perfil raul",
 * "eu sou o cadimo". Devolve o id do perfil, '__list__' (pediu a lista/atual)
 * ou null (não é comando de perfil).
 */
export function parseProfileCommand(text) {
  const t = (text || '').trim().toLowerCase();
  if (/^perfil$/.test(t) || /^quem sou eu\??$/.test(t)) return '__list__';
  const m = t.match(/^(?:sou|perfil|eu sou|troca(?:r)? perfil)\s+(?:o\s+|a\s+)?(.+)$/);
  if (!m) return null;
  const q = m[1].trim();
  const p = profiles.find((x) => x.id === q || x.primeiro.toLowerCase() === q || x.nome.toLowerCase().startsWith(q));
  return p ? p.id : '__unknown__';
}

/** Texto do seletor de perfil (menu de "quem é você"). */
export function pickerText() {
  const linhas = profiles.map((p, i) => `*${i + 1})* ${p.primeiro} — ${p.tipo}${p.empresa ? ` · ${p.empresa}` : ''}`).join('\n');
  return `👤 *Quem é você?* _(massa de teste — dados fictícios)_\n\n${linhas}\n\nResponda com o *nome* (ex.: *sou heitor*) ou o número.`;
}

/** Resolve seleção por número (1..N) do seletor. */
export function profileByIndex(n) {
  return (n >= 1 && n <= profiles.length) ? profiles[n - 1].id : null;
}
