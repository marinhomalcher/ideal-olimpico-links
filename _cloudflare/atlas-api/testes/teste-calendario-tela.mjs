// Tela do ADM "Calendário de dias não úteis": grade do mês, lista com interruptores, formulário, apagar em dois cliques,
// carregar o ano seguinte. O servidor é simulado na própria página (o servidor de verdade é testado em teste-calendario.mjs).
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const dias = await import(pathToFileURL(REPO + '_cloudflare/atlas-api/diasuteis.js').href);
const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'OK  ' : 'FALHOU', name, String(extra).slice(0, 160)]);
const SEM = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

const tipos = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const f = path.join(REPO, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': tipos[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const banco = new Map();
for (const ano of [2026, 2027]) for (const d of dias.calendarioPadrao(ano)) banco.set(d.data, { ...d });
const pub = r => { const dow = new Date(r.data + 'T00:00:00Z').getUTCDay(); return { data: r.data, motivo: r.motivo, ativo: r.ativo === 1 || r.ativo === true, dia_semana: SEM[dow], fim_de_semana: dow === 0 || dow === 6 }; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const erros = [], caixas = [];
page.on('pageerror', e => erros.push(e.message));
page.on('dialog', d => { caixas.push(d.message()); d.dismiss(); });
await page.addInitScript(() => { try { sessionStorage.setItem('atlas_adm_token', 'x'); } catch {} });
await page.route('https://atlas-api.marinhomalcher.workers.dev/**', async route => {
  const u = new URL(route.request().url()), m = route.request().method();
  const j = o => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (u.pathname === '/api/adm/sessao') return j({ ok: true, email: 'adm@teste' });
  if (u.pathname === '/api/adm/calendario' && m === 'GET') { const a = u.searchParams.get('ano'); return j({ ok: true, ano: Number(a), dias: [...banco.values()].filter(d => d.data.startsWith(a)).sort((x, y) => x.data.localeCompare(y.data)).map(pub) }); }
  if (u.pathname === '/api/adm/calendario' && m === 'POST') { const b = JSON.parse(route.request().postData()); banco.set(b.data, { data: b.data, motivo: b.motivo, ativo: b.ativo ? 1 : 0 }); return j({ ok: true }); }
  const mm = u.pathname.match(/^\/api\/adm\/calendario\/(\d{4}-\d{2}-\d{2})$/);
  if (mm && m === 'PUT') { const b = JSON.parse(route.request().postData()); banco.get(mm[1]).ativo = b.ativo ? 1 : 0; return j({ ok: true }); }
  if (mm && m === 'DELETE') { banco.delete(mm[1]); return j({ ok: true }); }
  if (u.pathname === '/api/adm/calendario/carregar') { const b = JSON.parse(route.request().postData()); let n = 0; for (const d of dias.calendarioPadrao(b.ano)) if (!banco.has(d.data)) { banco.set(d.data, { ...d }); n++; } return j({ ok: true, ano: b.ano, novos: n }); }
  return route.fulfill({ status: 404, body: '{}' });
});

await page.goto(base + '/atlas/admin-calendario.html', { waitUntil: 'load' });
await page.waitForSelector('#mes-grade button.dia');
// vai para outubro de 2026
for (let i = 0; i < 24; i++) { const t = await page.textContent('#mes-titulo'); if (t === 'Outubro de 2026') break; await page.click(['Novembro', 'Dezembro'].includes(t.split(' ')[0]) && t.endsWith('2026') ? '#mes-ant' : '#mes-prox'); await page.waitForTimeout(120); }
const cls = d => page.evaluate(x => document.querySelector('#mes-grade button[data-data="' + x + '"]').className, d);
ok('Mostra outubro de 2026 com 31 dias e a semana começando na segunda', (await page.textContent('#mes-titulo')) === 'Outubro de 2026' && (await page.locator('#mes-grade button.dia').count()) === 31 && (await page.locator('#mes-grade .sem').first().textContent()) === 'seg');
ok('Dias não úteis em vinho (12/10 e 26/10), ponto facultativo em amarelo (28/10), sábado em cinza (03/10)', /nu/.test(await cls('2026-10-12')) && /nu/.test(await cls('2026-10-26')) && /fac/.test(await cls('2026-10-28')) && /fds/.test(await cls('2026-10-03')), await cls('2026-10-28'));
ok('A lista mostra o ano e o botão de carregar o seguinte', /2026/.test(await page.textContent('#lista-titulo')) && (await page.textContent('#btn-carregar')) === 'Carregar 2027');
await page.locator('#lista tr', { hasText: 'Servidor' }).locator('.sw input').click(); await page.waitForTimeout(250);
ok('O interruptor liga o 28/10 (vira vinho na grade) e o servidor foi avisado', /nu/.test(await cls('2026-10-28')) && banco.get('2026-10-28').ativo === 1);
await page.click('#mes-grade button[data-data="2026-10-30"]');
ok('Clicar num dia sem registro abre o formulário com a data preenchida', await page.isVisible('#form-dia') && (await page.inputValue('#f-data')) === '2026-10-30');
await page.click('#f-salvar'); await page.waitForTimeout(150);
ok('Sem motivo, não salva (o campo é obrigatório)', !banco.has('2026-10-30') && await page.evaluate(() => document.querySelector('#f-motivo').validity.valueMissing));
await page.fill('#f-motivo', 'Recesso da escola'); await page.click('#f-salvar'); await page.waitForTimeout(350);
ok('Com motivo, o dia é criado e fica em vinho', banco.get('2026-10-30')?.motivo === 'Recesso da escola' && /nu/.test(await cls('2026-10-30')));
await page.click('#mes-grade button[data-data="2026-10-30"]');
await page.click('#f-apagar');
ok('Apagar pede um segundo clique (sem caixa do navegador)', banco.has('2026-10-30') && /de novo/.test(await page.textContent('#f-apagar')) && caixas.length === 0);
await page.click('#f-apagar'); await page.waitForTimeout(350);
ok('No segundo clique o dia é apagado', !banco.has('2026-10-30') && !/nu|fac/.test(await cls('2026-10-30')));
await page.click('#btn-carregar'); await page.waitForTimeout(450);
ok('"Carregar 2027" cria os dias e mostra janeiro de 2027', (await page.textContent('#mes-titulo')) === 'Janeiro de 2027' && /2027/.test(await page.textContent('#lista-titulo')));
await page.setViewportSize({ width: 390, height: 844 });
ok('No celular a página cabe na largura', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), await page.evaluate(() => document.documentElement.scrollWidth + ' x ' + innerWidth));
await browser.close(); server.close();
ok('Tela: sem erros de JavaScript nem caixas do navegador', erros.length === 0 && caixas.length === 0, erros.join(' ; ') + caixas.join(';'));
for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK  ').length; console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
