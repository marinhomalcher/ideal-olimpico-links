// Portal do aluno: aba "Certificados" (20/11/2026), com o Worker do portal simulado. Aluno fictício (99999), sem dado real.
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
const ALUNO = { matricula: '99999', nome: 'ALUNO TESTE', email: '99999@aluno.grupoideal.com.br', unidade: 'BATISTA CAMPOS', serie: '3ª SÉRIE', segmento: 'EM', dataNascimento: '01/01/2009', cpf: '52998224725', whatsappAluno: '(91) 99999-9999', emailPessoal: 'familia@example.com', anoAtual: 2026, contatosConfirmadosNesteAno: true };
let CERT = { anos: [2025, 2024], certificados: [
  { ano: 2025, nome: 'OBMEP - PARTICIPACAO', tamanho: 181000, url: 'https://grupoideal.sharepoint.com/sites/x/_layouts/15/download.aspx?a=1' },
  { ano: 2025, nome: 'CANGURU', tamanho: 90000, url: 'https://grupoideal.sharepoint.com/sites/x/_layouts/15/download.aspx?a=2' },
  { ano: 2024, nome: 'OBR - OURO', tamanho: 70000, url: '' },
  { ano: 2024, nome: '<b>x</b>', tamanho: 1, url: 'https://malicioso.example/a.pdf' }
] };
const chamadas = [];
const browser = await chromium.launch();
async function contexto(viewport) {
  const ctx = await browser.newContext(viewport);
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
    const falha = error => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': ORIGEM }, body: JSON.stringify({ ok: false, error }) });
    if (c.method === 'solicitarCodigoAluno') return r({ ok: true, email: ALUNO.email });
    if (c.method === 'autenticarAlunoCodigo') return r({ status: 'OK', sessao: 'S'.repeat(64), aluno: ALUNO });
    if (c.method === 'confirmarCadastroAluno') return r({ home: [] });
    if (c.method === 'listarPedidosAluno') return r({ pedidos: [] });
    if (c.method === 'meuDesempenho') return r({ ano: 2026, documentos: [] });
    if (c.method === 'minhasConquistas') return r({ anos: [], catalogo: {}, participou: {}, conquistas: [] });
    if (c.method === 'meusCertificados') return CERT === 'SEM_FUNCAO' ? falha('Operação não permitida.') : CERT === 'ERRO' ? falha('Não foi possível abrir o Certificados agora. Tente de novo em instantes.') : r(CERT);
    return r({});
  });
  await ctx.addInitScript(() => { window.__cspv = []; document.addEventListener('securitypolicyviolation', e => window.__cspv.push(e.violatedDirective + ' ' + (e.blockedURI || ''))); });
  return ctx;
}
const erros = [];
async function entrar(page) {
  await page.goto(ORIGEM + '/inscricoes/');
  await page.fill('#matriculaInput', '99999'); await page.click('#loginBtn'); await page.waitForSelector('#etapaCodigo:not(.hidden)');
  await page.fill('#codigoInput', '123456'); await page.click('#codigoBtn'); await page.waitForSelector('#cadastroSec:not(.hidden)');
  await page.click('#confirmarCadastroBtn'); await page.waitForSelector('#abasAluno:not(.hidden)');
}

