// ─────────────────────────────────────────────────────────────
// Núcleo do MCP Server do Bradesco.
//
// Monta um servidor MCP que expõe as MESMAS 4 tools já definidas em
// mock-bank.js (consultar_saldo, consultar_extrato, consultar_gastos,
// consultar_pix), respondendo aos métodos padrão do protocolo:
//   • tools/list  → lista as ferramentas (JSON Schema já pronto no mock)
//   • tools/call  → executa a ferramenta e devolve o resultado
//
// Este core é agnóstico de transporte: é usado tanto pelo stdio.js
// (Claude Desktop, local) quanto pelo http.js (Connector no Claude.ai).
// ─────────────────────────────────────────────────────────────

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { tools, executores } from '../mock-bank.js';

export const SERVER_INFO = { name: 'bradesco-banking-mcp', version: '1.0.0' };

/**
 * Cria uma instância do MCP Server já com as tools registradas.
 *
 * @param {(extra: any) => { accessToken?: string, sub?: string, scope?: string }} getContext
 *   Função que devolve o contexto do usuário autenticado para cada chamada.
 *   No transporte HTTP com OAuth, carrega o token do usuário (para o Axway).
 *   No stdio/local (sem auth), devolve um objeto vazio — o mock ignora.
 */
export function createBankingServer(getContext = () => ({})) {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  // tools/list — reaproveita direto o array `tools` do mock-bank (JSON Schema).
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

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
