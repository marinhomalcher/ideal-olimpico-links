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
const base={etapa:'em',origem:'autoral',dificuldade:'Média',assunto:'Romantismo',bloom:'Aplicar',comando:'Comando','alt-a':'A','alt-b':'B','alt-c':'C','alt-d':'D','alt-e':'E',gabarito:'A'};
let r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,tags:['#Ecologia','  gráfico  de  barras ','ecologia','ENEM 2023']}}});
const c1=r.data.item.codigo;
let d=JSON.parse(db.prepare('SELECT v.dados FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=?').get(c1).dados);
ok('Tags normalizadas: minúsculas, sem #, sem repetição, espaços limpos', JSON.stringify(d.tags)===JSON.stringify(['ecologia','gráfico de barras','enem 2023']), JSON.stringify(d.tags));
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,tags:Array.from({length:13},(_,k)=>'t'+k)}}});
ok('Mais de 12 tags recusado', r.status===400);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,tags:['x'.repeat(41)]}}});
ok('Tag com mais de 40 caracteres recusada', r.status===400);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,tags:['<b>']}}});
ok('Tag com < > recusada', r.status===400);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,tags:[]}}});
ok('Questão sem tags é recusada (mínimo de 2)', r.status===400 && /pelo menos 2 tags/.test(r.data.error), r.data?.error);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,tags:['só uma']}}});
ok('Questão com 1 tag é recusada', r.status===400);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,comando:'Outro comando',tags:['duas','tags']}}});
const c2=r.data.item.codigo;
r=await call('/api/itens/meus',{token:tEdi});
ok('Minhas questões trazem as tags como lista', Array.isArray(r.data.itens.find(i=>i.codigo===c1).tags) && r.data.itens.find(i=>i.codigo===c1).tags.includes('ecologia'));
r=await call('/api/supervisor/fila?situacao=analise',{token:tMarcio});
ok('Fila do Supervisor traz as tags', r.data.itens.find(i=>i.codigo===c1).tags.includes('enem 2023'));
{const atual=(await call('/api/itens/'+c1,{token:tMarcio})).data.item;
 const rr=await call('/api/supervisor/itens/'+c1,{method:'PUT',token:tMarcio,body:{dados:{...atual.dados,dificuldade:'Difícil',origem:'enem',etapa:'ef2',bloom:'Avaliar'},versao:atual.versao_atual}});
 const dv=JSON.parse(db.prepare('SELECT v.dados FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=? AND v.versao=i.versao_atual').get(c1).dados);
 ok('Supervisor não muda dificuldade, origem nem etapa (só Bloom muda)', rr.status===200 && dv.dificuldade==='Média' && dv.origem==='autoral' && dv.etapa==='em' && dv.bloom==='Avaliar', JSON.stringify(dv).slice(0,160));}
