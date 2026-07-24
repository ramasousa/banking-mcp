// ─────────────────────────────────────────────────────────────
// Núcleo do MCP Server do Bradesco.
//
// Expõe o CATÁLOGO OFICIAL de tools (mcp/bradesco-catalog.js), conforme a
// Especificação Técnica do Bradesco MCP Connector — Conta & Saldo, PIX,
// Open Finance e Produtos Bancários, com title + anotações. Responde aos
// métodos padrão do protocolo:
//   • tools/list  → lista as ferramentas (com inputSchema/annotations)
//   • tools/call  → executa a ferramenta e devolve o resultado
//
// Este core é agnóstico de transporte: é usado tanto pelo stdio.js
// (Claude Desktop, local) quanto pelo http.js (Connector no Claude.ai).
// (O chat demo em server.js continua usando o mock-bank.js diretamente.)
// ─────────────────────────────────────────────────────────────

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { tools, executores } from './bradesco-catalog.js';

export const SERVER_INFO = { name: 'bradesco-mcp-connector', version: '1.0.0' };

/**
 * Cria uma instância do MCP Server já com as tools registradas.
 *
 * @param {(extra: any) => { accessToken?: string, sub?: string, scope?: string }} getContext
 *   Função que devolve o contexto do usuário autenticado para cada chamada.
 *   No transporte HTTP com OAuth, carrega o token do usuário (para o Axway).
 *   No stdio/local (sem auth), devolve um objeto vazio — o mock ignora.
 */
// As tools do mock-bank.js usam `input_schema` (formato da API da Anthropic).
// O protocolo MCP exige `inputSchema` (camelCase) — sem isso o cliente descarta
// as ferramentas ("nenhuma ferramenta disponível"). Convertemos aqui, mantendo
// o mock-bank.js intacto para o outro demo (server.js).
const MCP_TOOLS = tools.map(({ input_schema, inputSchema, ...rest }) => ({
  ...rest,
  inputSchema: inputSchema || input_schema || { type: 'object', properties: {} },
}));

export function createBankingServer(getContext = () => ({})) {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  // tools/list — expõe as tools já no formato MCP (inputSchema).
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }));

  // tools/call — resolve o executor e devolve o resultado como texto JSON.
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const { name, arguments: args } = req.params;
    const fn = executores[name];
    if (!fn) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Tool desconhecida: ${name}` }],
      };
    }

    // ctx carrega o token do usuário autenticado (OAuth 2.1 + PKCE).
    // No mock é ignorado; em produção o executor usaria ctx.accessToken
    // como Bearer para chamar o Axway/Core Bancário.
    const ctx = getContext(extra);
    const out = fn(args || {}, ctx);

    return {
      content: [{ type: 'text', text: JSON.stringify(out.data) }],
      structuredContent: out.data,
      _meta: { source: out.meta },
    };
  });

  return server;
}
