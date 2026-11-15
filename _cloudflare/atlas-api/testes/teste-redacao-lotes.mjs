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
const { limparPdfCancelados } = await import('../redacao-lotes.js');
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
let falharExclusao = false;
const env = {
  DB: { prepare: sql => stmt(sql), batch: async ops => Promise.all(ops.map(x => x.run())) },
  ADMIN_EMAIL: 'adm@example.com', ATLAS_HOJE_TESTE: '2026-11-14',
  IMAGENS: r2Rigoroso(objetos, { falharExclusao: () => { const f = falharExclusao; falharExclusao = false; return f; } })
};
function sessao(token, tipo, email, id = null) {
  db.prepare('INSERT INTO sessoes (token_hash, tipo, email, usuario_id, expira_em) VALUES (?, ?, ?, ?, ?)')
    .run(createHash('sha256').update(token).digest('hex'), tipo, email, id, '2099-01-01T00:00:00Z');
}
sessao('adm-token', 'adm', 'adm@example.com');
const origin = 'https://idealolimpico.com.br';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
async function api(path, method = 'GET', body, token = 'adm-token', contentType = 'application/json') {
  const headers = { Origin: origin, Authorization: 'Bearer ' + token };
  if (body !== undefined) headers['Content-Type'] = contentType;
  if (Buffer.isBuffer(body)) headers['Content-Length'] = String(body.length);   /* como o navegador faz */
  const request = new Request('https://atlas-api.example' + path, {
    method, headers, body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body
  });
  const response = await worker.fetch(request, env, { waitUntil() {} });
  return { status: response.status, data: response.headers.get('Content-Type')?.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()), headers: response.headers };
}
ok('Schema 16', db.prepare("SELECT valor FROM meta WHERE chave='schema_versao'").get().valor === '16');
let r = await api('/api/adm/redacao/turmas');
const bc = r.data.turmas.find(t => t.unidade === 'BC' && t.codigo === '1EMA');
const cn = r.data.turmas.find(t => t.unidade === 'CN' && t.codigo === '1EMA');
ok('Turmas de duas unidades disponíveis', !!bc && !!cn);
r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Digitalizador BC', email: 'bc@grupoideal.com.br', funcao: 'digitalizador', unidades: ['BC'] });
const bcId = r.data.equipe.find(x => x.email === 'bc@grupoideal.com.br')?.id;
sessao('bc-token', 'usuario', 'bc@grupoideal.com.br', bcId);
r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Digitalizador CN', email: 'cn@grupoideal.com.br', funcao: 'digitalizador', unidades: ['CN'] });
const cnId = r.data.equipe.find(x => x.email === 'cn@grupoideal.com.br')?.id;
sessao('cn-token', 'usuario', 'cn@grupoideal.com.br', cnId);
r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Professora BC', email: 'prof@grupoideal.com.br', funcao: 'professor', turmas: [bc.id] });
const profId = r.data.equipe.find(x => x.email === 'prof@grupoideal.com.br')?.id;
sessao('prof-token', 'usuario', 'prof@grupoideal.com.br', profId);
r = await api('/api/redacao/lotes', 'GET', undefined, 'bc-token');
ok('Digitalizador vê só turmas da sua unidade', r.status === 200 && r.data.turmas.length > 0 && r.data.turmas.every(t => t.unidade === 'BC') && r.data.lotes.length === 0, r.data.error);
r = await api('/api/redacao/lotes', 'GET', undefined, 'prof-token');
ok('Professora não recebe acesso aos PDFs brutos', r.status === 403, r.data.error);
r = await api('/api/redacao/lotes?turma_id=' + cn.id + '&bimestre=1', 'POST', pdf, 'bc-token', 'application/pdf');
ok('Unidade alheia bloqueada', r.status === 403 && objetos.size === 0, r.data.error);
r = await api('/api/redacao/lotes?turma_id=' + bc.id + '&bimestre=1', 'POST', Buffer.from('falso'), 'bc-token', 'application/pdf');
ok('Arquivo sem assinatura PDF recusado', r.status === 415 && objetos.size === 0, r.data.error);
r = await api('/api/redacao/lotes?turma_id=' + bc.id + '&bimestre=1', 'POST', pdf, 'bc-token', 'application/pdf');
const loteId = r.data.lote_id;
ok('PDF recebido no R2 e slot ocupado', r.status === 200 && !!loteId && objetos.size === 1 && db.prepare('SELECT COUNT(*) AS n FROM redacao_lotes WHERE cancelado_em IS NULL').get().n === 1, r.data.error);
r = await api('/api/redacao/lotes?turma_id=' + bc.id + '&bimestre=1', 'POST', pdf, 'bc-token', 'application/pdf');
ok('Mesmo bimestre e turma não duplicam', r.status === 409 && objetos.size === 1, r.data.error);
r = await api('/api/redacao/lotes/' + loteId + '/pdf', 'GET', undefined, 'bc-token');
ok('Digitalizador autorizado lê o PDF privado', r.status === 200 && r.data.equals(pdf) && r.headers.get('Cache-Control').includes('no-store'));
r = await api('/api/redacao/lotes/' + loteId + '/pdf', 'GET', undefined, 'cn-token');
ok('Outra unidade não lê o PDF', r.status === 404);
r = await api('/api/adm/redacao/lotes/' + loteId + '/pdf');
ok('ADM consegue conferir o PDF', r.status === 200 && r.data.equals(pdf));
r = await api('/api/adm/redacao/lotes');
ok('ADM vê o lote e sua origem', r.status === 200 && r.data.lotes[0].digitalizador === 'Digitalizador BC' && r.data.lotes[0].codigo === '1EMA', r.data.error);
db.prepare('UPDATE redacao_lotes SET cancelavel_ate = ? WHERE id = ?').run('2000-01-01T00:00:00Z', loteId);
r = await api('/api/redacao/lotes/' + loteId, 'DELETE', undefined, 'bc-token');
ok('Digitalizador não cancela depois de 2 horas', r.status === 403 && objetos.size === 1, r.data.error);
r = await api('/api/adm/redacao/lotes/' + loteId, 'DELETE');
ok('ADM cancela depois do prazo e exclui PDF', r.status === 200 && r.data.cancelado && objetos.size === 0 && db.prepare('SELECT cancelado_em FROM redacao_lotes WHERE id = ?').get(loteId).cancelado_em, r.data.error);
r = await api('/api/adm/redacao/lotes/' + loteId + '/pdf');
ok('Lote cancelado não abre PDF', r.status === 404);
r = await api('/api/redacao/lotes?turma_id=' + bc.id + '&bimestre=1', 'POST', pdf, 'bc-token', 'application/pdf');
const novoId = r.data.lote_id;
ok('Cancelamento libera o mesmo slot', r.status === 200 && novoId !== loteId && objetos.size === 1, r.data.error);
falharExclusao = true;
r = await api('/api/redacao/lotes/' + novoId, 'DELETE', undefined, 'bc-token');
ok('Cancelamento mantém pendência se R2 falhar', r.status === 200 && r.data.cancelado && !r.data.arquivo_excluido && objetos.size === 1, r.data.error);
await limparPdfCancelados(env);
ok('Limpeza posterior exclui o PDF pendente', objetos.size === 0 && !!db.prepare('SELECT arquivo_excluido_em FROM redacao_lotes WHERE id = ?').get(novoId).arquivo_excluido_em);
r = await api('/api/redacao/lotes', 'GET', undefined, 'bc-token');
ok('Histórico mantém lotes cancelados', r.status === 200 && r.data.lotes.length === 2 && r.data.lotes.every(l => !!l.cancelado_em), r.data.error);
const pdfMaior = Buffer.concat([pdf, Buffer.alloc(4 * 1024 * 1024)]);
r = await api('/api/redacao/lotes?turma_id=' + bc.id + '&bimestre=3', 'POST', pdfMaior, 'bc-token', 'application/pdf');
ok('PDF de vários megabytes entra por fluxo', r.status === 200 && db.prepare('SELECT bytes FROM redacao_lotes WHERE id = ?').get(r.data.lote_id).bytes === pdfMaior.length, r.data.error);
await api('/api/redacao/lotes/' + r.data.lote_id, 'DELETE', undefined, 'bc-token');
ok('PDF grande cancelado sai do R2', objetos.size === 0);
{
  /* Pedido sem tamanho informado: recusado com mensagem clara, nada guardado. */
  const sem = await worker.fetch(new Request('https://atlas-api.example/api/redacao/lotes?turma_id=' + bc.id + '&bimestre=3', {
    method: 'POST', headers: { Origin: origin, Authorization: 'Bearer bc-token', 'Content-Type': 'application/pdf' },
    body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(pdf)); c.close(); } }), duplex: 'half'
  }), env, { waitUntil() {} });
  ok('Envio sem tamanho informado é recusado sem erro interno', sem.status === 411 && objetos.size === 0, sem.status);
  /* Envio interrompido (chegou menos do que o informado): recusado, nada guardado nem registrado. */
  const corte = await worker.fetch(new Request('https://atlas-api.example/api/redacao/lotes?turma_id=' + bc.id + '&bimestre=3', {
    method: 'POST', headers: { Origin: origin, Authorization: 'Bearer bc-token', 'Content-Type': 'application/pdf', 'Content-Length': String(pdf.length + 500) },
    body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(pdf)); c.close(); } }), duplex: 'half'
  }), env, { waitUntil() {} });
  const corpo = await corte.json();
  ok('Envio interrompido é recusado e não deixa lote nem arquivo', corte.status === 400 && /interrompido/.test(corpo.error) && objetos.size === 0 &&
    db.prepare('SELECT COUNT(*) AS n FROM redacao_lotes WHERE bimestre = 3 AND cancelado_em IS NULL').get().n === 0, corte.status + ' ' + corpo.error);
}

