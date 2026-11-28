// Aprovação das provas pelos professores — etapa B (28/11/2026): "Finalizar prova" abre a avaliação para os professores da mesma
// disciplina e série; e-mail só de aviso; visualizador questão por questão (imagem com marca-d'água); votos, pedidos de mudança,
// finalização, liberação e botão verde do supervisor. Dados fictícios.
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

let r = await call('/api/saude');
ok('Schema 23', r.data.schema === '23', r.data.schema);
{ const m = new DatabaseSync(':memory:');
  m.exec(SQL.split('-- ---------- v23 ----------')[0]); m.exec(fs.readFileSync(REPO + '_cloudflare/atlas-api/migrations/0023_avaliacao_votos.sql', 'utf8'));
  ok('Migração 0023 cria avaliacao_votos sobre o schema 22 e marca a versão 23', m.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'avaliacao_votos'").get().n === 1 && m.prepare("SELECT valor FROM meta WHERE chave = 'schema_versao'").get().valor === '23'); }
ok('Cópia de segurança inclui as tabelas da aprovação (etapas A e B)', /'professor_series', 'dias_nao_uteis', 'avaliacao_professores', 'avaliacao_visualizacoes', 'avaliacao_pedidos', 'avaliacao_mensagens', 'avaliacao_votos'/.test(fs.readFileSync(REPO + '_cloudflare/atlas-api/worker.js', 'utf8')));

// ---- e-mail de aviso: só o aviso, sem a prova ----
{ const m = aval.emailAvisoAvaliacao({ nome: 'Telma <Paes>', disciplina: 'Literatura', prova: { serie: 2, tipo: 'REG', modalidade: 'ENEM1', bimestre: 4, aplicacao: '2026-12-03' }, prazoEm: '2026-12-02T13:30:00Z', total: 12 });
  ok('E-mail: assunto e texto com a prova, o prazo (horário de Belém) e o link, sem conteúdo', /aguardando a sua aprovação/.test(m.assunto) && /2ª série · REG · Simulado ENEM · 1º dia/.test(m.texto) && /até 02\/12\/2026 às 10h30/.test(m.texto) && m.texto.includes('professor-avaliar.html') && /não vai neste e-mail/.test(m.texto), m.texto);
  ok('E-mail HTML: título, prazo destacado, botão AVALIAR AGORA e nome escapado', m.html.includes('Há uma avaliação aguardando a sua aprovação') && m.html.includes('AVALIAR AGORA') && m.html.includes('Prazo: 3 dias úteis, até 02/12/2026 às 10h30') && m.html.includes('Telma &lt;Paes&gt;') && !m.html.includes('<Paes>'), m.html.length);
  ok('dataHoraBelem converte UTC para o relógio de Belém', aval.dataHoraBelem('2026-12-02T02:30:00Z') === '01/12/2026 às 23h30', aval.dataHoraBelem('2026-12-02T02:30:00Z')); }

// ---- provas (direto no banco: o formato do ADM já é testado em teste-provas) ----
function prova(serie, tipo, discs) { const id = Number(db.prepare("INSERT INTO provas (ano, bimestre, serie, tipo, modalidade, aplicacao) VALUES (?, 4, ?, ?, 'PART', ?)").run(ANO, serie, tipo, ANO + '-12-10').lastInsertRowid); for (const [d, q] of discs) db.prepare('INSERT INTO prova_disciplinas (prova_id, disciplina, quantidade) VALUES (?, ?, ?)').run(id, d, q); return id; }
const P1 = prova(2, 'REG', [['Literatura', 2]]);        // fluxo pela API: Edi e Telma
const P2 = prova(2, 'MED', [['Literatura', 2]]);        // fluxo pela tela: Edi
const P3 = prova(2, 'MIL', [['Literatura', 1]]);        // liberada: botão verde na tela do supervisor
const PQ = prova(1, 'REG', [['Química', 1]]);           // sem professor para avaliar
async function selecao(provaId, itens, token = tMarcio) { const s = (await call('/api/supervisor/selecoes', { method: 'POST', token, body: { prova_id: provaId } })).data.selecao.id; await call('/api/supervisor/selecoes/' + s, { method: 'PUT', token, body: { itens } }); return s; }
const s1 = await selecao(P1, [q1, q2]);

// ---- Finalizar prova abre a avaliação ----
let n0 = mails.length;
r = await call('/api/supervisor/selecoes/' + s1 + '/enviar', { method: 'POST', token: tMarcio, body: {} }); await espera();
const sel1 = db.prepare('SELECT * FROM selecoes WHERE id = ?').get(s1);
ok('Finalizar prova: seleção continua rascunho, fase "avaliacao", 2 professores (Edi e Telma; Lit3, Química e o colaborador ficam de fora)', r.status === 200 && r.data.selecao.fase === 'avaliacao' && r.data.avaliacao.professores === 2 && sel1.situacao === 'rascunho' && sel1.fase === 'avaliacao' && !!sel1.avaliacao_aberta_em &&
  db.prepare('SELECT professor_id FROM avaliacao_professores WHERE selecao_id = ? ORDER BY professor_id').all(s1).map(x => x.professor_id).join() === [uid('edi.franco@grupoideal.com.br'), uid('telma.paes@grupoideal.com.br')].join(), JSON.stringify(r.data));
const naoUteis = new Set(db.prepare('SELECT data FROM dias_nao_uteis WHERE ativo = 1').all().map(x => x.data));
ok('Prazo = 3 dias úteis depois da abertura (calendário de Belém)', sel1.avaliacao_prazo_em === dias.prazoEmDiasUteis(sel1.avaliacao_aberta_em, 3, naoUteis), sel1.avaliacao_prazo_em);
ok('Versões das questões congeladas ao abrir a avaliação', db.prepare('SELECT COUNT(*) AS n FROM selecao_itens WHERE selecao_id = ? AND versao IS NOT NULL').get(s1).n === 2);
ok('Prova continua aberta: nada foi ao Diagramador', db.prepare('SELECT situacao FROM provas WHERE id = ?').get(P1).situacao === 'aberta');
const avisos = mails.slice(n0).filter(m => /aguardando a sua aprovação/.test(m.assunto));
ok('E-mail de aviso para Edi e Telma, sem a prova dentro (nem o texto das questões)', avisos.length === 2 && avisos.map(m => m.email).sort().join() === 'edi.franco@grupoideal.com.br,telma.paes@grupoideal.com.br' && avisos.every(m => !m.texto.includes(TEXTO_SECRETO) && !m.texto.includes('Álvares') && m.texto.includes('professor-avaliar.html')), avisos.map(m => m.email).join());
ok('ADM avisado de que a seleção está em avaliação', mails.slice(n0).some(m => m.email === 'marinhomalcher@gmail.com' && /em avaliação pelos professores/.test(m.assunto)));
ok('avisado_em gravado para cada professor', db.prepare('SELECT COUNT(*) AS n FROM avaliacao_professores WHERE selecao_id = ? AND avisado_em IS NOT NULL').get(s1).n === 2);

// ---- seleção travada enquanto avaliam ----
r = await call('/api/supervisor/selecoes/' + s1, { method: 'PUT', token: tMarcio, body: { itens: [q1, q3] } });
ok('Supervisor não altera a seleção em avaliação', r.status === 409 && /em avaliação/.test(r.data.error), r.data.error);
r = await call('/api/supervisor/selecoes/' + s1, { method: 'DELETE', token: tMarcio });
ok('Supervisor não exclui a seleção em avaliação', r.status === 409);
r = await call('/api/supervisor/selecoes/' + s1 + '/enviar', { method: 'POST', token: tMarcio, body: {} });
ok('Supervisor não finaliza de novo enquanto avaliam', r.status === 409);
r = await call('/api/supervisor/selecoes/' + s1, { token: tMarcio });
ok('GET do supervisor traz o resumo da avaliação (2 pendentes, 0 aprovaram)', r.data.selecao.fase === 'avaliacao' && r.data.selecao.avaliacao.total === 2 && r.data.selecao.avaliacao.pendentes === 2 && r.data.selecao.avaliacao.aprovaram === 0, JSON.stringify(r.data.selecao.avaliacao));
r = await call('/api/supervisor/selecoes', { token: tMarcio });
ok('Lista do supervisor traz a fase', r.data.selecoes.find(s => s.id === s1).fase === 'avaliacao');

// ---- quem pode ver ----
for (const [nome, t] of [['Professor de Química', tProfQ], ['Professor de Literatura só da 3ª série', tLit3], ['Colaborador (digitador)', tColab]]) {
  r = await call('/api/avaliacoes', { token: t });
  const r2 = await call('/api/avaliacoes/' + s1, { token: t });
  const r3 = await call('/api/avaliacoes/' + s1 + '/questao/1', { token: t });
  ok(nome + ': lista vazia e a seleção não existe para ele', (t === tColab ? r.status === 403 : r.status === 200 && r.data.avaliacoes.length === 0 && r.data.pendentes === 0) && [404, 403].includes(r2.status) && [404, 403].includes(r3.status), r.status + ' ' + r2.status + ' ' + r3.status);
}
r = await call('/api/avaliacoes/' + s1 + '/questao/1', { origin: 'https://outro.site' , token: tEdi });
ok('Origem de fora é recusada', r.status === 403);
r = await call('/api/avaliacoes', { token: tEdi });
const a1 = r.data.avaliacoes[0];
ok('Edi: 1 avaliação pendente, com prova, total, prazo e dias úteis restantes; código P-XXXX para a marca-d\'água', r.status === 200 && r.data.pendentes === 1 && r.data.avaliacoes.length === 1 && a1.id === s1 && a1.prova.nome === '2ª série · REG · Simulado particular' && a1.total === 2 && a1.decisao === 'pendente' && a1.visto_ate === 0 && a1.dias_uteis_restantes === dias.diasUteisAte('2026-11-13', sel1.avaliacao_prazo_em, naoUteis) && a1.dias_uteis_restantes >= 3 && /^P-[A-Z2-9]{4}$/.test(r.data.codigo), JSON.stringify(a1) + ' ' + r.data.codigo);
ok('diasUteisAte: de sexta 13/11 até quarta 18/11 são 3 dias úteis; prazo já passado dá 0', dias.diasUteisAte('2026-11-13', '2026-11-18T13:00:00Z', naoUteis) === 3 && dias.diasUteisAte('2026-11-13', '2026-11-13T23:00:00Z', naoUteis) === 0 && dias.diasUteisAte('2026-11-19', '2026-11-25T13:00:00Z', naoUteis) === 3);

// ---- abrir as questões ----
r = await call('/api/avaliacoes/' + s1 + '/questao/1', { token: tEdi });
ok('Questão 1: conteúdo da versão congelada, sem autor nem tags; visualização registrada; visto_ate = 1', r.status === 200 && r.data.n === 1 && r.data.total === 2 && r.data.questao.codigo === q1 && /Álvares/.test(r.data.questao.dados.comando) && r.data.questao.dados.gabarito === 'C' && !('autor' in r.data.questao) && !('tags' in r.data.questao.dados) && r.data.visto_ate === 1 && !r.data.visto_completo_em && r.data.concordo === false && r.data.pedido === null &&
  db.prepare('SELECT COUNT(*) AS n FROM avaliacao_visualizacoes WHERE selecao_id = ? AND professor_id = ? AND item_id = ?').get(s1, uid('edi.franco@grupoideal.com.br'), itemId(q1)).n === 1, JSON.stringify(r.data).slice(0, 300));
r = await call('/api/avaliacoes/' + s1 + '/questao/3', { token: tEdi });
ok('Questão fora da seleção: 404', r.status === 404);
r = await call('/api/avaliacoes/' + s1 + '/questao/0', { token: tEdi });
ok('Questão 0: 404', r.status === 404);
r = await call('/api/avaliacoes/' + s1 + '/finalizar', { method: 'POST', token: tEdi, body: {} });
ok('Não finaliza sem passar por todas as questões', r.status === 409 && /faltam 1/.test(r.data.error), r.data.error);
r = await call('/api/avaliacoes/' + s1 + '/questao/2', { token: tEdi });
ok('Última questão aberta: visto_completo_em gravado ("viu a prova")', r.status === 200 && !!r.data.visto_completo_em && !!db.prepare('SELECT visto_completo_em FROM avaliacao_professores WHERE selecao_id = ? AND professor_id = ?').get(s1, uid('edi.franco@grupoideal.com.br')).visto_completo_em);
r = await call('/api/avaliacoes/' + s1 + '/finalizar', { method: 'POST', token: tEdi, body: {} });
ok('Não finaliza com questões sem resposta', r.status === 409 && /sem resposta/.test(r.data.error), r.data.error);

// ---- votos e pedidos ----
r = await call('/api/avaliacoes/' + s1 + '/questao/1/voto', { method: 'POST', token: tEdi, body: { voto: 'concordo' } });
ok('Concordo na questão 1', r.status === 200 && r.data.concordo === true && db.prepare('SELECT COUNT(*) AS n FROM avaliacao_votos WHERE selecao_id = ? AND item_id = ?').get(s1, itemId(q1)).n === 1, JSON.stringify(r.data));
r = await call('/api/avaliacoes/' + s1 + '/questao/1/voto', { method: 'POST', token: tEdi, body: { voto: 'discordo' } });
ok('Voto inválido recusado', r.status === 400);
r = await call('/api/avaliacoes/' + s1 + '/questao/2/pedido', { method: 'POST', token: tEdi, body: { tipo: 'outro', texto: 'Está difícil demais' } });
ok('Pedido só com os dois tipos (trocar / corrigir)', r.status === 400 && /trocar/.test(r.data.error), r.data.error);
r = await call('/api/avaliacoes/' + s1 + '/questao/2/pedido', { method: 'POST', token: tEdi, body: { tipo: 'corrigir', texto: 'ok' } });
ok('Pedido precisa de explicação', r.status === 400);
r = await call('/api/avaliacoes/' + s1 + '/questao/2/pedido', { method: 'POST', token: tEdi, body: { tipo: 'corrigir', texto: 'O gabarito está A, mas a alternativa C também pode ser defendida.' } });
const ped = db.prepare('SELECT * FROM avaliacao_pedidos WHERE selecao_id = ? AND item_id = ?').get(s1, itemId(q2));
ok('Pedido "Corrigir texto ou gabarito" gravado: aberto, rodada 1, prazo de 24 h, mensagem do professor', r.status === 200 && r.data.pedido.tipo === 'corrigir' && r.data.pedido.tipo_nome === 'Corrigir texto ou gabarito' && ped && ped.estado === 'aberto' && ped.rodada === 1 && Math.round((Date.parse(ped.prazo_em) - Date.parse(ped.criado_em)) / 3600000) === 24 &&
  db.prepare("SELECT COUNT(*) AS n FROM avaliacao_mensagens WHERE pedido_id = ? AND autor = 'professor' AND tipo = 'pedido'").get(ped.id).n === 1, JSON.stringify(ped));
r = await call('/api/avaliacoes/' + s1, { token: tEdi });
ok('Resumo da avaliação: questão 1 concordo, questão 2 com pedido', r.data.questoes[0].concordo === true && r.data.questoes[1].pedido?.tipo === 'corrigir' && r.data.questoes[1].concordo === false, JSON.stringify(r.data.questoes));
r = await call('/api/avaliacoes/' + s1 + '/questao/2/voto', { method: 'POST', token: tEdi, body: { voto: 'concordo' } });
ok('Concordar depois do pedido apaga o pedido em aberto (e a mensagem)', r.status === 200 && db.prepare('SELECT COUNT(*) AS n FROM avaliacao_pedidos WHERE selecao_id = ?').get(s1).n === 0 && db.prepare('SELECT COUNT(*) AS n FROM avaliacao_mensagens').get().n === 0);
r = await call('/api/avaliacoes/' + s1 + '/questao/2/pedido', { method: 'POST', token: tEdi, body: { tipo: 'trocar', texto: 'Esta questão já caiu na prova passada.' } });
ok('Pedir mudança depois de concordar apaga o voto', r.status === 200 && db.prepare('SELECT COUNT(*) AS n FROM avaliacao_votos WHERE selecao_id = ? AND item_id = ?').get(s1, itemId(q2)).n === 0 && db.prepare('SELECT tipo FROM avaliacao_pedidos WHERE selecao_id = ?').get(s1).tipo === 'trocar');
r = await call('/api/avaliacoes/' + s1 + '/questao/2/voto', { method: 'POST', token: tEdi, body: { voto: 'concordo' } });
r = await call('/api/avaliacoes/' + s1 + '/finalizar', { method: 'POST', token: tEdi, body: {} });
ok('Edi finaliza: aprovou; seleção segue em avaliação (falta a Telma)', r.status === 200 && r.data.decisao === 'aprovou' && r.data.fase === 'avaliacao' && db.prepare('SELECT decisao FROM avaliacao_professores WHERE selecao_id = ? AND professor_id = ?').get(s1, uid('edi.franco@grupoideal.com.br')).decisao === 'aprovou', JSON.stringify(r.data));
r = await call('/api/avaliacoes/' + s1 + '/questao/1/voto', { method: 'POST', token: tEdi, body: { voto: 'concordo' } });
ok('Depois de finalizar, não muda mais o voto', r.status === 409 && /já finalizou/.test(r.data.error), r.data.error);
r = await call('/api/avaliacoes/' + s1 + '/questao/1', { token: tEdi });
ok('Depois de finalizar ainda pode rever a questão', r.status === 200 && r.data.concordo === true);
r = await call('/api/avaliacoes', { token: tEdi });
ok('Lista de Edi: "Você aprovou", sem pendentes', r.data.pendentes === 0 && r.data.avaliacoes[0].decisao === 'aprovou' && !!r.data.avaliacoes[0].decidido_em);

// ---- Telma aprova tudo: liberada, supervisor avisado ----
n0 = mails.length;
await call('/api/avaliacoes/' + s1 + '/questao/1', { token: tTelma }); await call('/api/avaliacoes/' + s1 + '/questao/2', { token: tTelma });
await call('/api/avaliacoes/' + s1 + '/questao/1/voto', { method: 'POST', token: tTelma, body: { voto: 'concordo' } });
await call('/api/avaliacoes/' + s1 + '/questao/2/voto', { method: 'POST', token: tTelma, body: { voto: 'concordo' } });
r = await call('/api/avaliacoes/' + s1 + '/finalizar', { method: 'POST', token: tTelma, body: {} }); await espera();
const sel1b = db.prepare('SELECT * FROM selecoes WHERE id = ?').get(s1);
ok('Todos aprovaram: fase "liberada", liberada_em gravado, situação ainda rascunho', r.status === 200 && r.data.fase === 'liberada' && sel1b.fase === 'liberada' && !!sel1b.liberada_em && sel1b.situacao === 'rascunho', JSON.stringify(r.data));
ok('Supervisor avisado por e-mail: pode enviar ao Diagramador', mails.slice(n0).some(m => m.email === 'marcio.alex@grupoideal.com.br' && /pode enviar ao Diagramador/.test(m.assunto) && m.texto.includes('supervisor-selecoes.html?id=' + s1)), mails.slice(n0).map(m => m.email + ':' + m.assunto).join(' | '));
r = await call('/api/supervisor/selecoes/' + s1, { token: tMarcio });
ok('GET do supervisor: liberada, 2 aprovaram, 2 viram a prova inteira', r.data.selecao.avaliacao.fase === 'liberada' && r.data.selecao.avaliacao.aprovaram === 2 && r.data.selecao.avaliacao.viram === 2 && r.data.selecao.avaliacao.pedidos_abertos === 0, JSON.stringify(r.data.selecao.avaliacao));
r = await call('/api/supervisor/selecoes/' + s1, { method: 'PUT', token: tMarcio, body: { itens: [q1, q3] } });
ok('Liberada: ainda não edita (manda para o diagramador)', r.status === 409 && /Enviar para o diagramador/.test(r.data.error), r.data.error);
r = await call('/api/supervisor/selecoes/' + s1 + '/enviar', { method: 'POST', token: tMarcio, body: {} }); await espera();
ok('Botão verde: seleção enviada e prova fechada (única disciplina)', r.status === 200 && r.data.selecao.situacao === 'enviada' && r.data.prova_fechada === true && db.prepare('SELECT situacao FROM selecoes WHERE id = ?').get(s1).situacao === 'enviada' && ['fechada', 'enviada'].includes(db.prepare('SELECT situacao FROM provas WHERE id = ?').get(P1).situacao), JSON.stringify(r.data));
r = await call('/api/avaliacoes/' + s1 + '/questao/2', { token: tEdi });
ok('Depois do envio o professor ainda revê a prova', r.status === 200);

// ---- ADM devolve: a avaliação é zerada; finalizar de novo reabre ----
r = await call('/api/adm/selecoes/' + s1 + '/devolver', { method: 'POST', token: tAdm, body: { motivo: 'Troque a questão 2' } });
const sel1c = db.prepare('SELECT * FROM selecoes WHERE id = ?').get(s1);
ok('Devolvida pelo ADM: rascunho sem fase', r.status === 200 && sel1c.situacao === 'rascunho' && sel1c.fase === null && sel1c.liberada_em === null, JSON.stringify(r.data));
await call('/api/supervisor/selecoes/' + s1, { method: 'PUT', token: tMarcio, body: { itens: [q1, q3] } });
n0 = mails.length;
r = await call('/api/supervisor/selecoes/' + s1 + '/enviar', { method: 'POST', token: tMarcio, body: {} }); await espera();
ok('Finalizar de novo: avaliação reaberta do zero (votos e decisões apagados, novos avisos)', r.status === 200 && r.data.selecao.fase === 'avaliacao' && db.prepare("SELECT COUNT(*) AS n FROM avaliacao_professores WHERE selecao_id = ? AND decisao = 'pendente'").get(s1).n === 2 && db.prepare('SELECT COUNT(*) AS n FROM avaliacao_votos WHERE selecao_id = ?').get(s1).n === 0 && mails.slice(n0).filter(m => /aguardando a sua aprovação/.test(m.assunto)).length === 2, JSON.stringify(r.data));

// ---- sem professor para avaliar: vai direto ----
const sQ = await selecao(PQ, [qQ], tSupQ);
n0 = mails.length;
r = await call('/api/supervisor/selecoes/' + sQ + '/enviar', { method: 'POST', token: tSupQ, body: {} }); await espera();
const selQ = db.prepare('SELECT * FROM selecoes WHERE id = ?').get(sQ);
ok('Sem professor da série: seleção nasce liberada e segue direto (enviada), sem avisos a professores', r.status === 200 && r.data.selecao.situacao === 'enviada' && selQ.fase === 'liberada' && !!selQ.liberada_em && !mails.slice(n0).some(m => /aguardando a sua aprovação/.test(m.assunto)), JSON.stringify(r.data));

// ---- P2 (tela) e P3 (liberada) ----
const s2 = await selecao(P2, [q2, q4]);
await call('/api/supervisor/selecoes/' + s2 + '/enviar', { method: 'POST', token: tMarcio, body: {} }); await espera();
const s3 = await selecao(P3, [q3]);
await call('/api/supervisor/selecoes/' + s3 + '/enviar', { method: 'POST', token: tMarcio, body: {} }); await espera();
for (const t of [tEdi, tTelma]) { await call('/api/avaliacoes/' + s3 + '/questao/1', { token: t }); await call('/api/avaliacoes/' + s3 + '/questao/1/voto', { method: 'POST', token: t, body: { voto: 'concordo' } }); await call('/api/avaliacoes/' + s3 + '/finalizar', { method: 'POST', token: t, body: {} }); }
ok('Seleção da MIL liberada pelos dois professores', db.prepare('SELECT fase FROM selecoes WHERE id = ?').get(s3).fase === 'liberada');
r = await call('/api/avaliacoes', { token: tEdi });
ok('Lista de Edi ordena as pendentes primeiro (P1 reaberta e P2)', r.data.pendentes === 2 && r.data.avaliacoes.slice(0, 2).every(a => a.decisao === 'pendente') && r.data.avaliacoes.length === 3, r.data.avaliacoes.map(a => a.id + ':' + a.decisao).join());

// ===== telas =====
const PORTA = 8797;
const server = http.createServer(async (req, res) => { const chunks = []; for await (const c of req) chunks.push(c); const request = new Request('https://atlas-api.test' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks) }); const response = await worker.fetch(request, env); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); }).listen(PORTA);
const K = S + 'katexpkg/package/dist/';
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.route('https://idealolimpico.com.br/atlas/**', route => { const f = new URL(route.request().url()).pathname.replace('/atlas/', '') || 'index.html'; const p = REPO + 'atlas/' + f; if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: 'nf' }); route.fulfill({ status: 200, contentType: f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'application/javascript' : f.endsWith('.json') ? 'application/json' : f.endsWith('.css') ? 'text/css' : 'image/png', body: fs.readFileSync(p) }); });
await ctx.route('https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/**', r2 => { const p = new URL(r2.request().url()).pathname.replace('/npm/katex@0.19.1/dist/', ''); r2.fulfill({ status: 200, headers: { 'content-type': p.endsWith('.js') ? 'application/javascript' : p.endsWith('.css') ? 'text/css' : 'font/' + p.split('.').pop(), 'access-control-allow-origin': '*' }, body: fs.readFileSync(K + p) }); });
await ctx.route('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', r2 => r2.fulfill({ status: 200, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(S + 'h2c/package/dist/html2canvas.min.js') }));
await ctx.route('https://atlas-api.marinhomalcher.workers.dev/**', async route => { const u = route.request().url().replace('https://atlas-api.marinhomalcher.workers.dev', 'http://localhost:' + PORTA); const resp = await route.fetch({ url: u, headers: { ...route.request().headers(), origin: ORIGIN } }); route.fulfill({ response: resp }); });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
async function login(card, user) { db.exec('DELETE FROM login_rate_limits'); await page.goto('https://idealolimpico.com.br/atlas/'); await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('atlas_user_auth'); }); await page.goto('https://idealolimpico.com.br/atlas/'); await page.click(`[data-role="${card}"]`); await page.fill('#email', user); await page.click('#loginButton'); await page.waitForSelector('#code-step:not([hidden])'); await page.fill('#code', lastCode()); await page.click('#verifyButton'); }
// --- professor: menu com contador e lista ---
await login('Professor', 'edi.franco'); await page.waitForURL(/professor\.html/);
await page.waitForFunction(() => !document.querySelector('#aval-badge').hidden);
ok('Tela Inserir questão: menu "Avaliar provas" com o contador 2', (await page.textContent('#aval-badge')) === '2' && (await page.textContent('#aba-avaliar')).includes('Avaliar provas'));
await page.click('#aba-avaliar'); await page.waitForSelector('.cartao');
let txt = await page.textContent('#lista');
ok('Tela Avaliar provas: cartões com "Aguardando você", dias úteis e "Avaliar agora"; a MIL aparece como aprovada', txt.includes('2ª série · MED · Simulado particular') && txt.includes('Aguardando você') && /Falta(m)? \d+ dias? úteis|Hoje é o último dia/.test(txt) && txt.includes('Avaliar agora') && txt.includes('Você aprovou') && txt.includes('2 questões de Literatura'), txt.slice(0, 300));
await page.screenshot({ path: S + 'aval-p-lista.png', fullPage: true });
// --- visualizador em imagem ---
const cartaoMed = page.locator('.cartao', { hasText: '2ª série · MED' });
await cartaoMed.locator('button').click();
await page.waitForSelector('#quadro canvas', { timeout: 30000 });
const info = await page.evaluate(() => { const c = document.querySelector('#quadro canvas'); const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height).data; let escuros = 0, rosados = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) escuros++; if (d[i] > 180 && d[i] > d[i + 1] + 10 && d[i] > d[i + 2] + 8) rosados++; } const cs = getComputedStyle(c); return { w: c.width, h: c.height, cssW: Math.round(parseFloat(cs.width)), quadroW: Math.round(document.querySelector('#quadro').clientWidth), escuros, rosados, forno: document.querySelector('#forno').children.length, texto: document.body.innerText, qn: document.querySelector('#v-qn').textContent, sel: getComputedStyle(document.querySelector('#ver-view')).userSelect }; });
ok('Visualizador: a questão vira imagem (canvas com texto escuro e marca-d\'água rosada), ajustada ao quadro; a montagem some; sem texto selecionável', info.w > 800 && info.h > 300 && info.escuros > 2000 && info.rosados > 5000 && info.cssW <= info.quadroW && info.forno === 0 && info.sel === 'none', JSON.stringify({ ...info, texto: undefined }));
ok('O texto da questão não fica na página (nem no HTML visível)', !info.texto.includes(TEXTO_SECRETO) && !(await page.content()).includes(TEXTO_SECRETO), info.texto.slice(0, 100));
ok('Cabeçalho: "Questão 1 de 2", prova e prazo; botão anterior desligado', info.qn === 'Questão 1 de 2' && (await page.textContent('#v-titulo')).includes('2ª série · MED') && await page.isDisabled('#ant') && (await page.textContent('#v-prazo')).includes('Aguardando você'));
await page.screenshot({ path: S + 'aval-p-ver.png', fullPage: true });
ok('Visualização registrada no banco ao abrir pela tela', db.prepare('SELECT COUNT(*) AS n FROM avaliacao_visualizacoes WHERE selecao_id = ? AND professor_id = ?').get(s2, uid('edi.franco@grupoideal.com.br')).n >= 1);
// Concordo avança para a próxima; pedido de mudança na 2
await page.click('#b-concordo'); await page.waitForFunction(() => document.querySelector('#v-qn').textContent === 'Questão 2 de 2'); await page.waitForSelector('#quadro canvas', { timeout: 30000 });
ok('Concordo grava o voto e avança para a questão 2 (bolinha verde)', db.prepare('SELECT COUNT(*) AS n FROM avaliacao_votos WHERE selecao_id = ? AND item_id = ?').get(s2, itemId(q2)).n === 1 && (await page.$$('#dots button.ok')).length === 1);
await page.click('#b-pedir'); await page.click('.tipos button[data-tipo="corrigir"]'); await page.fill('#pedido-texto', 'A fórmula está sem o expoente certo.'); await page.click('#b-enviar-pedido');
await page.waitForSelector('#pedido-atual:not([hidden])');
ok('Pedido de mudança pela tela: gravado e mostrado ao professor', (await page.textContent('#pedido-atual')).includes('Corrigir texto ou gabarito') && db.prepare('SELECT tipo FROM avaliacao_pedidos WHERE selecao_id = ? AND item_id = ?').get(s2, itemId(q4)).tipo === 'corrigir');
txt = await page.textContent('#resumo-aval');
ok('Sua avaliação: 1 concordo · 1 pedido · 0 por ver; botão Finalizar liberado', txt.includes('1 concordo · 1 pedido de mudança · 0 por ver') && !(await page.isDisabled('#b-finalizar')), txt);
await page.click('#b-finalizar'); await page.waitForSelector('#msg-final:not([hidden])');
ok('Finalizar pela tela: pediu mudança (fica com o supervisor)', (await page.textContent('#msg-final')).includes('pediu mudança') && db.prepare('SELECT decisao FROM avaliacao_professores WHERE selecao_id = ? AND professor_id = ?').get(s2, uid('edi.franco@grupoideal.com.br')).decisao === 'pediu_mudanca' && await page.isDisabled('#b-concordo'));
await page.keyboard.press('ArrowLeft'); await page.waitForFunction(() => document.querySelector('#v-qn').textContent === 'Questão 1 de 2');
ok('Setas do teclado voltam para a questão 1', true);
await page.click('#v-voltar'); await page.waitForFunction(() => document.querySelector('#lista').textContent.includes('Pedido enviado'));
ok('Voltar à lista: a MED aparece como "Pedido enviado", aguardando o supervisor', (await page.textContent('#lista')).includes('aguardando o supervisor'));
// --- supervisor: fase na lista e botão verde ---
await login('Supervisor', 'marcio.alex'); await page.waitForURL(/supervisor\.html/);
await page.goto('https://idealolimpico.com.br/atlas/supervisor-selecoes.html'); await page.waitForSelector('#lista table');
txt = await page.textContent('#lista');
ok('Tela Sup: lista mostra "Em avaliação pelos professores", "Aprovada pelos professores" e o botão "Enviar ao diagramador"', txt.includes('Em avaliação pelos professores') && txt.includes('Aprovada pelos professores') && txt.includes('Enviar ao diagramador'), txt.slice(0, 300));
await page.goto('https://idealolimpico.com.br/atlas/supervisor-selecoes.html?id=' + s2); await page.waitForSelector('#avaliacao-box:not([hidden])');
txt = await page.textContent('#avaliacao-box');
ok('Tela Sup (em avaliação): quadro com 2 professores, 1 pediu mudança, 1 pedido em aberto, sem botão verde; editor fechado', txt.includes('Em avaliação pelos professores') && txt.includes('1 pediram mudança') && txt.includes('1 pedido(s) em aberto') && !(await page.$('#enviar-diagramador')) && await page.isHidden('#editor-bloco'), txt);
await page.goto('https://idealolimpico.com.br/atlas/supervisor-selecoes.html?id=' + s3); await page.waitForSelector('#enviar-diagramador');
await page.screenshot({ path: S + 'aval-s-liberada.png', fullPage: true });
await page.click('#enviar-diagramador'); await page.waitForSelector('#aval-nota');
ok('Botão verde pede confirmação no segundo clique', (await page.textContent('#enviar-diagramador')).includes('Confirmar'));
await page.click('#enviar-diagramador'); await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('enviada'));
ok('Tela Sup: botão verde envia a seleção (situação enviada)', db.prepare('SELECT situacao FROM selecoes WHERE id = ?').get(s3).situacao === 'enviada');
// --- ADM: Avaliações mostra a fase ---
await page.addInitScript(t => { try { sessionStorage.setItem('atlas_adm_token', t); } catch {} }, tAdm);
await page.goto('https://idealolimpico.com.br/atlas/admin-avaliacoes.html'); await page.waitForSelector('.prova');
txt = await page.textContent('#lista');
ok('Tela ADM Avaliações: disciplina "Em avaliação pelos professores" com o prazo', txt.includes('Em avaliação pelos professores') && txt.includes('prazo '), txt.slice(0, 200));
await browser.close(); server.close();
ok('Telas: sem erros de JavaScript nem caixas do navegador', errors.length === 0 && dialogs.length === 0, errors.join(' ; ') + dialogs.join(';'));
for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK  ').length; console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`); process.exit(0);
