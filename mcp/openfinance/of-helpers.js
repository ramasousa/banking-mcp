// ─────────────────────────────────────────────────────────────
// Helpers do Open Finance Brasil — envelope, valores e paginação.
//
// Fiel ao padrão das APIs (Bacen): toda resposta é
//   { data, links, meta }
// valores monetários são OBJETO { amount:"137842.55", currency:"BRL" }
// (amount = string, 2–4 casas), datas em RFC-3339 UTC, e a paginação usa
// links (self/first/prev/next/last) + meta (totalRecords/totalPages).
// ─────────────────────────────────────────────────────────────

// Base pública do Resource Server (ilustrativa no mock).
export const OF_BASE = process.env.OF_BASE_URL || 'https://bradesco-mcp.api.bradesco.com/open-banking';

// Timestamp fixo p/ o mock ser estável (nada de Date.now()).
export const REQ_DT = '2026-07-23T12:00:00Z';
export const CNPJ_BRADESCO = '60746948000112';
export const BRAND = 'Banco Bradesco S.A.';

// Valor monetário no formato Open Finance (string, 2 casas).
export const amt = (v, currency = 'BRL') => ({ amount: Number(v).toFixed(2), currency });
// Alguns endpoints usam { amount, currency } com nomes próprios (ex.: contractAmount + currency).
export const amtStr = (v) => Number(v).toFixed(2);
// Percentuais/taxas: 6 casas (ex.: CET, preFixedRate).
export const rate = (v) => Number(v).toFixed(6);

// Envelope de LISTA paginada: { data:[...], links, meta }.
export function listEnv(path, arr, { page = 1, pageSize = 25, transactions = false } = {}) {
  const total = arr.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  const slice = arr.slice((p - 1) * pageSize, p * pageSize);
  const url = (n) => `${OF_BASE}${path}?page=${n}&page-size=${pageSize}`;

  const links = { self: url(p), first: url(1), last: url(totalPages) };
  if (p > 1) links.prev = url(p - 1);
  if (p < totalPages) links.next = url(p + 1);

  // Endpoints de transações usam meta só com requestDateTime.
  const meta = transactions
    ? { requestDateTime: REQ_DT }
    : { totalRecords: total, totalPages, requestDateTime: REQ_DT };

  return { data: slice, links, meta };
}

// Envelope de RECURSO único: { data:{...}, links:{self}, meta }.
export function singleEnv(path, data) {
  return { data, links: { self: `${OF_BASE}${path}` }, meta: { requestDateTime: REQ_DT } };
}

// Erro no formato Open Finance (RFC 7807-ish do padrão): { errors:[...], meta }.
export function ofError(code, title, detail) {
  return { errors: [{ code, title, detail }], meta: { requestDateTime: REQ_DT } };
}
