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
const L=(await import('node:assert')).default;
const tAdm=(await call('/api/adm/login',{method:'POST',body:{credential:await jwt({})}})).data.token;
const q=(cmd,extra={})=>({etapa:'em',origem:'autoral',dificuldade:'Média',assunto:'Barroco',bloom:'Aplicar',comando:cmd,'alt-a':'A1','alt-b':'B1','alt-c':'C1','alt-d':'D1','alt-e':'E1',gabarito:'A',...extra});
const dadosDe=(c,v)=>JSON.parse(db.prepare('SELECT v.dados FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=?'+(v?' AND v.versao='+v:' AND v.versao=i.versao_atual')).get(c).dados);
const decidir=(c,decisao,versao=1,motivo='')=>call('/api/supervisor/itens/'+c+'/decisao',{method:'POST',token:tMarcio,body:{decisao,motivo,versao}});
// ---- grupo ----
let r=await call('/api/itens/grupo',{method:'POST',token:tEdi,body:{texto:{'texto-base':'Texto do soneto de Gregório.',referencia:'MATOS, G. Poemas.'},itens:[q('Q1')]}});
ok('Grupo com 1 questão recusado', r.status===400);
r=await call('/api/itens/grupo',{method:'POST',token:tEdi,body:{texto:{'texto-base':''},itens:[q('Q1'),q('Q2')]}});
ok('Grupo sem texto-base recusado', r.status===400);
r=await call('/api/itens/grupo',{method:'POST',token:tEdi,body:{texto:{'texto-base':'Texto do soneto de Gregório.',referencia:'MATOS, G. Poemas.'},itens:[q('Sobre o soneto, 1'),q('Sobre o soneto, 2',{gabarito:'C'})]}});
const G=r.data?.grupo; const [g1,g2]=G?.itens||[];
ok('Grupo criado: código G+letra+6 dígitos e 2 questões', r.status===200 && /^GL\d{6}$/.test(G.codigo) && G.itens.length===2 && G.itens.every(c=>/^L\d{7}$/.test(c)), JSON.stringify(r.data));
ok('Questão do grupo guarda texto-base vazio (texto fica no grupo)', dadosDe(g1)['texto-base']==='' && dadosDe(g2).gabarito==='C');
r=await call('/api/itens/'+g2,{token:tMarcio});
ok('Ao abrir, o texto do grupo vem junto e mostra as irmãs', r.data.item.dados['texto-base']==='Texto do soneto de Gregório.' && r.data.item.dados.referencia==='MATOS, G. Poemas.' && r.data.item.grupo.codigo===G.codigo && r.data.item.grupo.membros.length===2);
r=await call('/api/supervisor/fila?situacao=analise',{token:tMarcio});
ok('Fila mostra o código do grupo', r.data.itens.find(i=>i.codigo===g1).grupo_codigo===G.codigo);
// supervisor muda o texto (nenhuma aprovada ainda)
let d1=(await call('/api/itens/'+g1,{token:tMarcio})).data.item.dados;
r=await call('/api/supervisor/itens/'+g1,{method:'PUT',token:tMarcio,body:{dados:{...d1,'texto-base':'Texto do soneto revisado.'},versao:1}});
ok('Supervisor muda o texto do grupo (antes de aprovar)', r.status===200, r.data?.error);
r=await call('/api/itens/'+g2,{token:tMarcio});
ok('A mudança vale para a questão irmã', r.data.item.dados['texto-base']==='Texto do soneto revisado.' && r.data.item.versao_atual===1);
ok('Texto do grupo ganhou versão 2', db.prepare('SELECT versao_atual v FROM grupos WHERE codigo=?').get(G.codigo).v===2);
await decidir(g1,'aprovar',2);
let d2=(await call('/api/itens/'+g2,{token:tMarcio})).data.item.dados;
r=await call('/api/supervisor/itens/'+g2,{method:'PUT',token:tMarcio,body:{dados:{...d2,'texto-base':'Outro texto'},versao:1}});
ok('Com uma questão do grupo aprovada, Supervisor não muda o texto', r.status===409 && /conserto/.test(r.data.error), r.data?.error);
r=await call('/api/supervisor/itens/'+g2,{method:'PUT',token:tMarcio,body:{dados:{...d2,'alt-e':'E corrigida'},versao:1}});
ok('Mas edita o resto da questão normalmente', r.status===200);
await decidir(g2,'ajuste',2,'Revise a alternativa B');
d2=(await call('/api/itens/'+g2,{token:tEdi})).data.item.dados;
r=await call('/api/itens/'+g2,{method:'PUT',token:tEdi,body:{dados:{...d2,'texto-base':'Professor muda texto'},versao:2}});
ok('Professor também não muda o texto compartilhado com aprovada', r.status===409);
r=await call('/api/itens/'+g2,{method:'PUT',token:tEdi,body:{dados:{...d2,'alt-b':'B corrigida'},versao:2}});
ok('Professor reenvia a correção sem mexer no texto', r.status===200);
// banco: grupo só entra completo
const sel=(await call('/api/supervisor/selecoes',{method:'POST',token:tMarcio,body:{serie:1,tipo:'REG'}})).data.selecao.id;
r=await call('/api/supervisor/banco?selecao='+sel,{token:tMarcio});
ok('Grupo incompleto (uma em análise) não aparece no banco', !r.data.itens.some(i=>i.codigo===g1));
await decidir(g2,'aprovar',3);
r=await call('/api/supervisor/banco?selecao='+sel+'&q=soneto, 2',{token:tMarcio});
ok('Grupo completo aparece inteiro, mesmo se a busca pega só uma', r.data.itens.filter(i=>i.grupo&&i.grupo.codigo===G.codigo).length===2 && r.data.itens.find(i=>i.codigo===g1).grupo.total===2, JSON.stringify(r.data.itens.map(i=>i.codigo)));
const solta=(await call('/api/itens',{method:'POST',token:tEdi,body:{dados:q('Questão solta do banco')}})).data.item.codigo;await decidir(solta,'aprovar');
r=await call('/api/supervisor/selecoes/'+sel,{method:'PUT',token:tMarcio,body:{itens:[g1,solta]}});
ok('Seleção com só parte do grupo é recusada', r.status===409 && r.data.error.includes(g2));
r=await call('/api/supervisor/selecoes/'+sel,{method:'PUT',token:tMarcio,body:{itens:[g2,solta,g1]}});
let ord=(await call('/api/supervisor/selecoes/'+sel,{token:tMarcio})).data.selecao.itens.map(i=>i.codigo);
ok('Grupo fica junto e na ordem do grupo', r.status===200 && JSON.stringify(ord)===JSON.stringify([g1,g2,solta]), JSON.stringify(ord));
await call('/api/supervisor/selecoes/'+sel+'/enviar',{method:'POST',token:tMarcio,body:{}});
ok('Envio congela a versão do texto do grupo', db.prepare('SELECT grupo_versao v FROM selecao_itens si JOIN itens i ON i.id=si.item_id WHERE i.codigo=?').get(g1).v===2);
// ADM conserta o texto do grupo depois do envio
let da=(await call('/api/adm/itens/'+g1,{token:tAdm})).data.item;
ok('ADM vê o grupo na questão', da.grupo.codigo===G.codigo);
r=await call('/api/adm/itens/'+g1,{method:'PUT',token:tAdm,body:{dados:{...da.dados,'texto-base':'Texto consertado pelo ADM.'},versao:da.versao_atual}});
ok('ADM pode mudar o texto mesmo com questões aprovadas', r.status===200, r.data?.error);
ok('Irmã aprovada já mostra o texto consertado', (await call('/api/itens/'+g2,{token:tMarcio})).data.item.dados['texto-base']==='Texto consertado pelo ADM.');
r=await call('/api/adm/selecoes/'+sel,{token:tAdm});
ok('Seleção enviada mostra o texto da versão enviada', r.data.selecao.itens[0].dados['texto-base']==='Texto do soneto revisado.' && r.data.selecao.itens[0].grupo.versao===2);
// grupo com uma descartada continua utilizável
r=await call('/api/itens/grupo',{method:'POST',token:tEdi,body:{texto:{'texto-base':'Texto do mapa de biomas brasileiros.'},itens:[q('Bioma 1'),q('Bioma 2'),q('Bioma 3')]}});
const [b1,b2,b3]=r.data.grupo.itens;await decidir(b1,'aprovar');await decidir(b2,'descartar',1,'Fraca');await decidir(b3,'aprovar');
const sel2=(await call('/api/supervisor/selecoes',{method:'POST',token:tMarcio,body:{serie:2,tipo:'MED'}})).data.selecao.id;
r=await call('/api/supervisor/banco?selecao='+sel2+'&q=Bioma',{token:tMarcio});
ok('Grupo com uma descartada entra com as aprovadas', r.data.itens.filter(i=>i.grupo).map(i=>i.codigo).sort().join()===[b1,b3].sort().join(), JSON.stringify(r.data.itens.map(i=>i.codigo)));
// ---- repetidas ----
const igual=q('Qual é a capital do Pará?',{'alt-a':'Belém','texto-base':'<p>Mapa da região Norte.</p>'});
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:igual}});const rp1=r.data.item.codigo;
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...igual,comando:'<b>Qual  é a capital do  Para?</b>','texto-base':'Mapa da regiao Norte'}}});
ok('Repetida detectada mesmo com formatação, acento e espaços diferentes', r.status===409 && r.data.repetidas?.[0]?.codigo===rp1, JSON.stringify(r.data));
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...igual},confirmar_repetida:true}});const rp2=r.data?.item?.codigo;
ok('Com confirmação, a repetida é enviada', r.status===200);
r=await call('/api/itens/'+rp2,{token:tMarcio});
ok('Supervisor vê o aviso de repetida no detalhe', r.data.item.repetidas.some(x=>x.codigo===rp1));
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...igual,'alt-e':'Outra alternativa'}}});
ok('Questão com uma alternativa diferente não é tratada como repetida', r.status===200);
db.exec('UPDATE itens SET assinatura=NULL');
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...igual}}});
ok('Questões antigas (sem assinatura) também são comparadas', r.status===409 && r.data.repetidas.length>=2);
r=await call('/api/supervisor/fila?situacao=analise',{token:tMarcio});
ok('Fila marca possível repetida', r.data.itens.find(i=>i.codigo===rp1)?.tem_repetida===1 || r.data.itens.find(i=>i.codigo===rp1)?.tem_repetida===true, JSON.stringify(r.data.itens.find(i=>i.codigo===rp1)));
await decidir(rp2,'descartar',1,'Repetida');
r=await call('/api/itens/'+rp1,{token:tMarcio});
ok('Descartada não conta como repetida', !r.data.item.repetidas.some(x=>x.codigo===rp2));
r=await call('/api/itens/grupo',{method:'POST',token:tEdi,body:{texto:{'texto-base':'<p>Texto consertado pelo ADM.</p>'},itens:[q('Sobre o soneto, 1'),q('Nova')]}});
ok('Grupo também avisa repetida (comparando com o texto do grupo)', r.status===409 && r.data.repetidas.some(x=>x.codigo===g1), r.status+' '+JSON.stringify(r.data?.repetidas));
r=await call('/api/itens',{method:'POST',token:tSupQ,body:{dados:{...igual}}});
ok('Outra disciplina não conta como repetida', r.status===200);

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
await login('Professor','edi.franco');await page.waitForURL(/professor\.html/);await page.waitForFunction(()=>!document.querySelector('#questao-form').hidden);
await page.check('input[name="modo"][value="grupo"]');
await page.waitForTimeout(500);await page.locator('.modo-cadastro').screenshot({path:S+'modo.png'});
ok('Tela: modo grupo mostra o painel e muda os textos', await page.isVisible('#grupo-painel') && (await page.textContent('#enviar'))==='Enviar grupo para análise');
async function preencherQ(cmd,gab){await page.selectOption('#assunto','Romantismo');const subs=await page.$$eval('#subtema option',o=>o.map(x=>x.value).filter(Boolean));if(subs.length)await page.selectOption('#subtema',subs[0]);
  await page.selectOption('#origem','autoral');await page.selectOption('#dificuldade','Fácil');await page.selectOption('#bloom','Lembrar');await paste('#comando',cmd);for(const l of 'abcde')await paste('#alt-'+l,cmd+' opção '+l);await page.selectOption('#gabarito',gab)}
