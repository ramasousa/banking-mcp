# Bradesco MCP · Demo do App com Claude

Simulação do app do Bradesco com um **assistente conversacional Claude** para
consulta de **saldo**, **extrato**, **gastos por categoria** e **PIX**.

A página `bradesco-chat.html` funciona de duas formas:

- **Modo simulado** — abrindo o HTML direto no navegador (sem backend), um
  classificador de intenção local responde às perguntas. Ótimo para preview.
- **Modo real** — com o backend `server.js` rodando e uma `ANTHROPIC_API_KEY`,
  o chat conversa com o **Claude de verdade**, que decide quais _tools_
  (`consultar_saldo`, `consultar_extrato`, `consultar_gastos`, `consultar_pix`)
  chamar. As tools são executadas no servidor contra um **mock** de dados
  bancários (`mock-bank.js`).

```
Navegador (bradesco-chat.html)
     │  POST /api/chat
     ▼
server.js  ── guarda a ANTHROPIC_API_KEY ──▶  API da Anthropic (Claude)
     │                                             │ tool_use
     │  executa a tool no mock-bank.js             ▼
     └──────────────  tool_result  ◀───────────────┘
```

> ⚠️ A `ANTHROPIC_API_KEY` fica **somente no servidor** — nunca no navegador.

## Como rodar (modo real)

```bash
npm install
cp .env.example .env          # edite e coloque sua chave
export ANTHROPIC_API_KEY="sk-ant-..."   # ou use um carregador de .env
npm start
```

Abra <http://localhost:3000/bradesco-chat.html> e pergunte
_"qual é o meu saldo?"_ ou _"quero ver meu extrato"_.

O front detecta o backend via `GET /api/health`; se a chave não estiver
configurada (ou o backend não estiver no ar), a página cai automaticamente no
**modo simulado**.

## MCP Server (plugável no Claude.ai e no Claude Desktop)

Além da demo de _tool use_ acima, o repositório expõe as mesmas 4 ferramentas
como um **MCP Server de verdade** — que fala o protocolo padrão (`tools/list`,
`tools/call`) e pode ser conectado a **qualquer cliente MCP**. Há dois
transportes, servidos pelo mesmo núcleo (`mcp/core.js`, que reaproveita o
`mock-bank.js`):

```
mock-bank.js (tools + executores)
      │
   mcp/core.js
      ├─▶ mcp/stdio.js  → LOCAL  → Claude Desktop
      └─▶ mcp/http.js   → REMOTO → Connector no Claude.ai  (OAuth 2.1 + PKCE)
```

### Modo local (stdio) — Claude Desktop

```bash
npm install
npm run mcp:stdio   # teste rápido; o Claude Desktop sobe o processo sozinho
```

Registre em `claude_desktop_config.json` (veja `claude_desktop_config.example.json`)
e reinicie o Claude Desktop:

```json
{
  "mcpServers": {
    "bradesco-banking": {
      "command": "node",
      "args": ["/CAMINHO/ABSOLUTO/PARA/banking-mcp/mcp/stdio.js"]
    }
  }
}
```

### Modo remoto (HTTP) — Connector no Claude.ai

```bash
# dev local, sem OAuth, só para testar as tools:
MCP_REQUIRE_AUTH=false npm run mcp:http

# produção: publique em HTTPS e informe a URL pública para os metadados:
MCP_PUBLIC_URL="https://banking-mcp.suaempresa.com" npm run mcp:http
```

Depois, no **Claude.ai → Settings → Connectors → Add custom connector**, cole a
URL do endpoint `/mcp`. O Claude descobre as tools sozinho e, como saldo/extrato
são dados pessoais, dispara o fluxo de **OAuth 2.1 (Authorization Code + PKCE)**
antes de acessá-los. Pergunte _"qual é o meu saldo no Bradesco?"_ em qualquer
conversa e o Claude chama a tool.

> ℹ️ Quem adiciona o connector é o usuário, nas configurações do Claude.ai — não
> há instalação automática a partir do chat.

### Autenticação (OAuth 2.1 + PKCE)

O `mcp/auth.js` traz o **esqueleto** do fluxo exigido pela spec do MCP:
metadados (`/.well-known/oauth-protected-resource` e `oauth-authorization-server`),
`/authorize`, `/token` (validando PKCE **S256**) e o middleware que protege o
`/mcp`. **Hoje ele emite tokens fictícios em memória.** Para produção:

1. Em `/authorize`, redirecione para o **IdP do Bradesco** em vez da tela de
   consentimento da demo; no callback, troque o code do banco pelo token real.
2. Passe esse token do usuário aos executores (já chega em `ctx.accessToken` no
   `mcp/core.js`) para chamar o **Axway/Core Bancário**.
3. Troque o store em memória por Redis/DB e trate expiração/refresh — ou deixe
   este servidor apenas como **Resource Server**, delegando tudo ao IdP.

Veja o fluxo desenhado em `specs/banking-mcp-auth-flow.html`.

## Arquivos

| Arquivo | Papel |
|---|---|
| `bradesco-chat.html` | UI do app + chat (modo simulado embutido, modo real via `/api/chat`) |
| `server.js` | Backend Express: proxy para o Claude com _tool use_ + arquivos estáticos |
| `mock-bank.js` | Dados fictícios e executores das tools (substitua pelo Axway/Core Bancário) |
| `mcp/core.js` | Núcleo do MCP Server (registra as tools, agnóstico de transporte) |
| `mcp/stdio.js` | Transporte stdio — Claude Desktop (local) |
| `mcp/http.js` | Transporte Streamable HTTP — Connector no Claude.ai (remoto) |
| `mcp/auth.js` | Esqueleto de OAuth 2.1 + PKCE (mock hoje, Axway depois) |
| `claude_desktop_config.example.json` | Exemplo de registro do MCP no Claude Desktop |
| `index.html` | Landing page do projeto Bradesco MCP |
| `specs/` | Especificações do MCP Server e do fluxo de autenticação |

## Levando para produção

- Saldo/extrato são **dados pessoais** → troque o mock pelo Axway/Core Bancário
  usando o **token do usuário** (Authorization Code + PKCE), como no
  `specs/banking-mcp-auth-flow.html`.
- Considere **streaming** (`client.messages.stream`) para a resposta aparecer aos poucos.
- Dados 100% fictícios nesta demo.
