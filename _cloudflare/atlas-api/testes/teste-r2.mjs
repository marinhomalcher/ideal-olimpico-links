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

async function tok(email){db.exec('DELETE FROM login_rate_limits');await call('/api/login/codigo',{method:'POST',body:{email}});return (await call('/api/login/verificar',{method:'POST',body:{email,codigo:lastCode()}})).data.token}
const tEdi=await tok('edi.franco@grupoideal.com.br'), tMarcio=await tok('marcio.alex@grupoideal.com.br');
const tAdm=(await call('/api/adm/login',{method:'POST',body:{credential:await jwt({})}})).data.token;
async function raw(path,{token,type='image/png',bytes,method='POST'}={}){const headers={Origin:ORIGIN};if(token)headers.Authorization='Bearer '+token;if(type)headers['Content-Type']=type;
  const res=await worker.fetch(new Request('https://atlas-api.test'+path,{method,headers,body:bytes}),env);return {status:res.status,data:await res.json().catch(()=>null)}}
async function getImg(link){const u=new URL(link);const res=await worker.fetch(new Request('https://atlas-api.test'+u.pathname+u.search),env);return {status:res.status,type:res.headers.get('content-type'),bytes:new Uint8Array(await res.arrayBuffer())}}
const png=new Uint8Array(fs.readFileSync(REPO+'atlas/ideal-logo.png'));
let r=await raw('/api/imagens',{bytes:png});
ok('Envio de imagem exige login', r.status===401);
r=await raw('/api/imagens',{token:tEdi,bytes:png,type:'image/gif'});
ok('Tipo não permitido recusado', r.status===415);
r=await raw('/api/imagens',{token:tEdi,bytes:new Uint8Array(3*1024*1024+10)});
ok('Imagem acima de 3 MB recusada', r.status===413);
r=await raw('/api/imagens',{token:tEdi,bytes:png});
const link=r.data?.url;
ok('Professor envia imagem: recebe link assinado', r.status===200 && /^https:\/\/atlas-api\.marinhomalcher\.workers\.dev\/img\/[0-9a-f]{32}\?e=\d+&s=[0-9a-f]{64}$/.test(link), link);
ok('Imagem guardada no R2 com tipo', r2store.size===1 && [...r2store.values()][0].o.httpMetadata.contentType==='image/png');
let g=await getImg(link);
ok('Link assinado entrega a imagem', g.status===200 && g.type==='image/png' && g.bytes.length===png.length);
g=await getImg(link.replace(/s=./,'s='+(link.match(/s=(.)/)[1]==='0'?'1':'0')));
ok('Assinatura adulterada: 404', g.status===404);
g=await getImg(link.replace(/img\/[0-9a-f]{32}/,'img/'+'0'.repeat(32)));
ok('Outro id com a mesma assinatura: 404', g.status===404);
const sec='segredo-de-teste';
async function hmac(t){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(sec),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Buffer.from(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(t))).toString('hex')}
const id=link.match(/img\/([0-9a-f]{32})/)[1];const expV=Math.floor(Date.now()/1000)-60;
const vencido='https://atlas-api.marinhomalcher.workers.dev/img/'+id+'?e='+expV+'&s='+await hmac('img:'+id+':'+expV);
g=await getImg(vencido);
ok('Link vencido: 403', g.status===403);
r=await raw('/api/adm/imagens',{token:tAdm,bytes:png});
ok('ADM também envia imagem', r.status===200 && r2store.size===2);
// salvar questão com a imagem
const dados={etapa:'em',origem:'autoral',dificuldade:'Média',assunto:'Romantismo',bloom:'Aplicar',comando:'Veja: <img src="'+link.replace(/&/g,'&amp;')+'" alt="x" style="width: 50%;">',
 'alt-a':'A','alt-b':'B','alt-c':'C','alt-d':'D','alt-e':'E',gabarito:'A','texto-base':'<img src="'+vencido.replace(/&/g,'&amp;')+'">'};
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados}});
const cod=r.data?.item?.codigo;
ok('Questão salva com imagem do R2 (link vencido também vale ao salvar)', r.status===200, r.data?.error);
const salvo=JSON.parse(db.prepare('SELECT v.dados FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=?').get(cod).dados);
ok('Banco guarda só o endereço curto', salvo.comando.includes('src="atlas:img/'+id+'"') && salvo['texto-base'].includes('atlas:img/'+id) && !salvo.comando.includes('https://'), salvo.comando);
r=await call('/api/itens/'+cod,{token:tMarcio});
const devolvido=r.data.item.dados.comando.match(/src="([^"]+)"/)[1].replace(/&amp;/g,'&');
g=await getImg(devolvido);
ok('Ao ler, o servidor devolve link assinado novo que funciona', /\/img\/[0-9a-f]{32}\?e=/.test(devolvido) && g.status===200);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...dados,comando:'<img src="https://site-qualquer.com/rastreio.png">','texto-base':''}}});
ok('Imagem de outro site recusada', r.status===400);
r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...dados,comando:'<img src="'+link.replace(/s=[0-9a-f]{4}/,'s=ffff')+'">','texto-base':''}}});
ok('Link com assinatura adulterada recusado ao salvar', r.status===400);
r=await call('/api/imagens/links',{method:'POST',token:tEdi,body:{links:[vencido]}});
g=await getImg(r.data.links[vencido]);
ok('Renovação de link vencido (rascunho antigo)', r.status===200 && g.status===200);
// CORS do DELETE (excluir seleção)
const op=await worker.fetch(new Request('https://atlas-api.test/api/supervisor/selecoes/1',{method:'OPTIONS',headers:{Origin:ORIGIN}}),env);
ok('CORS libera DELETE (excluir seleção no navegador)', /DELETE/.test(op.headers.get('access-control-allow-methods')));
// migração das imagens antigas
const b64=Buffer.from(png).toString('base64');
const antigo={...dados,comando:'<img src="data:image/png;base64,'+b64+'" style="width: 40%;"> e <img src="data:image/png;base64,'+b64+'">','texto-base':''};
const cOld=(await call('/api/itens',{method:'POST',token:tEdi,body:{dados:antigo}})).data.item.codigo;
r=await call('/api/adm/imagens/situacao',{token:tAdm});
ok('ADM vê quantas versões têm imagem antiga', r.data.versoes_com_imagem_antiga===1 && r.data.r2===true);
r=await call('/api/adm/imagens/migrar',{method:'POST',token:tMarcio,body:{}});
ok('Migração só pelo ADM', r.status===401);
const antes=r2store.size;
r=await call('/api/adm/imagens/migrar',{method:'POST',token:tAdm,body:{}});
ok('Migração move as imagens e zera pendências', r.status===200 && r.data.imagens===2 && r.data.faltam===0 && r2store.size===antes+2, JSON.stringify(r.data));
const mig=JSON.parse(db.prepare('SELECT v.dados FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=?').get(cOld).dados);
ok('Texto preservado, largura mantida, sem base64', !mig.comando.includes('base64') && /<img src="atlas:img\/[0-9a-f]{32}" style="width: 40%;"> e <img src="atlas:img\/[0-9a-f]{32}">/.test(mig.comando), mig.comando);
r=await call('/api/adm/itens/'+cOld,{token:tAdm});
g=await getImg(r.data.item.dados.comando.match(/src="([^"]+)"/)[1].replace(/&amp;/g,'&'));
ok('Imagem migrada abre igual à original', g.status===200 && Buffer.from(g.bytes).equals(Buffer.from(png)));

