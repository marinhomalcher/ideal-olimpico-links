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
const lastCode=()=>mails.at(-1)?.codigo;
async function tok(email){db.exec('DELETE FROM login_rate_limits');await call('/api/login/codigo',{method:'POST',body:{email}});return (await call('/api/login/verificar',{method:'POST',body:{email,codigo:lastCode()}})).data.token}
db.exec("INSERT INTO usuarios (nome,email,disciplina,papel) VALUES ('Sup Mat','sup.mat@grupoideal.com.br','Matemática','supervisor')");
const tMarcio=await tok('marcio.alex@grupoideal.com.br');
const tAdm=(await call('/api/adm/login',{method:'POST',body:{credential:await jwt({})}})).data.token;
ok('ADM entra', !!tAdm);
const tEdi=await tok('edi.franco@grupoideal.com.br');
const base={etapa:'em',origem:'autoral',dificuldade:'Média',assunto:'Romantismo',bloom:'Aplicar',comando:'C','alt-a':'A','alt-b':'B','alt-c':'C','alt-d':'D','alt-e':'E',gabarito:'A'};
const cs=[];for(let k=0;k<3;k++){const r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,comando:'Edi '+k}}});cs.push(r.data.item.codigo)}
db.exec("UPDATE itens SET criado_em='2026-03-10T15:00:00Z' WHERE codigo='"+cs[0]+"'");
let r=await call('/api/itens/meus/resumo',{token:tEdi});
ok('Resumo traz por_mes com a situação de cada mês', r.data.por_mes.length===12&&r.data.por_mes[2].enviadas===1&&r.data.por_mes[2].analise===1&&r.data.por_mes.reduce((t,m)=>t+m.enviadas,0)===3, JSON.stringify(r.data.por_mes[2]));
const casos=[['2026-06-30',false],['2026-07-01',true],['2026-07-31',true],['2026-08-01',false],['2026-12-14',false],['2026-12-15',true],['2026-12-31',true],['2027-01-15',true],['2027-01-31',true],['2027-02-01',false]];
for(const [dia,fechado] of casos){env.ATLAS_HOJE_TESTE=dia;db.exec('DELETE FROM login_rate_limits');
  const c=await call('/api/login/codigo',{method:'POST',body:{email:'edi.franco@grupoideal.com.br'}});
  const s=await call('/api/login/sessao',{token:tEdi});
  ok(dia+(fechado?': fechado (FÉRIAS)':': aberto'), fechado?(c.status===423&&c.data.ferias===true&&s.status===423&&s.data.ferias===true):(c.status===200&&s.status===200), c.status+'/'+s.status+' '+(c.data?.error||''))}