await preencherQ('Pergunta um do poema','A');
await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#grupo-adicionar');
ok('Tela: sem texto-base, não adiciona ao grupo', (await page.textContent('#status')).includes('texto-base é obrigatório') && (await page.textContent('#grupo-qtd'))==='(0)');
await paste('#texto-base','Poema de Gonçalves Dias para as questões.');await page.click('[data-ref-para="referencia"]');await page.fill('#referencia','DIAS, G. Canção do exílio.');
await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#grupo-adicionar');
ok('Tela: questão 1 adicionada e campos da questão limpos (texto fica)', (await page.textContent('#grupo-qtd'))==='(1)' && (await page.textContent('#comando'))==='' && (await page.textContent('#texto-base')).includes('Gonçalves Dias'));
await paste('#comando','Pergunta dois do poema');for(const l of 'abcde')await paste('#alt-'+l,'Dois opção '+l);await page.selectOption('#gabarito','D');
await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#visualizar');await page.waitForSelector('#previsao:not([hidden])');
const pv=await page.textContent('#previsao');
ok('Tela: Visualizar adiciona a questão em edição e mostra o grupo com texto uma vez', (await page.textContent('#grupo-qtd'))==='(2)' && pv.includes('Texto para as questões 1 a 2') && pv.split('Gonçalves Dias').length===2 && pv.includes('Questão 2'));
await page.locator('#grupo-lista .grupo-item').nth(1).getByText('Editar').click();
ok('Tela: Editar devolve a questão aos campos', (await page.textContent('#comando')).includes('Pergunta dois') && (await page.textContent('#grupo-qtd'))==='(1)');
await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#grupo-adicionar');
await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#enviar');await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#enviar');
await page.waitForFunction(()=>/Grupo GL\d{6} enviado/.test(document.querySelector('#status').textContent),null,{timeout:8000}).catch(()=>{});
const st=await page.textContent('#status');const GT=(st.match(/GL\d{6}/)||[])[0];
ok('Tela: grupo enviado com 2 códigos', !!GT && (st.match(/L\d{7}/g)||[]).length===2, st);
const gv=JSON.parse(db.prepare('SELECT v.dados FROM grupo_versoes v JOIN grupos g ON g.id=v.grupo_id WHERE g.codigo=?').get(GT).dados);
ok('Tela: texto e referência guardados no grupo', gv['texto-base'].includes('Gonçalves Dias') && gv.referencia==='DIAS, G. Canção do exílio.');
// repetida pela tela (questão única)
await page.check('input[name="modo"][value="unica"]');
await preencherQ('Pergunta um do poema','A');await paste('#texto-base','Poema de Gonçalves Dias para as questões.');
for(const l of 'abcde'){await page.evaluate(id=>document.querySelector(id).replaceChildren(),'#alt-'+l);await paste('#alt-'+l,'Pergunta um do poema opção '+l)}
await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#enviar');await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#enviar');await page.waitForSelector('#repetida-box:not([hidden])');
ok('Tela: aviso de possível repetida com o código', (await page.textContent('#repetida-texto')).includes('L'));
const antes=db.prepare('SELECT COUNT(*) n FROM itens').get().n;
await page.click('#repetida-enviar');await page.waitForFunction(()=>/Código: L\d{7}/.test(document.querySelector('#status').textContent),null,{timeout:8000}).catch(()=>{});
ok('Tela: Enviar mesmo assim envia', db.prepare('SELECT COUNT(*) n FROM itens').get().n===antes+1, await page.textContent('#status'));
await login('Supervisor','marcio.alex');await page.waitForURL(/supervisor\.html/);await page.waitForFunction(()=>document.querySelectorAll('#list tbody tr').length>0);
await page.locator('#list tr:has(.selo-repetida)').first().screenshot({path:S+'selo.png'}).catch(()=>{});
const linhaG=page.locator('#list tr',{hasText:GT}).first();
ok('Tela Sup: fila mostra o grupo', await linhaG.count()>0);
await linhaG.locator('button').click();await page.waitForSelector('#details:not([hidden])');
const det=await page.textContent('#item-content');
ok('Tela Sup: detalhe mostra o grupo e o texto compartilhado', det.includes('Grupo '+GT) && det.includes('Gonçalves Dias') && det.includes('possível questão repetida'));
await page.locator('.alerta-repetida').screenshot({path:S+'alerta.png'});
const codRep=await page.$eval('.alerta-repetida .cod-rep',b=>b.dataset.cod);await page.click('.alerta-repetida .cod-rep');await page.waitForFunction(c=>document.querySelector('#item-content').textContent.includes(c+' (versão')||document.querySelector('#item-content .meta').textContent.includes(c),codRep);
ok('Tela Sup: clicar no código abre a outra questão', (await page.textContent('#item-content .meta')).includes(codRep));

