// Etapa A da aprovação das provas: calendário de dias não úteis, prazo em dias úteis (Belém) e séries do professor. Dados fictícios.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const dias = await import(pathToFileURL(REPO + '_cloudflare/atlas-api/diasuteis.js').href);
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

// ---- 1. Datas móveis ----
const iso = d => d.toISOString().slice(0, 10);
ok('Páscoa: 05/04/2026 e 28/03/2027', iso(dias.pascoa(2026)) === '2026-04-05' && iso(dias.pascoa(2027)) === '2027-03-28');
ok('Círio (2º domingo de outubro): 11/10/2026 e 10/10/2027', iso(dias.cirio(2026)) === '2026-10-11' && iso(dias.cirio(2027)) === '2027-10-10');

// ---- 2. Calendário padrão = decisões do Marinho (27/11/2026) ----
const c26 = Object.fromEntries(dias.calendarioPadrao(2026).map(d => [d.data, d]));
const naoUteis26 = ['2026-01-01', '2026-01-02', '2026-01-12', '2026-02-16', '2026-02-17', '2026-02-18', '2026-04-03', '2026-04-21', '2026-05-01', '2026-09-07', '2026-10-12', '2026-10-26', '2026-11-02', '2026-11-20'];
ok('2026: são NÃO úteis os dias que o Marinho decidiu', naoUteis26.every(d => c26[d]?.ativo === 1), naoUteis26.filter(d => c26[d]?.ativo !== 1).join(','));
const uteis26 = ['2026-04-02', '2026-06-04', '2026-06-05', '2026-10-28'];
ok('2026: pontos facultativos (02/04, 04/06, 05/06, 28/10) contam como úteis, mas ficam na lista', uteis26.every(d => c26[d] && c26[d].ativo === 0), uteis26.filter(d => !c26[d] || c26[d].ativo !== 0).join(','));
ok('2026: 12/10 junta Nossa Senhora Aparecida e a segunda depois do Círio', /Aparecida/.test(c26['2026-10-12'].motivo) && /Círio/.test(c26['2026-10-12'].motivo), c26['2026-10-12'].motivo);
const c27 = Object.fromEntries(dias.calendarioPadrao(2027).map(d => [d.data, d]));
ok('2027: Carnaval 08 e 09/02, Cinzas 10/02, Sexta-Feira Santa 26/03, pós-Círio 11/10, Recírio 25/10', ['2027-02-08', '2027-02-09', '2027-02-10', '2027-03-26', '2027-10-11', '2027-10-25'].every(d => c27[d]?.ativo === 1));
const noBanco = Object.fromEntries(db.prepare("SELECT data, motivo, ativo FROM dias_nao_uteis WHERE data LIKE '2026-%' OR data LIKE '2027-%'").all().map(r => [r.data, r]));
const esperado = [...dias.calendarioPadrao(2026), ...dias.calendarioPadrao(2027)];
ok('A migração já traz o calendário padrão de 2026 e 2027 (igual ao gerado pelas regras)', esperado.length === Object.keys(noBanco).length && esperado.every(d => noBanco[d.data]?.ativo === d.ativo && noBanco[d.data]?.motivo === d.motivo), esperado.length + ' x ' + Object.keys(noBanco).length);

// ---- 3. Prazo em dias úteis (relógio de Belém, UTC-3) ----
const set = await dias.diasNaoUteis({ DB });
ok('Conjunto de não úteis vem do banco (só ativo = 1)', set.has('2026-10-12') && !set.has('2026-10-28'));
ok('Quinta 19/11 10h + 3 dias úteis = quarta 25/11 10h (pula 20/11 Consciência Negra e o fim de semana)', dias.prazoEmDiasUteis('2026-11-19T13:00:00Z', 3, set) === '2026-11-25T13:00:00Z', dias.prazoEmDiasUteis('2026-11-19T13:00:00Z', 3, set));
ok('Sexta 09/10 + 3 dias úteis = quinta 15/10 (pula a segunda pós-Círio, 12/10)', dias.prazoEmDiasUteis('2026-10-09T15:00:00Z', 3, set) === '2026-10-15T15:00:00Z', dias.prazoEmDiasUteis('2026-10-09T15:00:00Z', 3, set));
ok('Sexta 23/10 + 3 dias úteis = quinta 29/10 (pula o Recírio, 26/10; 28/10 conta como útil)', dias.prazoEmDiasUteis('2026-10-23T15:00:00Z', 3, set) === '2026-10-29T15:00:00Z', dias.prazoEmDiasUteis('2026-10-23T15:00:00Z', 3, set));
ok('23h30 em Belém (02h30 UTC do dia seguinte) conta a data de Belém', dias.prazoEmDiasUteis('2026-11-19T02:30:00Z', 3, set) === '2026-11-25T02:30:00Z', dias.prazoEmDiasUteis('2026-11-19T02:30:00Z', 3, set));
ok('Fim de semana e feriado não são dias úteis', !dias.ehDiaUtil('2026-11-21', set) && !dias.ehDiaUtil('2026-11-02', set) && dias.ehDiaUtil('2026-11-03', set));