for(const c of [c1,c2]){const v=(await call('/api/itens/'+c,{token:tMarcio})).data.item.versao_atual;await call('/api/supervisor/itens/'+c+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'aprovar',motivo:'',versao:v}})}
const sel=(await call('/api/supervisor/selecoes',{method:'POST',token:tMarcio,body:{serie:1,tipo:'REG'}})).data.selecao.id;
r=await call('/api/supervisor/banco?selecao='+sel+'&q=gráfico',{token:tMarcio});
ok('Banco: busca de texto encontra pela tag', r.data.itens.length===1 && r.data.itens[0].codigo===c1 && r.data.itens[0].tags.includes('gráfico de barras'));
r=await call('/api/supervisor/banco?selecao='+sel+'&tag=%23ECOLOGIA',{token:tMarcio});
ok('Banco: filtro exato por tag (com # e maiúsculas)', r.data.itens.length===1 && r.data.itens[0].codigo===c1);
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
await page.locator('#visualizar').click();await page.waitForTimeout(200);
ok('Tela Prof: sem tags, a lista de pendências pede as tags', (await page.textContent('#validation-summary')).includes('Tags') && !!(await page.$('#tags-caixa .is-invalid')));
await page.click('#tags-caixa');await page.keyboard.type('Ecologia');await page.keyboard.press('Enter');await page.keyboard.type('mapa,');await page.keyboard.type('ENEM');
const chips=await page.$$eval('#tags-caixa .atlas-tag',c=>c.map(x=>x.firstChild.textContent));
await page.waitForTimeout(200);
ok('Tela Prof: ao criar as tags, a pendência some', !(await page.textContent('#validation-summary')).includes('Tags'));
ok('Tela Prof: Enter e vírgula criam tags', JSON.stringify(chips)===JSON.stringify(['ecologia','mapa']), JSON.stringify(chips));
await page.selectOption('#assunto','Romantismo');const subs=await page.$$eval('#subtema option',o=>o.map(x=>x.value).filter(Boolean));if(subs.length)await page.selectOption('#subtema',subs[0]);
await page.selectOption('#origem','autoral');await page.selectOption('#dificuldade','Fácil');await page.selectOption('#bloom','Lembrar');
await paste('#comando','Qual bioma?\n\n\n');for(const l of 'abcde')await paste('#alt-'+l,'Opção '+l);await page.selectOption('#gabarito','B');
await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#visualizar');await page.waitForSelector('#previsao:not([hidden])');
ok('Tela Prof: prévia mostra as tags (inclusive a digitada sem Enter)', (await page.textContent('#previsao')).includes('#ecologia') && (await page.textContent('#previsao')).includes('#enem'));
const btnY=await page.$eval('#enviar',b=>b.getBoundingClientRect().top), prevY=await page.$eval('#previsao',p=>p.getBoundingClientRect().top);
ok('Tela Prof: botão Enviar fica abaixo da prévia', btnY>prevY);
const geo=await page.evaluate(()=>{const st=[...document.querySelectorAll('#previsao .stem')].pop(),ch=document.querySelector('#previsao .choice');return {bold:!!st.querySelector('strong,b'),peso:getComputedStyle(st).fontWeight,gap:ch.getBoundingClientRect().top-st.getBoundingClientRect().bottom,html:st.innerHTML}});
ok('Prévia: comando sem negrito', !geo.bold && Number(geo.peso)<600, JSON.stringify(geo));
ok('Prévia: alternativas uma linha abaixo do comando (sem linhas sobrando)', geo.gap>8 && geo.gap<32 && !/<br>\s*$/.test(geo.html), JSON.stringify(geo));
await page.locator('#previsao').screenshot({path:S+'previa.png'});
await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#enviar');await page.waitForFunction(()=>/Código: L\d{7}/.test(document.querySelector('#status').textContent));
const cT=(await page.textContent('#status')).match(/L\d{7}/)[0];
ok('Tela Prof: tags salvas e campo limpo após enviar', JSON.stringify(JSON.parse(db.prepare('SELECT v.dados FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=?').get(cT).dados).tags)==='["ecologia","mapa","enem"]' && (await page.$$('#tags-caixa .atlas-tag')).length===0);
{const row=db.prepare('SELECT v.item_id i, v.versao n, v.dados d FROM item_versoes v JOIN itens it ON it.id=v.item_id WHERE it.codigo=? AND v.versao=it.versao_atual').get(cT);const dd=JSON.parse(row.d);dd.comando=dd.comando+'<br><br><br>\n\n';db.prepare('UPDATE item_versoes SET dados=? WHERE item_id=? AND versao=?').run(JSON.stringify(dd),row.i,row.n)}
await login('Supervisor','marcio.alex');await page.waitForURL(/supervisor\.html/);await page.waitForFunction(()=>document.querySelectorAll('#list tbody tr').length>0);
await page.fill('#busca-fila','#mapa');await page.waitForTimeout(300);
const linhas=await page.$$eval('#list tbody tr',r=>r.map(x=>x.textContent));
ok('Tela Sup: busca rápida da fila por tag', linhas.length===1 && linhas[0].includes(cT) && linhas[0].includes('#mapa'), linhas.length);
await page.fill('#busca-fila','zzz');await page.waitForTimeout(300);
ok('Tela Sup: busca sem resultado avisa', (await page.textContent('#list')).includes('Nenhuma questão encontrada'));
await page.fill('#busca-fila',cT);await page.waitForTimeout(300);
await page.locator('#list tr',{hasText:cT}).locator('button').click();await page.waitForSelector('#details:not([hidden])');
await page.evaluate(()=>{});
const g2=await page.evaluate(()=>{const st=[...document.querySelectorAll('#item-content .question .stem')].pop(),ch=document.querySelector('#item-content .question .choice');return {bold:!!st.querySelector('strong,b'),gap:ch.getBoundingClientRect().top-st.getBoundingClientRect().bottom}});
ok('Supervisor: comando sem negrito e alternativas logo abaixo', !g2.bold && g2.gap>8 && g2.gap<32, JSON.stringify(g2));
ok('Tela Sup: detalhe mostra as tags', (await page.textContent('#item-content')).includes('#ecologia'));
await page.click('#edit-item');await page.waitForSelector('#edit-form:not([hidden])');
ok('Tela Sup: edição carrega as tags', (await page.$$('#tags-edit-caixa .atlas-tag')).length===3);
await page.waitForSelector('#ed-assunto option:nth-child(3)',{state:'attached'});
ok('Tela Sup: edição mostra a classificação atual', (await page.inputValue('#ed-assunto'))==='Romantismo' && (await page.inputValue('#ed-bloom'))==='Lembrar');
const outro=await page.$eval('#ed-assunto',s=>[...s.options].map(o=>o.value).find(v=>v&&v!=='Romantismo'));
await page.selectOption('#ed-assunto',outro);
const subOk=await page.$$eval('#ed-subtema option',o=>o.map(x=>x.value).filter(Boolean));if(subOk.length)await page.selectOption('#ed-subtema',subOk[0]);
await page.selectOption('#ed-bloom','Analisar');
await page.click('#tags-edit-caixa .atlas-tag button');await page.click('#tags-edit-caixa');await page.keyboard.type('bioma');await page.keyboard.press('Enter');
await page.click('#save-edit');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('versão 2'));
const t2=JSON.parse(db.prepare('SELECT v.dados FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=? AND v.versao=2').get(cT).dados).tags;
const d2v=JSON.parse(db.prepare('SELECT v.dados FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=? AND v.versao=2').get(cT).dados);
ok('Tela Sup: Supervisor muda assunto, subtema e Bloom', d2v.assunto===outro && d2v.bloom==='Analisar' && (subOk.length?d2v.subtema===subOk[0]:true) && d2v.dificuldade==='Fácil', JSON.stringify({a:d2v.assunto,s:d2v.subtema,b:d2v.bloom,d:d2v.dificuldade}));
ok('Tela Sup: Supervisor ajusta as tags na edição', JSON.stringify(t2)==='["mapa","enem","bioma"]', JSON.stringify(t2));
await page.screenshot({path:S+'tags-sup.png'});
ok('Sem erros de JavaScript nem caixas do navegador', errors.length===0 && dialogs.length===0, errors.join(' | '));
await browser.close(); server.close();
for (const x of results) console.log(x.join(' | '));
const bad=results.filter(x=>x[0]!=='OK  ').length; console.log(bad?`\n${bad} FALHA(S)`:`\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
