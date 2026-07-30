# Protótipo "vivo" — extrato no WhatsApp

UI estilo WhatsApp (navegável, do zero: opt-in → auth → **consentimento Open
Finance** → seleção PF/PJ → extrato) cujos dados vêm **de verdade** das nossas
tools `of_*`, via um pequeno backend.

```
Navegador (proto/index.html)  ── fetch /api/... ──▶  proto/server.js
                                                        │ mcp.callTool('of_*')  (in-process)
                                                        ▼
                                                 MCP Server (mcp/core.js)
```

## Rodar

```bash
npm install
npm run proto        # http://localhost:3200
```

Abra o endereço e clique nos botões para percorrer a jornada. As etapas de
**conta** e **extrato** consultam o backend (dados reais das tools); opt-in,
autenticação e consentimento são simulados no protótipo.

## Camada de projeção conversacional (/api)

O backend traduz o envelope Open Finance para um formato pronto para conversa
(valores já em pt-BR, rótulos de enums, sem `links/meta`):

| Endpoint | Tool(s) `of_*` chamada(s) |
|---|---|
| `GET /api/consent` | `of_get_consent` |
| `GET /api/accounts` | `select_account` |
| `GET /api/extrato?accountId=&period=` | `of_get_account_balances` + `of_get_account_transactions` |
| `GET /api/categorias?accountId=&period=` | `of_get_account_transactions` (agrega saídas por tipo) |

`period`: `7d` · `30d` · `90d` · `mes`.

## Publicar (Render, sem notebook)

Crie um **novo Web Service** no Render apontando para este repo:
- **Build:** `npm install`
- **Start:** `npm run proto`

A URL pública servirá o protótipo vivo. (Dados 100% fictícios.)

## Para produção

Troque o mock pelo Axway/Core Bancário nas tools `of_*` — a UI e a camada de
projeção não mudam, só a origem do dado (via `ctx.accessToken` do broker OAuth).
