#!/usr/bin/env node
// Transporte STDIO do MCP SAP-OData — para o Claude Desktop (local).
// Registre em claude_desktop_config.json apontando para este arquivo.
// Config via env: ODATA_BASE_URL, ODATA_VERSION, ODATA_BEARER, SAP_API_KEY.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSapServer } from './server.js';
import { odataConfig } from './odata-client.js';

const server = createSapServer();
const transport = new StdioServerTransport();
await server.connect(transport);
// stdout é o canal do protocolo — logs vão para stderr.
console.error(`[sap-odata-mcp] stdio pronto · serviço: ${odataConfig().base}`);
