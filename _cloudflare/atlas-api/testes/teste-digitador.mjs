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
// ----- envio do digitador -----
const conteudo={origem:'outros',fonte:'IDEAL 2023',comando:'Quanto é 2+2?','alt-a':'1','alt-b':'2','alt-c':'3','alt-d':'4','alt-e':'5',gabarito:'D',assunto:'Tentativa',bloom:'Aplicar',dificuldade:'Fácil'};
r=await call('/api/itens/digitador',{method:'POST',token:tHel,body:{disciplina:'Matemática',dados:conteudo}});
ok('Digitador envia sem classificação', r.status===200&&r.data.item.disciplina==='Matemática', JSON.stringify(r.data).slice(0,150));
const cH=r.data.item.codigo;
let dv=JSON.parse(db.prepare('SELECT v.dados FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=?').get(cH).dados);
ok('Classificação, fonte e tags do digitador são ignoradas; origem = acervo', !dv.assunto&&!dv.bloom&&!dv.dificuldade&&dv.fonte===''&&dv.origem==='acervo'&&dv.tags.length===0, JSON.stringify(dv).slice(0,160));
r=await call('/api/itens/digitador',{method:'POST',token:tHel,body:{disciplina:'Matemática',dados:conteudo}});
ok('Repetida é detectada no envio do digitador', r.status===409&&Array.isArray(r.data.repetidas), r.status);
r=await call('/api/itens/digitador',{method:'POST',token:tHel,body:{disciplina:'Astrologia',dados:{...conteudo,comando:'outra'}}});
ok('Disciplina inválida recusada', r.status===400);
r=await call('/api/itens',{method:'POST',token:tHel,body:{dados:{...conteudo,comando:'via rota normal'}}});
ok('Digitador não usa a rota do professor', r.status===403);
r=await call('/api/supervisor/fila?situacao=analise',{token:tHel});
ok('Digitador não abre a área do Supervisor', r.status===403);
r=await call('/api/itens/meus',{token:tHel});
ok('Digitador vê Minhas questões', r.status===200&&r.data.itens.some(i=>i.codigo===cH));
// ----- envio do ADM -----
const mailsAntes=mails.length;
r=await call('/api/adm/itens/enviar',{method:'POST',token:tAdm,body:{disciplina:'Literatura',dados:{...conteudo,comando:'Questão antiga de Literatura'}}});
ok('ADM envia questão sem classificação', r.status===200, JSON.stringify(r.data).slice(0,150));
const cA=r.data.item.codigo;
r=await call('/api/adm/itens/enviar',{method:'POST',body:{disciplina:'Literatura',dados:conteudo}});
ok('Envio do ADM exige login', r.status===401);
// ----- supervisor -----
r=await call('/api/supervisor/fila?situacao=analise',{token:tMarcio});
let it=r.data.itens.find(i=>i.codigo===cA);
ok('Fila do Supervisor marca "classificar" e autor ADM', it&&it.classificar===1&&it.autor_tipo==='adm', JSON.stringify(it).slice(0,200));
let det=(await call('/api/itens/'+cA,{token:tMarcio})).data.item;
r=await call('/api/supervisor/itens/'+cA+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'aprovar',motivo:'',versao:det.versao_atual}});
ok('Aprovar sem classificação é bloqueado', r.status===409&&/Classifique/.test(r.data.error), r.data?.error);
r=await call('/api/supervisor/itens/'+cA+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'ajuste',motivo:'corrigir',versao:det.versao_atual}});
ok('Pedir ajuste em questão do ADM é bloqueado', r.status===409);
r=await call('/api/supervisor/itens/'+cA,{method:'PUT',token:tMarcio,body:{dados:{...det.dados,assunto:'Romantismo',bloom:'Analisar',tags:['romantismo','prova antiga']},versao:det.versao_atual}});
ok('Supervisor classifica parcialmente (sem dificuldade) e salva', r.status===200, r.data?.error);
det=(await call('/api/itens/'+cA,{token:tMarcio})).data.item;
r=await call('/api/supervisor/itens/'+cA+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'aprovar',motivo:'',versao:det.versao_atual}});
ok('Ainda sem dificuldade: aprovação continua bloqueada', r.status===409);
r=await call('/api/supervisor/itens/'+cA,{method:'PUT',token:tMarcio,body:{dados:{...det.dados,dificuldade:'Difícil',tags:['só uma']},versao:det.versao_atual}});
det=(await call('/api/itens/'+cA,{token:tMarcio})).data.item;
r=await call('/api/supervisor/itens/'+cA+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'aprovar',motivo:'',versao:det.versao_atual}});
ok('Questão do ADM com menos de 2 tags: aprovação bloqueada', r.status===409&&/2 tags/.test(r.data.error), r.data?.error);
r=await call('/api/supervisor/itens/'+cA,{method:'PUT',token:tMarcio,body:{dados:{...det.dados,tags:['romantismo','prova antiga']},versao:det.versao_atual}});
det=(await call('/api/itens/'+cA,{token:tMarcio})).data.item;
ok('Supervisor define a dificuldade quando estava vazia e a origem continua acervo', r.status===200&&det.dados.dificuldade==='Difícil'&&det.dados.origem==='acervo', r.data?.error);
r=await call('/api/supervisor/itens/'+cA+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'aprovar',motivo:'',versao:det.versao_atual}});
ok('Classificada: aprovação liberada', r.status===200, r.data?.error);
r=await call('/api/supervisor/itens/'+cA,{method:'PUT',token:tMarcio,body:{dados:{...det.dados,dificuldade:'Fácil'},versao:det.versao_atual}});
ok('Sem e-mail ao "autor" ADM', mails.length===mailsAntes, mails.length-mailsAntes);
// ----- relatório -----
const tEdi=await tok('edi.franco@grupoideal.com.br');
const base={etapa:'em',origem:'autoral',dificuldade:'Média',assunto:'Romantismo',bloom:'Aplicar',comando:'C','alt-a':'A','alt-b':'B','alt-c':'C','alt-d':'D','alt-e':'E',gabarito:'A'};
const cs=[];for(let k=0;k<3;k++){r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,comando:'Edi '+k}}});cs.push(r.data.item.codigo)}
db.exec("UPDATE itens SET criado_em='2026-03-10T15:00:00Z' WHERE codigo='"+cs[0]+"'");
db.exec("UPDATE itens SET criado_em='2026-01-01T02:00:00Z' WHERE codigo='"+cs[1]+"'"); // 31/12/2025 23h em Brasília
let v=(await call('/api/itens/'+cs[2],{token:tMarcio})).data.item.versao_atual;
await call('/api/supervisor/itens/'+cs[2]+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'ajuste',motivo:'arrume',versao:v}});
let a=(await call('/api/itens/'+cs[2],{token:tEdi})).data.item;
r=await call('/api/itens/'+cs[2],{method:'PUT',token:tEdi,body:{dados:{...a.dados,comando:'Edi 2 corrigida'},versao:a.versao_atual}});
ok('Professor reenvia correção', r.status===200, r.data?.error);
v=(await call('/api/itens/'+cs[0],{token:tMarcio})).data.item.versao_atual;
await call('/api/supervisor/itens/'+cs[0]+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'descartar',motivo:'fora do padrão',versao:v}});
const mesAtual=Number(new Intl.DateTimeFormat('en',{timeZone:'America/Sao_Paulo',month:'numeric'}).format(new Date()));
r=await call('/api/adm/relatorio?ano=2026',{token:tAdm});
ok('Relatório geral responde', r.status===200, r.data?.error);
const L=n=>r.data.linhas.find(l=>l.nome===n);
let edi=L('Edi Franco');
ok('Edi: março 1, mês atual 1, total 2 (a de 31/12/2025 fica em 2025)', edi&&edi.meses[2]===1&&edi.meses[mesAtual-1]===(mesAtual===3?2:1)&&edi.total===2, JSON.stringify(edi));
ok('Edi: 1 descartada, 1 em análise, 1 corrigida', edi.descartado===1&&edi.analise===1&&edi.corrigidas===1, JSON.stringify(edi));
ok('Linha ADM chamada "ADM" com 1 aprovada', L('ADM')&&L('ADM').aprovado===1&&L('ADM').tipo==='adm');
ok('Linha do digitador com o nome dele', L('Helio Junho de Souza Santos')?.tipo==='digitador'&&L('Helio Junho de Souza Santos').total===1);
ok('Professores ativos sem envio aparecem com zero', L('Felipe Augusto')&&L('Felipe Augusto').total===0);
ok('Totais somam as linhas', r.data.totais.total===r.data.linhas.reduce((s,l)=>s+l.total,0)&&r.data.totais.total===4, r.data.totais.total);
r=await call('/api/adm/relatorio?ano=2025',{token:tAdm});
ok('Fuso de Brasília: envio de 31/12/2025 23h conta em dezembro de 2025', r.data.linhas.find(l=>l.nome==='Edi Franco').meses[11]===1);
r=await call('/api/adm/relatorio?ano=2026&recorte=area&valor=CN',{token:tAdm});
ok('Por área CN: só Química/Física/Biologia', r.status===200&&r.data.linhas.every(l=>['Química','Física','Biologia',''].includes(l.disciplina))&&r.data.linhas.some(l=>l.nome==='Felipe Augusto')&&!r.data.linhas.some(l=>l.nome==='Edi Franco'), JSON.stringify(r.data.linhas.map(l=>l.nome)));
r=await call('/api/adm/relatorio?ano=2026&recorte=area&valor=MT',{token:tAdm});
ok('Por área MT: digitador aparece (questão de Matemática)', r.data.linhas.some(l=>l.tipo==='digitador'&&l.total===1), JSON.stringify(r.data.linhas.map(l=>l.nome)));
r=await call('/api/adm/relatorio?ano=2026&recorte=disciplina&valor=Literatura',{token:tAdm});
ok('Por disciplina Literatura: Edi, Márcio, Telma e ADM', ['Edi Franco','Márcio Alex','Telma Paes','ADM'].every(n=>r.data.linhas.some(l=>l.nome===n))&&!r.data.linhas.some(l=>l.tipo==='digitador'), JSON.stringify(r.data.linhas.map(l=>l.nome)));
const idEdi=db.prepare("SELECT id FROM usuarios WHERE nome='Edi Franco'").get().id;
r=await call('/api/adm/relatorio?ano=2026&recorte=professor&valor='+idEdi,{token:tAdm});
ok('Por professor: só a Edi', r.data.linhas.length===1&&r.data.linhas[0].total===2);
r=await call('/api/adm/relatorio?ano=2026&recorte=area&valor=XX',{token:tAdm});
ok('Área inválida recusada', r.status===400);
r=await call('/api/adm/relatorio?ano=2026',{token:tMarcio});
ok('Relatório só para o ADM', r.status===401||r.status===403, r.status);
r=await call('/api/itens/meus/resumo',{token:tEdi});
ok('Resumo do professor: mês atual, total, situações e correções', r.status===200&&r.data.meses[2]===1&&r.data.por_mes[2].descartado===1&&r.data.total===2&&r.data.descartado===1&&r.data.analise===1&&r.data.corrigidas===1&&r.data.mes_atual===mesAtual, JSON.stringify(r.data));
r=await call('/api/itens/meus/resumo',{token:tMarcio});
ok('Resumo de quem não enviou: tudo zero', r.status===200&&r.data.total===0, JSON.stringify(r.data));
// ----- prazo de acesso -----
r=await call('/api/adm/professores/'+hel.id,{method:'PUT',token:tAdm,body:{acesso_ate:'2020-01-01'}});
ok('ADM muda o prazo', r.status===200, r.data?.error);
r=await call('/api/login/sessao',{token:tHel});
ok('Prazo vencido derruba a sessão do digitador', r.status===401, r.status);
db.exec('DELETE FROM login_rate_limits');const nm=mails.length;await call('/api/login/codigo',{method:'POST',body:{email:'helio.santos@grupoideal.com.br'}});
ok('Prazo vencido: não envia código', mails.length===nm);
r=await call('/api/adm/professores/'+hel.id,{method:'PUT',token:tAdm,body:{acesso_ate:null}});
const tHel2=await tok('helio.santos@grupoideal.com.br');
ok('Sem prazo: volta a entrar', !!tHel2);

