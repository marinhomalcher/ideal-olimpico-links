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

/* PDF com uma imagem JPEG por página (como sai de um scanner). */
function pdfDeJpegs(paginas) {
  const objs = [];
  const add = conteudo => { objs.push(conteudo); return objs.length; };
  const catalogo = add(null), raiz = add(null), kids = [];
  for (const { jpeg, w, h } of paginas) {
    const img = add(Buffer.concat([Buffer.from(`<</Type/XObject/Subtype/Image/Width ${w}/Height ${h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpeg.length}>>stream\n`), jpeg, Buffer.from('\nendstream')]));
    const desenho = 'q 595.32 0 0 841.92 0 0 cm /Im0 Do Q';
    const cont = add(Buffer.from(`<</Length ${desenho.length}>>stream\n${desenho}\nendstream`));
    kids.push(add(Buffer.from(`<</Type/Page/Parent ${raiz} 0 R/MediaBox[0 0 595.32 841.92]/Resources<</XObject<</Im0 ${img} 0 R>>>>/Contents ${cont} 0 R>>`)));
  }
  objs[catalogo - 1] = Buffer.from(`<</Type/Catalog/Pages ${raiz} 0 R>>`);
  objs[raiz - 1] = Buffer.from(`<</Type/Pages/Kids[${kids.map(k => k + ' 0 R').join(' ')}]/Count ${kids.length}>>`);
  const partes = [Buffer.from('%PDF-1.4\n')], pos = [];
  let tam = partes[0].length;
  objs.forEach((o, i) => { pos.push(tam); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]); partes.push(b); tam += b.length; });
  partes.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map(p => String(p).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<</Size ${objs.length + 1}/Root ${catalogo} 0 R>>\nstartxref\n${tam}\n%%EOF\n`));
  return Buffer.concat(partes);
}

/* Desenho da folha fictícia e do "scanner" (rodam no navegador). */
const FOLHA_JS = `
window.folhaTeste = function (op = {}) {
  const A = window.AtlasAlinhamento, W = 1240, H = Math.round(W * A.MODELO.proporcao);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  const P = (fx, fy) => [fx * W, fy * W * A.MODELO.proporcao];
  /* cabeçalho */
  x.fillStyle = '#000'; x.font = 'bold 34px Arial'; x.fillText('FOLHA DE REDAÇÃO', 0.07 * W, 0.075 * H);
  x.fillStyle = '#c8102e'; x.font = 'bold 16px Arial'; x.fillText('ENSINO MÉDIO – SIMULADO ENEM', 0.07 * W, 0.092 * H);
  x.fillRect(0.07 * W, 0.096 * H, 0.33 * W, 2);
  x.fillStyle = '#000'; x.font = 'bold 15px Arial';
  x.fillText('Nome completo do aluno: ' + (op.avulsa ? '' : 'ALUNO TESTE'), 0.07 * W, 0.115 * H);
  x.fillText('Número do CPF: ' + (op.avulsa ? '' : '***.000.000-**'), 0.07 * W, 0.132 * H);
  x.fillText('Data de Nascimento: ' + (op.avulsa ? '' : '01/01/2009'), 0.07 * W, 0.165 * H);
  x.lineWidth = 3; x.strokeRect(0.80 * W, 0.06 * H, 0.13 * W, 0.04 * H); x.font = 'bold 30px Arial'; x.fillText('1º DIA', 0.815 * W, 0.09 * H);
  x.fillStyle = '#c8102e'; x.fillRect(0.66 * W, 0.105 * H, 0.27 * W, 0.022 * H); x.fillStyle = '#fff'; x.font = 'bold 12px Arial'; x.fillText('NÚMERO DE MATRÍCULA        SÉRIE', 0.68 * W, 0.12 * H);
  x.fillStyle = '#000'; x.font = 'bold 20px Arial'; if (!op.avulsa) x.fillText('00000          3ª SÉRIE', 0.72 * W, 0.15 * H);
  /* linha da assinatura em vermelho, quase encostando no marcador de cima à esquerda */
  x.fillStyle = '#c8102e'; x.fillRect(0.075 * W, 0.1826 * H + 1, 0.85 * W, 2);
  if (!op.avulsa) { x.fillStyle = '#000'; let px = 0.48 * W, i = 0; while (px < 0.71 * W) { const g = 2 + (i * 7 % 5); x.fillRect(px, 0.02 * H, g, 0.03 * H); px += g + 2 + (i * 3 % 4); i++; } }
  /* instruções */
  x.fillStyle = '#000'; x.font = '13px Arial';
  for (let i = 0; i < 3; i++) x.fillText((i + 1) + '. Instrução de teste para a folha fictícia de redação, linha ' + (i + 1) + '.', 0.12 * W, (0.205 + i * 0.012) * H);
  /* quadro com 30 linhas vermelhas e números */
  const y0 = 0.25 * H, y1 = 0.90 * H, x0 = 0.07 * W, x1 = 0.93 * W, alt = (y1 - y0) / 30;
  x.strokeStyle = '#c8102e'; x.lineWidth = 2; x.strokeRect(x0, y0, x1 - x0, y1 - y0); x.beginPath(); x.moveTo(x0 + 0.035 * W, y0); x.lineTo(x0 + 0.035 * W, y1); x.stroke();
  x.lineWidth = 1; x.font = 'bold 13px Arial'; x.fillStyle = '#000';
  for (let i = 0; i < 30; i++) { const y = y0 + alt * (i + 1); x.beginPath(); x.moveTo(x0, y); x.lineTo(x1, y); x.stroke(); x.fillText(String(i + 1), x0 + 8, y - 6); }
  /* "texto do aluno" em caneta */
  x.fillStyle = '#1b1b3a'; x.font = 'italic 22px serif';
  for (let i = 0; i < 24; i++) x.fillText('Texto manuscrito de teste da redação, linha ' + (i + 1) + ' com argumentos.', x0 + 0.05 * W, y0 + alt * (i + 1) - 5);
  /* rodapé com logos vermelhos */
  x.fillStyle = '#c8102e'; x.font = 'bold 40px Arial'; x.fillText('enem', 0.40 * W, 0.935 * H); x.fillText('ideal', 0.80 * W, 0.935 * H);
  x.beginPath(); x.arc(0.15 * W, 0.925 * H, 22, 0, 7); x.fill();
  /* marcadores em "L" (por último, como na impressão): braço 0,0345 da largura, espessura 0,0036 */
  const L = 0.0345 * W, T = 0.0036 * W; x.fillStyle = '#000';
  for (const [k, [fx, fy]] of Object.entries(A.MODELO.cantos)) {
    const [px, py] = P(fx, fy), dx = k[1] === 'e' ? 1 : -1, dy = k[0] === 's' ? 1 : -1;
    x.fillRect(dx > 0 ? px : px - L, dy > 0 ? py : py - T, L, T);
    x.fillRect(dx > 0 ? px : px - T, dy > 0 ? py : py - L, T, L);
  }
  return c;
};
/* Simula o scanner: gira (graus), desloca, muda a escala, opcionalmente cinza, borrão e tapa um canto. */
window.escanear = function (folha, op = {}) {
  const c = document.createElement('canvas'); c.width = folha.width; c.height = folha.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  if (op.cinza) x.filter = 'grayscale(1) blur(0.6px) contrast(0.85)';
  const cx = c.width / 2 + (op.dx || 0), cy = c.height / 2 + (op.dy || 0), s = op.escala || 1, a = (op.ang || 0) * Math.PI / 180;
  x.setTransform(s * Math.cos(a), s * Math.sin(a), -s * Math.sin(a), s * Math.cos(a), cx, cy);
  x.drawImage(folha, -folha.width / 2, -folha.height / 2);
  x.setTransform(1, 0, 0, 1, 0, 0); x.filter = 'none';
  if (op.tapar) { const [fx, fy] = window.AtlasAlinhamento.MODELO.cantos[op.tapar], p = window.leva([fx * folha.width, fy * folha.width * window.AtlasAlinhamento.MODELO.proporcao], folha, op); x.fillStyle = '#fff'; x.fillRect(p[0] - 70, p[1] - 70, 140, 140); }
  return c;
};
/* Onde um ponto da folha original cai no "scan". */
window.leva = function ([px, py], folha, op = {}) {
  const s = op.escala || 1, a = (op.ang || 0) * Math.PI / 180, qx = px - folha.width / 2, qy = py - folha.height / 2;
  return [folha.width / 2 + (op.dx || 0) + s * (qx * Math.cos(a) - qy * Math.sin(a)), folha.height / 2 + (op.dy || 0) + s * (qx * Math.sin(a) + qy * Math.cos(a))];
};
/* Erro (px) entre a folha original e a folha escaneada depois de alinhada. */
window.erroAlinhamento = function (folha, op, r, m) {
  const A = window.AtlasAlinhamento, W = folha.width, H = folha.height, pts = [[W / 2, H / 2]];
  for (const [fx, fy] of Object.values(A.MODELO.cantos)) pts.push([fx * W, fy * W * A.MODELO.proporcao]);
  m = m || r.matriz;
  return Math.max(...pts.map(p => { const s = window.leva(p, folha, op), d = [m.p * s[0] - m.q * s[1] + m.e, m.q * s[0] + m.p * s[1] + m.f]; return Math.hypot(d[0] - p[0], d[1] - p[1]); }));
};
window.jpeg = c => c.toDataURL('image/jpeg', 0.7).split(',')[1];
`;

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
    out.push({ nome, op, ms, erro: window.erroAlinhamento(f, op, r), incl: r.inclinacao, inv: r.invertida, marc: r.marcadores, avisos: r.avisos });
  };
  const angulos = [0, 0.3, -0.6, 1.2, -2, 3.5, -5];
  angulos.forEach((ang, i) => roda('folha ' + ang + '°', folha, { ang, dx: [0, 12, -20, 8, -5, 25, -15][i], dy: [0, -9, 14, 30, -22, 5, 18][i], escala: [1, 0.98, 1.02, 1, 0.99, 1.01, 1][i], cinza: i % 2 === 1 }));
  for (const ang of [180, 178.8, 181.5]) roda('de cabeça para baixo ' + ang + '°', folha, { ang, dx: 10, dy: -12, cinza: ang !== 180 });
  roda('avulsa 0,8°', avulsa, { ang: 0.8, dx: -6, dy: 9 });
  roda('avulsa de cabeça para baixo', avulsa, { ang: 181, dx: 4, dy: 4, cinza: true });
  roda('sem o marcador de baixo à direita', folha, { ang: -1.3, dx: 6, tapar: 'id' });
  roda('sem o marcador de cima à esquerda, em cinza', folha, { ang: 2.2, cinza: true, tapar: 'se' });
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
r = await api('/api/redacao/lotes?turma_id=' + bc.id + '&bimestre=4', 'POST', pdf, 'bc-token', 'application/pdf');
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

// Biblioteca de PDF alterada no caminho: a tela recusa e explica.
pdfjsAdulterado = true;
await page.setViewportSize({ width: 1280, height: 900 });
await page.reload();
await page.locator('#app').waitFor({ state: 'visible' });
await page.getByRole('button', { name: 'Ver páginas alinhadas' }).click();
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
