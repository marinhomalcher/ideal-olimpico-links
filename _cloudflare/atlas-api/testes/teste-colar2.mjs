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
const REF1='MAY, R. H. Disponível em: www.servicioskoinonia.org. Acesso em: 12 mar. 2016.';
const base={etapa:'em',origem:'autoral',dificuldade:'Média',assunto:'Romantismo',bloom:'Aplicar',comando:'C','alt-a':'A','alt-b':'B','alt-c':'C','alt-d':'D','alt-e':'E',gabarito:'A'};
let r=await call('/api/itens',{method:'POST',token:tEdi,body:{dados:{...base,referencia:REF1}}});
let d=(await call('/api/itens/'+r.data.item.codigo,{token:tEdi})).data.item.dados;
ok('Servidor: referência em uma linha é gravada com "Acesso em" na linha de baixo', d.referencia==='MAY, R. H. Disponível em: www.servicioskoinonia.org.\nAcesso em: 12 mar. 2016.', JSON.stringify(d.referencia));
const server = http.createServer(async (req, res) => { const chunks=[]; for await (const c of req) chunks.push(c); const request=new Request('https://atlas-api.test'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD','OPTIONS'].includes(req.method)?undefined:Buffer.concat(chunks)}); const response=await worker.fetch(request,env); res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(8796);
const K=S+'katexpkg/package/dist/';
const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:1280,height:900}});
await ctx.route('https://idealolimpico.com.br/atlas/**', route=>{const f=new URL(route.request().url()).pathname.replace('/atlas/','')||'index.html';const p=REPO+'atlas/'+f;if(!fs.existsSync(p))return route.fulfill({status:404,body:'nf'});route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'image/png',body:fs.readFileSync(p)})});
await ctx.route('https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/**', r2=>{const p=new URL(r2.request().url()).pathname.replace('/npm/katex@0.19.1/dist/','');r2.fulfill({status:200,headers:{'content-type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'font/'+p.split('.').pop(),'access-control-allow-origin':'*'},body:fs.readFileSync(K+p)})});
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route=>{const u=route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev','http://localhost:8796');const resp=await route.fetch({url:u,headers:{...route.request().headers(),origin:ORIGIN}});route.fulfill({response:resp})});
const page=await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const paste=(sel,text)=>page.evaluate(([sel,text])=>{const el=document.querySelector(sel);el.focus();const dt=new DataTransfer();dt.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},[sel,text]);
const ALTS='A\tcita casos de destruição ambiental (argumento de exemplificação), que comovem o leitor em relação ao meio ambiente.\nB\tapresenta definições de ética dadas por estudiosos (argumento de autoridade), para impressionar o leitor sobre o que vai ser defendido.\nC\tnega que a ética se baseia em regras (contestação da tese apresentada), chantageando o leitor em relação àquilo em que deve acreditar.\nD\targumenta que a crise é antropológica (antecipação de argumento) e, de antemão, intimida o leitor em relação à destruição da natureza.\nE\tafirma que a ética da Terra pode ser considerada um guia para enfrentar qualquer situação ecológica (argumento possível em favor da tese), o que confunde o leitor quanto ao axioma dado.';
db.exec('DELETE FROM login_rate_limits');await page.goto('https://idealolimpico.com.br/atlas/');await page.click('[data-role="Professor"]');await page.fill('#email','edi.franco');await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');await page.fill('#code',lastCode());await page.click('#verifyButton');
await page.waitForURL(/professor\.html/);await page.waitForFunction(()=>!document.querySelector('#questao-form').hidden);
await paste('#comando','Na construção da argumentação, o texto\n\n'+ALTS);await page.waitForTimeout(200);
const tx=async id=>(await page.textContent('#'+id)).trim();
ok('Comando + alternativas com tabulação (lista do Word): comando separado', (await tx('comando'))==='Na construção da argumentação, o texto', await tx('comando'));
ok('Alternativas A–E preenchidas sem a letra', (await tx('alt-a')).startsWith('cita casos')&&(await tx('alt-e')).startsWith('afirma que a ética')&&(await tx('alt-c')).startsWith('nega que'), await tx('alt-a'));
for(const l of 'abcde')await page.evaluate(id=>{document.getElementById(id).innerHTML=''},'alt-'+l);
await paste('#alt-a',ALTS);await page.waitForTimeout(200);
ok('Só as alternativas coladas no campo A também separam', (await tx('alt-b')).startsWith('apresenta definições')&&(await tx('alt-d')).startsWith('argumenta'), await tx('alt-b'));
await paste('#alt-a','A\tsó uma alternativa com tab');await page.waitForTimeout(100);
await page.evaluate(()=>{document.getElementById('alt-a').innerHTML=''});await paste('#alt-a','A\tsó uma alternativa com tab');await page.waitForTimeout(100);
ok('Uma alternativa só, com letra e tab: a letra sai', (await tx('alt-a'))==='só uma alternativa com tab', await tx('alt-a'));
// Letra + espaço ("A produção..."), formato comum ao copiar do Word/PDF.
const limparCampos=()=>page.evaluate(()=>{for(const id of ['comando','alt-a','alt-b','alt-c','alt-d','alt-e'])document.getElementById(id).innerHTML=''});
const DAVINCI='Da Vinci era polímata e registrava suas ideias e experimentos em códices. Seus esboços revelam sua incessante busca por conhecimento e expressam o(a)\n\nA produção de obras baseadas exclusivamente na fé religiosa, sem espaço para investigações científicas.\nB união de diferentes áreas do conhecimento para ampliar a compreensão do mundo e do ser humano.\nC imitação literal das obras medievais, mantendo o caráter simbólico e bidimensional das imagens.\nD separação entre arte e ciência, valorizando exclusivamente a estética nas obras.\nE abandono da técnica artística para privilegiar apenas o conteúdo intelectual das obras.\n';
await limparCampos();await paste('#comando',DAVINCI);await page.waitForTimeout(200);
ok('Letra + espaço colado no comando: comando separado', (await tx('comando'))==='Da Vinci era polímata e registrava suas ideias e experimentos em códices. Seus esboços revelam sua incessante busca por conhecimento e expressam o(a)', await tx('comando'));
ok('Letra + espaço: A–E preenchidas sem a letra', (await tx('alt-a'))==='produção de obras baseadas exclusivamente na fé religiosa, sem espaço para investigações científicas.'&&(await tx('alt-b')).startsWith('união de diferentes')&&(await tx('alt-e'))==='abandono da técnica artística para privilegiar apenas o conteúdo intelectual das obras.', await tx('alt-a')+' | '+await tx('alt-e'));
await limparCampos();await paste('#alt-a',DAVINCI.split('\n\n')[1]);await page.waitForTimeout(200);
ok('Letra + espaço só com as alternativas no campo A', (await tx('alt-a')).startsWith('produção de obras')&&(await tx('alt-d')).startsWith('separação entre arte'), await tx('alt-a'));
await limparCampos();await paste('#comando','A charge critica a política.\nE o autor ironiza o eleitor ao afirmar que\nA o voto é inútil.\nB a política é feita por todos.\nC o eleitor é responsável.\nD a imprensa é neutra.\nE o povo é passivo.');await page.waitForTimeout(200);
ok('Letra + espaço: "A"/"E" como palavra no comando não confundem', (await page.innerText('#comando')).trim().replace(/\s+/g,' ')==='A charge critica a política. E o autor ironiza o eleitor ao afirmar que', await page.innerText('#comando'));
ok('Letra + espaço: alternativas certas mesmo com "A" no comando', (await tx('alt-a'))==='o voto é inútil.'&&(await tx('alt-e'))==='o povo é passivo.', await tx('alt-a'));
await limparCampos();await paste('#comando','A professora leu o poema.\nE a turma discutiu o tema.');await page.waitForTimeout(200);
ok('Texto comum começando com "A"/"E": nada é separado', (await tx('alt-a'))===''&&(await tx('comando')).startsWith('A professora'), await tx('alt-a'));
await page.evaluate(()=>{document.getElementById('comando').textContent='Na construção da argumentação, o texto';document.getElementById('alt-a').textContent='só uma alternativa com tab';for(const l of 'bcde')document.getElementById('alt-'+l).innerHTML=''});
await page.click('#referencia');await page.evaluate(()=>navigator.clipboard?0:0);
await page.fill('#referencia',REF1);await page.click('#comando');
ok('Referência: ao sair do campo, "Acesso em" vai para a linha de baixo', (await page.inputValue('#referencia'))==='MAY, R. H. Disponível em: www.servicioskoinonia.org.\nAcesso em: 12 mar. 2016.', JSON.stringify(await page.inputValue('#referencia')));
await page.fill('#referencia','');await page.focus('#referencia');await page.evaluate(t=>{const el=document.getElementById('referencia');const dt=new DataTransfer();dt.setData('text/plain',t);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));el.value=t},REF1);await page.waitForTimeout(100);
ok('Referência: ao colar, já quebra a linha', (await page.inputValue('#referencia')).includes('.\nAcesso em:'));
// prévia
await page.selectOption('#assunto','Romantismo');const subs=await page.$$eval('#subtema option',o=>o.map(x=>x.value).filter(Boolean));if(subs.length)await page.selectOption('#subtema',subs[0]);
await page.selectOption('#origem','enem');await page.selectOption('#dificuldade','Fácil');await page.selectOption('#bloom','Analisar');await page.selectOption('#gabarito','D');
await paste('#texto-base','Uma boa ética não se baseia em regras e normas.');await page.evaluate(()=>tagsCampo.set(['argumentação','ética']));
for(const l of 'bcde')await page.evaluate(id=>{if(!document.getElementById(id).textContent.trim())document.getElementById(id).textContent='x'},'alt-'+l);
await page.click('#visualizar');await page.waitForSelector('#previsao:not([hidden])');
ok('Prévia mostra a referência em duas linhas', (await page.innerHTML('#previsao')).includes('servicioskoinonia.org.<br>Acesso em'));
await page.locator('#previsao').screenshot({path:S+'previa-ref.png'});
ok('Sem erros de JavaScript', errors.length===0, errors.join('|'));
await browser.close();server.close();
for(const [s,n,e] of results)console.log(s,n,e?'— '+e:'');console.log(results.filter(r=>r[0]!=='OK  ').length+' falha(s) de '+results.length);process.exit(0);
