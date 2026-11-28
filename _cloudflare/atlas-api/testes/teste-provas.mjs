// Provas do bimestre e Diagramador: formato definido pelo ADM, trava de quantidade, reaproveitar, fechamento com Word
// e e-mail ao Diagramador, link assinado, telas (Avaliações, supervisor, cadastro). Dados fictícios.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const S = (process.env.ATLAS_TESTE_TMP || '/tmp/atlas-testes') + '/';   // dependências (katex, exceljs) e prints
const REPO = fileURLToPath(new URL('../../../', import.meta.url));   // raiz do repositório
const worker = (await import(pathToFileURL(REPO + '_cloudflare/atlas-api/worker.js').href + '?' + Date.now())).default;
const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'OK  ' : 'FALHOU', name, String(extra).slice(0, 160)]);
const ANO = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date()));   // ano atual (os relatórios usam o relógio real)

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

// porta própria desta suíte (as suítes rodam uma de cada vez, mas não compartilham a 8791)
const PORTA=8793;
// mais professores: supervisores de Matemática e de Física (fictícios) e questões aprovadas de cada um
db.exec("INSERT INTO usuarios (nome,email,disciplina,papel) VALUES ('Sup Mat','sup.mat@grupoideal.com.br','Matemática','supervisor'),('Prof Mat','prof.mat@grupoideal.com.br','Matemática','professor'),('Sup Fis','sup.fis@grupoideal.com.br','Física','supervisor'),('Prof Fis','prof.fis@grupoideal.com.br','Física','professor')");
const tSupMat=await tok('sup.mat@grupoideal.com.br'), tProfMat=await tok('prof.mat@grupoideal.com.br'), tSupFis=await tok('sup.fis@grupoideal.com.br'), tProfFis=await tok('prof.fis@grupoideal.com.br');
const mats=[];for(let k=0;k<4;k++)mats.push(await aprovada({assunto:'Funções',comando:'Questão de matemática '+k+' com fórmula <span class="atlas-equation" data-latex="x^2"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span></span></span>'},tProfMat,tSupMat));
const fiss=[];for(let k=0;k<2;k++)fiss.push(await aprovada({assunto:'Cinemática',comando:'Questão de física '+k},tProfFis,tSupFis));
const dataAplic=ANO+'-12-18';
let r=await call('/api/saude');
ok('Schema 22', r.data.schema==='22', r.data.schema);

