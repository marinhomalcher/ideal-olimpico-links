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

// --- ATLAS como base dos dados do aluno (21/11/2026) ---
env.ATLAS_API_URL = 'https://atlas-api.exemplo.workers.dev';
env.PORTAL_ATLAS_SECRET = 'segredo-atlas-para-os-testes-0123456789';
const atlasChamadas = [];
const atlasAluno = { matricula: '99999', nome: 'ALUNO ATLAS', serie: '3ª Série', segmento: 'EM', dataNascimento: '01/01/2010', cpf: '52998224725', emailPessoal: 'familia@example.com', whatsappAluno: '(91) 99999-9999', responsavelNome: '', responsavelVinculo: '', responsavelWhatsapp: '', contatosConfirmadosAno: 2026, contatosConfirmadosNesteAno: true, anoAtual: 2026 };
const respostaAluno = () => new Response(JSON.stringify({ ok: true, aluno: atlasAluno }));
let atlasResposta = () => respostaAluno();
const SESSAO = 'S'.repeat(64);
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith(env.ATLAS_API_URL)) { atlasChamadas.push({ url: String(url), auth: opts.headers.Authorization, body: JSON.parse(opts.body) }); return atlasResposta(String(url)); }
  const corpo = JSON.parse(opts.body); enviados.push(corpo);
  if (corpo.method === 'autenticarAlunoCodigo' || corpo.method === 'retomarSessaoAluno') return new Response(JSON.stringify({ ok: true, data: { status: 'OK', sessao: SESSAO, aluno: { matricula: '99999', nome: 'ALUNO PLANILHA', email: '99999@aluno.grupoideal.com.br', unidade: 'Batista Campos', serie: '2ª Série', segmento: 'EM', cpf: '', emailPessoal: 'velho@example.com', contatosConfirmadosNesteAno: false } } }));
  return new Response(JSON.stringify({ ok: true, data: { eco: corpo.method } }));
};
r = await call('autenticarAlunoCodigo', ['99999', '123456']);
let al = r.data.data.aluno;
ok('Login: os dados do ATLAS prevalecem (nome, série, contatos, confirmação); unidade e e-mail da planilha ficam', r.status === 200 && al.nome === 'ALUNO ATLAS' && al.serie === '3ª Série' && al.emailPessoal === 'familia@example.com' && al.cpf === '52998224725' && al.contatosConfirmadosNesteAno === true && al.unidade === 'Batista Campos' && al.email === '99999@aluno.grupoideal.com.br' && al.atlas === true, JSON.stringify(al));
ok('Login consulta o ATLAS com o segredo e a matrícula', atlasChamadas.at(-1).url === env.ATLAS_API_URL + '/api/portal/aluno' && atlasChamadas.at(-1).auth === 'Bearer ' + env.PORTAL_ATLAS_SECRET && atlasChamadas.at(-1).body.ra === '99999');
const prova = al.atlasProva;
ok('Login devolve a prova (64 hexadecimais)', /^[0-9a-f]{64}$/.test(prova), prova);
r = await call('retomarSessaoAluno', ['L' + 'a'.repeat(77)]);
ok('Acesso lembrado também completa com o ATLAS e recebe a prova da sessão', r.data.data.aluno.nome === 'ALUNO ATLAS' && r.data.data.aluno.atlasProva === prova);
atlasResposta = () => new Response(JSON.stringify({ ok: true, aluno: null }));
r = await call('autenticarAlunoCodigo', ['99999', '123456']);
ok('Aluno fora do ATLAS: ficam os dados da planilha, mas a prova vai junto', r.data.data.aluno.nome === 'ALUNO PLANILHA' && r.data.data.aluno.atlasProva === prova && r.data.data.aluno.atlas === undefined);
atlasResposta = () => { throw new Error('rede'); };
r = await call('autenticarAlunoCodigo', ['99999', '123456']);
ok('ATLAS fora do ar: o login continua com a planilha', r.status === 200 && r.data.ok && r.data.data.aluno.nome === 'ALUNO PLANILHA');
atlasResposta = () => respostaAluno();

