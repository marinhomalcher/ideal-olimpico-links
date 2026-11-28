// Aprovação das provas pelos professores — etapa C (28/11/2026): painel do supervisor por código, resposta aos pedidos ("ajustei" /
// "mantido"), tréplica, impasse decidido pelo ADM, dispensa de professor, reaprovação de quem aprovou uma questão alterada. Dados fictícios.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const S = (process.env.ATLAS_TESTE_TMP || '/tmp/atlas-testes') + '/';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const worker = (await import(pathToFileURL(REPO + '_cloudflare/atlas-api/worker.js').href + '?' + Date.now())).default;
const dias = await import(pathToFileURL(REPO + '_cloudflare/atlas-api/diasuteis.js').href);
const aval = await import(pathToFileURL(REPO + '_cloudflare/atlas-api/avaliacoes.js').href);
const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'OK  ' : 'FALHOU', name, String(extra).slice(0, 200)]);
const ANO = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date()));

// ---- D1 falso (SQLite real) ----
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
const SQL = fs.readFileSync(REPO + '_cloudflare/atlas-api/schema.sql', 'utf8');
db.exec(SQL);
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
const env = { ATLAS_HOJE_TESTE: '2026-11-13', DB, GOOGLE_CLIENT_ID: CLIENT, ADMIN_EMAIL: 'marinhomalcher@gmail.com', ATLAS_MAILER_URL: 'https://mailer.test/exec', ATLAS_MAILER_SECRET: 'segredo-de-teste', ATLAS_AVISOS_ATIVOS: '1' };
const mails = [];
const r2store = new Map(); env.IMAGENS = { put: async (k, b, o = {}) => { const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b); r2store.set(k, { bytes, o, up: new Date() }); }, get: async k => { const v = r2store.get(k); return v ? { body: v.bytes, httpMetadata: v.o.httpMetadata } : null; }, delete: async k => { r2store.delete(k); }, list: async ({ prefix = '' } = {}) => ({ objects: [...r2store].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.bytes.length, uploaded: v.up })), truncated: false }) };

// Pessoas fictícias. Séries: Edi (2ª), Telma (1ª e 2ª), Lit3 (só 3ª), Química (2ª), Colaborador de Literatura (2ª, mas digitador: não avalia).
db.exec(`INSERT INTO usuarios (nome,email,disciplina,papel) VALUES
 ('Edi Franco','edi.franco@grupoideal.com.br','Literatura','professor'),
 ('Márcio Alex','marcio.alex@grupoideal.com.br','Literatura','supervisor'),
 ('Telma Paes','telma.paes@grupoideal.com.br','Literatura','professor'),
 ('Lit Terceira','lit.terceira@grupoideal.com.br','Literatura','professor'),
 ('Prof Química','prof.quimica@grupoideal.com.br','Química','professor'),
 ('Sup Química','sup.quimica@grupoideal.com.br','Química','supervisor');`);
db.exec("INSERT INTO usuarios (nome,email,disciplina,papel,digitador) VALUES ('Colaborador Lit','colab.lit@grupoideal.com.br','Literatura','professor',1)");
const uid = email => db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email).id;
for (const [e, series] of [['edi.franco', [2]], ['telma.paes', [1, 2]], ['lit.terceira', [3]], ['prof.quimica', [2]], ['colab.lit', [2]]])
  for (const s of series) db.prepare('INSERT INTO professor_series (usuario_id, serie) VALUES (?, ?)').run(uid(e + '@grupoideal.com.br'), s);

