// ADM · Questões: filtros em cascata (disciplina obrigatória; professores, assuntos e subtemas só daquela disciplina). Dados fictícios.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const worker = (await import(pathToFileURL(REPO + '_cloudflare/atlas-api/worker.js').href + '?' + Date.now())).default;
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
const mails = [];
const env = { ATLAS_HOJE_TESTE: '2026-11-13', DB, GOOGLE_CLIENT_ID: CLIENT, ADMIN_EMAIL: 'marinhomalcher@gmail.com', ATLAS_MAILER_URL: 'https://mailer.test/exec', ATLAS_MAILER_SECRET: 's' };
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url) === 'https://www.googleapis.com/oauth2/v3/certs') return new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'teste1', alg: 'RS256', use: 'sig' }] }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
  if (String(url) === 'https://mailer.test/exec') { mails.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }); }
  return realFetch(url, opts);
};
const b64u = b => Buffer.from(b).toString('base64url');
async function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: 'https://accounts.google.com', aud: CLIENT, sub: '123', email: 'marinhomalcher@gmail.com', email_verified: true, name: 'Marinho', iat: now, exp: now + 3600, ...claims };
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'teste1', typ: 'JWT' })) + '.' + b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(head));
  return head + '.' + b64u(new Uint8Array(sig));
}
const ORIGIN = 'https://idealolimpico.com.br';
async function call(path, { method = 'GET', body, token } = {}) {
  const headers = { Origin: ORIGIN };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request('https://atlas-api.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, data: await res.json().catch(() => null) };
}
const tAdm = (await call('/api/adm/login', { method: 'POST', body: { credential: await jwt({}) } })).data.token;

db.exec(`INSERT INTO usuarios (nome,email,disciplina,papel) VALUES
 ('Edi Franco','edi@grupoideal.com.br','Literatura','professor'),
 ('Andrey Uchôa','andrey@grupoideal.com.br','Matemática','professor');`);
const uid = e => db.prepare('SELECT id FROM usuarios WHERE email = ?').get(e + '@grupoideal.com.br').id;
let n = 1000000;
function item(disc, autor, assunto, subtema) {
  const codigo = 'F' + String(++n);
  const r = db.prepare("INSERT INTO itens (codigo, disciplina, autor_id, situacao) VALUES (?, ?, ?, 'aprovado')").run(codigo, disc, uid(autor));
  db.prepare('INSERT INTO item_versoes (item_id, versao, dados, autor_id) VALUES (?, 1, ?, ?)').run(Number(r.lastInsertRowid), JSON.stringify({ etapa: 'em', assunto, subtema, origem: 'autoral', dificuldade: 'Média', comando: 'x' }), uid(autor));
  return codigo;
}
const cLit = item('Literatura', 'edi', 'Barroco', 'Vieira');
item('Literatura', 'edi', 'Barroco', 'Gregório de Matos');
item('Literatura', 'edi', 'Romantismo', 'Alencar');
const cMat = item('Matemática', 'andrey', 'Funções', 'Afim');

let r = await call('/api/adm/banco', { token: tAdm });
ok('Sem disciplina: nenhuma questão, aviso e listas vazias', r.status === 200 && r.data.exige_disciplina === true && r.data.itens.length === 0 && r.data.professores.length === 0 && r.data.assuntos.length === 0, JSON.stringify(r.data).slice(0, 160));
ok('Sem disciplina a lista de disciplinas continua vindo (para escolher)', r.data.disciplinas.includes('Literatura'));
r = await call('/api/adm/banco?q=Barroco&situacao=todas', { token: tAdm });
ok('Busca por texto sem disciplina também exige a disciplina', r.data.exige_disciplina === true && r.data.itens.length === 0);
r = await call('/api/adm/banco?q=' + cMat + '&situacao=todas', { token: tAdm });
ok('Código completo funciona sem disciplina', r.data.exige_disciplina !== true && r.data.itens.length === 1 && r.data.itens[0].codigo === cMat, JSON.stringify(r.data).slice(0, 160));
r = await call('/api/adm/banco?disciplina=Literatura', { token: tAdm });
ok('Literatura: 3 questões, só o professor da área e só os assuntos dela', r.data.itens.length === 3 && r.data.professores.length === 1 && r.data.professores[0].nome === 'Edi Franco' && r.data.assuntos.join(',') === 'Barroco,Romantismo', JSON.stringify([r.data.professores, r.data.assuntos]));
ok('Sem assunto escolhido, a lista de subtemas vem vazia', r.data.subtemas.length === 0);
r = await call('/api/adm/banco?disciplina=Literatura&assunto=Barroco', { token: tAdm });
ok('Com o assunto, vêm só os subtemas dele', r.data.subtemas.join(',') === 'Gregório de Matos,Vieira' && r.data.itens.length === 2, JSON.stringify(r.data.subtemas));
r = await call('/api/adm/banco?disciplina=Literatura&assunto=Barroco&subtema=Vieira', { token: tAdm });
ok('O filtro de subtema devolve só a questão dele', r.data.itens.length === 1 && r.data.itens[0].codigo === cLit, JSON.stringify(r.data.itens.map(i => i.codigo)));
r = await call('/api/adm/banco?disciplina=Matemática', { token: tAdm });
ok('Matemática não mostra o professor nem os assuntos de Literatura', r.data.professores.length === 1 && r.data.professores[0].nome === 'Andrey Uchôa' && r.data.assuntos.join(',') === 'Funções');

/* Tela: a disciplina vem primeiro; os outros filtros nascem desligados e há um filtro de subtema. */
const html = fs.readFileSync(REPO + 'atlas/admin-questoes.html', 'utf8');
ok('A tela tem "Escolha a disciplina" e o filtro de subtema', html.includes('<option value="">Escolha a disciplina</option>') && html.includes('id="f-subtema"'));
ok('Assunto e subtema nascem desligados e dependem do anterior', html.includes('id="f-assunto" aria-label="Assunto" disabled') && html.includes('id="f-subtema" aria-label="Subtema" disabled') && html.includes("DEPENDENTES={disciplina:['#f-professor','#f-assunto','#f-subtema'],assunto:['#f-subtema']}"));

for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK  ').length; console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(bad ? 1 : 0);
