// Correção das redações pela professora (bloco A). Folha FICTÍCIA, nenhum dado real.
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
await page.route('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/**', route => {
  const nome = new URL(route.request().url()).pathname.split('/').pop();
  let body = fs.readFileSync(PDFJS + nome);
  route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body });
});
await page.route('https://atlas-api.marinhomalcher.workers.dev/**', async route => {
  const req = route.request(), u = new URL(req.url()), type = req.headers()['content-type'], body = req.postDataBuffer();
  const token = (req.headers()['authorization'] || '').replace(/^Bearer /i, '');
  const result = await api(u.pathname + u.search, req.method(), body && type === 'application/json' ? JSON.parse(body.toString()) : body || undefined, token, type || 'application/json');
  await route.fulfill({ status: result.status, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Content-Type': result.headers.get('Content-Type') || 'application/json' }, body: Buffer.isBuffer(result.data) ? result.data : JSON.stringify(result.data) });
});

// ---------- preparação ----------
await page.goto(base + '/index.html');
await page.addScriptTag({ url: base + '/atlas-alinhamento.js' });
await page.addScriptTag({ content: FOLHA_JS });
const turmas = (await api('/api/adm/redacao/turmas')).data.turmas;
const t3 = turmas.find(t => t.unidade === 'BC' && t.codigo === '3EMA'), t2 = turmas.find(t => t.unidade === 'BC' && t.codigo === '2EMA');
let r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Digitalizador BC', email: 'dig@grupoideal.com.br', funcao: 'digitalizador', unidades: ['BC'] });
sessao('dig-token', 'usuario', 'dig@grupoideal.com.br', r.data.equipe.find(x => x.email === 'dig@grupoideal.com.br').id);
r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Professora Teste', email: 'prof@grupoideal.com.br', funcao: 'professor', turmas: [t3.id] });
const profId = r.data.equipe.find(x => x.email === 'prof@grupoideal.com.br').id;
sessao('prof-token', 'usuario', 'prof@grupoideal.com.br', profId);
r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Outra Professora', email: 'outra@grupoideal.com.br', funcao: 'professor', turmas: [t2.id] });
sessao('outra-token', 'usuario', 'outra@grupoideal.com.br', r.data.equipe.find(x => x.email === 'outra@grupoideal.com.br').id);
const ano = db.prepare('SELECT ano FROM redacao_turmas WHERE id = ?').get(t3.id).ano;
const aluno = db.prepare('INSERT INTO redacao_alunos (ra, nome, turma_id, ano, segmento, serie) VALUES (?, ?, ?, ?, ?, ?)');
for (const [ra, nome] of [['11111', 'ALUNO TESTE UM'], ['22222', 'ALUNO TESTE DOIS'], ['33333', 'ALUNO TESTE TRES'], ['44444', 'ALUNO TESTE QUATRO']]) aluno.run(ra, nome, t3.id, ano, 'EM', '3ª Série');
const jpegs = await page.evaluate(() => [['11111', 0.6], ['22222', -1.1], ['33333', 179.4], ['44444', 0.2]].map(([ra, ang]) => { const c = window.escanear(window.folhaTeste({ ra }), { ang }); return { jpeg: window.jpeg(c), w: c.width, h: c.height }; }));
const pdf = pdfDeJpegs(jpegs.map(j => ({ ...j, jpeg: Buffer.from(j.jpeg, 'base64') })));
const envioId = (await api('/api/redacao/envios', 'POST', { bimestre: 2, unidade: t3.unidade }, 'dig-token')).data.envio_id;
r = await api('/api/redacao/lotes?envio=' + envioId + '&turma_id=' + t3.id + '&paginas=4', 'POST', pdf, 'dig-token', 'application/pdf');
const loteId = r.data.lote_id;
r = await api('/api/redacao/lotes/' + loteId + '/paginas', 'POST', { envio_id: envioId, paginas: [1, 2, 3, 4].map((n, i) => ({ pagina: n, ra_lido: ['11111', '22222', '33333', '44444'][i], destino: 'aluno', angulo: 0, invertida: n === 3, marcadores: 4 })) }, 'dig-token');
ok('Lote de 4 folhas identificadas pronto para a professora', r.status === 200 && r.data.resumo.aluno === 4, JSON.stringify(r.data));

// ---------- API da professora ----------
r = await api('/api/redacao/correcao/turmas', 'GET', undefined, 'prof-token');
ok('Professora vê só a sua turma, com o lote e o progresso', r.status === 200 && r.data.turmas.length === 1 && r.data.turmas[0].codigo === '3EMA' && r.data.turmas[0].lotes[0].folhas === 4 && r.data.turmas[0].lotes[0].corrigidas === 0, JSON.stringify(r.data.turmas));
const motivosZero = [
  'em branco', 'texto insuficiente (até 7 linhas válidas)', 'cópia integral ou em mais da metade do texto', 'fuga ao tema',
  'não atendimento ao tipo dissertativo-argumentativo', 'anulação proposital (impropérios, desenhos etc.)',
  'trecho deliberadamente desconectado do tema', 'outras formas de anulação'
];
ok('Lista de anulação contém somente os 8 motivos aprovados', JSON.stringify(r.data.motivos.zero) === JSON.stringify(motivosZero) && r.data.motivos.c5.length === 4, JSON.stringify(r.data.motivos.zero));
r = await api('/api/redacao/correcao/lotes/' + loteId, 'GET', undefined, 'outra-token');
ok('Professora de outra turma não abre o lote', r.status === 404, r.status);
r = await api('/api/redacao/correcao/lotes/' + loteId + '/pdf', 'GET', undefined, 'outra-token');
ok('Professora de outra turma não baixa o PDF', r.status === 404, r.status);
r = await api('/api/redacao/correcao/turmas', 'GET', undefined, 'dig-token');
ok('Digitalizador não entra na correção', r.status === 403, r.status);
r = await api('/api/redacao/correcao/lotes/' + loteId + '/pdf', 'GET', undefined, 'prof-token');
ok('Professora baixa o PDF do lote da sua turma', r.status === 200 && Buffer.isBuffer(r.data) && r.data.subarray(0, 5).toString() === '%PDF-');
const nota = (n, b, t = 'prof-token') => api('/api/redacao/correcao/lotes/' + loteId + '/paginas/' + n, 'POST', b, t);
r = await nota(1, { c1: 160, c2: 0, c3: 120, c4: 160, c5: 160 });
ok('C2 = 0 sem zerar a redação é recusado', r.status === 400 && /C2/.test(r.data.error), r.data.error);
r = await nota(1, { c1: 150, c2: 160, c3: 120, c4: 160, c5: 160 });
ok('Valor fora da escala é recusado', r.status === 400, r.data.error);
r = await nota(1, { c1: 160, c2: 160, c3: 120, c4: 160, c5: 0 });
ok('C5 = 0 exige o motivo', r.status === 400 && /C5/.test(r.data.error), r.data.error);
r = await nota(1, { c1: 160, c2: 160, c3: 120, c4: 160, c5: 0, c5_motivo: 'não apresenta proposta de intervenção', total: 999, segundos: 95 });
ok('Nota com C5 = 0 e motivo: total recalculado no servidor (600)', r.status === 200 && r.data.folha.total === 600 && r.data.folha.estado === 'corrigida' && r.data.progresso.corrigidas === 1, JSON.stringify(r.data.folha));
r = await nota(2, { zero_motivo: 'fuga ao tema', c1: 200, segundos: 40 });
ok('Zero na redação inteira: competências vazias e total 0', r.status === 200 && r.data.folha.total === 0 && r.data.folha.c1 === null && r.data.folha.zero_motivo === 'fuga ao tema', JSON.stringify(r.data.folha));
r = await nota(2, { zero_motivo: 'motivo inventado' });
ok('Motivo de zero fora da lista é recusado', r.status === 400, r.data.error);
r = await nota(2, { zero_motivo: 'sinal gráfico sem função no texto' });
ok('Motivo retirado não pode ser usado em nova revisão', r.status === 400, r.data.error);
r = await nota(2, { zero_motivo: 'outras formas de anulação' });
ok('Novo motivo de anulação é aceito', r.status === 200 && r.data.folha.zero_motivo === 'outras formas de anulação', JSON.stringify(r.data.folha));
r = await nota(1, { c1: 200, c2: 200, c3: 200, c4: 200, c5: 200, segundos: 9999 });
const c1 = db.prepare('SELECT total, segundos, revisada_em FROM redacao_correcoes WHERE lote_id = ? AND pagina = 1').get(loteId);
ok('Revisão muda a nota e guarda o tempo da 1ª correção', r.status === 200 && c1.total === 1000 && c1.segundos === 95 && !!c1.revisada_em, JSON.stringify(c1));
const notas200 = { c1: 200, c2: 200, c3: 200, c4: 200, c5: 200 };
r = await nota(1, { ...notas200, marcacoes: [{ x: 0.5, y: 0.5, w: 0.9, h: 0.02 }] });
ok('Marca-texto fora da folha é recusado', r.status === 400 && /Marcações/.test(r.data.error), r.data.error);
r = await nota(1, { ...notas200, marcacoes: 'x' });
ok('Marcações que não são lista são recusadas', r.status === 400, r.data.error);
r = await nota(1, { ...notas200, marcacoes: [{ x: 0.123456, y: 0.4, w: 0.3, h: 0.018 }] });
ok('Destaques válidos são guardados (arredondados)', r.status === 200 && r.data.folha.marcacoes.length === 1 && r.data.folha.marcacoes[0].x === 0.1235, JSON.stringify(r.data.folha.marcacoes));
r = await nota(1, { ...notas200, marcacoes: [{ x: 0.1, y: 0.4, w: 0.3, h: 0.018, c: 'vd' }, { x: 0.1, y: 0.5, w: 0.3, h: 0.018, c: 'am' }, { x: 0.1, y: 0.6, w: 0.3, h: 0.018 }] });
ok('Cor do destaque é guardada (amarelo, a padrão, fica sem o campo)', r.status === 200 && r.data.folha.marcacoes.length === 3 && r.data.folha.marcacoes[0].c === 'vd' && !('c' in r.data.folha.marcacoes[1]) && !('c' in r.data.folha.marcacoes[2]), JSON.stringify(r.data.folha.marcacoes));
r = await nota(1, { ...notas200, marcacoes: [{ x: 0.1, y: 0.4, w: 0.3, h: 0.018, c: 'roxo' }] });
ok('Cor fora da paleta é recusada', r.status === 400 && /Marcações/.test(r.data.error), r.data.error);
r = await nota(1, { ...notas200, marcacoes: [{ x: 0.123456, y: 0.4, w: 0.3, h: 0.018 }] });
ok('Volta a um destaque só para os próximos passos', r.status === 200 && r.data.folha.marcacoes.length === 1);
r = await nota(1, notas200);
ok('Revisão sem o campo mantém os destaques', r.status === 200 && r.data.folha.marcacoes.length === 1);
r = await nota(1, { ...notas200, marcacoes: [] });
ok('Lista vazia apaga os destaques', r.status === 200 && r.data.folha.marcacoes.length === 0 && db.prepare('SELECT marcacoes FROM redacao_correcoes WHERE lote_id = ? AND pagina = 1').get(loteId).marcacoes === null);
{ const m = new DatabaseSync(':memory:'); const sql = fs.readFileSync(repo + '_cloudflare/atlas-api/schema.sql', 'utf8');
  m.exec(sql.split('-- ---------- v16 ----------')[0]); m.exec(fs.readFileSync(repo + '_cloudflare/atlas-api/migrations/0016_redacao_marcacoes.sql', 'utf8'));
  ok('Migração 0016 cria a coluna marcacoes e marca a versão 16', m.prepare('PRAGMA table_info(redacao_correcoes)').all().some(c => c.name === 'marcacoes') && m.prepare("SELECT valor FROM meta WHERE chave = 'schema_versao'").get().valor === '16'); }
r = await nota(1, { c1: 200, c2: 200, c3: 200, c4: 200, c5: 200 }, 'outra-token');
ok('Outra professora não grava nota no lote', r.status === 404, r.status);

// ---------- condenar e ADM ----------
r = await nota(4, { condenar: true, motivo: 'motivo inventado' });
ok('Condenar exige motivo da lista', r.status === 400, r.data.error);
r = await nota(4, { condenar: true, motivo: 'folha ilegível', observacao: 'scan escuro' });
ok('Professora condena a página', r.status === 200 && r.data.folha.estado === 'condenada' && r.data.progresso.condenadas === 1, JSON.stringify(r.data.progresso));
r = await nota(4, { c1: 200, c2: 200, c3: 200, c4: 200, c5: 200 });
ok('Página condenada não recebe nota (está com o ADM)', r.status === 409, r.status);
r = await api('/api/adm/redacao/lotes');
const lst = r.data.lotes.find(l => l.id === loteId);
ok('Lista do ADM conta a página condenada', lst.paginas_condenada === 1, JSON.stringify(lst));
r = await api('/api/adm/redacao/lotes/' + loteId + '/paginas');
ok('ADM vê a condenação com motivo e as corrigidas', r.data.paginas[3].condenada === 1 && r.data.paginas[3].condenada_motivo === 'folha ilegível' && r.data.resumo.corrigida === 2 && r.data.resumo.condenada === 1, JSON.stringify(r.data.resumo));
r = await api('/api/adm/redacao/lotes/' + loteId + '/paginas/1', 'POST', { acao: 'descartar' });
ok('ADM não altera folha já corrigida', r.status === 409, r.status);
r = await api('/api/adm/redacao/lotes/' + loteId + '/paginas', 'POST', { paginas: [{ pagina: 1, ra: '11111' }] });
ok('Com correções, "Refazer leitura" é bloqueado', r.status === 409 && /corrigidas/.test(r.data.error), r.data.error);
r = await api('/api/adm/redacao/lotes/' + loteId + '/paginas/4', 'POST', { acao: 'atribuir', ra: '99999' });
ok('Atribuir RA inexistente mantém a condenação', r.status === 404 && db.prepare('SELECT condenada FROM redacao_correcoes WHERE lote_id = ? AND pagina = 4').get(loteId)?.condenada === 1, r.status);
r = await api('/api/adm/redacao/lotes/' + loteId + '/paginas/4', 'POST', { acao: 'devolver' });
ok('ADM devolve a página à professora (volta a ficar pendente)', r.status === 200 && !db.prepare('SELECT 1 FROM redacao_correcoes WHERE lote_id = ? AND pagina = 4').get(loteId), r.status);

// ---------- tela da professora ----------
await page.evaluate(() => sessionStorage.setItem('atlas_user_auth', JSON.stringify({ token: 'prof-token' })));
await page.goto(base + '/redacao.html');
await page.locator('.lote-prof').first().waitFor({ timeout: 10000 });
ok('Área da professora mostra o lote com o progresso', /2º bimestre · 2 corrigidas \/ 4 folhas/.test(await page.locator('.lote-prof').first().textContent()) && /Continuar correção/.test(await page.locator('.lote-prof a').first().textContent()), await page.locator('.lote-prof').first().textContent());
ok('Ver notas aparece bloqueado enquanto faltam correções', (await page.locator('.lote-prof .secondary').getAttribute('aria-disabled')) === 'true');
r = await api('/api/redacao/correcao/lotes/' + loteId + '/notas', 'GET', undefined, 'prof-token');
ok('Servidor bloqueia relatório incompleto', r.status === 409, r.status);
ok('Área da professora tem o botão "Voltar ao início"', await page.locator('a.voltar').isVisible() && (await page.locator('a.voltar').getAttribute('href')) === 'index.html');
await page.locator('.lote-prof a').first().click();
await page.waitForURL(/redacao-corrigir\.html\?lote=/);
await page.waitForFunction(() => document.querySelector('#aluno')?.textContent && document.querySelector('#folha').width > 1000, null, { timeout: 30000 });
ok('Abre direto a primeira folha pendente (página 3), alinhada', /ALUNO TESTE TRES/.test(await page.locator('#aluno').textContent()) && /REDAÇÃO 3 DE 4/.test(await page.locator('#pos').textContent()) && /cabeça para baixo/.test(await page.locator('#folha-info').textContent()), await page.locator('#pos').textContent());
ok('Cabeçalho mostra unidade, série, turma e bimestre', /Batista Campos/.test(await page.locator('#chips').textContent()) && /Turma 3EMA/.test(await page.locator('#chips').textContent()) && /2º bimestre/.test(await page.locator('#chips').textContent()));
const layout = await page.evaluate(() => {
  const folha = document.querySelector('#folha').getBoundingClientRect();
  const area = document.querySelector('#area').getBoundingClientRect();
  return { largura: folha.width / area.width, notasAbaixo: document.querySelector('#painel').hidden && !!document.querySelector('#lateral .bottom #btn-concluir'),
    cabecalho: document.querySelector('header').getBoundingClientRect().height,
    grupos: [...document.querySelectorAll('.tool-group label')].map(x => x.textContent.trim()) };
});
ok('Folha usa a largura; em tela larga a avaliação inteira fica na faixa e o painel de baixo some; topo fino e controles separados',
  layout.largura > 0.9 && layout.notasAbaixo && layout.cabecalho <= 60 &&
  JSON.stringify(layout.grupos) === JSON.stringify(['ZOOM', 'ROTAÇÃO']), JSON.stringify(layout));
/* tela larga (1280): só a faixa lateral tem os botões de nota; o painel de baixo fica com o resto */
const lat = await page.evaluate(() => {
  const l = document.querySelector('#lateral').getBoundingClientRect(), a = document.querySelector('#area').getBoundingClientRect();
  return { visivel: l.width > 0, largura: l.width, aDireita: l.left >= a.right - 1, comps: getComputedStyle(document.querySelector('#comps')).display,
    colunas: [...document.querySelectorAll('#lat-cols .tag')].map(t => t.textContent), botoes: document.querySelectorAll('#lat-c1 button').length,
    voltar: document.querySelector('#voltar')?.getAttribute('href'), paleta: [...document.querySelectorAll('.mt-cor')].map(b => b.dataset.c) };
});
ok('Tela larga: faixa lateral estreita à direita da folha, com C1 a C5, e sem os botões no painel de baixo', lat.visivel && lat.largura <= 270 && lat.aDireita && lat.comps === 'none' && JSON.stringify(lat.colunas) === JSON.stringify(['C1', 'C2', 'C3', 'C4', 'C5']) && lat.botoes === 6, JSON.stringify(lat));
if (process.env.ATLAS_PNG_DIR) await page.screenshot({ path: process.env.ATLAS_PNG_DIR + '/redacao-corrigir-lateral.png' });
ok('Botão Voltar no alto, para as turmas, e paleta com 4 cores', lat.voltar === 'redacao.html' && JSON.stringify(lat.paleta) === JSON.stringify(['am', 'vd', 'az', 'rs']), JSON.stringify(lat));
await page.locator('#lat-fechar').click();
ok('Recolher a faixa devolve tudo ao painel de baixo (notas, motivo da C5, zerar, observações, botões)', await page.evaluate(() => document.querySelector('#lateral').getBoundingClientRect().width < 60 && !document.querySelector('#painel').hidden && getComputedStyle(document.querySelector('#comps')).display !== 'none' && !!document.querySelector('.bottom #c5-motivo-box') && !!document.querySelector('#painel-corpo .bottom #btn-concluir')));
await page.locator('#lat-fechar').click();
ok('Abrir de novo esconde os de baixo', await page.evaluate(() => getComputedStyle(document.querySelector('#comps')).display === 'none'));
await page.setViewportSize({ width: 900, height: 800 });
await page.waitForFunction(() => !document.querySelector('#painel').hidden, null, { timeout: 3000 }).catch(() => {});
ok('Tela estreita: sem faixa lateral, avaliação no painel de baixo', await page.evaluate(() => getComputedStyle(document.querySelector('#lateral')).display === 'none' && !document.querySelector('#painel').hidden && getComputedStyle(document.querySelector('#comps')).display !== 'none' && !!document.querySelector('#painel-corpo .bottom #btn-concluir')));
ok('Botão de pedir nova digitalização com esse nome (por dentro continua condenar)', (await page.locator('#btn-condenar').textContent()) === 'Pedir nova digitalização' && /digitalizada de novo/.test(await page.locator('#btn-condenar').getAttribute('title')));
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForFunction(() => document.querySelector('#timer').textContent !== '00:00', null, { timeout: 4000 }).catch(() => {});
ok('Cronômetro anda', /^00:0[1-9]$/.test(await page.locator('#timer').textContent()), await page.locator('#timer').textContent());
const clicarNota = (k, v) => page.locator('.notas[data-k="' + k + '"] button[data-v="' + v + '"]:visible').first().click();
const valorDe = k => page.locator('#sel-' + k).getAttribute('data-valor');
ok('C2 não mostra o botão 0', (await page.locator('.notas[data-k="c2"] button[data-v="0"]:visible').count()) === 0 && (await page.locator('.notas[data-k="c1"] button[data-v="0"]:visible').count()) === 1);
await clicarNota('c1', '160');await clicarNota('c1', '160');
ok('Clicar de novo no mesmo botão desmarca', (await valorDe('c1')) === '' && !(await page.locator('#sel-c1 button.on').count()));
await clicarNota('c1', '120');await clicarNota('c1', '160');
ok('Clicar em outro botão troca a nota', (await valorDe('c1')) === '160' && (await page.locator('#sel-c1 button.on').count()) === 1 && (await page.locator('#sel-c1 button.on').textContent()) === '160');
ok('Faixa lateral e painel de baixo mostram a mesma nota', (await page.locator('#lat-c1').getAttribute('data-valor')) === '160' && (await page.locator('#lat-c1 button.on').textContent()) === '160' && (await page.locator('#lat-c1').locator('..').getAttribute('class')).includes('feita'));
for (const [k, v] of [['c2', '120'], ['c3', '120'], ['c4', '160']]) await clicarNota(k, v);
ok('Total só aparece com as 5 notas', (await page.locator('#total').textContent()) === '—');
await page.locator('#btn-concluir').click();
ok('Concluir sem todas as notas avisa o que falta', /Falta a nota de: C5/.test(await page.locator('#status').textContent()));
await clicarNota('c5', '0');
ok('C5 = 0 mostra a lista de motivos, dentro da faixa lateral', await page.locator('#lateral #c5-motivo').isVisible() && (await page.locator('#total').textContent()) === '560' && (await page.locator('#lat-total').textContent()) === '560');
ok('Competências com uma cor cada (C1 a C5), igual ao espelho', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#lat-cols .lat-col')].map(c => getComputedStyle(c).getPropertyValue('--cor').trim()))) === JSON.stringify(['#f5c518', '#5cc27a', '#5aaee8', '#f29a4a', '#ec7fb6']));
/* Voltar com alteração não salva: aviso na página, sem sair */
await page.locator('#voltar').click();
ok('Voltar com nota não salva: aviso na página e continua na correção', await page.locator('#sair').isVisible() && /redacao-corrigir\.html/.test(page.url()));
await page.locator('#sair-nao').click();
ok('"Ficar" fecha o aviso', await page.locator('#sair').isHidden());
await page.locator('#btn-concluir').click();
ok('Sem o motivo da C5, não envia', /motivo da nota zero na C5/.test(await page.locator('#status').textContent()));
await page.locator('#c5-motivo').selectOption('proposta integralmente copiada da prova');
/* ajuste fino e zoom não mexem nos botões */
await page.locator('#a-mais').click();
ok('Ajuste fino +0,25° aparece no ângulo', /0,25°/.test(await page.locator('#a-val').textContent()) || /\+/.test(await page.locator('#a-val').textContent()), await page.locator('#a-val').textContent());
await page.locator('#z-mais').click();
ok('Zoom + sai de "Página inteira"', !(await page.locator('#z-pagina').getAttribute('class')).includes('on'));
await page.locator('#z-pagina').click();
/* marca-texto: arrastar desenha uma faixa; desfazer tira; borracha apaga */
await page.locator('#mt-on').click();
const pontoVisivel = async y => {
  await page.evaluate(y => { const r = document.querySelector('#folha').getBoundingClientRect(); scrollBy(0, r.top + r.height * y - innerHeight / 2); }, y);
  const caixa = await page.locator('#folha').boundingBox();
  return { x: caixa.x + caixa.width * 0.35, y: caixa.y + caixa.height * y, caixa };
};
const arrastar = async y => { const p = await pontoVisivel(y); await page.mouse.move(p.caixa.x + p.caixa.width * 0.2, p.y); await page.mouse.down(); await page.mouse.move(p.caixa.x + p.caixa.width * 0.5, p.y, { steps: 5 }); await page.mouse.up(); };
await arrastar(0.5); await arrastar(0.6);
ok('Marca-texto: arrastar cria destaques', await page.evaluate(() => marcas.length) === 2);
await page.locator('#mt-desfazer').click();
ok('Desfazer tira o último destaque', await page.evaluate(() => marcas.length) === 1);
await arrastar(0.7);
await page.locator('#mt-apagar').click();
{ const p = await pontoVisivel(0.7); await page.mouse.click(p.x, p.y); }
ok('Borracha apaga o destaque clicado', await page.evaluate(() => marcas.length) === 1 && await page.locator('#mt-apagar').getAttribute('aria-pressed') === 'true');
await page.locator('#mt-apagar').click();
const pixel = await page.evaluate(() => { const c = document.querySelector('#folha'); const d = c.getContext('2d').getImageData(Math.round(c.width * 0.35), Math.round(c.height * 0.5), 1, 1).data; return [d[0], d[1], d[2]]; });
ok('Destaque aparece amarelo na folha', pixel[2] < pixel[0] - 40, JSON.stringify(pixel));
/* paleta: escolher o azul liga o marca-texto; o destaque sai azul e guarda a cor */
await page.locator('.mt-cor[data-c="az"]').click();
ok('Escolher uma cor liga o marca-texto com ela', (await page.locator('#mt-on').getAttribute('aria-pressed')) === 'true' && (await page.locator('.mt-cor[data-c="az"]').getAttribute('aria-pressed')) === 'true');
await arrastar(0.8);
const azul = await page.evaluate(() => { const c = document.querySelector('#folha'); const d = c.getContext('2d').getImageData(Math.round(c.width * 0.35), Math.round(c.height * 0.8), 1, 1).data; return { pixel: [d[0], d[1], d[2]], marcas }; });
ok('Destaque azul na folha, com a cor guardada no destaque', azul.marcas.length === 2 && azul.marcas[1].c === 'az' && !('c' in azul.marcas[0]) && azul.pixel[2] > azul.pixel[0] + 20, JSON.stringify(azul));
if (process.env.ATLAS_PNG_DIR) await page.screenshot({ path: process.env.ATLAS_PNG_DIR + '/redacao-corrigir-cores.png' });
await page.locator('#mt-on').click();
await page.locator('#btn-concluir').click();
await page.waitForFunction(() => /ALUNO TESTE QUATRO/.test(document.querySelector('#aluno').textContent), null, { timeout: 15000 });
const c3 = db.prepare('SELECT total, c5, c5_motivo, segundos FROM redacao_correcoes WHERE lote_id = ? AND pagina = 3').get(loteId);
const mc3 = JSON.parse(db.prepare('SELECT marcacoes FROM redacao_correcoes WHERE lote_id = ? AND pagina = 3').get(loteId).marcacoes || '[]');
ok('Destaques salvos com a correção (frações da folha e cor)', mc3.length === 2 && Math.abs(mc3[0].x - 0.2) < 0.02 && Math.abs(mc3[0].w - 0.3) < 0.02 && mc3[0].h > 0 && mc3[0].h < 0.05 && !('c' in mc3[0]) && mc3[1].c === 'az', JSON.stringify(mc3));
ok('Próxima folha abre sem destaques', await page.evaluate(() => marcas.length) === 0);
ok('Concluir grava a nota com o tempo e vai para a próxima', c3.total === 560 && c3.c5 === 0 && c3.c5_motivo === 'proposta integralmente copiada da prova' && c3.segundos >= 1, JSON.stringify(c3));
ok('Progresso da turma atualizado', /3 corrigidas \/ 4 folhas/.test(await page.locator('#prog-txt').textContent()), await page.locator('#prog-txt').textContent());
ok('Próxima folha abre limpa', (await valorDe('c1')) === '' && (await page.locator('#zero').inputValue()) === '');
await page.locator('#zero').selectOption('em branco');
ok('Zerar a redação inteira trava as competências e mostra 0', await page.locator('#sel-c1 button[data-v="160"]').isDisabled() && (await page.locator('#total').textContent()) === '0');
await page.locator('#btn-concluir').click();
await page.locator('#fim').waitFor({ state: 'visible', timeout: 10000 });
ok('Última folha: mostra que o lote foi todo corrigido', await page.locator('#fim').isVisible() && db.prepare('SELECT zero_motivo FROM redacao_correcoes WHERE lote_id = ? AND pagina = 4').get(loteId).zero_motivo === 'em branco');
r = await api('/api/redacao/correcao/lotes/' + loteId + '/notas', 'GET', undefined, 'outra-token');
ok('Outra professora não pode abrir as notas', r.status === 404, r.status);
for(let i=5;i<=30;i++) aluno.run(String(10000+i), `ALUNO FICTÍCIO ${String(i).padStart(2,'0')}`, t3.id, ano, 'EM', '3ª Série');
r = await api('/api/redacao/correcao/lotes/' + loteId + '/notas', 'GET', undefined, 'prof-token');
ok('Relatório contém 30 alunos da turma, sem inventar notas ausentes', r.status === 200 && r.data.alunos.length === 30 && r.data.alunos.filter(a=>a.situacao==='sem_redacao').length === 26 && r.data.alunos.filter(a=>a.situacao==='anulada').length === 2 && r.data.alunos.find(a=>a.ra==='44444').total === 0, r.status);
await page.goto(base + '/redacao.html');
await page.locator('.lote-prof .secondary[href]').waitFor({ timeout: 10000 });
ok('Ver notas fica disponível depois da correção completa', /redacao-notas\.html/.test(await page.locator('.lote-prof .secondary').getAttribute('href')));
await page.locator('.lote-prof .secondary').click();
await page.locator('.page').nth(1).waitFor({ timeout: 10000 });
const pdfNotas = await page.pdf({ printBackground: true });
const paginasPdf = (pdfNotas.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
ok('Modelo B gera PDF A4 com duas páginas para 30 alunos', (await page.locator('.page').count()) === 2 && paginasPdf === 2 && pdfNotas.subarray(0,5).toString() === '%PDF-' && pdfNotas.length > 10000, `páginas: ${paginasPdf}; bytes: ${pdfNotas.length}`);
ok('Relatório mostra competências, anulação e ausência sem nota', /Anulada: em branco/.test(await page.locator('#paginas').textContent()) && /Sem redação neste lote/.test(await page.locator('#paginas').textContent()) && /C1/.test(await page.locator('table').first().textContent()));
await page.goto(base + '/redacao-corrigir.html?lote=' + loteId);
await page.locator('#fim').waitFor({ state: 'visible', timeout: 10000 });
await page.locator('#fim-lista').click();
ok('Lista do lote mostra as notas', await page.locator('#lista-itens li').count() === 4 && /1000 pontos/.test(await page.locator('#lista-itens').textContent()));
await page.locator('#lista-itens li').nth(0).locator('button').click();
await page.waitForFunction(() => /ALUNO TESTE UM/.test(document.querySelector('#aluno').textContent) && document.querySelector('#sel-c1').dataset.valor === '200', null, { timeout: 15000 });
ok('Reabrir: notas preenchidas e modo revisão (sem cronômetro)', (await page.locator('#timer-rot').textContent()) === 'REVISÃO' && /Salvar revisão/.test(await page.locator('#btn-concluir').textContent()));
await clicarNota('c3', '160');
await page.locator('#btn-concluir').click();
await page.waitForFunction(() => /Revisão salva/.test(document.querySelector('#status').textContent), null, { timeout: 10000 });
const rev = db.prepare('SELECT total, segundos FROM redacao_correcoes WHERE lote_id = ? AND pagina = 1').get(loteId);
ok('Revisão salva sem mudar o tempo e fica na mesma folha', rev.total === 960 && rev.segundos === 95 && /ALUNO TESTE UM/.test(await page.locator('#aluno').textContent()), JSON.stringify(rev));
/* condenar pela tela */
db.prepare('DELETE FROM redacao_correcoes WHERE lote_id = ? AND pagina = 2').run(loteId);
await page.reload();
await page.waitForFunction(() => /ALUNO TESTE DOIS/.test(document.querySelector('#aluno').textContent), null, { timeout: 20000 });
await page.locator('#btn-condenar').click();
await page.locator('#cond-ok').click();
ok('Pedir nova digitalização sem motivo avisa', /motivo do pedido de nova digitalização/.test(await page.locator('#status').textContent()));
await page.locator('#cond-motivo').selectOption('erro de digitalização');
await page.locator('#cond-ok').click();
await page.locator('#fim').waitFor({ state: 'visible', timeout: 10000 });
ok('Página condenada pela tela vai para o ADM', db.prepare('SELECT condenada, condenada_motivo FROM redacao_correcoes WHERE lote_id = ? AND pagina = 2').get(loteId).condenada_motivo === 'erro de digitalização');
await page.setViewportSize({ width: 390, height: 840 });
await page.locator('#fim-lista').click();
await page.locator('#lista-itens li').nth(2).locator('button').click();
await page.waitForFunction(() => /ALUNO TESTE TRES/.test(document.querySelector('#aluno').textContent), null, { timeout: 15000 });
ok('Tela de correção cabe no celular', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await page.setViewportSize({ width: 1280, height: 900 });
/* ADM vê a condenada na tela de lotes */
await page.evaluate(() => sessionStorage.setItem('atlas_adm_token', 'adm-token'));
await page.goto(base + '/redacao-lotes-admin.html');
await page.locator('#app').waitFor({ state: 'visible' });
await page.getByRole('button', { name: 'Folhas e dúvidas (1)' }).click();
await page.locator('#fl-linhas tr').first().waitFor();
ok('ADM vê a página condenada primeiro, com o motivo', /Nova digitalização pedida pela professora: erro de digitalização/.test(await page.locator('#fl-linhas tr').first().textContent()));
ok('Folhas já corrigidas não têm botão de correção no ADM', await page.locator('#fl-linhas tr[data-pagina="1"]').getByRole('button', { name: 'Corrigir' }).count() === 0 && /corrigida pela professora/.test(await page.locator('#fl-linhas tr[data-pagina="1"]').textContent()));
await page.locator('#fl-linhas tr').first().getByRole('button', { name: 'Devolver à professora' }).click();
await page.waitForFunction(() => /devolvida à professora/.test(document.querySelector('#fl-status').textContent));
ok('ADM devolve pela tela', !db.prepare('SELECT 1 FROM redacao_correcoes WHERE lote_id = ? AND pagina = 2').get(loteId));
ok('Tela sem erro JavaScript', errors.length === 0, errors.join(' | '));
await browser.close();
await new Promise(resolve => server.close(resolve));
for (const [estado, nome, extra] of results) console.log(estado.padEnd(7), nome, extra);
const falhas = results.filter(x => x[0] === 'FALHOU').length;
console.log(falhas ? `FALHOU: ${falhas} falha(s) em ${results.length}` : `TODOS: ${results.length} verificações passaram`);
if (falhas) process.exitCode = 1;
