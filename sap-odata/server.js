// ─────────────────────────────────────────────────────────────
// MCP de exemplo — consulta SAP via OData.
//
// Expõe tools genéricas que traduzem perguntas em consultas OData:
//   • sap_listar_entidades → lista os entity sets do serviço (descoberta)
//   • sap_consultar        → GET numa entidade com $filter/$select/$top/…
//   • sap_obter_por_id     → GET numa entidade por chave
//
// Mesmo padrão do banking: as tools recebem o contexto do usuário
// (ctx.accessToken) e o cliente OData o envia como Bearer ao SAP.
// ─────────────────────────────────────────────────────────────

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { odataGet, odataConfig } from './odata-client.js';

export const SERVER_INFO = { name: 'sap-odata-mcp', version: '1.0.0' };

// Definição das tools (formato Anthropic; convertido p/ inputSchema no MCP).
const tools = [
  {
    name: 'sap_listar_entidades',
    description:
      'Lista os conjuntos de entidades (entity sets) disponíveis no serviço OData do SAP — útil para descobrir o que dá para consultar (ex.: Products, Orders, Customers). Use como primeiro passo quando não souber os nomes das entidades.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'sap_consultar',
    description:
      'Consulta registros de uma entidade OData do SAP com opções de query. Use para "listar/filtrar/buscar" dados de negócio. Ex.: entidade "Products", filtro "Discontinued eq false", ordenar "UnitPrice desc". A sintaxe do filtro segue o OData (V2: substringof(\'x\',Campo); V4: contains(Campo,\'x\')).',
    input_schema: {
      type: 'object',
      properties: {
        entidade: { type: 'string', description: 'Nome do entity set. Ex.: Products, Orders, Customers.' },
        filtro: { type: 'string', description: '$filter OData. Ex.: "UnitPrice gt 20", "Country eq \'Brazil\'".' },
        selecionar: { type: 'string', description: '$select (campos separados por vírgula). Ex.: "ProductName,UnitPrice".' },
        ordenar: { type: 'string', description: '$orderby. Ex.: "UnitPrice desc".' },
        top: { type: 'integer', description: '$top (máximo de registros). Padrão 10.' },
        pular: { type: 'integer', description: '$skip (paginação).' },
        expandir: { type: 'string', description: '$expand (entidades relacionadas). Ex.: "Category".' },
      },
      required: ['entidade'],
    },
  },
  {
    name: 'sap_obter_por_id',
    description:
      'Obtém um registro específico de uma entidade OData do SAP pela chave. Ex.: entidade "Products", id 1 → Products(1); entidade "Customers", id "ALFKI" → Customers(\'ALFKI\').',
    input_schema: {
      type: 'object',
      properties: {
        entidade: { type: 'string', description: 'Nome do entity set. Ex.: Products, Customers.' },
        id: { type: 'string', description: 'Valor da chave. Numérico (Products) ou texto (Customers).' },
        chave_texto: { type: 'boolean', description: 'Force chave como texto (entre aspas), se a detecção automática falhar.' },
        expandir: { type: 'string', description: '$expand de entidades relacionadas.' },
        selecionar: { type: 'string', description: '$select de campos.' },
      },
      required: ['entidade', 'id'],
    },
  },
];

const executores = {
  async sap_listar_entidades(_args, ctx) {
    // GET na base → documento de serviço (lista de entity sets).
    const out = await odataGet('', {}, ctx);
    // V2: { EntitySets:[…] } ; V4: [{ name,url }, …]
    const r = out.registros;
    const entidades = Array.isArray(r)
      ? r.map((x) => x.name || x.url).filter(Boolean)
      : r?.EntitySets || r;
    return { url: out.url, registros: { entidades } };
  },

  async sap_consultar(args = {}, ctx) {
    const { entidade, filtro, selecionar, ordenar, top = 10, pular, expandir } = args;
    if (!entidade) throw new Error('o parâmetro "entidade" é obrigatório.');
    return odataGet(entidade, { filtro, selecionar, ordenar, top, pular, expandir }, ctx);
  },

  async sap_obter_por_id(args = {}, ctx) {
    const { entidade, id, chave_texto, expandir, selecionar } = args;
    if (!entidade || id == null) throw new Error('"entidade" e "id" são obrigatórios.');
    const ehTexto = chave_texto || !/^\d+$/.test(String(id));
    const chave = ehTexto ? `'${String(id).replace(/'/g, "''")}'` : id;
    return odataGet(`${entidade}(${chave})`, { expandir, selecionar }, ctx);
  },
};

/** Cria o MCP Server já com as tools do SAP registradas. */
export function createSapServer(getContext = () => ({})) {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  // MCP exige inputSchema (camelCase).
  const MCP_TOOLS = tools.map(({ input_schema, ...rest }) => ({
    ...rest,
    inputSchema: input_schema || { type: 'object', properties: {} },
  }));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const fn = executores[req.params.name];
    if (!fn) {
      return { isError: true, content: [{ type: 'text', text: `Tool desconhecida: ${req.params.name}` }] };
    }
    try {
      const ctx = getContext(extra);
      const out = await fn(req.params.arguments || {}, ctx);
      const registros = out.registros;
      const payload = Array.isArray(registros)
        ? { total: registros.length, registros }
        : registros;
      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: typeof payload === 'object' && payload !== null ? payload : undefined,
        _meta: { odata_url: out.url, servico: odataConfig().base },
      };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `Erro OData: ${e?.message || e}` }] };
    }
  });

  return server;
}

export { tools, executores };
