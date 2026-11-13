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
const env = { DB, GOOGLE_CLIENT_ID: CLIENT, ADMIN_EMAIL: 'marinhomalcher@gmail.com', ATLAS_MAILER_URL: 'https://mailer.test/exec', ATLAS_MAILER_SECRET: 'segredo-de-teste' };
const mails=[];
const r2store=new Map();env.IMAGENS={put:async(k,b,o={})=>{const bytes=typeof b==='string'?new TextEncoder().encode(b):new Uint8Array(b);r2store.set(k,{bytes,o,up:new Date()})},get:async k=>{const v=r2store.get(k);return v?{body:v.bytes,httpMetadata:v.o.httpMetadata}:null},delete:async k=>{r2store.delete(k)},list:async({prefix=''}={})=>({objects:[...r2store].filter(([k])=>k.startsWith(prefix)).map(([key,v])=>({key,size:v.bytes.length,uploaded:v.up})),truncated:false})};

// professores de exemplo
db.exec(`INSERT INTO usuarios (nome,email,disciplina,papel) VALUES
 ('Edi Franco','edi.franco@grupoideal.com.br','Literatura','professor'),
 ('Márcio Alex','marcio.alex@grupoideal.com.br','Literatura','professor'),
 ('Felipe Augusto','felipe.costa@pleno.grupoideal.com.br','Química','professor'),
 ('Andrey Uchôa','andrey.uchoa@grupoideal.com.br','Matemática','professor'),
 ('Telma Paes','telma.paes@grupoideal.com.br','Literatura','professor');`);

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
  if (String(url) === 'https://mailer.test/exec') { mails.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json'}}); }
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


db.exec("UPDATE usuarios SET papel='supervisor' WHERE nome='Márcio Alex'");
const lastCode=()=>mails.at(-1)?.codigo;
let r = await call('/api/saude');
ok('Schema 3 no schema.sql completo', r.data.schema === "8", r.data.schema);
// admin: só @grupoideal.com.br
r = await call('/api/adm/login', { method: 'POST', body: { credential: await jwt({}) } }); const token=r.data.token;
r = await call('/api/adm/professores', { method: 'POST', token, body: { nome: 'Novo Pleno', email: 'novo@pleno.grupoideal.com.br', disciplina: 'Química' } });
ok('ADM: subdomínio (pleno) recusado', r.status === 400, r.data?.error);
r = await call('/api/adm/professores', { method: 'POST', token, body: { nome: 'Nova Prof', email: 'nova.prof', disciplina: 'Artes' } });
ok('ADM: @grupoideal.com.br aceito', r.status === 200, r.data?.error);
// login por código
r = await call('/api/login/codigo', { method: 'POST', body: { email: 'felipe.costa@pleno.grupoideal.com.br' } });
ok('Login: e-mail pleno recusado', r.status === 400 && mails.length === 0, r.data?.error);
r = await call('/api/login/codigo', { method: 'POST', body: { email: 'ninguem@grupoideal.com.br' } });
ok('Login: e-mail não cadastrado responde igual e não envia', r.status === 200 && mails.length === 0);
r = await call('/api/login/codigo', { method: 'POST', body: { email: 'edi.franco@grupoideal.com.br' } });
ok('Login: professor recebe código', r.status === 200 && /^\d{6}$/.test(lastCode()||''), mails.length);
const codEdi=lastCode();
r = await call('/api/login/verificar', { method: 'POST', body: { email: 'edi.franco@grupoideal.com.br', codigo: codEdi, perfil: 'supervisor' } });
ok('Professor que escolheu Supervisor: entra, servidor diz papel=professor', r.status === 200 && r.data.usuario.papel === 'professor', r.data?.error);
r = await call('/api/login/verificar', { method: 'POST', body: { email: 'edi.franco@grupoideal.com.br', codigo: codEdi } });
ok('Código não pode ser usado duas vezes', r.status === 401);
r = await call('/api/login/verificar', { method: 'POST', body: { email: 'marcio.alex@grupoideal.com.br', codigo: '123456', perfil: 'supervisor' } });
ok('Sem código válido não revela se é supervisor', r.status === 401 && !/Supervisor/.test(r.data.error), r.data.error);
r = await call('/api/login/codigo', { method: 'POST', body: { email: 'marcio.alex@grupoideal.com.br' } });
r = await call('/api/login/verificar', { method: 'POST', body: { email: 'marcio.alex@grupoideal.com.br', codigo: lastCode() } });
ok('Supervisor entra com papel=supervisor', r.status === 200 && r.data.usuario.papel === 'supervisor');
const supToken=r.data.token;
// navegador: redirecionamentos
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const request = new Request('https://atlas-api.test' + req.url, { method: req.method, headers: req.headers, body: ['GET','HEAD','OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks) });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
}).listen(8788);
const browser = await chromium.launch(); const ctx = await browser.newContext();
await ctx.route('https://idealolimpico.com.br/atlas/**', route => { const f = new URL(route.request().url()).pathname.replace('/atlas/','')||'index.html'; const p = REPO+'atlas/'+f; if(!fs.existsSync(p)) return route.fulfill({status:404,body:'nf'}); route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'image/png',body:fs.readFileSync(p)}); });
await ctx.route('https://cdn.jsdelivr.net/**', r2 => r2.fulfill({status:200,contentType:'text/plain',body:''}));
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route => { const u = route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev','http://localhost:8788'); const resp = await route.fetch({ url: u, headers: { ...route.request().headers(), origin: ORIGIN } }); route.fulfill({ response: resp }); });
const page = await ctx.newPage();
async function loginVia(card, user){ await page.goto('https://idealolimpico.com.br/atlas/'); await page.click(`[data-role="${card}"]`); await page.fill('#email', user); await page.click('#loginButton'); await page.waitForSelector('#code-step:not([hidden])'); await page.fill('#code', lastCode()); await page.click('#verifyButton'); }
await loginVia('Supervisor','telma.paes');
await page.waitForURL(/professor\.html/, {timeout:6000}).catch(()=>{});
ok('Tela: professor no card Supervisor vai para a área do Professor', page.url().endsWith('professor.html'), page.url());
await page.goto('https://idealolimpico.com.br/atlas/supervisor.html');
await page.waitForURL(/professor\.html/, {timeout:6000}).catch(()=>{});
ok('Tela: professor que digita supervisor.html é levado à sua área', page.url().endsWith('professor.html'), page.url());
await page.waitForFunction(()=>document.querySelector('#professor-nome')?.textContent==='Telma Paes',null,{timeout:6000}).catch(()=>{});
ok('Tela: continua logado e vê o próprio nome', (await page.textContent('#professor-nome'))==='Telma Paes');
await page.evaluate(()=>{sessionStorage.clear();localStorage.clear()});
db.exec('DELETE FROM login_rate_limits');
await loginVia('Supervisor','marcio.alex');
await page.waitForURL(/supervisor\.html/, {timeout:6000}).catch(()=>{});
ok('Tela: supervisor entra na área do Supervisor', page.url().endsWith('supervisor.html'), page.url());
db.exec('DELETE FROM login_rate_limits');await page.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('atlas_user_auth')});await page.goto('https://idealolimpico.com.br/atlas/');await page.click('[data-role="Professor"]');
await page.type('#email','edi.franco@');
ok('Tela: o @ não entra no campo', (await page.inputValue('#email'))==='edi.franco' && (await page.textContent('#login-status')).includes('já está preenchido'), await page.inputValue('#email'));
await page.fill('#email','');await page.type('#email','edigmail.com');await page.click('#loginButton');
ok('Tela: e-mail de outro provedor recusado', (await page.textContent('#login-status')).includes('institucional') && await page.isHidden('#code-step'));
await page.fill('#email','Edi.Franco@grupoideal.com.br');
ok('Tela: e-mail colado inteiro fica só com a parte antes do @', (await page.inputValue('#email'))==='edi.franco', await page.inputValue('#email'));
await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])',{timeout:5000}).catch(async()=>console.log('STATUS:',await page.textContent('#login-status'),await page.inputValue('#email')));
const st=await page.textContent('#sent-to');
ok('Tela: mensagem diz que o código foi enviado ao e-mail institucional', st.includes('Enviamos um código') && st.includes('edi.franco@grupoideal.com.br') && !st.includes('Se o e-mail estiver cadastrado'), st);

