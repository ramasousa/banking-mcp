# WhatsApp (Twilio Sandbox) — protótipo vivo

Webhook que atende no **WhatsApp de verdade** via o **Twilio Sandbox**, com a
mesma jornada roteirizada do protótipo (opt-in → autenticação → consentimento →
extrato e cartões). Os dados vêm das tools `of_*` (MCP em processo). Menus
numerados (o Sandbox lida melhor com número/texto do que com botões).

```
WhatsApp (Twilio Sandbox) ──POST /whatsapp──▶ whatsapp/webhook.js
                                                 │ mcp.callTool('of_*')
                                                 ▼  responde via TwiML
```

> **Sem credenciais no backend:** respondemos com **TwiML** (a resposta do
> próprio webhook), então **não** é preciso `Account SID`/`Auth Token` aqui.
> (Só seriam necessários para enviar mensagens proativas fora da janela de 24h.)

## Rodar local

```bash
npm install
npm run whatsapp     # http://localhost:3300/whatsapp
```

## Publicar (Render, sem notebook)

Novo **Web Service** → Build `npm install` · Start `npm run whatsapp`.
Anote a URL pública (ex.: `https://banking-wa.onrender.com`).

## Conectar ao Twilio Sandbox

1. Crie conta no **twilio.com** (trial grátis).
2. Console → **Messaging → Try it out → Send a WhatsApp message** (WhatsApp Sandbox).
3. Você verá um **número do sandbox** e um código **`join <duas-palavras>`**.
4. No **seu WhatsApp**, mande `join <duas-palavras>` para o número do sandbox → conectado.
5. Ainda no Sandbox, em **"When a message comes in"**, cole:
   `https://<sua-url-no-render>/whatsapp` — método **POST** → salve.
6. Mande **`oi`** para o número do sandbox no WhatsApp → o bot responde. 🎉

## A jornada (responda com o número)

`oi` → *SIM* → *OK* → *AUTORIZAR* → **1) Extrato** ou **2) Cartões**.
Comandos globais: `menu`, `recomeçar`.

## Massa de teste multi-perfil (cada pessoa vê os "seus" dados)

Vários testadores podem usar o mesmo Sandbox e cada número vê uma massa
**diferente e determinística**. Perfis disponíveis:

| Perfil | Tipo | Cenário |
|---|---|---|
| **raul** | PF + PJ | Empresário de tecnologia (Sousa Tech) — o cenário original |
| **heitor** | PF + PJ | Comércio/varejo (Almeida Alimentos) — sazonal, folha maior |
| **cadimo** | PF + PJ | Serviços/consultoria (Pereira Consultoria) — volume menor |
| **patz** | PF | CLT/freelancer, **sem PJ** → exercita "sugerir abertura de PJ" |

**Como escolher (no WhatsApp):** na primeira mensagem o bot pergunta *"Quem é
você?"*. Responda com o nome (`sou heitor`) ou o número. Troca a qualquer
momento com `sou <nome>`; `perfil` mostra o atual + a lista.

**Atribuição fixa por número (opcional):** defina a env `WA_PROFILE_MAP` com um
JSON `{ "whatsapp:+55…": "heitor", … }` no Render — assim cada número já entra
no seu perfil, sem precisar escolher.

> Os demais canais (connector do Claude, protótipo web) continuam no perfil
> padrão (`raul`) — o perfil só é selecionado nos webhooks do WhatsApp.

### Gerar novos perfis (sem editar código)

Um **gerador** cria a massa a partir do essencial (nome + quais contas); saldos,
seeds/"offset", limites, empréstimos e cadastro são derivados de forma
determinística (mesmo id → mesma massa).

```bash
# prévia (imprime o spec + o snippet para o Render)
npm run gerar:perfil -- --primeiro João --tipo pfpj
npm run gerar:perfil -- --primeiro Marina --contas pf-cc,pf-card,pf-loan
npm run gerar:perfil -- --list          # lista os perfis atuais

# salvar no arquivo (carregado automaticamente)
npm run gerar:perfil -- --primeiro Bruno --tipo pfpj --saldo-cc 15000 --write
```

**Contas válidas:** `pf-cc pf-poup pf-card pf-loan pf-invest pj-cc pj-card pj-loan pj-fin`
(`pj-cc` implica PJ; `--tipo pf|pfpj` é atalho para o conjunto padrão).
**Overrides opcionais:** `--saldo-cc --saldo-poup --saldo-pj --pro-labore
--renda-mensal --card-limite-pf --card-limite-pj --empresa --cnpj --cpf --cidade --uf`.