// ===== telas =====
const server = http.createServer(async (req, res) => { const chunks=[]; for await (const c of req) chunks.push(c); const request=new Request('https://atlas-api.test'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD','OPTIONS'].includes(req.method)?undefined:Buffer.concat(chunks)}); const response=await worker.fetch(request,env); res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(8790);
const K=S+'katexpkg/package/dist/';
const browser=await chromium.launch(); const ctx=await browser.newContext({deviceScaleFactor:1.5,viewport:{width:1280,height:900}});
await ctx.route('https://idealolimpico.com.br/atlas/**', route=>{const f=new URL(route.request().url()).pathname.replace('/atlas/','')||'index.html';const p=REPO+'atlas/'+f;if(!fs.existsSync(p))return route.fulfill({status:404,body:'nf'});route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'image/png',body:fs.readFileSync(p)})});
await ctx.route('https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/**', r2=>{const p=new URL(r2.request().url()).pathname.replace('/npm/katex@0.19.1/dist/','');r2.fulfill({status:200,headers:{'content-type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'font/'+p.split('.').pop(),'access-control-allow-origin':'*'},body:fs.readFileSync(K+p)})});
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route=>{const u=route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev','http://localhost:8790');const resp=await route.fetch({url:u,headers:{...route.request().headers(),origin:ORIGIN}});route.fulfill({response:resp})});
const page=await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.dismiss()});
const paste=(sel,text)=>page.evaluate(([sel,text])=>{const el=document.querySelector(sel);el.focus();const dt=new DataTransfer();dt.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},[sel,text]);
async function pasteImage(sel,w,h){await page.evaluate(async([sel,w,h])=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,w,h);g.strokeStyle='#000';g.lineWidth=6;g.strokeRect(10,10,w-20,h-20);g.font='60px Arial';g.fillStyle='#000';g.fillText('Tabela de teste',40,h/2);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const file=new File([blob],'print.png',{type:'image/png'});const el=document.querySelector(sel);el.focus();const dt=new DataTransfer();dt.items.add(file);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},[sel,w,h]);await page.waitForSelector(sel+' img');}
async function login(card,user){db.exec('DELETE FROM login_rate_limits');await page.goto('https://idealolimpico.com.br/atlas/');await page.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('atlas_user_auth')});await page.goto('https://idealolimpico.com.br/atlas/');await page.click(`[data-role="${card}"]`);await page.fill('#email',user);await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');await page.fill('#code',lastCode());await page.click('#verifyButton');}
const ratio=sel=>page.$eval(sel,i=>{const r=i.getBoundingClientRect();return {w:r.width,h:r.height,ar:r.height/r.width,nat:i.naturalHeight/i.naturalWidth,style:i.style.width,area:i.closest('.rich-editor,.stem,.choice,.question')?.clientWidth}});
await login('Professor','telma.paes');await page.waitForURL(/professor\.html/);await page.waitForFunction(()=>!document.querySelector('#questao-form').hidden);
const n0=r2store.size;
await pasteImage('#texto-base',900,400);
await page.waitForFunction(()=>{const i=document.querySelector('#texto-base img');return i&&i.complete&&i.naturalWidth>0});
const src=await page.$eval('#texto-base img',i=>i.getAttribute('src'));
ok('Tela: imagem colada vai para o R2 e aparece', /\/img\/[0-9a-f]{32}\?e=/.test(src) && r2store.size===n0+1, src.slice(0,80));
await page.selectOption('#assunto','Romantismo');const subs=await page.$$eval('#subtema option',o=>o.map(x=>x.value).filter(Boolean));if(subs.length)await page.selectOption('#subtema',subs[0]);
await page.selectOption('#origem','autoral');await page.selectOption('#dificuldade','Fácil');await page.selectOption('#bloom','Lembrar');
await paste('#comando','Observe a figura.');for(const l of 'abcde')await paste('#alt-'+l,'Opção '+l);await page.selectOption('#gabarito','B');
await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#visualizar');await page.waitForFunction(()=>{const i=document.querySelector('#previsao .stem img');return i&&i.complete&&i.naturalWidth>0});
ok('Tela: prévia mostra a imagem', true);
await page.evaluate(()=>{try{if(typeof tagsCampo!=='undefined'&&tagsCampo.get().length<2)tagsCampo.set(['teste','ui'])}catch{}});await page.click('#enviar');await page.waitForFunction(()=>/Código: L\d{7}/.test(document.querySelector('#status').textContent),null,{timeout:8000}).catch(()=>{});
const codT=((await page.textContent('#status')).match(/L\d{7}/)||[])[0];
const sT=JSON.parse(db.prepare('SELECT v.dados FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=?').get(codT).dados)['texto-base'];
ok('Tela: banco guarda endereço curto (sem base64)', /src="atlas:img\/[0-9a-f]{32}"/.test(sT) && !sT.includes('base64'), sT.slice(0,90));
await login('Supervisor','marcio.alex');await page.waitForURL(/supervisor\.html/);await page.waitForFunction(()=>document.querySelectorAll('#list tbody tr').length>0);
await page.locator('#list tr',{hasText:codT}).locator('button').click();await page.waitForSelector('#details:not([hidden])');
await page.waitForFunction(()=>{const i=document.querySelector('#item-content .stem img');return i&&i.complete&&i.naturalWidth>0},null,{timeout:8000}).catch(()=>{});
ok('Tela: Supervisor vê a imagem', await page.$eval('#item-content .stem img',i=>i.naturalWidth>0));
await page.click('#edit-item');await page.waitForSelector('#edit-form:not([hidden])');await paste('#comando',' Editado.');await page.click('#save-edit');
await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('versão 2'));
const sT2=JSON.parse(db.prepare('SELECT v.dados FROM item_versoes v JOIN itens i ON i.id=v.item_id WHERE i.codigo=? AND v.versao=2').get(codT).dados)['texto-base'];
ok('Tela: edição do Supervisor mantém a imagem no R2', sT2===sT, sT2.slice(0,90));
ok('Sem erros de JavaScript nem caixas do navegador', errors.length===0 && dialogs.length===0, errors.join(' | ')+dialogs.join('|'));
await browser.close(); server.close();
for (const x of results) console.log(x.join(' | '));
const bad=results.filter(x=>x[0]!=='OK  ').length; console.log(bad?`\n${bad} FALHA(S)`:`\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
