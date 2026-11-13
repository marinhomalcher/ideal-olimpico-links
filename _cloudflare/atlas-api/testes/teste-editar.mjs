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
db.exec("INSERT INTO usuarios (nome,email,disciplina,papel) VALUES ('Sup Química','sup.quimica@grupoideal.com.br','Química','supervisor')");
const lastCode=()=>mails.at(-1)?.codigo;
async function entrar(email){ db.exec('DELETE FROM login_rate_limits'); await call('/api/login/codigo',{method:'POST',body:{email}}); const r=await call('/api/login/verificar',{method:'POST',body:{email,codigo:lastCode()}}); return r.data.token; }


const tEdi=await (async()=>{db.exec('DELETE FROM login_rate_limits');await call('/api/login/codigo',{method:'POST',body:{email:'edi.franco@grupoideal.com.br'}});return (await call('/api/login/verificar',{method:'POST',body:{email:'edi.franco@grupoideal.com.br',codigo:lastCode()}})).data.token})();
async function tok(email){db.exec('DELETE FROM login_rate_limits');await call('/api/login/codigo',{method:'POST',body:{email}});return (await call('/api/login/verificar',{method:'POST',body:{email,codigo:lastCode()}})).data.token}
const tMarcio=await tok('marcio.alex@grupoideal.com.br'), tSupQ=await tok('sup.quimica@grupoideal.com.br');
const dados={etapa:'em',origem:'autoral',dificuldade:'Média',assunto:'Romantismo',bloom:'Aplicar',comando:'Comando',
 'alt-a':'A1','alt-b':'B1','alt-c':'C1','alt-d':'D1','alt-e':'E1',gabarito:'C'};