Os perfis extras são carregados de duas formas (id repetido → o extra vence):
1. **arquivo** `mcp/openfinance/profiles.extra.json` (array de specs — veja o
   `.example.json`) — ideal se você commita;
2. **env** `EXTRA_PROFILES` (o mesmo array em JSON) — ideal no Render, sem
   alterar código.

> **iPad, sem terminal?** Peça ao assistente para rodar o gerador, ou defina a
> env `EXTRA_PROFILES` direto no Render com um array de specs, ex.:
> `[{"primeiro":"João","tipo":"pfpj"},{"primeiro":"Marina","contas":["pf-cc","pf-card"]}]`

## Limitações honestas (WhatsApp real)

- Sem UI rica: menus são **texto numerado** (o Sandbox restringe botões/listas).
- **Janela de 24h**: respostas a mensagens recebidas são livres; proativas exigem template + credenciais.
- Sandbox só conversa com números que fizeram o `join`.

## Produção

Trocar o Sandbox por um número WhatsApp aprovado (Twilio/Meta) e o mock pelo
Axway/Core Bancário nas tools `of_*` (via `ctx.accessToken` do broker OAuth).

---

# Versão LLM (texto livre) — `webhook-llm.js`

Em vez de menus numerados, o cliente escreve em **linguagem natural**
(*"quanto gastei de imposto na PJ nos últimos 3 meses?"*) e o **Claude** decide
quais tools `of_*` chamar, executa via MCP em processo e responde em pt-BR.

```
WhatsApp ──POST /whatsapp──▶ webhook-llm.js
      │  (responde 200 na hora — evita o timeout de ~15s do Twilio)
      └─▶ Claude (loop agêntico) ⇄ tools of_* (MCP em processo)
              └─▶ resposta final via Twilio REST API (messages.create)
```

**Por que precisa de credenciais Twilio agora?** O LLM leva 5–30s (raciocínio +
tools), acima do limite síncrono do webhook. Então respondemos **200 na hora** e
enviamos a resposta **de forma assíncrona** pela API REST do Twilio — o que exige
`Account SID` + `Auth Token`. Dentro da **janela de 24h** do WhatsApp, mensagem
livre é permitida sem template.

## Rodar (Render)

Start Command: `npm run whatsapp:llm` · Build: `npm install`.
A rota continua sendo `/whatsapp` (mesma URL no Twilio Sandbox).

## Variáveis de ambiente

| Variável | Obrigatória | Onde pegar / default |
|---|---|---|
| `ANTHROPIC_API_KEY` | sim | console.anthropic.com → API Keys |
| `TWILIO_ACCOUNT_SID` | sim* | console.twilio.com (Account Info) |
| `TWILIO_AUTH_TOKEN` | sim* | idem |
| `TWILIO_WHATSAPP_FROM` | não | default `whatsapp:+14155238886` (nº do sandbox) |
| `ANTHROPIC_MODEL` | não | default `claude-haiku-4-5-20251001` |
| `WA_PROFILE_MAP` | não | JSON `{ "whatsapp:+55…": "heitor" }` p/ fixar perfil por número |

> \* Sem as credenciais Twilio, o webhook cai em **modo síncrono** (útil só para
> teste local; pode estourar o timeout do Twilio em produção).

## Guardrails embutidos

- **Pagamentos fora**: `of_create_payment_consent` e `of_initiate_pix_payment`
  não entram no *toolbelt* do LLM — só consulta.
- **Escopo travado + protótipo/dados fictícios** via *system prompt*.
- **Consentimento AUTHORISED** assumido no cenário; sem exposição de dados sensíveis.
- **Corte de segurança**: no máximo 6 rodadas de tool por mensagem.

## Testar

`recomeçar` limpa o histórico. Exemplos de perguntas:

- *"qual meu saldo na conta PJ?"*
- *"quanto gastei com imposto na PJ nos últimos 3 meses?"*
- *"compara meu gasto de cartão PF e PJ"*
- *"me dá uma visão consolidada PF e PJ"*

## Custo (honesto)

Cada conversa gasta **centavos** de API Anthropic (algumas chamadas por
mensagem). Recomenda-se um limite de billing no console da Anthropic.