// sessão de 7 dias: voltar à página inicial não pede código de novo
db.exec('DELETE FROM login_rate_limits');await page.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('atlas_user_auth')});await page.goto('https://idealolimpico.com.br/atlas/');
await page.click('[data-role="Supervisor"]');await page.fill('#email','marcio.alex');await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');
await page.fill('#code',mails.at(-1).codigo);await page.check('#remember');await page.click('#verifyButton');await page.waitForURL(/supervisor\.html/);
const nMails=mails.length;await page.goto('https://idealolimpico.com.br/atlas/');await page.waitForSelector('.sessao-ativa');
ok('Tela: página inicial mostra que está conectado', (await page.textContent('.sessao-ativa')).includes('Márcio Alex'));
await page.click('[data-role="Supervisor"]');await page.waitForURL(/supervisor\.html/);
ok('Tela: com sessão de 7 dias, entra direto sem pedir código', mails.length===nMails && !(await page.isVisible('#overlay.open')));
await page.goto('https://idealolimpico.com.br/atlas/');await page.click('[data-role="Professor"]');await page.waitForURL(/professor\.html/);
ok('Tela: supervisor que clica em Professor vai para a área do Professor', page.url().endsWith('professor.html'));
await page.goto('https://idealolimpico.com.br/atlas/');await page.waitForSelector('.sessao-ativa');await page.click('.sessao-ativa button');await page.waitForTimeout(300);
await page.click('[data-role="Supervisor"]');await page.waitForTimeout(400);
ok('Tela: depois de Sair, volta a pedir o código', await page.isVisible('#email'));
await browser.close(); server.close();
for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK  ').length;
console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`);
process.exit(0);
