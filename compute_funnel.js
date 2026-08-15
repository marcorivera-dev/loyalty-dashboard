/**
 * Lee los datos crudos de clientes/recibos que dejo fetch_loyverse_data.js en
 * una carpeta TEMPORAL del sistema (no en el proyecto), calcula las 4 etapas
 * del embudo de activacion, y escribe SOLO el resultado agregado en
 * data/funnel.json -- ese si es seguro tenerlo en el repo, son conteos, no
 * datos de clientes. Al terminar (exito o error) borra la carpeta temporal
 * completa, para no dejar el export crudo de clientes/recibos viviendo en
 * disco. No pega a ninguna API -- 100% local.
 *
 * Definiciones (ver conversacion — todo en hora America/Mexico_City):
 *   Registrados            -- todos los clientes en Loyverse.
 *   Activados               -- >=1 compra identificada despues del registro
 *                              (incluye compras el mismo dia del registro,
 *                              que suelen ser el cobro del $20 de bienvenida).
 *   Regresaron dia distinto -- >=1 compra identificada en un dia calendario
 *                              DISTINTO al del registro (senal real de retorno).
 *   Recurrentes             -- >=2 dias distintos al del registro con compra
 *                              (subconjunto real de "regresaron dia distinto",
 *                              a diferencia de contar recibos, donde 3 compras
 *                              el mismo dia contarian como "recurrente" sin serlo).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const RAW_DIR = path.join(os.tmpdir(), 'smoosh-loyalty-dashboard-raw'); // mismo path que usa fetch_loyverse_data.js
const OUTPUT_DIR = path.join(__dirname, 'data'); // lo unico que persiste en el proyecto: funnel.json (agregado, sin PII)

const customersPath = path.join(RAW_DIR, 'loyverse_customers.json');
const receiptsPath = path.join(RAW_DIR, 'loyverse_receipts.json');

if (!fs.existsSync(customersPath) || !fs.existsSync(receiptsPath)) {
  console.error(`Falta ${customersPath} o ${receiptsPath}.`);
  console.error('Corre primero: railway run -- node fetch_loyverse_data.js');
  process.exit(1);
}

const customers = JSON.parse(fs.readFileSync(customersPath, 'utf8'));
const receipts = JSON.parse(fs.readFileSync(receiptsPath, 'utf8'));

const TZ = 'America/Mexico_City';
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
function localDay(iso) { return dayFormatter.format(new Date(iso)); }

const receiptsByCustomer = new Map();
for (const r of receipts) {
  if (!r.customer_id) continue;
  if (!receiptsByCustomer.has(r.customer_id)) receiptsByCustomer.set(r.customer_id, []);
  receiptsByCustomer.get(r.customer_id).push(r.receipt_date);
}
for (const arr of receiptsByCustomer.values()) arr.sort();

let activados = 0;
let regresaronDiaDistinto = 0;
let recurrentes = 0;

for (const c of customers) {
  const regDay = localDay(c.created_at);
  const postRegDates = (receiptsByCustomer.get(c.id) ?? []).filter((d) => d > c.created_at);

  if (postRegDates.length >= 1) activados++;

  const diasDistintosSinRegistro = new Set(
    postRegDates.map(localDay).filter((d) => d !== regDay)
  );

  if (diasDistintosSinRegistro.size >= 1) regresaronDiaDistinto++;
  if (diasDistintosSinRegistro.size >= 2) recurrentes++;
}

const registrados = customers.length;

const stages = [
  { key: 'registrados', label: 'Registrados', count: registrados },
  { key: 'activados', label: 'Activados (>=1 compra)', count: activados },
  { key: 'regresaron_dia_distinto', label: 'Regresaron en día distinto', count: regresaronDiaDistinto },
  { key: 'recurrentes', label: 'Recurrentes (>=2 días distintos)', count: recurrentes },
];

for (let i = 0; i < stages.length; i++) {
  stages[i].pctOfTotal = registrados > 0 ? +(100 * stages[i].count / registrados).toFixed(1) : 0;
  stages[i].pctOfPrevious = i === 0 ? null : (stages[i - 1].count > 0 ? +(100 * stages[i].count / stages[i - 1].count).toFixed(1) : 0);
  stages[i].dropFromPrevious = i === 0 ? null : stages[i - 1].count - stages[i].count;
}

const output = {
  generatedAt: new Date().toISOString(),
  sourceDataFetchedAt: (() => {
    try { return JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'cache_meta.json'), 'utf8')).fetchedAt; }
    catch { return null; }
  })(),
  stages,
};

try {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'funnel.json'), JSON.stringify(output, null, 2));
  console.log('Escrito data/funnel.json');
  console.log(JSON.stringify(output, null, 2));
} finally {
  // Pase lo que pase arriba, no dejar el export crudo de clientes/recibos
  // viviendo en disco.
  fs.rmSync(RAW_DIR, { recursive: true, force: true });
  console.log(`\nDatos crudos temporales borrados (${RAW_DIR}).`);
}
