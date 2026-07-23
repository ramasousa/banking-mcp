#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Transporte STDIO — para uso LOCAL no Claude Desktop.
//
// O Claude Desktop sobe este processo e conversa via stdin/stdout.
// Registre-o em claude_desktop_config.json (veja o exemplo na raiz do
// repositório e o README). Não há OAuth aqui: o servidor roda como o
// próprio usuário da máquina.
//
//   Claude Desktop  ──stdio (JSON-RPC)──▶  este processo (mcp/stdio.js)
//                                                 │
//                                                 ▼
//                                          mock-bank.js (dados fictícios)
//
// IMPORTANTE: no stdio, o stdout é o CANAL DO PROTOCOLO. Nunca use
// console.log (contamina o JSON-RPC) — logs vão para stderr.
// ─────────────────────────────────────────────────────────────

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBankingServer } from './core.js';

const server = createBankingServer();
const transport = new StdioServerTransport();

await server.connect(transport);
console.error('[banking-mcp] stdio server pronto (dados fictícios).');
