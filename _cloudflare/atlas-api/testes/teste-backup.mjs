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


const tEdi=await (async()=>{db.exec('DELETE FROM login_rate_limits');await call('/api/login/codigo',{method:'POST',body:{email:'edi.franco@grupoideal.com.br'}});return (await call('/api/login/verificar',{method:'POST',body:{email:'edi.franco@grupoideal.com.br',codigo:lastCode()}})).data.token})();
async function tok(email){db.exec('DELETE FROM login_rate_limits');await call('/api/login/codigo',{method:'POST',body:{email}});return (await call('/api/login/verificar',{method:'POST',body:{email,codigo:lastCode()}})).data.token}
const tMarcio=await tok('marcio.alex@grupoideal.com.br'), tSupQ=await tok('sup.quimica@grupoideal.com.br');
const dados={etapa:'em',origem:'autoral',dificuldade:'Média',assunto:'Romantismo',bloom:'Aplicar',comando:'Comando',
 'alt-a':'A1','alt-b':'B1','alt-c':'C1','alt-d':'D1','alt-e':'E1',gabarito:'C'};
const tAdm=(await call('/api/adm/login',{method:'POST',body:{credential:await jwt({})}})).data.token;
for(let k=0;k<3;k++)await call('/api/itens',{method:'POST',token:tEdi,body:{dados}});
// muitas linhas para testar a paginação
const ins=db.prepare("INSERT INTO eventos (usuario_id, acao, detalhe) VALUES (NULL,'teste','{}')");for(let k=0;k<1203;k++)ins.run();
const nEventos=db.prepare('SELECT COUNT(*) n FROM eventos').get().n;
let r=await call('/api/adm/backups',{token:tMarcio});
ok('Cópias exigem sessão de ADM', r.status===401);
r=await call('/api/adm/backups',{token:tAdm});
ok('Lista vazia no início', r.status===200 && r.data.backups.length===0);
r=await call('/api/adm/backups',{method:'POST',token:tAdm,body:{}});
ok('Cópia manual feita', r.status===200 && r.data.backup.itens===3, JSON.stringify(r.data));
const chave=[...r2store.keys()].find(k=>k.startsWith('backups/'));
const copia=JSON.parse(new TextDecoder().decode(r2store.get(chave).bytes));
ok('Cópia tem as tabelas de conteúdo completas (com paginação)', copia.tabelas.itens.length===3 && copia.tabelas.item_versoes.length===3 && copia.tabelas.eventos.length===nEventos && copia.tabelas.usuarios.length>=5, copia.tabelas.eventos.length+' / '+nEventos);
ok('Cópia não leva sessões nem códigos de login', !('sessoes' in copia.tabelas) && !('login_codigos' in copia.tabelas) && !('login_rate_limits' in copia.tabelas));
r=await call('/api/adm/backups',{method:'POST',token:tAdm,body:{}});
ok('Cópia manual seguida: aguardar 1 minuto', r.status===429);
r=await call('/api/adm/backups',{token:tAdm});
const nome=r.data.backups[0].nome;
ok('Lista mostra a cópia', r.data.backups.length===1 && /^atlas-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/.test(nome), nome);
const res=await worker.fetch(new Request('https://atlas-api.test/api/adm/backups/'+nome,{headers:{Origin:ORIGIN,Authorization:'Bearer '+tAdm}}),env);
const baixado=JSON.parse(await res.text());
ok('Download da cópia', res.status===200 && /attachment/.test(res.headers.get('content-disposition')) && baixado.tabelas.itens.length===3);
const res2=await worker.fetch(new Request('https://atlas-api.test/api/adm/backups/'+nome,{headers:{Origin:ORIGIN,Authorization:'Bearer '+tEdi}}),env);
ok('Professor não baixa cópia', res2.status===401);
const res3=await worker.fetch(new Request('https://atlas-api.test/img/../backups/'+nome),env);
ok('Cópia não sai pelo endereço público de imagens', res3.status===404);
// automática + limite de 60
const cctx={p:[],waitUntil(x){this.p.push(x)}};
for(let k=0;k<62;k++){r2store.set('backups/atlas-2026-01-'+String(k%28+1).padStart(2,'0')+'T00-00-'+String(k).padStart(2,'0')+'Z.json',{bytes:new Uint8Array(2),o:{},up:new Date()})}
await worker.scheduled({cron:'17 6 * * *'},env,cctx);await Promise.all(cctx.p);
const lista=[...r2store.keys()].filter(k=>k.startsWith('backups/')).sort();
ok('Cópia automática roda pelo agendamento', db.prepare("SELECT COUNT(*) n FROM eventos WHERE acao='backup_feito' AND detalhe LIKE '%automatico%'").get().n===1);
ok('Ficam só as 60 mais recentes', lista.length===60 && lista.at(-1).startsWith('backups/atlas-'+new Date().toISOString().slice(0,7))   /* a de agora (mês atual, UTC) */ , lista.length+' '+lista.at(-1));
// tela
const server = http.createServer(async (req, res) => { const chunks=[]; for await (const c of req) chunks.push(c); const request=new Request('https://atlas-api.test'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD','OPTIONS'].includes(req.method)?undefined:Buffer.concat(chunks)}); const response=await worker.fetch(request,env); res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(8791);
const K=S+'katexpkg/package/dist/';
const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:1280,height:900}});
await ctx.route('https://idealolimpico.com.br/atlas/**', route=>{const f=new URL(route.request().url()).pathname.replace('/atlas/','')||'index.html';const p=REPO+'atlas/'+f;if(!fs.existsSync(p))return route.fulfill({status:404,body:'nf'});route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'image/png',body:fs.readFileSync(p)})});
await ctx.route('https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/**', r2=>{const p=new URL(r2.request().url()).pathname.replace('/npm/katex@0.19.1/dist/','');r2.fulfill({status:200,headers:{'content-type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'font/'+p.split('.').pop(),'access-control-allow-origin':'*'},body:fs.readFileSync(K+p)})});
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route=>{const u=route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev','http://localhost:8791');const resp=await route.fetch({url:u,headers:{...route.request().headers(),origin:ORIGIN}});route.fulfill({response:resp})});
const page=await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.dismiss()});
const paste=(sel,text)=>page.evaluate(([sel,text])=>{const el=document.querySelector(sel);el.focus();const dt=new DataTransfer();dt.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},[sel,text]);
await page.addInitScript(t=>{try{sessionStorage.setItem('atlas_adm_token',t)}catch{}},tAdm);
await page.goto('https://idealolimpico.com.br/atlas/admin.html');
await page.waitForFunction(()=>document.querySelector('#backup-ultimo').textContent.includes('Última cópia'));
ok('Tela ADM: mostra a última cópia', true);
db.exec('DELETE FROM login_rate_limits');
await page.click('#backup-agora');await page.waitForFunction(()=>document.querySelector('#backup-status').textContent.includes('Cópia feita'));
await page.click('#backup-ver');await page.waitForFunction(()=>document.querySelectorAll('#backup-lista tbody tr').length>0);
ok('Tela ADM: cópia manual e lista', (await page.$$('#backup-lista tbody tr')).length===60);
const [down]=await Promise.all([page.waitForEvent('download'),page.locator('#backup-lista tbody tr').first().getByText('Baixar').click()]);
ok('Tela ADM: botão Baixar entrega o arquivo', /^atlas-.*\.json$/.test(down.suggestedFilename()), down.suggestedFilename());
await page.screenshot({path:S+'backup.png',fullPage:true});
ok('Sem erros de JavaScript nem caixas do navegador', errors.length===0 && dialogs.length===0, errors.join(' | '));
await browser.close(); server.close();
for (const x of results) console.log(x.join(' | '));
const bad=results.filter(x=>x[0]!=='OK  ').length; console.log(bad?`\n${bad} FALHA(S)`:`\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