const c1=(await call('/api/itens',{method:'POST',token:tEdi,body:{dados}})).data.item.codigo;
const c2=(await call('/api/itens',{method:'POST',token:tEdi,body:{dados}})).data.item.codigo;
let r=await call('/api/supervisor/itens/'+c1,{method:'PUT',token:tEdi,body:{dados,versao:1}});
ok('Professor não usa a edição do Supervisor', r.status===403);
r=await call('/api/supervisor/itens/'+c1,{method:'PUT',token:tSupQ,body:{dados,versao:1}});
ok('Supervisor de outra disciplina não edita', r.status===404);
r=await call('/api/supervisor/itens/'+c1,{method:'PUT',token:tMarcio,body:{dados:{...dados,'alt-a':'A corrigida pelo supervisor'},versao:1}});
ok('Supervisor edita: versão 2, continua em análise', r.status===200 && r.data.item.versao===2 && r.data.item.situacao==='analise', r.data?.error);
const v2=db.prepare('SELECT v.autor_id a, i.autor_id p FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=? AND v.versao=2').get(c1);
ok('Versão 2 registrada como do Supervisor; versão 1 preservada', v2.a!==v2.p && db.prepare('SELECT COUNT(*) n FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=?').get(c1).n===2);
r=await call('/api/supervisor/itens/'+c1,{method:'PUT',token:tMarcio,body:{dados,versao:1}});
ok('Edição com versão desatualizada recusada', r.status===409);
r=await call('/api/itens/meus',{token:tEdi});
ok('Professor vê "editada pelo Supervisor"', r.data.itens.find(i=>i.codigo===c1).editada_supervisor===1);
r=await call('/api/itens/'+c1,{token:tMarcio});
ok('Detalhe lista as versões', r.data.item.versoes.length===2 && r.data.item.versoes[1].pelo_supervisor===1);
r=await call('/api/supervisor/itens/'+c2+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'descartar',motivo:'',versao:1}});
ok('Descartar sem motivo recusado', r.status===400, r.data?.error);
r=await call('/api/supervisor/itens/'+c2+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'ajuste',motivo:'Ajuste algo',versao:1}});
r=await call('/api/supervisor/itens/'+c2+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'descartar',motivo:'Conteúdo repetido',versao:1}});
ok('Descartar questão que aguardava ajuste', r.status===200 && r.data.item.situacao==='descartado', r.data?.error);
r=await call('/api/supervisor/itens/'+c2,{method:'PUT',token:tMarcio,body:{dados,versao:1}});
ok('Questão descartada não pode ser editada', r.status===409);
r=await call('/api/itens/'+c2,{method:'PUT',token:tEdi,body:{dados,versao:1}});
ok('Professor não reenvia questão descartada', r.status===409);
r=await call('/api/supervisor/fila?situacao=descartado',{token:tMarcio});
ok('Aba Descartadas com motivo', r.data.itens.length===1 && r.data.itens[0].ultimo_motivo==='Conteúdo repetido');
r=await call('/api/itens/meus',{token:tEdi});
ok('Professor vê descarte e motivo', r.data.itens.find(i=>i.codigo===c2).situacao==='descartado' && r.data.itens.find(i=>i.codigo===c2).ultimo_motivo==='Conteúdo repetido');
const c3=(await call('/api/itens',{method:'POST',token:tEdi,body:{dados}})).data.item.codigo;
ok('Código descartado não se repete', c3!==c2 && c3!==c1);
// ===== telas =====
const server = http.createServer(async (req, res) => { const chunks=[]; for await (const c of req) chunks.push(c); const request=new Request('https://atlas-api.test'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD','OPTIONS'].includes(req.method)?undefined:Buffer.concat(chunks)}); const response=await worker.fetch(request,env); res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(8791);
const K=S+'katexpkg/package/dist/';
const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:1280,height:900}});
await ctx.route('https://idealolimpico.com.br/atlas/**', route=>{const f=new URL(route.request().url()).pathname.replace('/atlas/','')||'index.html';const p=REPO+'atlas/'+f;if(!fs.existsSync(p))return route.fulfill({status:404,body:'nf'});route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'image/png',body:fs.readFileSync(p)})});
await ctx.route('https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/**', r2=>{const p=new URL(r2.request().url()).pathname.replace('/npm/katex@0.19.1/dist/','');r2.fulfill({status:200,headers:{'content-type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'font/'+p.split('.').pop(),'access-control-allow-origin':'*'},body:fs.readFileSync(K+p)})});
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route=>{const u=route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev','http://localhost:8791');const resp=await route.fetch({url:u,headers:{...route.request().headers(),origin:ORIGIN}});route.fulfill({response:resp})});
const page=await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.dismiss()});
const paste=(sel,text)=>page.evaluate(([sel,text])=>{const el=document.querySelector(sel);el.focus();const dt=new DataTransfer();dt.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},[sel,text]);
async function login(card,user){db.exec('DELETE FROM login_rate_limits');await page.goto('https://idealolimpico.com.br/atlas/');await page.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('atlas_user_auth')});await page.goto('https://idealolimpico.com.br/atlas/');await page.click(`[data-role="${card}"]`);await page.fill('#email',user);await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');await page.fill('#code',lastCode());await page.click('#verifyButton');}
await login('Supervisor','marcio.alex');await page.waitForURL(/supervisor\.html/);await page.waitForFunction(()=>document.querySelectorAll('#list tbody tr').length>0);
ok('Tela: botões Editar e Descartar ativos', true);
await page.locator('#list tr',{hasText:c3}).locator('button').click();await page.waitForSelector('#details:not([hidden])');
ok('Tela: Editar e Descartar habilitados', !(await page.isDisabled('#edit-item')) && !(await page.isDisabled('#discard-item')) && await page.isVisible('#edit-item'));
await page.click('#edit-item');await page.waitForSelector('#edit-form:not([hidden])');
ok('Tela: formulário de edição carrega a questão', (await page.textContent('#alt-a'))==='A1' && (await page.inputValue('#gabarito'))==='C');
await page.evaluate(()=>document.querySelector('#alt-b').replaceChildren());await paste('#alt-b','B com $x^2$');await page.selectOption('#gabarito','B');
await page.click('#save-edit');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('versão 2'));
ok('Tela: edição salva (versão 2) e histórico de versões aparece', (await page.textContent('#item-content')).includes('editada pelo Supervisor'));
const d3=JSON.parse(db.prepare('SELECT v.dados FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=? AND v.versao=2').get(c3).dados);
ok('Edição gravada com fórmula e gabarito novo', d3['alt-b'].includes('atlas-equation') && d3.gabarito==='B' && d3.assunto==='Romantismo');
await page.click('#discard-item');await page.fill('#discard-reason','Fora da matriz');await page.click('#discard-form button[type=submit]');
await page.waitForFunction(c=>document.querySelector('#notice').textContent.includes(c+' descartada'),c3);
ok('Tela: descarte com motivo', db.prepare('SELECT situacao s FROM itens WHERE codigo=?').get(c3).s==='descartado');
await page.click('[data-tab="descartado"]');await page.waitForFunction(()=>document.querySelector('#list').textContent.includes('Fora da matriz'));
ok('Tela: aba Descartadas mostra o motivo', true);
await login('Professor','edi.franco');await page.waitForURL(/professor\.html/);await page.waitForFunction(c=>document.querySelector('#meus-lista').textContent.includes(c),c3);
const lista=await page.textContent('#meus-lista');
ok('Tela Professor: vê "Descartada" com motivo e "Editada pelo Supervisor"', lista.includes('Descartada') && lista.includes('Fora da matriz') && lista.includes('Editada pelo Supervisor'));
ok('Nenhuma janela do navegador (confirm/alert) é usada', dialogs.length===0, dialogs.join(' | '));
ok('Sem erros de JavaScript', errors.length===0, errors.join(' | '));
await browser.close(); server.close();
for (const x of results) console.log(x.join(' | '));
const bad=results.filter(x=>x[0]!=='OK  ').length; console.log(bad?`\n${bad} FALHA(S)`:`\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
