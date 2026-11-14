// Questões sem disciplina: código X até a aprovação, "Não sei a disciplina" (digitador), devolver ao ADM (supervisor) e ADM define a disciplina.
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
// 1) "Não sei a disciplina" (digitador)
r=await call('/api/itens/digitador',{method:'POST',token:tHel,body:{disciplina:'Sem disciplina',dados:C('Questão de disciplina desconhecida')}});
ok('Digitador envia com "Não sei a disciplina"', r.status===200&&r.data.item.disciplina==='Sem disciplina', JSON.stringify(r.data));
const xSem=r.data.item.codigo;
ok('Código provisório começa com X', /^X\d{7}$/.test(xSem), xSem);
r=await call('/api/adm/itens/enviar',{method:'POST',token:tAdm,body:{disciplina:'Sem disciplina',dados:C('ADM não usa Não sei')}});
ok('ADM não pode enviar "Sem disciplina"', r.status===400, r.status);
// 2) digitador e ADM com disciplina: também X
r=await call('/api/itens/digitador',{method:'POST',token:tHel,body:{disciplina:'Matemática',dados:C('Questão que não é de Matemática')}});
const xMat=r.data.item.codigo;
ok('Digitador com disciplina: código X e vai para a disciplina', /^X\d{7}$/.test(xMat)&&r.data.item.disciplina==='Matemática', JSON.stringify(r.data));
r=await call('/api/adm/itens/enviar',{method:'POST',token:tAdm,body:{disciplina:'Matemática',dados:C('Questão do ADM de Matemática')}});
const xAdm=r.data.item.codigo;
ok('ADM com disciplina: código X', /^X\d{7}$/.test(xAdm), xAdm);
r=await call('/api/itens',{method:'POST',token:tAndrey,body:{dados:{etapa:'em',origem:'autoral',dificuldade:'Média',assunto:'Funções',bloom:'Aplicar',...C('Questão do professor Andrey')}}});
const mProf=r.data.item.codigo;
ok('Professor continua com a letra da disciplina', /^M\d{7}$/.test(mProf), mProf);
// 3) filas
r=await call('/api/supervisor/fila?situacao=analise',{token:tSupMat});
let cods=r.data.itens.map(i=>i.codigo);
ok('Fila do Supervisor de Matemática tem as X de Matemática e não a sem disciplina', cods.includes(xMat)&&cods.includes(xAdm)&&!cods.includes(xSem), cods.join(','));
r=await call('/api/supervisor/fila?situacao=analise',{token:tMarcio});
ok('Outra disciplina não vê nenhuma delas', !r.data.itens.some(i=>[xSem,xMat,xAdm].includes(i.codigo)));
r=await call('/api/adm/sem-disciplina',{token:tAdm});
ok('ADM: lista "Sem disciplina" tem 1 questão, do digitador', r.status===200&&r.data.itens.length===1&&r.data.itens[0].codigo===xSem&&r.data.itens[0].autor_tipo==='digitador'&&!r.data.itens[0].devolvida_de, JSON.stringify(r.data.itens));
ok('ADM: lista traz o início do comando e as disciplinas', (r.data.itens[0].comando||'').includes('desconhecida')&&r.data.disciplinas.includes('Química'));
r=await call('/api/adm/sem-disciplina',{token:tSupMat});ok('Lista "Sem disciplina" é só do ADM', r.status===401||r.status===403, r.status);
// 4) devolver ao ADM
const verDe=async c=>(await call('/api/adm/itens/'+c,{token:tAdm})).data.item.versao_atual;
r=await call('/api/supervisor/itens/'+mProf+'/devolver-adm',{method:'POST',token:tSupMat,body:{versao:1}});
ok('Questão de professor não pode ser devolvida', r.status===409, r.status);
r=await call('/api/supervisor/itens/'+xMat+'/devolver-adm',{method:'POST',token:tMarcio,body:{versao:1}});
ok('Supervisor de outra disciplina não devolve', r.status===404, r.status);
r=await call('/api/supervisor/itens/'+xMat+'/devolver-adm',{method:'POST',token:tSupMat,body:{versao:99}});
ok('Devolver com versão antiga é recusado', r.status===409, r.status);
r=await call('/api/supervisor/itens/'+xMat+'/devolver-adm',{method:'POST',token:tSupMat,body:{versao:await verDe(xMat)}});
ok('Supervisor devolve questão do digitador ao ADM', r.status===200&&r.data.item.disciplina==='Sem disciplina', JSON.stringify(r.data));
r=await call('/api/supervisor/fila?situacao=analise',{token:tSupMat});
ok('Devolvida sai da fila do supervisor', !r.data.itens.some(i=>i.codigo===xMat));
r=await call('/api/adm/sem-disciplina',{token:tAdm});
const dev=r.data.itens.find(i=>i.codigo===xMat);
ok('ADM vê a devolvida, com de onde veio e quem devolveu', r.data.itens.length===2&&dev&&dev.devolvida_de==='Matemática'&&dev.devolvida_por==='Sup Mat', JSON.stringify(dev));
r=await call('/api/supervisor/itens/'+xMat+'/devolver-adm',{method:'POST',token:tSupMat,body:{versao:1}});
ok('Não dá para devolver de novo (não é mais da disciplina)', r.status===404, r.status);
// 5) ADM define a disciplina
r=await call('/api/adm/itens/'+xSem+'/disciplina',{method:'POST',token:tAdm,body:{disciplina:'Astrologia'}});
ok('ADM: disciplina inválida é recusada', r.status===400);
r=await call('/api/adm/itens/'+xSem+'/disciplina',{method:'POST',token:tAdm,body:{disciplina:'Matemática'}});
ok('ADM define a disciplina', r.status===200&&r.data.item.disciplina==='Matemática', JSON.stringify(r.data));
r=await call('/api/adm/itens/'+xSem+'/disciplina',{method:'POST',token:tAdm,body:{disciplina:'Física'}});
ok('Não redefine questão que já tem disciplina', r.status===409);
r=await call('/api/supervisor/fila?situacao=analise',{token:tSupMat});
ok('Questão definida entra na fila do supervisor (ainda com X)', r.data.itens.some(i=>i.codigo===xSem));
r=await call('/api/adm/sem-disciplina',{token:tAdm});ok('Lista do ADM diminui', r.data.itens.length===1);
// 6) aprovação: X vira a letra da disciplina, mesmos números
const classificar=c=>db.exec("UPDATE item_versoes SET dados=json_set(dados,'$.assunto','Funções','$.bloom','Aplicar','$.dificuldade','Média','$.tags',json('[\"teste\",\"x\"]')) WHERE item_id=(SELECT id FROM itens WHERE codigo='"+c+"')");
classificar(xSem);
r=await call('/api/supervisor/itens/'+xSem+'/decisao',{method:'POST',token:tSupMat,body:{decisao:'aprovar',versao:await verDe(xSem)}});
ok('Aprovação troca o X pela letra M, com os mesmos números', r.status===200&&r.data.item.codigo==='M'+xSem.slice(1), JSON.stringify(r.data));
ok('No banco, a questão aprovada tem o código definitivo', db.prepare("SELECT situacao FROM itens WHERE codigo=?").get('M'+xSem.slice(1))?.situacao==='aprovado');
r=await call('/api/adm/itens/'+xSem,{token:tAdm});
ok('Busca pelo código antigo (X) ainda acha a questão', r.status===200&&r.data.item.codigo==='M'+xSem.slice(1), r.status);
ok('Histórico guarda o código anterior', !!db.prepare("SELECT 1 FROM eventos WHERE acao='codigo_definitivo' AND json_extract(detalhe,'$.anterior')=?").get(xSem));
r=await call('/api/itens/meus',{token:tHel});
ok('Lista do digitador já mostra o código definitivo', r.data.itens.some(i=>i.codigo==='M'+xSem.slice(1))&&!r.data.itens.some(i=>i.codigo===xSem));
// colisão: se o código definitivo já existir, sorteia números novos
const autorId=db.prepare("SELECT id FROM usuarios WHERE email='andrey.uchoa@grupoideal.com.br'").get().id;
db.exec("INSERT INTO itens (codigo,disciplina,autor_id,situacao) VALUES ('M"+xAdm.slice(1)+"','Matemática',"+autorId+",'descartado')");
classificar(xAdm);
r=await call('/api/supervisor/itens/'+xAdm+'/decisao',{method:'POST',token:tSupMat,body:{decisao:'aprovar',versao:await verDe(xAdm)}});
const novo=r.data?.item?.codigo||'';
ok('Choque de código: aprova com números novos, letra M', r.status===200&&/^M\d{7}$/.test(novo)&&novo!=='M'+xAdm.slice(1), novo);
ok('Números do código novo não existem em outra letra', db.prepare('SELECT COUNT(*) AS n FROM itens WHERE substr(codigo,2)=?').get(novo.slice(1)).n===1);
// descartar mantém o X
r=await call('/api/itens/digitador',{method:'POST',token:tHel,body:{disciplina:'Matemática',dados:C('Questão para descartar')}});
const xDesc=r.data.item.codigo;
r=await call('/api/supervisor/itens/'+xDesc+'/decisao',{method:'POST',token:tSupMat,body:{decisao:'descartar',motivo:'Não serve',versao:1}});
ok('Descarte mantém o código X', r.status===200&&r.data.item.codigo===xDesc, JSON.stringify(r.data));
// repetida: "Sem disciplina" compara com o banco todo
r=await call('/api/itens/digitador',{method:'POST',token:tHel,body:{disciplina:'Sem disciplina',dados:C('Questão do professor Andrey')}});
ok('Sem disciplina: aviso de repetida considera todas as disciplinas', r.status===409&&(r.data.repetidas||[]).some(x=>x.codigo===mProf), r.status+' '+JSON.stringify(r.data).slice(0,120));
// relatório: questões sem disciplina contam para o digitador
r=await call('/api/adm/relatorio?ano=2026',{token:tAdm});
const linhaHel=(r.data.linhas||[]).find(l=>/Helio/.test(l.nome||''));
ok('Relatório "Todos" conta também a questão que espera disciplina', linhaHel&&linhaHel.total===3, JSON.stringify(linhaHel).slice(0,150));
// ================= telas =================
const server = http.createServer(async (req, res) => { const chunks=[]; for await (const c of req) chunks.push(c); const request=new Request('https://atlas-api.test'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD','OPTIONS'].includes(req.method)?undefined:Buffer.concat(chunks)}); const response=await worker.fetch(request,env); res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(8796);
const K=S+'katexpkg/package/dist/';
const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:1280,height:900}});
await ctx.route('https://idealolimpico.com.br/atlas/**', route=>{const f=new URL(route.request().url()).pathname.replace('/atlas/','')||'index.html';const p=REPO+'atlas/'+f;if(!fs.existsSync(p))return route.fulfill({status:404,body:'nf'});route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'image/png',body:fs.readFileSync(p)})});
await ctx.route('https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/**', r2=>{const p=new URL(r2.request().url()).pathname.replace('/npm/katex@0.19.1/dist/','');r2.fulfill({status:200,headers:{'content-type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'font/'+p.split('.').pop(),'access-control-allow-origin':'*'},body:fs.readFileSync(K+p)})});
await ctx.route('https://accounts.google.com/**', r2=>r2.fulfill({status:200,contentType:'application/javascript',body:'window.google={accounts:{id:{initialize(){},renderButton(){},disableAutoSelect(){}}}}'}));
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route=>{const u=route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev','http://localhost:8796');const resp=await route.fetch({url:u,headers:{...route.request().headers(),origin:ORIGIN}});route.fulfill({response:resp})});
const page=await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.dismiss()});
const paste=(sel,text)=>page.evaluate(([sel,text])=>{const el=document.querySelector(sel);el.focus();const dt=new DataTransfer();dt.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},[sel,text]);
async function loginVia(card,user){db.exec('DELETE FROM login_rate_limits');await page.evaluate(()=>{try{sessionStorage.clear();localStorage.clear()}catch{}}).catch(()=>{});await page.goto('https://idealolimpico.com.br/atlas/');await page.click(`[data-role="${card}"]`);await page.fill('#email',user);await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');await page.fill('#code',lastCode());await page.click('#verifyButton')}
// digitador: "Não sei a disciplina"
await loginVia('Professor','helio.santos');await page.waitForURL(/digitador\.html/);await page.waitForSelector('#es-form');
ok('Tela Dig: lista tem "Não sei a disciplina (o ADM define)"', (await page.$$eval('#es-disciplina option',o=>o.map(x=>x.textContent))).includes('Não sei a disciplina (o ADM define)'));
await page.selectOption('#es-disciplina','Sem disciplina');
await paste('#comando','Questão digitada sem saber a matéria');await paste('#alt-a','A) um\nB) dois\nC) três\nD) quatro\nE) cinco');await page.selectOption('#es-gabarito','C');
await page.click('#es-enviar');await page.waitForSelector('#es-previa:not([hidden])');
ok('Tela Dig: prévia diz "Disciplina a definir pelo ADM"', (await page.textContent('#es-previa')).includes('Disciplina a definir pelo ADM'));
await page.click('#es-enviar');await page.waitForSelector('#es-ok:not([hidden])');
ok('Tela Dig: mensagem diz que foi para o ADM', (await page.textContent('#es-ok')).includes('enviada ao ADM'), await page.textContent('#es-ok'));
await page.selectOption('#es-disciplina','Matemática');
await paste('#comando','Questão de Matemática digitada na tela');await paste('#alt-a','A) um\nB) dois\nC) três\nD) quatro\nE) cinco');await page.selectOption('#es-gabarito','A');
await page.click('#es-enviar');await page.waitForSelector('#es-previa:not([hidden])');await page.click('#es-enviar');await page.waitForFunction(()=>/Matemática/.test(document.querySelector('#es-ok').textContent));
ok('Tela Dig: com disciplina, vai para o supervisor (sem mostrar código)', (await page.textContent('#es-ok')).includes('Supervisor de Matemática')&&!/Código/.test(await page.textContent('#es-ok')));
const xTela=db.prepare("SELECT i.codigo FROM itens i JOIN item_versoes v ON v.item_id=i.id WHERE json_extract(v.dados,'$.comando') LIKE '%digitada na tela%'").get().codigo;
// supervisor: devolver ao ADM
await loginVia('Supervisor','sup.mat');await page.waitForURL(/supervisor\.html/);await page.waitForFunction(()=>typeof openItem==='function');
await page.waitForTimeout(300);await page.evaluate(c=>openItem(c),mProf);await page.waitForSelector('#details:not([hidden])');
ok('Tela Sup: questão de professor não tem "Devolver ao ADM"', await page.isHidden('#devolver-adm'));
await page.click('#back');await page.evaluate(c=>openItem(c),xTela);await page.waitForSelector('#details:not([hidden])');
ok('Tela Sup: questão do digitador tem "Devolver ao ADM"', await page.isVisible('#devolver-adm'));
await page.click('#devolver-adm');
ok('Tela Sup: pede confirmação na própria página', await page.isVisible('#devolver-confirm'));
await page.click('#confirm-devolver');await page.waitForSelector('#details',{state:'hidden'});
ok('Tela Sup: devolvida e some da fila', db.prepare('SELECT disciplina FROM itens WHERE codigo=?').get(xTela).disciplina==='Sem disciplina');
// ADM: aviso no painel e definir disciplina
await page.goto('https://idealolimpico.com.br/atlas/admin.html');await page.evaluate(t=>sessionStorage.setItem('atlas_adm_token',t),tAdm);await page.reload();
await page.waitForSelector('#sem-disc-aviso:not([hidden])');
ok('Tela ADM: painel avisa quantas questões esperam disciplina', /3 questões sem disciplina/.test(await page.textContent('#sem-disc-aviso')), await page.textContent('#sem-disc-aviso'));
await page.goto('https://idealolimpico.com.br/atlas/admin-questoes.html');await page.waitForSelector('#sem-disc-list table');
ok('Tela ADM: quadro "Questões sem disciplina" lista 3', (await page.$$('#sem-disc-list tbody tr')).length===3&&(await page.textContent('#sem-disc-n'))==='3');
ok('Tela ADM: mostra quem devolveu', (await page.textContent('#sem-disc-list')).includes('Devolvida pelo supervisor de Matemática (Sup Mat)'));
await page.locator('#sem-disc-list tbody tr',{hasText:'digitada na tela'}).locator('button').click();await page.waitForSelector('#definir-box:not([hidden])');
ok('Tela ADM: abrir mostra a escolha da disciplina', await page.isVisible('#definir-disc'));
await page.click('#definir-enviar');await page.waitForTimeout(150);
ok('Tela ADM: sem escolher, pede a disciplina', /Escolha a disciplina/.test(await page.textContent('#app-status')));
await page.selectOption('#definir-disc','Física');await page.click('#definir-enviar');await page.waitForFunction(()=>/Supervisor de Física/.test(document.querySelector('#app-status').textContent));
ok('Tela ADM: enviada ao supervisor certo e lista atualizada', db.prepare('SELECT disciplina FROM itens WHERE codigo=?').get(xTela).disciplina==='Física'&&(await page.$$('#sem-disc-list tbody tr')).length===2);
await page.screenshot({path:S+'sem-disciplina.png',fullPage:true});
ok('Sem erros de JavaScript nas telas', errors.length===0, errors.join(' | '));
ok('Nenhum alert/confirm', dialogs.length===0, dialogs.join('|'));
await browser.close();server.close();
for(const [s,n,e] of results)console.log(s,n,e?'— '+e:'');
console.log(results.filter(r=>r[0]!=='OK  ').length+' falha(s) de '+results.length);
process.exit(0);
