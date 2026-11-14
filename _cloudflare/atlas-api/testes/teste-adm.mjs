// Teste completo do login do administrador e das rotas de professores.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const S = (process.env.ATLAS_TESTE_TMP || '/tmp/atlas-testes') + '/';   // dependências (katex, exceljs) e prints
const REPO = new URL('../../../', import.meta.url).pathname;   // raiz do repositório
const worker = (await import(REPO + '_cloudflare/atlas-api/worker.js?' + Date.now())).default;
const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'OK  ' : 'FALHOU', name, String(extra).slice(0, 160)]);

// ---- D1 falso (SQLite real) ----
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(REPO + '_cloudflare/atlas-api/schema.sql', 'utf8'));
function stmt(sql, args = []) {
  return {
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) })
  };
}
const DB = { prepare: sql => stmt(sql), batch: async list => { db.exec('BEGIN'); try { for (const s of list) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } };
const CLIENT = '432003570373-cscu1nvoldack2luihm9lnlsi9q2p115.apps.googleusercontent.com';
const env = { ATLAS_HOJE_TESTE: '2026-11-13' /* data fixa (dia de aula): não depende do relógio real */, DB, GOOGLE_CLIENT_ID: CLIENT, ADMIN_EMAIL: 'marinhomalcher@gmail.com' };
const r2store=new Map();env.IMAGENS={put:async(k,b,o={})=>{const bytes=typeof b==='string'?new TextEncoder().encode(b):new Uint8Array(b);r2store.set(k,{bytes,o,up:new Date()})},get:async k=>{const v=r2store.get(k);return v?{body:v.bytes,httpMetadata:v.o.httpMetadata}:null},delete:async k=>{r2store.delete(k)},list:async({prefix=''}={})=>({objects:[...r2store].filter(([k])=>k.startsWith(prefix)).map(([key,v])=>({key,size:v.bytes.length,uploaded:v.up})),truncated:false})};

// professores de exemplo
db.exec(`INSERT INTO usuarios (nome,email,disciplina,papel) VALUES
 ('Edi Franco','edi.franco@grupoideal.com.br','Literatura','professor'),
 ('Márcio Alex','marcio.alex@grupoideal.com.br','Literatura','professor'),
 ('Felipe Augusto','felipe.costa@pleno.grupoideal.com.br','Química','professor'),
 ('Andrey Uchôa','andrey.uchoa@grupoideal.com.br','Matemática','professor');`);

// ---- Google falso: chave RSA de teste + JWKS ----
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const otherKp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
const realFetch = globalThis.fetch;
let certFetches = 0;
globalThis.fetch = async (url, opts) => {
  if (String(url) === 'https://www.googleapis.com/oauth2/v3/certs') {
    certFetches++;
    return new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'teste1', alg: 'RS256', use: 'sig' }] }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
  }
  return realFetch(url, opts);
};
const b64u = b => Buffer.from(b).toString('base64url');
async function jwt(claims, { key = kp.privateKey, kid = 'teste1', alg = 'RS256' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: 'https://accounts.google.com', aud: CLIENT, sub: '123', email: 'marinhomalcher@gmail.com', email_verified: true, name: 'Marinho', iat: now, exp: now + 3600, ...claims };
  const head = b64u(JSON.stringify({ alg, kid, typ: 'JWT' })) + '.' + b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head));
  return head + '.' + b64u(new Uint8Array(sig));
}