// ---- Google falso (ADM) ----
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url) === 'https://www.googleapis.com/oauth2/v3/certs') return new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'teste1', alg: 'RS256', use: 'sig' }] }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
  if (String(url) === 'https://mailer.test/exec') { mails.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }); }
  return realFetch(url, opts);
};
const b64u = b => Buffer.from(b).toString('base64url');
async function jwt(claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: 'https://accounts.google.com', aud: CLIENT, sub: '123', email: 'marinhomalcher@gmail.com', email_verified: true, name: 'Marinho', iat: now, exp: now + 3600, ...claims };
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'teste1', typ: 'JWT' })) + '.' + b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(head));
  return head + '.' + b64u(new Uint8Array(sig));
}
const ORIGIN = 'https://idealolimpico.com.br';
async function call(path, { method = 'GET', body, token, origin = ORIGIN } = {}) {
  if (body && body.dados && typeof body.dados === 'object' && body.dados.tags === undefined && /^\/api\/itens(\/[A-Z]\d{7})?$/.test(path)) body = { ...body, dados: { ...body.dados, tags: ['teste', 'automatico'] } };
  if (path === '/api/itens' && method === 'POST' && body && body.confirmar_repetida === undefined) body = { ...body, confirmar_repetida: true };
  const headers = { Origin: origin };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request('https://atlas-api.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
}
const lastCode = () => mails.at(-1)?.codigo;
async function tok(email) { db.exec('DELETE FROM login_rate_limits'); await call('/api/login/codigo', { method: 'POST', body: { email } }); return (await call('/api/login/verificar', { method: 'POST', body: { email, codigo: lastCode() } })).data.token; }
const tEdi = await tok('edi.franco@grupoideal.com.br'), tMarcio = await tok('marcio.alex@grupoideal.com.br'), tTelma = await tok('telma.paes@grupoideal.com.br');
const tLit3 = await tok('lit.terceira@grupoideal.com.br'), tProfQ = await tok('prof.quimica@grupoideal.com.br'), tSupQ = await tok('sup.quimica@grupoideal.com.br'), tColab = await tok('colab.lit@grupoideal.com.br');
const tAdm = (await call('/api/adm/login', { method: 'POST', body: { credential: await jwt() } })).data.token;
const espera = (ms = 40) => new Promise(r => setTimeout(r, ms));

const base = { etapa: 'em', origem: 'autoral', dificuldade: 'Média', assunto: 'Romantismo', bloom: 'Aplicar', comando: 'Comando base',
  'alt-a': 'A1', 'alt-b': 'B1', 'alt-c': 'C1', 'alt-d': 'D1', 'alt-e': 'E1', gabarito: 'C' };
async function aprovada(extra = {}, token = tEdi, tSup = tMarcio) {
  const c = (await call('/api/itens', { method: 'POST', token, body: { dados: { ...base, ...extra } } })).data.item.codigo;
  await call('/api/supervisor/itens/' + c + '/decisao', { method: 'POST', token: tSup, body: { decisao: 'aprovar', motivo: '', versao: 1 } });
  return c;
}
const TEXTO_SECRETO = 'Triste Bahia oh quão dessemelhante';
const q1 = await aprovada({ comando: 'Sobre Álvares de Azevedo e a segunda geração romântica', dificuldade: 'Fácil' });
const q2 = await aprovada({ assunto: 'Barroco', comando: 'No poema de Gregório de Matos: ' + TEXTO_SECRETO, gabarito: 'E' });
const q3 = await aprovada({ assunto: 'Barroco', comando: 'Padre Vieira e o sermão' });
const q4 = await aprovada({ assunto: 'Modernismo', comando: 'Semana de 22 com fórmula <span class="atlas-equation" data-latex="x^2"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span></span></span>' });
const qQ = await aprovada({ assunto: 'Estequiometria', comando: 'Mols e massa molar' }, tProfQ, tSupQ);
const itemId = codigo => db.prepare('SELECT id FROM itens WHERE codigo = ?').get(codigo).id;

const EDI = uid('edi.franco@grupoideal.com.br'), TELMA = uid('telma.paes@grupoideal.com.br');
function prova(serie, tipo, discs) { const id = Number(db.prepare("INSERT INTO provas (ano, bimestre, serie, tipo, modalidade, aplicacao) VALUES (?, 4, ?, ?, 'PART', ?)").run(ANO, serie, tipo, ANO + '-12-10').lastInsertRowid); for (const [d, q] of discs) db.prepare('INSERT INTO prova_disciplinas (prova_id, disciplina, quantidade) VALUES (?, ?, ?)').run(id, d, q); return id; }
async function selecao(provaId, itens, token = tMarcio) { const s = (await call('/api/supervisor/selecoes', { method: 'POST', token, body: { prova_id: provaId } })).data.selecao.id; await call('/api/supervisor/selecoes/' + s, { method: 'PUT', token, body: { itens } }); await call('/api/supervisor/selecoes/' + s + '/enviar', { method: 'POST', token, body: {} }); await espera(); return s; }
async function ver(s, token, n) { for (let k = 1; k <= n; k++) await call('/api/avaliacoes/' + s + '/questao/' + k, { token }); }
const voto = (s, token, n) => call('/api/avaliacoes/' + s + '/questao/' + n + '/voto', { method: 'POST', token, body: { voto: 'concordo' } });
const pedido = (s, token, n, tipo, texto) => call('/api/avaliacoes/' + s + '/questao/' + n + '/pedido', { method: 'POST', token, body: { tipo, texto } });
const finalizar = (s, token) => call('/api/avaliacoes/' + s + '/finalizar', { method: 'POST', token, body: {} });
const responder = (s, pid, resposta, texto, token = tMarcio) => call('/api/supervisor/avaliacoes/' + s + '/pedidos/' + pid + '/responder', { method: 'POST', token, body: { resposta, texto } });
const aceite = (s, pid, token, aceito, texto) => call('/api/avaliacoes/' + s + '/pedido/' + pid + '/aceite', { method: 'POST', token, body: { aceito, texto } });
const decisaoDe = (s, p) => db.prepare('SELECT decisao FROM avaliacao_professores WHERE selecao_id = ? AND professor_id = ?').get(s, p).decisao;
const fase = s => db.prepare('SELECT fase FROM selecoes WHERE id = ?').get(s).fase;
let r;

// ===== 1. "Ajustei": supervisor troca a questão, quem aprovou a antiga volta a avaliar =====
const P1 = prova(2, 'REG', [['Literatura', 2]]);
const s1 = await selecao(P1, [q1, q2]);
await ver(s1, tEdi, 2); await voto(s1, tEdi, 1); r = await pedido(s1, tEdi, 2, 'corrigir', 'O gabarito está errado: deveria ser C.'); const ped1 = r.data.pedido.id; await finalizar(s1, tEdi);
await ver(s1, tTelma, 2); await voto(s1, tTelma, 1); await voto(s1, tTelma, 2); await finalizar(s1, tTelma);
ok('Cenário 1: Edi pediu mudança, Telma aprovou; seleção segue em avaliação', decisaoDe(s1, EDI) === 'pediu_mudanca' && decisaoDe(s1, TELMA) === 'aprovou' && fase(s1) === 'avaliacao');
r = await call('/api/supervisor/avaliacoes/' + s1, { token: tMarcio });
const pa = r.data.avaliacao;
ok('Painel do supervisor: 2 professores por código (sem nome), pedido da questão 2 em aberto com a mensagem, 1 pedido aguardando', r.status === 200 && pa.professores.length === 2 && pa.professores.every(p => /^P-/.test(p.codigo) && !('nome' in p)) && pa.pedidos_abertos_lista === 1 &&
  pa.professores.some(p => p.pedidos.length === 1 && p.pedidos[0].n === 2 && p.pedidos[0].estado === 'aberto' && p.pedidos[0].mensagens.length === 1 && p.pedidos[0].mensagens[0].autor === 'professor') && !JSON.stringify(pa).includes('Edi Franco'), JSON.stringify(pa).slice(0, 300));
r = await call('/api/supervisor/avaliacoes/' + s1, { token: tSupQ });
ok('Supervisor de outra disciplina não vê o painel', r.status === 404);
r = await call('/api/supervisor/avaliacoes/' + s1 + '/pedidos/' + ped1 + '/responder', { method: 'POST', token: tMarcio, body: { resposta: 'outro', texto: 'x' } });
ok('Resposta precisa ser "ajustei" ou "mantido"', r.status === 400);
r = await responder(s1, ped1, 'ajustei', 'Troquei a questão.');
ok('"Ajustei" sem mudar nada é recusado', r.status === 409 && /Nada mudou/.test(r.data.error), r.data.error);
r = await call('/api/supervisor/selecoes/' + s1, { method: 'PUT', token: tMarcio, body: { itens: [q1, q3] } });
ok('Com pedido em aberto o supervisor pode alterar a seleção (troca q2 por q3); a versão congelada da q1 fica', r.status === 200 && db.prepare('SELECT versao FROM selecao_itens WHERE selecao_id = ? AND item_id = ?').get(s1, itemId(q1)).versao === 1 && !!db.prepare('SELECT 1 AS x FROM selecao_itens WHERE selecao_id = ? AND item_id = ?').get(s1, itemId(q3)), JSON.stringify(r.data));
r = await call('/api/supervisor/selecoes/' + s1, { method: 'DELETE', token: tMarcio });
ok('Mas não pode excluir', r.status === 409);
let n0 = mails.length;
r = await responder(s1, ped1, 'ajustei', 'Troquei pela questão sobre Vieira.'); await espera();
ok('"Ajustei": pedido respondido com prazo de 24 h; Telma (aprovou a antiga) volta a pendente; Edi volta a pendente', r.status === 200 && r.data.pedido.estado === 'respondido' && r.data.mudanca.reabertos.includes(TELMA) && decisaoDe(s1, TELMA) === 'pendente' && decisaoDe(s1, EDI) === 'pendente' && !!db.prepare('SELECT prazo_em FROM avaliacao_pedidos WHERE id = ?').get(ped1).prazo_em, JSON.stringify(r.data).slice(0, 300));
ok('Votos na questão retirada apagados; voto da q1 preservado', db.prepare('SELECT COUNT(*) AS n FROM avaliacao_votos WHERE selecao_id = ? AND item_id = ?').get(s1, itemId(q2)).n === 0 && db.prepare('SELECT COUNT(*) AS n FROM avaliacao_votos WHERE selecao_id = ? AND item_id = ?').get(s1, itemId(q1)).n === 2);
ok('E-mails: Edi (supervisor respondeu) e Telma (a prova mudou), sem conteúdo', mails.slice(n0).some(m => m.email === 'edi.franco@grupoideal.com.br' && /respondeu ao seu pedido/.test(m.assunto)) && mails.slice(n0).some(m => m.email === 'telma.paes@grupoideal.com.br' && /mudou/.test(m.assunto) && !m.texto.includes('Vieira')), mails.slice(n0).map(m => m.email + ':' + m.assunto).join(' | '));
r = await responder(s1, ped1, 'mantido', 'de novo');
ok('Pedido já respondido não aceita outra resposta', r.status === 409);
r = await call('/api/avaliacoes', { token: tEdi });
ok('Lista de Edi: 1 pedido aguardando a resposta dela', r.data.avaliacoes.find(a => a.id === s1).pedidos_aguardando_voce === 1 && r.data.avaliacoes.find(a => a.id === s1).decisao === 'pendente');
r = await call('/api/avaliacoes/' + s1 + '/questao/2', { token: tEdi });
ok('Questão 2 agora é a nova (Vieira), sem pedido ligado a ela', r.data.questao.codigo === q3 && r.data.pedido === null && /Vieira/.test(r.data.questao.dados.comando));
r = await pedido(s1, tEdi, 1, 'trocar', 'x');
ok('Pedido curto recusado (ainda vale)', r.status === 400);
r = await aceite(s1, ped1, tEdi, true, '');
ok('Edi aceita a resposta: pedido aceito, sem voto (a questão saiu da seleção), avaliação dela ainda pendente', r.status === 200 && r.data.pedido.estado === 'aceito' && r.data.concluiu === false && decisaoDe(s1, EDI) === 'pendente');
await voto(s1, tEdi, 2); r = await finalizar(s1, tEdi);
ok('Edi vota na questão nova e finaliza: aprovou', r.data.decisao === 'aprovou' && r.data.fase === 'avaliacao');
r = await call('/api/avaliacoes/' + s1, { token: tTelma });
ok('Telma: questão 1 ainda com o concordo, questão 2 sem resposta', r.data.questoes[0].concordo === true && r.data.questoes[1].concordo === false && r.data.avaliacao.decisao === 'pendente');
await voto(s1, tTelma, 2); r = await finalizar(s1, tTelma); await espera();
ok('Telma reaprova só a questão nova: seleção liberada', r.data.decisao === 'aprovou' && r.data.fase === 'liberada' && fase(s1) === 'liberada');
r = await call('/api/supervisor/avaliacoes/' + s1, { token: tMarcio });
ok('Painel depois: 2 aprovaram, pedido aceito com 3 mensagens (pedido, ajustei, aceite)', r.data.avaliacao.aprovaram === 2 && r.data.avaliacao.professores.flatMap(p => p.pedidos).find(p => p.id === ped1).mensagens.map(x => x.tipo).join() === 'pedido,ajustei,aceite');

// ===== 2. "Mantido", tréplica, impasse, ADM manda trocar =====
const P2 = prova(2, 'MED', [['Literatura', 1]]);
const s2 = await selecao(P2, [q4]);
await ver(s2, tTelma, 1); await voto(s2, tTelma, 1); await finalizar(s2, tTelma);
await ver(s2, tEdi, 1); r = await pedido(s2, tEdi, 1, 'trocar', 'Esta questão caiu no simulado do 2º bimestre.'); const ped2 = r.data.pedido.id; await finalizar(s2, tEdi);
r = await responder(s2, ped2, 'mantido', 'Foi aplicada só na MIL; para a REG é inédita.');
ok('"Mantido": pedido respondido, rodada 1, Edi continua "pediu mudança"', r.status === 200 && r.data.pedido.estado === 'respondido' && r.data.pedido.rodada === 1 && decisaoDe(s2, EDI) === 'pediu_mudanca', JSON.stringify(r.data.pedido));
r = await aceite(s2, ped2, tEdi, false, '');
ok('Não aceitar exige a tréplica escrita', r.status === 400);
n0 = mails.length;
r = await aceite(s2, ped2, tEdi, false, 'Os alunos da REG receberam a lista da MIL como treino.'); await espera();
ok('Tréplica: estado "treplica", rodada 2, prazo de 24 h ao supervisor, e-mail ao supervisor', r.status === 200 && r.data.pedido.estado === 'treplica' && r.data.pedido.rodada === 2 && !!r.data.pedido.prazo_em && mails.slice(n0).some(m => m.email === 'marcio.alex@grupoideal.com.br' && /tréplica/.test(m.assunto)), JSON.stringify(r.data.pedido).slice(0, 200));
r = await voto(s2, tEdi, 1);
ok('Enquanto a tréplica está com o supervisor, Edi não muda o voto', r.status === 409);
r = await responder(s2, ped2, 'mantido', 'A lista de treino não trouxe o gabarito comentado.');
ok('Supervisor mantém de novo: respondido, rodada 2', r.status === 200 && r.data.pedido.estado === 'respondido' && r.data.pedido.rodada === 2);
n0 = mails.length;
r = await aceite(s2, ped2, tEdi, false, 'Mantenho o pedido de troca.'); await espera();
ok('Segunda recusa: impasse vai ao ADM (estado "adm"), ADM avisado', r.status === 200 && r.data.pedido.estado === 'adm' && mails.slice(n0).some(m => m.email === 'marinhomalcher@gmail.com' && /impasse/.test(m.assunto)), JSON.stringify(r.data.pedido).slice(0, 200));
r = await call('/api/adm/avaliacoes/impasses', { token: tAdm });
ok('ADM lista o impasse com nomes, prova, questão e as 5 mensagens', r.status === 200 && r.data.impasses.length === 1 && r.data.impasses[0].professor === 'Edi Franco' && r.data.impasses[0].supervisor === 'Márcio Alex' && r.data.impasses[0].n === 1 && r.data.impasses[0].mensagens.length === 5 && /2ª série · MED/.test(r.data.impasses[0].prova), JSON.stringify(r.data.impasses[0]).slice(0, 300));
r = await call('/api/adm/avaliacoes/pedidos/' + ped2 + '/decidir', { method: 'POST', token: tAdm, body: { decisao: 'manter', texto: '' } });
ok('Decisão do ADM exige justificativa', r.status === 400);
n0 = mails.length;
r = await call('/api/adm/avaliacoes/pedidos/' + ped2 + '/decidir', { method: 'POST', token: tAdm, body: { decisao: 'trocar', texto: 'A questão já circulou entre os alunos da REG.' } }); await espera();
ok('ADM decide trocar: pedido volta "aberto" na rodada 3; professor e supervisor avisados', r.status === 200 && r.data.pedido.estado === 'aberto' && r.data.pedido.rodada === 3 && mails.slice(n0).filter(m => /decisão do administrador/.test(m.assunto)).length === 2, JSON.stringify(r.data.pedido).slice(0, 200));
r = await responder(s2, ped2, 'mantido', 'Insisto.');
ok('Depois da decisão de trocar, o supervisor não pode manter', r.status === 409);
await call('/api/supervisor/selecoes/' + s2, { method: 'PUT', token: tMarcio, body: { itens: [q1] } });
r = await responder(s2, ped2, 'ajustei', 'Troquei conforme a decisão.'); await espera();
ok('Troca decidida pelo ADM: pedido encerrado ("decidido_adm"); Edi e Telma voltam a avaliar a questão nova', r.status === 200 && r.data.pedido.estado === 'decidido_adm' && decisaoDe(s2, EDI) === 'pendente' && decisaoDe(s2, TELMA) === 'pendente', JSON.stringify(r.data).slice(0, 200));
await voto(s2, tEdi, 1); await finalizar(s2, tEdi); await voto(s2, tTelma, 1); r = await finalizar(s2, tTelma); await espera();
ok('Os dois aprovam a questão nova: liberada', r.data.fase === 'liberada');

// ===== 3. ADM mantém a questão; dispensa um professor =====
const P3 = prova(2, 'MIL', [['Literatura', 1]]);
const s3 = await selecao(P3, [q2]);
await ver(s3, tEdi, 1); r = await pedido(s3, tEdi, 1, 'corrigir', 'Enunciado ambíguo.'); const ped3 = r.data.pedido.id; await finalizar(s3, tEdi);
await responder(s3, ped3, 'mantido', 'Está claro.'); await aceite(s3, ped3, tEdi, false, 'Não está.'); await responder(s3, ped3, 'mantido', 'Continua claro.'); await aceite(s3, ped3, tEdi, false, 'Discordo.');
r = await call('/api/adm/avaliacoes/pedidos/' + ped3 + '/decidir', { method: 'POST', token: tAdm, body: { decisao: 'manter', texto: 'O enunciado está adequado.' } }); await espera();
ok('ADM mantém: pedido "decidido_adm", voto de Edi gravado e a avaliação dela fecha como aprovou', r.status === 200 && r.data.pedido.estado === 'decidido_adm' && db.prepare('SELECT COUNT(*) AS n FROM avaliacao_votos WHERE selecao_id = ? AND professor_id = ?').get(s3, EDI).n === 1 && decisaoDe(s3, EDI) === 'aprovou', JSON.stringify(r.data.pedido).slice(0, 200));
r = await call('/api/avaliacoes/' + s3, { token: tEdi });
ok('Edi vê o pedido decidido com a mensagem do ADM', r.data.questoes[0].pedido.estado === 'decidido_adm' && r.data.questoes[0].pedido.mensagens.at(-1).autor === 'adm' && /manter/.test(r.data.questoes[0].pedido.mensagens.at(-1).texto));
r = await call('/api/adm/avaliacoes/' + s3, { token: tAdm });
ok('Painel do ADM traz os nomes', r.status === 200 && r.data.avaliacao.professores.some(p => p.nome === 'Telma Paes' && p.decisao === 'pendente'));
ok('Ainda não liberada: Telma não viu', fase(s3) === 'avaliacao');
r = await call('/api/adm/avaliacoes/' + s3 + '/dispensar/' + EDI, { method: 'POST', token: tAdm, body: {} });
ok('Não dispensa quem já aprovou', r.status === 409);
n0 = mails.length;
r = await call('/api/adm/avaliacoes/' + s3 + '/dispensar/' + TELMA, { method: 'POST', token: tAdm, body: { motivo: 'Em licença.' } }); await espera();
ok('ADM dispensa Telma: registrado, avisada, seleção liberada', r.status === 200 && r.data.liberada === true && db.prepare('SELECT dispensado_por, dispensado_em FROM avaliacao_professores WHERE selecao_id = ? AND professor_id = ?').get(s3, TELMA).dispensado_em && fase(s3) === 'liberada' && mails.slice(n0).some(m => m.email === 'telma.paes@grupoideal.com.br' && /dispensado/.test(m.assunto)), JSON.stringify(r.data));
r = await call('/api/supervisor/selecoes', { token: tMarcio });
ok('Lista do supervisor traz pedidos_abertos por seleção', r.data.selecoes.every(s => 'pedidos_abertos' in s));


// ===== telas =====
// Cenário das telas: prova nova (3º bimestre) com pedido da Edi na questão 1; Telma já aprovou.
const P4 = Number(db.prepare("INSERT INTO provas (ano, bimestre, serie, tipo, modalidade, aplicacao) VALUES (?, 3, 2, 'REG', 'PART', ?)").run(ANO, ANO + '-09-10').lastInsertRowid); db.prepare('INSERT INTO prova_disciplinas (prova_id, disciplina, quantidade) VALUES (?, ?, ?)').run(P4, 'Literatura', 2);
const s4 = await selecao(P4, [q3, q4]);
await ver(s4, tTelma, 2); await voto(s4, tTelma, 1); await voto(s4, tTelma, 2); await finalizar(s4, tTelma);
await ver(s4, tEdi, 2); await voto(s4, tEdi, 2); r = await pedido(s4, tEdi, 1, 'corrigir', 'O enunciado da questão 1 está ambíguo.'); const ped4 = r.data.pedido.id; await finalizar(s4, tEdi);
const PORTA = 8798;
const server = http.createServer(async (req, res) => { const chunks = []; for await (const c of req) chunks.push(c); const request = new Request('https://atlas-api.test' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks) }); const response = await worker.fetch(request, env); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(PORTA);
const K = S + 'katexpkg/package/dist/';
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.route('https://idealolimpico.com.br/atlas/**', route => { const f = new URL(route.request().url()).pathname.replace('/atlas/', '') || 'index.html'; const p = REPO + 'atlas/' + f; if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: 'nf' }); route.fulfill({ status: 200, contentType: f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'application/javascript' : f.endsWith('.json') ? 'application/json' : f.endsWith('.css') ? 'text/css' : 'image/png', body: fs.readFileSync(p) }); });
await ctx.route('https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/**', r2 => { const p = new URL(r2.request().url()).pathname.replace('/npm/katex@0.19.1/dist/', ''); r2.fulfill({ status: 200, headers: { 'content-type': p.endsWith('.js') ? 'application/javascript' : p.endsWith('.css') ? 'text/css' : 'font/' + p.split('.').pop(), 'access-control-allow-origin': '*' }, body: fs.readFileSync(K + p) }); });
await ctx.route('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', r2 => r2.fulfill({ status: 200, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(S + 'h2c/package/dist/html2canvas.min.js') }));
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route => { const u = route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev', 'http://localhost:' + PORTA); const resp = await route.fetch({ url: u, headers: { ...route.request().headers(), origin: ORIGIN } }); route.fulfill({ response: resp }); });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
async function login(card, user) { db.exec('DELETE FROM login_rate_limits'); await page.goto('https://idealolimpico.com.br/atlas/'); await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('atlas_user_auth'); }); await page.goto('https://idealolimpico.com.br/atlas/'); await page.click(`[data-role="${card}"]`); await page.fill('#email', user); await page.click('#loginButton'); await page.waitForSelector('#code-step:not([hidden])'); await page.fill('#code', lastCode()); await page.click('#verifyButton'); }
// --- supervisor: painel com o pedido e resposta "mantido" ---
await login('Supervisor', 'marcio.alex'); await page.waitForURL(/supervisor\.html/);
await page.goto('https://idealolimpico.com.br/atlas/supervisor-selecoes.html?id=' + s4); await page.waitForSelector('#aval-profs tr');
let txt = await page.textContent('#avaliacao-box');
ok('Tela Sup: painel por código (sem nomes), Telma aprovou, Edi pediu mudança na questão 1, cartão do pedido aguardando resposta', /P-[A-Z2-9]{4}/.test(txt) && !txt.includes('Edi Franco') && txt.includes('Aprovou') && txt.includes('Pediu mudança') && txt.includes('Questão 1') && (await page.$$('.pedido-card.aguarda')).length === 1 && txt.includes('ambíguo'), txt.slice(0, 300));
await page.screenshot({ path: S + 'aval-c-s-painel.png', fullPage: true });
await page.click('.pedido-card.aguarda .pc-tabs button[data-r="mantido"]'); await page.fill('.pedido-card.aguarda .pc-texto', 'O enunciado está claro: pede a característica dominante.'); await page.click('.pedido-card.aguarda .pc-enviar');
await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('Resposta enviada'));
await page.waitForSelector('.pedido-card.respondido');
ok('Tela Sup: respondeu "mantido"; o cartão mostra a conversa com a sua resposta', (await page.textContent('.pedido-card.respondido')).includes('Você') && db.prepare('SELECT estado FROM avaliacao_pedidos WHERE id = ?').get(ped4).estado === 'respondido');
// --- professor: "Ver resposta", tréplica ---
await login('Professor', 'edi.franco'); await page.waitForURL(/professor\.html/);
await page.goto('https://idealolimpico.com.br/atlas/professor-avaliar.html'); await page.waitForSelector('.cartao');
const cartao4 = page.locator('.cartao', { hasText: '3º bimestre' });
ok('Tela Prof: cartão "O supervisor respondeu" com o botão "Ver resposta"', (await cartao4.textContent()).includes('O supervisor respondeu') && (await cartao4.locator('button').textContent()).includes('Ver resposta'));
await cartao4.locator('button').click(); await page.waitForSelector('#pedido-atual:not([hidden]) #b-aceito', { timeout: 30000 });
txt = await page.textContent('#pedido-atual');
ok('Tela Prof: abre na questão 1 com a conversa (pedido + resposta do supervisor) e os botões Aceito / Não aceito', (await page.textContent('#v-qn')) === 'Questão 1 de 2' && txt.includes('Supervisor') && txt.includes('manteve com justificativa') && txt.includes('Aceito a resposta') && txt.includes('vale como aceite'), txt.slice(0, 300));
await page.screenshot({ path: S + 'aval-c-p-resposta.png', fullPage: true });
await page.click('#b-nao'); await page.fill('#treplica-texto', 'Continuo achando ambíguo: duas alternativas cabem.'); await page.click('#b-enviar-treplica');
await page.waitForFunction(() => document.querySelector('#v-notice').textContent.includes('Tréplica enviada'));
ok('Tela Prof: tréplica enviada (estado "treplica", rodada 2), aguardando o supervisor', db.prepare('SELECT estado, rodada FROM avaliacao_pedidos WHERE id = ?').get(ped4).estado === 'treplica' && (await page.textContent('#pedido-atual')).includes('Aguardando a resposta do supervisor'));
// supervisor mantém de novo (pela API) e o professor recusa outra vez: impasse
await responder(s4, ped4, 'mantido', 'Mantenho: só uma alternativa é correta.');
await page.reload(); await page.waitForSelector('#pedido-atual:not([hidden]) #b-aceito', { timeout: 30000 });
await page.click('#b-nao'); await page.fill('#treplica-texto', 'Peço a decisão do administrador.'); await page.click('#b-enviar-treplica');
await page.waitForFunction(() => document.querySelector('#v-notice').textContent.includes('administrador'));
ok('Tela Prof: segunda recusa manda o impasse ao ADM', db.prepare('SELECT estado FROM avaliacao_pedidos WHERE id = ?').get(ped4).estado === 'adm');
// --- ADM: decide o impasse e abre o painel com nomes ---
await page.addInitScript(t => { try { sessionStorage.setItem('atlas_adm_token', t); } catch {} }, tAdm);
await page.goto('https://idealolimpico.com.br/atlas/admin-avaliacoes.html'); await page.click('#bims button[data-bim="3"]'); await page.waitForSelector('#impasses:not([hidden]) .impasse');
txt = await page.textContent('#impasses');
ok('Tela ADM: impasse listado com os nomes, a prova, a questão e as 5 mensagens', txt.includes('Edi Franco') && txt.includes('Márcio Alex') && txt.includes('questão 1') && (await page.$$('#impasses .fio')).length === 5, txt.slice(0, 300));
await page.screenshot({ path: S + 'aval-c-adm-impasse.png', fullPage: true });
await page.click('#impasses .tabs2 button[data-d="manter"]'); await page.fill('#impasses textarea', 'O enunciado está adequado; a questão fica.'); await page.click('#impasses .dec-enviar');
await page.waitForFunction(() => document.querySelector('#app-status').textContent.includes('Decisão registrada'));
ok('Tela ADM: decisão "manter" registrada; Edi passa a aprovou e a seleção fica liberada', db.prepare('SELECT estado FROM avaliacao_pedidos WHERE id = ?').get(ped4).estado === 'decidido_adm' && decisaoDe(s4, EDI) === 'aprovou' && fase(s4) === 'liberada' && await page.isHidden('#impasses'));
await page.click('.painel-btn'); await page.waitForSelector('.painel-aval table');
txt = await page.textContent('.painel-aval');
ok('Tela ADM: painel dos professores com nomes e situação', txt.includes('Edi Franco') && txt.includes('Telma Paes') && txt.includes('Aprovou'), txt.slice(0, 200));
// --- supervisor: "Ajustar a seleção" com pedido em aberto ---
const P5 = Number(db.prepare("INSERT INTO provas (ano, bimestre, serie, tipo, modalidade, aplicacao) VALUES (?, 3, 2, 'MED', 'PART', ?)").run(ANO, ANO + '-09-11').lastInsertRowid); db.prepare('INSERT INTO prova_disciplinas (prova_id, disciplina, quantidade) VALUES (?, ?, ?)').run(P5, 'Literatura', 1);
const s5 = await selecao(P5, [q2]);
await ver(s5, tEdi, 1); await pedido(s5, tEdi, 1, 'trocar', 'Já caiu em outra prova.'); await finalizar(s5, tEdi);
await login('Supervisor', 'marcio.alex'); await page.waitForURL(/supervisor\.html/);
await page.goto('https://idealolimpico.com.br/atlas/supervisor-selecoes.html?id=' + s5); await page.waitForSelector('.pedido-card.aguarda .pc-ajustar');
await page.click('.pedido-card.aguarda .pc-ajustar'); await page.waitForSelector('#ajuste-barra');
ok('Tela Sup: "Ajustar a seleção" abre o editor com a barra laranja; Finalizar e Excluir ficam escondidos', await page.isVisible('#editor-bloco') && await page.isHidden('#enviar') && await page.isHidden('#excluir') && (await page.textContent('#ajuste-barra')).includes('Ajustando a seleção'));
await page.click('#ajuste-barra button'); await page.waitForSelector('#aval-profs tr');
ok('Tela Sup: a barra volta ao painel', await page.isVisible('#avaliacao-box') && await page.isHidden('#editor-bloco'));
await browser.close(); server.close();
ok('Telas: sem erros de JavaScript nem caixas do navegador', errors.length === 0 && dialogs.length === 0, errors.join(' ; ') + dialogs.join(';'));
for (const x of results) console.log(x.join(" | "));
const bad = results.filter(x => x[0] !== "OK  ").length; console.log(bad ? `
${bad} FALHA(S)` : `
TODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
