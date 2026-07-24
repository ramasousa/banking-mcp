# SAP OData MCP · exemplo

MCP de exemplo que **consulta SAP via OData** — mesma arquitetura do banking
(tools MCP + token OAuth do usuário fluindo como `Bearer` para o backend),
trocando o mock por chamadas OData reais.

Funciona com **qualquer serviço OData** (SAP Gateway / S/4HANA / BTP, ou os
serviços públicos de referência do OData), em **V2 ou V4**.

## Tools

| Tool | O que faz |
|---|---|
| `sap_listar_entidades` | Lista os entity sets do serviço (descoberta) |
| `sap_consultar` | GET numa entidade com `$filter/$select/$orderby/$top/$skip/$expand` |
| `sap_obter_por_id` | GET de um registro por chave (numérica ou texto) |

## Configuração (env)

| Variável | Descrição | Padrão |
|---|---|---|
| `ODATA_BASE_URL` | Base do serviço OData | serviço público **Northwind V2** |
| `ODATA_VERSION` | `v2` ou `v4` | `v2` |
| `ODATA_BEARER` | Token estático para teste sem OAuth | — |
| `SAP_API_KEY` | Chave do SAP API Business Hub/sandbox (header `APIKey`) | — |

## Rodar

```bash
npm install

# Local (Claude Desktop) — usa o Northwind público por padrão:
npm run sap:stdio

# Remoto (Connector no Claude.ai):
npm run sap:http     # sobe em /mcp (porta 3100)
```

Exemplos de perguntas no Claude:
- *"Quais entidades existem no serviço SAP?"* → `sap_listar_entidades`
- *"Liste 5 produtos com preço acima de 20, do mais caro pro mais barato."*
  → `sap_consultar` (entidade `Products`, filtro `UnitPrice gt 20`, ordenar `UnitPrice desc`, top 5)
- *"Detalhe o produto 1."* → `sap_obter_por_id` (`Products`, id 1)
- *"Mostre o cliente ALFKI."* → `sap_obter_por_id` (`Customers`, id `ALFKI`)

## Apontando para um SAP real

Troque o serviço e o modo de auth:

```bash
# SAP Gateway demo (ES5) / S/4HANA / BTP — normalmente OData V2 ou V4:
export ODATA_BASE_URL="https://<host>/sap/opu/odata/sap/<SERVICE>/"
export ODATA_VERSION="v2"

# Autenticação:
#  a) Teste rápido: token estático
export ODATA_BEARER="<access_token>"
#  b) SAP API Business Hub / sandbox:
export SAP_API_KEY="<sua-api-key>"
#  c) Produção: token OAuth do USUÁRIO (recomendado)
#     Ligue o broker OAuth do banking (mcp/auth.js). O token do usuário chega em
#     ctx.accessToken e o cliente OData o envia como Bearer ao SAP — sem mudar as tools.
```

> **Sintaxe do `$filter`**: OData **V2** usa `substringof('x',Campo)`; **V4** usa
> `contains(Campo,'x')`. Comparadores (`eq/ne/gt/ge/lt/le`) e `and/or` valem nos dois.

## Como se conecta ao que já construímos

- **Descoberta + query** → mesmas ideias das tools do banking, agora sobre dados de negócio.
- **OAuth** → o `ctx.accessToken` (do broker OAuth / IdP) vira o `Authorization: Bearer`
  da chamada OData. É exatamente o padrão de **acesso de MCP de terceiros ao SAP via BTP + OAuth**.