// ===== ADM: formato da prova =====
r=await call('/api/adm/provas',{method:'POST',token:tMarcio,body:{}});
ok('Provas exigem sessão de ADM', r.status===401, r.status);
const fmt=(extra={})=>({ano:ANO,bimestre:4,serie:2,tipo:'MED',modalidade:'ENEM2',aplicacao:dataAplic,disciplinas:[{disciplina:'Matemática',quantidade:3},{disciplina:'Física',quantidade:2}],...extra});
r=await call('/api/adm/provas',{method:'POST',token:tAdm,body:fmt({aplicacao:''})});
ok('Data de aplicação é obrigatória', r.status===400 && /aplicação/.test(r.data.error), r.data.error);
r=await call('/api/adm/provas',{method:'POST',token:tAdm,body:fmt({disciplinas:[{disciplina:'Literatura',quantidade:5}]})});
ok('ENEM 2º dia não aceita Literatura', r.status===400 && /2º dia/.test(r.data.error), r.data.error);
r=await call('/api/adm/provas',{method:'POST',token:tAdm,body:fmt({modalidade:'ENEM1'})});
ok('ENEM 1º dia não aceita Matemática', r.status===400 && /1º dia/.test(r.data.error), r.data.error);
r=await call('/api/adm/provas',{method:'POST',token:tAdm,body:fmt({tipo:'XYZ'})});
ok('Turma inválida recusada', r.status===400, r.data.error);
r=await call('/api/adm/provas',{method:'POST',token:tAdm,body:fmt({disciplinas:[]})});
ok('Prova sem disciplina recusada', r.status===400, r.data.error);
r=await call('/api/adm/provas',{method:'POST',token:tAdm,body:fmt()});
const P1=r.data.prova.id; ok('ADM cria a prova 2ª MED · ENEM 2º dia (Matemática 3, Física 2)', r.status===200 && P1>0, JSON.stringify(r.data));
r=await call('/api/adm/provas',{method:'POST',token:tAdm,body:fmt({tipo:'MIL'})});
const P2=r.data.prova.id; ok('ADM cria a mesma prova para a turma MIL', r.status===200 && P2>0, JSON.stringify(r.data));
r=await call('/api/adm/provas',{method:'POST',token:tAdm,body:fmt({modalidade:'PART',tipo:'REG',disciplinas:[{disciplina:'Literatura',quantidade:2},{disciplina:'Matemática',quantidade:1}]})});
const P3=r.data.prova.id; ok('ADM cria um simulado particular 2ª REG (Literatura 2, Matemática 1)', r.status===200 && P3>0);
r=await call('/api/adm/provas?ano='+ANO+'&bimestre=4',{token:tAdm});
const p1=r.data.provas.find(p=>p.id===P1);
ok('Lista do ADM traz as provas com as disciplinas na ordem do caderno e o supervisor de cada uma', r.data.provas.length===3 && p1.situacao==='aberta' && p1.disciplinas.map(d=>d.disciplina).join()==='Física,Matemática' && p1.disciplinas[1].supervisor==='Sup Mat' && p1.disciplinas.every(d=>d.selecao===null), JSON.stringify(p1));
r=await call('/api/adm/provas/'+P1,{method:'PUT',token:tAdm,body:fmt({disciplinas:[{disciplina:'Matemática',quantidade:3},{disciplina:'Física',quantidade:2},{disciplina:'Química',quantidade:1}]})});
ok('ADM edita o formato enquanto aberta (acrescenta Química)', r.status===200, JSON.stringify(r.data));
r=await call('/api/adm/provas/'+P1,{method:'PUT',token:tAdm,body:fmt()});
ok('ADM tira a Química de novo', r.status===200);