const ORIGIN = 'https://idealolimpico.com.br';
async function call(path, { method = 'GET', body, token, origin = ORIGIN, ctype = 'application/json' } = {}) {
  /*__tagsAuto*/ if (body&&body.dados&&typeof body.dados==='object'&&body.dados.tags===undefined&&/^\/api\/itens(\/[A-Z]\d{7})?$/.test(path)) body={...body,dados:{...body.dados,tags:['teste','automatico']}};
  if (body&&Array.isArray(body.itens)&&path==='/api/itens/grupo') body={...body,itens:body.itens.map(d=>d&&d.tags===undefined?{...d,tags:['teste','grupo']}:d)};
  if (path==='/api/itens'&&method==='POST'&&body&&body.confirmar_repetida===undefined) body={...body,confirmar_repetida:true};
  const headers = { Origin: origin };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = ctype;
  const res = await worker.fetch(new Request('https://atlas-api.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
}

// ---- testes do servidor ----
let r = await call('/api/saude');
ok('Saúde: banco conectado, schema 8', r.status === 200 && r.data.schema === "8", JSON.stringify(r.data));
r = await call('/api/adm/professores');
ok('Sem login: lista de professores recusada (401)', r.status === 401, r.data?.error);
r = await call('/api/adm/login', { method: 'POST', body: { credential: await jwt({ email: 'outra.pessoa@gmail.com' }) } });
ok('Outra conta Google recusada (403)', r.status === 403, r.data?.error);
r = await call('/api/adm/login', { method: 'POST', body: { credential: await jwt({}, { key: otherKp.privateKey }) } });
ok('Assinatura falsa recusada (401)', r.status === 401, r.data?.error);
r = await call('/api/adm/login', { method: 'POST', body: { credential: await jwt({ aud: 'outro-app.apps.googleusercontent.com' }) } });
ok('Login de outro aplicativo recusado (401)', r.status === 401, r.data?.error);
r = await call('/api/adm/login', { method: 'POST', body: { credential: await jwt({ exp: Math.floor(Date.now() / 1000) - 3600 }) } });
ok('Login expirado recusado (401)', r.status === 401, r.data?.error);
r = await call('/api/adm/login', { method: 'POST', body: { credential: await jwt({ email_verified: false }) } });
ok('E-mail não confirmado recusado (403)', r.status === 403, r.data?.error);
r = await call('/api/adm/login', { method: 'POST', body: { credential: await jwt({}, { alg: 'none' }) } });
ok('Algoritmo "none" recusado (401)', r.status === 401, r.data?.error);
r = await call('/api/adm/login', { method: 'POST', body: { credential: 'abc' } });
ok('Token malformado recusado (401)', r.status === 401, r.data?.error);
r = await call('/api/adm/login', { method: 'POST', body: { credential: await jwt({}) }, origin: 'https://site-malicioso.com' });
ok('Origem estranha recusada (403)', r.status === 403, r.data?.error);
r = await call('/api/adm/login', { method: 'POST', body: { credential: await jwt({ email: 'MarinhoMalcher@Gmail.com' }) } });
ok('Admin entra (maiúsculas ignoradas)', r.status === 200 && r.data.token?.length > 30, r.data?.email);
const token = r.data.token;
const stored = db.prepare('SELECT token_hash FROM sessoes').all();
ok('Banco guarda só o hash do token', stored.length === 1 && stored[0].token_hash !== token && stored[0].token_hash.length === 64);
r = await call('/api/adm/sessao', { token });
ok('Sessão válida', r.status === 200 && r.data.email === 'marinhomalcher@gmail.com');
r = await call('/api/adm/sessao', { token: token + 'x' });
ok('Token adulterado recusado', r.status === 401);
r = await call('/api/adm/professores', { token });
ok('Lista professores (ordem alfabética)', r.status === 200 && r.data.professores.map(p => p.nome).join('|') === 'Andrey Uchôa|Edi Franco|Felipe Augusto|Márcio Alex', r.data.professores?.map(p => p.nome).join('|'));
r = await call('/api/adm/professores', { method: 'POST', token, body: { nome: 'Telma Paes', email: 'telma.paes', disciplina: 'Literatura' } });
const telmaId = r.data?.id;
ok('Cadastra professor (completa @grupoideal.com.br)', r.status === 200 && r.data.professores.some(p => p.email === 'telma.paes@grupoideal.com.br'), r.data?.error);
r = await call('/api/adm/professores', { method: 'POST', token, body: { nome: 'Fulano', email: 'fulano@gmail.com', disciplina: 'Artes' } });
ok('E-mail fora da escola recusado', r.status === 400, r.data?.error);
r = await call('/api/adm/professores', { method: 'POST', token, body: { nome: 'Edi 2', email: 'EDI.FRANCO@grupoideal.com.br', disciplina: 'Artes' } });
ok('E-mail repetido recusado', r.status === 409, r.data?.error);
r = await call('/api/adm/professores', { method: 'POST', token, body: { nome: 'Xavier Teste', email: 'x.y@grupoideal.com.br', disciplina: 'Astrologia' } });
ok('Disciplina inválida recusada', r.status === 400 && r.data.error.includes('disciplina'), r.data?.error);
r = await call('/api/adm/professores', { method: 'POST', token, body: { nome: 'Novo Pleno', email: 'novo@pleno.grupoideal.com.br', disciplina: 'Química' } });
ok('Recusa subdomínio pleno (sem exceções)', r.status === 400, r.data?.error);
r = await call('/api/adm/supervisor', { method: 'POST', token, body: { disciplina: 'Literatura', usuario_id: telmaId } });
ok('Define supervisor de Literatura', r.status === 200 && r.data.professores.find(p => p.id === telmaId).papel === 'supervisor', r.data?.error);
const edi = r.data.professores.find(p => p.nome === 'Edi Franco');
r = await call('/api/adm/supervisor', { method: 'POST', token, body: { disciplina: 'Literatura', usuario_id: edi.id } });
ok('Troca supervisor: só um por disciplina', r.status === 200 && r.data.professores.filter(p => p.papel === 'supervisor').length === 1 && r.data.professores.find(p => p.id === edi.id).papel === 'supervisor');
const andrey = r.data.professores.find(p => p.nome === 'Andrey Uchôa');
r = await call('/api/adm/supervisor', { method: 'POST', token, body: { disciplina: 'Literatura', usuario_id: andrey.id } });
ok('Supervisor de outra disciplina recusado', r.status === 400, r.data?.error);
r = await call('/api/adm/professores/' + edi.id, { method: 'PUT', token, body: { ativo: false } });
ok('Desativar supervisor tira o papel', r.status === 200 && r.data.professores.find(p => p.id === edi.id).papel === 'professor' && !r.data.professores.find(p => p.id === edi.id).ativo);
r = await call('/api/adm/supervisor', { method: 'POST', token, body: { disciplina: 'Literatura', usuario_id: edi.id } });
ok('Inativo não pode ser supervisor', r.status === 400, r.data?.error);
r = await call('/api/adm/professores/' + edi.id, { method: 'PUT', token, body: { ativo: true, disciplina: 'Artes', nome: 'Edi  Franco ' } });
ok('Edita disciplina e nome (espaços limpos)', r.status === 200 && r.data.professores.find(p => p.id === edi.id).disciplina === 'Artes' && r.data.professores.find(p => p.id === edi.id).nome === 'Edi Franco');
r = await call('/api/adm/professores/' + edi.id, { method: 'PUT', token, body: { email: 'telma.paes@grupoideal.com.br' } });
ok('Editar para e-mail de outro recusado', r.status === 409, r.data?.error);
r = await call('/api/adm/professores/99999', { method: 'PUT', token, body: { ativo: true } });
ok('Professor inexistente → 404', r.status === 404);
r = await call('/api/adm/professores', { method: 'POST', token, body: { nome: 'A', email: 'a@grupoideal.com.br', disciplina: 'Artes' }, ctype: 'text/plain' });
ok('Formato errado recusado (415)', r.status === 415);
const evs = db.prepare('SELECT acao FROM eventos').all().map(e => e.acao);
ok('Registro de atividades gravado', evs.includes('adm_login') && evs.includes('adm_login_recusado') && evs.includes('supervisor_definido'), evs.join(','));
ok('Chaves do Google buscadas uma vez (cache)', certFetches === 1, certFetches);
r = await call('/api/adm/sair', { method: 'POST', token, body: {} });
r = await call('/api/adm/sessao', { token });
ok('Depois de sair, token não vale mais', r.status === 401);
r = await call('/api/itens');
ok('Questões exigem login de professor', r.status === 401);

// ---- teste da tela (navegador) ----
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const request = new Request('https://atlas-api.test' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks) });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
}).listen(8787);
const goodCred = await jwt({});
const badCred = await jwt({ email: 'intruso@gmail.com' });
const gisMock = `window.google={accounts:{id:{initialize(o){window.__cb=o.callback},renderButton(el){const b=document.createElement('button');b.id='gbtn';b.textContent='Entrar com Google';b.onclick=()=>window.__cb({credential:window.__useBad?${JSON.stringify(badCred)}:${JSON.stringify(goodCred)}});el.appendChild(b)},disableAutoSelect(){}}}};`;
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.route('https://idealolimpico.com.br/atlas/**', route => {
  const f = new URL(route.request().url()).pathname.replace('/atlas/', '') || 'index.html';
  const p = REPO + 'atlas/' + f;
  if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: 'nf' });
  route.fulfill({ status: 200, contentType: f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : 'application/octet-stream', body: fs.readFileSync(p) });
});
await ctx.route('https://accounts.google.com/gsi/client', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: gisMock }));
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route => {
  const u = route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev', 'http://localhost:8787');
  const resp = await route.fetch({ url: u, headers: { ...route.request().headers(), origin: ORIGIN } });
  route.fulfill({ response: resp });
});
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('https://idealolimpico.com.br/atlas/admin.html');
await page.waitForSelector('#gbtn');
ok('Tela: sem login mostra só o botão do Google', await page.isVisible('#login-view') && !(await page.isVisible('#app-view')));
await page.evaluate(() => { window.__useBad = true; }); await page.click('#gbtn');
await page.waitForFunction(() => document.querySelector('#login-status').textContent.includes('não tem acesso'));
ok('Tela: conta errada mostra recusa e não entra', !(await page.isVisible('#app-view')), await page.textContent('#login-status'));
await page.evaluate(() => { window.__useBad = false; }); await page.click('#gbtn');
await page.waitForSelector('#app-view:not([hidden])');
await page.waitForFunction(() => document.querySelectorAll('#list tbody tr').length > 0);
ok('Tela: admin entra e vê professores do banco', (await page.$$eval('#list tbody tr', r => r.length)) === 5, await page.textContent('#user-email'));
ok('Tela: 12 seletores de supervisor', (await page.$$eval('.sup-select', s => s.length)) === 12);
// cadastrar novo pelo seletor de supervisor
await page.selectOption('#sup-Física', 'novo');
await page.waitForSelector('#dialog[open]');
ok('Tela: "+ Cadastrar novo" abre formulário com disciplina travada', (await page.inputValue('#subject')) === 'Física' && await page.isDisabled('#subject'));
await page.fill('#name', 'Jorge Daniel'); await page.fill('#email', 'jorge.daniel'); await page.click('#save');
await page.waitForFunction(() => document.querySelector('#app-status').textContent.includes('supervisor de Física'));
ok('Tela: novo professor já vira supervisor de Física', (await page.$eval('#sup-Física', s => s.options[s.selectedIndex].text)) === 'Jorge Daniel');
ok('Tela: selo "Supervisor" na tabela', (await page.textContent('#list')).includes('Jorge DanielSupervisor'));
// recarregar mantém sessão
await page.reload(); await page.waitForSelector('#app-view:not([hidden])');
ok('Tela: recarregar mantém o login', await page.isVisible('#app-view'));
// sair
await page.click('#logout'); await page.waitForSelector('#login-view:not([hidden])');
ok('Tela: Sair volta para o login', !(await page.isVisible('#app-view')));
const realErrors = errors.filter(e => !e.includes('status of 403'));
ok('Tela: sem erros no console (fora a recusa proposital)', realErrors.length === 0, realErrors.join(' | '));
await page.screenshot({ path: S + 'shot-admin-login.png' });
await browser.close(); server.close();

for (const r2 of results) console.log(r2.join(' | '));
const bad = results.filter(x => x[0] !== 'OK  ').length;
console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`);
process.exit(0);
