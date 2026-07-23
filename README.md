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

## Arquivos

| Arquivo | Papel |
|---|---|
| `bradesco-chat.html` | UI do app + chat (modo simulado embutido, modo real via `/api/chat`) |
| `server.js` | Backend Express: proxy para o Claude com _tool use_ + arquivos estáticos |
| `mock-bank.js` | Dados fictícios e executores das tools (substitua pelo Axway/Core Bancário) |
| `index.html` | Landing page do projeto Bradesco MCP |
| `specs/` | Especificações do MCP Server e do fluxo de autenticação |

## Levando para produção

- Saldo/extrato são **dados pessoais** → troque o mock pelo Axway/Core Bancário
  usando o **token do usuário** (Authorization Code + PKCE), como no
  `specs/banking-mcp-auth-flow.html`.
- Considere **streaming** (`client.messages.stream`) para a resposta aparecer aos poucos.
- Dados 100% fictícios nesta demo.
