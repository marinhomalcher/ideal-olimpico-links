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
const espera=()=>new Promise(r=>setTimeout(r,30));
const tAdm=(await call('/api/adm/login',{method:'POST',body:{credential:await jwt({})}})).data.token;
ok('ADM entra', !!tAdm);
const novo=async()=>(await call('/api/itens',{method:'POST',token:tEdi,body:{dados}})).data.item.codigo;
const decidir=(c,decisao,motivo='',versao=1)=>call('/api/supervisor/itens/'+c+'/decisao',{method:'POST',token:tMarcio,body:{decisao,motivo,versao}});
const cA=await novo(), cD=await novo(), cV=await novo();

// --- avisos desligados por padrão ---
let n0=mails.length; await decidir(cA,'ajuste','Corrija a C'); await espera();
ok('Sem ATLAS_AVISOS_ATIVOS, nenhum aviso é enviado', mails.length===n0);
await call('/api/itens/'+cA,{method:'PUT',token:tEdi,body:{dados:{...dados,'alt-c':'C ok'},versao:1}});
env.ATLAS_AVISOS_ATIVOS='1';
n0=mails.length; let r=await decidir(cA,'aprovar','',2); await espera();
ok('Aprovar: aviso ao professor autor', r.status===200 && mails.length===n0+1 && mails.at(-1).tipo==='aviso' && mails.at(-1).email==='edi.franco@grupoideal.com.br' && /aprovada/.test(mails.at(-1).assunto), JSON.stringify(mails.at(-1)));
ok('Aviso leva o segredo e não leva código de login', mails.at(-1).segredo==='segredo-de-teste' && !('codigo' in mails.at(-1)));
n0=mails.length; await decidir(cD,'descartar','Repetida'); await espera();
ok('Descartar: aviso ao professor com o motivo', mails.length===n0+1 && /Repetida/.test(mails.at(-1).texto));
n0=mails.length; await decidir(cV,'ajuste','Revise o gabarito'); await espera();
ok('Ajuste: aviso ao professor com instrução', mails.length===n0+1 && /Corrigir/.test(mails.at(-1).texto));

// --- pedido de conserto (Supervisor) ---
r=await call('/api/supervisor/itens/'+cV+'/conserto',{method:'POST',token:tMarcio,body:{motivo:'Algo'}});
ok('Conserto só para questão aprovada', r.status===409);
r=await call('/api/supervisor/itens/'+cA+'/conserto',{method:'POST',token:tSupQ,body:{motivo:'Algo errado'}});
ok('Supervisor de outra disciplina não pede conserto', r.status===404);
r=await call('/api/supervisor/itens/'+cA+'/conserto',{method:'POST',token:tEdi,body:{motivo:'Algo errado'}});
ok('Professor não pede conserto', r.status===403);
r=await call('/api/supervisor/itens/'+cA+'/conserto',{method:'POST',token:tMarcio,body:{motivo:'x'}});
ok('Pedido sem descrição recusado', r.status===400);
n0=mails.length; r=await call('/api/supervisor/itens/'+cA+'/conserto',{method:'POST',token:tMarcio,body:{motivo:'Erro de digitação na C'}}); await espera();
ok('Supervisor pede conserto; ADM é avisado', r.status===200 && mails.length===n0+1 && mails.at(-1).email==='marinhomalcher@gmail.com', r.data?.error);
r=await call('/api/supervisor/itens/'+cA+'/conserto',{method:'POST',token:tMarcio,body:{motivo:'De novo'}});
ok('Só um pedido pendente por questão', r.status===409);
r=await call('/api/itens/'+cA,{token:tMarcio});
ok('Supervisor vê o pedido pendente no detalhe', r.data.item.consertos.length===1 && r.data.item.consertos[0].situacao==='pendente');
r=await call('/api/supervisor/itens/'+cA,{method:'PUT',token:tMarcio,body:{dados,versao:2}});
ok('Supervisor continua sem editar questão aprovada', r.status===409);

