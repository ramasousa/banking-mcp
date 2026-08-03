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
    this._apiKey = data.apiKey;
    this._keyExpiry = Date.now() + 110 * 60 * 1000; // 110 min (buffer de 10 min)
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
      throw new Error(`Pluggy GET ${path} (${res.status}): ${txt}`);
    }
    return res.json();
  }

  async getItems() {
    const data = await this._get('/items');
    return data.results ?? [];
  }

  async getAccounts(itemId) {
    const data = await this._get('/accounts', { itemId });
    return data.results ?? [];
  }

  async getTransactions(accountId, { from, to, pageSize = 500 } = {}) {
    const data = await this._get('/transactions', { accountId, from, to, pageSize });
    return data.results ?? [];
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
