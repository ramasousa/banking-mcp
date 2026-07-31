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

## Limitações honestas (WhatsApp real)

- Sem UI rica: menus são **texto numerado** (o Sandbox restringe botões/listas).
- **Janela de 24h**: respostas a mensagens recebidas são livres; proativas exigem template + credenciais.
- Sandbox só conversa com números que fizeram o `join`.

## Produção

Trocar o Sandbox por um número WhatsApp aprovado (Twilio/Meta) e o mock pelo
Axway/Core Bancário nas tools `of_*` (via `ctx.accessToken` do broker OAuth).
