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
const tEdi=await entrar('edi.franco@grupoideal.com.br');      // professor de Literatura
const tTelma=await entrar('telma.paes@grupoideal.com.br');    // outra professora de Literatura
const tMarcio=await entrar('marcio.alex@grupoideal.com.br');  // supervisor de Literatura
const tSupQ=await entrar('sup.quimica@grupoideal.com.br');    // supervisor de Química
const dados={etapa:'em',origem:'outros',fonte:'fuvest 2024',dificuldade:'Média',assunto:'Romantismo',subtema:'Poesia Romântica no Brasil',bloom:'Aplicar','texto-base':'Leia o poema.',comando:'Considere <span class="atlas-equation" data-latex="x^2">x²</span>',
 'alt-a':'A1','alt-b':'B1','alt-c':'C1','alt-d':'D1','alt-e':'E1',gabarito:'C',resolucao:'Porque sim.'};
let r=await call('/api/itens',{method:'POST',body:{dados}});
ok('Sem login não envia questão', r.status===401);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados}});
const cod=r.data?.item?.codigo;
ok('Professor envia: código L + 7 dígitos', r.status===200 && /^L[1-9]\d{6}$/.test(cod||''), cod||r.data?.error);
ok('Fonte salva em caixa alta', JSON.parse(db.prepare('SELECT dados FROM item_versoes').get().dados).fonte==='FUVEST 2024');
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...dados,comando:'<img src=x onerror=alert(1)>'}}});
ok('HTML perigoso recusado', r.status===400, r.data?.error);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...dados,'alt-c':'  '}}});
ok('Alternativa vazia recusada', r.status===400, r.data?.error);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...dados,gabarito:'F'}}});
ok('Gabarito inválido recusado', r.status===400, r.data?.error);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...dados,'texto-base':'x'.repeat(1600*1024)}}});
ok('Questão grande demais recusada', r.status===413, r.data?.error);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...dados,disciplina:'Química'}}});
ok('Disciplina vem do login (não do navegador)', r.status===200 && r.data.item.disciplina==='Literatura' && r.data.item.codigo.startsWith('L'));
r=await call('/api/itens/meus',{token:tEdi});
ok('Minhas questões: 2 do Edi', r.status===200 && r.data.itens.length===2 && r.data.itens.every(i=>i.situacao==='analise'));
r=await call('/api/itens/'+cod,{token:tTelma});
ok('Outro professor não vê a questão', r.status===404);
r=await call('/api/itens/'+cod,{token:tSupQ});
ok('Supervisor de outra disciplina não vê', r.status===404);
r=await call('/api/supervisor/fila',{token:tEdi});
ok('Professor não acessa fila do supervisor', r.status===403);
r=await call('/api/supervisor/fila',{token:tSupQ});
ok('Fila de Química vazia', r.status===200 && r.data.itens.length===0);
r=await call('/api/supervisor/fila',{token:tMarcio});
ok('Supervisor de Literatura vê 2 na fila', r.status===200 && r.data.itens.length===2 && r.data.itens[0].autor==='Edi Franco');
r=await call('/api/supervisor/itens/'+cod+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'ajuste',motivo:'',versao:1}});
ok('Ajuste sem motivo recusado', r.status===400);
r=await call('/api/supervisor/itens/'+cod+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'ajuste',motivo:'Revise a alternativa C.',versao:1}});
ok('Supervisor pede ajuste', r.status===200 && r.data.item.situacao==='ajustes', r.data?.error);
r=await call('/api/supervisor/itens/'+cod+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'aprovar',versao:1}});
ok('Decisão dupla recusada (409)', r.status===409);
r=await call('/api/itens/meus',{token:tEdi});
ok('Professor vê o motivo do ajuste', r.data.itens.find(i=>i.codigo===cod).ultimo_motivo==='Revise a alternativa C.');
r=await call('/api/itens/'+cod,{method:'PUT',token:tTelma,body:{dados,versao:1}});
ok('Outro professor não reenvia', r.status===404);
r=await call('/api/itens/'+cod,{method:'PUT',token:tEdi,body:{dados:{...dados,'alt-c':'C corrigida'},versao:2}});
ok('Reenvio com versão errada recusado', r.status===409);
r=await call('/api/itens/'+cod,{method:'PUT',token:tEdi,body:{dados:{...dados,'alt-c':'C corrigida'},versao:1}});
ok('Professor reenvia: versão 2', r.status===200 && r.data.item.versao===2, r.data?.error);
r=await call('/api/itens/'+cod,{method:'PUT',token:tEdi,body:{dados,versao:1}});
ok('Reenvio duplo recusado', r.status===409);
ok('Versão 1 preservada no banco', db.prepare('SELECT COUNT(*) n FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=?').get(cod).n===2);
r=await call('/api/itens/'+cod,{token:tMarcio});
ok('Supervisor abre versão 2 com histórico', r.data.item.versao_atual===2 && r.data.item.dados['alt-c']==='C corrigida' && r.data.item.revisoes.length===1);
r=await call('/api/supervisor/itens/'+cod+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'aprovar',versao:2}});
ok('Supervisor aprova', r.status===200 && r.data.item.situacao==='aprovado');
r=await call('/api/supervisor/fila?situacao=aprovado',{token:tMarcio});
ok('Aba Aprovadas mostra a questão', r.data.itens.some(i=>i.codigo===cod));
const ev=db.prepare("SELECT acao FROM eventos WHERE acao LIKE 'item_%'").all().map(e=>e.acao);
ok('Eventos registrados', ['item_enviado','item_ajuste_solicitado','item_reenviado','item_aprovado'].every(a=>ev.includes(a)), ev.join(','));
// código: formato em 2000 sorteios
const seen=new Set(); let okf=true; for(let i=0;i<2000;i++){const c=(await import(REPO+'_cloudflare/atlas-api/worker.js?x')).default; break}
ok('Saúde continua', (await call('/api/saude')).status===200);

