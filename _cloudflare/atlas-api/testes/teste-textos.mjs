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
const lastCode=()=>mails.at(-1)?.codigo;
async function tok(email){db.exec('DELETE FROM login_rate_limits');await call('/api/login/codigo',{method:'POST',body:{email}});return (await call('/api/login/verificar',{method:'POST',body:{email,codigo:lastCode()}})).data.token}
db.exec("INSERT INTO usuarios (nome,email,disciplina,papel) VALUES ('Sup Mat','sup.mat@grupoideal.com.br','Matemática','supervisor')");
const tMarcio=await tok('marcio.alex@grupoideal.com.br');
const tAdm=(await call('/api/adm/login',{method:'POST',body:{credential:await jwt({})}})).data.token;
ok('ADM entra', !!tAdm);
const tEdi=await tok('edi.franco@grupoideal.com.br');
const base={etapa:'em',origem:'enem',dificuldade:'Média',assunto:'Romantismo',bloom:'Analisar',comando:'Os textos expressam interpretações divergentes.','alt-a':'A','alt-b':'B','alt-c':'C','alt-d':'D','alt-e':'E',gabarito:'B'};
const T1='<p>Mas logo se viu que a retirada americana seria praticamente equivalente.</p>',T2='<p>O que as pessoas não compreendiam, e que os Governos não lhes comunicavam.</p>';
let r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,'texto-base':T1,referencia:'WESSON, R. G. A nova política externa. Rio de Janeiro: Zahar, 1978.',textos_extras:[{texto:T2,referencia:'DEUTSCHER, I. Disponível em: x.org. Acesso em: 1 jan. 2020.'}],'ref-a':'Disponível em: https://www.expedia.com.br. Acesso em: 14 out. 2025.',layout:'pagina'}}});
ok('Questão com Texto II, fonte na alternativa A e largura total é aceita', r.status===200, r.data?.error);
const c1=r.data.item.codigo;let d=(await call('/api/itens/'+c1,{token:tEdi})).data.item.dados;
ok('Texto II guardado com a referência formatada', d.textos_extras.length===1&&d.textos_extras[0].referencia==='DEUTSCHER, I. Disponível em: x.org.\nAcesso em: 1 jan. 2020.', JSON.stringify(d.textos_extras));
ok('Fonte da alternativa A guardada com "Acesso em" na linha de baixo', d['ref-a']==='Disponível em: https://www.expedia.com.br.\nAcesso em: 14 out. 2025.'&&d['ref-b']==='', JSON.stringify(d['ref-a']));
ok('Formato largura total guardado', d.layout==='pagina');
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,comando:'Outra'}}});d=(await call('/api/itens/'+r.data.item.codigo,{token:tEdi})).data.item.dados;
ok('Sem escolher, o formato é 2 colunas e não há textos extras', d.layout==='coluna'&&Array.isArray(d.textos_extras)&&d.textos_extras.length===0);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,comando:'X',textos_extras:[{texto:'<p>a</p>'},{texto:'<p>b</p>'},{texto:'<p>c</p>'},{texto:'<p>d</p>'}]}}});
ok('Mais de 4 textos: recusado', r.status===400&&/4 textos/.test(r.data.error), r.data?.error);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,comando:'X',textos_extras:[{texto:'<img src="https://evil.com/a.png">'}]}}});
ok('Imagem de fora no Texto II: recusada', r.status===400);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,comando:'X',textos_extras:[{texto:'<script>alert(1)</script>'}]}}});
ok('Script no Texto II: recusado', r.status===400);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,comando:'X',textos_extras:[{texto:'',referencia:'Só referência'}]}}});
ok('Texto II vazio com referência: recusado', r.status===400);
// repetida considera o texto II
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,'texto-base':T1,textos_extras:[{texto:T2}]},confirmar_repetida:false}});
ok('Mesma questão (com o mesmo Texto II) é detectada como repetida', r.status===409);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,'texto-base':T1,textos_extras:[{texto:'<p>Um texto II diferente</p>'}]},confirmar_repetida:false}});
ok('Texto II diferente não é repetida', r.status===200, r.data?.error);
// grupo com 2 textos e largura total
r=await call('/api/itens/grupo',{method:'POST',token:tEdi,body:{texto:{'texto-base':T1,referencia:'Ref 1',textos_extras:[{texto:T2,referencia:'Ref 2'}],layout:'pagina'},itens:[{...base,comando:'G1'},{...base,comando:'G2',layout:'coluna'}],confirmar_repetida:true}});
ok('Grupo com Texto II e largura total', r.status===200, r.data?.error);
const g1=r.data.grupo.itens[0],g2=r.data.grupo.itens[1];
d=(await call('/api/itens/'+g2,{token:tMarcio})).data.item.dados;
ok('Questão do grupo recebe os textos e o formato do grupo', d.textos_extras.length===1&&d.layout==='pagina'&&d['texto-base']===T1, JSON.stringify({l:d.layout,e:d.textos_extras.length}));
// supervisor aprova uma questão do grupo e depois muda só o formato
let v=(await call('/api/itens/'+g1,{token:tMarcio})).data.item.versao_atual;await call('/api/supervisor/itens/'+g1+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'aprovar',motivo:'',versao:v}});
let it=(await call('/api/itens/'+g2,{token:tMarcio})).data.item;
r=await call('/api/supervisor/itens/'+g2,{method:'PUT',token:tMarcio,body:{dados:{...it.dados,layout:'coluna'},versao:it.versao_atual}});
ok('Mudar só o formato do grupo é permitido mesmo com questão aprovada', r.status===200, r.data?.error);
d=(await call('/api/itens/'+g1,{token:tMarcio})).data.item.dados;ok('O formato vale para o grupo todo', d.layout==='coluna');
it=(await call('/api/itens/'+g2,{token:tMarcio})).data.item;
r=await call('/api/supervisor/itens/'+g2,{method:'PUT',token:tMarcio,body:{dados:{...it.dados,textos_extras:[{texto:'<p>mudou</p>',referencia:''}]},versao:it.versao_atual}});
ok('Mudar o Texto II com questão do grupo aprovada continua bloqueado', r.status===409, r.data?.error);
// supervisor muda layout de questão comum
it=(await call('/api/itens/'+c1,{token:tMarcio})).data.item;
r=await call('/api/supervisor/itens/'+c1,{method:'PUT',token:tMarcio,body:{dados:{...it.dados,layout:'coluna'},versao:it.versao_atual}});
d=(await call('/api/itens/'+c1,{token:tMarcio})).data.item.dados;ok('Supervisor muda o formato de uma questão', r.status===200&&d.layout==='coluna'&&d.textos_extras.length===1);
// ===== telas =====
const server = http.createServer(async (req, res) => { const chunks=[]; for await (const c of req) chunks.push(c); const request=new Request('https://atlas-api.test'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD','OPTIONS'].includes(req.method)?undefined:Buffer.concat(chunks)}); const response=await worker.fetch(request,env); res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(8797);
const K=S+'katexpkg/package/dist/';
const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:1280,height:900}});
await ctx.route('https://idealolimpico.com.br/atlas/**', route=>{const f=new URL(route.request().url()).pathname.replace('/atlas/','')||'index.html';const p=REPO+'atlas/'+f;if(!fs.existsSync(p))return route.fulfill({status:404,body:'nf'});route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'image/png',body:fs.readFileSync(p)})});
await ctx.route('https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/**', r2=>{const p=new URL(r2.request().url()).pathname.replace('/npm/katex@0.19.1/dist/','');r2.fulfill({status:200,headers:{'content-type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'font/'+p.split('.').pop(),'access-control-allow-origin':'*'},body:fs.readFileSync(K+p)})});
await ctx.route('https://accounts.google.com/**', r2=>r2.fulfill({status:200,contentType:'application/javascript',body:'window.google={accounts:{id:{initialize(){},renderButton(){},disableAutoSelect(){}}}}'}));
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route=>{const u=route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev','http://localhost:8797');const resp=await route.fetch({url:u,headers:{...route.request().headers(),origin:ORIGIN}});route.fulfill({response:resp})});
const page=await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const paste=(sel,text)=>page.evaluate(([sel,text])=>{const el=document.querySelector(sel);el.focus();const dt=new DataTransfer();dt.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},[sel,text]);
db.exec('DELETE FROM login_rate_limits');await page.goto('https://idealolimpico.com.br/atlas/');await page.click('[data-role="Professor"]');await page.fill('#email','edi.franco');await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');await page.fill('#code',lastCode());await page.click('#verifyButton');
await page.waitForURL(/professor\.html/);await page.waitForFunction(()=>!document.querySelector('#questao-form').hidden);
ok('Tela: botão "+ Adicionar outro texto" e formato 2 colunas marcado', await page.isVisible('text=+ Adicionar outro texto')&&await page.isChecked('.layout-box input[value="coluna"]'));
ok('Tela: referência fica atrás do botão "+ Inserir referência"', await page.isVisible('[data-ref-para="referencia"]')&&await page.isHidden('#referencia')&&await page.isHidden('label[for="referencia"]'));
await paste('#texto-base','Mas logo se viu que a retirada americana seria praticamente equivalente.');await page.click('[data-ref-para="referencia"]');
ok('Tela: clicar no botão abre o campo de referência', await page.isVisible('#referencia')&&await page.isHidden('[data-ref-para="referencia"]'));
await page.fill('#referencia','WESSON, R. G. A nova política externa dos Estados Unidos. Rio de Janeiro: Zahar, 1978 (fragmento).');
await page.click('text=+ Adicionar outro texto');await page.waitForSelector('.texto-extra');
ok('Tela: ao adicionar, os rótulos viram Texto I e Texto II', (await page.textContent('label[for="texto-base"]'))==='Texto I'&&(await page.textContent('.texto-extra label.lt'))==='Texto II');
{const wBase=(await page.locator('#texto-base').boundingBox()).width,wExtra=(await page.locator('.texto-extra .rich-editor').boundingBox()).width;
ok('Tela: Texto II abre embaixo, com a mesma largura do Texto I', Math.abs(wBase-wExtra)<40&&(await page.locator('.texto-extra').boundingBox()).y>(await page.locator('#referencia').boundingBox()).y, wBase+' x '+wExtra);}
{const refAtual=await page.inputValue('#referencia');await page.evaluate(()=>{document.getElementById('referencia').value=''});const fechou=await page.isHidden('#referencia')&&await page.isVisible('[data-ref-para="referencia"]');
await page.evaluate(v=>{document.getElementById('referencia').value=v},refAtual);
ok('Tela: campo de referência fecha ao limpar e abre sozinho quando a questão já tem referência', fechou&&await page.isVisible('#referencia')&&(await page.inputValue('#referencia'))===refAtual);}
await page.locator('#questao-form').screenshot({path:S+'textos-extras.png'});
ok('Tela: Texto II também tem o botão de referência', await page.isVisible('.texto-extra .btn-ref')&&await page.isHidden('.texto-extra textarea.ref'));
await paste('.texto-extra .rich-editor','O que as pessoas não compreendiam, e que os Governos não lhes comunicavam.');await page.click('.texto-extra .btn-ref');await page.fill('.texto-extra textarea.ref','DEUTSCHER, I. Mitos da Guerra Fria. Disponível em: x.org. Acesso em: 1 jan. 2020.');await page.click('#comando');
ok('Tela: referência do Texto II também quebra o "Acesso em"', (await page.inputValue('.texto-extra textarea.ref')).includes('.\nAcesso em'));
await page.click('text=+ Adicionar outro texto');await page.click('text=+ Adicionar outro texto');
ok('Tela: no máximo 4 textos (botão some)', (await page.$$('.texto-extra')).length===3&&await page.isHidden('text=+ Adicionar outro texto'));
await page.locator('.texto-extra').nth(2).locator('.remover-texto').click();await page.locator('.texto-extra').nth(1).locator('.remover-texto').click();
ok('Tela: remover textos volta a numeração', (await page.$$('.texto-extra')).length===1&&await page.isVisible('text=+ Adicionar outro texto'));
await paste('#comando','Os textos expressam interpretações divergentes. A divergência reside na avaliação sobre a');
for(const l of 'abcde')await paste('#alt-'+l,'Alternativa '+l);
await page.locator('.link-fonte').first().click();await page.fill('#ref-a','Disponível em: https://www.expedia.com.br. Acesso em: 14 out. 2025.');
await page.selectOption('#assunto','Romantismo');const subs=await page.$$eval('#subtema option',o=>o.map(x=>x.value).filter(Boolean));if(subs.length)await page.selectOption('#subtema',subs[0]);
await page.selectOption('#origem','enem');await page.selectOption('#dificuldade','Fácil');await page.selectOption('#bloom','Analisar');await page.selectOption('#gabarito','B');await page.evaluate(()=>tagsCampo.set(['guerra fria','dois textos']));
await page.check('.layout-box input[value="pagina"]');
await page.click('#visualizar');await page.waitForSelector('#previsao:not([hidden])');
const prev=await page.innerHTML('#previsao');
ok('Prévia: TEXTO I e TEXTO II com referências pequenas', prev.includes('TEXTO I</p>')&&prev.includes('TEXTO II</p>')&&(prev.match(/class="ref-fonte"/g)||[]).length===3, (prev.match(/class="ref-fonte"/g)||[]).length);
const fs8=await page.$eval('#previsao .ref-fonte',e=>getComputedStyle(e).fontSize+'|'+getComputedStyle(e).textAlign);
ok('Prévia: referência em fonte 8 e alinhada à direita', fs8.startsWith('10.6')&&fs8.endsWith('right'), fs8);
ok('Prévia: abre em largura total (o formato marcado)', await page.$eval('#previsao',e=>e.classList.contains('largura-total')));
await page.click('.largura-bar button[data-l="coluna"]');ok('Prévia: "Na coluna" estreita a prévia', await page.$eval('#previsao',e=>e.getBoundingClientRect().width<=345));
await page.locator('#previsao').screenshot({path:S+'previa-textos.png'});
await page.click('#enviar');await page.waitForFunction(()=>/Código/.test(document.querySelector('#status').textContent));
const cod=(await page.textContent('#status')).match(/[A-Z]\d{7}/)[0];d=(await call('/api/itens/'+cod,{token:tEdi})).data.item.dados;
ok('Tela: envio grava Texto II, fonte da A e largura total', d.textos_extras.length===1&&d['ref-a'].includes('\nAcesso em')&&d.layout==='pagina', JSON.stringify({e:d.textos_extras.length,l:d.layout}));
ok('Tela: após enviar, o formulário volta a 1 texto e 2 colunas', (await page.$$('.texto-extra')).length===0&&await page.isChecked('.layout-box input[value="coluna"]')&&(await page.inputValue('#ref-a'))==='');
// supervisor vê
await page.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('atlas_user_auth')});
db.exec('DELETE FROM login_rate_limits');await page.goto('https://idealolimpico.com.br/atlas/');await page.click('[data-role="Supervisor"]');await page.fill('#email','marcio.alex');await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');await page.fill('#code',lastCode());await page.click('#verifyButton');
await page.waitForURL(/supervisor\.html/);await page.waitForSelector('#queue table, table');
await page.locator('tr',{hasText:cod}).locator('button, a').first().click();await page.waitForSelector('#item-content .texto-titulo');
const sup=await page.textContent('#item-content');
ok('Supervisor vê TEXTO II, a fonte da alternativa e o formato', sup.includes('TEXTO II')&&sup.includes('expedia')&&sup.includes('Largura total'));
await page.click('#edit-item');await page.waitForSelector('#edit-form:not([hidden]) .texto-extra');
ok('Editor do Supervisor traz o Texto II e a fonte da A preenchidos', (await page.$$('#edit-form .texto-extra')).length===1&&(await page.inputValue('#ref-a')).includes('expedia')&&await page.isChecked('#edit-form .layout-box input[value="pagina"]'));
await page.check('#edit-form .layout-box input[value="coluna"]');
const cl=await page.$$('#ed-classif select');
await page.click('#save-edit');await page.waitForFunction(()=>/editada|Edição salva|salva/i.test(document.body.textContent),{timeout:8000}).catch(()=>{});
await page.waitForTimeout(800);d=(await call('/api/itens/'+cod,{token:tMarcio})).data.item.dados;
ok('Supervisor muda para 2 colunas sem perder o Texto II', d.layout==='coluna'&&d.textos_extras.length===1&&d['ref-a'].includes('expedia'), JSON.stringify({l:d.layout,e:d.textos_extras.length}));
// digitador / ADM
await page.goto('https://idealolimpico.com.br/atlas/admin-enviar.html');await page.evaluate(t=>sessionStorage.setItem('atlas_adm_token',t),tAdm);await page.reload();await page.waitForSelector('#es-form');
ok('Enviar questões (ADM) também tem Adicionar outro texto, fonte nas alternativas e formato', await page.isVisible('text=+ Adicionar outro texto')&&(await page.$$('.link-fonte')).length===5&&await page.isVisible('.layout-box'));
ok('Sem erros de JavaScript', errors.length===0, errors.join(' | '));
await browser.close();server.close();
for(const [s,n,e] of results)console.log(s,n,e?'— '+e:'');console.log(results.filter(r=>r[0]!=='OK  ').length+' falha(s) de '+results.length);process.exit(0);
