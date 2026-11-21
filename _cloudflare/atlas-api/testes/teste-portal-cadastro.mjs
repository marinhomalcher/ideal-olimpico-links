// Portal do aluno: "Confira seus dados" com contatos travados para quem já confirmou no ano (18/11/2026).
// Worker do portal simulado. Alunos fictícios (matrícula 99999), sem dado real.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const INS = fileURLToPath(new URL('../../../inscricoes/', import.meta.url));
const results = [];
const ok = (n, c, e = '') => results.push([c ? 'OK' : 'FALHOU', n, String(e).slice(0, 300)]);
const ORIGEM = 'https://idealolimpico.com.br';
const tipos = { html: 'text/html; charset=utf-8', js: 'application/javascript', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', json: 'application/json' };

const BASE = { matricula: '99999', nome: 'ALUNO TESTE', email: '99999@aluno.grupoideal.com.br', unidade: 'BC', serie: '3ª Série', segmento: 'EM', dataNascimento: '01/01/2010', cpf: '52998224725', whatsappAluno: '(91) 99999-9999', emailPessoal: 'familia@example.com', anoAtual: 2026 };
let alunoMock = BASE;
const chamadas = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.route(ORIGEM + '/inscricoes/**', route => {
  let f = new URL(route.request().url()).pathname.replace('/inscricoes/', '');
  if (f === '' || f.endsWith('/')) f += 'index.html';
  if (!fs.existsSync(INS + f)) return route.fulfill({ status: 404, body: 'nao encontrado' });
  return route.fulfill({ status: 200, contentType: tipos[f.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(INS + f) });
});
await ctx.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: 'window.QRCode=function(){}' }));
await ctx.route('https://ideal-olimpico-producao.marinhomalcher.workers.dev/**', route => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': ORIGEM, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } });
  let c = {}; try { c = JSON.parse(req.postData() || '{}'); } catch {}
  chamadas.push(c);
  const r = data => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': ORIGEM }, body: JSON.stringify({ ok: true, data }) });
  if (c.method === 'solicitarCodigoAluno') return r({ ok: true, email: BASE.email, mensagem: 'Código enviado.' });
  if (c.method === 'autenticarAlunoCodigo') return r({ status: 'OK', sessao: 'S'.repeat(64), aluno: alunoMock });
  if (c.method === 'confirmarCadastroAluno') return r({ home: [] });
  if (c.method === 'listarPedidosAluno') return r({ pedidos: [] });
  if (c.method === 'meuDesempenho') return r({ ano: 2026, documentos: [] });
  return r({});
});

const erros = [];
async function entrar(aluno) {
  alunoMock = aluno;
  const page = await ctx.newPage();
  page.on('pageerror', e => erros.push(e.message));
  await page.goto(ORIGEM + '/inscricoes/');
  await page.fill('#matriculaInput', '99999');
  await page.click('#loginBtn');
  await page.waitForSelector('#etapaCodigo:not(.hidden)');
  await page.fill('#codigoInput', '123456');
  await page.click('#codigoBtn');
  await page.waitForSelector('#cadastroSec:not(.hidden)');
  return page;
}
const estado = page => page.evaluate(() => {
  const ids = ['cadCpfNovo', 'cadWhatsappAluno', 'cadEmailPessoal', 'cadRespNome', 'cadRespWhatsapp'];
  const vis = id => { const el = document.getElementById(id); return !!el && el.offsetParent !== null; };
  return {
    travados: ids.filter(id => document.getElementById(id).readOnly).length,
    vinculoTravado: document.getElementById('cadRespVinculo').disabled,
    repitaVisivel: vis('cadEmailPessoal2'),
    editarVisivel: vis('editarCadastroBtn'),
    confirmarVisivel: vis('confirmarCadastroBtn'),
    aviso: document.getElementById('annualOk').classList.contains('hidden') ? '' : document.getElementById('annualOk').textContent
  };
});
const confirmacoes = () => chamadas.filter(c => c.method === 'confirmarCadastroAluno');

