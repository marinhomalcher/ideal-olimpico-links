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
db.exec("INSERT INTO usuarios (nome,email,disciplina,papel) VALUES ('Prof Química','prof.quimica@grupoideal.com.br','Química','professor')");
const tProfQ=await tok('prof.quimica@grupoideal.com.br');
const base={etapa:'em',origem:'autoral',dificuldade:'Média',assunto:'Romantismo',bloom:'Aplicar',comando:'Comando base',
 'alt-a':'A1','alt-b':'B1','alt-c':'C1','alt-d':'D1','alt-e':'E1',gabarito:'C'};
const espera=()=>new Promise(r=>setTimeout(r,30));
const tAdm=(await call('/api/adm/login',{method:'POST',body:{credential:await jwt({})}})).data.token;
async function aprovada(extra={},token=tEdi,tSup=tMarcio){const c=(await call('/api/itens',{method:'POST',token,body:{dados:{...base,...extra}}})).data.item.codigo;
  if(tSup)await call('/api/supervisor/itens/'+c+'/decisao',{method:'POST',token:tSup,body:{decisao:'aprovar',motivo:'',versao:1}});return c}
const q1=await aprovada({assunto:'Romantismo',comando:'Sobre Álvares de Azevedo',dificuldade:'Fácil'});
const q2=await aprovada({assunto:'Barroco',comando:'Gregório de Matos',origem:'enem'});
const q3=await aprovada({assunto:'Barroco',comando:'Padre Vieira',bloom:'Analisar',gabarito:'E'});
const q4=await aprovada({assunto:'Modernismo',comando:'Semana de 22'});
const qEf=await aprovada({etapa:'ef2',comando:'Questão do fundamental'});
const qAn=await aprovada({comando:'Ainda em análise'},tEdi,null);
const qQ=await aprovada({assunto:'Estequiometria',comando:'Mols'},tProfQ,tSupQ);
env.ATLAS_AVISOS_ATIVOS='1';
let r=await call('/api/saude');
ok('Schema 8', r.data.schema==='8', r.data.schema);
r=await call('/api/supervisor/selecoes',{token:tEdi});
ok('Professor não usa seleções', r.status===403);
r=await call('/api/supervisor/selecoes',{method:'POST',token:tMarcio,body:{serie:4,tipo:'REG'}});
ok('Série inválida recusada', r.status===400);
r=await call('/api/supervisor/selecoes',{method:'POST',token:tMarcio,body:{serie:1,tipo:'MIL'}});
ok('Tipo MIL ainda não aceito', r.status===400);
r=await call('/api/supervisor/selecoes',{method:'POST',token:tMarcio,body:{serie:1,tipo:'REG',titulo:'Simulado 1'}});
const s1=r.data.selecao.id; ok('Cria seleção 1ª REG', r.status===200 && s1>0);
r=await call('/api/supervisor/banco?selecao='+s1,{token:tMarcio});
const cods=r.data.itens.map(i=>i.codigo);
ok('Banco: só aprovadas, do Ensino Médio, da disciplina', [q1,q2,q3,q4].every(c=>cods.includes(c)) && !cods.includes(qEf) && !cods.includes(qAn) && !cods.includes(qQ), cods.join(','));
ok('Banco lista assuntos para o filtro', r.data.assuntos.includes('Barroco'));
r=await call('/api/supervisor/banco?selecao='+s1+'&assunto=Barroco&bloom=Analisar',{token:tMarcio});
ok('Filtros por assunto e Bloom', r.data.itens.length===1 && r.data.itens[0].codigo===q3);
r=await call('/api/supervisor/banco?selecao='+s1+'&q=vieira',{token:tMarcio});
ok('Busca por texto', r.data.itens.length===1 && r.data.itens[0].codigo===q3);
r=await call('/api/supervisor/banco?selecao='+s1+'&q='+q2.toLowerCase(),{token:tMarcio});
ok('Busca por código', r.data.itens.length===1 && r.data.itens[0].codigo===q2);
r=await call('/api/supervisor/banco?selecao='+s1,{token:tSupQ});
ok('Supervisor de outra disciplina não vê a seleção', r.status===404);
r=await call('/api/supervisor/selecoes/'+s1,{method:'PUT',token:tMarcio,body:{itens:[q1,qAn]}});
ok('Não aceita questão em análise', r.status===409 && r.data.error.includes(qAn));
r=await call('/api/supervisor/selecoes/'+s1,{method:'PUT',token:tMarcio,body:{itens:[q1,qQ]}});
ok('Não aceita questão de outra disciplina', r.status===409);
r=await call('/api/supervisor/selecoes/'+s1,{method:'PUT',token:tMarcio,body:{itens:[q1,q1]}});
ok('Não aceita repetida', r.status===400);
r=await call('/api/supervisor/selecoes/'+s1+'/enviar',{method:'POST',token:tMarcio,body:{}});
ok('Não envia seleção vazia', r.status===400);
r=await call('/api/supervisor/selecoes/'+s1,{method:'PUT',token:tMarcio,body:{itens:[q3,q1,q2]}});
ok('Salva questões na ordem', r.status===200 && r.data.selecao.total===3);
r=await call('/api/supervisor/selecoes/'+s1,{token:tMarcio});
ok('Ordem preservada', r.data.selecao.itens.map(i=>i.codigo).join()===[q3,q1,q2].join());
let n0=mails.length; r=await call('/api/supervisor/selecoes/'+s1+'/enviar',{method:'POST',token:tMarcio,body:{}}); await espera();
ok('Envia ao ADM; ADM avisado', r.status===200 && mails.length===n0+1 && mails.at(-1).email==='marinhomalcher@gmail.com' && /1ª série REG/.test(mails.at(-1).assunto), JSON.stringify(mails.at(-1)?.assunto));
r=await call('/api/supervisor/selecoes/'+s1,{method:'PUT',token:tMarcio,body:{itens:[q1]}});
ok('Seleção enviada não é editada pelo Supervisor', r.status===409);
r=await call('/api/supervisor/selecoes/'+s1,{method:'DELETE',token:tMarcio});
ok('Seleção enviada não é excluída', r.status===409);
r=await call('/api/adm/selecoes',{token:tMarcio});
ok('Seleções da ADM exigem sessão de ADM', r.status===401);
r=await call('/api/adm/selecoes',{token:tAdm});
ok('ADM vê a seleção recebida', r.data.selecoes.length===1 && r.data.selecoes[0].id===s1 && r.data.selecoes[0].total===3);
r=await call('/api/adm/selecoes/'+s1,{token:tAdm});
ok('ADM abre com questões completas e gabarito', r.data.selecao.itens.length===3 && r.data.selecao.itens[0].dados.gabarito==='E' && r.data.selecao.itens[0].dados.comando.includes('Vieira'));
r=await call('/api/adm/selecoes/'+s1+'/devolver',{method:'POST',token:tAdm,body:{motivo:''}});
ok('Devolver exige motivo', r.status===400);
n0=mails.length; r=await call('/api/adm/selecoes/'+s1+'/devolver',{method:'POST',token:tAdm,body:{motivo:'Troque a questão 2'}}); await espera();
ok('ADM devolve; Supervisor avisado', r.status===200 && mails.length===n0+1 && mails.at(-1).email==='marcio.alex@grupoideal.com.br' && /Troque/.test(mails.at(-1).texto));
r=await call('/api/supervisor/selecoes/'+s1,{token:tMarcio});
ok('Supervisor vê devolvida com motivo e pode editar', r.data.selecao.situacao==='rascunho' && r.data.selecao.motivo_devolucao==='Troque a questão 2');
await call('/api/supervisor/selecoes/'+s1,{method:'PUT',token:tMarcio,body:{itens:[q3,q4,q2]}});
await call('/api/supervisor/selecoes/'+s1+'/enviar',{method:'POST',token:tMarcio,body:{}});
r=await call('/api/adm/selecoes/'+s1+'/aplicar',{method:'POST',token:tAdm,body:{}});
ok('ADM marca como aplicada (ano atual)', r.status===200 && r.data.selecao.ano===2026, JSON.stringify(r.data));
r=await call('/api/adm/selecoes/'+s1+'/devolver',{method:'POST',token:tAdm,body:{motivo:'tarde demais'}});
ok('Aplicada não volta', r.status===409);
// regra de uso
const nova=async(serie,tipo)=>(await call('/api/supervisor/selecoes',{method:'POST',token:tMarcio,body:{serie,tipo}})).data.selecao.id;
const banco=async id=>(await call('/api/supervisor/banco?selecao='+id,{token:tMarcio})).data.itens;
const s1r=await nova(1,'REG'), s1m=await nova(1,'MED'), s2r=await nova(2,'REG');
let b=await banco(s1r);
ok('Mesma série/tipo no mesmo ano: aplicadas somem', !b.some(i=>[q3,q4,q2].includes(i.codigo)) && b.some(i=>i.codigo===q1));
b=await banco(s1m);
ok('Outro tipo (MED) continua oferecendo', [q3,q4,q2].every(c=>b.some(i=>i.codigo===c)));
b=await banco(s2r);
ok('Outra série no mesmo ano continua oferecendo', [q3,q4,q2].every(c=>b.some(i=>i.codigo===c)));
ok('Mostra onde a questão foi aplicada', b.find(i=>i.codigo===q3).usos.some(u=>u.situacao==='aplicada' && u.serie===1 && u.tipo==='REG' && u.ano===2026));
r=await call('/api/supervisor/selecoes/'+s1r,{method:'PUT',token:tMarcio,body:{itens:[q3]}});
ok('Servidor recusa questão já usada para a turma', r.status===409);
// coorte: aplicada na 1ª REG em 2025 -> bloqueia 2ª REG em 2026, libera 1ª REG em 2026
db.prepare('UPDATE selecoes SET ano=2025 WHERE id=?').run(s1);
b=await banco(s2r);
ok('Coorte: aplicada na 1ª em 2025 não aparece para a 2ª em 2026 (mesmo tipo)', !b.some(i=>[q3,q4,q2].includes(i.codigo)));
b=await banco(s1r);
ok('Coorte: a 1ª série de 2026 (nova turma) pode usar', [q3,q4,q2].every(c=>b.some(i=>i.codigo===c)));
b=await banco(await nova(3,'REG'));
ok('Coorte: 3ª em 2026 não é a mesma turma', [q3,q4,q2].every(c=>b.some(i=>i.codigo===c)));
db.prepare('UPDATE selecoes SET ano=2026 WHERE id=?').run(s1);
// conflito na aplicação e item que fica indisponível no rascunho
const sa=await nova(2,'MED'), sb=await nova(2,'MED');
await call('/api/supervisor/selecoes/'+sa,{method:'PUT',token:tMarcio,body:{itens:[q1]}});
await call('/api/supervisor/selecoes/'+sb,{method:'PUT',token:tMarcio,body:{itens:[q1,q4]}});
await call('/api/supervisor/selecoes/'+sa+'/enviar',{method:'POST',token:tMarcio,body:{}});
await call('/api/supervisor/selecoes/'+sb+'/enviar',{method:'POST',token:tMarcio,body:{}});
r=await call('/api/supervisor/banco?selecao='+s1m,{token:tMarcio});
ok('Mostra que a questão está em outra seleção enviada', r.data.itens.find(i=>i.codigo===q1).usos.some(u=>u.situacao==='enviada'));
await call('/api/adm/selecoes/'+sa+'/aplicar',{method:'POST',token:tAdm,body:{}});
r=await call('/api/adm/selecoes/'+sb+'/aplicar',{method:'POST',token:tAdm,body:{}});
ok('Aplicar recusa questão já aplicada para a turma', r.status===409 && r.data.error.includes(q1));
const sc=await nova(2,'MED');
db.prepare("INSERT INTO selecao_itens (selecao_id,item_id,ordem,versao) SELECT ?, id, 1, 1 FROM itens WHERE codigo=?").run(sc,q1);
r=await call('/api/supervisor/selecoes/'+sc,{token:tMarcio});
ok('Rascunho marca questão que ficou indisponível', r.data.selecao.itens[0].bloqueado===1);
r=await call('/api/supervisor/selecoes/'+sc+'/enviar',{method:'POST',token:tMarcio,body:{}});
ok('Não envia com questão indisponível', r.status===409);
r=await call('/api/supervisor/selecoes/'+sc,{method:'DELETE',token:tMarcio});
ok('Exclui rascunho', r.status===200 && !db.prepare('SELECT id FROM selecoes WHERE id=?').get(sc));
// versão congelada
const sv=await nova(3,'MED');
await call('/api/supervisor/selecoes/'+sv,{method:'PUT',token:tMarcio,body:{itens:[q2]}});
await call('/api/supervisor/selecoes/'+sv+'/enviar',{method:'POST',token:tMarcio,body:{}});
await call('/api/adm/itens/'+q2,{method:'PUT',token:tAdm,body:{dados:{...base,assunto:'Barroco',comando:'Gregório corrigido',origem:'enem'},versao:1}});
r=await call('/api/adm/selecoes/'+sv,{token:tAdm});
ok('ADM vê a versão enviada e o aviso de versão mais nova', r.data.selecao.itens[0].dados.comando==='Gregório de Matos' && r.data.selecao.itens[0].versao_atual===2);

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

