// Portal do aluno: aba "Meu desempenho" (abas, bimestres, 4 cartões, visualizador sem download)
// com o Worker do portal e o SharePoint simulados. Aluno fictício (matrícula 99999), sem dado real.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const INS = fileURLToPath(new URL('../../../inscricoes/', import.meta.url));
const results = [];
const ok = (n, c, e = '') => results.push([c ? 'OK' : 'FALHOU', n, String(e).slice(0, 300)]);
const ORIGEM = 'https://idealolimpico.com.br';
const tipos = { html: 'text/html; charset=utf-8', js: 'application/javascript', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', json: 'application/json' };

const html = fs.readFileSync(INS + 'index.html', 'utf8');
ok('CSP libera imagens só do SharePoint do grupo (além de self/data/blob)', /img-src 'self' data: blob: https:\/\/grupoideal\.sharepoint\.com;/.test(html));
ok('worker-client.js conhece os dois métodos novos', /meuDesempenho:1,paginasDesempenho:2/.test(fs.readFileSync(INS + 'worker-client.js', 'utf8')));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
/* imagens fictícias das páginas (JPEG feito num canvas) */
const gerador = await ctx.newPage();
const jpeg = async (texto, cor) => Buffer.from(await gerador.evaluate(([t, c]) => { const x = document.createElement('canvas'); x.width = 900; x.height = 1270; const g = x.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 1270); g.fillStyle = c; g.fillRect(40, 40, 820, 70); g.fillStyle = '#222'; g.font = 'bold 40px Arial'; g.fillText(t, 60, 200); for (let i = 0; i < 18; i++) { g.fillStyle = i % 3 ? '#e3f3e8' : '#f9dfe2'; g.fillRect(60, 260 + i * 50, 780, 36); } return x.toDataURL('image/jpeg', 0.8).split(',')[1]; }, [texto, cor]), 'base64');
const IMG = { p1: await jpeg('MAPA FICTÍCIO · página 1', '#98151d'), p2: await jpeg('MAPA FICTÍCIO · página 2', '#98151d'), esp: await jpeg('ESPELHO FICTÍCIO', '#1f7a7a') };
await gerador.close();

const chamadas = [], pedidosImg = [];
let linkVencido = false;
/* grade fictícia da 1ª página do cartão (imagem 900 × 1270): 2 blocos de 5 alternativas e 3 linhas, como o
   atlas-cartao.js serializa (marcas de cima, de baixo, da esquerda e da direita; blocos como índices de coluna) */