// ---- 4. Rotas do ADM ----
const tAdm = (await call('/api/adm/login', { method: 'POST', body: { credential: await jwt({}) } })).data.token;
let r = await call('/api/adm/calendario?ano=2026');
ok('Sem login o calendário é recusado', (await call('/api/adm/calendario?ano=2026')).status === 401);
r = await call('/api/adm/calendario?ano=2026', { token: tAdm });
ok('ADM lista o calendário de 2026 com dia da semana', r.status === 200 && r.data.dias.length > 15 && r.data.dias.find(d => d.data === '2026-10-12')?.dia_semana === 'segunda-feira', JSON.stringify(r.data).slice(0, 120));
r = await call('/api/adm/calendario/2026-10-28', { method: 'PUT', token: tAdm, body: { ativo: true } });
ok('ADM liga um ponto facultativo (28/10 passa a não útil)', r.status === 200 && r.data.dia.ativo === true && (await dias.diasNaoUteis({ DB })).has('2026-10-28'));
r = await call('/api/adm/calendario/2026-10-28', { method: 'PUT', token: tAdm, body: { ativo: false } });
ok('ADM desliga de novo (volta a contar como útil)', r.status === 200 && !(await dias.diasNaoUteis({ DB })).has('2026-10-28'));
r = await call('/api/adm/calendario', { method: 'POST', token: tAdm, body: { data: '2026-11-27', motivo: 'Recesso da escola', ativo: true } });
ok('ADM adiciona um dia (recesso) e ele entra nos prazos', r.status === 200 && (await dias.diasNaoUteis({ DB })).has('2026-11-27'));
r = await call('/api/adm/calendario', { method: 'POST', token: tAdm, body: { data: '2026-02-30', motivo: 'X' } });
ok('Data inexistente é recusada', r.status === 400);
r = await call('/api/adm/calendario', { method: 'POST', token: tAdm, body: { data: '2026-11-28', motivo: '   ' } });
ok('Sem motivo é recusado', r.status === 400);
r = await call('/api/adm/calendario/2026-11-27', { method: 'DELETE', token: tAdm });
ok('ADM apaga um dia', r.status === 200 && !db.prepare("SELECT 1 FROM dias_nao_uteis WHERE data = '2026-11-27'").get());
r = await call('/api/adm/calendario/carregar', { method: 'POST', token: tAdm, body: { ano: 2028 } });
const n28 = db.prepare("SELECT COUNT(*) AS n FROM dias_nao_uteis WHERE data LIKE '2028-%'").get().n;
ok('"Carregar 2028" cria os dias padrão do ano', r.status === 200 && r.data.novos === dias.calendarioPadrao(2028).length && n28 === r.data.novos, JSON.stringify(r.data));
r = await call('/api/adm/calendario/carregar', { method: 'POST', token: tAdm, body: { ano: 2028 } });
ok('Carregar de novo não duplica nem apaga o que o ADM mudou', r.status === 200 && r.data.novos === 0);
r = await call('/api/adm/calendario/carregar', { method: 'POST', token: tAdm, body: { ano: 1999 } });
ok('Ano fora do intervalo é recusado', r.status === 400);

// ---- 5. Séries do professor ----
r = await call('/api/adm/pessoas', { method: 'POST', token: tAdm, body: { nome: 'Telma Paes', email: 'telma.paes', banco: { tipo: 'professor', disciplina: 'Literatura' }, series: [1, 2] } });
const telma = r.data?.pessoas?.find(p => p.nome === 'Telma Paes');
ok('ADM cadastra professor com as séries 1 e 2', r.status === 200 && JSON.stringify(telma?.series) === '[1,2]', JSON.stringify(telma?.series));
r = await call('/api/adm/pessoas/' + telma.id, { method: 'PUT', token: tAdm, body: { series: [3] } });
ok('ADM troca para só a 3ª série', r.status === 200 && JSON.stringify(r.data.pessoas.find(p => p.id === telma.id).series) === '[3]', JSON.stringify(r.data).slice(0, 120));
r = await call('/api/adm/pessoas/' + telma.id, { method: 'PUT', token: tAdm, body: { nome: 'Telma Paes' } });
ok('Salvar sem mandar séries não mexe nas séries', r.status === 200 && JSON.stringify(r.data.pessoas.find(p => p.id === telma.id).series) === '[3]');
r = await call('/api/adm/pessoas/' + telma.id, { method: 'PUT', token: tAdm, body: { series: [4] } });
ok('Série fora de 1 a 3 é recusada', r.status === 400);
r = await call('/api/adm/pessoas/' + telma.id, { method: 'PUT', token: tAdm, body: { series: [] } });
ok('Lista vazia tira todas as séries', r.status === 200 && r.data.pessoas.find(p => p.id === telma.id).series.length === 0);
const ev = db.prepare("SELECT COUNT(*) AS n FROM eventos WHERE acao IN ('calendario_dia_salvo','calendario_ano_carregado','calendario_dia_apagado')").get().n;
ok('As mudanças do calendário ficam registradas nos eventos', ev >= 4, ev);

for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK  ').length; console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
