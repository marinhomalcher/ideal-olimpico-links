// Cadastros e funções: cadastro único de pessoas com várias funções. Dados fictícios.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const S = (process.env.ATLAS_TESTE_TMP || '/tmp/atlas-testes') + '/';
const PDFJS = S + 'pdfjs/package/build/';
const worker = (await import('../worker.js')).default;
const { r2Rigoroso } = await import('./r2-cloudflare.mjs');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(fs.readFileSync(repo + '_cloudflare/atlas-api/schema.sql', 'utf8'));
const results = [];
function ok(name, cond, extra = '') { results.push([cond ? 'OK' : 'FALHOU', name, String(extra)]); }
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }) };
}
const objetos = new Map();
const env = {
  DB: { prepare: sql => stmt(sql), batch: async ops => Promise.all(ops.map(x => x.run())) },
  ADMIN_EMAIL: 'adm@example.com', ATLAS_HOJE_TESTE: '2026-11-13',
  IMAGENS: r2Rigoroso(objetos)
};
function sessao(token, tipo, email, id = null) {
  db.prepare('INSERT INTO sessoes (token_hash, tipo, email, usuario_id, expira_em) VALUES (?, ?, ?, ?, ?)')
    .run(createHash('sha256').update(token).digest('hex'), tipo, email, id, '2099-01-01T00:00:00Z');
}
sessao('adm-token', 'adm', 'adm@example.com');
async function api(path, method = 'GET', body, token = 'adm-token', contentType = 'application/json') {
  const headers = { Origin: 'https://idealolimpico.com.br', Authorization: 'Bearer ' + token };
  if (body !== undefined) headers['Content-Type'] = contentType;
  if (Buffer.isBuffer(body)) headers['Content-Length'] = String(body.length);   /* como o navegador faz */
  const request = new Request('https://atlas-api.example' + path, {
    method, headers, body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body
  });
  const response = await worker.fetch(request, env, { waitUntil() {} });
  return { status: response.status, data: response.headers.get('Content-Type')?.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()), headers: response.headers };
}

