// Hub de administração (adm/): CSP por meta tag, sem script inline, links apontando para páginas que
// existem, login do ADM (/api/adm/sessao) e abas. As telas iniciais do portal e do ATLAS não podem mais
// mostrar os acessos administrativos, mas as páginas de destino continuam existindo.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));
const results = [];
const ok = (n, c, e = '') => results.push([c ? 'OK' : 'FALHOU', n, String(e).slice(0, 200)]);
const ler = f => fs.readFileSync(RAIZ + f, 'utf8');

// ---------- 1. Conferências estáticas ----------
const hub = ler('adm/index.html'), hubJs = ler('adm/adm.js');
ok('adm/index.html tem meta CSP com default-src none', /<meta http-equiv="Content-Security-Policy" content="[^"]*default-src 'none'/.test(hub));
ok("CSP: script-src só 'self' e o cliente do Google", /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client;/.test(hub));
ok('CSP: connect-src só o atlas-api, o próprio site e o Google', /connect-src 'self' https:\/\/atlas-api\.marinhomalcher\.workers\.dev https:\/\/accounts\.google\.com\/gsi\/;/.test(hub));
ok('Nenhum atributo on*= no HTML', !/\son[a-z]+="/i.test(hub));
ok('Nenhum <script> inline no HTML', !/<script(?![^>]*\ssrc=)[^>]*>/i.test(hub));
ok('adm.js não usa innerHTML', !/innerHTML/.test(hubJs));
ok('ponte.js não usa innerHTML nem confirm/alert/prompt, e só aceita a ponte do Google', (() => { const p = ler('adm/ponte.js'); return !/innerHTML|\b(confirm|alert|prompt)\(/.test(p) && /script\.google\.com/.test(p) && /-script\.googleusercontent\.com/.test(p); })());
ok('CSP: frame-src libera só o Google (login, ponte e sua janela)', /frame-src https:\/\/accounts\.google\.com\/gsi\/ https:\/\/script\.google\.com https:\/\/\*\.googleusercontent\.com;/.test(hub));
ok('Token na mesma chave das páginas admin do ATLAS', /TOKEN_KEY = 'atlas_adm_token'/.test(hubJs) && /TOKEN_KEY='atlas_adm_token'/.test(ler('atlas/admin.html')));
const hrefs = [...hub.matchAll(/href="(\.\.\/[^"#?]+)/g)].map(m => m[1]);
const faltando = hrefs.filter(h => { const p = RAIZ + 'adm/' + h; return !(fs.existsSync(p) || fs.existsSync(p + 'index.html')); });
const soDesempenho = faltando.length === 0 || (faltando.length === 1 && faltando[0] === '../atlas/desempenho-admin.html');
ok('Todo link relativo do hub aponta para página existente (' + hrefs.length + ' links; "Meu desempenho" pode faltar até o ramo entrar)', hrefs.length >= 14 && soDesempenho, faltando.join(','));
const externos = [...hub.matchAll(/href="(https:[^"]+)"[^>]*>/g)].map(m => m[0]);
ok('Links externos abrem em nova aba com rel="noopener"', externos.length >= 2 && externos.every(e => /target="_blank"/.test(e) && /rel="noopener noreferrer"/.test(e)));
const raiz = ler('index.html'), atlasHome = ler('atlas/index.html');
ok('Raiz do site não mostra mais ÁREA DO COORDENADOR', !/COORDENADOR/i.test(raiz) && /ÁREA DO ALUNO/.test(raiz));
ok('Tela inicial do ATLAS não mostra mais o cartão Administrador', !/data-role="Administrador"/.test(atlasHome) && !/'Administrador'/.test(atlasHome));
ok('Tela inicial do ATLAS mantém Professor, Supervisor e Redação', ['Professor', 'Supervisor', 'Redação'].every(r => atlasHome.includes('data-role="' + r + '"')));
ok('Páginas de destino continuam existindo', ['inscricoes/coordenador/index.html', 'atlas/admin.html', 'atlas/admin-questoes.html', 'atlas/alunos-admin.html', 'atlas/redacao-lotes-admin.html'].every(f => fs.existsSync(RAIZ + f)));
ok('Páginas admin do ATLAS voltam ao painel /adm/', ['admin', 'admin-questoes', 'admin-selecoes', 'admin-relatorio', 'admin-enviar'].every(f => ler('atlas/' + f + '.html').includes('href="../adm/"')));
ok('Coordenação volta ao painel /adm/', ler('inscricoes/coordenador/index.html').includes('href="../../adm/"'));

// ---------- 2. Navegador ----------
const ORIGEM = 'https://idealolimpico.com.br';
const tipos = { html: 'text/html; charset=utf-8', js: 'application/javascript', css: 'text/css', png: 'image/png', json: 'application/json' };
const chamadas = [];
let sessaoValida = true, desempenhoNoAr = true;
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.route(ORIGEM + '/**', route => {
  const u = new URL(route.request().url());
  let f = u.pathname.slice(1);
  if (f === '' || f.endsWith('/')) f += 'index.html';
  const p = RAIZ + f;
  // "Meu desempenho" chega com outro ramo: o teste simula os dois casos (página no ar e ainda não publicada).
  if (f === 'atlas/desempenho-admin.html') return route.fulfill({ status: desempenhoNoAr ? 200 : 404, body: '' });
  if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: 'nao encontrado' });
  if (route.request().method() === 'HEAD') return route.fulfill({ status: 200, body: '' });
  return route.fulfill({ status: 200, contentType: tipos[f.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(p) });
});
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', route => {
  const req = route.request(); const u = new URL(req.url());
  chamadas.push(req.method() + ' ' + u.pathname + ' ' + (req.headers().authorization || ''));
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': ORIGEM, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST' } });
  const cors = { 'access-control-allow-origin': ORIGEM };
  if (u.pathname === '/api/adm/sessao') return sessaoValida && req.headers().authorization === 'Bearer tok-teste'
    ? route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, email: 'adm@grupoideal.com.br' }) })
    : route.fulfill({ status: 401, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: false, error: 'Sessão expirada. Entre novamente.' }) });
  if (u.pathname === '/api/adm/login') return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, token: 'tok-teste', email: 'adm@grupoideal.com.br' }) });
  if (u.pathname === '/api/adm/sair') return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true }) });
  return route.fulfill({ status: 404, contentType: 'application/json', headers: cors, body: '{"ok":false}' });
});
let googleCallback = null;
await ctx.route('https://accounts.google.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' },
  body: 'window.google={accounts:{id:{initialize(o){window.__gsiInit=o},renderButton(el){const b=document.createElement("button");b.id="gsi-falso";b.textContent="Fazer login com o Google";b.addEventListener("click",()=>window.__gsiInit.callback({credential:"cred-teste"}));el.append(b)},disableAutoSelect(){window.__gsiOff=true}}}}' }));
