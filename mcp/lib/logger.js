// Logger compartilhado — escreve JSON no console (capturado pelo Render)
// e envia para o Axiom quando AXIOM_TOKEN está configurado.
//
// Variáveis de ambiente:
//   AXIOM_TOKEN    — token de ingestão gerado em app.axiom.co → Settings → API tokens
//   AXIOM_DATASET  — nome do dataset (padrão: "banking-mcp")

let axiom = null;
const AXIOM_DATASET = process.env.AXIOM_DATASET || 'banking-mcp';

if (process.env.AXIOM_TOKEN) {
  import('@axiomhq/js')
    .then(({ Axiom }) => {
      axiom = new Axiom({ token: process.env.AXIOM_TOKEN });
      console.log(`[logger] Axiom conectado → dataset: ${AXIOM_DATASET}`);
    })
    .catch((err) => {
      console.warn('[logger] Axiom indisponível (logs apenas no console):', err.message);
    });
}

export function log(level, event, data = {}) {
  const entry = { ts: new Date().toISOString(), level, event, ...data };
  console.log(JSON.stringify(entry));
  if (axiom) {
    axiom.ingest(AXIOM_DATASET, [entry]).catch(() => {});
  }
}
