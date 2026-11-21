// Tela do ADM "Meu desempenho": lê mapas (código de barras, nome do arquivo ou escolha), envia ao SharePoint,
// libera e recolhe; gera os espelhos da redação a partir das folhas corrigidas. Dados fictícios; SharePoint falso.
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
const { FOLHA_JS, pdfDeJpegs } = await import('./folha-ficticia.mjs');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(fs.readFileSync(repo + '_cloudflare/atlas-api/schema.sql', 'utf8'));
const results = [];
function ok(name, cond, extra = '') { results.push([cond ? 'OK' : 'FALHOU', name, String(extra).slice(0, 300)]); }
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }) };
}
const objetos = new Map();
const env = {
  DB: { prepare: sql => stmt(sql), batch: async ops => Promise.all(ops.map(x => x.run())) },
  ADMIN_EMAIL: 'adm@example.com', ATLAS_HOJE_TESTE: '2026-11-18', IMAGENS: r2Rigoroso(objetos),
  MS_TENANT_ID: 't', MS_CLIENT_ID: 'c', MS_CLIENT_SECRET: 's', SHAREPOINT_SITE: 'site-teste'
};
/* SharePoint falso (só o Worker, no Node, fala com ele) */
const sp = new Map(), G = 'https://graph.microsoft.com/v1.0/sites/site-teste/drive/root:/';
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, op = {}) => {
  const u = String(url);
  if (u.startsWith('https://login.microsoftonline.com/')) return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3599 }));
  if (u.startsWith(G)) {
    let rel = u.slice(G.length); const c = rel.endsWith(':/content'); if (c) rel = rel.slice(0, -9);
    if (op.method === 'PUT') { sp.set(rel, Buffer.from(op.body)); return new Response('{}', { status: 201 }); }
    if (op.method === 'DELETE') { for (const k of [...sp.keys()]) if (k === rel || k.startsWith(rel + '/')) sp.delete(k); return new Response(null, { status: 204 }); }
    return new Response('{}', { status: 404 });
  }
  return fetchReal(url, op);
};
db.prepare('INSERT INTO sessoes (token_hash, tipo, email, usuario_id, expira_em) VALUES (?, ?, ?, ?, ?)').run(createHash('sha256').update('adm-token').digest('hex'), 'adm', 'adm@example.com', null, '2099-01-01T00:00:00Z');
async function api(path, method = 'GET', body, token = 'adm-token', contentType = 'application/json') {
  const headers = { Origin: 'https://idealolimpico.com.br', Authorization: 'Bearer ' + token };
  if (body !== undefined) headers['Content-Type'] = contentType;
  const r = await worker.fetch(new Request('https://atlas-api.example' + path, { method, headers, body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body }), env, { waitUntil() {} });
  return { status: r.status, data: r.headers.get('Content-Type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers };
}
const alunos = [];
for (let i = 0; i < 6; i++) alunos.push({ ra: String(20000 + i), nome: 'Aluno Fictício ' + ['Ana', 'Bruno', 'Carla', 'Davi', 'Elisa', 'Fábio'][i], unidade: 'BC', segmento: 'EM', serie: '3ª Série', codigo: '3EMA' });
ok('Alunos fictícios importados', (await api('/api/adm/redacao/alunos/importar', 'POST', { ano: 2026, alunos })).status === 200);

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
await page.route('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/**', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(PDFJS + new URL(route.request().url()).pathname.split('/').pop()) }));
await page.route('https://atlas-api.marinhomalcher.workers.dev/**', async route => {
  const req = route.request(), u = new URL(req.url()), type = req.headers()['content-type'], body = req.postDataBuffer();
  const token = (req.headers()['authorization'] || '').replace(/^Bearer /i, '');
  const result = await api(u.pathname + u.search, req.method(), body && type === 'application/json' ? JSON.parse(body.toString()) : body || undefined, token, type || 'application/json');
  await route.fulfill({ status: result.status, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': result.headers.get('Content-Type') || 'application/json' }, body: Buffer.isBuffer(result.data) ? result.data : JSON.stringify(result.data) });
});
await page.goto(base + '/index.html');
await page.evaluate(() => sessionStorage.setItem('atlas_adm_token', 'adm-token'));
await page.goto(base + '/desempenho-admin.html');
await page.locator('#app').waitFor({ state: 'visible' });
await page.addScriptTag({ content: FOLHA_JS });

/* mapas fictícios: página A4 com título, tabela e, quando pedido, o código de barras do RA no topo */
const pdfMapas = async paginas => pdfDeJpegs((await page.evaluate(lista => lista.map(ra => {
  const c = document.createElement('canvas'); c.width = 1240; c.height = 1754; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#98151d'; x.fillRect(80, 140, 1080, 70);
  x.fillStyle = '#fff'; x.font = 'bold 40px Arial'; x.fillText('MAPA DE DESEMPENHO (FICTÍCIO)', 110, 190);
  x.fillStyle = '#333'; x.font = '24px Arial'; for (let i = 0; i < 20; i++) x.fillText('Questão ' + (i + 1) + ' ......... ' + (i % 3 ? 'certa' : 'errada'), 110, 280 + i * 50);
  if (ra) { const larg = window.code128(ra), mod = 3; let px = 800; larg.forEach((l, k) => { if (k % 2 === 0) { x.fillStyle = '#000'; x.fillRect(px, 40, l * mod, 70); } px += l * mod; }); }
  return { jpeg: window.jpeg(c), w: c.width, h: c.height };
}), paginas)).map(j => ({ ...j, jpeg: Buffer.from(j.jpeg, 'base64') })));
const arquivos = [
  { name: 'turma-3EMA-parte1.pdf', mimeType: 'application/pdf', buffer: await pdfMapas(['20000', null, '20001', null]) },  /* 2 alunos no mesmo PDF */
  { name: 'mapa 20002.pdf', mimeType: 'application/pdf', buffer: await pdfMapas([null]) },                                  /* RA no nome */
  { name: 'Aluno Ficticio Davi.pdf', mimeType: 'application/pdf', buffer: await pdfMapas([null, null]) },                  /* nome no arquivo */
  { name: 'sem-identificacao.pdf', mimeType: 'application/pdf', buffer: await pdfMapas([null]) },                           /* escolher */
  { name: 'fora-da-lista.pdf', mimeType: 'application/pdf', buffer: await pdfMapas(['99999']) }                              /* RA lido fora da lista */
];
await page.selectOption('#m-bim', '2');
await page.selectOption('#m-prova', 'ENEM1');
await page.setInputFiles('#m-arquivos', arquivos);
await page.click('#m-ler');
await page.waitForFunction(() => /Confira|Nenhuma/.test(document.querySelector('#m-status').textContent), null, { timeout: 60000 });
const linhas = await page.$$eval('#m-tabela tr', trs => trs.map(tr => [...tr.children].map(td => td.querySelector('input')?.value ?? td.textContent)));
ok('PDF com 2 alunos vira 2 documentos (página sem código fica com o anterior)', linhas.length === 6 && linhas[0][1] === 'págs. 1–2' && linhas[0][2].startsWith('20000') && linhas[1][1] === 'págs. 3–4' && linhas[1][2].startsWith('20001') && linhas[0][3] === 'código de barras', JSON.stringify(linhas.slice(0, 2)));
ok('RA no nome do arquivo e nome do aluno no arquivo são reconhecidos', linhas[2][2].startsWith('20002') && linhas[2][3] === 'nome do arquivo' && linhas[3][2].startsWith('20003') && linhas[3][1] === 'págs. 1–2', JSON.stringify(linhas.slice(2, 4)));
ok('Sem código e sem nome: pede para escolher; RA fora da lista é avisado', linhas[4][4] === 'Escolha o aluno.' && /99999.*fora da lista/.test(linhas[5][4]), JSON.stringify(linhas.slice(4)));
ok('Botão mostra quantos estão prontos', (await page.textContent('#m-enviar')) === 'Enviar 4 documentos');
const campo = page.locator('#m-tabela tr').nth(4).locator('input');
await campo.fill('20004 — Aluno Fictício Elisa — 3EMA BC');
await campo.dispatchEvent('change');
ok('Escolher o aluno na lista libera o item', (await page.textContent('#m-enviar')) === 'Enviar 5 documentos');
await page.click('#m-enviar');
await page.waitForFunction(() => /enviad/.test(document.querySelector('#m-status').textContent), null, { timeout: 60000 });
const docs = db.prepare("SELECT ra, paginas FROM desempenho_documentos WHERE ano = 2026 AND bimestre = 2 AND prova = 'ENEM1' ORDER BY ra").all();
ok('5 documentos registrados com as páginas certas', JSON.stringify(docs.map(d => d.ra + ':' + d.paginas)) === JSON.stringify(['20000:2', '20001:2', '20002:1', '20003:2', '20004:1']), JSON.stringify(docs));
ok('Páginas estão no SharePoint como JPEG', sp.has('2026/B2/ENEM1/20000/p2.jpg') && sp.get('2026/B2/ENEM1/20003/p1.jpg')[0] === 0xFF && sp.size === 8, [...sp.keys()].join(','));
await page.waitForFunction(() => document.querySelectorAll('#m-enviados tr').length === 5);
ok('Lista "Já enviados" mostra os 5, não liberados', (await page.textContent('#m-contagem')) === '5 alunos · 0 liberados');
await page.click('#m-liberar');
await page.waitForFunction(() => /liberado/.test(document.querySelector('#m-lib-status').textContent));
await page.waitForFunction(() => document.querySelector('#m-contagem').textContent === '5 alunos · 5 liberados');
ok('Liberar marca todos e avisa', conta("SELECT COUNT(*) AS n FROM desempenho_documentos WHERE liberado_em IS NOT NULL") === 5);
const apagar = page.locator('#m-enviados tr').first().locator('button');
await apagar.click();
ok('Apagar pede confirmação na própria tela (sem caixa do navegador)', (await apagar.textContent()) === 'Confirmar: apagar' && conta('SELECT COUNT(*) AS n FROM desempenho_documentos') === 5);
await apagar.click();
await page.waitForFunction(() => document.querySelector('#m-contagem').textContent === '4 alunos · 4 liberados');
ok('Confirmar apaga o documento e as páginas', conta('SELECT COUNT(*) AS n FROM desempenho_documentos') === 4 && !sp.has('2026/B2/ENEM1/20000/p1.jpg'));
function conta(q) { return db.prepare(q).get().n; }

/* ---------- espelhos: lote fictício com 2 folhas corrigidas ---------- */
const turma = db.prepare("SELECT turma_id AS id FROM redacao_alunos WHERE ra = '20000'").get().id;
db.prepare("INSERT INTO usuarios (nome, email, papel, ativo) VALUES ('Prof Fictícia', 'prof@grupoideal.com.br', 'professor', 1)").run();
const prof = db.prepare("SELECT id FROM usuarios WHERE email = 'prof@grupoideal.com.br'").get().id;
const scans = await page.evaluate(() => ['20000', '20001', '20002'].map((ra, i) => { const c = window.escanear(window.folhaTeste({ ra, codigoAbaixo: true }), { ang: [0.7, -1.1, 0][i], dx: 6, dy: -4 }); return { jpeg: window.jpeg(c), w: c.width, h: c.height }; }));
const pdfLote = pdfDeJpegs(scans.map(j => ({ ...j, jpeg: Buffer.from(j.jpeg, 'base64') })));
await env.IMAGENS.put('redacao/2026/b2/turma-' + turma + '/lote.pdf', pdfLote);
const lote = Number(db.prepare("INSERT INTO redacao_lotes (ano, bimestre, turma_id, digitalizador_id, r2_key, nome_arquivo, bytes, enviado_em, cancelavel_ate) VALUES (2026, 2, ?, ?, ?, 'lote.pdf', ?, '2026-05-01T12:00:00Z', '2026-05-01T14:00:00Z')").run(turma, prof, 'redacao/2026/b2/turma-' + turma + '/lote.pdf', pdfLote.length).lastInsertRowid);
for (const [p, ra] of [[1, '20000'], [2, '20001'], [3, '20002']]) db.prepare("INSERT INTO redacao_paginas (lote_id, pagina, ra_lido, situacao, aluno_ra) VALUES (?, ?, ?, 'aluno', ?)").run(lote, p, ra, ra);
db.prepare("INSERT INTO redacao_correcoes (lote_id, pagina, aluno_ra, professor_id, c1, c2, c3, c4, c5, total, observacao, marcacoes, enviada_em) VALUES (?, 1, '20000', ?, 160, 120, 120, 160, 160, 720, 'Texto bem organizado. Atenção à norma padrão e detalhe melhor a proposta de intervenção.', ?, '2026-05-02T12:00:00Z')")
  .run(lote, prof, JSON.stringify([{ x: 0.2, y: 0.33, w: 0.3, h: 0.012 }, { x: 0.25, y: 0.45, w: 0.4, h: 0.012 }]));
db.prepare("INSERT INTO redacao_correcoes (lote_id, pagina, aluno_ra, professor_id, total, zero_motivo, enviada_em) VALUES (?, 2, '20001', ?, 0, 'Fuga total ao tema', '2026-05-02T12:00:00Z')").run(lote, prof);
await page.click('[data-tab=espelhos]');
await page.selectOption('#e-bim', '2');
await page.waitForFunction(() => document.querySelectorAll('#e-lotes tr button').length === 1);
const linhaLote = await page.$$eval('#e-lotes tr td', tds => tds.map(t => t.textContent));
ok('Turma aparece com 3 folhas, 2 corrigidas, 0 espelhos', linhaLote.slice(0, 5).join('|') === '3EMA · 3ª Série|Batista Campos|3|2|0', linhaLote.join('|'));
await page.click('#e-lotes button');
await page.waitForFunction(() => /gerado|erro/.test(document.querySelector('#e-status').textContent), null, { timeout: 60000 });
const st = await page.textContent('#e-status');
ok('2 espelhos gerados (só as corrigidas)', /^2 espelhos gerados/.test(st) && conta("SELECT COUNT(*) AS n FROM desempenho_documentos WHERE prova = 'ESPELHO' AND bimestre = 2") === 2 && sp.has('2026/B2/ESPELHO/20000/p1.jpg') && sp.has('2026/B2/ESPELHO/20001/p1.jpg') && !sp.has('2026/B2/ESPELHO/20002/p1.jpg'), st);
const previa = await page.evaluate(() => { const i = document.querySelector('#e-previa'); return { visivel: !i.hidden, w: i.naturalWidth, h: i.naturalHeight }; });
ok('Mostra o primeiro espelho como exemplo (folha + painel ao lado)', previa.visivel && previa.w > 1900 && previa.h >= 1700, JSON.stringify(previa));
const esp = sp.get('2026/B2/ESPELHO/20000/p1.jpg');
ok('Espelho cabe no limite de 4 MB', esp && esp.length < 4 * 1024 * 1024, esp?.length);
if (process.env.ATLAS_ESPELHO_PNG) fs.writeFileSync(process.env.ATLAS_ESPELHO_PNG, esp);
await page.waitForFunction(() => /2 espelhos/.test(document.querySelector('#e-contagem').textContent));
await page.click('#e-liberar');
await page.waitForFunction(() => /liberado/.test(document.querySelector('#e-lib-status').textContent));
ok('Liberar os espelhos do bimestre', conta("SELECT COUNT(*) AS n FROM desempenho_documentos WHERE prova = 'ESPELHO' AND liberado_em IS NOT NULL") === 2);
ok('Sem erros de JavaScript na página', errors.length === 0, errors.join(' | '));
ok('Painel /adm/ tem "Mapas de desempenho" e o login volta para a página', /desempenho-admin\.html"><b>Mapas de desempenho/.test(fs.readFileSync(repo + 'adm/index.html', 'utf8')) && /'desempenho-admin\.html'\]/.test(fs.readFileSync(atlas + 'admin.html', 'utf8')));

await browser.close();
server.close();
for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK').length;
console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`);
process.exit(bad ? 1 : 0);
