// Exclusões do ADM (28/11/2026): questão (bloqueia se em uso; sai de rascunho) e prova (apaga as seleções junto). Dados fictícios.
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

db.exec(`INSERT INTO usuarios (nome,email,disciplina,papel) VALUES ('Edi Franco','edi@grupoideal.com.br','Literatura','supervisor');`);
const edi = db.prepare("SELECT id FROM usuarios WHERE email='edi@grupoideal.com.br'").get().id;
let n = 2000000;
function item(extra = {}) {
  const codigo = 'F' + String(++n);
  const r = db.prepare("INSERT INTO itens (codigo, disciplina, autor_id, situacao) VALUES (?, 'Literatura', ?, 'aprovado')").run(codigo, edi);
  const id = Number(r.lastInsertRowid);
  db.prepare('INSERT INTO item_versoes (item_id, versao, dados, autor_id) VALUES (?, 1, ?, ?)').run(id, JSON.stringify({ etapa: 'em', assunto: 'Barroco', comando: 'x', ...extra }), edi);
  return { codigo, id };
}
const prova = sit => Number(db.prepare("INSERT INTO provas (ano, bimestre, serie, tipo, modalidade, aplicacao, situacao) VALUES (2026, 4, 2, 'MED', 'PART', '2026-12-01', ?)").run(sit).lastInsertRowid);
const selecao = (sit, provaId, itens) => {
  const s = Number(db.prepare("INSERT INTO selecoes (disciplina, supervisor_id, serie, tipo, situacao, ano, prova_id) VALUES ('Literatura', ?, 2, 'MED', ?, 2026, ?)").run(edi, sit, provaId).lastInsertRowid);
  itens.forEach((i, k) => db.prepare('INSERT INTO selecao_itens (selecao_id, item_id, ordem, versao) VALUES (?, ?, ?, 1)').run(s, i.id, k + 1));
  if (provaId) db.prepare("INSERT OR REPLACE INTO prova_disciplinas (prova_id, disciplina, quantidade, selecao_id) VALUES (?, 'Literatura', 2, ?)").run(provaId, s);
  return s;
};
const del = (codigo, body) => call('/api/adm/itens/' + codigo, { method: 'DELETE', token: tAdm, body });
const existe = id => !!db.prepare('SELECT 1 FROM itens WHERE id = ?').get(id);
const conf = c => ({ confirmo_exclusao: true, codigo_confirmacao: c });

// ---- Questão ----
const livre = item();
db.prepare("INSERT INTO revisoes (item_id, versao, supervisor_id, decisao) VALUES (?, 1, ?, 'aprovar')").run(livre.id, edi);
db.prepare("INSERT INTO eventos (usuario_id, acao, item_id) VALUES (?, 'item_enviado', ?)").run(edi, livre.id);
let r = await call('/api/adm/itens/' + livre.codigo, { method: 'DELETE', body: conf(livre.codigo) });
ok('Sem login a exclusão é recusada', r.status === 401 && existe(livre.id));
r = await del(livre.codigo, { codigo_confirmacao: livre.codigo });
ok('Sem a confirmação explícita não exclui', r.status === 400 && existe(livre.id));
r = await del(livre.codigo, conf('F0000000'));
ok('Código digitado errado não exclui', r.status === 400 && /código/.test(r.data.error) && existe(livre.id));
r = await del(livre.codigo, conf(livre.codigo.toLowerCase()));
ok('Questão livre é apagada de tudo (versões e revisões)', r.status === 200 && !existe(livre.id) &&
  !db.prepare('SELECT 1 FROM item_versoes WHERE item_id = ?').get(livre.id) && !db.prepare('SELECT 1 FROM revisoes WHERE item_id = ?').get(livre.id), JSON.stringify(r.data));
const ev = db.prepare("SELECT detalhe FROM eventos WHERE acao = 'questao_excluida'").get();
ok('O histórico antigo perde só o vínculo, e a exclusão fica registrada com as versões', !!ev && JSON.parse(ev.detalhe).codigo === livre.codigo && JSON.parse(ev.detalhe).versoes.length === 1 &&
  db.prepare("SELECT item_id FROM eventos WHERE acao = 'item_enviado'").get().item_id === null);

