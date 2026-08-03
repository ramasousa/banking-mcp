// ingest.js — Indexa a knowledge base MEI/EI no Qdrant via Voyage AI
// Uso: node ingest.js
// Variáveis de ambiente necessárias:
//   VOYAGE_API_KEY   — voyageai.com
//   QDRANT_URL       — cloud.qdrant.io (ex: https://xxx.aws.cloud.qdrant.io)
//   QDRANT_API_KEY   — token do cluster Qdrant

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const QDRANT_URL     = (process.env.QDRANT_URL || '').trim();
const QDRANT_API_KEY = (process.env.QDRANT_API_KEY || '').trim();
const COLLECTION     = 'mei-kb';
const VOYAGE_MODEL   = 'voyage-3-lite'; // 512 dims, 50M tokens/mês grátis
const VECTOR_SIZE    = 512;
const KB_DIR         = join(__dirname, '..', 'knowledge');
const BATCH_SIZE     = 5;  // free tier Voyage: 3 RPM, 10K TPM → ~5 chunks/req com delay

if (!VOYAGE_API_KEY || !QDRANT_URL || !QDRANT_API_KEY) {
  console.error('Erro: defina VOYAGE_API_KEY, QDRANT_URL e QDRANT_API_KEY.');
  process.exit(1);
}

// ── 1. Lê todos os .txt da knowledge base ────────────────────────
function walkDir(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walkDir(full));
    else if (entry.endsWith('.txt')) files.push(full);
  }
  return files;
}

function chunkText(text, maxChars = 1200) {
  // Divide por parágrafo duplo; fragmentos maiores que maxChars são subdivididos.
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let current = '';
  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (!trimmed || trimmed.length < 40) continue; // ignora linhas muito curtas
    if ((current + '\n\n' + trimmed).length > maxChars && current) {
      chunks.push(current.trim());
      current = trimmed;
    } else {
      current = current ? current + '\n\n' + trimmed : trimmed;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

console.log('📂 Lendo knowledge base...');
const files = walkDir(KB_DIR);
console.log(`   ${files.length} arquivos encontrados`);

const documents = [];
for (const filePath of files) {
  const text = readFileSync(filePath, 'utf8');
  const relPath = relative(KB_DIR, filePath);
  const category = relPath.split('/')[0]; // legislacao | operacional | migracao | pratico
  const chunks = chunkText(text);
  for (let i = 0; i < chunks.length; i++) {
    documents.push({
      text: chunks[i],
      source: relPath,
      category,
      chunk: i,
    });
  }
}
console.log(`   ${documents.length} chunks gerados\n`);

// ── 2. Cria a coleção no Qdrant (idempotente) ─────────────────────
async function qdrantReq(path, method = 'GET', body = null) {
  const res = await fetch(`${QDRANT_URL}${path}`, {
    method,
    headers: {
      'api-key': QDRANT_API_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Qdrant ${method} ${path} → ${res.status}: ${txt}`);
  }
  return res.json();
}

console.log('🗄️  Criando coleção no Qdrant...');
try {
  await qdrantReq(`/collections/${COLLECTION}`, 'PUT', {
    vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
  });
  console.log(`   Coleção "${COLLECTION}" criada\n`);
} catch (err) {
  if (err.message.includes('already exists') || err.message.includes('409')) {
    console.log(`   Coleção "${COLLECTION}" já existe — reutilizando\n`);
  } else {
    throw err;
  }
}

// ── 3. Gera embeddings via Voyage AI em batches ───────────────────
const RATE_LIMIT_DELAY = 21000; // 21s entre batches → respeita 3 RPM do free tier

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function embedBatch(texts, attempt = 1) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: VOYAGE_MODEL, input: texts, input_type: 'document' }),
  });
  if (res.status === 429 && attempt <= 3) {
    const wait = RATE_LIMIT_DELAY * attempt;
    console.log(`   Rate limit atingido, aguardando ${wait / 1000}s...`);
    await sleep(wait);
    return embedBatch(texts, attempt + 1);
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Voyage AI → ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}

const totalBatches = Math.ceil(documents.length / BATCH_SIZE);
const estimatedMinutes = Math.ceil((totalBatches * RATE_LIMIT_DELAY) / 60000);
console.log(`🧠 Gerando embeddings via Voyage AI (free tier — ~${estimatedMinutes} min)...`);
const allEmbeddings = [];
for (let i = 0; i < documents.length; i += BATCH_SIZE) {
  const batch = documents.slice(i, i + BATCH_SIZE);
  if (i > 0) await sleep(RATE_LIMIT_DELAY); // aguarda entre batches
  const vectors = await embedBatch(batch.map((d) => d.text));
  allEmbeddings.push(...vectors);
  console.log(`   ${Math.min(i + BATCH_SIZE, documents.length)}/${documents.length} chunks processados`);
}
console.log('');

// ── 4. Upsert dos pontos no Qdrant ────────────────────────────────
console.log('⬆️  Indexando no Qdrant...');
const points = documents.map((doc, idx) => ({
  id: idx + 1,
  vector: allEmbeddings[idx],
  payload: {
    text: doc.text,
    source: doc.source,
    category: doc.category,
    chunk: doc.chunk,
  },
}));

// Upsert em lotes de 100
for (let i = 0; i < points.length; i += 100) {
  const batch = points.slice(i, i + 100);
  await qdrantReq(`/collections/${COLLECTION}/points`, 'PUT', { points: batch });
  console.log(`   ${Math.min(i + 100, points.length)}/${points.length} pontos indexados`);
}

console.log(`\n✅ Concluído! ${points.length} chunks indexados na coleção "${COLLECTION}".`);
console.log(`   Qdrant: ${QDRANT_URL}/dashboard#/collections/${COLLECTION}`);