await login('Supervisor','marcio.alex');await page.waitForURL(/supervisor\.html/);
await page.click('aside a[href="supervisor-selecoes.html"]');await page.waitForURL(/supervisor-selecoes\.html/);
await page.waitForFunction(()=>document.querySelectorAll('#lista tbody tr').length>0);
ok('Tela Sup: lista de seleções', (await page.textContent('#lista')).includes('Aplicada em 2026'));
await page.click('#nova');await page.check('input[name=serie][value="1"]');await page.check('input[name=tipo][value="MED"]');await page.fill('#novo-titulo','Simulado tela');await page.click('#nova-form button[type=submit]');
await page.waitForSelector('#sel-view:not([hidden])');await page.waitForFunction(()=>document.querySelectorAll('#banco .qcard').length>0);
ok('Tela Sup: seleção nova aberta com banco', (await page.textContent('#sel-titulo')).includes('1ª série MED') && (await page.textContent('#banco')).includes('Aplicada: 1ª REG 2026'));
await page.locator('#banco .qcard',{hasText:q4}).getByText('Adicionar').click();
await page.locator('#banco .qcard',{hasText:q3}).getByText('Adicionar').click();
await page.waitForFunction(()=>document.querySelector('#savestate').textContent==='Salvo');
await page.locator('#escolhidas .qcard',{hasText:q3}).getByText('↑').click();
await page.waitForFunction(()=>document.querySelector('#savestate').textContent==='Salvo');
await page.screenshot({path:S+'supsel.png'});
const idTela=Number(new URL(page.url()).searchParams.get('id'));
const ordem=db.prepare('SELECT i.codigo c FROM selecao_itens si JOIN itens i ON i.id=si.item_id WHERE selecao_id=? ORDER BY ordem').all(idTela).map(x=>x.c);
ok('Tela Sup: adicionar e reordenar salvam sozinhos', ordem.join()===[q3,q4].join(), ordem.join());
ok('Tela Sup: adicionada sai do banco', !(await page.textContent('#banco')).includes(q3));
await page.locator('#escolhidas .qcard',{hasText:q3}).getByText('Ver questão').click();await page.waitForSelector('#preview[open]');
ok('Tela Sup: ver questão completa', (await page.textContent('#preview-corpo')).includes('Padre Vieira'));
await page.click('#preview .modal-actions button');
await page.click('#enviar');await page.click('#confirmar-envio');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('enviada ao administrador'));await page.waitForSelector('#editor-bloco',{state:'hidden'}).catch(()=>{});
ok('Tela Sup: envio com confirmação na página', db.prepare('SELECT situacao s FROM selecoes WHERE id=?').get(idTela).s==='enviada' && !(await page.isVisible('#editor-bloco')));
// ADM
await page.evaluate(()=>sessionStorage.clear());
await page.addInitScript(t=>{try{sessionStorage.setItem('atlas_adm_token',t)}catch{}},tAdm);
await page.goto('https://idealolimpico.com.br/atlas/admin-selecoes.html');
await page.waitForFunction(id=>document.querySelector('#lista').textContent.includes('#'+id),idTela);
await page.locator('#lista tr',{hasText:'Simulado tela'}).getByText('Abrir').click();await page.waitForSelector('#details:not([hidden])');
const corpo=await page.textContent('#det-corpo');
ok('Tela ADM: questões numeradas na ordem e gabarito', corpo.indexOf('Padre Vieira')<corpo.indexOf('Semana de 22') && corpo.includes('Questão 1') && (await page.textContent('.gab-table')).includes('E'));
await page.click('#aplicar');await page.click('#confirmar-aplicar');await page.waitForFunction(()=>document.querySelector('#app-status').textContent.includes('aplicada'));
ok('Tela ADM: marcada como aplicada', db.prepare('SELECT situacao s, ano FROM selecoes WHERE id=?').get(idTela).s==='aplicada');
await page.screenshot({path:S+'admsel.png'});
ok('Tela: sem erros de JavaScript nem caixas do navegador', errors.length===0 && dialogs.length===0, errors.join(' ; ')+dialogs.join(';'));
// professor não abre a página de seleções
await login('Professor','edi.franco');await page.waitForURL(/professor\.html/);
await page.goto('https://idealolimpico.com.br/atlas/supervisor-selecoes.html');await page.waitForURL(/professor\.html/);
ok('Professor é levado para a própria área', page.url().endsWith('professor.html'));

await browser.close(); server.close();
for (const x of results) console.log(x.join(' | '));
const bad=results.filter(x=>x[0]!=='OK  ').length; console.log(bad?`\n${bad} FALHA(S)`:`\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