/* 1. Já confirmou neste ano: tudo travado, sem "Repita", com EDITAR ao lado de CONFIRMAR */
const CONF = { ...BASE, contatosConfirmadosAno: 2026, contatosConfirmadosNesteAno: true };
let page = await entrar(CONF);
let e = await estado(page);
ok('Já confirmou no ano: contatos travados', e.travados === 5 && e.vinculoTravado, JSON.stringify(e));
ok('Já confirmou no ano: "Repita o e-mail" escondido e EDITAR visível', !e.repitaVisivel && e.editarVisivel && e.confirmarVisivel, JSON.stringify(e));
ok('Aviso explica CONFIRMAR e EDITAR', /CONFIRMAR DADOS/.test(e.aviso) && /EDITAR/.test(e.aviso), e.aviso);
ok('EDITAR fica ao lado de CONFIRMAR DADOS', await page.evaluate(() => { const a = document.getElementById('editarCadastroBtn').getBoundingClientRect(), b = document.getElementById('confirmarCadastroBtn').getBoundingClientRect(); return Math.abs(a.top - b.top) < 4 && a.right <= b.left; }));
if (process.env.ATLAS_PNG_DIR) await page.screenshot({ path: process.env.ATLAS_PNG_DIR + '/portal-cadastro-travado.png', fullPage: true });
await page.click('#confirmarCadastroBtn');
await page.waitForSelector('#desempenhoSec:not(.hidden)');
let c = confirmacoes().at(-1);
ok('CONFIRMAR sem digitar nada envia os dados salvos', c && c.args[0] === 'S'.repeat(64) && JSON.stringify(c.args[1]) === JSON.stringify({ whatsappAluno: '(91) 99999-9999', responsavelNome: '', responsavelVinculo: '', responsavelWhatsapp: '', emailPessoal: 'familia@example.com', cpf: '52998224725' }), JSON.stringify(c));
await page.close();

/* 2. EDITAR destrava tudo e volta a pedir o e-mail repetido */
page = await entrar(CONF);
const antes = confirmacoes().length;
await page.click('#editarCadastroBtn');
e = await estado(page);
ok('EDITAR destrava todos os contatos', e.travados === 0 && !e.vinculoTravado, JSON.stringify(e));
ok('EDITAR mostra "Repita o e-mail" vazio e some', e.repitaVisivel && !e.editarVisivel && await page.inputValue('#cadEmailPessoal2') === '', JSON.stringify(e));
if (process.env.ATLAS_PNG_DIR) await page.screenshot({ path: process.env.ATLAS_PNG_DIR + '/portal-cadastro-editar.png', fullPage: true });
await page.fill('#cadWhatsappAluno', '(91) 98888-7777');
await page.click('#confirmarCadastroBtn');
ok('Depois de EDITAR, sem repetir o e-mail não envia', confirmacoes().length === antes && /não são iguais/.test(await page.textContent('#cadastroMsg')) && await page.evaluate(() => document.activeElement.id === 'cadEmailPessoal2'));
await page.fill('#cadEmailPessoal2', 'familia@example.com');
await page.click('#confirmarCadastroBtn');
await page.waitForSelector('#desempenhoSec:not(.hidden)');
c = confirmacoes().at(-1);
ok('Depois de EDITAR, envia o contato novo', confirmacoes().length === antes + 1 && c.args[1].whatsappAluno === '(91) 98888-7777', JSON.stringify(c));
await page.close();

/* 3. Confirmou no ano, mas o salvo está incompleto: abre destravado */
page = await entrar({ ...CONF, emailPessoal: '' });
e = await estado(page);
ok('Dados salvos incompletos: abre destravado, sem EDITAR', e.travados === 0 && e.repitaVisivel && !e.editarVisivel && /Revise/.test(e.aviso), JSON.stringify(e));
await page.close();