// --- Administração ---
r=await call('/api/adm/consertos',{token:tMarcio});
ok('Rotas de questões da ADM exigem sessão de ADM', r.status===401);
r=await call('/api/adm/itens/'+cA,{token:tEdi});
ok('Professor não usa a busca da ADM', r.status===401);
r=await call('/api/adm/consertos',{token:tAdm});
ok('ADM lista pedidos pendentes', r.status===200 && r.data.consertos.length===1 && r.data.consertos[0].codigo===cA);
const cid=r.data.consertos[0].id;
r=await call('/api/adm/itens/Z9999999',{token:tAdm});
ok('Busca por código inexistente: 404', r.status===404);
r=await call('/api/adm/itens/'+cA,{token:tAdm});
ok('ADM busca qualquer questão pelo código', r.status===200 && r.data.item.codigo===cA && r.data.item.situacao==='aprovado' && r.data.item.consertos.length===1);
r=await call('/api/adm/itens/'+cV,{method:'PUT',token:tAdm,body:{dados,versao:1}});
ok('ADM só corrige questão aprovada', r.status===409);
r=await call('/api/adm/itens/'+cA,{method:'PUT',token:tAdm,body:{dados,versao:1}});
ok('Correção com versão desatualizada recusada', r.status===409);
r=await call('/api/adm/itens/'+cA,{method:'PUT',token:tAdm,body:{dados:{...dados,comando:'<script>x</script>'},versao:2}});
ok('Correção passa pela mesma validação', r.status===400);
n0=mails.length; r=await call('/api/adm/itens/'+cA,{method:'PUT',token:tAdm,body:{dados:{...dados,'alt-c':'C consertada'},versao:2,conserto_id:cid}}); await espera();
ok('ADM corrige: versão 3, continua aprovada', r.status===200 && r.data.item.versao===3 && r.data.item.situacao==='aprovado', r.data?.error);
ok('Pedido marcado como feito; Supervisor avisado', db.prepare('SELECT situacao s FROM consertos WHERE id=?').get(cid).s==='feito' && mails.length===n0+1 && mails.at(-1).email==='marcio.alex@grupoideal.com.br');
const v3=db.prepare("SELECT u.papel p, u.nome n FROM item_versoes v JOIN itens i ON i.id=v.item_id JOIN usuarios u ON u.id=v.autor_id WHERE i.codigo=? AND v.versao=3").get(cA);
ok('Versão 3 registrada como do ADM', v3.p==='adm' && v3.n==='Administrador');
r=await call('/api/itens/meus',{token:tEdi});
ok('Professor vê "corrigida pelo ADM"', r.data.itens.find(i=>i.codigo===cA).corrigida_adm===1 && !r.data.itens.find(i=>i.codigo===cA).editada_supervisor);
r=await call('/api/adm/professores',{token:tAdm});
ok('Registro do Administrador não aparece na lista de professores', !r.data.professores.some(p=>p.nome==='Administrador'));
r=await call('/api/adm/itens/'+cA,{method:'PUT',token:tAdm,body:{dados,versao:3,conserto_id:cid}});
ok('Pedido já resolvido não é reaproveitado', r.status===409);
// recusar
await call('/api/supervisor/itens/'+cA+'/conserto',{method:'POST',token:tMarcio,body:{motivo:'Trocar a figura'}});
const cid2=(await call('/api/adm/consertos',{token:tAdm})).data.consertos[0].id;
r=await call('/api/adm/consertos/'+cid2+'/recusar',{method:'POST',token:tAdm,body:{resposta:''}});
ok('Recusa sem explicação recusada', r.status===400);
n0=mails.length; r=await call('/api/adm/consertos/'+cid2+'/recusar',{method:'POST',token:tAdm,body:{resposta:'A figura está correta'}}); await espera();
ok('ADM recusa pedido; Supervisor avisado com a resposta', r.status===200 && mails.length===n0+1 && /correta/.test(mails.at(-1).texto));
r=await call('/api/adm/consertos/'+cid2+'/recusar',{method:'POST',token:tAdm,body:{resposta:'De novo'}});
ok('Pedido já recusado não é recusado de novo', r.status===409);

