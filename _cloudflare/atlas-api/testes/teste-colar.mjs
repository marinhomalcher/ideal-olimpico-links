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
const env = { ATLAS_HOJE_TESTE: '2026-11-13' /* data fixa (dia de aula): não depende do relógio real */, DB, GOOGLE_CLIENT_ID: CLIENT, ADMIN_EMAIL: 'marinhomalcher@gmail.com', ATLAS_MAILER_URL: 'https://mailer.test/exec', ATLAS_MAILER_SECRET: 'segredo-de-teste' };
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
db.exec("INSERT INTO usuarios (nome,email,disciplina,papel) VALUES ('Sup Química','sup.quimica@grupoideal.com.br','Química','supervisor')");
const lastCode=()=>mails.at(-1)?.codigo;
async function entrar(email){ db.exec('DELETE FROM login_rate_limits'); await call('/api/login/codigo',{method:'POST',body:{email}}); const r=await call('/api/login/verificar',{method:'POST',body:{email,codigo:lastCode()}}); return r.data.token; }

const server = http.createServer(async (req, res) => { const chunks=[]; for await (const c of req) chunks.push(c); const request=new Request('https://atlas-api.test'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD','OPTIONS'].includes(req.method)?undefined:Buffer.concat(chunks)}); const response=await worker.fetch(request,env); res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(8790);
const K=S+'katexpkg/package/dist/';
const browser=await chromium.launch(); const ctx=await browser.newContext({deviceScaleFactor:1.5,viewport:{width:1280,height:900}});
await ctx.route('https://idealolimpico.com.br/atlas/**', route=>{const f=new URL(route.request().url()).pathname.replace('/atlas/','')||'index.html';const p=REPO+'atlas/'+f;if(!fs.existsSync(p))return route.fulfill({status:404,body:'nf'});route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'image/png',body:fs.readFileSync(p)})});
await ctx.route('https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/**', r2=>{const p=new URL(r2.request().url()).pathname.replace('/npm/katex@0.19.1/dist/','');r2.fulfill({status:200,headers:{'content-type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'font/'+p.split('.').pop(),'access-control-allow-origin':'*'},body:fs.readFileSync(K+p)})});
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route=>{const u=route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev','http://localhost:8790');const resp=await route.fetch({url:u,headers:{...route.request().headers(),origin:ORIGIN}});route.fulfill({response:resp})});
const page=await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.dismiss()});
const paste=(sel,text)=>page.evaluate(([sel,text])=>{const el=document.querySelector(sel);el.focus();const dt=new DataTransfer();dt.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},[sel,text]);
async function pasteImage(sel,w,h){await page.evaluate(async([sel,w,h])=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,w,h);g.strokeStyle='#000';g.lineWidth=6;g.strokeRect(10,10,w-20,h-20);g.font='60px Arial';g.fillStyle='#000';g.fillText('Tabela de teste',40,h/2);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const file=new File([blob],'print.png',{type:'image/png'});const el=document.querySelector(sel);el.focus();const dt=new DataTransfer();dt.items.add(file);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},[sel,w,h]);await page.waitForSelector(sel+' img');}
async function login(card,user){db.exec('DELETE FROM login_rate_limits');await page.goto('https://idealolimpico.com.br/atlas/');await page.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('atlas_user_auth')});await page.goto('https://idealolimpico.com.br/atlas/');await page.click(`[data-role="${card}"]`);await page.fill('#email',user);await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');await page.fill('#code',lastCode());await page.click('#verifyButton');}
const ratio=sel=>page.$eval(sel,i=>{const r=i.getBoundingClientRect();return {w:r.width,h:r.height,ar:r.height/r.width,nat:i.naturalHeight/i.naturalWidth,style:i.style.width,area:i.closest('.rich-editor,.stem,.choice,.question')?.clientWidth}});
await login('Professor','telma.paes');await page.waitForURL(/professor\.html/);await page.waitForFunction(()=>!document.querySelector('#questao-form').hidden);
// cola como o Word: texto + html + uma "foto" PNG do trecho
async function colarMisto(sel,{texto,html,png=true}){await page.evaluate(async([sel,texto,html,png])=>{const el=document.querySelector(sel);el.focus();const dt=new DataTransfer();
  if(texto!==null)dt.setData('text/plain',texto);if(html)dt.setData('text/html',html);
  if(png){const c=document.createElement('canvas');c.width=200;c.height=60;c.getContext('2d').fillRect(0,0,200,60);const b=await new Promise(r=>c.toBlob(r,'image/png'));dt.items.add(new File([b],'image.png',{type:'image/png'}))}
  el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},[sel,texto,html,png]);await page.waitForTimeout(400)}
await colarMisto('#comando',{texto:'Com base nas informações do gráfico, o floricultor verificou.',html:'<p>Com base nas informações do gráfico, o floricultor verificou.</p>'});
ok('Texto do Word (com foto junto) entra como texto', (await page.textContent('#comando')).includes('floricultor') && !(await page.$('#comando img')), await page.innerHTML('#comando'));
ok('Sem aviso de imagem indevido', !((await page.textContent('body')).includes('Use PNG, JPG ou WebP')));
await colarMisto('#texto-base',{texto:'Texto do site',html:'<p>Texto do site</p><img src="https://x/y.png">',png:false});
ok('Texto + imagem de site: texto entra e aparece aviso para colar a imagem separada', (await page.textContent('#texto-base')).includes('Texto do site') && (await page.textContent('body')).includes('copie e cole a imagem separadamente'));
await colarMisto('#alt-a',{texto:null,html:null,png:true});await page.waitForSelector('#alt-a img');
ok('Print sozinho continua entrando como imagem', !!(await page.$('#alt-a img')));
await colarMisto('#alt-b',{texto:'   ',html:null,png:true});await page.waitForSelector('#alt-b img');
ok('Só espaços + imagem: entra a imagem', !!(await page.$('#alt-b img')));
await colarMisto('#alt-c',{texto:'Alternativa simples',html:null,png:false});
ok('Texto simples continua normal', (await page.textContent('#alt-c'))==='Alternativa simples');

// alternativas no formato A) ... E)
await page.evaluate(()=>{for(const l of 'abcde')document.querySelector('#alt-'+l).replaceChildren()});
await colarMisto('#alt-a',{texto:'A) janeiro.   \nB) fevereiro.   \nC) agosto.   \nD) novembro.   \nE) dezembro.   ',html:null,png:false});
const alts=await page.evaluate(()=>'abcde'.split('').map(l=>document.querySelector('#alt-'+l).textContent));
ok('Bloco A) a E) colado na alternativa A preenche as 5, sem as letras', JSON.stringify(alts)===JSON.stringify(['janeiro.','fevereiro.','agosto.','novembro.','dezembro.']), JSON.stringify(alts));
await page.evaluate(()=>{for(const id of ['comando','alt-a','alt-b','alt-c','alt-d','alt-e'])document.querySelector('#'+id).replaceChildren()});
await colarMisto('#comando',{texto:'Em qual mês a floração é maior?\n\n(a) março\n(b) abril\n(c) maio, com\nmuita chuva\n(d) junho\n(e) julho',html:null,png:false});
const r2=await page.evaluate(()=>['comando','alt-a','alt-c','alt-e'].map(id=>document.querySelector('#'+id).innerText.trim()));
ok('Comando + alternativas colados no comando: separa os dois, aceita (a) minúsculo e linha continuada', r2[0]==='Em qual mês a floração é maior?' && r2[1]==='março' && /maio, com\s+muita chuva/.test(r2[2]) && r2[3]==='julho', JSON.stringify(r2));
await page.evaluate(()=>document.querySelector('#alt-b').replaceChildren());
await colarMisto('#alt-b',{texto:'B) só uma alternativa',html:null,png:false});
ok('Uma alternativa sozinha: tira a letra da frente', (await page.textContent('#alt-b'))==='só uma alternativa', await page.textContent('#alt-b'));
await page.evaluate(()=>{document.querySelector('#alt-c').replaceChildren();document.querySelector('#alt-d').replaceChildren()});
await colarMisto('#alt-c',{texto:'A) só três\nB) itens\nC) aqui',html:null,png:false});
ok('Lista incompleta (sem D e E) não é espalhada', (await page.$eval('#alt-d',e=>e.textContent))==='' );
await page.evaluate(()=>{for(const l of 'abcde')document.querySelector('#alt-'+l).replaceChildren()});
await colarMisto('#alt-a',{texto:'A) $x^2$\nB) $2x$\nC) $x$\nD) $1$\nE) $0$',html:null,png:false});
ok('Alternativas com fórmula viram fórmula', !!(await page.$('#alt-a .atlas-equation')) && !!(await page.$('#alt-e .atlas-equation')));
await colarMisto('#texto-base',{texto:'Leia o texto. A cidade cresceu. B. Silva disse que sim.',html:null,png:false});
ok('Texto comum com "A." no meio não é confundido', (await page.textContent('#texto-base')).includes('B. Silva'));
ok('Sem erros de JavaScript', errors.length===0, errors.join(' | '));
await browser.close(); server.close();
for (const x of results) console.log(x.join(' | '));
const bad=results.filter(x=>x[0]!=='OK  ').length; console.log(bad?`\n${bad} FALHA(S)`:`\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
