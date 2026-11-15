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
ok('Schema 14', db.prepare("SELECT valor FROM meta WHERE chave='schema_versao'").get().valor === '14');
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
/* EF1 saiu da Redação: a planilha ignora as linhas de EF1 e não cria turmas de EF1. */
r = await api('/api/adm/redacao/alunos/previa', 'POST', { ano: 2026, alunos: [rows[0], { ra: '55501', nome: 'Aluno EF1', unidade: 'BC', segmento: 'EF1', serie: '1ANO', codigo: '1EFA' }] });
ok('Prévia ignora as linhas de EF1 e avisa', r.status === 200 && r.data.linhas === 1 && r.data.ignorados_ef1 === 1 && r.data.novas_turmas.length === 0, JSON.stringify(r.data));
r = await api('/api/adm/redacao/alunos/importar', 'POST', { ano: 2026, alunos: [rows[0], { ra: '55501', nome: 'Aluno EF1', unidade: 'BC', segmento: 'EF1', serie: '1ANO', codigo: '1EFA' }] });
ok('Importação não grava aluno nem turma de EF1', r.status === 200 && !db.prepare("SELECT 1 FROM redacao_alunos WHERE ra = '55501'").get() && !db.prepare("SELECT 1 FROM redacao_turmas WHERE segmento = 'EF1'").get(), r.data.error);
r = await api('/api/adm/redacao/turmas', 'POST', { unidade: 'BC', segmento: 'EF1', serie: '1ANO', codigo: '1EFA' });
ok('Cadastro manual de turma EF1 é recusado', r.status === 400, r.status);
{
  /* Migração 0014: apaga turmas/alunos/vínculos de EF1; turma de EF1 com lote fica. */
  const m = new DatabaseSync(':memory:');
  const sql = fs.readFileSync(repo + '_cloudflare/atlas-api/schema.sql', 'utf8');
  m.exec(sql.split('-- ---------- v14 ----------')[0]);
  m.exec("INSERT INTO usuarios (nome, email, papel, ativo) VALUES ('P', 'p@grupoideal.com.br', 'professor', 1)");
  m.exec("INSERT INTO redacao_turmas (ano, unidade, segmento, serie, codigo) VALUES (2026,'BC','EF1','1ANO','1EFA'), (2026,'BC','EF1','2ANO','2EFA')");
  const ef = m.prepare("SELECT id FROM redacao_turmas WHERE codigo IN ('1EFA','2EFA') ORDER BY codigo").all().map(x => x.id);
  m.prepare("INSERT INTO redacao_alunos (ra, nome, turma_id, ano, segmento, serie) VALUES ('9001','A',?,2026,'EF1','1ANO')").run(ef[0]);
  m.prepare("INSERT INTO redacao_equipe (usuario_id, funcao) VALUES (1, 'professor')").run();
  m.prepare('INSERT INTO redacao_professor_turmas (usuario_id, turma_id) VALUES (1, ?)').run(ef[0]);
  m.prepare("INSERT INTO redacao_lotes (ano, bimestre, turma_id, digitalizador_id, r2_key, nome_arquivo, bytes, enviado_em, cancelavel_ate) VALUES (2026,1,?,1,'k','n.pdf',10,'x','y')").run(ef[1]);
  m.exec(fs.readFileSync(repo + '_cloudflare/atlas-api/migrations/0014_redacao_sem_ef1.sql', 'utf8'));
  ok('Migração 0014 apaga turmas, alunos e vínculos de EF1 (mantém a que tem lote)',
    !m.prepare("SELECT 1 FROM redacao_turmas WHERE codigo = '1EFA'").get() && !!m.prepare("SELECT 1 FROM redacao_turmas WHERE codigo = '2EFA'").get() &&
    !m.prepare("SELECT 1 FROM redacao_alunos WHERE segmento = 'EF1'").get() && !m.prepare('SELECT 1 FROM redacao_professor_turmas').get() &&
    m.prepare("SELECT valor FROM meta WHERE chave='schema_versao'").get().valor === '14');
  ok('Turmas iniciais do EM continuam após a migração', m.prepare("SELECT COUNT(*) AS n FROM redacao_turmas WHERE segmento = 'EM'").get().n === 15);
}
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
  const req = route.request(), u = new URL(req.url()), dados = req.postData();
  const r = u.pathname === '/api/adm/sessao' ? { status: 200, data: { ok: true, email: 'adm@example.com' } }
    : await api(u.pathname + u.search, req.method(), dados ? JSON.parse(dados) : undefined);
  await route.fulfill({ status: r.status, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' }, body: JSON.stringify(r.data) });
});
const CDN = (process.env.ATLAS_TESTE_TMP || '/tmp/atlas-testes') + '/cdn/package/dist/exceljs.min.js';
await page.route('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js', r2 => r2.fulfill({ status: 200, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(CDN) }));
await page.goto(base + '/redacao-admin.html');
await page.evaluate(() => sessionStorage.setItem('atlas_adm_token', 'adm-token'));
await page.reload();
await page.locator('#app').waitFor({ state: 'visible' });
ok('Lista de turmas só aparece depois de escolher a unidade', await page.locator('#turmas-lista tr').count() === 0 && await page.locator('#turmas-dica').isVisible() && await page.locator('[data-tab="equipe"]').isVisible());
ok('Segmento só oferece EF2 e EM (EM já escolhido); cadastro também sem EF1', await page.locator('#f-segmento').inputValue() === 'EM' && await page.locator('#f-segmento option').count() === 2 && await page.locator('#turma-segmento option[value="EF1"]').count() === 0);
await page.locator('#f-unidade').selectOption('BC');
const nBcEm = db.prepare("SELECT COUNT(*) AS n FROM redacao_turmas WHERE unidade = 'BC' AND segmento = 'EM'").get().n;
ok('Filtro Batista Campos + EM mostra só essas turmas', await page.locator('#turmas-lista tr').count() === nBcEm && nBcEm > 0 && (await page.locator('#turmas-lista').textContent()).includes('Batista Campos') && !(await page.locator('#turmas-lista').textContent()).includes('Cidade Nova'), nBcEm);
await page.reload();
await page.locator('#app').waitFor({ state: 'visible' });
ok('A escolha do filtro é lembrada', await page.locator('#f-unidade').inputValue() === 'BC' && await page.locator('#turmas-lista tr').count() === nBcEm);
ok('Abas da Redação: Lotes, Turmas e Equipe', (await page.locator('.tabs').textContent()).replace(/\s+/g, '') === 'LotesTurmasEquipe' && await page.locator('.tabs a[href="redacao-lotes-admin.html"]').count() === 1);
await page.locator('[data-tab="equipe"]').click();
ok('ADM escolhe turmas para professor (filtro mostra só a unidade/segmento)', await page.locator('[name="prof-turma"]').count() === 16 && await page.locator('#turmas-choices label:visible').count() === nBcEm);
await page.locator('#e-unidade').selectOption('CN');
ok('Filtro da equipe troca para Cidade Nova', await page.locator('#turmas-choices label:visible').count() === db.prepare("SELECT COUNT(*) AS n FROM redacao_turmas WHERE unidade = 'CN' AND segmento = 'EM'").get().n);
await page.locator('#turmas-choices label:visible input').first().check();
await page.locator('#e-unidade').selectOption('BC');
await page.locator('#turmas-choices label:visible input').first().check();
ok('Resumo mostra as turmas marcadas em filtros diferentes', /2 turmas marcadas: .*CN.*BC|2 turmas marcadas: .*BC.*CN/.test(await page.locator('#turmas-resumo').textContent()), await page.locator('#turmas-resumo').textContent());
/* Botão "Editar" da equipe abre o cadastro para edição (digitalizador, professora e supervisor do BQI que é digitalizador). */
db.prepare("INSERT INTO usuarios (nome, email, papel, disciplina, ativo) VALUES ('Supervisor Mat Exemplo', 'supmat@grupoideal.com.br', 'supervisor', 'Matemática', 1)").run();
await api('/api/adm/redacao/equipe', 'POST', { nome: 'ignorado', email: 'supmat@grupoideal.com.br', funcao: 'digitalizador', unidades: ['BC'] });
await page.reload();
await page.locator('#app').waitFor({ state: 'visible' });
await page.locator('[data-tab="equipe"]').click();
for (const quem of ['Digitalizador Exemplo', 'Professora Exemplo', 'Supervisor Mat Exemplo']) {
  const linha = page.locator('#equipe-lista tr', { hasText: quem });
  if (!(await linha.count())) { ok('Editar: pessoa ' + quem + ' na lista', false, await page.locator('#equipe-lista').textContent()); continue; }
  await linha.getByRole('button', { name: 'Editar' }).click();
  await page.waitForTimeout(300);
  ok('Editar abre o cadastro de ' + quem, (await page.locator('#equipe-form-title').textContent()).includes('Editar vínculos de ' + quem) && await page.locator('#equipe-cancel').isVisible(), (await page.locator('#equipe-form-title').textContent()) + ' | erros: ' + errors.join(' | '));
  await page.locator('#equipe-cancel').click();
}
await page.locator('#equipe-funcao').selectOption('digitalizador');
ok('ADM escolhe unidades para digitalizador', await page.locator('[name="dig-unidade"]').count() === 3 && await page.locator('#digitalizador-choices').isVisible());
/* Alunos saiu de Redação: cadastros e virou página própria no menu do ADM. */
ok('Link "Lotes recebidos" saiu do canto de Redação: cadastros (agora fica no menu do ADM)', await page.locator('header a[href="redacao-lotes-admin.html"]').count() === 0);
ok('Redação: cadastros não tem mais a aba Alunos e aponta para a página nova', await page.locator('[data-tab="alunos"]').count() === 0 && await page.locator('#aviso-alunos a[href="alunos-admin.html"]').count() === 1);
await page.locator('[data-tab="turmas"]').click();
ok('"Ver alunos" leva à página Alunos com a turma', (await page.locator('#turmas-lista a', { hasText: 'Ver alunos' }).first().getAttribute('href')).startsWith('alunos-admin.html?turma='));
for (const f of ['admin.html', 'admin-questoes.html', 'admin-enviar.html', 'admin-relatorio.html', 'admin-selecoes.html']) {
  const menu = fs.readFileSync(atlas + f, 'utf8').match(/<aside><small>ÁREA DO ADM<\/small>(.*?)<\/aside>/)?.[1] || '';
  ok('Menu do ADM com "Alunos" logo abaixo de "Professores e disciplinas": ' + f, /^<a href="admin\.html"[^>]*>Professores e disciplinas<\/a><a href="alunos-admin\.html"[^>]*>Alunos<\/a>/.test(menu) && menu.includes('<a href="alunos-admin.html">Alunos</a><a href="redacao-lotes-admin.html">Redação</a>') && !menu.includes('redacao-admin.html'));
}
ok('Login do ADM volta para a página Alunos', fs.readFileSync(atlas + 'admin.html', 'utf8').includes("['alunos-admin.html','redacao-admin.html','redacao-lotes-admin.html']"));
const turmaAluno = db.prepare("SELECT turma_id FROM redacao_alunos WHERE ra = '12345'").get().turma_id;
await page.goto(base + '/alunos-admin.html?turma=' + turmaAluno);
await page.waitForFunction(() => /aluno\(s\) nesta turma/.test(document.querySelector('#consultar-status').textContent), null, { timeout: 10000 }).catch(() => {});
ok('Página Alunos abre já mostrando a turma pedida', await page.locator('#consultar-turma').inputValue() === String(turmaAluno) && await page.locator('#alunos-lista tr').count() === db.prepare('SELECT COUNT(*) AS n FROM redacao_alunos WHERE turma_id = ?').get(turmaAluno).n, await page.locator('#consultar-status').textContent());
{
  const E = require(CDN), wb = new E.Workbook(), ws = wb.addWorksheet('ALUNOS');
  ws.addRow(['NOME COMPLETO', 'RA', 'FILIAL', 'SÉRIE', 'CODTURMA', 'SEGMENTO']);
  ws.addRow(['ALUNO TESTE PLANILHA', '77777', 'BC', '1ª Série', '1EMA', 'EM']);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  await page.locator('#arquivo').setInputFiles({ name: 'ALUNOS.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx });
  await page.locator('#previa-button').click();
  await page.waitForFunction(() => /Prévia pronta/.test(document.querySelector('#alunos-status').textContent), null, { timeout: 15000 }).catch(() => {});
  ok('Página Alunos confere a planilha', /1 alunos · 1 novos/.test(await page.locator('#previa').textContent()), await page.locator('#alunos-status').textContent());
  await page.locator('#importar-button').click();
  await page.waitForFunction(() => /Importação concluída/.test(document.querySelector('#alunos-status').textContent), null, { timeout: 15000 }).catch(() => {});
  ok('Página Alunos importa a planilha', db.prepare("SELECT COUNT(*) AS n FROM redacao_alunos WHERE ra = '77777'").get().n === 1, await page.locator('#alunos-status').textContent());
}
await page.setViewportSize({ width: 390, height: 840 });
ok('Página Alunos cabe no celular', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await page.evaluate(() => sessionStorage.removeItem('atlas_adm_token'));
await page.goto(base + '/alunos-admin.html');
await page.locator('#auth-error').waitFor({ state: 'visible' });
ok('Sem login, a página Alunos manda para o ADM com retorno', await page.locator('#auth-error a').getAttribute('href') === 'admin.html?volta=alunos-admin.html');
ok('Sem erro JavaScript nas telas', errors.length === 0, errors.join(' | '));
await browser.close();
await new Promise(resolve => server.close(resolve));
const passed = results.filter(x => x[0] === 'OK').length;
for (const x of results) console.log(x[0].padEnd(7), x[1], x[2]);
console.log(passed === results.length ? `TODOS: ${passed} verificações passaram` : `FALHOU: ${results.length - passed} falha(s) em ${results.length} verificações`);
if (passed !== results.length) process.exitCode = 1;
