/**
 * Trae TODOS los clientes y TODOS los recibos de Loyverse (desde el registro
 * mas antiguo) y los guarda en una carpeta TEMPORAL del sistema (no en el
 * proyecto) -- son datos personales de clientes reales (email, historial de
 * compras) y no deben quedar viviendo en disco de forma permanente. Los lee
 * compute_funnel.js desde ahi, calcula el embudo (que si es seguro guardar,
 * son solo conteos agregados) y borra estos archivos crudos al terminar.
 *
 * No se llama automaticamente desde compute_funnel.js -- correr ambos a mano
 * en secuencia cuando se quieran datos frescos:
 *
 *   railway run --service smoosh-inventario -- node fetch_loyverse_data.js
 *   node compute_funnel.js
 *
 * (desde dentro de smoosh-inventario/, o con -p/-e si el proyecto no esta
 * linkeado en este directorio)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const token = process.env.LOYVERSE_TOKEN;
if (!token) {
  console.error('LOYVERSE_TOKEN no presente en el entorno. Corre esto con `railway run -- node fetch_loyverse_data.js`.');
  process.exit(1);
}

// Carpeta temporal del sistema, NO dentro del proyecto -- ver nota arriba.
const DATA_DIR = path.join(os.tmpdir(), 'smoosh-loyalty-dashboard-raw');

async function fetchWithBackoff(url, attempt = 1) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt > 5) throw new Error(`Fallo persistente HTTP ${res.status}`);
    const waitMs = 1000 * 2 ** (attempt - 1);
    console.error(`  HTTP ${res.status}, reintentando en ${waitMs}ms...`);
    await new Promise((r) => setTimeout(r, waitMs));
    return fetchWithBackoff(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getAllCustomers() {
  const all = [];
  let cursor = null;
  let page = 0;
  do {
    page++;
    const params = new URLSearchParams({ limit: '250' });
    if (cursor) params.set('cursor', cursor);
    const data = await fetchWithBackoff(`https://api.loyverse.com/v1.0/customers?${params}`);
    all.push(...(data.customers ?? []));
    console.error(`  clientes pagina ${page}: acumulado ${all.length}`);
    cursor = data.cursor ?? null;
    if (cursor) await new Promise((r) => setTimeout(r, 250));
  } while (cursor);
  return all;
}

async function getReceiptsSince(cutoffIso) {
  const receipts = [];
  let cursor = null;
  let page = 0;
  let stop = false;
  while (!stop) {
    page++;
    const params = new URLSearchParams({ limit: '250' });
    if (cursor) params.set('cursor', cursor);
    const data = await fetchWithBackoff(`https://api.loyverse.com/v1.0/receipts?${params}`);
    const pageReceipts = data.receipts ?? [];
    if (pageReceipts.length === 0) break;

    for (const r of pageReceipts) {
      if (r.cancelled_at != null) continue; // cancelaciones no cuentan como actividad
      if (r.refund_for != null) continue;   // reembolsos no cuentan como "el cliente volvio"
      if (r.receipt_date < cutoffIso) { stop = true; break; }
      receipts.push({
        receipt_number: r.receipt_number,
        receipt_date: r.receipt_date,
        customer_id: r.customer_id,
        total_money: r.total_money,
      });
    }
    console.error(`  recibos pagina ${page}: acumulado ${receipts.length}`);
    cursor = data.cursor ?? null;
    if (!cursor) break;
    if (!stop) await new Promise((r) => setTimeout(r, 250));
  }
  return receipts;
}

(async () => {
  console.error('Trayendo clientes...');
  const customers = await getAllCustomers();
  const minCreated = customers.reduce((min, c) => (c.created_at < min ? c.created_at : min), customers[0].created_at);
  console.error(`Total clientes: ${customers.length}, registro mas antiguo: ${minCreated}`);

  console.error('\nTrayendo recibos...');
  const receipts = await getReceiptsSince(minCreated.slice(0, 10));
  console.error(`Total recibos (excl. cancelados/reembolsos): ${receipts.length}`);

  const slimCustomers = customers.map((c) => ({
    id: c.id,
    email: c.email,
    created_at: c.created_at,
    note: c.note,
  }));

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'loyverse_customers.json'), JSON.stringify(slimCustomers));
  fs.writeFileSync(path.join(DATA_DIR, 'loyverse_receipts.json'), JSON.stringify(receipts));
  fs.writeFileSync(
    path.join(DATA_DIR, 'cache_meta.json'),
    JSON.stringify({ fetchedAt: new Date().toISOString(), customerCount: customers.length, receiptCount: receipts.length }, null, 2)
  );

  console.error(`\nGuardado temporalmente en ${DATA_DIR} — corre "node compute_funnel.js" ahora para calcular el embudo; ese script borra estos archivos crudos al terminar.`);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