// ---------- servidor local das telas e navegador ----------
const atlas = repo + 'atlas/';
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!/^[a-z0-9.-]+$/i.test(name) || !fs.existsSync(atlas + name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : 'image/png');
  res.end(fs.readFileSync(atlas + name));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/**', route => {
  const nome = new URL(route.request().url()).pathname.split('/').pop();
  let body = fs.readFileSync(PDFJS + nome);
  route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body });
});
await page.route('https://accounts.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.google={accounts:{id:{initialize(){},renderButton(){},disableAutoSelect(){}}}}' }));
await page.route('https://atlas-api.marinhomalcher.workers.dev/**', async route => {
  const req = route.request(), u = new URL(req.url()), type = req.headers()['content-type'], body = req.postDataBuffer();
  const token = (req.headers()['authorization'] || '').replace(/^Bearer /i, '');
  const result = await api(u.pathname + u.search, req.method(), body && type === 'application/json' ? JSON.parse(body.toString()) : body || undefined, token, type || 'application/json');
  await route.fulfill({ status: result.status, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Content-Type': result.headers.get('Content-Type') || 'application/json' }, body: Buffer.isBuffer(result.data) ? result.data : JSON.stringify(result.data) });
});

const turmas = (await api('/api/adm/redacao/turmas')).data.turmas;
const bc3 = turmas.find(t => t.unidade === 'BC' && t.codigo === '3EMA'), cn1 = turmas.find(t => t.unidade === 'CN' && t.codigo === '1EMA');
let r;
// ---------- API ----------
r = await api('/api/adm/pessoas', 'POST', { nome: 'Ana Multi', email: 'ana.multi', banco: { tipo: 'professor', disciplina: 'Matemática', classificador: true },
  redacao: { professor: { turmas: [bc3.id] }, digitalizador: { unidades: ['BC', 'CN'] } }, coordenacao: [{ unidade: 'BC', segmento: 'EM', serie: '3ª Série' }] });
const ana = r.data.pessoas?.find(p => p.email === 'ana.multi@grupoideal.com.br');
ok('Cria pessoa com várias funções (banco + prof. redação + digitalizador + coordenador)', r.status === 200 && ana && ana.disciplina === 'Matemática' && ana.classificador && ana.redacao.professor && ana.redacao.digitalizador &&
  ana.redacao.turmas[0] === bc3.id && ana.redacao.unidades.join() === 'BC,CN' && ana.coordenacao.length === 1, JSON.stringify(r.data.error || ana));
sessao('ana-token', 'usuario', 'ana.multi@grupoideal.com.br', ana.id);
r = await api('/api/redacao/sessao', 'GET', undefined, 'ana-token');
ok('Login da Redação devolve as duas funções, turmas e unidades', r.status === 200 && r.data.usuario.funcoes.join() === 'professor,digitalizador' && r.data.usuario.turmas.length === 1 && r.data.usuario.unidades.length === 2, JSON.stringify(r.data));
r = await api('/api/redacao/lotes', 'GET', undefined, 'ana-token');
ok('Como digitalizadora, vê as turmas das unidades dela', r.status === 200 && r.data.turmas.every(t => ['BC', 'CN'].includes(t.unidade)));
r = await api('/api/redacao/correcao/turmas', 'GET', undefined, 'ana-token');
ok('Como professora de redação, entra na correção da turma dela', r.status === 200 && r.data.turmas.length === 1 && r.data.turmas[0].id === bc3.id, r.status);
r = await api('/api/adm/pessoas', 'POST', { nome: 'Duas Turmas', email: 'duas.turmas', redacao: { professor: { turmas: [bc3.id, cn1.id] } } });
ok('Cadastro único recusa duas turmas para a mesma professora', r.status === 400 && /somente uma turma/.test(r.data.error), r.data.error);
r = await api('/api/adm/pessoas', 'POST', { nome: 'Outra na Mesma Turma', email: 'outra.mesma', redacao: { professor: { turmas: [bc3.id] } } });
ok('Cadastro único recusa outra professora na turma ocupada', r.status === 409 && /Ana Multi/.test(r.data.error), r.data.error);
r = await api('/api/adm/pessoas', 'POST', { nome: 'Coord Só', email: 'coord.so@grupoideal.com.br', coordenacao: [{ unidade: 'CN', segmento: 'EM', serie: '1ª Série' }, { unidade: 'CN', segmento: 'EM', serie: '2ª Série' }] });
const coord = r.data.pessoas?.find(p => p.email === 'coord.so@grupoideal.com.br');
ok('Cria coordenador sem outras funções', r.status === 200 && !coord.banco && !coord.redacao.professor && coord.coordenacao.length === 2, JSON.stringify(coord));
r = await api('/api/adm/pessoas/' + coord.id, 'PUT', { redacao: { professor: { turmas: [bc3.id] } } });
ok('Edição recusa assumir a turma de outra professora sem alterar o cadastro', r.status === 409 && !db.prepare('SELECT 1 FROM redacao_professor_turmas WHERE usuario_id = ?').get(coord.id), r.status);
r = await api('/api/adm/pessoas');
ok('Lista única traz todas as pessoas (inclusive quem não é do banco de questões)', r.status === 200 && r.data.pessoas.some(p => p.email === 'coord.so@grupoideal.com.br') && r.data.pessoas.some(p => p.email === 'ana.multi@grupoideal.com.br'));
r = await api('/api/adm/professores');
ok('Lista do banco de questões continua só com quem é do banco', !r.data.professores.some(p => p.email === 'coord.so@grupoideal.com.br') && r.data.professores.some(p => p.email === 'ana.multi@grupoideal.com.br'));
await api('/api/adm/supervisor', 'POST', { disciplina: 'Matemática', usuario_id: ana.id });
r = await api('/api/adm/pessoas/' + ana.id, 'PUT', { banco: null });
const ana2 = r.data.pessoas.find(p => p.id === ana.id);
ok('Tirar do banco de questões: sem disciplina, deixa de ser supervisora e classificadora; Redação continua', r.status === 200 && !ana2.disciplina && ana2.papel === 'professor' && !ana2.classificador && ana2.redacao.professor && ana2.redacao.digitalizador, JSON.stringify(ana2));
r = await api('/api/adm/pessoas/' + ana.id, 'PUT', { redacao: { professor: null, digitalizador: { unidades: ['CN'] } } });
r = await api('/api/redacao/sessao', 'GET', undefined, 'ana-token');
ok('Tirar só a função de professora de redação mantém a de digitalizadora', r.data.usuario.funcoes.join() === 'digitalizador' && r.data.usuario.unidades.join() === 'CN', JSON.stringify(r.data.usuario));
r = await api('/api/redacao/correcao/turmas', 'GET', undefined, 'ana-token');
ok('Sem a função de professora, a correção é negada', r.status === 403, r.status);
r = await api('/api/adm/pessoas/' + ana.id, 'PUT', { redacao: null, coordenacao: [] });
r = await api('/api/redacao/sessao', 'GET', undefined, 'ana-token');
ok('Sem funções da Redação, o login da Redação é negado', r.status === 403, r.status);
for (const [nome, body] of [
  ['Digitalizador sem unidade', { redacao: { digitalizador: { unidades: [] } } }],
  ['Turma inexistente', { redacao: { professor: { turmas: [999999] } } }],
  ['Coordenação inválida', { coordenacao: [{ unidade: 'XX', segmento: 'EM', serie: '1ª Série' }] }],
  ['Disciplina inválida', { banco: { tipo: 'professor', disciplina: 'Astrologia' } }]]) {
  r = await api('/api/adm/pessoas/' + coord.id, 'PUT', body);
  ok('Validação: ' + nome, r.status === 400, r.status + ' ' + r.data.error);
}
r = await api('/api/adm/pessoas', 'POST', { nome: 'Repetido', email: 'coord.so@grupoideal.com.br', coordenacao: [] });
ok('E-mail repetido é recusado', r.status === 409, r.status);
r = await api('/api/adm/pessoas', 'GET', undefined, 'ana-token');
ok('Só o ADM mexe em cadastros', r.status === 401 || r.status === 403, r.status);
r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Dig Antigo', email: 'dig.antigo@grupoideal.com.br', funcao: 'digitalizador', unidades: ['AM'] });
const digAnt = r.data.equipe?.find(x => x.email === 'dig.antigo@grupoideal.com.br');
sessao('dig-antigo', 'usuario', 'dig.antigo@grupoideal.com.br', digAnt?.id);
r = await api('/api/redacao/lotes', 'GET', undefined, 'dig-antigo');
ok('Rota antiga da equipe continua gravando a função (marcação de digitalizador)', r.status === 200, r.status);
{
  /* Migração 0015: marcações preenchidas a partir da função antiga; tabela de coordenadores criada. */
  const m = new DatabaseSync(':memory:');
  const sql = fs.readFileSync(repo + '_cloudflare/atlas-api/schema.sql', 'utf8');
  m.exec(sql.split('-- ---------- v15 ----------')[0]);
  m.exec("INSERT INTO usuarios (nome, email, papel, ativo) VALUES ('A','a@grupoideal.com.br','professor',1),('B','b@grupoideal.com.br','professor',1)");
  m.exec("INSERT INTO redacao_equipe (usuario_id, funcao) VALUES (1,'professor'),(2,'digitalizador')");
  m.exec(fs.readFileSync(repo + '_cloudflare/atlas-api/migrations/0015_cadastros_funcoes.sql', 'utf8'));
  const e = m.prepare('SELECT usuario_id, professor, digitalizador FROM redacao_equipe ORDER BY usuario_id').all();
  ok('Migração 0015 marca professor/digitalizador pela função antiga e cria coordenadores',
    e[0].professor === 1 && e[0].digitalizador === 0 && e[1].professor === 0 && e[1].digitalizador === 1 && !!m.prepare("SELECT name FROM sqlite_master WHERE name = 'coordenadores'").get() &&
    m.prepare("SELECT valor FROM meta WHERE chave='schema_versao'").get().valor === '15', JSON.stringify(e));
}