const dados = { whatsappAluno: '(91) 99999-9999', responsavelNome: '', responsavelVinculo: '', responsavelWhatsapp: '', emailPessoal: 'familia@example.com', cpf: '52998224725' };
n = enviados.length; let nA = atlasChamadas.length;
r = await call('confirmarCadastroAluno', [SESSAO, { ...dados, atlas: { ra: '99999', prova } }]);
ok('Confirmação: grava no ATLAS (matrícula da prova) e depois na planilha, já sem a prova', r.status === 200 && r.data.ok && atlasChamadas.length === nA + 1 && atlasChamadas.at(-1).url.endsWith('/api/portal/aluno/confirmar') && atlasChamadas.at(-1).body.ra === '99999' && JSON.stringify(atlasChamadas.at(-1).body.dados) === JSON.stringify(dados) && enviados.length === n + 1 && JSON.stringify(enviados.at(-1).args[1]) === JSON.stringify(dados), JSON.stringify(enviados.at(-1)));
r = await call('confirmarCadastroAluno', [SESSAO, { ...dados, atlas: { ra: '11111', prova } }]);
ok('Prova de outra matrícula: recusada antes de gravar em qualquer lugar', r.data.ok === false && /Sessão inválida/.test(r.data.error) && atlasChamadas.length === nA + 1 && enviados.length === n + 1, JSON.stringify(r.data));
r = await call('confirmarCadastroAluno', ['T'.repeat(64), { ...dados, atlas: { ra: '99999', prova } }]);
ok('Prova com outra sessão: recusada', r.data.ok === false && atlasChamadas.length === nA + 1 && enviados.length === n + 1);
r = await call('confirmarCadastroAluno', [SESSAO, dados]);
ok('Sem prova (login antigo): segue só para a planilha', r.data.ok && atlasChamadas.length === nA + 1 && enviados.length === n + 2);
atlasResposta = url => url.endsWith('/confirmar') ? new Response(JSON.stringify({ ok: false, error: 'Informe um CPF válido do aluno (11 números).' }), { status: 400 }) : respostaAluno();
r = await call('confirmarCadastroAluno', [SESSAO, { ...dados, atlas: { ra: '99999', prova } }]);
ok('Erro de validação do ATLAS volta ao aluno e nada vai à planilha', r.data.ok === false && /CPF válido/.test(r.data.error) && enviados.length === n + 2, JSON.stringify(r.data));
atlasResposta = url => url.endsWith('/confirmar') ? new Response(JSON.stringify({ ok: false, error: 'Aluno não encontrado na lista do ATLAS.' }), { status: 404 }) : respostaAluno();
r = await call('confirmarCadastroAluno', [SESSAO, { ...dados, atlas: { ra: '99999', prova } }]);
ok('Aluno fora da lista do ATLAS: segue só para a planilha', r.data.ok && enviados.length === n + 3);
atlasResposta = url => url.endsWith('/confirmar') ? new Response('erro', { status: 500 }) : respostaAluno();
r = await call('confirmarCadastroAluno', [SESSAO, { ...dados, atlas: { ra: '99999', prova } }]);
ok('ATLAS fora do ar na confirmação: avisa e não grava na planilha', r.data.ok === false && /Não foi possível salvar/.test(r.data.error) && enviados.length === n + 3, JSON.stringify(r.data));
atlasResposta = () => respostaAluno();
nA = atlasChamadas.length;
delete env.PORTAL_ATLAS_SECRET;
r = await call('autenticarAlunoCodigo', ['99999', '123456']);
ok('Sem o segredo do ATLAS: login como antes, sem prova e sem consulta', r.data.data.aluno.nome === 'ALUNO PLANILHA' && r.data.data.aluno.atlasProva === undefined && atlasChamadas.length === nA);
r = await call('confirmarCadastroAluno', [SESSAO, { ...dados, atlas: { ra: '99999', prova } }]);
ok('Sem o segredo do ATLAS: a confirmação vai à planilha sem a prova', r.data.ok && atlasChamadas.length === nA && JSON.stringify(enviados.at(-1).args[1]) === JSON.stringify(dados));
globalThis.fetch = fetchOriginal;

for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK  ').length;
console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`);
process.exit(bad ? 1 : 0);
