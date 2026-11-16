// Rota do portal do aluno: envio do código de login (servidor a servidor, só pela Microsoft).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));   // raiz do repositório
const worker = (await import(new URL('../worker.js?' + Date.now(), import.meta.url).href)).default;
const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'OK  ' : 'FALHOU', name, String(extra).slice(0, 160)]);

// ---- D1 falso (SQLite real) ----
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
  ATLAS_HOJE_TESTE: '2026-11-13', DB, ATLAS_MAILER_SECRET: 'segredo-de-teste', ATLAS_MAILER_URL: 'https://mailer.test/exec',
  MS_TENANT_ID: 'tenant-teste', MS_CLIENT_ID: 'cliente-teste', MS_REMETENTE: 'olimpiadas@grupoideal.com.br', MS_CLIENT_SECRET: 'segredo-ms-teste',
  PORTAL_ATLAS_SECRET: SEGREDO
};

// ---- Microsoft e Apps Script falsos ----
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

async function call(body, { segredo = SEGREDO, origin = null, method = 'POST', ctype = 'application/json' } = {}) {
  const headers = {};
  if (segredo !== null) headers.Authorization = 'Bearer ' + segredo;
  if (origin) headers.Origin = origin;
  if (body !== undefined) headers['Content-Type'] = ctype;
  const res = await worker.fetch(new Request('https://atlas-api.test/api/portal/codigo-aluno', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
}
const limpar = () => db.exec('DELETE FROM login_rate_limits');

// ---- caminho feliz ----
let r = await call({ ra: '12345', codigo: '048213' });
const e = ms.envios.at(-1);
ok('Envia o código (200)', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
ok('Destino é RA@aluno.grupoideal.com.br', e?.message.toRecipients.length === 1 && e.message.toRecipients[0].emailAddress.address === '12345@aluno.grupoideal.com.br');
ok('Assunto e texto do portal, com o código', e?.message.subject === 'Seu código de acesso ao Portal IDEAL OLÍMPICO' && /Portal IDEAL OLÍMPICO é: 048213/.test(e.message.body.content) && /10 minutos/.test(e.message.body.content) && !/ATLAS/.test(e.message.body.content));
ok('Resposta sem liberação para navegadores (sem CORS)', !r.headers.get('Access-Control-Allow-Origin'));
const raNoBanco = db.prepare('SELECT chave FROM login_rate_limits').all().some(x => x.chave.includes('12345'));
ok('RA não fica gravado no banco (chaves embaralhadas)', !raNoBanco);
ok('Código não fica gravado no banco', db.prepare('SELECT COUNT(*) AS n FROM login_codigos').get().n === 0);

// ---- quem pode chamar ----
limpar(); let n = ms.envios.length;
r = await call({ ra: '12345', codigo: '111111' }, { segredo: null });
ok('Sem segredo: 401 e nada enviado', r.status === 401 && ms.envios.length === n, r.status);
r = await call({ ra: '12345', codigo: '111111' }, { segredo: SEGREDO.slice(0, -1) + 'x' });
ok('Segredo errado: 401', r.status === 401 && ms.envios.length === n, r.status);
r = await call({ ra: '12345', codigo: '111111' }, { segredo: SEGREDO + 'a' });
ok('Segredo com sobra: 401', r.status === 401 && ms.envios.length === n, r.status);
r = await call({ ra: '12345', codigo: '111111' }, { origin: 'https://idealolimpico.com.br' });
ok('Chamada de navegador (com Origin) é recusada mesmo com segredo', r.status === 403 && ms.envios.length === n, r.status);
r = await call(undefined, { method: 'GET' });
ok('GET não existe', r.status !== 200 && ms.envios.length === n, r.status);

// ---- dados ----
for (const [nome, body] of [
  ['RA com letra', { ra: '12a45', codigo: '111111' }],
  ['RA vazio', { ra: '', codigo: '111111' }],
  ['RA numérico (não texto)', { ra: 12345, codigo: '111111' }],
  ['RA com e-mail embutido', { ra: '1@x.com,2', codigo: '111111' }],
  ['Código com 5 dígitos', { ra: '12345', codigo: '11111' }],
  ['Código com letra', { ra: '12345', codigo: '11111a' }],
]) {
  r = await call(body);
  ok(nome + ': 400', r.status === 400 && ms.envios.length === n, r.status);
}
r = await call({ ra: '12345', codigo: '111111', email: 'outro@gmail.com', para: 'outro@gmail.com' });
ok('Campo "email"/"para" extra é ignorado (destino continua o do RA)', r.status === 200 && ms.envios.at(-1).message.toRecipients[0].emailAddress.address === '12345@aluno.grupoideal.com.br');
r = await call({ ra: '9'.repeat(10), codigo: '123456'.repeat(200) });
ok('Corpo grande demais: recusado', r.status === 413 || r.status === 400, r.status);

// ---- limites ----
limpar(); n = ms.envios.length;
await call({ ra: '22222', codigo: '111111' });
r = await call({ ra: '22222', codigo: '222222' });
ok('Segundo pedido do mesmo RA em menos de 1 minuto: 429', r.status === 429 && ms.envios.length === n + 1, r.status);
r = await call({ ra: '33333', codigo: '222222' });
ok('Outro RA no mesmo minuto: enviado', r.status === 200 && ms.envios.length === n + 2);
// 10 por hora por RA (zerando só o intervalo de 1 minuto)
limpar();
const chaveIntervalo = createHmac('sha256', SEGREDO).update('portal-intervalo:44444').digest('hex');
let status = [];
for (let i = 0; i < 11; i++) {
  db.prepare('DELETE FROM login_rate_limits WHERE chave = ?').run(chaveIntervalo);
  status.push((await call({ ra: '44444', codigo: '111111' })).status);
}
ok('Máximo de 10 códigos por hora para o mesmo RA', status.slice(0, 10).every(s => s === 200) && status[10] === 429, status.join(','));
// teto geral: 25 por minuto
limpar(); n = ms.envios.length; status = [];
for (let i = 0; i < 26; i++) status.push((await call({ ra: String(50000 + i), codigo: '111111' })).status);
ok('Teto de 25 envios por minuto no total', status.slice(0, 25).every(s => s === 200) && status[25] === 429 && ms.envios.length === n + 25, status.at(-1));
ok('Mensagem do teto é clara', /Muitos alunos entrando agora/.test((await call({ ra: '59999', codigo: '111111' })).data.error));

// ---- falhas de envio ----
limpar(); n = appsScript; ms.envioStatus = 500;
r = await call({ ra: '12345', codigo: '111111' });
ok('Microsoft falha: 502 e NÃO usa o Apps Script do ATLAS', r.status === 502 && appsScript === n, r.status);
ms.envioStatus = 202;
limpar(); delete env.MS_CLIENT_SECRET;
r = await call({ ra: '12345', codigo: '111111' });
ok('Sem Microsoft configurada: 503', r.status === 503 && appsScript === n, r.status);
env.MS_CLIENT_SECRET = 'segredo-ms-teste';
env.PORTAL_ATLAS_SECRET = 'curto-demais';
r = await call({ ra: '12345', codigo: '111111' }, { segredo: 'curto-demais' });
ok('Segredo do portal com menos de 32 caracteres: rota desligada (503)', r.status === 503, r.status);
let s = await worker.fetch(new Request('https://atlas-api.test/api/saude'), env);
ok('Saúde mostra portal_aluno = false sem segredo válido', (await s.json()).portal_aluno === false);
delete env.PORTAL_ATLAS_SECRET;
r = await call({ ra: '12345', codigo: '111111' }, { segredo: '' });
ok('Sem segredo configurado: 503 (nunca aceita segredo vazio)', r.status === 503, r.status);
env.PORTAL_ATLAS_SECRET = SEGREDO;
s = await worker.fetch(new Request('https://atlas-api.test/api/saude'), env);
ok('Saúde mostra portal_aluno = true com o segredo', (await s.json()).portal_aluno === true);

// ---- RA de teste (PORTAL_TESTE_ALUNO) ----
const destino = async ra => { limpar(); const r = await call({ ra, codigo: '111111' }); return [r.status, ms.envios.at(-1).message.toRecipients[0].emailAddress.address]; };
env.PORTAL_TESTE_ALUNO = ' 99999=Digitacao@GrupoIdeal.com.br ';
let d = await destino('99999');
ok('RA de teste vai para a caixa da equipe', d[0] === 200 && d[1] === 'digitacao@grupoideal.com.br', d.join(' '));
d = await destino('12345');
ok('Outros RAs continuam no @aluno com a variável ligada', d[1] === '12345@aluno.grupoideal.com.br', d[1]);
d = await destino('999990');
ok('RA parecido (prefixo) não é desviado', d[1] === '999990@aluno.grupoideal.com.br', d[1]);
for (const [nome, valor] of [
  ['domínio de fora', '99999=alguem@gmail.com'],
  ['subdomínio enganoso', '99999=x@grupoideal.com.br.evil.com'],
  ['domínio do aluno', '99999=x@aluno.grupoideal.com.br'],
  ['dois destinos', '99999=a@grupoideal.com.br,b@gmail.com'],
  ['sem RA', '=digitacao@grupoideal.com.br'],
]) {
  env.PORTAL_TESTE_ALUNO = valor;
  d = await destino('99999');
  ok('Variável inválida (' + nome + ') é ignorada', d[1] === '99999@aluno.grupoideal.com.br', d[1]);
}
delete env.PORTAL_TESTE_ALUNO;
d = await destino('99999');
ok('Sem a variável, o RA de teste vai para o @aluno', d[1] === '99999@aluno.grupoideal.com.br', d[1]);

// ---- login dos professores continua igual ----
limpar();
r = await worker.fetch(new Request('https://atlas-api.test/api/login/codigo', { method: 'POST', headers: { Origin: 'https://idealolimpico.com.br', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ninguem@grupoideal.com.br' }) }), env);
ok('Login do ATLAS continua respondendo', r.status === 200);

for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK  ').length; console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