env.ATLAS_HOJE_TESTE='2026-07-10';
r=await call('/api/login/sessao',{token:tEdi});ok('Mensagem diz quando reabre (julho → 1º de agosto)', /1º de agosto/.test(r.data.error)&&r.data.reabre==='1º de agosto', r.data.error);
r=await call('/api/itens/meus',{token:tEdi});ok('Férias: rotas do professor fechadas', r.status===423);
r=await call('/api/supervisor/fila?situacao=analise',{token:tMarcio});ok('Férias: Supervisor também fechado', r.status===423);
r=await call('/api/adm/relatorio?ano=2026',{token:tAdm});ok('Férias: ADM continua entrando', r.status===200, r.status);
r=await call('/api/adm/itens/enviar',{method:'POST',token:tAdm,body:{disciplina:'Química',dados:{comando:'Nas férias','alt-a':'1','alt-b':'2','alt-c':'3','alt-d':'4','alt-e':'5',gabarito:'A'}}});ok('Férias: ADM continua enviando questões', r.status===200, r.data?.error);
env.ATLAS_HOJE_TESTE='2026-12-20';r=await call('/api/login/sessao',{token:tEdi});ok('Dezembro → reabre 1º de fevereiro', r.data.reabre==='1º de fevereiro');
// ===== digitador: fechado só em julho; trabalha no recesso de dezembro/janeiro =====
db.exec("INSERT INTO usuarios (nome,email,disciplina,papel,digitador) VALUES ('Dig Férias','dig.ferias@grupoideal.com.br',NULL,'professor',1)");
const conteudoDig={comando:'Questão digitada no recesso','alt-a':'1','alt-b':'2','alt-c':'3','alt-d':'4','alt-e':'5',gabarito:'B'};
env.ATLAS_HOJE_TESTE='2026-12-20';const tDig=await tok('dig.ferias@grupoideal.com.br');
ok('Digitador entra no recesso de dezembro (código + login)', !!tDig);
r=await call('/api/login/sessao',{token:tDig});ok('Digitador: sessão aberta em dezembro', r.status===200&&r.data.usuario.papel==='digitador', r.status);
r=await call('/api/itens/digitador',{method:'POST',token:tDig,body:{disciplina:'Matemática',dados:conteudoDig}});ok('Digitador envia questão em dezembro', r.status===200, r.status+' '+(r.data?.error||''));
r=await call('/api/login/sessao',{token:tEdi});ok('Professor continua fechado em dezembro', r.status===423);
r=await call('/api/supervisor/fila?situacao=analise',{token:tMarcio});ok('Supervisor continua fechado em dezembro', r.status===423);
env.ATLAS_HOJE_TESTE='2027-01-20';r=await call('/api/login/sessao',{token:tDig});ok('Digitador: aberto em janeiro', r.status===200, r.status);
env.ATLAS_HOJE_TESTE='2026-07-10';db.exec('DELETE FROM login_rate_limits');
let c=await call('/api/login/codigo',{method:'POST',body:{email:'dig.ferias@grupoideal.com.br'}});r=await call('/api/login/sessao',{token:tDig});
ok('Digitador: fechado em julho (código e sessão)', c.status===423&&c.data.ferias===true&&r.status===423, c.status+'/'+r.status);
r=await call('/api/itens/digitador',{method:'POST',token:tDig,body:{disciplina:'Matemática',dados:{...conteudoDig,comando:'julho'}}});ok('Digitador: não envia em julho', r.status===423);
env.ATLAS_HOJE_TESTE='2026-12-20';db.exec("UPDATE usuarios SET ativo=0 WHERE email='dig.ferias@grupoideal.com.br'");db.exec('DELETE FROM login_rate_limits');
c=await call('/api/login/codigo',{method:'POST',body:{email:'dig.ferias@grupoideal.com.br'}});ok('Digitador desativado: recesso fechado para ele', c.status===423, c.status);
db.exec("UPDATE usuarios SET ativo=1, acesso_ate='2026-01-01' WHERE email='dig.ferias@grupoideal.com.br'");db.exec('DELETE FROM login_rate_limits');
c=await call('/api/login/codigo',{method:'POST',body:{email:'dig.ferias@grupoideal.com.br'}});ok('Digitador com prazo vencido: recesso fechado para ele', c.status===423, c.status);
// ===== telas =====
const server = http.createServer(async (req, res) => { const chunks=[]; for await (const c of req) chunks.push(c); const request=new Request('https://atlas-api.test'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD','OPTIONS'].includes(req.method)?undefined:Buffer.concat(chunks)}); const response=await worker.fetch(request,env); res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(8794);
const K=S+'katexpkg/package/dist/';
const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:1280,height:900}});
await ctx.route('https://idealolimpico.com.br/atlas/**', route=>{const f=new URL(route.request().url()).pathname.replace('/atlas/','')||'index.html';const p=REPO+'atlas/'+f;if(!fs.existsSync(p))return route.fulfill({status:404,body:'nf'});route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'image/png',body:fs.readFileSync(p)})});
await ctx.route('https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/**', r2=>{const p=new URL(r2.request().url()).pathname.replace('/npm/katex@0.19.1/dist/','');r2.fulfill({status:200,headers:{'content-type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'font/'+p.split('.').pop(),'access-control-allow-origin':'*'},body:fs.readFileSync(K+p)})});
await ctx.route('https://accounts.google.com/**', r2=>r2.fulfill({status:200,contentType:'application/javascript',body:'window.google={accounts:{id:{initialize(){},renderButton(){},disableAutoSelect(){}}}}'}));
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route=>{const u=route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev','http://localhost:8794');const resp=await route.fetch({url:u,headers:{...route.request().headers(),origin:ORIGIN}});route.fulfill({response:resp})});
const page=await ctx.newPage(); await page.clock.setFixedTime(new Date('2026-11-13T15:00:00Z')); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.dismiss()});
// aberto: resumo com tabela
env.ATLAS_HOJE_TESTE='2026-11-13';
db.exec('DELETE FROM login_rate_limits');await page.goto('https://idealolimpico.com.br/atlas/');await page.click('[data-role="Professor"]');await page.fill('#email','edi.franco');await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');await page.fill('#code',lastCode());await page.click('#verifyButton');
await page.waitForURL(/professor\.html/);await page.waitForFunction(()=>document.querySelector('#resumo-mes-sel').options.length>0&&document.querySelector('#resumo-mes').textContent!=='–');
ok('Tela: sem tabela de meses (só o resumo)', !(await page.$('#resumo-tabela')));
const opts=await page.$$eval('#resumo-mes-sel option',o=>o.map(x=>x.textContent));
ok('Tela: filtro tem Ano todo e fevereiro a dezembro, sem julho nem janeiro', opts[0]==='Ano todo'&&opts[1]==='Fevereiro'&&opts.at(-1)==='Dezembro'&&!opts.includes('Julho')&&!opts.includes('Janeiro'), opts.join('|'));
ok('Tela: filtro começa no mês atual', (await page.inputValue('#resumo-mes-sel'))==='10'&&(await page.textContent('#resumo-mes-rot')).includes('novembro'));
await page.selectOption('#resumo-mes-sel','2');
ok('Tela: escolher março filtra os cartões', (await page.textContent('#resumo-mes'))==='1'&&(await page.textContent('#resumo-mes-rot')).includes('março'));
await page.selectOption('#resumo-mes-sel','ano');
ok('Tela: Ano todo mostra 3 enviadas e correções', (await page.textContent('#resumo-mes'))==='3'&&(await page.textContent('#resumo-cartoes')).includes('correções reenviadas'));
await page.locator('#meu-resumo').screenshot({path:S+'resumo-tabela.png'});
// férias: professor já logado
env.ATLAS_HOJE_TESTE='2026-07-10';
await page.goto('https://idealolimpico.com.br/atlas/professor.html');await page.waitForSelector('#atlas-ferias');
ok('Tela: professor logado em julho vê FÉRIAS', (await page.textContent('#atlas-ferias')).includes('FÉRIAS')&&(await page.textContent('#atlas-ferias')).includes('1º de agosto'));
await page.screenshot({path:S+'ferias.png'});
await page.click('#atlas-ferias button');await page.waitForURL(/atlas\/(index\.html)?$/);
await page.waitForTimeout(400);
ok('Tela inicial com sessão salva não trava nas férias (ADM acessível)', !(await page.$('#atlas-ferias')));
await page.click('[data-role="Professor"]');await page.waitForSelector('#atlas-ferias');
ok('Tela inicial: clicar em Professor nas férias mostra FÉRIAS', true);
await page.click('#atlas-ferias button');
await page.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('atlas_user_auth')});await page.reload();
await page.click('[data-role="Professor"]');await page.fill('#email','edi.franco');await page.click('#loginButton');await page.waitForSelector('#atlas-ferias');
ok('Tela inicial: pedir código nas férias mostra FÉRIAS', (await page.textContent('#atlas-ferias')).includes('FÉRIAS'));
await page.click('#atlas-ferias button');
await page.goto('https://idealolimpico.com.br/atlas/admin-relatorio.html');await page.evaluate(t=>sessionStorage.setItem('atlas_adm_token',t),tAdm);await page.reload();await page.waitForSelector('table.rel');
ok('Tela ADM funciona nas férias', !(await page.$('#atlas-ferias')));
ok('Sem erros de JavaScript', errors.filter(e=>!/FÉRIAS/.test(e)).length===0, errors.join(' | '));
ok('Nenhum alert/confirm', dialogs.length===0);
await browser.close();server.close();
for(const [s,n,e] of results)console.log(s,n,e?'— '+e:'');
console.log(results.filter(r=>r[0]!=='OK  ').length+' falha(s) de '+results.length);
process.exit(0);
