// Cliente HTTP para a API Pluggy (Open Finance Brasil aggregator).
// Gerencia autenticação automática (apiKey válida por 2h) e todas as
// chamadas necessárias para construir o perfil financeiro.

const PLUGGY_BASE = 'https://api.pluggy.ai';

export class PluggyClient {
  constructor(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this._apiKey = null;
    this._keyExpiry = 0;
  }

  async getApiKey() {
    if (this._apiKey && Date.now() < this._keyExpiry) return this._apiKey;

    const res = await fetch(`${PLUGGY_BASE}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: this.clientId, clientSecret: this.clientSecret }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Pluggy auth falhou (${res.status}): ${txt}`);
    }
    const data = await res.json();
    console.log('[Pluggy] auth response campos:', Object.keys(data));
    this._apiKey = data.apiKey ?? data.token ?? data.access_token ?? data.accessToken;
    if (!this._apiKey) {
      throw new Error(`Pluggy auth: campo apiKey não encontrado. Resposta: ${JSON.stringify(data)}`);
    }
    console.log('[Pluggy] apiKey obtido, tamanho:', this._apiKey.length);
    this._keyExpiry = Date.now() + 110 * 60 * 1000;
    return this._apiKey;
  }

  async _get(path, params = {}) {
    const apiKey = await this.getApiKey();
    const url = new URL(`${PLUGGY_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), {
      headers: { 'X-API-KEY': apiKey },
    });
    if (!res.ok) {
      const txt = await res.text();
      // Se /items retornar 401, pode ser que nenhuma instituição foi conectada no sandbox
      if (path === '/items' && res.status === 401) {
        throw new Error(
          `Pluggy GET /items (401): Unauthorized. Verifique se conectou uma instituição de teste em app.pluggy.ai. Detalhes: ${txt}`
        );
      }
      throw new Error(`Pluggy GET ${path} (${res.status}): ${txt}`);
    }
    return res.json();
  }

  async getConnectToken() {
    const res = await fetch(`${PLUGGY_BASE}/connect_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: this.clientId, clientSecret: this.clientSecret }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Pluggy connect_token falhou (${res.status}): ${txt}`);
    }
    const data = await res.json();
    return data.accessToken ?? data.connectToken ?? data.token;
  }

  async getItems() {
    const data = await this._get('/items');
    return data.results ?? [];
  }

  async getAccounts(itemId) {
    const data = await this._get('/accounts', { itemId });
    return data.results ?? [];
  }

  async getTransactions(accountId, _opts = {}) {
    const results = [];
    let cursor = null;
    do {
      const params = { accountId };
      if (cursor) params.cursor = cursor;
      const data = await this._get('/v2/transactions', params);
      results.push(...(data.results ?? []));
      cursor = data.nextCursor ?? null;
    } while (cursor && results.length < 1000);
    return results;
  }

  async getIdentity(itemId) {
    try {
      return await this._get('/identity', { itemId });
    } catch {
      return null;
    }
  }

  async getInvestments(itemId) {
    try {
      const data = await this._get('/investments', { itemId });
      return data.results ?? [];
    } catch {
      return [];
    }
  }
}