// ===== supervisor: provas abertas, seleção da prova, trava =====
r=await call('/api/supervisor/selecoes',{token:tSupMat});
ok('Supervisor de Matemática vê as 3 provas abertas com a quantidade dele', r.data.provas.length===3 && r.data.provas.every(p=>p.disciplina==='Matemática') && r.data.provas.find(p=>p.id===P1).quantidade===3 && r.data.provas.find(p=>p.id===P3).quantidade===1, JSON.stringify(r.data.provas));
r=await call('/api/supervisor/selecoes',{token:tMarcio});
ok('Supervisor de Literatura só vê a prova em que Literatura entra', r.data.provas.length===1 && r.data.provas[0].id===P3, JSON.stringify(r.data.provas));
r=await call('/api/supervisor/selecoes',{method:'POST',token:tMarcio,body:{prova_id:P1}});
ok('Supervisor não entra em prova sem a disciplina dele', r.status===404, r.data.error);
r=await call('/api/supervisor/selecoes',{method:'POST',token:tSupMat,body:{prova_id:P1}});
const sMat=r.data.selecao.id; ok('Supervisor de Matemática começa a seleção da prova', r.status===200 && sMat>0, JSON.stringify(r.data));
r=await call('/api/supervisor/selecoes/'+sMat,{token:tSupMat});
ok('Seleção nasce com série e turma da prova e traz a prova', r.data.selecao.serie===2 && r.data.selecao.tipo==='MED' && r.data.selecao.prova && r.data.selecao.prova.quantidade===3 && r.data.selecao.prova.modalidade==='ENEM2', JSON.stringify(r.data.selecao.prova));
r=await call('/api/supervisor/selecoes',{method:'POST',token:tSupMat,body:{prova_id:P1}});
ok('Não começa duas seleções para a mesma prova', r.status===409 && r.data.error.includes('#'+sMat), r.data.error);
r=await call('/api/supervisor/selecoes',{token:tSupMat});
ok('Lista marca a prova já começada', r.data.provas.find(p=>p.id===P1).selecao_id===sMat && r.data.selecoes[0].prova.id===P1);
r=await call('/api/supervisor/selecoes/'+sMat,{method:'PUT',token:tSupMat,body:{itens:[mats[0],mats[1]],serie:1,tipo:'REG'}});
ok('Série e turma da seleção de prova não mudam pelo corpo', r.status===200 && db.prepare('SELECT serie, tipo FROM selecoes WHERE id=?').get(sMat).tipo==='MED', JSON.stringify(r.data));
r=await call('/api/supervisor/selecoes/'+sMat+'/enviar',{method:'POST',token:tSupMat,body:{}});
ok('Trava: não finaliza com menos questões', r.status===409 && /Faltam 1/.test(r.data.error), r.data.error);
await call('/api/supervisor/selecoes/'+sMat,{method:'PUT',token:tSupMat,body:{itens:mats}});
r=await call('/api/supervisor/selecoes/'+sMat+'/enviar',{method:'POST',token:tSupMat,body:{}});
ok('Trava: não finaliza com mais questões', r.status===409 && /1 questões a mais/.test(r.data.error), r.data.error);
await call('/api/supervisor/selecoes/'+sMat,{method:'PUT',token:tSupMat,body:{itens:mats.slice(0,3)}});
let n0=mails.length;
r=await call('/api/supervisor/selecoes/'+sMat+'/enviar',{method:'POST',token:tSupMat,body:{}}); await espera();
ok('Finaliza com a quantidade exata; prova segue aberta (falta Física); ADM avisado', r.status===200 && r.data.prova_fechada===false && r.data.faltam.join()==='Física' && mails.length===n0+1 && /finalizou a seleção/.test(mails.at(-1).texto), JSON.stringify(r.data)+' '+mails.at(-1)?.assunto);
r=await call('/api/adm/provas/'+P1,{method:'PUT',token:tAdm,body:fmt({disciplinas:[{disciplina:'Matemática',quantidade:5},{disciplina:'Física',quantidade:2}]})});
ok('ADM não muda a quantidade de disciplina já finalizada', r.status===409, r.data.error);
r=await call('/api/adm/provas/'+P1,{method:'PUT',token:tAdm,body:fmt({disciplinas:[{disciplina:'Física',quantidade:2}]})});
ok('ADM não tira disciplina com seleção', r.status===409, r.data.error);
r=await call('/api/adm/provas/'+P1,{method:'DELETE',token:tAdm});
ok('ADM não exclui prova com seleção', r.status===409, r.data.error);
r=await call('/api/adm/provas/'+P1+'/word',{token:tAdm});
ok('Word só depois de fechar', r.status===409, r.data?.error);

// ===== reaproveitar (MED -> MIL) =====
r=await call('/api/supervisor/selecoes',{method:'POST',token:tSupMat,body:{prova_id:P2,reaproveitar:sMat}});
const sMatMil=r.data.selecao.id;
ok('Reaproveitar copia as 3 questões da MED para a MIL', r.status===200 && r.data.copiadas===3 && r.data.ignoradas.length===0 && db.prepare('SELECT COUNT(*) n FROM selecao_itens WHERE selecao_id=?').get(sMatMil).n===3, JSON.stringify(r.data));
r=await call('/api/supervisor/selecoes',{method:'POST',token:tSupMat,body:{prova_id:P3,reaproveitar:sMat}});
ok('Reaproveitar em outra série/turma também funciona (nada aplicado ainda)', r.status===200 && r.data.copiadas===3, JSON.stringify(r.data));
await call('/api/supervisor/selecoes/'+r.data.selecao.id,{method:'DELETE',token:tSupMat});
ok('Excluir o rascunho libera a prova para começar de novo', db.prepare('SELECT selecao_id FROM prova_disciplinas WHERE prova_id=? AND disciplina=?').get(P3,'Matemática').selecao_id===null);
r=await call('/api/supervisor/selecoes',{method:'POST',token:tMarcio,body:{prova_id:P3,reaproveitar:sMat}});
ok('Não reaproveita seleção de outra disciplina', r.status===404, r.data.error);

