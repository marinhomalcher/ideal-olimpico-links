// Teste local do Worker do portal (sem rede): node _cloudflare/ideal-olimpico-producao/teste-worker.mjs
const worker = (await import(new URL('./worker.js?' + Date.now(), import.meta.url).href)).default;
const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'OK  ' : 'FALHOU', name, String(extra).slice(0, 160)]);

// Limitador falso: conta chamadas por chave e recusa acima do teto.
function limitador(teto) {
  const usos = new Map();
  return { usos, async limit({ key }) { const n = (usos.get(key) || 0) + 1; usos.set(key, n); return { success: n <= teto }; } };
}
const env = {
  APPS_SCRIPT_PROD_EXEC_URL: 'https://script.google.com/macros/s/TESTE_ID/exec',
  PORTAL_PROD_PROXY_SECRET: 'segredo-proxy-teste',
  PORTAL_RATE_KEY_SECRET: 'segredo-rate-teste',
  PORTAL_LOGIN_LIMITER: limitador(12),
  PORTAL_LOGIN_IP_LIMITER: limitador(300),
  PORTAL_SESSION_LIMITER: limitador(120),
  PORTAL_CATALOG_LIMITER: limitador(5000),
  PORTAL_UPLOAD_LIMITER: limitador(3)
};
const enviados = [];
globalThis.fetch = async (url, opts) => {
  const corpo = JSON.parse(opts.body);
  enviados.push(corpo);
  return new Response(JSON.stringify({ ok: true, data: { eco: corpo.method } }));
};
async function call(method, args, ip = '203.0.113.7') {
  const res = await worker.fetch(new Request('https://w.test/api', {
    method: 'POST',
    headers: { Origin: 'https://idealolimpico.com.br', 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ method, args })
  }), env);
  return { status: res.status, data: await res.json().catch(() => null) };
}

let r = await call('solicitarCodigoAluno', ['00000']);
ok('solicitarCodigoAluno é repassado ao Apps Script', r.status === 200 && r.data.data.eco === 'solicitarCodigoAluno' && enviados.at(-1).secret === env.PORTAL_PROD_PROXY_SECRET);
r = await call('autenticarAlunoCodigo', ['00000', '123456']);
ok('autenticarAlunoCodigo é repassado ao Apps Script', r.status === 200 && r.data.data.eco === 'autenticarAlunoCodigo');
r = await call('autenticarAluno', ['00000', '2010-01-01']);
ok('Login antigo (data de nascimento) foi desligado', r.status === 400 && /não permitida/.test(r.data.error));
r = await call('solicitarCodigoAluno', ['00000', 'extra']);
ok('Número errado de argumentos: recusado', r.status === 400 && /não permitida/.test(r.data.error));
r = await call('autenticarAlunoCodigo', ['00000']);
ok('Código sem a matrícula: recusado', r.status === 400);

// Os três logins somam no mesmo teto por matrícula (12 por minuto).
let n = enviados.length;
const status = [];
for (let i = 0; i < 12; i++) status.push((await call(i % 2 ? 'solicitarCodigoAluno' : 'autenticarAlunoCodigo', i % 2 ? ['11111'] : ['11111', '000000'])).status);
r = await call('solicitarCodigoAluno', ['11111']);
ok('Teto por matrícula compartilhado entre pedir código e tentar código', status.every(s => s === 200) && r.status === 429 && enviados.length === n + 12, status.join(',') + ' / ' + r.status);
r = await call('solicitarCodigoAluno', ['22222']);
ok('Outra matrícula não é afetada', r.status === 200);

// Teto por IP também vale para as rotas novas.
env.PORTAL_LOGIN_IP_LIMITER = limitador(2);
await call('solicitarCodigoAluno', ['30001'], '198.51.100.1');
await call('solicitarCodigoAluno', ['30002'], '198.51.100.1');
r = await call('autenticarAlunoCodigo', ['30003', '123456'], '198.51.100.1');
ok('Teto por IP vale para o login por código', r.status === 429);
env.PORTAL_LOGIN_IP_LIMITER = limitador(300);

