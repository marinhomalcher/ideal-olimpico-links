// Encerramento automático do ano da Redação (política de privacidade de 18/11/2026): na madrugada
// de 31/12 a rotina agendada apaga os dados do ano, mantém os cadastros permanentes, faz cópia nova,
// apaga as cópias anteriores, registra o evento e manda o relatório ao ADM. Dados fictícios; R2 falso.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const worker = (await import('../worker.js')).default;
const { contagens } = await import('../redacao-encerrar.js');
const { r2Rigoroso } = await import('./r2-cloudflare.mjs');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(fs.readFileSync(repo + '_cloudflare/atlas-api/schema.sql', 'utf8'));
const results = [];
function ok(name, cond, extra = '') { results.push([cond ? 'OK' : 'FALHOU', name, String(extra)]); }
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }) };
}
const objetos = new Map();
const env = {
  DB: { prepare: sql => stmt(sql), batch: async ops => Promise.all(ops.map(x => x.run())) },
  ADMIN_EMAIL: 'adm@example.com', ATLAS_HOJE_TESTE: '2026-11-18',
  ATLAS_MAILER_URL: 'https://mailer.test/exec', ATLAS_MAILER_SECRET: 'segredo-de-teste',
  IMAGENS: r2Rigoroso(objetos),
  MS_TENANT_ID: 'tenant-teste', MS_CLIENT_ID: 'cliente-teste', MS_CLIENT_SECRET: 'segredo-ms-teste', SHAREPOINT_SITE: 'site-teste'
};
const graph = [];
/* e-mails capturados (mailer de reserva; nenhum e-mail real sai) */
const mails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url) === 'https://mailer.test/exec') { mails.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }); }
  if (String(url).startsWith('https://login.microsoftonline.com/')) return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3599 }));
  if (String(url).startsWith('https://graph.microsoft.com/')) { graph.push((opts?.method || 'GET') + ' ' + String(url)); return new Response(null, { status: 204 }); }
  return realFetch(url, opts);
};
function sessao(token, tipo, email, id = null) {
  db.prepare('INSERT INTO sessoes (token_hash, tipo, email, usuario_id, expira_em) VALUES (?, ?, ?, ?, ?)')
    .run(createHash('sha256').update(token).digest('hex'), tipo, email, id, '2099-01-01T00:00:00Z');
}
sessao('adm-token', 'adm', 'adm@example.com');
const origin = 'https://idealolimpico.com.br';
async function api(path, method = 'GET', body, token = 'adm-token') {
  const r = await worker.fetch(new Request('https://atlas-api.example' + path, { method, headers: { Origin: origin, Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: r.status, data: await r.json() };
}
async function madrugada() { const ctx = { p: [], waitUntil(x) { this.p.push(x); } }; await worker.scheduled({ cron: '17 6 * * *' }, env, ctx); await Promise.all(ctx.p); }
const conta = (sql, ...a) => db.prepare(sql).get(...a).n;

ok('Schema 20', db.prepare("SELECT valor FROM meta WHERE chave='schema_versao'").get().valor === '20');

/* ---------- dados fictícios do ano 2026 ---------- */
let r = await api('/api/adm/redacao/turmas');
const turmas = r.data.turmas;
const bc = turmas.find(t => t.unidade === 'BC' && t.codigo === '1EMA');
const cn = turmas.find(t => t.unidade === 'CN' && t.codigo === '1EMA');
ok('15 turmas de 2026 no começo', turmas.length === 15 && !!bc && !!cn);
r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Professora Fictícia', email: 'prof@grupoideal.com.br', funcao: 'professor', turmas: [bc.id] });
const profId = r.data.equipe.find(x => x.email === 'prof@grupoideal.com.br')?.id;
r = await api('/api/adm/redacao/equipe', 'POST', { nome: 'Digitalizador Fictício', email: 'dig@grupoideal.com.br', funcao: 'digitalizador', unidades: ['BC', 'CN'] });
const digId = r.data.equipe.find(x => x.email === 'dig@grupoideal.com.br')?.id;
ok('Professora e digitalizador cadastrados', !!profId && !!digId, r.data.error);
sessao('prof-token', 'usuario', 'prof@grupoideal.com.br', profId);
db.prepare("INSERT INTO usuarios (nome, email, papel, ativo) VALUES ('Coordenadora Fictícia', 'coord@grupoideal.com.br', 'professor', 1)").run();
const coordId = db.prepare("SELECT id FROM usuarios WHERE email = 'coord@grupoideal.com.br'").get().id;
db.prepare("INSERT INTO coordenadores (usuario_id, unidade, segmento, serie) VALUES (?, 'BC', 'EM', '1ª Série')").run(coordId);
const alunos = [];
for (let i = 0; i < 40; i++) alunos.push({ ra: String(10000 + i), nome: 'Aluno Fictício ' + i, unidade: i < 20 ? 'BC' : 'CN', segmento: 'EM', serie: '1ª Série', codigo: '1EMA' });
r = await api('/api/adm/redacao/alunos/importar', 'POST', { ano: 2026, alunos });
ok('40 alunos fictícios importados', r.status === 200 && conta('SELECT COUNT(*) AS n FROM redacao_alunos WHERE ano = 2026') === 40, r.data.error);
/* lotes, folhas, correções e envios direto no banco (muitas folhas, para forçar o apagamento em lotes) */
const ins = db.prepare('INSERT INTO redacao_lotes (ano, bimestre, turma_id, digitalizador_id, r2_key, nome_arquivo, bytes, enviado_em, cancelavel_ate, paginas_arquivo) VALUES (2026, ?, ?, ?, ?, ?, 1000, ?, ?, ?)');
const insPag = db.prepare("INSERT INTO redacao_paginas (lote_id, pagina, ra_lido, situacao, aluno_ra, envio_id) VALUES (?, ?, ?, 'aluno', ?, ?)");
const insCor = db.prepare("INSERT INTO redacao_correcoes (lote_id, pagina, aluno_ra, professor_id, c1, c2, c3, c4, c5, total, observacao, marcacoes, enviada_em) VALUES (?, ?, ?, ?, 120, 120, 120, 120, 120, 600, 'obs', '[]', '2026-05-02T12:00:00Z')");
const insEnv = db.prepare("INSERT INTO redacao_envios (id, ano, bimestre, unidade, digitalizador_id, criado_em) VALUES (?, 2026, ?, ?, ?, '2026-05-01T12:00:00Z')");
let pdfs = 0;
for (let b = 1; b <= 4; b++) {
  for (const t of [bc, cn]) {
    const envio = 'env-' + b + '-' + t.id;
    insEnv.run(envio, b, t.unidade, digId);
    const chave = `redacao/2026/b${b}/turma-${t.id}/${crypto.randomUUID()}.pdf`;
    const lote = Number(ins.run(b, t.id, digId, chave, 'turma.pdf', '2026-05-01T12:00:00Z', '2026-05-01T14:00:00Z', 200).lastInsertRowid);
    await env.IMAGENS.put(chave, Buffer.from('%PDF-1.4 ficticio ' + chave)); pdfs++;
    for (let p = 1; p <= 200; p++) {
      const ra = String(10000 + (t === bc ? 0 : 20) + (p % 20));
      insPag.run(lote, p, ra, ra, envio);
      if (t === bc) insCor.run(lote, p, ra, profId);
    }
  }
}
/* objetos "soltos" no R2 do ano, para o prefixo ser varrido inteiro (mais de uma página de 500) */
for (let i = 0; i < 700; i++) { await env.IMAGENS.put('redacao/2026/b1/turma-' + bc.id + '/solto-' + i + '.pdf', Buffer.from('x')); pdfs++; }
/* um PDF de outro ano e uma imagem do BQI, que precisam sobreviver */
await env.IMAGENS.put('redacao/2027/b1/turma-1/futuro.pdf', Buffer.from('%PDF futuro'));
await env.IMAGENS.put('img/questao-1.png', Buffer.from('png'));
/* três cópias de segurança antigas, com dados de redação dentro */
for (const d of ['2026-10-01', '2026-11-01', '2026-12-01']) await env.IMAGENS.put('backups/atlas-' + d + 'T03-17-00Z.json', Buffer.from(JSON.stringify({ atlas_backup: 1, tabelas: { redacao_correcoes: [{ aluno_ra: '10001' }] } })));
/* registros de redação do ano, com RA, e um de outro ano */
db.prepare("INSERT INTO eventos (acao, detalhe, criado_em) VALUES ('redacao_pagina_resolvida', '{\"ra\":\"10001\"}', '2026-06-01T10:00:00Z')").run();
db.prepare("INSERT INTO eventos (acao, detalhe, criado_em) VALUES ('redacao_lote_enviado', '{\"lote_id\":1}', '2026-06-02T10:00:00Z')").run();
db.prepare("INSERT INTO eventos (acao, detalhe, criado_em) VALUES ('redacao_lote_enviado', '{\"lote_id\":9}', '2025-06-02T10:00:00Z')").run();
db.prepare("INSERT INTO eventos (acao, detalhe, criado_em) VALUES ('adm_login', '{}', '2026-06-02T10:00:00Z')").run();
/* Meu desempenho: 3 documentos de 2026 */
for (const [p, ra] of [['PART', '10001'], ['ENEM1', '10001'], ['ESPELHO', '10002']]) db.prepare("INSERT INTO desempenho_documentos (ano, bimestre, prova, ra, paginas, enviado_em, enviado_por) VALUES (2026, 1, ?, ?, 2, '2026-05-01T12:00:00Z', 'adm')").run(p, ra);
const antes = {
  usuarios: conta('SELECT COUNT(*) AS n FROM usuarios'), equipe: conta('SELECT COUNT(*) AS n FROM redacao_equipe'),
  unidades: conta('SELECT COUNT(*) AS n FROM redacao_digitalizador_unidades'), coordenadores: conta('SELECT COUNT(*) AS n FROM coordenadores'),
  paginas: conta('SELECT COUNT(*) AS n FROM redacao_paginas'), correcoes: conta('SELECT COUNT(*) AS n FROM redacao_correcoes')
};
ok('Massa fictícia: 8 lotes, 1.600 folhas, 800 correções, 8 envios', conta('SELECT COUNT(*) AS n FROM redacao_lotes') === 8 && antes.paginas === 1600 && antes.correcoes === 800 && conta('SELECT COUNT(*) AS n FROM redacao_envios') === 8);
const c0 = await contagens(env, 2026);
ok('Contagem do que há de 2026', c0.pdfs === pdfs && c0.paginas === 1600 && c0.correcoes === 800 && c0.lotes === 8 && c0.envios === 8 && c0.alunos === 40 && c0.turmas === 15 && c0.vinculos === 1 && c0.importacoes === 1 && c0.eventos >= 2, JSON.stringify(c0));

/* ---------- em qualquer outro dia, a madrugada não apaga nada ---------- */
for (const dia of ['2026-11-18', '2026-12-30', '2026-12-15']) {
  env.ATLAS_HOJE_TESTE = dia;
  await madrugada();
}
ok('Madrugadas de 18/11, 15/12 e 30/12 não apagam nada da Redação', conta('SELECT COUNT(*) AS n FROM redacao_paginas') === 1600 && conta('SELECT COUNT(*) AS n FROM redacao_alunos') === 40 && [...objetos.keys()].filter(k => k.startsWith('redacao/2026/')).length === pdfs && mails.length === 0 && conta("SELECT COUNT(*) AS n FROM eventos WHERE acao = 'redacao_ano_encerrado'") === 0);
ok('Nenhuma rota manual de encerramento no servidor', (await api('/api/adm/redacao/encerrar-ano', 'POST', { ano: 2026, confirmacao: '2026' })).status === 404 && conta('SELECT COUNT(*) AS n FROM redacao_paginas') === 1600);
ok('Sem aba "Encerrar ano" na tela do ADM', !/encerrar-ano|Encerrar ano/.test(fs.readFileSync(repo + 'atlas/redacao-admin.html', 'utf8')));

/* ---------- 31/12: a madrugada encerra o ano ---------- */
env.ATLAS_HOJE_TESTE = '2026-12-31';
await madrugada();

ok('D1: correções, folhas, lotes e envios de 2026 apagados', conta('SELECT COUNT(*) AS n FROM redacao_correcoes') === 0 && conta('SELECT COUNT(*) AS n FROM redacao_paginas') === 0 && conta('SELECT COUNT(*) AS n FROM redacao_lotes') === 0 && conta('SELECT COUNT(*) AS n FROM redacao_envios') === 0);
ok('D1: alunos, turmas, vínculos e importações de 2026 apagados', conta('SELECT COUNT(*) AS n FROM redacao_alunos') === 0 && conta('SELECT COUNT(*) AS n FROM redacao_turmas WHERE ano = 2026') === 0 && conta('SELECT COUNT(*) AS n FROM redacao_professor_turmas') === 0 && conta('SELECT COUNT(*) AS n FROM redacao_importacoes') === 0);
ok('D1: registros de redação de 2026 apagados; o de 2025 e os demais ficam', conta("SELECT COUNT(*) AS n FROM eventos WHERE acao LIKE 'redacao_%' AND acao <> 'redacao_ano_encerrado' AND criado_em >= '2026-' AND criado_em < '2027-'") === 0 && conta("SELECT COUNT(*) AS n FROM eventos WHERE acao = 'redacao_lote_enviado' AND criado_em LIKE '2025-%'") === 1 && conta("SELECT COUNT(*) AS n FROM eventos WHERE acao = 'adm_login'") === 1);
ok('R2: nenhum PDF de redacao/2026/ sobrou', [...objetos.keys()].every(k => !k.startsWith('redacao/2026/')));
ok('R2: PDF de 2027 e imagem do BQI continuam', objetos.has('redacao/2027/b1/turma-1/futuro.pdf') && objetos.has('img/questao-1.png'));
const copias = [...objetos.keys()].filter(k => k.startsWith('backups/'));
const copiaNova = copias.length === 1 ? JSON.parse(objetos.get(copias[0]).toString()) : null;
ok('R2: só a cópia de segurança nova ficou, já sem dados de redação', copias.length === 1 && copiaNova?.origem === 'encerramento-redacao-2026' && copiaNova.tabelas.redacao_correcoes.length === 0 && copiaNova.tabelas.redacao_alunos.length === 0 && copiaNova.tabelas.usuarios.length === antes.usuarios, copias.join(','));
const evento = db.prepare("SELECT detalhe FROM eventos WHERE acao = 'redacao_ano_encerrado'").all();
const det = evento.length === 1 ? JSON.parse(evento[0].detalhe) : null;
/* as 3 antigas saem; a cópia diária daquela madrugada também, quando não cai no mesmo segundo (mesmo nome) da nova */
ok('Evento "redacao_ano_encerrado" registra o relatório completo', det && det.ano === 2026 && det.data === '2026-12-31' && det.apagados.paginas === 1600 && det.apagados.correcoes === 800 && det.apagados.lotes === 8 && det.apagados.pdfs === pdfs && det.apagados.alunos === 40 && det.apagados.turmas === 15 && det.apagados.vinculos === 1 && det.apagados.eventos >= 2 && det.copias_removidas >= 3 && det.copia, JSON.stringify(det));
const mail = mails.find(m => /Redação encerrado/.test(m.assunto));
ok('ADM recebe o relatório por e-mail', mail && mail.email === 'adm@example.com' && /ano 2026 da Redação em 31\/12\/2026/.test(mail.texto) && /folhas: 1\.600/.test(mail.texto) && /correções \(notas\): 800/.test(mail.texto) && /PDFs no armazenamento: 708/.test(mail.texto) && /Cópias anteriores apagadas: [34]/.test(mail.texto) && /continuam cadastrados/.test(mail.texto), JSON.stringify(mail));

/* ---------- o que precisa ter ficado ---------- */
ok('Cadastros permanentes intactos: usuários, equipe, unidades dos digitalizadores e coordenadores', conta('SELECT COUNT(*) AS n FROM usuarios') === antes.usuarios && conta('SELECT COUNT(*) AS n FROM redacao_equipe') === antes.equipe && conta('SELECT COUNT(*) AS n FROM redacao_digitalizador_unidades') === antes.unidades && conta('SELECT COUNT(*) AS n FROM coordenadores') === antes.coordenadores);
r = await api('/api/adm/redacao/equipe');
ok('Professora continua cadastrada, agora sem turma', r.status === 200 && r.data.equipe.some(x => x.id === profId && x.funcao === 'professor' && x.turmas.length === 0), JSON.stringify(r.data.equipe));
r = await api('/api/redacao/sessao', 'GET', undefined, 'prof-token');
ok('Professora ainda entra na Redação', r.status === 200 && r.data.usuario.turmas.length === 0, r.data.error);
ok('Schema continua 20', db.prepare("SELECT valor FROM meta WHERE chave='schema_versao'").get().valor === '20');

/* ---------- rodar de novo não faz nada ---------- */
const c1 = await contagens(env, 2026);
ok('Meu desempenho: documentos de 2026 apagados e a pasta 2026 do SharePoint também', conta('SELECT COUNT(*) AS n FROM desempenho_documentos') === 0 && det?.apagados.desempenho === 3 && det?.sharepoint === true && graph.some(g => g === 'DELETE https://graph.microsoft.com/v1.0/sites/site-teste/drive/root:/2026'), JSON.stringify(graph));
ok('E-mail do relatório cita os mapas e espelhos', /mapas e espelhos do Meu desempenho: 3/.test(mail?.texto || ''));
ok('Depois, não há mais nada de 2026', Object.values(c1).every(v => v === 0), JSON.stringify(c1));
const mailsAntes = mails.length, copiasAntes = [...objetos.keys()].filter(k => k.startsWith('backups/')).length;
await madrugada();
ok('Segunda madrugada de 31/12 não repete o encerramento nem manda e-mail', conta("SELECT COUNT(*) AS n FROM eventos WHERE acao = 'redacao_ano_encerrado'") === 1 && mails.length === mailsAntes && [...objetos.keys()].filter(k => k.startsWith('backups/')).length >= copiasAntes /* só a cópia diária normal */ && [...objetos.keys()].every(k => !k.startsWith('redacao/2026/')));
globalThis.fetch = realFetch;
const passed = results.filter(x => x[0] === 'OK').length;
for (const x of results) console.log(x[0].padEnd(7), x[1], x[2]);
console.log(passed === results.length ? `TODOS: ${passed} verificações passaram` : `FALHOU: ${results.length - passed} falha(s) em ${results.length} verificações`);
if (passed !== results.length) process.exitCode = 1;
