# Fina Web Client

Servidor Express que conecta o **Banking MCP Server** diretamente ao navegador via **Claude API**, com streaming de resposta em tempo real (SSE).

## Arquitetura

```
Browser (public/index.html)
   │  POST /api/chat   { messages: [...] }
   │◀ SSE stream       reasoning | tool_start | tool_done | text | done | error
   ▼
web-client/server.js (Express)
   │  InMemoryTransport (em processo)
   ▼
../mcp/core.js  ←→  Banking MCP Server (27 tools Open Finance Brasil)
   │
   ▼
../mcp/openfinance/  ←→  Dados mock (of-data.js) ou Axway real em produção
```

O servidor também chama a **API Claude** em loop agêntico:
```
server.js ──claude.messages.create──▶ Anthropic API
          ◀──tool_use────────────────
          ──mcp.callTool('of_*')────▶ Banking MCP Server
          ──tool_result──────────────▶ Anthropic API (continua o loop)
          ◀──text (resposta final)───
```

## Instalação

```bash
cd web-client
npm install
```

## Configuração

| Variável             | Obrigatória | Padrão           | Descrição |
|----------------------|-------------|------------------|-----------|
| `ANTHROPIC_API_KEY`  | Sim         | —                | Chave da API Anthropic |
| `CLAUDE_MODEL`       | Não         | `claude-sonnet-4-6` | Modelo Claude |
| `PORT`               | Não         | `3300`           | Porta HTTP |
| `BANK_PROFILE`       | Não         | `default`        | Perfil mock: `default`, `mei`, `pj` |

## Execução

```bash
# Desenvolvimento (com auto-reload)
ANTHROPIC_API_KEY=sk-ant-... npm run dev

# Produção
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Abra **http://localhost:3300** no navegador.

## Modo demo (sem API key)

Se `ANTHROPIC_API_KEY` não estiver configurada, o frontend detecta via `/api/health` e ativa o **modo simulado**: reproduz sequências pré-gravadas com a mesma UX (reasoning block, tool calls, streaming de texto). Útil para demos sem custo de API.

## SSE Protocol

O endpoint `POST /api/chat` devolve `text/event-stream`. Cada evento:

| Tipo         | Campos                          | Quando |
|--------------|---------------------------------|--------|
| `reasoning`  | `text`                          | Claude pensa (extended thinking) |
| `tool_start` | `name`, `desc`                  | Tool começou a executar |
| `tool_done`  | `name`, `summary`               | Tool concluída (resumo legível) |
| `text`       | `chunk`                         | Chunk da resposta final |
| `done`       | `text`                          | Resposta completa enviada |
| `error`      | `message`                       | Erro no loop agêntico |

## Identidades visuais (white-label)

O frontend (`public/index.html`) suporta dois temas via `data-t` no `<html>`:

- **Noir** (`data-t=""`) — fundo quase-preto, acento lime `#C8FF00`
- **Vermelho** (`data-t="v"`) — fundo bordô escuro, acento vermelho `#E8102E` (Bradesco DS)

Troca instantânea via toggle N/V em qualquer tela.
