# Open Finance Brasil — catálogo MCP fiel

Este módulo faz o MCP Server responder **no formato exato das APIs do Open
Finance Brasil** (Bacen): mesmo envelope, nomes de campos, enums e formato de
valores dos swaggers oficiais.

## Padrão respeitado

- **Envelope:** toda resposta é `{ data, links, meta }`.
  - `links`: `self`, `first`, `prev`, `next`, `last` (paginação).
  - `meta`: `{ totalRecords, totalPages, requestDateTime }` — nos endpoints de
    **transações**, `meta` traz **apenas** `requestDateTime` (fiel ao swagger).
- **Valores monetários:** objeto `{ "amount": "137842.55", "currency": "BRL" }`
  (amount = **string**, 2–4 casas). Pagamentos usam `\d{1,16}\.\d{2}`.
- **Enums oficiais:** `CONTA_DEPOSITO_A_VISTA`, `creditDebitType` `CREDITO|DEBITO`,
  consent `AUTHORISED`, permissions (`ACCOUNTS_BALANCES_READ`…), resource `type`
  (`ACCOUNT|CREDIT_CARD_ACCOUNT|LOAN|…`), PIX status `RCVD|ACCP|ACSC|RJCT|…`, etc.

## Tools → endpoints (22)

| Domínio | Tool | Endpoint Open Finance |
|---|---|---|
| Consent | `of_get_consent` | `GET /consents/v3/consents/{consentId}` |
| Resources | `of_list_resources` | `GET /resources/v3/resources` |
| Contas | `of_list_accounts` | `GET /accounts/v2/accounts` |
| | `of_get_account` | `GET /accounts/v2/accounts/{accountId}` |
| | `of_get_account_balances` | `.../{accountId}/balances` |
| | `of_get_account_transactions` | `.../{accountId}/transactions` |
| | `of_get_account_overdraft_limits` | `.../{accountId}/overdraft-limits` |
| Cartões | `of_list_credit_cards` | `GET /credit-cards-accounts/v2/accounts` |
| | `of_get_credit_card_limits` | `.../{id}/limits` |
| | `of_get_credit_card_bills` | `.../{id}/bills` |
| | `of_get_credit_card_bill_transactions` | `.../{id}/bills/{billId}/transactions` |
| Cadastro | `of_get_personal_identifications` | `GET /customers/v2/personal/identifications` |
| | `of_get_personal_qualifications` | `.../personal/qualifications` |
| | `of_get_personal_financial_relations` | `.../personal/financial-relations` |
| Empréstimos | `of_list_loans` | `GET /loans/v2/contracts` |
| | `of_get_loan_contract` | `.../{contractId}` |
| | `of_get_loan_payments` | `.../{contractId}/payments` |
| | `of_get_loan_scheduled_instalments` | `.../{contractId}/scheduled-instalments` |
| Financiamentos | `of_list_financings` | `GET /financings/v2/contracts` |
| Investimentos | `of_list_investments` (por `tipo`) | `bank-fixed-incomes` / `credit-fixed-incomes` / `treasure-titles` / `funds` / `variable-incomes` |
| Pagamentos (PIX) | `of_create_payment_consent` ⚠️ | `POST /payments/v4/consents` |
| | `of_initiate_pix_payment` ⚠️ | `POST /payments/v4/pix/payments` |

⚠️ Destrutivas (fase 3): `destructiveHint`, **confirmação obrigatória** e execução **simulada**.

## Arquivos

- `of-helpers.js` — envelope (`listEnv`/`singleEnv`), formato de valores (`amt`), timestamps.
- `of-data.js` — datasets fiéis (reaproveitam os números do `mock-bank.js`, remodelados).
- `catalog.js` — as 22 tools + executores; `core.js` aponta para cá.

## Produção

Troque o mock por chamadas reais ao **Axway/Core Bancário** usando o token OAuth do
usuário (já disponível em `ctx.accessToken`). O envelope e os campos já estão no
formato que o Open Finance exige, então a troca é no acesso ao dado, não na forma.

> Baseado nos swaggers oficiais: `github.com/OpenBanking-Brasil/openapi`
> (accounts v2, consents v3, resources v3, loans v2, customers v2, payments v4).
