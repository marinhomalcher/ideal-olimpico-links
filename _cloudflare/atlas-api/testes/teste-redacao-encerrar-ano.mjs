// "Encerrar ano" da Redação: apaga os dados do ano letivo (política de privacidade de 18/11/2026)
// e mantém os cadastros permanentes. Dados fictícios; R2 falso em memória.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const worker = (await import('../worker.js')).default;
const { anoPermitido } = await import('../redacao-encerrar.js');
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
  ADMIN_EMAIL: 'adm@example.com', ATLAS_HOJE_TESTE: '2026-11-18',
  IMAGENS: r2Rigoroso(objetos)
};
function sessao(token, tipo, email, id = null) {
  db.prepare('INSERT INTO sessoes (token_hash, tipo, email, usuario_id, expira_em) VALUES (?, ?, ?, ?, ?)')
    .run(createHash('sha256').update(token).digest('hex'), tipo, email, id, '2099-01-01T00:00:00Z');
}
sessao('adm-token', 'adm', 'adm@example.com');
const origin = 'https://idealolimpico.com.br';
async function api(path, method = 'GET', body, token = 'adm-token') {
  const r = await worker.fetch(new Request('https://atlas-api.example' + path, { method, headers: { Origin: origin, Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: r.status, data: await r.json() };
}
const conta = (sql, ...a) => db.prepare(sql).get(...a).n;

ok('Schema 17', db.prepare("SELECT valor FROM meta WHERE chave='schema_versao'").get().valor === '17');
ok('Época: dezembro encerra o próprio ano', anoPermitido('2026-12-01') === 2026 && anoPermitido('2026-12-31') === 2026);
ok('Época: janeiro encerra o ano anterior', anoPermitido('2027-01-31') === 2026);
ok('Época: de fevereiro a novembro, nenhum', anoPermitido('2026-02-01') === null && anoPermitido('2026-11-30') === null);

/* ---------- dados fictícios do ano 2026 ---------- */
let r = await api('/api/adm/redacao/turmas');
const turmas = r.data.turmas;
const bc = turmas.find(t => t.unidade === 'BC' && t.codigo === '1EMA');
const cn = turmas.find(t => t.unidade === 'CN' && t.codigo === '1EMA');
ok('15 turmas de 2026 no começo', turmas.length === 15 && !!bc && !!cn);
r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Professora Fictícia', email: 'prof@grupoideal.com.br', funcao: 'professor', turmas: [bc.id] });
const profId = r.data.equipe.find(x => x.email === 'prof@grupoideal.com.br')?.id;
r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Digitalizador Fictício', email: 'dig@grupoideal.com.br', funcao: 'digitalizador', unidades: ['BC', 'CN'] });
const digId = r.data.equipe.find(x => x.email === 'dig@grupoideal.com.br')?.id;
ok('Professora e digitalizador cadastrados', !!profId && !!digId, r.data.error);
sessao('prof-token', 'usuario', 'prof@grupoideal.com.br', profId);
db.prepare("INSERT INTO usuarios (nome, email, papel, ativo) VALUES ('Coordenadora Fictícia', 'coord@grupoideal.com.br', 'professor', 1)").run();
const coordId = db.prepare("SELECT id FROM usuarios WHERE email = 'coord@grupoideal.com.br'").get().id;
db.prepare("INSERT INTO coordenadores (usuario_id, unidade, segmento, serie) VALUES (?, 'BC', 'EM', '1ª Série')").run(coordId);
const alunos = [];
for (let i = 0; i < 40; i++) alunos.push({ ra: String(10000 + i), nome: 'Aluno Fictício ' + i, unidade: i < 20 ? 'BC' : 'CN', segmento: 'EM', serie: '1ª Série', codigo: '1EMA' });
r = await api('/api/adm/redacao/alunos/importar', 'POST', { ano: 2026, alunos });
ok('40 alunos fictícios importados', r.status === 200 && conta('SELECT COUNT(*) AS n FROM redacao_alunos WHERE ano = 2026') === 40, r.data.error);
/* lotes, folhas, correções e envios direto no banco (muitas folhas, para forçar o apagamento em partes) */
const ins = db.prepare('INSERT INTO redacao_lotes (ano, bimestre, turma_id, digitalizador_id, r2_key, nome_arquivo, bytes, enviado_em, cancelavel_ate, paginas_arquivo) VALUES (2026, ?, ?, ?, ?, ?, 1000, ?, ?, ?)');
const insPag = db.prepare("INSERT INTO redacao_paginas (lote_id, pagina, ra_lido, situacao, aluno_ra, envio_id) VALUES (?, ?, ?, 'aluno', ?, ?)");
const insCor = db.prepare("INSERT INTO redacao_correcoes (lote_id, pagina, aluno_ra, professor_id, c1, c2, c3, c4, c5, total, observacao, marcacoes, enviada_em) VALUES (?, ?, ?, ?, 120, 120, 120, 120, 120, 600, 'obs', '[]', '2026-05-02T12:00:00Z')");
const insEnv = db.prepare("INSERT INTO redacao_envios (id, ano, bimestre, unidade, digitalizador_id, criado_em) VALUES (?, 2026, ?, ?, ?, '2026-05-01T12:00:00Z')");
let pdfs = 0;
for (let b = 1; b <= 4; b++) {
  for (const t of [bc, cn]) {
    const envio = 'env-' + b + '-' + t.id;
    insEnv.run(envio, b, t.unidade, digId);
    const chave = `redacao/2026/b${b}/turma-${t.id}/${crypto.randomUUID()}.pdf`;
    const lote = Number(ins.run(b, t.id, digId, chave, 'turma.pdf', '2026-05-01T12:00:00Z', '2026-05-01T14:00:00Z', 200).lastInsertRowid);
    await env.IMAGENS.put(chave, Buffer.from('%PDF-1.4 ficticio ' + chave)); pdfs++;
    for (let p = 1; p <= 200; p++) {
      const ra = String(10000 + (t === bc ? 0 : 20) + (p % 20));
      insPag.run(lote, p, ra, ra, envio);
      if (t === bc) insCor.run(lote, p, ra, profId);
    }
  }
}
/* objetos "soltos" no R2 do ano, para o prefixo ser varrido inteiro (mais de uma página de 500) */
for (let i = 0; i < 700; i++) { await env.IMAGENS.put('redacao/2026/b1/turma-' + bc.id + '/solto-' + i + '.pdf', Buffer.from('x')); pdfs++; }
/* um PDF de outro ano e uma imagem do BQI, que precisam sobreviver */
await env.IMAGENS.put('redacao/2027/b1/turma-1/futuro.pdf', Buffer.from('%PDF futuro'));
await env.IMAGENS.put('img/questao-1.png', Buffer.from('png'));
/* três cópias de segurança antigas, com dados de redação dentro */
for (const d of ['2026-10-01', '2026-11-01', '2026-12-01']) await env.IMAGENS.put('backups/atlas-' + d + 'T03-17-00Z.json', Buffer.from(JSON.stringify({ atlas_backup: 1, tabelas: { redacao_correcoes: [{ aluno_ra: '10001' }] } })));
/* registros de redação do ano, com RA, e um de outro ano */
db.prepare("INSERT INTO eventos (acao, detalhe, criado_em) VALUES ('redacao_pagina_resolvida', '{\"ra\":\"10001\"}', '2026-06-01T10:00:00Z')").run();
db.prepare("INSERT INTO eventos (acao, detalhe, criado_em) VALUES ('redacao_lote_enviado', '{\"lote_id\":1}', '2026-06-02T10:00:00Z')").run();
db.prepare("INSERT INTO eventos (acao, detalhe, criado_em) VALUES ('redacao_lote_enviado', '{\"lote_id\":9}', '2025-06-02T10:00:00Z')").run();
db.prepare("INSERT INTO eventos (acao, detalhe, criado_em) VALUES ('adm_login', '{}', '2026-06-02T10:00:00Z')").run();
const antes = {
  usuarios: conta('SELECT COUNT(*) AS n FROM usuarios'), equipe: conta('SELECT COUNT(*) AS n FROM redacao_equipe'),
  unidades: conta('SELECT COUNT(*) AS n FROM redacao_digitalizador_unidades'), coordenadores: conta('SELECT COUNT(*) AS n FROM coordenadores'),
  paginas: conta('SELECT COUNT(*) AS n FROM redacao_paginas'), correcoes: conta('SELECT COUNT(*) AS n FROM redacao_correcoes')
};
ok('Massa fictícia: 8 lotes, 1.600 folhas, 800 correções, 8 envios', conta('SELECT COUNT(*) AS n FROM redacao_lotes') === 8 && antes.paginas === 1600 && antes.correcoes === 800 && conta('SELECT COUNT(*) AS n FROM redacao_envios') === 8);

/* ---------- proteções ---------- */
r = await api('/api/adm/redacao/encerrar-ano', 'GET', undefined, 'prof-token');
ok('Professora não acessa o encerramento', r.status === 401, r.status);
r = await api('/api/adm/redacao/encerrar-ano');
ok('Em 18/11, a prévia mostra as contagens mas não permite', r.status === 200 && r.data.permitido === false && r.data.ano_permitido === null && r.data.contagens.paginas === 1600 && r.data.contagens.pdfs === pdfs && r.data.contagens.alunos === 40 && r.data.contagens.turmas === 15 && r.data.contagens.vinculos === 1 && r.data.contagens.eventos >= 2, JSON.stringify(r.data.contagens));
r = await api('/api/adm/redacao/encerrar-ano', 'POST', { ano: 2026, confirmacao: '2026' });
ok('Em 18/11, o servidor recusa o encerramento', r.status === 403 && /1º de dezembro a 31 de janeiro/.test(r.data.error), r.data.error);
env.ATLAS_HOJE_TESTE = '2026-12-28';
r = await api('/api/adm/redacao/encerrar-ano', 'POST', { ano: 2027, confirmacao: '2027' });
ok('Em dezembro, só o próprio ano pode ser encerrado', r.status === 403 && /encerrar o ano 2026/.test(r.data.error), r.data.error);
r = await api('/api/adm/redacao/encerrar-ano', 'POST', { ano: 2026, confirmacao: '2062' });
ok('Ano digitado errado é recusado', r.status === 400 && /Digite o ano 2026/.test(r.data.error), r.data.error);
r = await api('/api/adm/redacao/encerrar-ano', 'POST', { ano: 2026 });
ok('Sem o ano digitado, nada é apagado', r.status === 400 && conta('SELECT COUNT(*) AS n FROM redacao_paginas') === 1600 && objetos.size === pdfs + 5, r.data.error);
r = await api('/api/adm/redacao/encerrar-ano', 'GET');
ok('Em 28/12, a prévia libera o ano 2026', r.status === 200 && r.data.permitido === true && r.data.ano === 2026 && r.data.andamento === null, JSON.stringify(r.data));

/* ---------- a tela do ADM faz o encerramento ---------- */
const atlas = repo + 'atlas/';
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1)) || 'index.html';
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
let chamadasPost = 0;
await page.route('https://atlas-api.marinhomalcher.workers.dev/**', async route => {
  const req = route.request(), u = new URL(req.url()), dados = req.postData();
  if (req.method() === 'POST' && u.pathname === '/api/adm/redacao/encerrar-ano') chamadasPost++;
  const resp = u.pathname === '/api/adm/sessao' ? { status: 200, data: { ok: true, email: 'adm@example.com' } }
    : await api(u.pathname + u.search, req.method(), dados ? JSON.parse(dados) : undefined);
  await route.fulfill({ status: resp.status, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' }, body: JSON.stringify(resp.data) });
});
await page.goto(base + '/redacao-admin.html#encerrar');
await page.evaluate(() => sessionStorage.setItem('atlas_adm_token', 'adm-token'));
await page.reload();
await page.locator('#app').waitFor({ state: 'visible' });
await page.locator('#enc-previa tr').first().waitFor();
ok('Aba "Encerrar ano" abre com a prévia (10 linhas) e o botão liberado', await page.locator('#enc-previa tr').count() === 10 && /1.600/.test(await page.locator('#enc-previa').textContent()) && !(await page.locator('#enc-abrir').isDisabled()), await page.locator('#enc-bloqueio').textContent());
ok('Sem confirm(), alert() ou prompt() na tela', !/\b(confirm|alert|prompt)\(/.test(fs.readFileSync(atlas + 'redacao-admin.html', 'utf8')));
await page.locator('#enc-abrir').click();
ok('1ª etapa: caixa de confirmação aparece com o botão travado', await page.locator('#enc-confirmar').isVisible() && await page.locator('#enc-apagar').isDisabled());
await page.locator('#enc-digitado').fill('2025');
ok('Ano errado digitado mantém o botão travado', await page.locator('#enc-apagar').isDisabled() && conta('SELECT COUNT(*) AS n FROM redacao_paginas') === 1600);
await page.locator('#enc-digitado').fill('2026');
ok('Ano certo libera "Apagar os dados de 2026"', !(await page.locator('#enc-apagar').isDisabled()) && await page.locator('#enc-apagar').textContent() === 'Apagar os dados de 2026');
await page.locator('#enc-apagar').click();
await page.waitForFunction(() => /^Ano 2026 encerrado\.$/.test(document.querySelector('#enc-status').textContent), null, { timeout: 60000 }).catch(() => {});
ok('Tela conclui o encerramento e mostra o relatório', /Ano 2026 encerrado/.test(await page.locator('#enc-status').textContent()) && await page.locator('#enc-relatorio').isVisible() && /Folhas: 1.600/.test(await page.locator('#enc-relatorio').textContent()) && /Cópias anteriores apagadas: 3/.test(await page.locator('#enc-relatorio').textContent()), await page.locator('#enc-status').textContent() + ' | ' + await page.locator('#enc-relatorio').textContent());
ok('Apagamento feito em partes (várias chamadas)', chamadasPost >= 3, chamadasPost);

/* ---------- o que precisa ter sumido ---------- */
ok('D1: correções, folhas, lotes e envios de 2026 apagados', conta('SELECT COUNT(*) AS n FROM redacao_correcoes') === 0 && conta('SELECT COUNT(*) AS n FROM redacao_paginas') === 0 && conta('SELECT COUNT(*) AS n FROM redacao_lotes') === 0 && conta('SELECT COUNT(*) AS n FROM redacao_envios') === 0);
ok('D1: alunos, turmas, vínculos e importações de 2026 apagados', conta('SELECT COUNT(*) AS n FROM redacao_alunos') === 0 && conta('SELECT COUNT(*) AS n FROM redacao_turmas WHERE ano = 2026') === 0 && conta('SELECT COUNT(*) AS n FROM redacao_professor_turmas') === 0 && conta('SELECT COUNT(*) AS n FROM redacao_importacoes') === 0);
ok('D1: registros de redação de 2026 apagados; o de 2025 e os demais ficam', conta("SELECT COUNT(*) AS n FROM eventos WHERE acao LIKE 'redacao_%' AND acao <> 'redacao_ano_encerrado' AND criado_em >= '2026-' AND criado_em < '2027-'") === 0 && conta("SELECT COUNT(*) AS n FROM eventos WHERE acao = 'redacao_lote_enviado' AND criado_em LIKE '2025-%'") === 1 && conta("SELECT COUNT(*) AS n FROM eventos WHERE acao = 'adm_login'") === 1);
ok('R2: nenhum PDF de redacao/2026/ sobrou', [...objetos.keys()].every(k => !k.startsWith('redacao/2026/')));
ok('R2: PDF de 2027 e imagem do BQI continuam', objetos.has('redacao/2027/b1/turma-1/futuro.pdf') && objetos.has('img/questao-1.png'));
const copias = [...objetos.keys()].filter(k => k.startsWith('backups/'));
const copiaNova = copias.length === 1 ? JSON.parse(objetos.get(copias[0]).toString()) : null;
ok('R2: só a cópia de segurança nova ficou, já sem dados de redação', copias.length === 1 && copiaNova?.origem === 'encerramento-redacao-2026' && copiaNova.tabelas.redacao_correcoes.length === 0 && copiaNova.tabelas.redacao_alunos.length === 0 && copiaNova.tabelas.usuarios.length === antes.usuarios, copias.join(','));
const evento = db.prepare("SELECT detalhe FROM eventos WHERE acao = 'redacao_ano_encerrado'").all();
const det = evento.length === 1 ? JSON.parse(evento[0].detalhe) : null;
ok('Evento "redacao_ano_encerrado" registra o relatório completo', det && det.ano === 2026 && det.por === 'adm@example.com' && det.apagados.paginas === 1600 && det.apagados.correcoes === 800 && det.apagados.lotes === 8 && det.apagados.pdfs === pdfs && det.apagados.alunos === 40 && det.apagados.turmas === 15 && det.apagados.vinculos === 1 && det.apagados.eventos >= 2 && det.copias_removidas === 3 && det.copia, JSON.stringify(det));
ok('Andamento em meta foi limpo', conta("SELECT COUNT(*) AS n FROM meta WHERE chave LIKE 'encerramento_redacao_%'") === 0);

/* ---------- o que precisa ter ficado ---------- */
ok('Cadastros permanentes intactos: usuários, equipe, unidades dos digitalizadores e coordenadores', conta('SELECT COUNT(*) AS n FROM usuarios') === antes.usuarios && conta('SELECT COUNT(*) AS n FROM redacao_equipe') === antes.equipe && conta('SELECT COUNT(*) AS n FROM redacao_digitalizador_unidades') === antes.unidades && conta('SELECT COUNT(*) AS n FROM coordenadores') === antes.coordenadores);
r = await api('/api/adm/redacao/equipe');
ok('Professora continua cadastrada, agora sem turma', r.status === 200 && r.data.equipe.some(x => x.id === profId && x.funcao === 'professor' && x.turmas.length === 0), JSON.stringify(r.data.equipe));
r = await api('/api/redacao/sessao', 'GET', undefined, 'prof-token');
ok('Professora ainda entra na Redação', r.status === 200 && r.data.usuario.turmas.length === 0, r.data.error);
ok('Schema continua 17', db.prepare("SELECT valor FROM meta WHERE chave='schema_versao'").get().valor === '17');

/* ---------- depois: prévia zerada e segunda chamada inofensiva ---------- */
r = await api('/api/adm/redacao/encerrar-ano', 'GET');
ok('Prévia depois do encerramento mostra tudo zerado', r.status === 200 && Object.values(r.data.contagens).every(v => v === 0), JSON.stringify(r.data.contagens));
ok('Tela trava o botão quando não há nada para apagar', await page.locator('#enc-abrir').isDisabled() && /Não há dados de 2026/.test(await page.locator('#enc-bloqueio').textContent()));
env.ATLAS_HOJE_TESTE = '2027-01-10';
r = await api('/api/adm/redacao/encerrar-ano', 'POST', { ano: 2026, confirmacao: '2026' });
ok('Em janeiro, encerrar 2026 de novo conclui sem apagar nada', r.status === 200 && r.data.concluido === true && Object.keys(r.data.apagados).length === 0, JSON.stringify(r.data));
r = await api('/api/adm/redacao/encerrar-ano', 'POST', { ano: 2027, confirmacao: '2027' });
ok('Em janeiro, o ano novo não pode ser encerrado', r.status === 403, r.data.error);

await page.setViewportSize({ width: 390, height: 840 });
await page.goto(base + '/redacao-admin.html#encerrar');
await page.locator('#enc-previa tr').first().waitFor();
ok('Aba cabe no celular', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
ok('Sem erro JavaScript na tela', errors.length === 0, errors.join(' | '));
await browser.close();
await new Promise(resolve => server.close(resolve));
const passed = results.filter(x => x[0] === 'OK').length;
for (const x of results) console.log(x[0].padEnd(7), x[1], x[2]);
console.log(passed === results.length ? `TODOS: ${passed} verificações passaram` : `FALHOU: ${results.length - passed} falha(s) em ${results.length} verificações`);
if (passed !== results.length) process.exitCode = 1;
