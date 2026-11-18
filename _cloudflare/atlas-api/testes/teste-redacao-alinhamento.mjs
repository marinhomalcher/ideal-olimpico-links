// Alinhamento das folhas de Redação: endireitar, centralizar e virar 180°.
// Usa uma folha FICTÍCIA desenhada aqui (ALUNO TESTE, RA 00000), com as mesmas medidas da folha real.
// Nenhum dado de aluno real entra no repositório.
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

const { FOLHA_JS, pdfDeJpegs } = await import('./folha-ficticia.mjs');

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
let pdfjsAdulterado = false;
await page.route('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/**', route => {
  const nome = new URL(route.request().url()).pathname.split('/').pop();
  let body = fs.readFileSync(PDFJS + nome);
  if (pdfjsAdulterado) body = Buffer.concat([body, Buffer.from('\n/* alterado */')]);
  route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body });
});
await page.route('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/**', route => route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(S + 'pdflib/package/dist/pdf-lib.min.js') }));
await page.route('https://atlas-api.marinhomalcher.workers.dev/**', async route => {
  const req = route.request(), u = new URL(req.url()), type = req.headers()['content-type'], body = req.postDataBuffer();
  const token = (req.headers()['authorization'] || '').replace(/^Bearer /i, '');
  const result = await api(u.pathname + u.search, req.method(), body && type === 'application/json' ? JSON.parse(body.toString()) : body || undefined, token, type || 'application/json');
  await route.fulfill({ status: result.status, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Content-Type': result.headers.get('Content-Type') || 'application/json' }, body: Buffer.isBuffer(result.data) ? result.data : JSON.stringify(result.data) });
});
await page.goto(base + '/index.html');
await page.evaluate(() => sessionStorage.setItem('atlas_adm_token', 'adm-token'));
await page.goto(base + '/redacao-lotes-admin.html');
await page.locator('#app').waitFor({ state: 'visible' });
await page.addScriptTag({ content: FOLHA_JS });

// ---------- 1. a peça de alinhamento sozinha ----------
const casos = await page.evaluate(() => {
  const A = window.AtlasAlinhamento, folha = window.folhaTeste(), avulsa = window.folhaTeste({ avulsa: true }), out = [];
  const roda = (nome, f, op) => {
    const t0 = performance.now(), r = A.analisar(window.escanear(f, op)), ms = performance.now() - t0;
    out.push({ nome, op, ms, erro: window.erroAlinhamento(f, op, r), incl: r.inclinacao, inv: r.invertida, marc: r.marcadores, avisos: r.avisos, ra: r.ra });
  };
  const angulos = [0, 0.3, -0.6, 1.2, -2, 3.5, -5];
  angulos.forEach((ang, i) => roda('folha ' + ang + '°', folha, { ang, dx: [0, 12, -20, 8, -5, 25, -15][i], dy: [0, -9, 14, 30, -22, 5, 18][i], escala: [1, 0.98, 1.02, 1, 0.99, 1.01, 1][i], cinza: i % 2 === 1 }));
  for (const ang of [180, 178.8, 181.5]) roda('de cabeça para baixo ' + ang + '°', folha, { ang, dx: 10, dy: -12, cinza: ang !== 180 });
  roda('avulsa 0,8°', avulsa, { ang: 0.8, dx: -6, dy: 9 });
  roda('avulsa de cabeça para baixo', avulsa, { ang: 181, dx: 4, dy: 4, cinza: true });
  roda('sem o marcador de baixo à direita', folha, { ang: -1.3, dx: 6, tapar: 'id' });
  roda('sem o marcador de cima à esquerda, em cinza', folha, { ang: 2.2, cinza: true, tapar: 'se' });
  const nova = window.folhaTeste({ codigoAbaixo: true });
  roda('código ao lado do 1º DIA 0,9°', nova, { ang: 0.9, dx: 7, dy: -6 });
  roda('código ao lado do 1º DIA de cabeça para baixo', nova, { ang: 180.6, dx: -5, dy: 8, cinza: true });
  return out;
});
const normais = casos.filter(c => c.nome.startsWith('folha '));
const esperado = c => -(c.op.ang > 90 ? c.op.ang - 180 : c.op.ang);
ok('Folhas inclinadas de −5° a +3,5° ficam retas (erro ≤ 0,1°)', normais.every(c => Math.abs(c.incl - esperado(c)) <= 0.1), normais.map(c => c.nome + '→' + c.incl).join(' '));
ok('Folhas ficam centralizadas no lugar do modelo (erro ≤ 2,5 px)', normais.every(c => c.erro <= 2.5), normais.map(c => c.erro.toFixed(1)).join(' '));
ok('Os 4 marcadores achados, em cores e em cinza', normais.every(c => c.marc === 4 && !c.avisos.length), normais.map(c => c.marc + ':' + c.avisos.join('|')).join(' '));
const inv = casos.filter(c => c.nome.startsWith('de cabeça'));
ok('Folha de cabeça para baixo é virada sozinha', inv.every(c => c.inv && c.erro <= 2.5 && Math.abs(c.incl - esperado(c)) <= 0.1), inv.map(c => c.inv + '/' + c.erro.toFixed(1) + '/' + c.incl).join(' '));
const av = casos.filter(c => c.nome.startsWith('avulsa'));
ok('Folha avulsa (sem nome nem código) também alinha', !av[0].inv && av[0].erro <= 2.5 && av[0].marc === 4, JSON.stringify(av[0]));
ok('Avulsa de cabeça para baixo também é virada', av[1].inv && av[1].erro <= 2.5, JSON.stringify(av[1]));
ok('RA lido em todas as folhas (inclinadas, em cinza, de cabeça para baixo)', [...normais, ...inv].every(c => c.ra === '73519'), [...normais, ...inv].map(c => c.ra).join(' '));
ok('Folha avulsa fica sem RA', av.every(c => c.ra === null), av.map(c => c.ra).join(' '));
const novas = casos.filter(c => c.nome.startsWith('código ao lado'));
ok('Folha nova: código ao lado do "1º DIA", com cantos em volta, é lido (inclusive de cabeça para baixo)', novas.length === 2 && novas.every(c => c.ra === '73519' && c.erro <= 2.5), novas.map(c => c.ra + '/' + c.erro.toFixed(1)).join(' '));
const cod = await page.evaluate(() => {
  const A = window.AtlasAlinhamento, ida = t => A.decodificar(window.code128(t).map(x => x * 3));
  const ruim = window.code128('73519').map(x => x * 3); ruim[13] += 3; ruim[14] -= 3;   /* um símbolo trocado: o dígito verificador não confere */
  return { par: ida('123456'), impar: ida('73519'), texto: ida('AB-12'), ruim: A.decodificar(ruim) };
});
ok('Code 128 decodifica conjuntos B e C, com troca', cod.par === '123456' && cod.impar === '73519' && cod.texto === 'AB-12', JSON.stringify(cod));
ok('Código com dígito verificador errado é descartado', cod.ruim === null, cod.ruim);
const tres = casos.filter(c => c.nome.startsWith('sem o marcador'));
ok('Com só 3 marcadores, alinha e avisa', tres.every(c => c.marc === 3 && c.erro <= 3 && c.avisos.some(a => a.includes('3 dos 4'))), tres.map(c => c.marc + '/' + c.erro.toFixed(1)).join(' '));
ok('Análise rápida (< 1,5 s por página)', casos.every(c => c.ms < 1500), Math.max(...casos.map(c => c.ms)).toFixed(0) + ' ms');

const extra = await page.evaluate(() => {
  const A = window.AtlasAlinhamento, folha = window.folhaTeste(), op = { ang: 1, dx: 5 }, scan = window.escanear(folha, op), r = A.analisar(scan);
  const giro = m => Math.atan2(m.q, m.p) * 180 / Math.PI;
  const mais = A.matrizFinal(r, { ajuste: 0.25 }), virada = A.matrizFinal(r, { girar: true });
  const W = folha.width, H = W * A.MODELO.proporcao, c = A.MODELO.cantos, se = window.leva([c.se[0] * W, c.se[1] * H], folha, op);
  const d = [virada.p * se[0] - virada.q * se[1] + virada.e, virada.q * se[0] + virada.p * se[1] + virada.f];
  const branco = document.createElement('canvas'); branco.width = 1240; branco.height = 1754; const bx = branco.getContext('2d'); bx.fillStyle = '#fff'; bx.fillRect(0, 0, 1240, 1754);
  const rb = A.analisar(branco);
  const destino = document.createElement('canvas'); A.desenhar(destino, scan, r, { guia: true });
  return { ajuste: giro(mais) - giro(r.matriz), viradaErro: Math.hypot(d[0] - c.id[0] * W, d[1] - c.id[1] * H), branco: rb, destino: [destino.width, destino.height] };
});
ok('Ajuste fino +0,25° gira exatamente 0,25°', Math.abs(extra.ajuste - 0.25) < 1e-9, extra.ajuste);
ok('"Girar 180°" leva cada canto ao lugar do oposto', extra.viradaErro <= 2.5, extra.viradaErro);
ok('Página em branco não quebra e avisa', extra.branco.marcadores === 0 && extra.branco.avisos.some(a => a.includes('não encontrados')) && extra.branco.avisos.some(a => a.includes('Girar 180')), extra.branco.avisos.join('|'));
ok('Folha alinhada sai no tamanho A4 do modelo', extra.destino[0] === 1240 && extra.destino[1] === 1754, extra.destino);

// ---------- 2. prévia na tela de Lotes do ADM, com um PDF "escaneado" fictício ----------
const jpegs = await page.evaluate(() => {
  const f = window.folhaTeste(), av = window.folhaTeste({ avulsa: true });
  return [window.escanear(f, { ang: 1.5, dx: 10 }), window.escanear(f, { ang: 179, dy: 8, cinza: true }), window.escanear(av, { ang: -0.8 })].map(c => ({ jpeg: window.jpeg(c), w: c.width, h: c.height }));
});
const pdf = pdfDeJpegs(jpegs.map(j => ({ ...j, jpeg: Buffer.from(j.jpeg, 'base64') })));
let r = await api('/api/adm/redacao/turmas');
const bc = r.data.turmas.find(t => t.unidade === 'BC' && t.codigo === '3EMA');
r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Digitalizador BC', email: 'bc@grupoideal.com.br', funcao: 'digitalizador', unidades: ['BC'] });
sessao('bc-token', 'usuario', 'bc@grupoideal.com.br', r.data.equipe.find(x => x.email === 'bc@grupoideal.com.br')?.id);
const envio4 = (await api('/api/redacao/envios', 'POST', { bimestre: 4, unidade: 'BC' }, 'bc-token')).data.envio_id;
r = await api('/api/redacao/lotes?envio=' + envio4 + '&turma_id=' + bc.id + '&paginas=3', 'POST', pdf, 'bc-token', 'application/pdf');
ok('PDF fictício de 3 páginas recebido como lote', r.status === 200 && !!r.data.lote_id, r.data.error);
await page.reload();
await page.locator('#app').waitFor({ state: 'visible' });
await page.getByRole('button', { name: 'Ver páginas alinhadas' }).click();
await page.locator('#align-viewer').waitFor({ state: 'visible' });
await page.waitForFunction(() => /3 páginas/.test(document.querySelector('#align-summary').textContent), null, { timeout: 30000 }).catch(() => {});
const resumo = await page.locator('#align-summary').textContent();
ok('Prévia analisa as 3 páginas e resume', /3 páginas/.test(resumo) && /1 estava de cabeça para baixo/.test(resumo) && /maior inclinação corrigida: 1,(4[0-9]|5[0-9])°/.test(resumo) && !/aviso/.test(resumo), resumo);
ok('Página 1: 4 marcadores e inclinação corrigida', /Marcadores: 4 de 4/.test(await page.locator('#align-page-info').textContent()) && /−1,(4[0-9]|5[0-9])°/.test(await page.locator('#align-page-info').textContent()), await page.locator('#align-page-info').textContent());
ok('Mostra antes e depois no tamanho da folha', await page.evaluate(() => document.querySelector('#align-after').width === 1240 && document.querySelector('#align-before').width > 0));
await page.locator('#align-next').click();
await page.waitForFunction(() => document.querySelector('#align-pos').textContent === 'Página 2 de 3' && /cabeça para baixo/.test(document.querySelector('#align-page-info').textContent));
ok('Página 2 aparece como "estava de cabeça para baixo"', true);
/* Ângulo mostrado = correção automática + cliques; os botões não podem sair do lugar. */
const angulo = async () => { const m = (await page.locator('#align-page-info').textContent()).match(/Inclinação corrigida: ([+−]?)(\d+),(\d+)°/); return m ? (m[1] === '−' ? -1 : 1) * Number(m[2] + '.' + m[3]) : NaN; };
const posicoes = () => page.evaluate(() => ['#align-prev', '#align-next', '#align-minus', '#align-plus', '#align-flip', '#align-reset', '#align-guide'].map(id => { const r = document.querySelector(id).getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)].join(','); }).join(' '));
const ang0 = await angulo(), pos0 = await posicoes(), mexeu = [];
await page.locator('#align-plus').click();
ok('Botão +0,25° soma ao ângulo mostrado (sem frase extra)', Math.abs(await angulo() - (ang0 + 0.25)) < 0.001 && !/ajuste fino/.test(await page.locator('#align-page-info').textContent()), ang0 + ' → ' + await angulo());
if (await posicoes() !== pos0) mexeu.push('+0,25°');
await page.locator('#align-minus').click(); await page.locator('#align-minus').click();
ok('Botão −0,25° desconta do ângulo mostrado', Math.abs(await angulo() - (ang0 - 0.25)) < 0.001, await angulo());
if (await posicoes() !== pos0) mexeu.push('−0,25°');
await page.locator('#align-flip').click();
ok('Botão "Girar 180°" muda só a imagem, não o texto', !/à mão|180/.test(await page.locator('#align-page-info').textContent()) && Math.abs(await angulo() - (ang0 - 0.25)) < 0.001);
if (await posicoes() !== pos0) mexeu.push('Girar 180°');
await page.locator('#align-reset').click();
ok('"Desfazer ajustes" volta ao ângulo automático', Math.abs(await angulo() - ang0) < 0.001);
if (await posicoes() !== pos0) mexeu.push('Desfazer');
ok('Botões não saem do lugar depois dos cliques', !mexeu.length, mexeu.join(', '));
const antesProx = await posicoes();
await page.locator('#align-next').click();
await page.waitForFunction(() => document.querySelector('#align-pos').textContent === 'Página 3 de 3');
ok('Trocar de página não mexe nos botões', await posicoes() === antesProx, antesProx + ' / ' + await posicoes());
ok('Avulsa (página 3) alinhada sem aviso', /Marcadores: 4 de 4/.test(await page.locator('#align-page-info').textContent()) && !(await page.locator('#align-warn').textContent()));
ok('Nada foi gravado no banco nem no R2', objetos.size === 1 && db.prepare('SELECT COUNT(*) AS n FROM redacao_lotes').get().n === 1);
await page.setViewportSize({ width: 390, height: 840 });
ok('Prévia cabe no celular', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await page.locator('#align-close').click();
ok('Fechar esconde a prévia', await page.locator('#align-viewer').isHidden());

// ---------- 3. digitalizador: envio automático por bimestre e unidade (v17) ----------
await page.addScriptTag({ content: FOLHA_JS });   /* a página foi recarregada */
const pdfDe = async lista => { if (!await page.evaluate(() => typeof window.folhaTeste === 'function')) await page.addScriptTag({ content: FOLHA_JS }); return pdfDe2(lista); };
const pdfDe2 = async lista => pdfDeJpegs((await page.evaluate(l => l.map(o => { const c = window.escanear(window.folhaTeste(o.folha), o.scan); return { jpeg: window.jpeg(c), w: c.width, h: c.height }; }), lista)).map(j => ({ ...j, jpeg: Buffer.from(j.jpeg, 'base64') })));
const { PDFDocument } = require(S + 'pdflib/package/dist/pdf-lib.min.js');
const contagem = new Map();
const paginasPdf = buf => contagem.get(buf) ?? -1;
const contar = async (...bufs) => { for (const b of bufs) if (b) contagem.set(b, (await PDFDocument.load(b)).getPageCount()); };
const turmas = (await api('/api/adm/redacao/turmas')).data.turmas;
const t2 = turmas.find(t => t.unidade === 'BC' && t.codigo === '2EMA'), tcn = turmas.find(t => t.unidade === 'CN' && t.codigo === '3EMA');
const m1 = turmas.find(t => t.unidade === 'BC' && t.codigo === '1MED'), m2 = turmas.find(t => t.unidade === 'BC' && t.codigo === '2MED'), c1 = turmas.find(t => t.unidade === 'CN' && t.codigo === '1EMA');
r = await api('/api/redacao/lotes/conferir', 'POST', { bimestre: 2, unidade: 'BC', ras: ['61111'] }, 'bc-token');
ok('Conferência avisa que o cadastro de alunos está vazio', r.status === 200 && r.data.cadastro_vazio && r.data.alunos[0].situacao === 'fora_cadastro', JSON.stringify(r.data));
const aluno = db.prepare('INSERT INTO redacao_alunos (ra, nome, turma_id, ano, segmento, serie) VALUES (?, ?, ?, ?, ?, ?)');
const ano = db.prepare('SELECT ano FROM redacao_turmas WHERE id = ?').get(bc.id).ano;
aluno.run('11111', 'ALUNO TESTE UM', bc.id, ano, 'EM', '3ª Série');
aluno.run('22222', 'ALUNO TESTE DOIS', bc.id, ano, 'EM', '3ª Série');
aluno.run('33333', 'ALUNO TESTE TRES', t2.id, ano, 'EM', '2ª Série');
aluno.run('44444', 'ALUNO TESTE QUATRO', t2.id, ano, 'EM', '2ª Série');
aluno.run('55555', 'ALUNO TESTE CINCO', tcn.id, ano, 'EM', '3ª Série');
for (const [ra, nome, t] of [['61111', 'MARIA FICTICIA', m1], ['62222', 'JOAO FICTICIO', m1], ['66666', 'ANA FICTICIA', m1], ['68888', 'PEDRO FICTICIO', m1],
  ['63333', 'LUIZA FICTICIA', m2], ['64444', 'CARLOS FICTICIO', m2], ['65555', 'BEATRIZ FICTICIA (CN)', c1]]) aluno.run(ra, nome, t.id, ano, 'EM', t.serie);
/* professora fictícia de 1MED (para o resumo mostrar o nome) */
r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Professora Fictícia', email: 'prof1med@grupoideal.com.br', funcao: 'professor', turmas: [m1.id] });
r = await api('/api/redacao/lotes/conferir', 'POST', { bimestre: 2, unidade: 'BC', ras: ['61111', '63333', '65555', '99999'] }, 'bc-token');
const sit = Object.fromEntries((r.data.alunos || []).map(x => [x.ra, x]));
const tconf = Object.fromEntries((r.data.turmas || []).map(x => [x.codigo + x.unidade, x]));
ok('Conferência acha a turma de cada aluno (inclusive de outra unidade) e o fora da lista', r.status === 200 && sit['61111'].turma_id === m1.id && sit['63333'].turma_id === m2.id && sit['65555'].unidade === 'CN' && sit['99999'].situacao === 'fora_cadastro', JSON.stringify(r.data.alunos));
ok('Conferência traz professora, lote e lista de alunos de cada turma', tconf['1MEDBC']?.professoras?.[0] === 'Professora Fictícia' && tconf['1MEDBC'].lote === null && tconf['1MEDBC'].alunos.length === 4 && tconf['2MEDBC'].professoras.length === 0, JSON.stringify(r.data.turmas));
r = await api('/api/redacao/lotes/conferir', 'POST', { bimestre: 2, unidade: 'CN', ras: ['61111'] }, 'bc-token');
ok('Digitalizador não escolhe unidade que não é dele', r.status === 403, r.status);
r = await api('/api/redacao/lotes/conferir', 'POST', { bimestre: 2, unidade: 'BC', ras: ['61111'] }, 'prof-inexistente');
ok('Conferência exige login de digitalizador', r.status === 401 || r.status === 403, r.status);
r = await api('/api/redacao/lotes/conferir', 'POST', { bimestre: 2, unidade: 'BC', ras: ['12a'] }, 'bc-token');
ok('RA inválido é recusado', r.status === 400, r.status);
ok('Conferência não grava nada', db.prepare('SELECT COUNT(*) AS n FROM redacao_lotes').get().n === 1);

/* Tela do digitalizador: 1º envio, pilha da 1MED com uma folha sem código */
await page.setViewportSize({ width: 1280, height: 900 });
await page.evaluate(() => sessionStorage.setItem('atlas_user_auth', JSON.stringify({ token: 'bc-token' })));
await page.goto(base + '/redacao.html');
await page.locator('#upload-area').waitFor({ state: 'visible' });
ok('Tela pede só bimestre, unidade e o PDF', await page.locator('#bimestre').isVisible() && await page.locator('#unidade').isVisible() && await page.locator('#turma').count() === 0 && await page.locator('#serie').count() === 0);
await page.locator('#bimestre').selectOption('2');
await page.locator('#unidade').selectOption('BC');
const esperaRelatorio = () => page.waitForFunction(() => { const t = document.querySelector('#ra-report').textContent; return /identificad/.test(t) && !/Conferindo|Lendo/.test(t); }, null, { timeout: 40000 });
const enviarEEsperar = async () => { const antes = await page.locator('#upload-status').textContent(); await page.locator('#send-file').click(); await page.waitForFunction(a => { const t = document.querySelector('#upload-status').textContent; return t !== a && !/^Enviando/.test(t); }, antes, { timeout: 40000 }).catch(() => {}); };
const pdfA = await pdfDe([{ folha: { ra: '61111' }, scan: { ang: 0.7 } }, { folha: { ra: '62222' }, scan: { ang: 179.5, cinza: true } }, { folha: { avulsa: true }, scan: { ang: -0.4 } }]);
await page.locator('#pdf-file').setInputFiles({ name: 'turma.pdf', mimeType: 'application/pdf', buffer: pdfA });
await esperaRelatorio();
let rel = await page.locator('#ra-report').textContent();
ok('Resumo: 3 páginas, 2 identificados, 1 para decidir; turma, professora e lote novo', /3 páginas · 2 alunos identificados · 1 folha para você decidir/.test(rel) && /1MED · Batista Campos/.test(rel) && /Professora Fictícia/.test(rel) && /lote novo/.test(rel), rel);
ok('Envio fica travado até decidir a folha sem código', await page.locator('#send-file').isDisabled());
const opcoesDec = await page.locator('.dec select option').allTextContents();
ok('Folha sem código: lista só os alunos da turma que faltam, descartar e ADM', opcoesDec.some(o => /ANA FICTICIA/.test(o)) && opcoesDec.some(o => /PEDRO FICTICIO/.test(o)) && !opcoesDec.some(o => /MARIA FICTICIA/.test(o)) && opcoesDec.some(o => /Descartar/.test(o)) && opcoesDec.some(o => /ADM/.test(o)), opcoesDec.join(' | '));
ok('A decisão mostra o cabeçalho da folha', await page.locator('.dec img').count() === 1 && (await page.locator('.dec img').getAttribute('src')).startsWith('data:image/jpeg'));
await page.locator('.dec select').selectOption('ra:66666');
ok('Depois de decidir, o envio é liberado', await page.locator('#send-file').isEnabled());
await enviarEEsperar();
ok('Envio concluído informa a turma', /Envio concluído: 1MED \(3 folhas\)/.test(await page.locator('#upload-status').textContent()), await page.locator('#upload-status').textContent());
const loteM1 = db.prepare('SELECT * FROM redacao_lotes WHERE turma_id = ? AND bimestre = 2 AND cancelado_em IS NULL').get(m1.id);
await contar(objetos.get(loteM1?.r2_key));
let pagsM1 = db.prepare('SELECT pagina, ra_lido, situacao, aluno_ra, resolvido_por, envio_id FROM redacao_paginas WHERE lote_id = ? ORDER BY pagina').all(loteM1?.id ?? 0);
ok('Lote da 1MED com 3 folhas: 2 pelo código e 1 escolhida pelo digitalizador', loteM1?.paginas_arquivo === 3 && paginasPdf(objetos.get(loteM1.r2_key)) === 3 && pagsM1.map(p => p.aluno_ra).join() === '61111,62222,66666' &&
  pagsM1[2].resolvido_por === 'bc@grupoideal.com.br' && !pagsM1[0].resolvido_por && pagsM1.every(p => p.envio_id), JSON.stringify(pagsM1));
ok('"Seus envios" mostra o envio com "Desfazer envio"', /1MED: 3 folhas/.test(await page.locator('#lot-list').textContent()) && await page.locator('#lot-list .lot').first().getByRole('button', { name: 'Desfazer envio' }).isEnabled());

/* 2º envio: pilha da 2MED com um aluno da CN no meio e um aluno fora da lista */
const pdfB = await pdfDe([{ folha: { ra: '63333' }, scan: { ang: 1 } }, { folha: { ra: '64444' }, scan: { ang: -1 } }, { folha: { ra: '65555' }, scan: { ang: 0.3 } }, { folha: { ra: '77777' }, scan: { ang: 0.2 } }]);
await page.locator('#pdf-file').setInputFiles({ name: 'mista.pdf', mimeType: 'application/pdf', buffer: pdfB });
await esperaRelatorio();
rel = await page.locator('#ra-report').textContent();
ok('Aluno de outra unidade segue para a turma dele; fora da lista vai ao ADM sem travar', /4 páginas · 3 alunos identificados/.test(rel) && !/para você decidir/.test(rel.split('Turma')[0]) && /2MED · Batista Campos.*3 \(1 para o ADM\)/.test(rel) && /1EMA · Cidade Nova/.test(rel) && /sem professora cadastrada/.test(rel) && !/maioria das folhas/.test(rel), rel);
ok('Sem pendências, o envio já fica liberado', await page.locator('#send-file').isEnabled());
await enviarEEsperar();
ok('Envio separa as folhas por turma', /Envio concluído: 2MED \(3 folhas\), 1EMA \(1 folha\)/.test(await page.locator('#upload-status').textContent()), await page.locator('#upload-status').textContent());
const loteM2 = db.prepare('SELECT * FROM redacao_lotes WHERE turma_id = ? AND bimestre = 2 AND cancelado_em IS NULL').get(m2.id);
const loteC1 = db.prepare('SELECT * FROM redacao_lotes WHERE turma_id = ? AND bimestre = 2 AND cancelado_em IS NULL').get(c1.id);
await contar(objetos.get(loteM2?.r2_key), objetos.get(loteC1?.r2_key));
const pagsM2 = db.prepare('SELECT situacao, motivo, aluno_ra, ra_lido FROM redacao_paginas WHERE lote_id = ? ORDER BY pagina').all(loteM2?.id ?? 0);
ok('2MED recebe os dela e a folha do aluno fora da lista (para o ADM); CN recebe a do aluno dela', !!loteM2 && !!loteC1 && paginasPdf(objetos.get(loteM2.r2_key)) === 3 && paginasPdf(objetos.get(loteC1.r2_key)) === 1 &&
  pagsM2.map(p => p.situacao + ':' + (p.aluno_ra || p.motivo)).join() === 'aluno:63333,aluno:64444,duvida:fora_cadastro' &&
  db.prepare('SELECT aluno_ra FROM redacao_paginas WHERE lote_id = ?').get(loteC1?.id ?? 0)?.aluno_ra === '65555', JSON.stringify(pagsM2));

/* 3º envio: uma folha atrasada da 1MED entra no fim do lote já enviado; uma repetida é descartada */
const pdfC = await pdfDe([{ folha: { ra: '68888' }, scan: { ang: 0.4 } }, { folha: { ra: '61111' }, scan: { ang: -0.3 } }]);
await page.locator('#pdf-file').setInputFiles({ name: 'atrasadas.pdf', mimeType: 'application/pdf', buffer: pdfC });
await esperaRelatorio();
rel = await page.locator('#ra-report').textContent();
ok('Folhas de turma já enviada: "acrescenta ao lote" e o aluno repetido pede decisão', /acrescenta ao lote já enviado \(3 folhas\)/.test(rel) && /aluno repetido/.test(rel) && await page.locator('#send-file').isDisabled(), rel);
await page.locator('.dec select').selectOption('descartar');
await enviarEEsperar();
pagsM1 = db.prepare('SELECT pagina, situacao, aluno_ra FROM redacao_paginas WHERE lote_id = ? ORDER BY pagina').all(loteM1.id);
const loteM1b = db.prepare('SELECT * FROM redacao_lotes WHERE id = ?').get(loteM1.id);
await contar(objetos.get(loteM1b.r2_key));
ok('As folhas novas entram no fim do mesmo lote; as antigas mantêm o número', /Envio concluído: 1MED \(2 folhas\)/.test(await page.locator('#upload-status').textContent()) && loteM1b.paginas_arquivo === 5 && paginasPdf(objetos.get(loteM1b.r2_key)) === 5 &&
  !objetos.has(loteM1.r2_key) && pagsM1.map(p => p.pagina + ':' + (p.aluno_ra || p.situacao)).join() === '1:61111,2:62222,3:66666,4:68888,5:descartada', JSON.stringify(pagsM1));
await page.setViewportSize({ width: 390, height: 840 });
ok('Tela do digitalizador cabe no celular', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await page.setViewportSize({ width: 1280, height: 900 });

/* API: proteções do envio */
const envioId = (await api('/api/redacao/envios', 'POST', { bimestre: 2, unidade: 'BC' }, 'bc-token')).data.envio_id;
r = await api('/api/redacao/lotes/' + loteM2.id + '/paginas', 'POST', { envio_id: envioId, paginas: [{ pagina: 4, ra_lido: '61111', destino: 'aluno' }] }, 'bc-token');
ok('Servidor recusa aluno de outra turma no lote', r.status === 400 || r.status === 409, r.status + ' ' + r.data.error);
r = await api('/api/redacao/lotes/' + loteM2.id + '/paginas', 'POST', { envio_id: envioId, paginas: [{ pagina: 2, ra_lido: '64444', destino: 'aluno' }] }, 'bc-token');
ok('Servidor recusa página que já existe no lote', r.status === 400, r.status);
r = await api('/api/redacao/lotes?envio=' + envioId + '&turma_id=' + m2.id + '&paginas=1', 'POST', pdfA, 'bc-token', 'application/pdf');
ok('Turma que já tem lote no bimestre não ganha outro', r.status === 409, r.status);
r = await api('/api/redacao/lotes/' + loteM2.id + '/arquivo?envio=' + envioId + '&antes=1&paginas=4', 'PUT', pdfA, 'bc-token', 'application/pdf');
ok('Acréscimo com contagem errada é recusado (lote mudou)', r.status === 409, r.status);
sessao('bc2-token', 'usuario', 'bc2@grupoideal.com.br', (await api('/api/adm/redacao/equipe', 'POST', { nome: 'Outro Digitalizador BC', email: 'bc2@grupoideal.com.br', funcao: 'digitalizador', unidades: ['BC'] })).data.equipe.find(x => x.email === 'bc2@grupoideal.com.br').id);
const envioB = db.prepare('SELECT envio_id FROM redacao_paginas WHERE lote_id = ? LIMIT 1').get(loteM2.id).envio_id;
r = await api('/api/redacao/envios/' + envioB, 'DELETE', undefined, 'bc2-token');
ok('Outro digitalizador não desfaz o envio', r.status === 404, r.status);
/* desfazer: o 2º envio criou os lotes da 2MED e da CN, sem correção → os dois são cancelados */
await page.reload();
await page.locator('#lot-list .lot').first().waitFor();
const cartaoB = page.locator('#lot-list .lot', { hasText: '2MED' });
await cartaoB.getByRole('button', { name: 'Desfazer envio' }).click();
await cartaoB.getByRole('button', { name: 'Confirmar: desfazer' }).click();
await page.waitForFunction(() => /Envio desfeito/.test(document.querySelector('#upload-status').textContent), null, { timeout: 15000 }).catch(() => {});
ok('Desfazer envio cancela os lotes que ele criou e apaga os PDFs', /Envio desfeito/.test(await page.locator('#upload-status').textContent()) &&
  !!db.prepare('SELECT cancelado_em FROM redacao_lotes WHERE id = ?').get(loteM2.id).cancelado_em && !!db.prepare('SELECT cancelado_em FROM redacao_lotes WHERE id = ?').get(loteC1.id).cancelado_em &&
  !objetos.has(loteM2.r2_key) && !objetos.has(loteC1.r2_key), await page.locator('#upload-status').textContent());
/* depois que a professora começa a corrigir, só o ADM desfaz */
const envioA = db.prepare('SELECT envio_id FROM redacao_paginas WHERE lote_id = ? AND pagina = 1').get(loteM1.id).envio_id;
db.prepare("INSERT INTO redacao_correcoes (lote_id, pagina, aluno_ra, professor_id, enviada_em) VALUES (?, 1, '61111', 1, '2026-11-13T10:00:00Z')").run(loteM1.id);
r = await api('/api/redacao/envios/' + envioA, 'DELETE', undefined, 'bc-token');
ok('Com correção começada, o digitalizador não desfaz', r.status === 409 && /começou a corrigir/.test(r.data.error), r.data.error);
const envioC = db.prepare('SELECT envio_id FROM redacao_paginas WHERE lote_id = ? AND pagina = 4').get(loteM1.id).envio_id;
r = await api('/api/redacao/envios/' + envioC, 'DELETE', undefined, 'bc-token');
ok('Desfazer folhas acrescentadas tira só elas do lote (o lote continua)', r.status === 200 && r.data.folhas_retiradas === 2 && !db.prepare('SELECT cancelado_em FROM redacao_lotes WHERE id = ?').get(loteM1.id).cancelado_em &&
  db.prepare('SELECT COUNT(*) AS n FROM redacao_paginas WHERE lote_id = ?').get(loteM1.id).n === 3, JSON.stringify(r.data));
db.prepare('DELETE FROM redacao_correcoes WHERE lote_id = ?').run(loteM1.id);

/* Para a parte do ADM: lote da 2EMA (1º bimestre) com uma folha de aluno de outra unidade, lido pelo ADM. */
const envioT2 = (await api('/api/redacao/envios', 'POST', { bimestre: 1, unidade: 'BC' }, 'bc-token')).data.envio_id;
const pdfErrado = await pdfDe([{ folha: { ra: '33333' }, scan: { ang: 1 } }, { folha: { ra: '44444' }, scan: { ang: -1 } }, { folha: { ra: '55555' }, scan: { ang: 0.3 } }]);
r = await api('/api/redacao/lotes?envio=' + envioT2 + '&turma_id=' + t2.id + '&paginas=3', 'POST', pdfErrado, 'bc-token', 'application/pdf');
const loteT2 = r.data.lote_id;
r = await api('/api/adm/redacao/lotes/' + loteT2 + '/paginas', 'POST', { paginas: [{ pagina: 1, ra: '33333' }, { pagina: 2, ra: '44444' }, { pagina: 3, ra: '55555' }] });
ok('ADM refaz a leitura pela API', r.status === 200 && r.data.resumo.aluno === 2 && r.data.resumo.duvida === 1 && r.data.paginas[2].lido_unidade === 'CN', JSON.stringify(r.data.resumo));

await page.setViewportSize({ width: 1280, height: 900 });
await page.evaluate(() => sessionStorage.setItem('atlas_adm_token', 'adm-token'));
await page.goto(base + '/redacao-lotes-admin.html');
await page.locator('#app').waitFor({ state: 'visible' });
const linhaT2 = page.locator('#rows tr', { hasText: '2EMA' });
ok('Lista de lotes mostra o resumo das folhas', /2 alunos · 0 avulsas · 1 dúvidas/.test(await linhaT2.textContent()), await linhaT2.textContent());
ok('Lote sem leitura aparece como "leitura pendente"', /leitura pendente/.test(await page.locator('#rows tr', { hasText: '3EMA' }).first().textContent()));
await linhaT2.getByRole('button', { name: 'Folhas e dúvidas (1)' }).click();
await page.locator('#fl-linhas tr').first().waitFor();
ok('Dúvidas aparecem primeiro, com o motivo', /Dúvida: aluno de outra unidade/.test(await page.locator('#fl-linhas tr').first().textContent()) && await page.locator('#fl-linhas tr').count() === 3);
await page.locator('#fl-linhas tr').first().locator('select').selectOption('55555');
await page.locator('#fl-linhas tr').first().getByRole('button', { name: 'Atribuir' }).click();
await page.waitForFunction(() => /atribuída/.test(document.querySelector('#fl-status').textContent));
ok('ADM atribui a dúvida a um aluno (exceção de outra unidade)', db.prepare('SELECT situacao, aluno_ra, resolvido_por FROM redacao_paginas WHERE lote_id = ? AND pagina = 3').get(loteT2).aluno_ra === '55555' && /Atribuída pelo ADM/.test(await page.locator('#fl-linhas').textContent()));
ok('Página identificada mostra só "Ver folha" e "Corrigir"', await page.locator('#fl-linhas tr[data-pagina="1"] select').isHidden() && await page.locator('#fl-linhas tr[data-pagina="1"]').getByRole('button', { name: 'Corrigir' }).isVisible());
await page.locator('#fl-linhas tr[data-pagina="1"]').getByRole('button', { name: 'Corrigir' }).click();
await page.locator('#fl-linhas tr[data-pagina="1"] select').selectOption('__outro');
await page.locator('#fl-linhas tr[data-pagina="1"] input').fill('55555');
await page.locator('#fl-linhas tr[data-pagina="1"]').getByRole('button', { name: 'Atribuir' }).click();
await page.waitForFunction(() => /já está na página 3/.test(document.querySelector('#fl-status').textContent)).catch(() => {});
ok('O mesmo aluno não fica em duas páginas do lote', /já está na página 3/.test(await page.locator('#fl-status').textContent()), await page.locator('#fl-status').textContent());
await page.locator('#fl-linhas tr[data-pagina="2"]').getByRole('button', { name: 'Corrigir' }).click();
await page.locator('#fl-linhas tr[data-pagina="2"]').getByRole('button', { name: 'Descartar' }).click();
await page.waitForFunction(() => /descartada/.test(document.querySelector('#fl-status').textContent));
ok('ADM descarta uma página', db.prepare('SELECT situacao FROM redacao_paginas WHERE lote_id = ? AND pagina = 2').get(loteT2).situacao === 'descartada');
await page.locator('#fl-fechar').click();
await page.waitForFunction(() => /descartadas/.test(document.querySelector('#rows').textContent));
ok('Lista atualiza o resumo depois das decisões', /2 alunos · 0 avulsas · 0 dúvidas · 1 descartadas/.test(await linhaT2.textContent()), await linhaT2.textContent());
/* Refazer a leitura de um lote que chegou sem leitura (o da prévia, 3EMA / 4º bimestre). */
await page.locator('#rows tr', { hasText: '3EMA' }).first().getByRole('button', { name: 'Folhas e dúvidas' }).click();
await page.waitForFunction(() => /ainda não tem leitura/.test(document.querySelector('#fl-status').textContent));
await page.locator('#fl-refazer').click();
await page.locator('#fl-confirma').getByRole('button', { name: 'Refazer leitura' }).click();
await page.waitForFunction(() => /Leitura refeita/.test(document.querySelector('#fl-status').textContent), null, { timeout: 30000 }).catch(() => {});
ok('"Refazer leitura" lê as folhas no navegador e grava o índice', /3 páginas · 0 alunos identificados · 1 avulsas .* · 2 dúvidas/.test(await page.locator('#fl-resumo').textContent()), (await page.locator('#fl-status').textContent()) + ' / ' + await page.locator('#fl-resumo').textContent());
await page.locator('#fl-linhas tr').first().getByRole('button', { name: 'Ver folha' }).click();
await page.waitForFunction(() => /Página \d de 3/.test(document.querySelector('#align-pos').textContent) && !document.querySelector('#align-controls').hidden, null, { timeout: 30000 }).catch(() => {});
ok('"Ver folha" abre a página certa na prévia alinhada', /Página 1 de 3/.test(await page.locator('#align-pos').textContent()), await page.locator('#align-pos').textContent());
await page.locator('#align-close').click();
ok('Fechar a prévia volta para as folhas do lote', await page.locator('#pages-viewer').isVisible());
await page.setViewportSize({ width: 390, height: 840 });
ok('Folhas do lote cabem no celular', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await page.setViewportSize({ width: 1280, height: 900 });
await page.locator('#fl-fechar').click();

// Biblioteca de PDF alterada no caminho: a tela recusa e explica.
pdfjsAdulterado = true;
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(base + '/redacao-lotes-admin.html');
await page.locator('#app').waitFor({ state: 'visible' });
await page.getByRole('button', { name: 'Ver páginas alinhadas' }).first().click();
await page.waitForFunction(() => /não confere/.test(document.querySelector('#align-summary').textContent), null, { timeout: 15000 }).catch(() => {});
ok('Leitor de PDF alterado é recusado', /não confere/.test(await page.locator('#align-summary').textContent()), await page.locator('#align-summary').textContent());
/* Login do ADM volta para a página de Lotes. */
pdfjsAdulterado = false;
await page.evaluate(() => sessionStorage.removeItem('atlas_adm_token'));
await page.goto(base + '/redacao-lotes-admin.html');
await page.locator('#auth-error').waitFor({ state: 'visible' });
ok('Aviso de login aponta para o ADM com retorno', await page.locator('#auth-error a').getAttribute('href') === 'admin.html?volta=redacao-lotes-admin.html');
await page.evaluate(() => sessionStorage.setItem('atlas_adm_token', 'adm-token'));
await page.goto(base + '/admin.html?volta=redacao-lotes-admin.html', { waitUntil: 'commit' });
await page.waitForURL(u => u.pathname.endsWith('/redacao-lotes-admin.html'), { timeout: 20000, waitUntil: 'commit' }).catch(() => {});
await page.locator('#app').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
ok('Depois do login, volta para Lotes', /redacao-lotes-admin\.html$/.test(page.url()) && await page.locator('#app').isVisible({ timeout: 5000 }).catch(() => false), page.url());
await page.goto(base + '/admin.html?volta=https://exemplo.com/', { waitUntil: 'commit' });
await page.locator('#app-view').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
ok('Retorno só para páginas do ATLAS', /admin\.html\?volta=/.test(page.url()), page.url());
ok('Tela sem erro JavaScript', errors.length === 0, errors.join(' | '));
await browser.close();
await new Promise(resolve => server.close(resolve));
for (const [estado, nome, extra2] of results) console.log(estado.padEnd(7), nome, extra2);
const falhas = results.filter(x => x[0] === 'FALHOU').length;
console.log(falhas ? `FALHOU: ${falhas} falha(s) em ${results.length}` : `TODOS: ${results.length} verificações passaram`);
if (falhas) process.exitCode = 1;