// seleção pela tela com o grupo
const membrosT=db.prepare('SELECT i.codigo c FROM itens i JOIN grupos g ON g.id=i.grupo_id WHERE g.codigo=? ORDER BY i.ordem_grupo').all(GT).map(x=>x.c);
for(const c of membrosT)await decidir(c,'aprovar');
await page.goto('https://idealolimpico.com.br/atlas/supervisor-selecoes.html');await page.waitForSelector('#lista');
await page.click('#nova');await page.check('input[name=serie][value="3"]');await page.check('input[name=tipo][value="REG"]');await page.click('#nova-form button[type=submit]');
await page.waitForSelector('#sel-view:not([hidden])');await page.fill('#f-q','poema');await page.waitForFunction(()=>document.querySelectorAll('#banco .grupo-bloco').length>0);
ok('Tela Sel: grupo aparece como bloco no banco', (await page.locator('#banco .grupo-bloco',{hasText:GT}).textContent()).includes('2 questões com o mesmo texto-base'));
await page.locator('#banco .grupo-bloco',{hasText:GT}).getByText('Adicionar o grupo').click();await page.waitForFunction(()=>document.querySelector('#savestate').textContent==='Salvo');
ok('Tela Sel: Adicionar o grupo coloca as 2 questões juntas', (await page.textContent('#qtd'))==='2' && (await page.textContent('#escolhidas')).includes('texto compartilhado pelas questões 1 a 2'));
const idSel=Number(new URL(page.url()).searchParams.get('id'));
const naSel=db.prepare('SELECT i.codigo c FROM selecao_itens si JOIN itens i ON i.id=si.item_id WHERE selecao_id=? ORDER BY ordem').all(idSel).map(x=>x.c);
ok('Tela Sel: salvo na ordem do grupo', JSON.stringify(naSel)===JSON.stringify(membrosT), JSON.stringify(naSel));
await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#enviar');await page.click('#confirmar-envio');await page.waitForSelector('#editor-bloco',{state:'hidden'});
await page.evaluate(()=>sessionStorage.clear());await page.addInitScript(t=>{try{sessionStorage.setItem('atlas_adm_token',t)}catch{}},tAdm);
await page.goto('https://idealolimpico.com.br/atlas/admin-selecoes.html?id='+idSel);await page.waitForSelector('#details:not([hidden])');
const corpo=await page.textContent('#det-corpo');
ok('Tela ADM: texto do grupo aparece uma vez, com "Texto para as questões 1 a 2"', corpo.includes('Texto para as questões 1 a 2') && corpo.split('Gonçalves Dias').length===2, corpo.split('Gonçalves Dias').length);
await page.screenshot({path:S+'grupo-adm.png'});
ok('Sem erros de JavaScript nem caixas do navegador', errors.length===0 && dialogs.length===0, errors.join(' | '));
await browser.close(); server.close();
for (const x of results) console.log(x.join(' | '));
const bad=results.filter(x=>x[0]!=='OK  ').length; console.log(bad?`\n${bad} FALHA(S)`:`\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