/* 4. Ainda não confirmou neste ano: como antes */
page = await entrar({ ...BASE, contatosConfirmadosAno: 2025, contatosConfirmadosNesteAno: false });
e = await estado(page);
ok('Primeira confirmação do ano: destravado, sem aviso e sem EDITAR', e.travados === 0 && e.repitaVisivel && !e.editarVisivel && e.aviso === '', JSON.stringify(e));
ok('Primeira confirmação do ano: "Repita o e-mail" vem vazio', await page.inputValue('#cadEmailPessoal2') === '');
await page.close();

/* 5. Fundamental 1 com responsável salvo: trava e envia o vínculo */
const EF1 = { ...CONF, segmento: 'EF1', serie: '4º Ano', whatsappAluno: '', responsavelNome: 'RESPONSÁVEL TESTE', responsavelVinculo: 'Mãe', responsavelWhatsapp: '(91) 97777-6666' };
page = await entrar(EF1);
e = await estado(page);
ok('EF1 já confirmado: travado', e.travados === 5 && e.vinculoTravado && e.editarVisivel, JSON.stringify(e));
await page.click('#confirmarCadastroBtn');
await page.waitForSelector('#desempenhoSec:not(.hidden)');
c = confirmacoes().at(-1);
ok('EF1: envia nome, vínculo e WhatsApp do responsável salvos', c.args[1].responsavelNome === 'RESPONSÁVEL TESTE' && c.args[1].responsavelVinculo === 'Mãe' && c.args[1].responsavelWhatsapp === '(91) 97777-6666', JSON.stringify(c));
await page.close();

/* 6. EF1 com vínculo salvo fora da lista: destrava para corrigir */
page = await entrar({ ...EF1, responsavelVinculo: 'Madrinha' });
e = await estado(page);
ok('Vínculo salvo fora da lista: abre destravado', e.travados === 0 && !e.editarVisivel, JSON.stringify(e));
await page.close();

/* 7. Celular: EDITAR e CONFIRMAR em largura cheia, sem rolagem para o lado */
page = await entrar(CONF);
await page.setViewportSize({ width: 390, height: 844 });
const m = await page.evaluate(() => { const a = document.getElementById('editarCadastroBtn').getBoundingClientRect(), b = document.getElementById('confirmarCadastroBtn').getBoundingClientRect(); return { doc: document.documentElement.scrollWidth, tela: innerWidth, aL: a.width, bL: b.width, aTop: a.top, bTop: b.top }; });
ok('Celular: botões visíveis e sem rolagem para o lado', m.doc <= m.tela && m.aL > 0 && m.bL > 0, JSON.stringify(m));
if (process.env.ATLAS_PNG_DIR) await page.screenshot({ path: process.env.ATLAS_PNG_DIR + '/portal-cadastro-celular.png', fullPage: true });
await page.close();

/* 8. ATLAS como base (21/11/2026): a prova que veio no login volta dentro dos dados da confirmação */
page = await entrar({ ...CONF, atlasProva: 'f'.repeat(64) });
await page.click('#confirmarCadastroBtn');
await page.waitForSelector('#desempenhoSec:not(.hidden)');
c = confirmacoes().at(-1);
ok('Com a prova do ATLAS, a confirmação leva {atlas: {ra, prova}} junto dos contatos', c && c.args[1].atlas && c.args[1].atlas.ra === '99999' && c.args[1].atlas.prova === 'f'.repeat(64) && c.args[1].cpf === '52998224725', JSON.stringify(c));
await page.close();
page = await entrar(CONF);
await page.click('#confirmarCadastroBtn');
await page.waitForSelector('#desempenhoSec:not(.hidden)');
c = confirmacoes().at(-1);
ok('Sem a prova (Worker antigo), a confirmação vai como antes, sem o campo atlas', c && !('atlas' in c.args[1]), JSON.stringify(c));
await page.close();

await browser.close();
ok('Sem erro de JavaScript', erros.length === 0, erros.join('|'));
for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK').length;
console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`);
process.exit(bad ? 1 : 0);