// --- desfazer descarte ---
r=await call('/api/adm/itens/'+cD,{token:tAdm});
ok('Descartada há pouco: pode desfazer', r.data.item.pode_desfazer===true && r.data.item.prazo_dias===30 && !!r.data.item.descartado_em);
r=await call('/api/supervisor/itens/'+cD+'/desfazer-descarte',{method:'POST',token:tMarcio,body:{}});
ok('Supervisor não desfaz descarte', r.status===404);
n0=mails.length; r=await call('/api/adm/itens/'+cD+'/desfazer-descarte',{method:'POST',token:tAdm,body:{}}); await espera();
ok('ADM desfaz descarte: volta para análise', r.status===200 && db.prepare('SELECT situacao s FROM itens WHERE codigo=?').get(cD).s==='analise');
ok('Supervisor da disciplina avisado', mails.length===n0+1 && mails.at(-1).email==='marcio.alex@grupoideal.com.br');
r=await call('/api/supervisor/fila?situacao=analise',{token:tMarcio});
ok('Questão reaparece na fila do Supervisor', r.data.itens.some(i=>i.codigo===cD));
r=await call('/api/adm/itens/'+cD+'/desfazer-descarte',{method:'POST',token:tAdm,body:{}});
ok('Desfazer em questão não descartada: 409', r.status===409);
const cVelha=await novo(); await decidir(cVelha,'descartar','Antiga');
db.prepare("UPDATE revisoes SET criado_em='2026-01-01T00:00:00Z' WHERE item_id=(SELECT id FROM itens WHERE codigo=?)").run(cVelha);
r=await call('/api/adm/itens/'+cVelha,{token:tAdm});
ok('Descarte com mais de 30 dias: não pode desfazer', r.data.item.pode_desfazer===false);
r=await call('/api/adm/itens/'+cVelha+'/desfazer-descarte',{method:'POST',token:tAdm,body:{}});
ok('Servidor recusa desfazer após 30 dias', r.status===409 && /30 dias/.test(r.data.error));

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

// Supervisor pede conserto pela tela
await login('Supervisor','marcio.alex');await page.waitForURL(/supervisor\.html/);
await page.click('[data-tab="aprovado"]');await page.waitForFunction(c=>document.querySelector('#list').textContent.includes(c),cA);
ok('Tela Sup: selo "corrigida pelo ADM" na lista', (await page.locator('#list tr',{hasText:cA}).textContent()).includes('corrigida pelo ADM'));
await page.locator('#list tr',{hasText:cA}).locator('button').click();await page.waitForSelector('#details:not([hidden])');
ok('Tela Sup: versões e pedidos aparecem', (await page.textContent('#item-content')).includes('corrigida pelo ADM') && (await page.textContent('#item-content')).includes('não atendido'));
ok('Tela Sup: botão "Solicitar conserto" visível em aprovada', await page.isVisible('#request-fix') && !(await page.isVisible('#edit-item')));
await page.click('#request-fix');await page.fill('#fix-reason','Vírgula faltando no comando');await page.click('#send-fix');
await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('enviado ao administrador'));
await page.waitForSelector('#request-fix',{state:'hidden',timeout:5000}).catch(()=>{});
ok('Tela Sup: pedido enviado e botão some', !(await page.isVisible('#request-fix')) && db.prepare("SELECT COUNT(*) n FROM consertos WHERE situacao='pendente'").get().n===1, (await page.isVisible('#request-fix'))+' '+db.prepare("SELECT COUNT(*) n FROM consertos WHERE situacao='pendente'").get().n);