const GRADE = {
  w: 900, h: 1270, blocos: [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]], linhas: 3,
  t: [[100, 600], [130, 600], [160, 600], [190, 600], [220, 600], [400, 600], [430, 600], [460, 600], [490, 600], [520, 600]],
  b: [[100, 760], [130, 760], [160, 760], [190, 760], [220, 760], [400, 760], [430, 760], [460, 760], [490, 760], [520, 760]],
  esq: [[40, 640], [40, 680], [40, 720]], dir: [[860, 640], [860, 680], [860, 720]]
};
const DOCS = [
  { id: 11, bimestre: 1, prova: 'PART', paginas: 2, liberado_em: '2026-04-10T12:00:00Z' },
  { id: 12, bimestre: 2, prova: 'ENEM1', paginas: 2, liberado_em: '2026-06-24T12:00:00Z' },
  { id: 13, bimestre: 2, prova: 'ESPELHO', paginas: 1, liberado_em: '2026-06-30T12:00:00Z' }
];
await ctx.route(ORIGEM + '/inscricoes/**', route => {
  let f = new URL(route.request().url()).pathname.replace('/inscricoes/', '');
  if (f === '' || f.endsWith('/')) f += 'index.html';
  if (!fs.existsSync(INS + f)) return route.fulfill({ status: 404, body: 'nao encontrado' });
  return route.fulfill({ status: 200, contentType: tipos[f.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(INS + f) });
});
await ctx.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: 'window.QRCode=function(){}' }));
const SP = 'https://grupoideal.sharepoint.com/sites/ResultadosIDEALOLMPICO/_layouts/15/download.aspx?UniqueId=';
await ctx.route('https://ideal-olimpico-producao.marinhomalcher.workers.dev/**', route => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': ORIGEM, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } });
  let c = {}; try { c = JSON.parse(req.postData() || '{}'); } catch {}
  chamadas.push(c);
  const r = data => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': ORIGEM }, body: JSON.stringify({ ok: true, data }) });
  if (c.method === 'solicitarCodigoAluno') return r({ ok: true, email: '99999@aluno.grupoideal.com.br', mensagem: 'Código enviado.' });
  if (c.method === 'autenticarAlunoCodigo') return r({ status: 'OK', sessao: 'S'.repeat(64), aluno: { matricula: '99999', nome: 'ALUNO TESTE DA SILVA', email: '99999@aluno.grupoideal.com.br', unidade: 'BATISTA CAMPOS', serie: '3ª SÉRIE', segmento: 'EM', dataNascimento: '01/01/2009', cpf: '52998224725', whatsappAluno: '(91) 99999-9999', emailPessoal: 'teste@example.com' } });
  if (c.method === 'confirmarCadastroAluno') return r({ home: [{ id: 'IDEAL', nome: 'IDEAL', subtitulo: 'Simulados', abertas: 1, emBreve: 0, encerradas: 0 }] });
  if (c.method === 'listarPedidosAluno') return r({ pedidos: [] });
  if (c.method === 'meuDesempenho') return r({ ano: 2026, documentos: DOCS });
  if (c.method === 'paginasDesempenho') {
    const id = c.args[1], v = linkVencido ? 'vencido' : 'ok';
    linkVencido = false;
    /* id 11: cartão com gabarito na 1ª página (grade fictícia de 2 blocos × 3 linhas); id 12: "cartao" malformado, que deve ser ignorado */
    const cartao = id === 11 ? { inicio: 1, gabarito: ['A', 'B', 'X', 'C/D', 'E', 'A'], respostas: 'AC_DEB', paginas: [GRADE, null] } : id === 12 ? { gabarito: 'ABC', paginas: 'x' } : null;
    return r({ links: id === 13 ? [SP + 'esp-' + v] : [SP + 'p1-' + v, SP + 'p2-' + v, 'https://evil.example/x.jpg'], cartao });
  }
  return r({});
});
await ctx.route('https://grupoideal.sharepoint.com/**', route => {
  const u = route.request().url(); pedidosImg.push(u);
  if (u.endsWith('-vencido')) return route.fulfill({ status: 403, body: 'expirado' });
  const qual = u.includes('esp-') ? IMG.esp : u.includes('p2-') ? IMG.p2 : IMG.p1;
  return route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'content-disposition': 'attachment; filename="p.jpg"' }, body: qual });
});
await ctx.route('https://evil.example/**', route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: IMG.p1 }));
await ctx.addInitScript(() => { window.__cspv = []; document.addEventListener('securitypolicyviolation', e => window.__cspv.push(e.violatedDirective + ' ' + (e.blockedURI || ''))); });

const page = await ctx.newPage();
const erros = [];
page.on('pageerror', e => erros.push(e.message));
await page.goto(ORIGEM + '/inscricoes/');
await page.fill('#matriculaInput', '99999');
await page.click('#loginBtn');
await page.waitForSelector('#etapaCodigo:not(.hidden)');
await page.fill('#codigoInput', '123456');
await page.click('#codigoBtn');
await page.waitForSelector('#cadastroSec:not(.hidden)');
ok('Antes de confirmar os dados, as abas não aparecem', await page.evaluate(() => document.getElementById('abasAluno').classList.contains('hidden')));
await page.fill('#cadEmailPessoal2', 'teste@example.com');
await page.click('#confirmarCadastroBtn');
await page.waitForSelector('#desempenhoSec:not(.hidden)');
await page.waitForSelector('#desempenhoGrid .desempenho-card');
const estado = await page.evaluate(() => ({
  abas: [...document.querySelectorAll('#abasAluno .aba')].map(b => b.textContent.trim()),
  ativa: document.querySelector('#abasAluno .aba.ativa')?.id, home: !document.getElementById('home').classList.contains('hidden'),
  turma: document.getElementById('desempenhoTurma').textContent,
  bim: document.querySelector('.bim.ativo')?.textContent, vazios: [...document.querySelectorAll('.bim.vazio')].map(b => b.textContent),
  cards: [...document.querySelectorAll('.desempenho-card')].map(c => [c.querySelector('h3').textContent, c.querySelector('.status-chip').textContent, c.querySelector('button').textContent, c.querySelector('button').disabled])
}));
ok('Depois de confirmar: abas na ordem e "Meu desempenho" aberto primeiro', JSON.stringify(estado.abas) === JSON.stringify(['📈 MEU DESEMPENHO', '🏆 MINHAS CONQUISTAS', '📜 CERTIFICADOS', '🏅 COMPETIÇÕES OLÍMPICAS', '🛒 MEUS PEDIDOS']) && estado.ativa === 'abaDesempenho' && !estado.home, JSON.stringify(estado));
ok('Mostra série e unidade do aluno', estado.turma === '3ª SÉRIE · BATISTA CAMPOS', estado.turma);
ok('Abre no último bimestre com documento; 3º e 4º aparecem apagados', estado.bim === '2º bimestre' && JSON.stringify(estado.vazios) === JSON.stringify(['3º bimestre', '4º bimestre']), JSON.stringify(estado));
ok('Quatro cartões: Particulares, ENEM 1º dia, ENEM 2º dia e Espelho', estado.cards.map(c => c[0]).join('|') === 'Simulado Particulares|Simulado ENEM · 1º dia|Simulado ENEM · 2º dia|Espelho da redação', JSON.stringify(estado.cards));
ok('Liberados com data e botão; o resto "Ainda não liberado" e "EM BREVE"', JSON.stringify(estado.cards.map(c => c.slice(1))) === JSON.stringify([['Ainda não liberado', 'EM BREVE', true], ['Liberado em 24/06', 'VER MAPA', false], ['Ainda não liberado', 'EM BREVE', true], ['Liberado em 30/06', 'VER ESPELHO', false]]), JSON.stringify(estado.cards));
const chamadaLista = chamadas.find(c => c.method === 'meuDesempenho');
ok('Pede a lista só com a sessão (nenhum RA vai do navegador)', chamadaLista && chamadaLista.args.length === 1 && chamadaLista.args[0] === 'S'.repeat(64));
if (process.env.ATLAS_PNG_DIR) await page.screenshot({ path: process.env.ATLAS_PNG_DIR + '/portal-desempenho-pc.png' });