// Exercita a tela do digitalizador contra a API local simulada.
const atlas = repo + 'atlas/';
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!/^[a-z0-9.-]+$/i.test(name) || !fs.existsSync(atlas + name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : 'image/png');
  res.end(fs.readFileSync(atlas + name));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const PDFJS = (process.env.ATLAS_TESTE_TMP || '/tmp/atlas-testes') + '/pdfjs/package/build/';
await page.route('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/**', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(PDFJS + new URL(route.request().url()).pathname.split('/').pop()) }));
await page.route('https://atlas-api.marinhomalcher.workers.dev/**', async route => {
  const req = route.request();
  const path = new URL(req.url()).pathname + new URL(req.url()).search;
  const type = req.headers()['content-type'];
  const body = req.postDataBuffer();
  const token = (req.headers()['authorization'] || '').replace(/^Bearer /i, '') || 'bc-token';
  const result = await api(path, req.method(), body && type === 'application/json' ? JSON.parse(body.toString()) : body || undefined, token, type || 'application/json');
  await route.fulfill({ status: result.status, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Content-Type': result.headers.get('Content-Type') || 'application/json' }, body: Buffer.isBuffer(result.data) ? result.data : JSON.stringify(result.data) });
});
const base = 'http://127.0.0.1:' + server.address().port;
await page.goto(base + '/index.html');
await page.evaluate(() => sessionStorage.setItem('atlas_user_auth', JSON.stringify({ token: 'bc-token' })));
await page.goto(base + '/redacao.html');
await page.locator('#upload-area').waitFor({ state: 'visible' });
ok('Tela do digitalizador mostra seleção do lote', await page.locator('#bimestre').isVisible() && await page.locator('#unidade option').count() === 2);
await page.locator('#unidade').selectOption('BC');
await page.locator('#segmento').selectOption('EM');
await page.locator('#serie').selectOption('1ª Série');
ok('Turmas filtradas por unidade, segmento e série', await page.locator('#turma option').count() >= 2);
await page.locator('#turma').selectOption(String(bc.id));
await page.locator('#bimestre').selectOption('1');
await page.locator('#pdf-file').setInputFiles({ name: 'turma.pdf', mimeType: 'application/pdf', buffer: pdf });
await page.waitForFunction(() => /Não foi possível conferir/.test(document.querySelector('#ra-report').textContent), null, { timeout: 20000 }).catch(() => {});
ok('PDF que o leitor não abre: avisa e não impede o envio', /Você ainda pode enviar/.test(await page.locator('#ra-report').textContent()) && await page.locator('#send-file').isEnabled(), await page.locator('#ra-report').textContent());
await page.locator('#preview-file').click();
ok('Conferência local abre o PDF antes de enviar', await page.locator('#pdf-viewer').isVisible());
await page.locator('#viewer-close').click();
await page.locator('#send-file').click();
await page.waitForFunction(() => document.querySelector('#upload-status').textContent.includes('Lote recebido.'));
ok('Tela envia lote e oferece conferência do arquivo guardado', await page.locator('#lot-list .lot:not(.cancelled)').count() === 1 && await page.getByRole('button', { name: 'Conferir PDF guardado' }).isVisible());
await page.getByRole('button', { name: 'Conferir PDF guardado' }).click();
await page.locator('#pdf-viewer').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
ok('Conferência do PDF guardado abre após upload', await page.locator('#pdf-viewer').isVisible(), await page.locator('#upload-status').textContent());
await page.locator('#viewer-close').click();
await page.getByRole('button', { name: 'Cancelar lote' }).click();
ok('Cancelamento pede confirmação dentro da página', await page.getByRole('button', { name: 'Confirmar cancelamento' }).isVisible());
await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
await page.waitForFunction(() => document.querySelector('#upload-status').textContent.includes('Lote cancelado.'));
ok('Tela libera slot após cancelamento', await page.locator('#send-file').isEnabled() && await page.locator('#lot-list .lot.cancelled').count() === 4);
await page.setViewportSize({ width: 390, height: 840 });
ok('Portal do digitalizador cabe no celular', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await api('/api/redacao/lotes?turma_id=' + bc.id + '&bimestre=2', 'POST', pdf, 'bc-token', 'application/pdf');
await page.evaluate(() => sessionStorage.setItem('atlas_adm_token', 'adm-token'));
await page.goto(base + '/redacao-lotes-admin.html');
await page.locator('#app').waitFor({ state: 'visible' });
ok('ADM vê o lote recebido na sua tela', await page.locator('#rows tr').count() === 1 && await page.getByRole('button', { name: 'Conferir PDF' }).isVisible());
await page.getByRole('button', { name: 'Conferir PDF' }).click();
await page.locator('#pdf-viewer').waitFor({ state: 'visible' });
ok('ADM abre o PDF guardado', await page.locator('#pdf-viewer').isVisible());
await page.locator('#viewer-close').click();
await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Lote cancelado.'));
ok('ADM cancela e libera o slot', db.prepare('SELECT COUNT(*) AS n FROM redacao_lotes WHERE cancelado_em IS NULL').get().n === 0);
ok('Painel de lotes cabe no celular', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
ok('Tela sem erro JavaScript', errors.length === 0, errors.join(' | '));
await browser.close();
await new Promise(resolve => server.close(resolve));
for (const [estado, nome, extra] of results) console.log(estado.padEnd(7), nome, extra);
const falhas = results.filter(x => x[0] === 'FALHOU').length;
console.log(falhas ? `FALHOU: ${falhas} falha(s) em ${results.length}` : `TODOS: ${results.length} verificações passaram`);
if (falhas) process.exitCode = 1;