// ADM: tela de questões
await page.evaluate(()=>sessionStorage.clear());
await page.addInitScript(t=>{try{sessionStorage.setItem('atlas_adm_token',t)}catch{}},tAdm);
await page.goto('https://idealolimpico.com.br/atlas/admin-questoes.html');
await page.waitForFunction(c=>document.querySelector('#fix-list').textContent.includes(c),cA);
ok('Tela ADM: pedido pendente listado', (await page.textContent('#fix-list')).includes('Vírgula faltando'));
await page.locator('#fix-list tr',{hasText:cA}).locator('button').click();await page.waitForSelector('#details:not([hidden])');
ok('Tela ADM: abre a questão com o pedido em destaque', await page.isVisible('#fix-pending') && (await page.textContent('#fix-item'))==='Fazer o conserto');
await page.click('#fix-item');await page.waitForSelector('#edit-form:not([hidden])');await page.waitForSelector('#ed-dificuldade option:nth-child(3)',{state:'attached'});await page.selectOption('#ed-dificuldade','Difícil');
await page.evaluate(()=>document.querySelector('#comando').replaceChildren());await paste('#comando','Comando, com vírgula');
await page.click('#save-edit');await page.waitForFunction(()=>document.querySelector('#app-status').textContent.includes('versão 4'));
ok('Tela ADM: conserto salvo, pedido feito, lista vazia', (await page.textContent('#fix-list')).includes('Nenhum pedido') && db.prepare("SELECT COUNT(*) n FROM consertos WHERE situacao='pendente'").get().n===0);
const d4=JSON.parse(db.prepare('SELECT v.dados FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=? AND v.versao=4').get(cA).dados);
ok('ADM pode mudar a dificuldade no conserto', d4.dificuldade==='Difícil', d4.dificuldade);
ok('Conserto gravado preservando o resto', d4.comando.includes('vírgula') && d4['alt-c']==='C consertada' && d4.assunto==='Romantismo');
// busca + desfazer descarte
await page.fill('#codigo',cVelha.toLowerCase());await page.click('#search-form button');await page.waitForFunction(c=>document.querySelector('#det-title').textContent.includes(c),cVelha);
ok('Tela ADM: busca aceita minúsculas; prazo vencido avisado', (await page.textContent('#undo-note')).includes('já terminou') && !(await page.isVisible('#undo-discard')));
const cNova=await novo(); await decidir(cNova,'descartar','Teste tela');
await page.fill('#codigo',cNova);await page.click('#search-form button');await page.waitForFunction(c=>document.querySelector('#det-title').textContent.includes(c),cNova);
ok('Tela ADM: descarte recente mostra botão e prazo', await page.isVisible('#undo-discard') && (await page.textContent('#undo-note')).includes('restam 30'));
await page.click('#undo-discard');await page.click('#confirm-undo');await page.waitForFunction(()=>document.querySelector('#app-status').textContent.includes('Descarte desfeito'));
ok('Tela ADM: descarte desfeito', db.prepare('SELECT situacao s FROM itens WHERE codigo=?').get(cNova).s==='analise' && (await page.textContent('#det-title')).includes('Em análise'));
await page.fill('#codigo','123');await page.click('#search-form button');
ok('Tela ADM: código incompleto avisado', (await page.textContent('#app-status')).includes('código completo'));
ok('Tela: sem erros de JavaScript nem caixas do navegador', errors.length===0 && dialogs.length===0, errors.join(' ; ')+dialogs.join(';'));
const shotPage=page;await shotPage.goto('https://idealolimpico.com.br/atlas/admin-questoes.html?codigo='+cA);await shotPage.waitForSelector('#details:not([hidden])');await shotPage.screenshot({path:S+'admq.png',fullPage:false});

await browser.close(); server.close();
for (const x of results) console.log(x.join(' | '));
const bad=results.filter(x=>x[0]!=='OK  ').length; console.log(bad?`\n${bad} FALHA(S)`:`\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