await page.click('[data-acao=escolherBimestre][data-arg="1"]');
ok('Trocar de bimestre mostra o que há nele', await page.evaluate(() => document.querySelector('.bim.ativo').textContent === '1º bimestre' && document.querySelectorAll('.desempenho-card button:not([disabled])').length === 1 && document.querySelector('.desempenho-card button:not([disabled])').textContent === 'VER MAPA'));
await page.click('.desempenho-card button:not([disabled])');
await page.waitForFunction(() => { const i = document.getElementById('visorImg'); return i.complete && i.naturalWidth > 0 && !i.classList.contains('hidden'); });
let v = await page.evaluate(() => ({ aberto: document.getElementById('visorDesempenho').open, titulo: document.getElementById('visorTitulo').textContent, pag: document.getElementById('visorPagina').textContent, src: document.getElementById('visorImg').src, links: document.querySelectorAll('#visorDesempenho a').length, download: !!document.querySelector('#visorDesempenho [download]') }));
ok('Visualizador abre a 1ª página do mapa', v.aberto && v.titulo === 'Simulado Particulares · 1º bimestre' && v.pag === 'Página 1 de 2' && v.src.includes('p1-ok'), JSON.stringify(v));
ok('Visualizador sem link nem botão de download', v.links === 0 && !v.download);
ok('Link de fora do SharePoint do grupo é descartado', !pedidosImg.some(u => u.includes('evil')) && v.pag.endsWith('de 2'));
const menu = await page.evaluate(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.getElementById('visorImg').dispatchEvent(e); return e.defaultPrevented; });
ok('Menu do botão direito ("salvar imagem") bloqueado na imagem', menu);
ok('Imagem não arrastável e sem seleção', await page.evaluate(() => { const i = document.getElementById('visorImg'); return i.draggable === false && getComputedStyle(i).userSelect === 'none'; }));
/* gabarito por cima do cartão: 1ª página tem grade; acertou A (verde cheio), errou a 2ª (C em vez de B: vermelho com X
   e anel verde na B), 3ª anulada (5 anéis roxos), 4ª aceita C ou D e marcou D (verde cheio no D e anel verde no C),
   5ª acertou E, 6ª marcou B e a certa é A */