// ===== telas =====
const server = http.createServer(async (req, res) => { const chunks=[]; for await (const c of req) chunks.push(c); const request=new Request('https://atlas-api.test'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD','OPTIONS'].includes(req.method)?undefined:Buffer.concat(chunks)}); const response=await worker.fetch(request,env); res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(8793);
const K=S+'katexpkg/package/dist/';
const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
await ctx.route('https://idealolimpico.com.br/atlas/**', route=>{const f=new URL(route.request().url()).pathname.replace('/atlas/','')||'index.html';const p=REPO+'atlas/'+f;if(!fs.existsSync(p))return route.fulfill({status:404,body:'nf'});route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'image/png',body:fs.readFileSync(p)})});
await ctx.route('https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/**', r2=>{const p=new URL(r2.request().url()).pathname.replace('/npm/katex@0.19.1/dist/','');r2.fulfill({status:200,headers:{'content-type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'font/'+p.split('.').pop(),'access-control-allow-origin':'*'},body:fs.readFileSync(K+p)})});
await ctx.route('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js', r2=>r2.fulfill({status:200,headers:{'content-type':'application/javascript','access-control-allow-origin':'*'},body:fs.readFileSync(S+'cdn/package/dist/exceljs.min.js')}));
await ctx.route('https://accounts.google.com/**', r2=>r2.fulfill({status:200,contentType:'application/javascript',body:'window.google={accounts:{id:{initialize(){},renderButton(){},disableAutoSelect(){}}}}'}));
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route=>{const u=route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev','http://localhost:8793');const resp=await route.fetch({url:u,headers:{...route.request().headers(),origin:ORIGIN}});route.fulfill({response:resp})});
const page=await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.dismiss()});
const paste=(sel,text)=>page.evaluate(([sel,text])=>{const el=document.querySelector(sel);el.focus();const dt=new DataTransfer();dt.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},[sel,text]);
// --- digitador ---
db.exec('DELETE FROM login_rate_limits');await page.goto('https://idealolimpico.com.br/atlas/');await page.click('[data-role="Professor"]');await page.fill('#email','helio.santos');await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');await page.fill('#code',lastCode());await page.click('#verifyButton');
await page.waitForURL(/digitador\.html/);await page.waitForSelector('#es-form');
ok('Tela: digitador cai direto na página de digitação', page.url().endsWith('digitador.html'));
await page.click('#es-enviar');await page.waitForTimeout(150);
ok('Tela Dig: sem dados, pede disciplina e campos', (await page.textContent('#es-resumo')).includes('Disciplina'));
ok('Tela Dig: não há campos de origem, fonte nem tags', !(await page.$('#es-origem'))&&!(await page.$('#es-fonte'))&&!(await page.$('#es-tags')));
await page.selectOption('#es-disciplina','Física');
await paste('#comando','Um corpo cai.\nQual a aceleração?');
await paste('#alt-a','A) 1 m/s²\nB) 5 m/s²\nC) 10 m/s²\nD) 15 m/s²\nE) 20 m/s²');
await page.selectOption('#es-gabarito','C');
const altE=await page.textContent('#alt-e');
ok('Tela Dig: colar alternativas juntas separa A–E', altE.includes('20'), altE);
await page.click('#es-enviar');await page.waitForSelector('#es-previa:not([hidden])');
ok('Tela Dig: prévia mostra "sem classificação"', (await page.textContent('#es-previa')).includes('sem classificação'));
await page.click('#es-enviar');await page.waitForSelector('#es-ok:not([hidden])');
const okTxt=await page.textContent('#es-ok');
ok('Tela Dig: enviada para o supervisor da disciplina', okTxt.includes('Supervisor de Física'), okTxt);
ok('Tela Dig: disciplina fica para a próxima', (await page.inputValue('#es-disciplina'))==='Física');
ok('Tela Dig: campos de conteúdo limpos', (await page.textContent('#comando')).trim()===''&&(await page.inputValue('#es-gabarito'))==='');
await page.waitForFunction(()=>document.querySelectorAll('#meus-lista tbody tr').length>=2);
ok('Tela Dig: Minhas questões atualiza', (await page.textContent('#meus-lista')).includes('Física'));
// repetida
await paste('#comando','Um corpo cai.\nQual a aceleração?');await paste('#alt-a','A) 1 m/s²\nB) 5 m/s²\nC) 10 m/s²\nD) 15 m/s²\nE) 20 m/s²');await page.selectOption('#es-gabarito','C');
await page.click('#es-enviar');await page.waitForSelector('#es-previa:not([hidden])');await page.click('#es-enviar');await page.waitForSelector('#es-repetida:not([hidden])');
ok('Tela Dig: alerta de repetida aparece', true);
await page.click('#es-rep-cancelar');
await page.goto('https://idealolimpico.com.br/atlas/professor.html');await page.waitForURL(/digitador\.html/);
ok('Tela: digitador que abre professor.html volta para a digitação', true);
// --- ADM: enviar ---
await page.goto('https://idealolimpico.com.br/atlas/admin-enviar.html');await page.evaluate(t=>sessionStorage.setItem('atlas_adm_token',t),tAdm);await page.reload();
await page.waitForSelector('#es-form');
await page.selectOption('#es-disciplina','História');
await paste('#comando','Questão antiga de História');await paste('#alt-a','a) um\nb) dois\nc) três\nd) quatro\ne) cinco');await page.selectOption('#es-gabarito','A');
await page.click('#es-visualizar');await page.waitForSelector('#es-previa:not([hidden])');await page.click('#es-enviar');await page.waitForSelector('#es-ok:not([hidden])');
ok('Tela ADM: envia questão de História', (await page.textContent('#es-ok')).includes('Supervisor de História'), await page.textContent('#es-ok'));
ok('Tela ADM: menu tem Enviar questões e Relatório', (await page.textContent('aside')).includes('Relatório de produção'));
await page.screenshot({path:S+'adm-enviar.png',fullPage:false});
// --- ADM: relatório ---
await page.goto('https://idealolimpico.com.br/atlas/admin-relatorio.html');await page.waitForSelector('table.rel');
const tx=await page.textContent('#rel-tabela');
ok('Tela Relatório: mostra Edi, ADM e o digitador', tx.includes('Edi Franco')&&tx.includes('ADM')&&tx.includes('Helio'), tx.slice(0,200));
await page.selectOption('#f-recorte','area');await page.selectOption('#f-valor','CH');await page.click('#f-gerar');await page.waitForFunction(()=>document.querySelector('#rel-titulo').textContent.includes('Humanas'));
ok('Tela Relatório: filtro por área CH', (await page.textContent('#rel-tabela')).includes('ADM'));
await page.selectOption('#f-recorte','todos');await page.click('#f-gerar');await page.waitForFunction(()=>document.querySelector('#rel-titulo').textContent.includes('Todas'));
await page.screenshot({path:S+'adm-relatorio.png',fullPage:true});
const [dl]=await Promise.all([page.waitForEvent('download'),page.click('#f-excel')]);
const xp=S+'rel-teste.xlsx';await dl.saveAs(xp);
ok('Tela Relatório: Excel baixado', fs.statSync(xp).size>4000&&/\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
// --- ADM: cadastro com digitador ---
await page.goto('https://idealolimpico.com.br/atlas/admin.html');await page.waitForSelector('#list table');
ok('Tela Cadastros: etiqueta Digitador na tabela', (await page.textContent('#list')).includes('Digitador'));
await page.click('#add');await page.fill('#name','Outro Digitador');await page.fill('#email','outro.dig');await page.check('#is-digitador');
ok('Tela Cadastros: marcar digitador esconde a disciplina', await page.isHidden('#subject-row'));
await page.fill('#acesso-ate','2099-06-30');await page.click('#save');await page.waitForFunction(()=>document.querySelector('#app-status').textContent.includes('Digitador cadastrado'));
const novo=db.prepare("SELECT digitador,acesso_ate,disciplina FROM usuarios WHERE email='outro.dig@grupoideal.com.br'").get();
ok('Tela Cadastros: digitador salvo com prazo', novo&&novo.digitador===1&&novo.acesso_ate==='2099-06-30'&&novo.disciplina===null, JSON.stringify(novo));
ok('Tela Cadastros: supervisores não oferecem digitador', !(await page.textContent('#supervisors')).includes('Outro Digitador'));
// --- Supervisor ---
await page.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('atlas_user_auth')});
db.exec('DELETE FROM login_rate_limits');await page.goto('https://idealolimpico.com.br/atlas/');await page.click('[data-role="Supervisor"]');await page.fill('#email','sup.mat');await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');await page.fill('#code',lastCode());await page.click('#verifyButton');
await page.waitForURL(/supervisor\.html/);await page.waitForSelector('.selo-classificar');
ok('Tela Sup: selo CLASSIFICAR na fila', (await page.$$('.selo-classificar')).length>=1);
ok('Tela Sup: autor aparece como digitador', (await page.textContent('#queue, body')).includes('(digitador)'));
await page.locator('tr:has(.selo-classificar) button, tr:has(.selo-classificar) a').first().click();
await page.waitForSelector('.aviso-classificar');
ok('Tela Sup: aviso de classificação no detalhe', (await page.textContent('.aviso-classificar')).includes('digitador'));
ok('Tela Sup: sem botão Solicitar ajuste para digitador', await page.isHidden('#request-adjustment'));
await page.click('#edit-item');await page.waitForSelector('#ed-dificuldade',{state:'attached'});
ok('Tela Sup: editor mostra dificuldade quando está vazia', !!(await page.$('#ed-dificuldade')));
ok('Tela Sup: origem aparece como Acervo Ideal', (await page.textContent('#item-content, body')).includes('Acervo Ideal'));
await page.screenshot({path:S+'sup-classificar.png',fullPage:false});
await page.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('atlas_user_auth')});
db.exec('DELETE FROM login_rate_limits');await page.goto('https://idealolimpico.com.br/atlas/');await page.click('[data-role="Professor"]');await page.fill('#email','edi.franco');await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');await page.fill('#code',lastCode());await page.click('#verifyButton');
await page.waitForURL(/professor\.html/);await page.waitForFunction(()=>document.querySelector('#resumo-mes').textContent!=='–');
ok('Tela Prof: quadro Meu resumo com 12 meses e o mês atual', (await page.textContent('#resumo-mes-rot')).includes('em ')&&(await page.textContent('#resumo-cartoes')).includes('aprovadas'), await page.textContent('#meu-resumo'));
await page.locator('#meu-resumo').screenshot({path:S+'resumo-prof.png'});
ok('Sem erros de JavaScript nas telas', errors.length===0, errors.join(' | '));
ok('Nenhum alert/confirm', dialogs.length===0, dialogs.join('|'));
await browser.close();server.close();
for(const [s,n,e] of results)console.log(s,n,e?'— '+e:'');
console.log(results.filter(r=>r[0]!=='OK  ').length+' falha(s) de '+results.length);
process.exit(0);