// ---------- tela "Cadastros e funções" ----------
await page.addInitScript(t => { try { sessionStorage.setItem('atlas_adm_token', t) } catch {} }, 'adm-token');
await page.goto(base + '/admin.html');
await page.locator('#list table').waitFor({ timeout: 15000 });
ok('Menu e título: "Cadastros e funções"', (await page.locator('#app-view h1').textContent()) === 'Cadastros e funções' && (await page.locator('aside a.atual').textContent()) === 'Cadastros e funções');
ok('Lista mostra quem é só coordenador, com etiqueta', /Coord Só[\s\S]*Coordenador/.test(await page.locator('#list tr', { hasText: 'Coord Só' }).textContent()));
await page.locator('#f-funcao').selectOption('coord');
ok('Filtro de função: só coordenadores', await page.locator('#list tbody tr').count() === 1);
await page.locator('#f-funcao').selectOption('');
await page.locator('#search').fill('dig.antigo@grupoideal');
ok('Busca é só por nome (e-mail não filtra)', await page.locator('#list tbody tr').count() === 0 || /Nenhuma pessoa/.test(await page.locator('#list').textContent()));
ok('Botão "Novo cadastro" alinhado com a busca e os filtros', (await page.locator('#add').textContent()) === 'Novo cadastro' && await page.evaluate(() => { const a = document.querySelector('#search').getBoundingClientRect(), b = document.querySelector('#add').getBoundingClientRect(); return Math.abs(a.top - b.top) < 3 && Math.abs(a.height - b.height) < 3; }));
await page.locator('#search').fill('dig antigo');
ok('Filtro de nome', await page.locator('#list tbody tr').count() === 1 && /Dig Antigo/.test(await page.locator('#list tbody').textContent()));
await page.locator('#search').fill('');
await page.locator('#add').click();
ok('"+ Nova pessoa" abre com "Banco de questões" marcado', await page.locator('#dialog').isVisible() && await page.locator('#f-banco').isChecked() && await page.locator('#subject').isVisible());
await page.locator('#name').fill('Bia Redação');await page.locator('#email').fill('bia.red');
await page.locator('#f-banco').uncheck();
await page.locator('#save').click();
ok('Sem nenhuma função marcada, avisa', /pelo menos uma função/.test(await page.locator('#error').textContent()));
await page.locator('#f-red-prof').check();
await page.locator('#rp-unidade').selectOption('CN');await page.locator('#rp-segmento').selectOption('EM');
await page.locator('#rp-turmas label:visible', { hasText: '1EMA' }).locator('input').check();
await page.locator('#rp-unidade').selectOption('BC');
await page.locator('#rp-turmas label:visible', { hasText: '3EMA' }).locator('input').check();
ok('Escolher outra turma substitui a anterior', (await page.locator('[name=rp-t]:checked').count()) === 1 && /Turma da professora: 3EMA BC/.test(await page.locator('#rp-resumo').textContent()), await page.locator('#rp-resumo').textContent());
await page.locator('#f-coord').check();
await page.locator('#co-unidade').selectOption('BC');await page.locator('#co-segmento').selectOption('EM');
await page.locator('#co-series label:visible', { hasText: '3ª Série' }).locator('input').check();
await page.locator('#save').click();
await page.waitForFunction(() => /Pessoa cadastrada/.test(document.querySelector('#app-status').textContent), null, { timeout: 10000 }).catch(() => {});
const bia = db.prepare("SELECT id, disciplina FROM usuarios WHERE email = 'bia.red@grupoideal.com.br'").get();
ok('Tela grava professora de redação (1 turma) e coordenadora, sem banco de questões', bia && !bia.disciplina &&
  db.prepare('SELECT COUNT(*) AS n FROM redacao_professor_turmas WHERE usuario_id = ?').get(bia.id).n === 1 &&
  db.prepare("SELECT COUNT(*) AS n FROM coordenadores WHERE usuario_id = ? AND unidade = 'BC' AND serie = '3ª Série'").get(bia.id).n === 1, await page.locator('#app-status').textContent());
