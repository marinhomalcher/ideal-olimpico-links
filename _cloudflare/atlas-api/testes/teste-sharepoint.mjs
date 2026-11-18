// Teste de conexão com o SharePoint dos resultados (ADM): chave, permissão, gravar, link temporário, ler e apagar.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const worker = (await import(new URL('../worker.js?' + Date.now(), import.meta.url).href)).default;
const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'OK  ' : 'FALHOU', name, String(extra).slice(0, 200)]);

const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync(REPO + '_cloudflare/atlas-api/schema.sql', 'utf8'));
function stmt(sql, args = []) {
  return {
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) })
  };
}
const SITE = 'grupoideal.sharepoint.com,606621f7-db7d-46ab-a0da-1c6200e3a14d,4602c978-fb0c-4bfc-9e55-0d502aee359c';
const env = {
  ATLAS_HOJE_TESTE: '2026-11-13', DB: { prepare: sql => stmt(sql), batch: async l => { for (const s of l) await s.run(); } },
  ADMIN_EMAIL: 'adm@example.com', MS_TENANT_ID: 'tenant-teste', MS_CLIENT_ID: 'cliente-teste', MS_REMETENTE: 'olimpiadas@grupoideal.com.br',
  MS_CLIENT_SECRET: 'segredo-ms-teste', SHAREPOINT_SITE: SITE
};
for (const [t, tipo] of [['adm-token', 'adm'], ['user-token', 'usuario']]) db.prepare('INSERT INTO sessoes (token_hash, tipo, email, usuario_id, expira_em) VALUES (?, ?, ?, ?, ?)')
  .run(createHash('sha256').update(t).digest('hex'), tipo, tipo === 'adm' ? 'adm@example.com' : 'prof@grupoideal.com.br', null, '2099-01-01T00:00:00Z');

/* Microsoft falsa: token com "roles", site, drive (gravar, ler por link, apagar). */
const ms = { papeis: ['Mail.Send', 'Sites.Selected'], gravar: 201, arquivos: new Map(), pedidos: [] };
const tokenFalso = () => 'x.' + Buffer.from(JSON.stringify({ roles: ms.papeis })).toString('base64url') + '.y';
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); ms.pedidos.push((opts.method || 'GET') + ' ' + u);
  if (u.startsWith('https://login.microsoftonline.com/')) return new Response(JSON.stringify({ access_token: tokenFalso(), expires_in: 3599 }), { status: 200 });
  if (u.startsWith('https://download.sharepoint.test/')) { const id = u.split('/').pop(); return ms.arquivos.has(id) ? new Response(ms.arquivos.get(id)) : new Response('', { status: 404 }); }
  const g = 'https://graph.microsoft.com/v1.0/sites/' + encodeURIComponent(SITE);
  if (u === g + '?$select=id,displayName,webUrl') return new Response(JSON.stringify({ id: SITE, displayName: 'Resultados IDEAL OLÍMPICO', webUrl: 'https://grupoideal.sharepoint.com/sites/ResultadosIDEALOLMPICO' }));
  if (u.startsWith(g + '/drive/root:/ATLAS-teste/') && opts.method === 'PUT') {
    if (ms.gravar !== 201) return new Response(JSON.stringify({ error: { code: 'accessDenied', message: 'Access denied' } }), { status: ms.gravar });
    const id = 'item' + ms.arquivos.size; ms.arquivos.set(id, String(opts.body)); return new Response(JSON.stringify({ id }), { status: 201 });
  }
  const mi = u.match(/\/drive\/items\/([^?]+)(\?.*)?$/);
  if (mi && opts.method === 'DELETE') { ms.arquivos.delete(decodeURIComponent(mi[1])); return new Response(null, { status: 204 }); }
  if (mi) return new Response(JSON.stringify({ id: mi[1], '@microsoft.graph.downloadUrl': 'https://download.sharepoint.test/' + decodeURIComponent(mi[1]) }));
  throw new Error('fetch inesperado: ' + u);
};
async function testar(token = 'adm-token') {
  db.exec('DELETE FROM login_rate_limits');
  const res = await worker.fetch(new Request('https://atlas-api.test/api/adm/sharepoint/teste', { method: 'POST', headers: { Origin: 'https://idealolimpico.com.br', Authorization: 'Bearer ' + token } }), env, { waitUntil() {} });
  return { status: res.status, data: await res.json() };
}

let r = await testar();
const etapas = r.data.teste?.etapas || [];
ok('Teste completo passa: chave, permissão, site, gravar, link, ler e apagar', r.status === 200 && r.data.teste.ok && etapas.length === 7 && etapas.every(e => e.ok), JSON.stringify(etapas.map(e => e.etapa + ':' + e.ok)));
ok('Mostra as permissões da chave e o nome do site', /Sites\.Selected/.test(etapas[0]?.detalhe) && /Resultados IDEAL OLÍMPICO/.test(etapas[2]?.detalhe));
ok('Arquivo de teste é apagado no fim', ms.arquivos.size === 0);
ms.papeis = ['Mail.Send']; ms.pedidos = [];
r = await testar();
ok('Sem Sites.Selected aprovado: para e explica o que a TI precisa fazer', r.status === 200 && !r.data.teste.ok && /consentimento do administrador/.test(r.data.teste.etapas.at(-1).detalhe) && !ms.pedidos.some(p => p.includes('/drive/')), JSON.stringify(r.data.teste.etapas.at(-1)));
ms.papeis = ['Mail.Send', 'Sites.Selected']; ms.gravar = 403; ms.pedidos = [];
r = await testar();
ok('Sem escrita no site: mostra o erro da Microsoft e não tenta apagar', !r.data.teste.ok && /403 accessDenied/.test(r.data.teste.etapas.at(-1).detalhe) && !ms.pedidos.some(p => p.startsWith('DELETE')), JSON.stringify(r.data.teste.etapas.at(-1)));
ms.gravar = 201;
r = await testar('user-token');
ok('Só o ADM roda o teste', r.status === 401 || r.status === 403, r.status);
delete env.SHAREPOINT_SITE;
r = await testar();
ok('Sem o site configurado: avisa sem chamar a Microsoft', !r.data.teste.ok && /SHAREPOINT_SITE/.test(r.data.teste.etapas[0].detalhe));
env.SHAREPOINT_SITE = SITE;
const toml = fs.readFileSync(REPO + '_cloudflare/atlas-api/wrangler.toml', 'utf8');
ok('wrangler.toml traz o id do site', toml.includes('SHAREPOINT_SITE = "' + SITE + '"'));

for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK  ').length;
console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`);
process.exit(bad ? 1 : 0);