const emRascunho = item(), outra = item();
const sRasc = selecao('rascunho', null, [emRascunho, outra]);
r = await del(emRascunho.codigo, conf(emRascunho.codigo));
ok('Em rascunho de supervisor: sai do rascunho e é apagada', r.status === 200 && !existe(emRascunho.id) && r.data.rascunhos.includes(sRasc) &&
  db.prepare('SELECT COUNT(*) n FROM selecao_itens WHERE selecao_id = ?').get(sRasc).n === 1, JSON.stringify(r.data));

const finalizada = item();
const sFin = selecao('enviada', null, [finalizada]);
r = await del(finalizada.codigo, conf(finalizada.codigo));
ok('Em seleção finalizada: bloqueia e diz onde está', r.status === 409 && r.data.error.includes('seleção #' + sFin) && /finalizada/.test(r.data.error) && existe(finalizada.id), r.data.error);

const naProvaEnviada = item();
const pEnv = prova('enviada'); selecao('rascunho', pEnv, [naProvaEnviada]);
r = await del(naProvaEnviada.codigo, conf(naProvaEnviada.codigo));
ok('Em prova enviada ao Diagramador: bloqueia', r.status === 409 && /Diagramador/.test(r.data.error) && existe(naProvaEnviada.id), r.data.error);

const aplicada = item();
selecao('aplicada', null, [aplicada]);
r = await del(aplicada.codigo, conf(aplicada.codigo));
ok('Em seleção aplicada: bloqueia', r.status === 409 && /aplicada/.test(r.data.error) && existe(aplicada.id), r.data.error);

const g = Number(db.prepare("INSERT INTO grupos (codigo, disciplina, autor_id) VALUES ('GL000001', 'Literatura', ?)").run(edi).lastInsertRowid);
const deGrupo = item(); db.prepare('UPDATE itens SET grupo_id = ? WHERE id = ?').run(g, deGrupo.id);
r = await del(deGrupo.codigo, conf(deGrupo.codigo));
ok('Questão de grupo não é excluída sozinha', r.status === 409 && /grupo/.test(r.data.error) && existe(deGrupo.id), r.data.error);

// ---- Prova ----
const delProva = id => call('/api/adm/provas/' + id, { method: 'DELETE', token: tAdm });
const q1 = item();
const pAberta = prova('aberta'); const sA = selecao('rascunho', pAberta, [q1]);
r = await delProva(pAberta);
ok('Prova aberta com seleção começada: é excluída junto com a seleção', r.status === 200 && r.data.selecoes_apagadas === 1 &&
  !db.prepare('SELECT 1 FROM provas WHERE id = ?').get(pAberta) && !db.prepare('SELECT 1 FROM selecoes WHERE id = ?').get(sA) && !db.prepare('SELECT 1 FROM selecao_itens WHERE selecao_id = ?').get(sA), JSON.stringify(r.data));
ok('A questão da seleção apagada continua no banco', existe(q1.id));
const pFechada = prova('fechada'); selecao('enviada', pFechada, [item()]);
r = await delProva(pFechada);
ok('Prova fechada (todas finalizaram, ainda não foi ao Diagramador): pode excluir', r.status === 200 && !db.prepare('SELECT 1 FROM provas WHERE id = ?').get(pFechada), JSON.stringify(r.data));
r = await delProva(pEnv);
ok('Prova enviada ao Diagramador: não exclui', r.status === 409 && /Diagramador/.test(r.data.error) && !!db.prepare('SELECT 1 FROM provas WHERE id = ?').get(pEnv), r.data.error);
r = await delProva(prova('aplicada'));
ok('Prova aplicada: não exclui', r.status === 409 && /aplicada/.test(r.data.error), r.data.error);

// ---- Telas ----
const hq = fs.readFileSync(REPO + 'atlas/admin-questoes.html', 'utf8'), ha = fs.readFileSync(REPO + 'atlas/admin-avaliacoes.html', 'utf8');
ok('Questões: botão Excluir com aviso "apagada de tudo" e código para confirmar', hq.includes('id="del-item"') && hq.includes('apagada de tudo') && hq.includes('id="del-codigo"') && hq.includes("method:'DELETE',body:{confirmo_exclusao:true,codigo_confirmacao:cod}"));
ok('Avaliações: "Excluir prova" também com seleção começada, avisando que as seleções serão apagadas', ha.includes("bt('Excluir prova','danger'") && ha.includes("p.situacao==='aberta'||p.situacao==='fechada'") && ha.includes('também serão apagadas'));

for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK  ').length; console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(bad ? 1 : 0);