// Ponte do coordenador falsa (etapa 2, lote A): mesmo protocolo da implantação da coordenação (ready → authorize → connected → call/result).
const chamadasPonte = [];
await ctx.route('https://script.google.com/**', route => {
  chamadasPonte.push(route.request().url());
  route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><title>ponte falsa</title><script>
(function(){const parentOrigin='https://idealolimpico.com.br';const nonce='abcdefghijklmnopqrstuvwxyz0123';let authorized=false;
const send=m=>window.top.postMessage(m,parentOrigin);
window.addEventListener('message',e=>{if(e.source!==window.top||e.origin!==parentOrigin||!e.data)return;const d=e.data;
if(d.type==='ideal-coord-authorize'&&d.nonce===nonce){authorized=true;send({type:'ideal-coord-connected',nonce});return;}
if(d.type!=='ideal-coord-call'||!authorized)return;
if(d.method==='coordenadorTestarAviso')send({type:'ideal-coord-result',id:d.id,ok:false,error:'Acesso restrito à conta autorizada do coordenador.'});
else send({type:'ideal-coord-result',id:d.id,ok:true,data:{mensagem:'Feito: '+d.method+' '+JSON.stringify(d.args)}});});
send({type:'ideal-coord-ready',nonce});})();
</script>` });
});
await ctx.addInitScript(() => { window.__cspv = []; document.addEventListener('securitypolicyviolation', e => window.__cspv.push(e.violatedDirective + ' ' + (e.blockedURI || ''))); });
const page = await ctx.newPage();
const erros = []; page.on('pageerror', e => erros.push(e.message));
const violacoes = () => page.evaluate(() => window.__cspv.splice(0));
const visivel = id => page.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);

// 2a. Sem sessão: tela de login com o botão do Google
await page.goto(ORIGEM + '/adm/');
await page.waitForTimeout(500);
ok('Sem sessão: mostra a tela de login e esconde as abas', await visivel('loginSec') && !await visivel('appSec'));
ok('Sem sessão: botão do Google renderizado', await page.locator('#gsi-falso').count() === 1);
ok('Sem sessão: não chamou /api/adm/sessao sem token', !chamadas.some(c => c.includes('/api/adm/sessao')));
ok('Sem erro de JavaScript e sem violação de CSP ao carregar', erros.length === 0 && (await violacoes()).length === 0, erros.join('|'));

// 2b. Login pelo Google → /api/adm/login → abas
await page.click('#gsi-falso');
await page.waitForTimeout(500);
ok('Login: chamou POST /api/adm/login', chamadas.some(c => c.startsWith('POST /api/adm/login')));
ok('Login: abas aparecem e o e-mail fica no topo', await visivel('appSec') && !await visivel('loginSec') && await page.textContent('#admEmail') === 'adm@grupoideal.com.br');
ok('Login: token guardado na chave do ATLAS (sessionStorage)', await page.evaluate(() => sessionStorage.getItem('atlas_adm_token')) === 'tok-teste');
ok('Aba inicial é Inscrições', await visivel('aba-inscricoes') && !await visivel('aba-atlas'));
await page.click('#tab-atlas');
ok('Clicar em ATLAS troca a aba e grava #atlas no endereço', await visivel('aba-atlas') && !await visivel('aba-inscricoes') && page.url().endsWith('#atlas'));
ok('Cartão Meu desempenho continua ativo quando a página existe (HEAD 200)', await page.evaluate(() => !document.getElementById('cardDesempenho').classList.contains('off')));
await page.click('#tab-olimpiadas');
ok('Aba Olimpíadas tem o aviso da etapa 2 e os links externos', await visivel('aba-olimpiadas') && await page.locator('#aba-olimpiadas .card.off').count() === 4 && await page.locator('#aba-olimpiadas a[target=_blank]').count() === 2);

// 2b2. Etapa 2, lote A: cartões que executam as rotinas do menu da planilha pela ponte do coordenador
const acoes = await page.evaluate(() => [...document.querySelectorAll('button.card.acao')].map(b => b.dataset.acao));
ok('Cinco cartões de ação, com os nomes que a ponte da coordenação libera', acoes.join('|') === 'coordenadorDesconectarLembrados|coordenadorAtualizarHistorico|coordenadorTestarAviso|coordenadorAtualizarCatalogo|coordenadorAtualizarConquistas', acoes.join('|'));
ok('A ponte não é carregada ao abrir a página (só no primeiro clique)', chamadasPonte.length === 0);
const msgOlimp = () => page.evaluate(() => { const m = document.querySelector('#aba-olimpiadas .acao-msg'); return m.className + ': ' + m.textContent; });
await page.click('button[data-acao="coordenadorAtualizarCatalogo"]');
await page.waitForTimeout(700);
ok('Catálogo: primeiro clique conecta a ponte (uma carga, com ?bridge=coordenador) e executa', chamadasPonte.length === 1 && /bridge=coordenador/.test(chamadasPonte[0]) && await msgOlimp() === 'acao-msg ok: Feito: coordenadorAtualizarCatalogo []', await msgOlimp());
await page.click('button[data-acao="coordenadorAtualizarConquistas"]');
await page.waitForTimeout(400);
ok('Conquistas: reaproveita a conexão (sem nova carga da ponte)', chamadasPonte.length === 1 && await msgOlimp() === 'acao-msg ok: Feito: coordenadorAtualizarConquistas []', await msgOlimp());
await page.click('#tab-inscricoes');
const msgInsc = () => page.evaluate(() => { const m = document.querySelector('#aba-inscricoes .acao-msg'); return m.className + ': ' + m.textContent; });
await page.click('button[data-acao="coordenadorDesconectarLembrados"]');
await page.waitForTimeout(200);
ok('Desconectar: o primeiro clique só pede confirmação (sem chamada)', /Clique de novo/.test(await page.textContent('button[data-acao="coordenadorDesconectarLembrados"] em')) && /Tem certeza/.test(await msgInsc()));
await page.click('button[data-acao="coordenadorDesconectarLembrados"]');
await page.waitForTimeout(400);
ok('Desconectar: o segundo clique executa', await msgInsc() === 'acao-msg ok: Feito: coordenadorDesconectarLembrados []' && await page.textContent('button[data-acao="coordenadorDesconectarLembrados"] em') === 'Executar', await msgInsc());
await page.click('button[data-acao="coordenadorTestarAviso"]');
await page.waitForTimeout(400);
ok('Erro da planilha aparece em vermelho, sem alert()', /^acao-msg error: Acesso restrito/.test(await msgInsc()), await msgInsc());
ok('Cartões voltam a ficar habilitados e sem erro de JavaScript ou CSP', await page.evaluate(() => [...document.querySelectorAll('button.card.acao')].every(b => !b.disabled)) && erros.length === 0 && (await violacoes()).length === 0, erros.join('|'));

// 2c. Recarregar com token válido entra direto na aba do endereço (o ?r= força a recarga: só mudar o # não recarrega)
await page.goto(ORIGEM + '/adm/?r=1#redacao');
await page.waitForTimeout(500);
ok('Com token: confere /api/adm/sessao e entra direto (o servidor simulado só aceita o Bearer certo)', chamadas.some(c => c.startsWith('GET /api/adm/sessao')) && await visivel('appSec'));
ok('Com token: abre a aba do endereço (#redacao)', await visivel('aba-redacao'));
ok('Links da aba Redação apontam para as páginas admin do ATLAS', await page.evaluate(() => [...document.querySelectorAll('#aba-redacao a.card')].map(a => a.getAttribute('href')).join('|')) === '../atlas/redacao-lotes-admin.html|../atlas/redacao-admin.html#turmas|../atlas/redacao-admin.html#equipe');

// 2d. Sair e sessão vencida
await page.click('#sairBtn');
await page.waitForTimeout(400);
ok('Sair: chama /api/adm/sair, apaga o token e volta ao login', chamadas.some(c => c.startsWith('POST /api/adm/sair')) && await page.evaluate(() => sessionStorage.getItem('atlas_adm_token')) === null && await visivel('loginSec'));
await page.evaluate(() => sessionStorage.setItem('atlas_adm_token', 'tok-vencido'));
await page.goto(ORIGEM + '/adm/');
await page.waitForTimeout(500);
ok('Token vencido: 401 limpa o token e mostra o login com aviso', await visivel('loginSec') && await page.evaluate(() => sessionStorage.getItem('atlas_adm_token')) === null && /Sessão expirada/.test(await page.textContent('#loginStatus')));

// 2e. CSP bloqueia script inline e fetch para outro domínio
await page.route('https://evil.example/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: 'window.__externo=true' }));
const inline = await page.evaluate(() => { window.__inline = false; const s = document.createElement('script'); s.textContent = 'window.__inline=true'; document.body.append(s); return window.__inline; });
const conexao = await page.evaluate(() => fetch('https://evil.example/dados').then(() => 'passou', () => 'bloqueado'));
await page.waitForTimeout(200);
const v = await violacoes();
ok('CSP: script inline é bloqueado', inline === false && v.some(x => x.startsWith('script-src')), v.join('|'));
ok('CSP: fetch para outro domínio é bloqueado', conexao === 'bloqueado' && v.some(x => x.startsWith('connect-src')), v.join('|'));
ok('Sem erros de JavaScript no fim', erros.length === 0, erros.join('|'));

// 2f. Celular: nada estoura a largura. Página do Meu desempenho ainda não publicada: cartão vira "Em breve".
desempenhoNoAr = false;
await page.setViewportSize({ width: 375, height: 740 });
await page.evaluate(() => sessionStorage.setItem('atlas_adm_token', 'tok-teste'));
await page.goto(ORIGEM + '/adm/?r=2#atlas');
await page.waitForTimeout(500);
ok('Celular: sem rolagem horizontal', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
ok('Meu desempenho sem página no site: cartão desativado com "Em breve"', await page.evaluate(() => { const c = document.getElementById('cardDesempenho'); return c.classList.contains('off') && !c.hasAttribute('href') && c.querySelector('em').textContent === 'Em breve'; }));
await browser.close();

for (const [estado, nome, extra] of results) console.log(estado.padEnd(7), nome, extra ? '— ' + extra : '');
const falhas = results.filter(x => x[0] === 'FALHOU').length;
console.log(falhas ? `FALHOU: ${falhas} falha(s) em ${results.length}` : `TODOS: ${results.length} verificações passaram`);
if (falhas) process.exitCode = 1;
