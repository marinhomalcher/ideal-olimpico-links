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
const novo=async (extra)=>(await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,...extra}}})).data.item.codigo;
const cA=await novo({comando:'Autoral aprovada'}), cB=await novo({comando:'Autoral em análise'}), cD=await novo({comando:'Do ENEM',origem:'enem'});
const cE=await novo({comando:'Autoral aprovada fora de prova'});
for(const c of [cA,cE]){const v=(await call('/api/itens/'+c,{token:tMarcio})).data.item.versao_atual;await call('/api/supervisor/itens/'+c+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'aprovar',motivo:'',versao:v}})}
const id=c=>db.prepare('SELECT id FROM itens WHERE codigo=?').get(c)?.id;
const idMarcio=db.prepare("SELECT id FROM usuarios WHERE nome='Márcio Alex'").get().id;
db.exec(`INSERT INTO selecoes (disciplina,supervisor_id,serie,tipo,situacao) VALUES ('Literatura',${idMarcio},1,'REG','enviada')`);
db.exec(`INSERT INTO selecao_itens (selecao_id,item_id,ordem,versao) VALUES (1,${id(cA)},1,1)`);
const idEdi=db.prepare("SELECT id FROM usuarios WHERE nome='Edi Franco'").get().id;
let r=await call('/api/adm/retiradas/previa?usuario='+idEdi,{token:tAdm});
ok('Etapa 1: professor ativo não pode ter questões retiradas', r.status===409&&/desative/.test(r.data.error), r.data?.error);
r=await call('/api/adm/retiradas',{method:'POST',token:tAdm,body:{usuario_id:idEdi,confirmo_desligamento:true,motivo:'desligada em 10/12',nome_confirmacao:'Edi Franco',total_esperado:3}});
ok('Servidor também recusa retirar de professor ativo', r.status===409);
await call('/api/adm/professores/'+idEdi,{method:'PUT',token:tAdm,body:{ativo:false}});
r=await call('/api/adm/retiradas/previa?usuario='+idEdi,{token:tAdm});
ok('Prévia: 3 autorais (ENEM fica de fora), 1 em prova montada, prazo de 6 meses', r.status===200&&r.data.total===3&&r.data.em_selecoes===1&&r.data.por_situacao.aprovado===2&&r.data.prazo_em===somar6(), JSON.stringify(r.data));
function somar6(){const [a,m,d]=(env.ATLAS_HOJE_TESTE||new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date())).split('-').map(Number); /* mesma data fixa que o servidor usa no teste */const t=new Date(Date.UTC(a,m-1+6,1));const u=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+1,0)).getUTCDate();t.setUTCDate(Math.min(d,u));return t.toISOString().slice(0,10)}
const corpo={usuario_id:idEdi,confirmo_desligamento:true,motivo:'desligada em 10/12/2026',nome_confirmacao:'  edi   FRANCO ',total_esperado:3};
r=await call('/api/adm/retiradas',{method:'POST',token:tAdm,body:{...corpo,confirmo_desligamento:false}});ok('Sem confirmar desligamento: recusado', r.status===400);
r=await call('/api/adm/retiradas',{method:'POST',token:tAdm,body:{...corpo,motivo:'x'}});ok('Sem motivo: recusado', r.status===400);
r=await call('/api/adm/retiradas',{method:'POST',token:tAdm,body:{...corpo,nome_confirmacao:'Edi Fraco'}});ok('Nome errado: recusado', r.status===400&&/nome/.test(r.data.error));
r=await call('/api/adm/retiradas',{method:'POST',token:tAdm,body:{...corpo,total_esperado:2}});ok('Total diferente da prévia: recusado', r.status===409);
r=await call('/api/adm/retiradas',{method:'POST',body:corpo});ok('Sem login de ADM: recusado', r.status===401);
r=await call('/api/adm/retiradas',{method:'POST',token:tMarcio,body:corpo});ok('Supervisor não pode retirar', r.status===401||r.status===403);
r=await call('/api/adm/retiradas',{method:'POST',token:tAdm,body:corpo});
ok('Tudo confirmado: retirada criada (nome sem diferenciar maiúsculas/espaços)', r.status===200&&r.data.retirada.total===3, r.data?.error);
const rid=r.data.retirada.id;
const sit=c=>db.prepare('SELECT situacao, retirada_id FROM itens WHERE codigo=?').get(c);
ok('Questões autorais saem do banco (descartadas, marcadas)', sit(cA).situacao==='descartado'&&sit(cB).situacao==='descartado'&&sit(cE).retirada_id===rid);
ok('Questão do ENEM continua no banco', sit(cD).situacao==='analise'&&sit(cD).retirada_id===null);
r=await call('/api/adm/retiradas',{method:'POST',token:tAdm,body:corpo});ok('Segunda retirada do mesmo professor: recusada', r.status===409);
r=await call('/api/adm/itens/'+cB+'/desfazer-descarte',{method:'POST',token:tAdm,body:{}});ok('"Desfazer descarte" comum não devolve questão retirada', r.status===409&&/retirada/i.test(r.data.error), r.data?.error);
r=await call('/api/adm/itens/'+cB,{token:tAdm});ok('Detalhe da questão avisa que foi retirada', r.data.item.retirada===true&&r.data.item.pode_desfazer===false);
r=await call('/api/adm/retiradas/'+rid+'/excluir',{method:'POST',token:tAdm,body:{nome_confirmacao:'Edi Franco',confirmo_exclusao:true}});
ok('Exclusão definitiva bloqueada antes do prazo', r.status===409&&/prazo/.test(r.data.error), r.data?.error);
r=await call('/api/adm/retiradas/'+rid+'/adiar',{method:'POST',token:tAdm,body:{}});ok('Adiar antes do prazo: bloqueado', r.status===409);
r=await call('/api/adm/retiradas/'+rid+'/desfazer',{method:'POST',token:tAdm,body:{nome_confirmacao:'Outro'}});ok('Devolver exige o nome certo', r.status===400);
r=await call('/api/adm/retiradas/'+rid+'/desfazer',{method:'POST',token:tAdm,body:{nome_confirmacao:'Edi Franco'}});
ok('Devolver ao banco: cada questão volta à situação anterior', r.status===200&&sit(cA).situacao==='aprovado'&&sit(cB).situacao==='analise'&&sit(cA).retirada_id===null&&r.data.retirada.situacao==='desfeita');
r=await call('/api/adm/retiradas/'+rid+'/desfazer',{method:'POST',token:tAdm,body:{nome_confirmacao:'Edi Franco'}});ok('Retirada encerrada não aceita nova ação', r.status===409);
// nova retirada e prazo
r=await call('/api/adm/retiradas',{method:'POST',token:tAdm,body:corpo});const rid2=r.data.retirada.id;const prazo=r.data.retirada.prazo_em;
const promessas=[];const ctx={waitUntil:p=>promessas.push(p)};
const rodarCron=async()=>{promessas.length=0;await worker.scheduled({},env,ctx);await Promise.allSettled(promessas);await new Promise(r=>setTimeout(r,50))};
let m0=mails.length;await rodarCron();
ok('Antes do prazo: nenhum e-mail ao ADM', !mails.slice(m0).some(m=>/exclusão definitiva/.test(m.assunto||'')));
env.ATLAS_HOJE_TESTE=prazo;m0=mails.length;await rodarCron();
const aviso=mails.slice(m0).find(m=>/exclusão definitiva/.test(m.assunto||''));
ok('No prazo: e-mail ao ADM perguntando se exclui (mesmo com avisos desligados)', aviso&&aviso.email===env.ADMIN_EMAIL&&/Edi Franco/.test(aviso.assunto), JSON.stringify(mails.slice(m0)).slice(0,160));
m0=mails.length;await rodarCron();ok('E-mail não se repete no dia seguinte', !mails.slice(m0).some(m=>/exclusão definitiva/.test(m.assunto||'')));
r=await call('/api/adm/retiradas',{token:tAdm});ok('Lista marca a retirada como vencida', r.data.retiradas.find(x=>x.id===rid2).vencida===true);
r=await call('/api/adm/retiradas/'+rid2+'/adiar',{method:'POST',token:tAdm,body:{}});
ok('Adiar 3 meses', r.status===200&&r.data.retirada.prazo_em>prazo&&r.data.retirada.vencida===false, JSON.stringify(r.data.retirada));
const prazo2=r.data.retirada.prazo_em;env.ATLAS_HOJE_TESTE=prazo2;m0=mails.length;await rodarCron();
ok('No novo prazo: novo e-mail ao ADM', mails.slice(m0).some(m=>/exclusão definitiva/.test(m.assunto||'')));
r=await call('/api/adm/retiradas/'+rid2+'/excluir',{method:'POST',token:tAdm,body:{nome_confirmacao:'Edi Franco'}});ok('Excluir sem marcar "não pode ser desfeito": recusado', r.status===400);
r=await call('/api/adm/retiradas/'+rid2+'/excluir',{method:'POST',token:tAdm,body:{nome_confirmacao:'Edi',confirmo_exclusao:true}});ok('Excluir com nome errado: recusado', r.status===400);
await new Promise(r=>setTimeout(r,1100));const nb=[...r2store.keys()].filter(k=>k.startsWith('backups/')).length;
env.ATLAS_HOJE_TESTE='2026-11-13';
r=await call('/api/adm/retiradas/'+rid2+'/excluir',{method:'POST',token:tAdm,body:{nome_confirmacao:'Edi Franco',confirmo_exclusao:true}});
ok('Exclusão continua bloqueada se a data voltar para antes do prazo', r.status===409);
env.ATLAS_HOJE_TESTE=prazo2;
r=await call('/api/adm/retiradas/'+rid2+'/excluir',{method:'POST',token:tAdm,body:{nome_confirmacao:'Edi Franco',confirmo_exclusao:true}});
ok('Exclusão definitiva feita', r.status===200&&r.data.retirada.situacao==='excluida', r.data?.error);
ok('Cópia de segurança feita antes de apagar', [...r2store.keys()].filter(k=>k.startsWith('backups/')).length===nb+1);
ok('Questões fora de provas foram apagadas (com versões e revisões)', !id(cB)&&!id(cE)&&db.prepare('SELECT COUNT(*) n FROM item_versoes v WHERE NOT EXISTS (SELECT 1 FROM itens i WHERE i.id=v.item_id)').get().n===0&&db.prepare('SELECT COUNT(*) n FROM revisoes r WHERE NOT EXISTS (SELECT 1 FROM itens i WHERE i.id=r.item_id)').get().n===0);
ok('Questão que está em prova montada foi mantida', !!id(cA)&&r.data.retirada.detalhe.mantidas.includes(cA)&&r.data.retirada.detalhe.excluidas===2, JSON.stringify(r.data.retirada.detalhe));
ok('Questão do ENEM intacta', !!id(cD));
r=await call('/api/health');
// ===== tela =====
env.ATLAS_HOJE_TESTE='2026-11-13';
db.exec("INSERT INTO usuarios (nome,email,disciplina,papel,ativo) VALUES ('Prof Saiu','prof.saiu@grupoideal.com.br','Química','professor',1)");
const tSaiu=await tok('prof.saiu@grupoideal.com.br');
for(const k of [1,2])await call('/api/itens',{method:'POST',token:tSaiu,body:{dados:{...base,assunto:'Química Geral',comando:'Q autoral '+k}}});
const idSaiu=db.prepare("SELECT id FROM usuarios WHERE nome='Prof Saiu'").get().id;
await call('/api/adm/professores/'+idSaiu,{method:'PUT',token:tAdm,body:{ativo:false}});
const server = http.createServer(async (req, res) => { const chunks=[]; for await (const c of req) chunks.push(c); const request=new Request('https://atlas-api.test'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD','OPTIONS'].includes(req.method)?undefined:Buffer.concat(chunks)}); const response=await worker.fetch(request,env); res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(8795);
const browser=await chromium.launch(); const bctx=await browser.newContext({viewport:{width:1280,height:900}});
await bctx.route('https://idealolimpico.com.br/atlas/**', route=>{const f=new URL(route.request().url()).pathname.replace('/atlas/','')||'index.html';const p=REPO+'atlas/'+f;if(!fs.existsSync(p))return route.fulfill({status:404,body:'nf'});route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'image/png',body:fs.readFileSync(p)})});
await bctx.route('https://accounts.google.com/**', r2=>r2.fulfill({status:200,contentType:'application/javascript',body:'window.google={accounts:{id:{initialize(){},renderButton(){},disableAutoSelect(){}}}}'}));
await bctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route=>{const u=route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev','http://localhost:8795');const resp=await route.fetch({url:u,headers:{...route.request().headers(),origin:ORIGIN}});route.fulfill({response:resp})});
const page=await bctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.dismiss()});
await page.goto('https://idealolimpico.com.br/atlas/admin.html');await page.evaluate(t=>sessionStorage.setItem('atlas_adm_token',t),tAdm);await page.reload();await page.waitForSelector('#list table');
const linha=page.locator('tr',{hasText:'Prof Saiu'});
ok('Tela: professor desativado tem o botão Retirar questões autorais', await linha.locator('.retirar').count()===1);
ok('Tela: professor ativo não tem o botão', await page.locator('tr',{hasText:'Felipe Augusto'}).locator('.retirar').count()===0);
ok('Tela: retiradas antigas listadas no painel', (await page.textContent('#ret-lista')).includes('Edi Franco'));
await linha.locator('.retirar').click();await page.waitForSelector('#r1-chk');
ok('Etapa 1 mostra o total', (await page.textContent('#r1-txt')).includes('2 questão'));
await page.click('text=Continuar');ok('Etapa 1 exige a confirmação', (await page.textContent('#ret-corpo .field-error')).includes('Marque'));
await page.check('#r1-chk');await page.fill('#r1-motivo','desligado em 12/11/2026');await page.click('text=Continuar');await page.waitForSelector('#r2-input');
ok('Etapa 2: Continuar desabilitado até o nome conferir', await page.isDisabled('#r2-ok'));
await page.fill('#r2-input','Prof Sai');ok('Nome incompleto continua desabilitado', await page.isDisabled('#r2-ok'));
await page.fill('#r2-input','prof saiu');await page.click('#r2-ok');await page.waitForSelector('#r3-ok');
ok('Etapa 3: botão final começa travado (contagem)', await page.isDisabled('#r3-ok')&&(await page.textContent('#r3-hint')).includes('devolvê-las'));
await page.screenshot({path:S+'retirada-etapa3.png'});
await page.waitForFunction(()=>!document.querySelector('#r3-ok').disabled,{timeout:8000});await page.click('#r3-ok');
await page.waitForFunction(()=>document.querySelector('#app-status').textContent.includes('retiradas do banco'));
ok('Tela: retirada feita e listada', (await page.textContent('#ret-lista')).includes('Prof Saiu')&&db.prepare('SELECT COUNT(*) n FROM itens WHERE retirada_id IS NOT NULL AND autor_id='+idSaiu).get().n===2);
// vencida → alerta
db.exec("UPDATE retiradas SET prazo_em='2020-01-01' WHERE usuario_id="+idSaiu);await page.reload();await page.waitForSelector('.ret-alerta');
ok('Tela: prazo vencido mostra alerta no topo com as 3 opções', (await page.textContent('.ret-alerta')).includes('Excluir definitivamente')&&(await page.textContent('.ret-alerta')).includes('Adiar 3 meses'));
await page.screenshot({path:S+'retirada-alerta.png'});
await page.click('.ret-alerta >> text=Devolver ao banco');await page.fill('#ra-input','Prof Saiu');await page.click('#ra-ok');
await page.waitForFunction(()=>document.querySelector('#app-status').textContent.includes('devolvidas'));
ok('Tela: devolver pelo alerta', db.prepare('SELECT COUNT(*) n FROM itens WHERE retirada_id IS NOT NULL AND autor_id='+idSaiu).get().n===0&&!(await page.$('.ret-alerta')));
ok('Sem erros de JavaScript', errors.length===0, errors.join(' | '));ok('Nenhum alert/confirm', dialogs.length===0);
await browser.close();server.close();
for(const [s,n,e] of results)console.log(s,n,e?'— '+e:'');
console.log(results.filter(r=>r[0]!=='OK  ').length+' falha(s) de '+results.length);
process.exit(0);