// Meu desempenho: lista e páginas, com o limite por sessão.
r = await call('meuDesempenho', ['a'.repeat(64)]);
ok('meuDesempenho é repassado ao Apps Script', r.status === 200 && r.data.data.eco === 'meuDesempenho');
r = await call('paginasDesempenho', ['a'.repeat(64), 7]);
ok('paginasDesempenho é repassado ao Apps Script', r.status === 200 && r.data.data.eco === 'paginasDesempenho');
r = await call('paginasDesempenho', ['a'.repeat(64)]);
ok('paginasDesempenho sem o documento: recusado', r.status === 400);
for (const m of ['lembrarAcessoAluno', 'retomarSessaoAluno', 'minhasConquistas', 'meusCertificados']) {
  r = await call(m, ['L' + 'a'.repeat(77)]);
  ok(m + ' é repassado ao Apps Script', r.status === 200 && r.data.data.eco === m);
  r = await call(m, []);
  ok(m + ' sem argumento: recusado', r.status === 400);
}

// Chave do limite não contém a matrícula em texto.
const chaves = [...env.PORTAL_LOGIN_LIMITER.usos.keys()];
ok('Chaves do limite são embaralhadas (sem matrícula visível)', chaves.length > 0 && chaves.every(k => /^[0-9a-f]{64}$/.test(k)));

// --- Cache do catálogo em memória e retentativa (18/11/2026) ---
const fetchOriginal = globalThis.fetch;
n = enviados.length;
r = await call('getCatalogoGrupo', ['OBF']);
let r2 = await call('getCatalogoGrupo', ['OBF']);
ok('Catálogo: segunda chamada vem da memória (uma ida ao Apps Script)', r.status === 200 && r2.status === 200 && enviados.length === n + 1 && r2.data.data.eco === 'getCatalogoGrupo');
n = enviados.length;
const paralelas = await Promise.all([1, 2, 3, 4, 5].map(() => call('getCatalogoGrupo', ['SELETA'])));
ok('Catálogo: cinco chamadas simultâneas viram uma ida ao Apps Script', paralelas.every(x => x.status === 200) && enviados.length === n + 1);
let falhas = 1;
globalThis.fetch = async (url, opts) => { enviados.push(JSON.parse(opts.body)); if (falhas-- > 0) return new Response('erro', { status: 500 }); return new Response(JSON.stringify({ ok: true, data: { eco: 'ok' } })); };
n = enviados.length;
r = await call('verificarInscricaoExistente', ['sessao-x', 'COMP1']);
ok('Leitura: Apps Script fora do ar uma vez, repete e responde', r.status === 200 && r.data.ok === true && enviados.length === n + 2);
falhas = 1; n = enviados.length;
r = await call('criarPedido', ['sessao-x', { itens: [] }]);
ok('Gravação (criarPedido): não repete, devolve 502', r.status === 502 && enviados.length === n + 1);
falhas = 0;
let transitorios = 1;
globalThis.fetch = async (url, opts) => { enviados.push(JSON.parse(opts.body)); if (transitorios-- > 0) return new Response(JSON.stringify({ ok: false, error: 'Falha na operação. Tente novamente em instantes.' })); return new Response(JSON.stringify({ ok: true, data: { eco: 'ok' } })); };
n = enviados.length;
r = await call('listarPedidosAluno', ['sessao-y']);
ok('Leitura: "Falha na operação" (planilha recusou) é repetida', r.status === 200 && r.data.ok === true && enviados.length === n + 2);
globalThis.fetch = async (url, opts) => { enviados.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: false, error: 'Sessão expirada.' })); };
n = enviados.length;
r = await call('listarPedidosAluno', ['sessao-z']);
ok('Leitura: erro de regra de negócio não é repetido', r.status === 200 && r.data.ok === false && enviados.length === n + 1);
globalThis.fetch = async (url, opts) => { enviados.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: false, error: 'Grupo inválido.' })); };
n = enviados.length;
await call('getCatalogoGrupo', ['LIGMAT']);
await call('getCatalogoGrupo', ['LIGMAT']);
ok('Catálogo: resposta com erro não fica na memória', enviados.length === n + 2);
globalThis.fetch = fetchOriginal;

for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK  ').length;
console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`);
process.exit(bad ? 1 : 0);
