// Classificadores (força-tarefa): cadastro, "Próxima questão" com reserva, salvar, devolver, fila do supervisor e relatório.
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
// ----- cadastro do digitador -----
let r=await call('/api/adm/professores',{method:'POST',token:tAdm,body:{nome:'Helio Junho de Souza Santos',email:'helio.santos',digitador:true,acesso_ate:'2099-12-31'}});
ok('ADM cadastra digitador sem disciplina e com prazo', r.status===200, JSON.stringify(r.data).slice(0,150));
const hel=r.data.professores.find(p=>p.email==='helio.santos@grupoideal.com.br');
ok('Lista traz digitador=true e acesso_ate', hel&&hel.digitador===true&&hel.acesso_ate==='2099-12-31'&&hel.disciplina===null, JSON.stringify(hel));
r=await call('/api/adm/supervisor',{method:'POST',token:tAdm,body:{disciplina:'Química',usuario_id:hel.id}});
ok('Digitador não pode virar supervisor', r.status===400);
r=await call('/api/adm/professores',{method:'POST',token:tAdm,body:{nome:'X',email:'x@gmail.com',digitador:true}});
ok('Digitador também só com @grupoideal.com.br', r.status===400);
const tHel=await tok('helio.santos@grupoideal.com.br');
ok('Digitador recebe código e entra', !!tHel);
r=await call('/api/login/sessao',{token:tHel});
ok('Sessão do digitador tem papel "digitador"', r.data?.usuario?.papel==='digitador', JSON.stringify(r.data));
// ================= servidor =================
const C=(cmd)=>({comando:cmd,'alt-a':'um','alt-b':'dois','alt-c':'três','alt-d':'quatro','alt-e':'cinco',gabarito:'B'});
const tSupMat=await tok('sup.mat@grupoideal.com.br');
const tAndrey=await tok('andrey.uchoa@grupoideal.com.br');
// cadastro
r=await call('/api/adm/professores',{method:'POST',token:tAdm,body:{nome:'Clara Class',email:'clara.class',disciplina:'Matemática',classificador:true}});
ok('ADM cadastra professor classificador', r.status===200&&r.data.professores.find(p=>p.email==='clara.class@grupoideal.com.br')?.classificador===true, JSON.stringify(r.data).slice(0,120));
r=await call('/api/adm/professores',{method:'POST',token:tAdm,body:{nome:'Caio Class',email:'caio.class',disciplina:'Matemática',classificador:true}});
const caioId=r.data.id;
r=await call('/api/adm/professores',{method:'POST',token:tAdm,body:{nome:'Dig Class',email:'dig.class',digitador:true,classificador:true}});
ok('Digitador nunca é classificador', r.data.professores.find(p=>p.email==='dig.class@grupoideal.com.br')?.classificador===false);
const tClara=await tok('clara.class@grupoideal.com.br'), tCaio=await tok('caio.class@grupoideal.com.br');
r=await call('/api/login/sessao',{token:tClara});ok('Sessão traz a marca de classificador', r.data.usuario.classificador===1&&r.data.usuario.papel==='professor');
r=await call('/api/classificar/resumo',{token:tAndrey});ok('Professor sem a marca não entra na classificação', r.status===403);
r=await call('/api/classificar/resumo',{token:tSupMat});ok('Supervisor não usa a área do classificador', r.status===403);
r=await call('/api/classificar/resumo',{token:tHel});ok('Digitador não usa a área do classificador', r.status===403);
// questões para classificar
const envia=async(disc,cmd)=>(await call('/api/itens/digitador',{method:'POST',token:tHel,body:{disciplina:disc,dados:C(cmd)}})).data.item.codigo;
const qA=await envia('Matemática','Questão A para classificar');db.exec("UPDATE itens SET criado_em='2026-11-01T10:00:00Z' WHERE codigo='"+qA+"'");
const qB=await envia('Matemática','Questão B para classificar');db.exec("UPDATE itens SET criado_em='2026-11-02T10:00:00Z' WHERE codigo='"+qB+"'");
const qC=await envia('Matemática','Questão C para classificar');db.exec("UPDATE itens SET criado_em='2026-11-03T10:00:00Z' WHERE codigo='"+qC+"'");
await envia('Física','Questão de Física');
r=await call('/api/itens',{method:'POST',token:tAndrey,body:{dados:{etapa:'em',origem:'autoral',dificuldade:'',assunto:'',bloom:'',...C('Questão do professor sem classificação')}}});
r=await call('/api/classificar/resumo',{token:tClara});
ok('Resumo: 3 de Matemática esperando (não conta Física nem professor)', r.data.restantes===3&&r.data.minhas===0, JSON.stringify(r.data));
// próxima questão + reservas
r=await call('/api/classificar/proxima',{method:'POST',token:tClara,body:{}});
ok('Clara recebe a mais antiga (A), com os dados', r.data.item?.codigo===qA&&r.data.item.dados.comando.includes('Questão A')&&!!r.data.reserva_ate, r.data.item?.codigo);
const verA=r.data.item.versao_atual;
r=await call('/api/classificar/proxima',{method:'POST',token:tCaio,body:{}});
ok('Caio recebe outra (B): ninguém pega a mesma', r.data.item?.codigo===qB, r.data.item?.codigo);
r=await call('/api/classificar/proxima',{method:'POST',token:tClara,body:{}});
ok('Clara pedindo de novo continua com a A (reserva dela)', r.data.item?.codigo===qA);
ok('Cada um tem uma reserva só', db.prepare('SELECT COUNT(*) AS n FROM reservas').get().n===2);
// salvar
const cls={assunto:'Funções',bloom:'Aplicar',dificuldade:'Média',tags:['funções','gráficos']};
r=await call('/api/classificar/itens/'+qA,{method:'POST',token:tClara,body:{versao:verA,dados:{...C('Questão A para classificar')}}});
ok('Sem classificação não salva', r.status===400, r.data?.error);
r=await call('/api/classificar/itens/'+qA,{method:'POST',token:tClara,body:{versao:verA,dados:{...C('Questão A para classificar'),assunto:'Funções',bloom:'Aplicar',dificuldade:'Média',tags:['só uma']}}});
ok('Com menos de 2 tags não salva', r.status===400, r.data?.error);
r=await call('/api/classificar/itens/'+qA,{method:'POST',token:tCaio,body:{versao:verA,dados:{...C('x'),...cls}}});
ok('Quem não reservou não salva', r.status===409, r.data?.error);
r=await call('/api/classificar/itens/'+qA,{method:'POST',token:tClara,body:{versao:verA,dados:{...C('Questão A para classificar, corrigida'),...cls,etapa:'ef2',origem:'enem'}}});
ok('Clara salva a classificação e corrige o comando', r.status===200&&r.data.item.mudou.includes('Comando')&&r.data.minhas===1, JSON.stringify(r.data));
const dA=JSON.parse(db.prepare("SELECT v.dados FROM itens i JOIN item_versoes v ON v.item_id=i.id AND v.versao=i.versao_atual WHERE i.codigo=?").get(qA).dados);
ok('Classificação gravada; etapa e origem não mudam', dA.assunto==='Funções'&&dA.bloom==='Aplicar'&&dA.dificuldade==='Média'&&dA.etapa==='em'&&dA.origem==='acervo', JSON.stringify({e:dA.etapa,o:dA.origem}));
ok('Questão continua em análise (classificador não aprova)', db.prepare('SELECT situacao FROM itens WHERE codigo=?').get(qA).situacao==='analise');
r=await call('/api/classificar/resumo',{token:tClara});
ok('Classificada sai da lista (sobra só a C livre)', r.data.restantes===1, JSON.stringify(r.data));
r=await call('/api/supervisor/itens/'+qA+'/decisao',{method:'POST',token:tClara,body:{decisao:'aprovar',versao:verA+1}});
ok('Classificador não tem acesso à aprovação', r.status===403, r.status);
// devolver ao ADM
r=await call('/api/classificar/itens/'+qB+'/devolver-adm',{method:'POST',token:tCaio,body:{versao:1}});
ok('Classificador devolve ao ADM', r.status===200&&db.prepare('SELECT disciplina FROM itens WHERE codigo=?').get(qB).disciplina==='Sem disciplina');
ok('Devolver libera a reserva', !db.prepare('SELECT 1 FROM reservas WHERE usuario_id=?').get(caioId));
// reserva vencida
r=await call('/api/classificar/proxima',{method:'POST',token:tClara,body:{}});
ok('Clara pega a C', r.data.item?.codigo===qC);
db.exec("UPDATE reservas SET expira_em=1 WHERE item_id=(SELECT id FROM itens WHERE codigo='"+qC+"')");
r=await call('/api/classificar/proxima',{method:'POST',token:tCaio,body:{}});
ok('Reserva vencida: outra pessoa pode pegar', r.data.item?.codigo===qC, r.data.item?.codigo);
r=await call('/api/classificar/itens/'+qC,{method:'POST',token:tClara,body:{versao:1,dados:{...C('Questão C para classificar'),...cls}}});
ok('Quem perdeu a reserva não salva', r.status===409);
r=await call('/api/classificar/liberar',{method:'POST',token:tCaio,body:{}});
ok('"Parar por agora" libera a reserva', r.status===200&&!db.prepare('SELECT 1 FROM reservas WHERE usuario_id=?').get(caioId));
// supervisor
r=await call('/api/supervisor/fila?situacao=analise',{token:tSupMat});
ok('Fila do supervisor: a classificada vem primeiro, com quem classificou', r.data.itens[0]?.codigo===qA&&r.data.itens[0].classificada_por==='Clara Class'&&!r.data.itens[0].classificar, JSON.stringify(r.data.itens.map(i=>i.codigo+':'+i.classificada_por)));
r=await call('/api/itens/'+qA,{token:tSupMat});
ok('Detalhe mostra quem classificou e o que mudou', r.data.item.classificacao?.por==='Clara Class'&&r.data.item.classificacao.mudou.includes('Comando')&&r.data.item.versoes.some(v=>v.pelo_classificador), JSON.stringify(r.data.item.classificacao));
r=await call('/api/supervisor/itens/'+qA+'/decisao',{method:'POST',token:tSupMat,body:{decisao:'aprovar',versao:verA+1}});
ok('Supervisor aprova a classificada (vira M)', r.status===200&&r.data.item.codigo==='M'+qA.slice(1), JSON.stringify(r.data));
// relatório
r=await call('/api/adm/relatorio?ano=2026',{token:tAdm});
const lc=r.data.linhas.find(l=>l.nome==='Clara Class');
ok('Relatório conta as classificadas', lc&&lc.classificadas===1&&r.data.totais.classificadas===1, JSON.stringify(lc).slice(0,160));
r=await call('/api/adm/relatorio?ano=2026&recorte=professor&valor='+lc.id,{token:tAdm});
ok('Relatório por pessoa também conta', r.data.linhas[0].classificadas===1);
// tirar a marca
await call('/api/classificar/proxima',{method:'POST',token:tCaio,body:{}});
r=await call('/api/adm/professores/'+caioId,{method:'PUT',token:tAdm,body:{classificador:false}});
ok('ADM tira a marca: reservas dele somem', r.status===200&&!db.prepare('SELECT 1 FROM reservas WHERE usuario_id=?').get(caioId));
r=await call('/api/classificar/resumo',{token:tCaio});ok('Sem a marca, não entra mais', r.status===403);
// ================= telas =================
const server = http.createServer(async (req, res) => { const chunks=[]; for await (const c of req) chunks.push(c); const request=new Request('https://atlas-api.test'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD','OPTIONS'].includes(req.method)?undefined:Buffer.concat(chunks)}); const response=await worker.fetch(request,env); res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(8797);
const K=S+'katexpkg/package/dist/';
const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:1280,height:900}});
await ctx.route('https://idealolimpico.com.br/atlas/**', route=>{const f=new URL(route.request().url()).pathname.replace('/atlas/','')||'index.html';const p=REPO+'atlas/'+f;if(!fs.existsSync(p))return route.fulfill({status:404,body:'nf'});route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'image/png',body:fs.readFileSync(p)})});
await ctx.route('https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/**', r2=>{const p=new URL(r2.request().url()).pathname.replace('/npm/katex@0.19.1/dist/','');r2.fulfill({status:200,headers:{'content-type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'font/'+p.split('.').pop(),'access-control-allow-origin':'*'},body:fs.readFileSync(K+p)})});
await ctx.route('https://accounts.google.com/**', r2=>r2.fulfill({status:200,contentType:'application/javascript',body:'window.google={accounts:{id:{initialize(){},renderButton(){},disableAutoSelect(){}}}}'}));
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route=>{const u=route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev','http://localhost:8797');const resp=await route.fetch({url:u,headers:{...route.request().headers(),origin:ORIGIN}});route.fulfill({response:resp})});
const page=await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.dismiss()});
async function loginVia(card,user){db.exec('DELETE FROM login_rate_limits');await page.evaluate(()=>{try{sessionStorage.clear();localStorage.clear()}catch{}}).catch(()=>{});await page.goto('https://idealolimpico.com.br/atlas/');await page.click(`[data-role="${card}"]`);await page.fill('#email',user);await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');await page.fill('#code',lastCode());await page.click('#verifyButton')}
const qD=await envia('Matemática','Questão D na tela');
await loginVia('Professor','clara.class');await page.waitForURL(/professor\.html/);await page.waitForSelector('#link-classificar:not([hidden])');
await page.waitForFunction(()=>/esperando classificação/.test(document.querySelector('#link-classificar-n').textContent));
ok('Tela Prof: classificador vê o cartão da força-tarefa com a contagem', /2 questões esperando/.test(await page.textContent('#link-classificar-n')), await page.textContent('#link-classificar-n'));
await page.click('#link-classificar');await page.waitForURL(/classificar\.html/);await page.waitForFunction(()=>document.querySelector('#cl-restantes').textContent!=='–');
ok('Tela Class: mostra disciplina e contagem', (await page.textContent('#cl-disc'))==='Matemática'&&(await page.textContent('#cl-restantes'))==='2'&&(await page.textContent('#cl-minhas'))==='1');
await page.click('#cl-proxima');await page.waitForSelector('#cl-form:not([hidden])');await page.waitForSelector('#cl-assunto option:nth-child(2)',{state:'attached'});
ok('Tela Class: abre a questão mais antiga, com o texto nos campos', (await page.textContent('#comando')).includes('Questão C'), await page.textContent('#comando'));
ok('Tela Class: avisa até quando a questão está reservada', /reservada para você até/.test(await page.textContent('#notice')));
await page.click('#cl-salvar');await page.waitForTimeout(150);
ok('Tela Class: sem classificação, pede o que falta', /Escolha o assunto/.test(await page.textContent('#cl-erro')));
const ass=await page.$$eval('#cl-assunto option',o=>o.map(x=>x.value).filter(Boolean));await page.selectOption('#cl-assunto',ass[0]);
const subs=await page.$$eval('#cl-subtema option',o=>o.map(x=>x.value).filter(Boolean));if(subs.length)await page.selectOption('#cl-subtema',subs[0]);
await page.selectOption('#cl-bloom','Aplicar');await page.selectOption('#cl-dificuldade','Fácil');
await page.click('#cl-salvar');await page.waitForTimeout(150);
ok('Tela Class: pede 2 tags', /2 tags/.test(await page.textContent('#cl-erro')));
await page.evaluate(()=>tagsEdit.set(['tela','teste']));
await page.click('#cl-salvar');await page.waitForFunction(()=>/Classificação salva/.test(document.querySelector('#notice').textContent));
ok('Tela Class: salva e já traz a próxima (D)', (await page.textContent('#comando')).includes('Questão D')&&(await page.textContent('#cl-minhas'))==='2', await page.textContent('#notice'));
ok('Tela Class: gravou no banco', db.prepare("SELECT COUNT(*) AS n FROM eventos e JOIN itens i ON i.id=e.item_id WHERE e.acao='item_classificado' AND i.codigo=?").get(qC).n===1);
await page.locator('#cl-form').screenshot({path:S+'classificar.png'});
await page.click('#cl-devolver');ok('Tela Class: devolver pede confirmação na página', await page.isVisible('#cl-devolver-confirm'));
await page.click('#cl-devolver-cancelar');
await page.click('#cl-parar');await page.waitForFunction(()=>/liberada/.test(document.querySelector('#notice').textContent));
ok('Tela Class: "Parar por agora" libera e fecha', await page.isHidden('#cl-form')&&!db.prepare("SELECT 1 FROM reservas r JOIN itens i ON i.id=r.item_id WHERE i.codigo=?").get(qD));
await loginVia('Professor','andrey.uchoa');await page.waitForURL(/professor\.html/);await page.waitForTimeout(400);
ok('Tela Prof: professor comum não vê o cartão', await page.isHidden('#link-classificar'));
await page.goto('https://idealolimpico.com.br/atlas/classificar.html');await page.waitForURL(/professor\.html/);
ok('Tela: professor comum que abre classificar.html volta para a sua área', page.url().endsWith('professor.html'));
// supervisor
await loginVia('Supervisor','sup.mat');await page.waitForURL(/supervisor\.html/);await page.waitForSelector('.selo-pronta');
ok('Tela Sup: selo "pronta para aprovar" na fila', (await page.textContent('.selo-pronta')).includes('pronta para aprovar'));
await page.evaluate(c=>openItem(c),qC);await page.waitForSelector('#details:not([hidden])');
ok('Tela Sup: aviso de quem classificou', (await page.textContent('.aviso-pronta')).includes('Clara Class'));
// ADM
await page.goto('https://idealolimpico.com.br/atlas/admin.html');await page.evaluate(t=>sessionStorage.setItem('atlas_adm_token',t),tAdm);await page.reload();await page.waitForSelector('table');
ok('Tela ADM: lista marca o classificador', (await page.textContent('body')).includes('Classificador'));
await page.click('#add');ok('Tela ADM: cadastro tem a opção Classificador', await page.isVisible('#is-classificador'));
await page.check('#is-digitador');ok('Tela ADM: digitador esconde a opção Classificador', await page.isHidden('#is-classificador'));
await page.click('#cancel');
await page.goto('https://idealolimpico.com.br/atlas/admin-relatorio.html');await page.waitForSelector('table.rel');
ok('Tela Relatório: coluna Classif.', (await page.textContent('table.rel thead')).includes('Classif.'));
ok('Sem erros de JavaScript nas telas', errors.length===0, errors.join(' | '));
ok('Nenhum alert/confirm', dialogs.length===0, dialogs.join('|'));
await browser.close();server.close();
for(const [s,n,e] of results)console.log(s,n,e?'— '+e:'');
console.log(results.filter(r=>r[0]!=='OK  ').length+' falha(s) de '+results.length);
process.exit(0);
