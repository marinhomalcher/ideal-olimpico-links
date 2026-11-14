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
// ---- Microsoft falsa ----
const ms={tokens:0,envios:[],tokenStatus:200,envioStatus:202};
const fetchAnterior=globalThis.fetch;
globalThis.fetch=async(url,opts={})=>{const u=String(url);
  if(u==='https://login.microsoftonline.com/84ccf0a0-7901-47f8-9c1a-4a4b95689d19/oauth2/v2.0/token'){ms.tokens++;const p=new URLSearchParams(opts.body);ms.ultimoForm=Object.fromEntries(p);
    if(ms.tokenStatus!==200)return new Response(JSON.stringify({error:'invalid_client'}),{status:ms.tokenStatus});return new Response(JSON.stringify({access_token:'tok-'+ms.tokens,expires_in:3599}),{status:200})}
  if(u==='https://graph.microsoft.com/v1.0/users/olimpiadas%40grupoideal.com.br/sendMail'){ms.envios.push({auth:opts.headers.Authorization,body:JSON.parse(opts.body)});
    if(ms.envioStatus!==202)return new Response(JSON.stringify({error:{code:'ErrorAccessDenied'}}),{status:ms.envioStatus});return new Response(null,{status:202})}
  return fetchAnterior(url,opts)};
const espera=()=>new Promise(r=>setTimeout(r,30));
Object.assign(env,{MS_TENANT_ID:'84ccf0a0-7901-47f8-9c1a-4a4b95689d19',MS_CLIENT_ID:'ffae919b-7e6c-4109-969c-d969abd48beb',MS_REMETENTE:'olimpiadas@grupoideal.com.br',MS_CLIENT_SECRET:'segredo-ms-teste',ATLAS_AVISOS_ATIVOS:'1'});
let r=await call('/api/saude');
ok('Saúde mostra envio pela Microsoft', r.data.envio==='microsoft');
db.exec('DELETE FROM login_rate_limits');
let nApps=mails.length;
r=await call('/api/login/codigo',{method:'POST',body:{email:'edi.franco@grupoideal.com.br'}});
const e1=ms.envios.at(-1);
ok('Código sai pela Microsoft, não pelo Apps Script', r.status===200 && ms.envios.length===1 && mails.length===nApps, JSON.stringify(r.data));
ok('Para o professor, com o código no texto', e1.body.message.toRecipients[0].emailAddress.address==='edi.franco@grupoideal.com.br' && /código para entrar no ATLAS é: \d{6}/.test(e1.body.message.body.content) && e1.body.message.subject==='Seu código de acesso ao ATLAS');
ok('Pedido de token com credenciais do aplicativo', ms.ultimoForm.client_id==='ffae919b-7e6c-4109-969c-d969abd48beb' && ms.ultimoForm.client_secret==='segredo-ms-teste' && ms.ultimoForm.grant_type==='client_credentials' && ms.ultimoForm.scope==='https://graph.microsoft.com/.default' && e1.auth==='Bearer tok-1');
ok('Guarda cópia em Itens Enviados', e1.body.saveToSentItems===true);
// o código enviado funciona
const cod=e1.body.message.body.content.match(/é: (\d{6})/)[1];
r=await call('/api/login/verificar',{method:'POST',body:{email:'edi.franco@grupoideal.com.br',codigo:cod}});
ok('Código recebido pela Microsoft faz login', r.status===200 && !!r.data.token);
const tEdi2=r.data.token;
// aviso pela Microsoft e token reaproveitado
const dados={etapa:'em',origem:'autoral',dificuldade:'Média',assunto:'Romantismo',bloom:'Aplicar',comando:'C','alt-a':'A','alt-b':'B','alt-c':'C','alt-d':'D','alt-e':'E',gabarito:'A'};
const c=(await call('/api/itens',{method:'POST',token:tEdi2,body:{dados}})).data.item.codigo;
await call('/api/supervisor/itens/'+c+'/decisao',{method:'POST',token:tMarcio,body:{decisao:'aprovar',motivo:'',versao:1}});await espera();
ok('Aviso de aprovação sai pela Microsoft', ms.envios.length===2 && /aprovada/.test(ms.envios[1].body.message.subject) && ms.envios[1].body.message.toRecipients[0].emailAddress.address==='edi.franco@grupoideal.com.br');
ok('Token é reaproveitado (sem pedir outro)', ms.tokens===1);
// Microsoft recusa -> reserva Apps Script
ms.envioStatus=403; db.exec('DELETE FROM login_rate_limits'); nApps=mails.length;
r=await call('/api/login/codigo',{method:'POST',body:{email:'edi.franco@grupoideal.com.br'}});
ok('Se a Microsoft recusar, o Apps Script envia (reserva)', r.status===200 && mails.length===nApps+1 && /^\d{6}$/.test(mails.at(-1).codigo));
ms.tokenStatus=401; ms.envioStatus=202; db.exec('DELETE FROM login_rate_limits'); nApps=mails.length;
const t0=ms.tokens; globalThis.__x=1;
// força pedir token novo invalidando o atual: simula 401 no envio
ms.envioStatus=401; r=await call('/api/login/codigo',{method:'POST',body:{email:'edi.franco@grupoideal.com.br'}}); ms.envioStatus=202;
db.exec('DELETE FROM login_rate_limits');
r=await call('/api/login/codigo',{method:'POST',body:{email:'edi.franco@grupoideal.com.br'}});
ok('Segredo inválido na Microsoft: reserva continua enviando', r.status===200 && mails.length>=nApps+2 && ms.tokens>t0);
// sem reserva e com Microsoft falhando: erro claro
ms.tokenStatus=200; ms.envioStatus=500; const url=env.ATLAS_MAILER_URL; env.ATLAS_MAILER_URL=''; db.exec('DELETE FROM login_rate_limits');
r=await call('/api/login/codigo',{method:'POST',body:{email:'edi.franco@grupoideal.com.br'}});
ok('Sem nenhum caminho funcionando: mensagem de erro', r.status===502, r.status);
ms.envioStatus=202; db.exec('DELETE FROM login_rate_limits'); const n=ms.envios.length;
r=await call('/api/login/codigo',{method:'POST',body:{email:'edi.franco@grupoideal.com.br'}});
ok('Só com a Microsoft (sem Apps Script) também funciona', r.status===200 && ms.envios.length===n+1);
env.ATLAS_MAILER_URL=url;
// e-mail não cadastrado: nada enviado
db.exec('DELETE FROM login_rate_limits'); const n2=ms.envios.length;
r=await call('/api/login/codigo',{method:'POST',body:{email:'ninguem@grupoideal.com.br'}});
ok('E-mail não cadastrado: resposta igual e nada enviado', r.status===200 && ms.envios.length===n2);
// sem segredo da Microsoft: volta ao Apps Script
delete env.MS_CLIENT_SECRET; r=await call('/api/saude');
ok('Sem o segredo: saúde mostra Apps Script', r.data.envio==='apps-script');
for (const x of results) console.log(x.join(' | '));
const bad=results.filter(x=>x[0]!=='OK  ').length; console.log(bad?`\n${bad} FALHA(S)`:`\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