// ===== navegador: fluxo completo nas telas =====
const server = http.createServer(async (req, res) => { const chunks=[]; for await (const c of req) chunks.push(c); const request=new Request('https://atlas-api.test'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD','OPTIONS'].includes(req.method)?undefined:Buffer.concat(chunks)}); const response=await worker.fetch(request,env); res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(8789);
const K=S+'katexpkg/package/dist/';
const browser=await chromium.launch(); const ctx=await browser.newContext();
await ctx.route('https://idealolimpico.com.br/atlas/**', route=>{const f=new URL(route.request().url()).pathname.replace('/atlas/','')||'index.html';const p=REPO+'atlas/'+f;if(!fs.existsSync(p))return route.fulfill({status:404,body:'nf'});route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'image/png',body:fs.readFileSync(p)})});
await ctx.route('https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/**', r2=>{const p=new URL(r2.request().url()).pathname.replace('/npm/katex@0.19.1/dist/','');r2.fulfill({status:200,headers:{'content-type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'font/'+p.split('.').pop(),'access-control-allow-origin':'*'},body:fs.readFileSync(K+p)})});
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route=>{const u=route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev','http://localhost:8789');const resp=await route.fetch({url:u,headers:{...route.request().headers(),origin:ORIGIN}});route.fulfill({response:resp})});
const page=await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.dismiss()});
const paste=(sel,text)=>page.evaluate(([sel,text])=>{const el=document.querySelector(sel);el.focus();const dt=new DataTransfer();dt.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},[sel,text]);
async function login(card,user,limpar=true){db.exec('DELETE FROM login_rate_limits');if(limpar)await page.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('atlas_user_auth')}).catch(()=>{});await page.goto('https://idealolimpico.com.br/atlas/');await page.click(`[data-role="${card}"]`);await page.fill('#email',user);await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');await page.fill('#code',lastCode());await page.click('#verifyButton');}
await login('Professor','telma.paes');
await page.waitForURL(/professor\.html/);await page.waitForFunction(()=>!document.querySelector('#questao-form').hidden);
await page.waitForFunction(()=>document.querySelector('#meus-lista').textContent.includes('ainda não enviou'));
ok('Tela Professor: "Minhas questões" vazia', true);
await page.selectOption('#assunto','Romantismo');await page.selectOption('#origem','autoral');await page.selectOption('#dificuldade','Fácil');await page.selectOption('#bloom','Lembrar');
const subs=await page.$$eval('#subtema option',o=>o.map(x=>x.value).filter(Boolean)); if(subs.length) await page.selectOption('#subtema',subs[0]);
await paste('#comando','Calcule $\\frac{1}{2}$ e responda.');for(const l of 'abcde')await paste('#alt-'+l,'Opção '+l);await page.selectOption('#gabarito','B');
await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#enviar');await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#enviar');
await page.waitForFunction(()=>/Código: L\d{7}/.test(document.querySelector('#status').textContent),null,{timeout:8000}).catch(()=>{});
const st=await page.textContent('#status'); const codTela=(st.match(/L\d{7}/)||[])[0];
ok('Tela Professor: envio mostra o código', !!codTela, st);
await page.waitForFunction(c=>document.querySelector('#meus-lista').textContent.includes(c),codTela);
ok('Tela Professor: questão aparece em "Minhas questões"', (await page.textContent('#meus-lista')).includes('Em análise'));
ok('Equação gravada no banco', JSON.parse(db.prepare('SELECT v.dados FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=?').get(codTela).dados).comando.includes('atlas-equation'));
await login('Supervisor','marcio.alex');
await page.waitForURL(/supervisor\.html/);await page.waitForFunction(()=>document.querySelectorAll('#list tbody tr').length>0);
ok('Tela Supervisor: fila do banco', (await page.textContent('#list')).includes(codTela));
const row=page.locator('#list tr',{hasText:codTela});await row.locator('button').click();
await page.waitForSelector('#details:not([hidden])');
ok('Tela Supervisor: questão com fórmula renderizada', (await page.$$eval('#item-content .katex',e=>e.length))>=1);
await page.click('#request-adjustment');await page.fill('#adjust-reason','Troque a alternativa A.');await page.click('#adjust-form button[type=submit]');
await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Pedido de ajuste'));
ok('Tela Supervisor: ajuste enviado', true);
await login('Professor','telma.paes');
await page.waitForURL(/professor\.html/);await page.waitForFunction(c=>document.querySelector('#meus-lista').textContent.includes('Troque a alternativa A.'),codTela);
ok('Tela Professor: vê motivo e link Corrigir', (await page.textContent('#meus-lista')).includes('Corrigir'));
await page.click('#meus-lista a');await page.waitForFunction(()=>document.querySelector('#enviar').textContent.includes('Reenviar'));
ok('Tela Professor: correção carregada do banco', (await page.$$eval('#comando .atlas-equation',e=>e.length))===1 && (await page.inputValue('#gabarito'))==='B');
await page.evaluate(()=>{document.querySelector('#alt-a').replaceChildren()});await paste('#alt-a','Opção A corrigida');
await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#enviar');await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#enviar');
await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('reenviada'),null,{timeout:8000}).catch(()=>{});
ok('Tela Professor: reenvio (versão 2)', (await page.textContent('#status')).includes('reenviada') && db.prepare('SELECT versao_atual v FROM itens WHERE codigo=?').get(codTela).v===2, await page.textContent('#status'));
// rascunho quando o login vence
await page.selectOption('#assunto','Romantismo');await paste('#comando','Texto que não pode se perder');
db.exec('DELETE FROM sessoes');
await page.selectOption('#origem','enem');await page.selectOption('#dificuldade','Fácil');await page.selectOption('#bloom','Lembrar');for(const l of 'abcde')await paste('#alt-'+l,'X'+l);await page.selectOption('#gabarito','A');
if(subs.length) await page.selectOption('#subtema',subs[0]);
await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#enviar');await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#enviar');
await page.waitForURL(/index\.html|atlas\/(\?|$)/,{timeout:8000}).catch(()=>{});
const temRascunho=await page.evaluate(()=>!!localStorage.getItem('atlas_rascunho_questao'));
ok('Rascunho guardado antes de voltar ao login', temRascunho);
await login('Professor','telma.paes',false);await page.waitForURL(/professor\.html/);
await page.waitForFunction(()=>document.body.textContent.includes('Rascunho recuperado'),null,{timeout:8000}).catch(()=>{});
ok('Login vencido: rascunho volta para a tela', (await page.textContent('#comando')).includes('Texto que não pode se perder'));
await login('Supervisor','marcio.alex');await page.waitForURL(/supervisor\.html/);
await page.waitForFunction(()=>document.querySelectorAll('#list tbody tr').length>0);
await page.locator('#list tr',{hasText:codTela}).locator('button').click();await page.waitForSelector('#details:not([hidden])');
ok('Tela Supervisor: histórico mostra o ajuste anterior', (await page.textContent('#item-content')).includes('Troque a alternativa A.'));
await page.click('#approve');await page.click('#confirm-approve');await page.waitForFunction(c=>document.querySelector('#notice').textContent.includes(c+' aprovada'),codTela);
ok('Tela Supervisor: aprovação', db.prepare('SELECT situacao s FROM itens WHERE codigo=?').get(codTela).s==='aprovado');
ok('Nenhuma janela do navegador (confirm/alert) é usada', dialogs.length===0, dialogs.join(' | '));
ok('Sem erros de JavaScript nas telas', errors.length===0, errors.join(' | '));
await browser.close(); server.close();
for (const x of results) console.log(x.join(' | '));
const bad=results.filter(x=>x[0]!=='OK  ').length; console.log(bad?`\n${bad} FALHA(S)`:`\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
