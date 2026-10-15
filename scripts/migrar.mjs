// Aplica supabase/migrations/*.sql que ainda não rodaram, em ordem, via
// /pg/query do gateway (postgres-meta). Cada arquivo roda numa transação.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrar.mjs
//   node scripts/migrar.mjs --sql "select 1"     (consulta avulsa)
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

async function query(sql) {
  const r = await fetch(`${url}/pg/query`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${body}`);
  return JSON.parse(body);
}

const i = process.argv.indexOf('--sql');
if (i !== -1) {
  console.log(JSON.stringify(await query(process.argv[i + 1]), null, 2));
  process.exit(0);
}

await query(`create table if not exists public._migracao (
  nome text primary key, "aplicadaEm" timestamptz not null default now())`);
const feitas = new Set((await query('select nome from public._migracao')).map((r) => r.nome));

const dir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', 'supabase', 'migrations');
const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

for (const f of arquivos) {
  if (feitas.has(f)) continue;
  const sql = fs.readFileSync(path.join(dir, f), 'utf8');
  const nome = f.replace(/'/g, "''");
  process.stdout.write(`aplicando ${f}... `);
  await query(`begin;\n${sql}\n;insert into public._migracao (nome) values ('${nome}');\ncommit;`);
  console.log('ok');
}
console.log('migrações em dia');
