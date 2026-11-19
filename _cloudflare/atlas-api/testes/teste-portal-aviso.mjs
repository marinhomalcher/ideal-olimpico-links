// Rota do portal do aluno: avisos de pedido no e-mail pessoal (servidor a servidor, só pela Microsoft).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const worker = (await import(new URL('../worker.js?' + Date.now(), import.meta.url).href)).default;
const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'OK  ' : 'FALHOU', name, String(extra).slice(0, 160)]);

const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync(REPO + '_cloudflare/atlas-api/schema.sql', 'utf8'));
function stmt(sql, args = []) {
  return {
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) })
  };
}
const DB = { prepare: sql => stmt(sql), batch: async list => { for (const s of list) await s.run(); } };
const SEGREDO = 'segredo-portal-de-teste-com-mais-de-32-caracteres';
const env = {
  ATLAS_HOJE_TESTE: '2026-11-18', DB, ATLAS_MAILER_SECRET: 'segredo-de-teste', ATLAS_MAILER_URL: 'https://mailer.test/exec',
  MS_TENANT_ID: 'tenant-teste', MS_CLIENT_ID: 'cliente-teste', MS_REMETENTE: 'olimpiadas@grupoideal.com.br', MS_CLIENT_SECRET: 'segredo-ms-teste',
  PORTAL_ATLAS_SECRET: SEGREDO
};
const ms = { envios: [], envioStatus: 202 };
let appsScript = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://login.microsoftonline.com/')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3599 }), { status: 200 });
  if (u.startsWith('https://graph.microsoft.com/')) {
    ms.envios.push(JSON.parse(opts.body));
    return ms.envioStatus === 202 ? new Response(null, { status: 202 }) : new Response('{}', { status: ms.envioStatus });
  }
  if (u === 'https://mailer.test/exec') { appsScript++; return new Response(JSON.stringify({ ok: true })); }
  throw new Error('fetch inesperado: ' + u);
};
async function call(body, { segredo = SEGREDO, origin = null, method = 'POST', rota = '/api/portal/aviso-aluno' } = {}) {
  const headers = {};
  if (segredo !== null) headers.Authorization = 'Bearer ' + segredo;
  if (origin) headers.Origin = origin;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request('https://atlas-api.test' + rota, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
}
const limpar = () => db.exec('DELETE FROM login_rate_limits');
const aviso = (extra = {}) => ({ ra: '12345', email: 'Mae.Do.Aluno@Gmail.com', assunto: 'Sua solicitação de inscrição foi registrada', texto: 'Olá Aluno,\r\n\r\nPedido: P-1\nValor: R$ 25,00\n\nPortal: https://idealolimpico.com.br/inscricoes/', ...extra });

// ---- caminho feliz ----
let r = await call(aviso());
let e = ms.envios.at(-1);
ok('Envia o aviso (200)', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
ok('Destino é o e-mail pessoal informado, em minúsculas', e?.message.toRecipients.length === 1 && e.message.toRecipients[0].emailAddress.address === 'mae.do.aluno@gmail.com');
ok('Assunto ganha o prefixo IDEAL OLÍMPICO', e?.message.subject === 'IDEAL OLÍMPICO — Sua solicitação de inscrição foi registrada');
ok('Texto vai como o portal mandou (quebras normalizadas)', e?.message.body.content === 'Olá Aluno,\n\nPedido: P-1\nValor: R$ 25,00\n\nPortal: https://idealolimpico.com.br/inscricoes/' && e.message.body.contentType === 'Text');
ok('Sem CORS (não é para navegador)', !r.headers.get('Access-Control-Allow-Origin'));
ok('RA e e-mail não ficam no banco (chaves embaralhadas)', !db.prepare('SELECT chave FROM login_rate_limits').all().some(x => /12345|gmail/.test(x.chave)));

// ---- quem pode chamar ----
limpar(); let n = ms.envios.length;
r = await call(aviso(), { segredo: null });
ok('Sem segredo: 401', r.status === 401 && ms.envios.length === n, r.status);
r = await call(aviso(), { segredo: SEGREDO + 'a' });
ok('Segredo errado: 401', r.status === 401 && ms.envios.length === n, r.status);
r = await call(aviso(), { origin: 'https://idealolimpico.com.br' });
ok('Navegador (com Origin) é recusado mesmo com segredo', r.status === 403 && ms.envios.length === n, r.status);
r = await call(undefined, { method: 'GET' });
ok('GET não existe', r.status !== 200 && ms.envios.length === n, r.status);

// ---- dados ----
for (const [nome, extra] of [
  ['RA com letra', { ra: '12a45' }],
  ['RA numérico (não texto)', { ra: 12345 }],
  ['e-mail sem arroba', { email: 'mae.gmail.com' }],
  ['e-mail com espaço', { email: 'mae @gmail.com' }],
  ['dois e-mails', { email: 'a@gmail.com,b@gmail.com' }],
  ['assunto vazio', { assunto: '  ' }],
  ['assunto longo', { assunto: 'x'.repeat(151) }],
  ['texto vazio', { texto: '' }],
  ['texto longo', { texto: 'x'.repeat(4001) }],
  ['texto não é string', { texto: ['a'] }],
]) {
  r = await call(aviso(extra));
  ok(nome + ': 400', r.status === 400 && ms.envios.length === n, r.status);
}
r = await call(aviso({ assunto: 'Linha 1\nLinha 2   com  espaços' }));
ok('Quebra de linha no assunto vira espaço', r.status === 200 && ms.envios.at(-1).message.subject === 'IDEAL OLÍMPICO — Linha 1 Linha 2 com espaços');
r = await call(aviso({ texto: 'a\u0000b\u0007c' }));
ok('Caracteres de controle no texto são removidos', r.status === 200 && ms.envios.at(-1).message.body.content === 'abc');
r = await call(aviso({ texto: 'x'.repeat(20000) }));
ok('Corpo grande demais: recusado', r.status === 413 || r.status === 400, r.status);

// ---- limites ----
limpar(); n = ms.envios.length;
let status = [];
for (let i = 0; i < 21; i++) status.push((await call(aviso({ ra: '44444' }))).status);
ok('Máximo de 20 avisos por hora para a mesma matrícula', status.slice(0, 20).every(s => s === 200) && status[20] === 429, status.join(','));
limpar(); n = ms.envios.length; status = [];
for (let i = 0; i < 26; i++) status.push((await call(aviso({ ra: String(50000 + i) }))).status);
ok('Teto de 25 envios por minuto no total', status.slice(0, 25).every(s => s === 200) && status[25] === 429 && ms.envios.length === n + 25, status.at(-1));
limpar();
for (let i = 0; i < 25; i++) await call(aviso({ ra: String(60000 + i) }));
r = await call({ ra: '70000', codigo: '123456' }, { rota: '/api/portal/codigo-aluno' });
ok('Teto por minuto é compartilhado com os códigos de login (caixa olimpiadas@)', r.status === 429, r.status);

// ---- falhas de envio ----
limpar(); n = appsScript; ms.envioStatus = 500;
r = await call(aviso());
ok('Microsoft falha: 502 e NÃO usa o Apps Script do ATLAS', r.status === 502 && appsScript === n, r.status);
ms.envioStatus = 202;
limpar(); delete env.MS_CLIENT_SECRET;
r = await call(aviso());
ok('Sem Microsoft configurada: 503', r.status === 503 && appsScript === n, r.status);
env.MS_CLIENT_SECRET = 'segredo-ms-teste';

// ---- código de login continua igual ----
limpar();
r = await call({ ra: '12345', codigo: '048213' }, { rota: '/api/portal/codigo-aluno' });
ok('Rota do código de login continua respondendo', r.status === 200 && ms.envios.at(-1).message.toRecipients[0].emailAddress.address === '12345@aluno.grupoideal.com.br', r.status);

for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK  ').length; console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