const masc = await page.evaluate(() => {
  const svg = document.getElementById('visorMascara'), circ = [...svg.querySelectorAll('circle')], path = svg.querySelectorAll('path').length;
  const cheios = circ.filter(c => c.getAttribute('fill') !== 'none'), verdes = cheios.filter(c => c.getAttribute('fill') === '#17863b'), vermelhos = cheios.filter(c => c.getAttribute('fill') === '#d6222a');
  const roxos = circ.filter(c => c.getAttribute('stroke') === '#6b53c4'), aneisVerdes = circ.filter(c => c.getAttribute('fill') === 'none' && c.getAttribute('stroke') === '#17863b');
  const folha = document.getElementById('visorFolha').getBoundingClientRect(), s = svg.getBoundingClientRect();
  return { visivel: !svg.classList.contains('hidden'), viewBox: svg.getAttribute('viewBox'), total: circ.length, verdes: verdes.length, vermelhos: vermelhos.length, roxos: roxos.length, aneisVerdes: aneisVerdes.length, riscos: path,
    botao: !document.getElementById('visorGabarito').classList.contains('hidden'), pressionado: document.getElementById('visorGabarito').getAttribute('aria-pressed'),
    resumo: document.getElementById('visorResumo').textContent, sobreposta: Math.abs(folha.width - s.width) < 2 && Math.abs(folha.height - s.height) < 2,
    primeiro: circ[0] && [circ[0].getAttribute('cx'), circ[0].getAttribute('cy')] };
});
ok('Máscara do gabarito desenhada por cima da 1ª página, do tamanho da imagem', masc.visivel && masc.viewBox === '0 0 900 1270' && masc.sobreposta && masc.botao && masc.pressionado === 'true', JSON.stringify(masc));
ok('Acertos verdes cheios (A, D, E), erros vermelhos com X (2) e anel verde na certa (B, C, A), anulada roxa (5)', masc.verdes === 3 && masc.vermelhos === 2 && masc.riscos === 2 && masc.aneisVerdes === 3 && masc.roxos === 5 && masc.total === 13, JSON.stringify(masc));
ok('Centro da 1ª bolha vem do cruzamento das marcas (coluna A × linha 1)', masc.primeiro && masc.primeiro[0] === '100.0' && masc.primeiro[1] === '640.0', JSON.stringify(masc.primeiro));
ok('Resumo: 4 de 6, com acertos, erros, em branco e anuladas', /^4 de 6 · 3 acertos · 2 erros · 0 em branco · 1 anulada$/.test(masc.resumo), masc.resumo);
await page.click('#visorGabarito');
ok('Botão "Gabarito" esconde a máscara e mostra o cartão limpo', await page.evaluate(() => document.getElementById('visorMascara').classList.contains('hidden') && document.getElementById('visorGabarito').getAttribute('aria-pressed') === 'false'));
await page.click('#visorGabarito');
ok('… e liga de novo', await page.evaluate(() => !document.getElementById('visorMascara').classList.contains('hidden')));
await page.click('[data-acao=visorProxima]');
await page.waitForFunction(() => document.getElementById('visorImg').src.includes('p2-ok') && document.getElementById('visorImg').naturalWidth > 0);
ok('Próxima página', await page.evaluate(() => document.getElementById('visorPagina').textContent === 'Página 2 de 2' && document.querySelector('[data-acao=visorProxima]').disabled));
ok('Página sem grade: sem máscara e sem o botão', await page.evaluate(() => document.getElementById('visorMascara').classList.contains('hidden') && document.getElementById('visorMascara').childElementCount === 0 && document.getElementById('visorGabarito').classList.contains('hidden')));
await page.click('[data-acao=visorZoom][data-arg="1"]');
ok('Zoom aumenta a página (e a máscara vai junto, na mesma camada)', await page.evaluate(() => document.getElementById('visorFolha').classList.contains('zoom-1-5') && document.getElementById('visorFolha').getBoundingClientRect().width > document.getElementById('visorArea').clientWidth && document.getElementById('visorImg').getBoundingClientRect().width === document.getElementById('visorFolha').getBoundingClientRect().width));
await page.click('#visorDesempenho .close');
ok('Fechar o visualizador', await page.evaluate(() => !document.getElementById('visorDesempenho').open && !document.getElementById('visorImg').getAttribute('src') && document.getElementById('visorMascara').childElementCount === 0));
/* "cartao" fora da forma esperada é ignorado em silêncio */
await page.click('[data-acao=escolherBimestre][data-arg="2"]');
await page.click('[data-acao=verDocumento][data-arg="12"]');
await page.waitForFunction(() => { const i = document.getElementById('visorImg'); return i.complete && i.naturalWidth > 0 && !i.classList.contains('hidden'); });
ok('Cartão malformado vindo do servidor: visor abre sem máscara, sem botão e sem resumo', await page.evaluate(() => document.getElementById('visorGabarito').classList.contains('hidden') && document.getElementById('visorMascara').childElementCount === 0 && document.getElementById('visorResumo').textContent === ''));
await page.click('#visorDesempenho .close');

