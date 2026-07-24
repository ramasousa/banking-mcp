// ─────────────────────────────────────────────────────────────
// Cliente OData mínimo — usado pelo MCP de exemplo do SAP.
//
// Fala com QUALQUER serviço OData (SAP Gateway / S/4HANA / BTP, ou os
// serviços públicos de referência do OData). Suporta OData V2 e V4,
// injeta o token OAuth do usuário como Bearer (o mesmo padrão do banking:
// ctx.accessToken → Authorization) e normaliza a resposta.
//
// Config por variáveis de ambiente:
//   ODATA_BASE_URL  base do serviço (default: serviço público Northwind V2)
//   ODATA_VERSION   'v2' | 'v4'      (default: v2)
//   ODATA_BEARER    token estático p/ testes sem OAuth  (opcional)
//   SAP_API_KEY     chave do SAP API Business Hub/sandbox (opcional; header APIKey)
// ─────────────────────────────────────────────────────────────

export function odataConfig() {
  return {
    base: process.env.ODATA_BASE_URL || 'https://services.odata.org/V2/Northwind/Northwind.svc/',
    version: (process.env.ODATA_VERSION || 'v2').toLowerCase(),
    envBearer: process.env.ODATA_BEARER,
    apiKey: process.env.SAP_API_KEY,
  };
}

// Monta a URL do recurso com as opções de query do OData ($filter, $select…).
// Construímos a query manualmente para manter os `$` literais (URLSearchParams
// os codificaria como %24, o que alguns SAP Gateway rejeitam). Só os VALORES
// são percent-encoded.
export function buildUrl(base, entitySet, opts = {}, format) {
  const b = base.endsWith('/') ? base : base + '/';
  const mapa = {
    filtro: '$filter',
    selecionar: '$select',
    ordenar: '$orderby',
    top: '$top',
    pular: '$skip',
    expandir: '$expand',
  };
  const parts = [];
  for (const [k, qp] of Object.entries(mapa)) {
    const v = opts[k];
    if (v != null && v !== '') parts.push(`${qp}=${encodeURIComponent(String(v))}`);
  }
  if (format) parts.push(`$format=${format}`);

  let url = b + encodeURI(entitySet);
  if (parts.length) url += (url.includes('?') ? '&' : '?') + parts.join('&');
  return url;
}

// Normaliza o corpo: V2 → { d: { results:[…] } } ou { d:{…} }; V4 → { value:[…] }
// ou entidade única; documento de serviço → como veio.
export function normalize(j) {
  if (j == null) return j;
  if (j.d !== undefined) return j.d.results !== undefined ? j.d.results : j.d;
  if (j.value !== undefined) return j.value;
  return j;
}

/**
 * GET num entity set (ou recurso) do serviço OData.
 * @param {string} entitySet  ex.: "Products", "Products(1)", "" (service doc)
 * @param {object} opts       { filtro, selecionar, ordenar, top, pular, expandir }
 * @param {object} ctx        { accessToken } — token OAuth do usuário (→ Bearer)
 * @returns {{ url:string, registros:any }}
 */
export async function odataGet(entitySet, opts = {}, ctx = {}) {
  const cfg = odataConfig();
  const url = buildUrl(cfg.base, entitySet, opts, cfg.version === 'v2' ? 'json' : undefined);

  const headers = { accept: 'application/json' };
  const bearer = ctx.accessToken || cfg.envBearer; // token do usuário → SAP
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (cfg.apiKey) headers.APIKey = cfg.apiKey; // SAP API Business Hub/sandbox

  const r = await fetch(url, { headers });
  const texto = await r.text();
  if (!r.ok) throw new Error(`OData ${r.status} em ${entitySet || '/'} — ${texto.slice(0, 180)}`);

  let j;
  try {
    j = JSON.parse(texto);
  } catch {
    throw new Error('Resposta OData não é JSON (verifique ODATA_BASE_URL/$format).');
  }
  return { url: url.toString(), registros: normalize(j) };
}