const ctx = await contexto({ viewport: { width: 1366, height: 900 } });
let page = await ctx.newPage();
page.on('pageerror', e => erros.push(e.message));
await entrar(page);
ok('Aba Certificados entre Conquistas e Competições', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#abasAluno .aba')].map(b => b.id))) === JSON.stringify(['abaDesempenho', 'abaConquistas', 'abaCertificados', 'abaCompeticoes', 'abaPedidos']));
await page.click('#abaCertificados');
await page.waitForSelector('#certificadosConteudo .cert-ano');
let e = await page.evaluate(() => ({
  ativa: document.querySelector('#abasAluno .aba.ativa')?.id,
  outras: ['desempenhoSec', 'conquistasSec', 'home', 'pedidosSec'].every(id => document.getElementById(id).classList.contains('hidden')),
  anos: [...document.querySelectorAll('.cert-ano-num')].map(x => x.textContent),
  itens: [...document.querySelectorAll('.cert-item')].map(li => [li.querySelector('.cert-nome').childNodes[0].textContent, li.querySelector('.cert-baixar')?.getAttribute('href') || '', li.querySelector('.cert-baixar')?.getAttribute('download') || '', li.querySelector('.cert-indisponivel')?.textContent || '']),
  html: document.querySelector('#certificadosConteudo').innerHTML, turma: document.getElementById('certificadosTurma').textContent
}));
ok('Aba ativa e as outras seções escondidas', e.ativa === 'abaCertificados' && e.outras && e.turma === '3ª SÉRIE · BATISTA CAMPOS', JSON.stringify(e));
ok('Anos do mais novo ao mais antigo, itens em ordem de nome', JSON.stringify(e.anos) === '["2025","2024"]' && e.itens.map(i => i[0]).join('|') === 'CANGURU|OBMEP - PARTICIPACAO|<b>x</b>|OBR - OURO', JSON.stringify(e.itens));
ok('Link de download só do SharePoint; sem link mostra "Indisponível"; nome escapado', e.itens[0][1].startsWith('https://grupoideal.sharepoint.com/') && e.itens[0][2] === 'CANGURU.pdf' && e.itens[3][3] === 'Indisponível agora' && e.itens[2][3] === 'Indisponível agora' && !/<b>/.test(e.html), JSON.stringify(e.itens));
ok('Tamanho em KB', /177 KB/.test(e.html) && /88 KB/.test(e.html), e.html.slice(0, 200));
if (process.env.ATLAS_PNG_DIR) await page.screenshot({ path: process.env.ATLAS_PNG_DIR + '/portal-certificados.png', fullPage: true });
await page.click('#abaConquistas'); await page.click('#abaCertificados');
ok('Voltar à aba não pede de novo (links valem ~1 h)', chamadas.filter(c => c.method === 'meusCertificados').length === 1);
await page.evaluate(() => { certificadosEm = Date.now() - 60 * 60 * 1000; });
await page.click('#abaConquistas'); await page.click('#abaCertificados'); await page.waitForSelector('#certificadosConteudo .cert-ano');
ok('Links vencidos: busca de novo sozinha', chamadas.filter(c => c.method === 'meusCertificados').length === 2);
ok('Nenhuma violação de CSP', (await page.evaluate(() => window.__cspv)).length === 0, (await page.evaluate(() => window.__cspv)).join('|'));
await page.click('text=TROCAR ALUNO');
ok('Trocar aluno esconde a aba', await page.evaluate(() => document.getElementById('certificadosSec').classList.contains('hidden')));

/* sem certificados / servidor sem a função / erro */
CERT = { anos: [], certificados: [] };
await entrar(page); await page.click('#abaCertificados'); await page.waitForSelector('#certificadosConteudo .cq-vazio');
ok('Sem certificados: mensagem de "vão aparecer aqui"', /vão aparecer aqui/.test(await page.textContent('#certificadosConteudo')));
await page.click('text=TROCAR ALUNO');
CERT = 'SEM_FUNCAO';
await entrar(page); await page.click('#abaCertificados'); await page.waitForSelector('#certificadosConteudo .cq-vazio');
ok('Servidor ainda sem a função: "vão aparecer aqui", sem erro', /vão aparecer aqui/.test(await page.textContent('#certificadosConteudo')) && !(await page.textContent('#certificadosMsg')));
await page.click('text=TROCAR ALUNO');
CERT = 'ERRO';
await entrar(page); await page.click('#abaCertificados'); await page.waitForSelector('#certificadosMsg .message');
ok('Erro do servidor aparece como mensagem', /Tente de novo/.test(await page.textContent('#certificadosMsg')));
await page.close(); await ctx.close();

/* celular */
CERT = { anos: [2025], certificados: [{ ano: 2025, nome: 'OBMEP - PARTICIPACAO', tamanho: 181000, url: 'https://grupoideal.sharepoint.com/sites/x/a.pdf' }] };
const cel = await contexto({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page = await cel.newPage(); page.on('pageerror', e2 => erros.push(e2.message));
await entrar(page); await page.click('#abaCertificados'); await page.waitForSelector('.cert-item');
const larg = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
ok('Celular: sem rolagem para o lado', larg[0] <= larg[1], larg.join('/'));
if (process.env.ATLAS_PNG_DIR) await page.screenshot({ path: process.env.ATLAS_PNG_DIR + '/portal-certificados-celular.png', fullPage: true });
await cel.close();

await browser.close();
ok('Sem erro de JavaScript', erros.length === 0, erros.join('|'));
for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK').length;
console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`);
process.exit(bad ? 1 : 0);