// ===== Diagramador no cadastro e fechamento da prova =====
r=await call('/api/adm/pessoas',{method:'POST',token:tAdm,body:{nome:'Diagramador Fictício',email:'diagramador.teste',diagramador:true}});
ok('ADM cadastra Diagramador só com nome e e-mail', r.status===200 && r.data.pessoas.some(p=>p.nome==='Diagramador Fictício' && p.diagramador===true && !p.banco), JSON.stringify(r.data).slice(0,200));
db.exec('DELETE FROM login_rate_limits');
r=await call('/api/login/codigo',{method:'POST',body:{email:'diagramador.teste@grupoideal.com.br'}});
ok('Diagramador não recebe código de acesso', r.status===403 && /não entra/.test(r.data.error), r.data.error);
r=await call('/api/supervisor/selecoes',{method:'POST',token:tSupFis,body:{prova_id:P1}});
const sFis=r.data.selecao.id;
await call('/api/supervisor/selecoes/'+sFis,{method:'PUT',token:tSupFis,body:{itens:fiss}});
n0=mails.length;
r=await call('/api/supervisor/selecoes/'+sFis+'/enviar',{method:'POST',token:tSupFis,body:{}}); await espera();
const prova1=db.prepare('SELECT * FROM provas WHERE id=?').get(P1);
ok('Última disciplina fecha a prova: Word no R2, e-mail ao Diagramador, situação "enviada"', r.status===200 && r.data.prova_fechada===true && r.data.prova_enviada===true && prova1.situacao==='enviada' && !!prova1.arquivo && JSON.parse(prova1.enviada_para).join()==='diagramador.teste@grupoideal.com.br', JSON.stringify({r:r.data,p:{s:prova1.situacao,a:prova1.arquivo,e:prova1.enviada_para}}));
const mDiag=mails.find(m=>m.email==='diagramador.teste@grupoideal.com.br');
ok('E-mail ao Diagramador: assunto com a prova, texto com disciplinas, quantidade e link do Word', !!mDiag && /2ª série · MED · Simulado ENEM · 2º dia/.test(mDiag.assunto) && /Física 2, Matemática 3/.test(mDiag.texto) && /numeradas de 91 a 95/.test(mDiag.texto) && /https:\/\/atlas-api\.marinhomalcher\.workers\.dev\/provas\/\d+\/[^?\s]+\?e=\d+&s=[0-9a-f]{64}/.test(mDiag.texto), mDiag?.texto?.slice(0,300));
ok('ADM avisado do fechamento', mails.some(m=>m.email==='marinhomalcher@gmail.com' && /fechada e enviada ao Diagramador/.test(m.assunto)));
const docx=r2store.get(prova1.arquivo)?.bytes;
ok('Word no R2 é um .docx (ZIP) com o nome certo', !!docx && docx[0]===0x50 && docx[1]===0x4b && prova1.arquivo.endsWith('Prova_2MED_4BIM_ENEM_2DIA_'+ANO+'.docx'), prova1.arquivo);
// lê o document.xml de dentro do ZIP (sem biblioteca: entradas "stored" ou "deflate")
function lerZip(u){const out={};const dv=new DataView(u.buffer,u.byteOffset,u.byteLength);let i=0;while(i+30<=u.length&&dv.getUint32(i,true)===0x04034b50){const metodo=dv.getUint16(i+8,true),cs=dv.getUint32(i+18,true),nl=dv.getUint16(i+26,true),el=dv.getUint16(i+28,true);const nome=Buffer.from(u.subarray(i+30,i+30+nl)).toString('utf8');const dados=u.subarray(i+30+nl+el,i+30+nl+el+cs);out[nome]=metodo===8?zlib.inflateRawSync(Buffer.from(dados)):Buffer.from(dados);i+=30+nl+el+cs}return out}
const partes=lerZip(docx);const docXml=partes['word/document.xml']?.toString('utf8')||'';
ok('document.xml: cabeçalhos por disciplina, numeração 91 a 95, QUESTÃO 91 em Física, equação OMML', /FÍSICA\/2ª SÉRIE - MED\/SIMULADO ENEM/.test(docXml) && /MATEMÁTICA\/2ª SÉRIE - MED\/SIMULADO ENEM/.test(docXml) && /questões 91 a 92/.test(docXml) && /questões 93 a 95/.test(docXml) && docXml.includes('QUESTÃO 91') && docXml.includes('QUESTÃO 95') && docXml.includes('<m:sSup>') && docXml.indexOf('FÍSICA/')<docXml.indexOf('MATEMÁTICA/'), docXml.length+' bytes');
ok('document.xml: letras das alternativas sem negrito e com recuo', /<w:ind w:left="425" w:hanging="425"\/>/.test(docXml) && !/<w:b\/><\/w:rPr><w:t xml:space="preserve">A\)/.test(docXml));
ok('Aplicação na data certa no cabeçalho', docXml.includes('Aplicação: 18/12/'+ANO));
const link=mDiag.texto.match(/https:\/\/atlas-api\.marinhomalcher\.workers\.dev(\/provas\/[^\s]+)/)[1];
let res=await worker.fetch(new Request('https://atlas-api.test'+link),env);
ok('Link assinado do e-mail baixa o Word sem login', res.status===200 && /attachment; filename="Prova_2MED/.test(res.headers.get('content-disposition')) && (await res.arrayBuffer()).byteLength===docx.length, res.status);
res=await worker.fetch(new Request('https://atlas-api.test'+link.replace(/s=[0-9a-f]{8}/,'s=00000000')),env);
ok('Link adulterado é recusado', res.status===404, res.status);
r=await call('/api/adm/provas/'+P1+'/word',{token:tAdm});
ok('ADM baixa o Word pela área de Avaliações', r.status===200 && /attachment/.test(r.headers.get('content-disposition')) && r.headers.get('content-type').includes('wordprocessingml'), r.status);
n0=mails.length;
r=await call('/api/adm/provas/'+P1+'/enviar',{method:'POST',token:tAdm,body:{}}); await espera();
ok('ADM reenvia o e-mail ao Diagramador', r.status===200 && r.data.para.join()==='diagramador.teste@grupoideal.com.br' && mails.length===n0+1 && /reenvio/.test(mails.at(-1).assunto) && !!db.prepare('SELECT reenviada_em FROM provas WHERE id=?').get(P1).reenviada_em, JSON.stringify(r.data));
r=await call('/api/adm/selecoes/'+sFis+'/devolver',{method:'POST',token:tAdm,body:{motivo:'Troque a questão 2'}});
ok('Seleção de prova já enviada ao Diagramador não é devolvida', r.status===409 && /Diagramador/.test(r.data.error), r.data.error);
r=await call('/api/adm/selecoes/'+sFis+'/aplicar',{method:'POST',token:tAdm,body:{}});
ok('Seleção de prova não é aplicada sozinha', r.status===409 && /Avaliações/.test(r.data.error), r.data.error);
r=await call('/api/adm/provas/'+P1+'/aplicar',{method:'POST',token:tAdm,body:{}});
ok('ADM marca a prova como aplicada: as duas seleções ficam aplicadas', r.status===200 && db.prepare("SELECT COUNT(*) n FROM selecoes WHERE prova_id=? AND situacao='aplicada'").get(P1).n===2 && db.prepare('SELECT situacao s FROM provas WHERE id=?').get(P1).s==='aplicada', JSON.stringify(r.data));
r=await call('/api/supervisor/selecoes',{method:'POST',token:tSupMat,body:{prova_id:P3,reaproveitar:sMat}});
ok('Reaproveitar para outra turma (2ª REG) depois de aplicada na MED: as 3 entram', r.status===200 && r.data.copiadas===3, JSON.stringify(r.data));
await call('/api/supervisor/selecoes/'+r.data.selecao.id,{method:'DELETE',token:tSupMat});
r=await call('/api/supervisor/selecoes',{method:'POST',token:tSupMat,body:{serie:2,tipo:'MED'}});
const sLivre=r.data.selecao.id;
r=await call('/api/supervisor/selecoes/'+sLivre,{method:'PUT',token:tSupMat,body:{itens:mats.slice(0,3)}});
ok('Mesma turma (2ª MED) já aplicada: as 3 questões ficam bloqueadas', r.status===409, r.data.error);
r=await call('/api/supervisor/selecoes/'+sLivre,{method:'PUT',token:tSupMat,body:{itens:[mats[3]]}});
ok('A questão não usada continua disponível para a 2ª MED', r.status===200);
r=await call('/api/supervisor/selecoes',{method:'POST',token:tSupMat,body:{serie:2,tipo:'MIL'}});
const sLivreMil=r.data.selecao.id;
r=await call('/api/supervisor/selecoes/'+sLivreMil,{method:'PUT',token:tSupMat,body:{itens:mats.slice(0,3)}});
ok('MIL é outra turma: as questões aplicadas na MED continuam livres para a MIL', r.status===200, r.data.error);
await call('/api/supervisor/selecoes/'+sLivreMil,{method:'DELETE',token:tSupMat});

// ===== prova fechada sem Diagramador =====
db.exec("UPDATE usuarios SET ativo=0 WHERE email='diagramador.teste@grupoideal.com.br'");
r=await call('/api/supervisor/selecoes',{method:'POST',token:tSupFis,body:{prova_id:P2}});
const sFisMil=r.data.selecao.id;await call('/api/supervisor/selecoes/'+sFisMil,{method:'PUT',token:tSupFis,body:{itens:fiss}});
await call('/api/supervisor/selecoes/'+sFisMil+'/enviar',{method:'POST',token:tSupFis,body:{}});
await call('/api/supervisor/selecoes/'+sMatMil+'/enviar',{method:'POST',token:tSupMat,body:{}}); await espera();
const p2=db.prepare('SELECT situacao, aviso, arquivo FROM provas WHERE id=?').get(P2);
ok('Sem Diagramador ativo: prova fica "fechada" com aviso e Word pronto', p2.situacao==='fechada' && /Nenhum Diagramador/.test(p2.aviso) && !!p2.arquivo, JSON.stringify(p2));
r=await call('/api/adm/provas/'+P2+'/enviar',{method:'POST',token:tAdm,body:{}});
ok('Enviar ao Diagramador sem cadastro avisa', r.status===409 && /Nenhum Diagramador/.test(r.data.error), r.data.error);
db.exec("UPDATE usuarios SET ativo=1 WHERE email='diagramador.teste@grupoideal.com.br'");
r=await call('/api/adm/provas/'+P2+'/enviar',{method:'POST',token:tAdm,body:{}}); await espera();
ok('Com o Diagramador de volta, Enviar ao Diagramador manda e a prova vira "enviada"', r.status===200 && db.prepare('SELECT situacao s FROM provas WHERE id=?').get(P2).s==='enviada', JSON.stringify(r.data));
r=await call('/api/adm/provas/'+P3,{method:'DELETE',token:tAdm});
ok('ADM exclui prova sem seleção', r.status===200 && !db.prepare('SELECT id FROM provas WHERE id=?').get(P3));
r=await call('/api/adm/backups',{method:'POST',token:tAdm,body:{}});
ok('Cópia de segurança inclui provas e prova_disciplinas', r.status===200 && JSON.parse(Buffer.from(r2store.get('backups/'+r.data.backup.nome).bytes).toString('utf8')).tabelas.provas.length===2);

// ===== telas =====
const server = http.createServer(async (req, res) => { const chunks=[]; for await (const c of req) chunks.push(c); const request=new Request('https://atlas-api.test'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD','OPTIONS'].includes(req.method)?undefined:Buffer.concat(chunks)}); const response=await worker.fetch(request,env); res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(PORTA);
const K=S+'katexpkg/package/dist/';
const browser=await chromium.launch(); const ctx=await browser.newContext({viewport:{width:1280,height:900}});
await ctx.route('https://idealolimpico.com.br/atlas/**', route=>{const f=new URL(route.request().url()).pathname.replace('/atlas/','')||'index.html';const p=REPO+'atlas/'+f;if(!fs.existsSync(p))return route.fulfill({status:404,body:'nf'});route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':f.endsWith('.css')?'text/css':'image/png',body:fs.readFileSync(p)})});
await ctx.route('https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/**', r2=>{const p=new URL(r2.request().url()).pathname.replace('/npm/katex@0.19.1/dist/','');r2.fulfill({status:200,headers:{'content-type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'font/'+p.split('.').pop(),'access-control-allow-origin':'*'},body:fs.readFileSync(K+p)})});
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route=>{const u=route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev','http://localhost:'+PORTA);const resp=await route.fetch({url:u,headers:{...route.request().headers(),origin:ORIGIN}});route.fulfill({response:resp})});
const page=await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message)); const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.dismiss()});
// --- ADM: Avaliações ---
await page.addInitScript(t=>{try{sessionStorage.setItem('atlas_adm_token',t)}catch{}},tAdm);
await page.goto('https://idealolimpico.com.br/atlas/admin-avaliacoes.html');await page.waitForSelector('.prova');
let txt=await page.textContent('#lista');
ok('Tela Avaliações: provas do 4º bimestre com selo verde "Prova enviada ao Diagramador" e disciplinas enviadas', txt.includes('2ª série · MED · Simulado ENEM · 2º dia') && txt.includes('Prova enviada ao Diagramador') && (await page.$$('.sit.enviada')).length>=1 && txt.includes('Enviada em'), txt.slice(0,200));
ok('Tela Avaliações: prova aplicada com o selo e sem Reenviar', (await page.$$('.sit.aplicada')).length===1);
await page.click('#nova');await page.check('[name=modalidade][value="ENEM2"]');
const regra=await page.evaluate(()=>({fora:[...document.querySelectorAll('#discs label.fora')].map(l=>l.querySelector('[type=checkbox]').value),livres:[...document.querySelectorAll('#discs label:not(.fora)')].map(l=>l.querySelector('[type=checkbox]').value)}));
ok('Tela Nova prova: ENEM 2º dia deixa só Biologia, Física, Química e Matemática', regra.livres.join()==='Biologia,Física,Química,Matemática' && regra.fora.includes('Português'), JSON.stringify(regra));
await page.check('[name=modalidade][value="ENEM1"]');
ok('Tela Nova prova: ENEM 1º dia deixa linguagens e humanas', (await page.evaluate(()=>[...document.querySelectorAll('#discs label.fora')].map(l=>l.querySelector('[type=checkbox]').value).join()))==='Biologia,Física,Química,Matemática');
await page.check('[name=serie][value="1"]');await page.check('[name=tipo][value="REG"]');await page.check('[name=modalidade][value="PART"]');await page.fill('#f-aplicacao',ANO+'-12-19');
await page.evaluate(()=>{const l=[...document.querySelectorAll('#discs label')].find(x=>x.querySelector('[type=checkbox]').value==='Literatura');l.querySelector('[type=checkbox]').checked=true;l.querySelector('[type=number]').value='2';totalForm()});
ok('Tela Nova prova: total e numeração', (await page.textContent('#f-total'))==='2' && (await page.textContent('#f-numeracao')).includes('1 a 2'));
await page.click('#salvar');await page.waitForFunction(()=>document.querySelector('#app-status').textContent.includes('Prova criada'));
const PT=db.prepare('SELECT id FROM provas ORDER BY id DESC LIMIT 1').get().id;
ok('Tela Nova prova: criada no banco com Literatura 2', db.prepare('SELECT quantidade FROM prova_disciplinas WHERE prova_id=?').get(PT).quantidade===2);
await page.screenshot({path:S+'avaliacoes.png',fullPage:true});
// --- ADM: cadastro com Diagramador ---
await page.goto('https://idealolimpico.com.br/atlas/admin.html');await page.waitForSelector('#list table');
txt=await page.textContent('#list');
ok('Tela Cadastro: selo Diagramador e nome Colaborador (não "Digitador")', txt.includes('Diagramador') && !/Digitador/.test(txt), txt.slice(0,120));
await page.click('#add');await page.fill('#name','Outra Diagramadora');await page.fill('#email','outra.diag');await page.uncheck('#f-banco');await page.check('#f-diag');await page.click('#save');
await page.waitForFunction(()=>document.querySelector('#app-status').textContent.includes('Diagramador cadastrado'));
ok('Tela Cadastro: Diagramador salvo só com nome e e-mail, sem acesso', db.prepare("SELECT diagramador, disciplina FROM usuarios WHERE email='outra.diag@grupoideal.com.br'").get()?.diagramador===1);
// --- supervisor: nova seleção pela prova ---
await page.evaluate(()=>sessionStorage.clear());
async function login(card,user){db.exec('DELETE FROM login_rate_limits');await page.goto('https://idealolimpico.com.br/atlas/');await page.evaluate(()=>{sessionStorage.clear();localStorage.removeItem('atlas_user_auth')});await page.goto('https://idealolimpico.com.br/atlas/');await page.click(`[data-role="${card}"]`);await page.fill('#email',user);await page.click('#loginButton');await page.waitForSelector('#code-step:not([hidden])');await page.fill('#code',lastCode());await page.click('#verifyButton');}
await login('Supervisor','marcio.alex');await page.waitForURL(/supervisor\.html/);
await page.goto('https://idealolimpico.com.br/atlas/supervisor-selecoes.html');await page.waitForSelector('#nova');
await page.click('#nova');await page.waitForSelector('input[name=prova]');
txt=await page.textContent('#provas-abertas');
ok('Tela Sup: lista a prova aberta de Literatura com quantidade e data', txt.includes('1ª série · REG · Simulado particular') && txt.includes('2 questões de Literatura') && txt.includes('19/12/'+ANO), txt);
ok('Tela Sup: sem campo de título', !(await page.$('#novo-titulo')));
await page.check('input[name=prova][value="'+PT+'"]');await page.click('#nova-form button[type=submit]');await page.waitForSelector('#sel-view:not([hidden])');
ok('Tela Sup: caixa "A prova" mostra a prova e a trava "Faltam 2"', (await page.textContent('#prova-info')).includes('2 questões de Literatura') && (await page.textContent('#meta-prova')).includes('Faltam 2') && await page.isDisabled('#enviar') && await page.isHidden('#campos-livres'), await page.textContent('#meta-prova'));
await page.screenshot({path:S+'sup-prova.png'});
await browser.close(); server.close();
ok('Telas: sem erros de JavaScript nem caixas do navegador', errors.length===0 && dialogs.length===0, errors.join(' ; ')+dialogs.join(';'));
for (const x of results) console.log(x.join(' | '));
const bad=results.filter(x=>x[0]!=='OK  ').length; console.log(bad?`\n${bad} FALHA(S)`:`\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