/* link temporário vencido: pede links novos uma vez, sozinho */
await page.click('[data-acao=escolherBimestre][data-arg="2"]');
linkVencido = true;
const antes = chamadas.filter(c => c.method === 'paginasDesempenho').length;
await page.click('[data-acao=verDocumento][data-arg="13"]');
await page.waitForFunction(() => document.getElementById('visorImg').src.includes('esp-ok') && document.getElementById('visorImg').naturalWidth > 0);
ok('Link vencido: busca links novos e abre o espelho', chamadas.filter(c => c.method === 'paginasDesempenho').length === antes + 2 && await page.evaluate(() => document.getElementById('visorPagina').textContent === '' && document.querySelectorAll('[data-acao=visorProxima].hidden').length === 1));
if (process.env.ATLAS_PNG_DIR) await page.screenshot({ path: process.env.ATLAS_PNG_DIR + '/portal-desempenho-visor.png' });
await page.keyboard.press('Escape');
ok('Esc fecha o visualizador', await page.evaluate(() => !document.getElementById('visorDesempenho').open));

/* as outras abas continuam funcionando */
await page.click('#abaCompeticoes');
ok('Aba Competições mostra as competições', await page.evaluate(() => !document.getElementById('home').classList.contains('hidden') && document.getElementById('desempenhoSec').classList.contains('hidden') && document.querySelector('#abasAluno .aba.ativa').id === 'abaCompeticoes'));
await page.click('#abaPedidos');
await page.waitForSelector('#pedidosSec:not(.hidden)');
ok('Aba Meus pedidos abre os pedidos', await page.evaluate(() => document.getElementById('home').classList.contains('hidden') && document.querySelector('#abasAluno .aba.ativa').id === 'abaPedidos'));
await page.click('#abaDesempenho');
ok('Voltar ao Meu desempenho não pede a lista de novo', await page.evaluate(() => !document.getElementById('desempenhoSec').classList.contains('hidden')) && chamadas.filter(c => c.method === 'meuDesempenho').length === 1);
ok('Nenhuma violação de CSP (imagens do SharePoint permitidas)', (await page.evaluate(() => window.__cspv)).length === 0, (await page.evaluate(() => window.__cspv)).join('|'));
await page.click('text=TROCAR ALUNO');
ok('Trocar aluno esconde as abas e limpa o desempenho', await page.evaluate(() => document.getElementById('abasAluno').classList.contains('hidden') && document.getElementById('desempenhoSec').classList.contains('hidden') && desempenho === null));
ok('Sem erro de JavaScript', erros.length === 0, erros.join('|'));

/* celular */
const cel = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await cel.route(ORIGEM + '/inscricoes/**', route => { let f = new URL(route.request().url()).pathname.replace('/inscricoes/', ''); if (f === '' || f.endsWith('/')) f += 'index.html'; return fs.existsSync(INS + f) ? route.fulfill({ status: 200, contentType: tipos[f.split('.').pop()], body: fs.readFileSync(INS + f) }) : route.fulfill({ status: 404 }); });
await cel.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.QRCode=function(){}' }));
await cel.route('https://ideal-olimpico-producao.marinhomalcher.workers.dev/**', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': ORIGEM }, body: JSON.stringify({ ok: true, data: { ano: 2026, documentos: DOCS } }) }));
const pc = await cel.newPage();
await pc.goto(ORIGEM + '/inscricoes/');
await pc.evaluate(() => { alunoAtual = { sessao: 'S'.repeat(64), matricula: '99999', nome: 'ALUNO TESTE', serie: '3ª SÉRIE', unidade: 'BATISTA CAMPOS' }; document.getElementById('matriculaSec').classList.add('hidden'); mostrarAbas(true); abrirDesempenho(); });
await pc.waitForSelector('#desempenhoGrid .desempenho-card');
const larg = await pc.evaluate(() => ({ doc: document.documentElement.scrollWidth, tela: innerWidth, colunas: getComputedStyle(document.getElementById('desempenhoGrid')).gridTemplateColumns.split(' ').length }));
ok('Celular: cartões em uma coluna, sem rolagem para o lado', larg.colunas === 1 && larg.doc <= larg.tela, JSON.stringify(larg));
if (process.env.ATLAS_PNG_DIR) await pc.screenshot({ path: process.env.ATLAS_PNG_DIR + '/portal-desempenho-celular.png', fullPage: true });
await cel.close();

await browser.close();
for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK').length;
console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`);
process.exit(bad ? 1 : 0);