await page.locator('#list tr', { hasText: 'Bia Redação' }).getByRole('button', { name: 'Editar' }).click();
ok('Editar abre com a turma e as funções marcadas', await page.locator('#f-red-prof').isChecked() && await page.locator('#f-coord').isChecked() && !(await page.locator('#f-banco').isChecked()) && /Turma da professora: 3EMA BC/.test(await page.locator('#rp-resumo').textContent()));
await page.locator('#f-red-dig').check();await page.locator('[name=dig-u][value="AM"]').check();
await page.locator('#save').click();
await page.waitForFunction(() => /Cadastro atualizado/.test(document.querySelector('#app-status').textContent), null, { timeout: 10000 }).catch(() => {});
ok('Acrescentar a função de digitalizadora pela tela', !!db.prepare("SELECT 1 FROM redacao_equipe WHERE usuario_id = ? AND professor = 1 AND digitalizador = 1").get(bia.id) && !!db.prepare("SELECT 1 FROM redacao_digitalizador_unidades WHERE usuario_id = ? AND unidade = 'AM'").get(bia.id));
await page.locator('#list tr', { hasText: 'Bia Redação' }).getByRole('button', { name: /Desativar/ }).click();
await page.waitForFunction(() => /desativado/i.test(document.querySelector('#app-status').textContent), null, { timeout: 10000 }).catch(() => {});
ok('Desativar quem não é do banco de questões funciona', db.prepare('SELECT ativo FROM usuarios WHERE id = ?').get(bia.id).ativo === 0, await page.locator('#app-status').textContent());
await page.setViewportSize({ width: 390, height: 840 });
ok('Tela cabe no celular', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && e.offsetParent).slice(0, 6).map(e => e.tagName + '#' + e.id + '.' + e.className + ':' + Math.round(e.getBoundingClientRect().right)).join(' | ')));
await page.setViewportSize({ width: 1280, height: 900 });
/* Redação: quem tem as duas funções vê as duas áreas */
db.prepare('UPDATE usuarios SET ativo = 1 WHERE id = ?').run(bia.id);
sessao('bia-token', 'usuario', 'bia.red@grupoideal.com.br', bia.id);
await page.evaluate(() => sessionStorage.setItem('atlas_user_auth', JSON.stringify({ token: 'bia-token' })));
await page.goto(base + '/redacao.html');
await page.locator('#upload-area').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
ok('Redação mostra a turma da professora e o envio da digitalizadora', await page.locator('#upload-area').isVisible() && await page.locator('#list .turma').count() === 1 && (await page.locator('#title').textContent()) === 'Redação');
/* Mapa da equipe na aba Equipe da Redação */
await page.goto(base + '/redacao-admin.html#equipe');
await page.locator('#mapa-equipe .mapa-un').first().waitFor({ timeout: 10000 });
const cardBC = page.locator('#mapa-equipe .mapa-un', { hasText: 'Batista Campos' }), cardCN = page.locator('#mapa-equipe .mapa-un', { hasText: 'Cidade Nova' });
ok('Mapa da equipe: três unidades', await page.locator('#mapa-equipe .mapa-un').count() === 3);
ok('Mapa mostra o professor de redação de cada turma e as turmas sem professor', /3EMA\s*Bia Redação/.test(await cardBC.textContent()) && /sem professor/.test(await cardBC.textContent()), (await cardBC.textContent()).slice(0, 300));
ok('Mapa mostra coordenadores por série', /3ª Série: Bia Redação/.test(await cardBC.textContent()) && /1ª Série: Coord Só/.test(await cardCN.textContent()));
ok('Mapa mostra digitalizadores por unidade (e avisa quando falta)', /Bia Redação/.test(await page.locator('#mapa-equipe .mapa-un', { hasText: 'Augusto Montenegro' }).textContent()) && /Nenhum digitalizador/.test(await cardBC.textContent()));
ok('Mapa tem atalho para Cadastros e funções', (await page.locator('#link-cadastros').getAttribute('href')) === 'admin.html');
ok('Tela sem erro JavaScript', errors.length === 0, errors.join(' | '));
await browser.close();
await new Promise(resolve => server.close(resolve));
for (const [estado, nome, extra] of results) console.log(estado.padEnd(7), nome, extra);
const falhas = results.filter(x => x[0] === 'FALHOU').length;
console.log(falhas ? `FALHOU: ${falhas} falha(s) em ${results.length}` : `TODOS: ${results.length} verificações passaram`);
if (falhas) process.exitCode = 1;
