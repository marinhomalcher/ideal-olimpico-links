import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const worker = (await import('../worker.js')).default;
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(repo + '_cloudflare/atlas-api/schema.sql', 'utf8'));
const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'OK' : 'FALHOU', name, String(extra)]);
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }) };
}
const env = { DB: { prepare: sql => stmt(sql), batch: async ops => Promise.all(ops.map(x => x.run())) }, ADMIN_EMAIL: 'adm@example.com', ATLAS_HOJE_TESTE: '2026-11-14' };
function sessao(token, tipo, email, id = null) { db.prepare('INSERT INTO sessoes (token_hash, tipo, email, usuario_id, expira_em) VALUES (?, ?, ?, ?, ?)').run(createHash('sha256').update(token).digest('hex'), tipo, email, id, '2099-01-01T00:00:00Z'); }
sessao('adm-token', 'adm', 'adm@example.com');
const origin = 'https://idealolimpico.com.br';
async function api(path, method = 'GET', body, token = 'adm-token') {
  const r = await worker.fetch(new Request('https://atlas-api.example' + path, { method, headers: { Origin: origin, Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: r.status, data: await r.json() };
}
ok('Schema 11', db.prepare("SELECT valor FROM meta WHERE chave='schema_versao'").get().valor === '11');
let r = await api('/api/adm/redacao/turmas');
ok('15 turmas iniciais', r.status === 200 && r.data.turmas.length === 15, r.data.turmas?.length);
const primeira = r.data.turmas.find(x => x.unidade === 'BC' && x.codigo === '1EMA');
r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Professora Exemplo', email: 'prof@grupoideal.com.br', funcao: 'professor', turmas: [primeira.id] });
ok('Cadastro de professora e turma', r.status === 200 && r.data.equipe[0].turmas[0] === primeira.id, r.data.error);
const profId = r.data.equipe[0].id;
r = await api('/api/adm/redacao/equipe/' + profId, 'PUT', { nome: 'Professora Exemplo', email: 'prof@grupoideal.com.br', funcao: 'professor', ativo: true, turmas: [primeira.id] });
ok('ADM edita vínculos da professora', r.status === 200 && r.data.equipe[0].turmas.includes(primeira.id), r.data.error);
sessao('prof-token', 'usuario', 'prof@grupoideal.com.br', profId);
r = await api('/api/redacao/sessao', 'GET', undefined, 'prof-token');
ok('Professora vê somente sua turma', r.status === 200 && r.data.usuario.turmas.length === 1 && r.data.usuario.funcao === 'professor', r.data.error);
r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Digitalizador Exemplo', email: 'digital@grupoideal.com.br', funcao: 'digitalizador', unidades: ['BC', 'CN'] });
ok('Cadastro de digitalizador e unidades', r.status === 200 && r.data.equipe.some(x => x.funcao === 'digitalizador' && x.unidades.length === 2), r.data.error);
const digId = r.data.equipe.find(x => x.funcao === 'digitalizador').id;
sessao('dig-token', 'usuario', 'digital@grupoideal.com.br', digId);
r = await api('/api/redacao/sessao', 'GET', undefined, 'dig-token');
ok('Digitalizador vê unidades permitidas', r.status === 200 && r.data.usuario.unidades.join(',') === 'BC,CN', r.data.error);
r = await api('/api/adm/redacao/turmas', 'GET', undefined, 'prof-token');
ok('Professora não acessa cadastros ADM', r.status === 401);
const rows = [
  { ra: '12345', nome: 'Aluna Um', unidade: 'BC', segmento: 'EM', serie: '1ª Série', codigo: '1EMA' },
  { ra: '12346', nome: 'Aluno Dois', unidade: 'AM', segmento: 'EM', serie: '1ª Série', codigo: '1MED' }
];
r = await api('/api/adm/redacao/alunos/previa', 'POST', { ano: 2026, alunos: rows });
ok('Prévia identifica alunos e nova turma', r.status === 200 && r.data.novos === 2 && r.data.novas_turmas.length === 1, r.data.error);
r = await api('/api/adm/redacao/alunos/importar', 'POST', { ano: 2026, alunos: rows });
ok('Importação cria alunos e turma', r.status === 200 && db.prepare('SELECT COUNT(*) AS n FROM redacao_alunos').get().n === 2 && db.prepare("SELECT COUNT(*) AS n FROM redacao_turmas WHERE unidade='AM' AND codigo='1MED'").get().n === 1, r.data.error);
r = await api('/api/adm/redacao/alunos/importar', 'POST', { ano: 2026, alunos: rows });
ok('Reenvio da mesma planilha não duplica alunos', r.status === 200 && r.data.novos === 0 && r.data.atualizados === 0, r.data.error);
const moved = rows.map(x => ({ ...x }));moved[0].codigo = '1MED';
r = await api('/api/adm/redacao/alunos/previa', 'POST', { ano: 2026, alunos: moved });
ok('Mudança de turma aparece na prévia', r.status === 200 && r.data.atualizados === 1 && r.data.mudancas[0].ra === '12345', r.data.error);
r = await api('/api/adm/redacao/alunos/importar', 'POST', { ano: 2026, alunos: moved });
ok('Mudança de turma atualiza o RA', r.status === 200 && db.prepare("SELECT t.codigo FROM redacao_alunos a JOIN redacao_turmas t ON t.id=a.turma_id WHERE a.ra='12345'").get().codigo === '1MED', r.data.error);
const invalid = moved.map(x => ({ ...x }));invalid[0].serie = '2ª Série';
r = await api('/api/adm/redacao/alunos/previa', 'POST', { ano: 2026, alunos: invalid });
ok('Mudança de série fica bloqueada', r.status === 200 && r.data.conflitos.length === 1, r.data.error);
r = await api('/api/adm/redacao/alunos/importar', 'POST', { ano: 2026, alunos: invalid });
ok('Importação com conflito não altera banco', r.status === 409 && db.prepare("SELECT serie FROM redacao_alunos WHERE ra='12345'").get().serie === '1ª Série', r.data.error);
r = await api('/api/adm/redacao/alunos/previa', 'POST', { ano: 2026, alunos: [rows[0], rows[0]] });
ok('RA repetido na planilha é recusado', r.status === 400, r.data.error);
r = await api('/api/adm/redacao/alunos?turma_id=' + primeira.id);
ok('ADM consulta alunos da turma', r.status === 200 && Array.isArray(r.data.alunos), r.data.error);
const atlas = repo + 'atlas/';
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!/^[a-z0-9.-]+$/i.test(name) || !fs.existsSync(atlas + name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.json') ? 'application/json' : 'image/png');
  res.end(fs.readFileSync(atlas + name));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.goto(base + '/index.html');
ok('Página inicial mostra Redação', await page.locator('[data-role="Redação"]').isVisible());
await page.locator('[data-role="Redação"]').click();
ok('Redação abre login institucional', await page.locator('#overlay.open #email-step').isVisible());
await page.route('https://atlas-api.marinhomalcher.workers.dev/**', async route => {
  const path = new URL(route.request().url()).pathname;
  const body = path === '/api/adm/sessao' ? { ok: true, email: 'adm@example.com' }
    : path === '/api/adm/redacao/turmas' ? { ok: true, ano: 2026, turmas: (await api('/api/adm/redacao/turmas')).data.turmas }
    : path === '/api/adm/redacao/equipe' ? { ok: true, equipe: (await api('/api/adm/redacao/equipe')).data.equipe }
    : { ok: false, error: 'Rota não simulada.' };
  await route.fulfill({ status: body.ok ? 200 : 404, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' }, body: JSON.stringify(body) });
});
await page.goto(base + '/redacao-admin.html');
await page.evaluate(() => sessionStorage.setItem('atlas_adm_token', 'adm-token'));
await page.reload();
await page.locator('#app').waitFor({ state: 'visible' });
ok('ADM vê turmas e cadastros da Redação', await page.locator('#turmas-lista tr').count() === 16 && await page.locator('[data-tab="equipe"]').isVisible());
await page.locator('[data-tab="equipe"]').click();
ok('ADM escolhe turmas para professor', await page.locator('[name="prof-turma"]').count() === 16);
await page.locator('#equipe-funcao').selectOption('digitalizador');
ok('ADM escolhe unidades para digitalizador', await page.locator('[name="dig-unidade"]').count() === 3 && await page.locator('#digitalizador-choices').isVisible());
ok('Sem erro JavaScript nas telas', errors.length === 0, errors.join(' | '));
await browser.close();
await new Promise(resolve => server.close(resolve));
const passed = results.filter(x => x[0] === 'OK').length;
for (const x of results) console.log(x[0].padEnd(7), x[1], x[2]);
console.log(passed === results.length ? `TODOS: ${passed} verificações passaram` : `FALHOU: ${results.length - passed} falha(s) em ${results.length} verificações`);
if (passed !== results.length) process.exitCode = 1;
