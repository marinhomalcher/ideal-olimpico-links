// "Meu desempenho" (v18): o ADM envia as páginas (JPEG) para o SharePoint, registra, libera e recolhe;
// o portal (servidor a servidor, com segredo) lista só o que está liberado e devolve links temporários
// apenas das páginas do próprio aluno. Microsoft falsa; dados fictícios.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const worker = (await import(new URL('../worker.js?' + Date.now(), import.meta.url).href)).default;
const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'OK  ' : 'FALHOU', name, String(extra).slice(0, 300)]);

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
const sql = fs.readFileSync(REPO + '_cloudflare/atlas-api/schema.sql', 'utf8');
db.exec(sql);
function stmt(q, args = []) {
  return {
    bind: (...a) => stmt(q, a),
    run: async () => { const r = db.prepare(q).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    first: async () => db.prepare(q).get(...args) ?? null,
    all: async () => ({ results: db.prepare(q).all(...args) })
  };
}
const SEGREDO = 'segredo-do-portal-com-mais-de-32-caracteres';
const env = {
  ATLAS_HOJE_TESTE: '2026-11-18', DB: { prepare: q => stmt(q), batch: async l => { for (const s of l) await s.run(); } },
  ADMIN_EMAIL: 'adm@example.com', MS_TENANT_ID: 'tenant-teste', MS_CLIENT_ID: 'cliente-teste', MS_CLIENT_SECRET: 'segredo-ms-teste',
  SHAREPOINT_SITE: 'site-teste', PORTAL_ATLAS_SECRET: SEGREDO
};
for (const [t, tipo] of [['adm-token', 'adm'], ['user-token', 'usuario']]) db.prepare('INSERT INTO sessoes (token_hash, tipo, email, usuario_id, expira_em) VALUES (?, ?, ?, ?, ?)')
  .run(createHash('sha256').update(t).digest('hex'), tipo, tipo === 'adm' ? 'adm@example.com' : 'prof@grupoideal.com.br', null, '2099-01-01T00:00:00Z');

/* SharePoint falso: guarda os arquivos por caminho */
const sp = { arquivos: new Map(), pedidos: [], semLinkNoItem: false };
const G = 'https://graph.microsoft.com/v1.0/sites/site-teste/drive/root:/';
globalThis.fetch = async (url, op = {}) => {
  const u = String(url), m = op.method || 'GET'; sp.pedidos.push(m + ' ' + u);
  if (u.startsWith('https://login.microsoftonline.com/')) return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3599 }));
  if (!u.startsWith(G)) throw new Error('fetch inesperado: ' + u);
  let rel = u.slice(G.length); const conteudo = rel.endsWith(':/content'); if (conteudo) rel = rel.slice(0, -9);
  if (m === 'PUT' && conteudo) { const novo = !sp.arquivos.has(rel); sp.arquivos.set(rel, op.body); return new Response(JSON.stringify({ id: rel }), { status: novo ? 201 : 200 }); }
  if (m === 'DELETE') { for (const k of [...sp.arquivos.keys()]) if (k === rel || k.startsWith(rel + '/')) sp.arquivos.delete(k); return new Response(null, { status: 204 }); }
  if (!sp.arquivos.has(rel)) return new Response('{}', { status: 404 });
  if (conteudo) return new Response(null, { status: 302, headers: { Location: 'https://download.test/' + rel } });
  return new Response(JSON.stringify(sp.semLinkNoItem ? { id: rel } : { id: rel, '@microsoft.graph.downloadUrl': 'https://download.test/' + rel }));
};
async function adm(path, method = 'GET', body, { token = 'adm-token', tipo } = {}) {
  const h = { Origin: 'https://idealolimpico.com.br', Authorization: 'Bearer ' + token };
  let corpo;
  if (body instanceof Uint8Array) { h['Content-Type'] = tipo || 'image/jpeg'; corpo = body; }
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; corpo = JSON.stringify(body); }
  const r = await worker.fetch(new Request('https://atlas-api.test' + path, { method, headers: h, body: corpo }), env, { waitUntil() {} });
  return { status: r.status, data: await r.json() };
}
async function portal(path, body, { segredo = SEGREDO, origin } = {}) {
  const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + segredo, ...(origin ? { Origin: origin } : {}) };
  const r = await worker.fetch(new Request('https://atlas-api.test' + path, { method: 'POST', headers: h, body: JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: r.status, data: await r.json() };
}
const jpeg = n => new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, n, 1, 2, 3]);
const conta = (q, ...a) => db.prepare(q).get(...a).n;

/* ---------- migração ---------- */
ok('Schema 19', db.prepare("SELECT valor FROM meta WHERE chave='schema_versao'").get().valor === '19');
{ const m = new DatabaseSync(':memory:');
  m.exec(sql.split('-- ---------- v18 ----------')[0]); m.exec(fs.readFileSync(REPO + '_cloudflare/atlas-api/migrations/0018_desempenho.sql', 'utf8'));
  ok('Migração 0018 cria desempenho_documentos e marca a versão 18', m.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'desempenho_documentos'").get().n === 1 && m.prepare("SELECT valor FROM meta WHERE chave = 'schema_versao'").get().valor === '18'); }
ok('Cópia de segurança inclui desempenho_documentos', /'desempenho_documentos'(, '[a-z_]+')*\]/.test(fs.readFileSync(REPO + '_cloudflare/atlas-api/worker.js', 'utf8')));

/* ---------- alunos fictícios ---------- */
const alunos = [];
for (let i = 0; i < 4; i++) alunos.push({ ra: String(20000 + i), nome: 'Aluno Fictício ' + i, unidade: 'BC', segmento: 'EM', serie: '3ª Série', codigo: '3EMA' });
let r = await adm('/api/adm/redacao/alunos/importar', 'POST', { ano: 2026, alunos });
ok('Alunos fictícios importados', r.status === 200, r.data.error);
r = await adm('/api/adm/desempenho/alunos');
ok('ADM lista os alunos com unidade e turma (para casar nomes de arquivo)', r.status === 200 && r.data.alunos.length === 4 && r.data.alunos[0].unidade === 'BC' && r.data.alunos[0].codigo === '3EMA', JSON.stringify(r.data.alunos?.[0]));

/* ---------- envio das páginas ---------- */
r = await adm('/api/adm/desempenho/imagem?bimestre=1&prova=PART&ra=20000&n=1', 'PUT', jpeg(1));
ok('Página JPEG vai para <ano>/B<bim>/<prova>/<RA>/p<n>.jpg', r.status === 200 && sp.arquivos.has('2026/B1/PART/20000/p1.jpg'), JSON.stringify(r.data));
await adm('/api/adm/desempenho/imagem?bimestre=1&prova=PART&ra=20000&n=2', 'PUT', jpeg(2));
await adm('/api/adm/desempenho/imagem?bimestre=1&prova=PART&ra=20000&n=3', 'PUT', jpeg(3));
r = await adm('/api/adm/desempenho/imagem?bimestre=1&prova=PART&ra=20000&n=1', 'PUT', new Uint8Array([0x25, 0x50, 0x44, 0x46]), { tipo: 'image/jpeg' });
ok('Recusa arquivo que não é JPEG de verdade', r.status === 415);
r = await adm('/api/adm/desempenho/imagem?bimestre=1&prova=PART&ra=20000&n=1', 'PUT', jpeg(1), { tipo: 'image/png' });
ok('Recusa outro tipo de imagem', r.status === 415);
r = await adm('/api/adm/desempenho/imagem?bimestre=1&prova=PART&ra=99999&n=1', 'PUT', jpeg(1));
ok('Recusa RA fora da lista do ano', r.status === 404 && !sp.arquivos.has('2026/B1/PART/99999/p1.jpg'));
r = await adm('/api/adm/desempenho/imagem?bimestre=5&prova=PART&ra=20000&n=1', 'PUT', jpeg(1));
const r2 = await adm('/api/adm/desempenho/imagem?bimestre=1&prova=OUTRA&ra=20000&n=1', 'PUT', jpeg(1));
const r3 = await adm('/api/adm/desempenho/imagem?bimestre=1&prova=PART&ra=../x&n=1', 'PUT', jpeg(1));
ok('Recusa bimestre, prova e RA inválidos (nada de caminho estranho)', r.status === 400 && r2.status === 400 && r3.status === 400);
r = await adm('/api/adm/desempenho/imagem?bimestre=1&prova=PART&ra=20000&n=1', 'PUT', jpeg(1), { token: 'user-token' });
ok('Só o ADM envia', r.status === 401 || r.status === 403, r.status);

r = await adm('/api/adm/desempenho/documentos', 'POST', { bimestre: 1, prova: 'PART', ra: '20000', paginas: 3 });
ok('Registra o documento (3 páginas)', r.status === 200 && !r.data.substituiu && conta('SELECT COUNT(*) AS n FROM desempenho_documentos') === 1, JSON.stringify(r.data));
for (const [p, ra] of [['ENEM1', '20000'], ['PART', '20001']]) { await adm(`/api/adm/desempenho/imagem?bimestre=1&prova=${p}&ra=${ra}&n=1`, 'PUT', jpeg(9)); await adm('/api/adm/desempenho/documentos', 'POST', { bimestre: 1, prova: p, ra, paginas: 1 }); }
r = await adm('/api/adm/desempenho?bimestre=1&prova=PART');
ok('Lista por bimestre e prova, com nome e turma, ainda não liberado', r.status === 200 && r.data.documentos.length === 2 && r.data.documentos.every(d => !d.liberado_em && d.codigo === '3EMA') && r.data.resumo.length === 2, JSON.stringify(r.data.resumo));

/* ---------- portal antes de liberar ---------- */
r = await portal('/api/portal/desempenho', { ra: '20000' });
ok('Portal: nada aparece antes de liberar', r.status === 200 && r.data.documentos.length === 0 && r.data.provas.ESPELHO === 'Espelho da redação', JSON.stringify(r.data));
const idPart = db.prepare("SELECT id FROM desempenho_documentos WHERE ra = '20000' AND prova = 'PART'").get().id;
r = await portal('/api/portal/desempenho/paginas', { ra: '20000', id: idPart });
ok('Portal: páginas de documento não liberado não abrem', r.status === 404);

/* ---------- liberar ---------- */
r = await adm('/api/adm/desempenho/liberar', 'POST', { bimestre: 1, prova: 'PART', liberar: true });
ok('Libera o Simulado Particulares do 1º bimestre (2 alunos)', r.status === 200 && r.data.alterados === 2, JSON.stringify(r.data));
r = await portal('/api/portal/desempenho', { ra: '20000' });
ok('Portal: aluno vê só o liberado (PART), não o ENEM1', r.status === 200 && r.data.documentos.length === 1 && r.data.documentos[0].prova === 'PART' && r.data.documentos[0].paginas === 3, JSON.stringify(r.data.documentos));
r = await portal('/api/portal/desempenho/paginas', { ra: '20000', id: idPart });
ok('Portal: devolve os links temporários das 3 páginas', r.status === 200 && r.data.links.length === 3 && r.data.links[2] === 'https://download.test/2026/B1/PART/20000/p3.jpg' && r.data.titulo === 'Simulado Particulares', JSON.stringify(r.data));
ok('Itens pedidos sem $select (no SharePoint o link não vem com $select)', !sp.pedidos.some(p => p.includes('$select')));
sp.semLinkNoItem = true;
r = await portal('/api/portal/desempenho/paginas', { ra: '20000', id: idPart });
ok('Sem o link no item, usa o /content (302)', r.status === 200 && r.data.links[0] === 'https://download.test/2026/B1/PART/20000/p1.jpg', JSON.stringify(r.data));
sp.semLinkNoItem = false;
r = await portal('/api/portal/desempenho/paginas', { ra: '20001', id: idPart });
ok('Portal: outro aluno não abre o documento do colega', r.status === 404 && !r.data.links);

/* ---------- segurança da rota do portal ---------- */
r = await portal('/api/portal/desempenho', { ra: '20000' }, { segredo: 'errado' });
ok('Portal: segredo errado é recusado', r.status === 401);
r = await portal('/api/portal/desempenho', { ra: '20000' }, { origin: 'https://idealolimpico.com.br' });
ok('Portal: chamada vinda de navegador (com Origin) é recusada', r.status === 403);
r = await portal('/api/portal/desempenho', { ra: '1 OR 1=1' });
ok('Portal: RA inválido é recusado', r.status === 400);
delete env.PORTAL_ATLAS_SECRET;
r = await portal('/api/portal/desempenho', { ra: '20000' });
ok('Portal: sem segredo configurado, fica indisponível', r.status === 503);
env.PORTAL_ATLAS_SECRET = SEGREDO;

/* ---------- substituir com menos páginas ---------- */
await adm('/api/adm/desempenho/imagem?bimestre=1&prova=PART&ra=20000&n=1', 'PUT', jpeg(7));
r = await adm('/api/adm/desempenho/documentos', 'POST', { bimestre: 1, prova: 'PART', ra: '20000', paginas: 1 });
ok('Reenvio substitui, mantém liberado e apaga as páginas que sobraram', r.status === 200 && r.data.substituiu && !sp.arquivos.has('2026/B1/PART/20000/p2.jpg') && !sp.arquivos.has('2026/B1/PART/20000/p3.jpg') && sp.arquivos.has('2026/B1/PART/20000/p1.jpg')
  && db.prepare('SELECT paginas, liberado_em FROM desempenho_documentos WHERE id = ?').get(idPart).liberado_em !== null, JSON.stringify(r.data));

/* ---------- recolher e apagar ---------- */
r = await adm('/api/adm/desempenho/liberar', 'POST', { bimestre: 1, prova: 'PART', liberar: false });
const p2 = await portal('/api/portal/desempenho', { ra: '20000' });
ok('Recolher tira do portal na hora', r.status === 200 && r.data.alterados === 2 && p2.data.documentos.length === 0);
r = await adm('/api/adm/desempenho/documentos/' + idPart, 'DELETE');
ok('Apagar documento tira do banco e do SharePoint', r.status === 200 && conta('SELECT COUNT(*) AS n FROM desempenho_documentos WHERE id = ?', idPart) === 0 && !sp.arquivos.has('2026/B1/PART/20000/p1.jpg'));
ok('Ações ficam registradas sem o nome do aluno', conta("SELECT COUNT(*) AS n FROM eventos WHERE acao LIKE 'redacao_desempenho_%'") >= 5 && conta("SELECT COUNT(*) AS n FROM eventos WHERE acao LIKE 'redacao_desempenho_%' AND detalhe LIKE '%Fictício%'") === 0);

/* ---------- espelhos ---------- */
const turma = db.prepare("SELECT t.id FROM redacao_turmas t JOIN redacao_alunos a ON a.turma_id = t.id WHERE a.ra = '20000'").get().id;
db.prepare("INSERT INTO usuarios (nome, email, papel, ativo) VALUES ('Prof Fictícia', 'prof@grupoideal.com.br', 'professor', 1)").run();
const prof = db.prepare("SELECT id FROM usuarios WHERE email = 'prof@grupoideal.com.br'").get().id;
const lote = Number(db.prepare("INSERT INTO redacao_lotes (ano, bimestre, turma_id, digitalizador_id, r2_key, nome_arquivo, bytes, enviado_em, cancelavel_ate) VALUES (2026, 1, ?, ?, 'redacao/2026/b1/x.pdf', 'x.pdf', 10, '2026-05-01T12:00:00Z', '2026-05-01T14:00:00Z')").run(turma, prof).lastInsertRowid);
for (const [p, ra] of [[1, '20000'], [2, '20001']]) db.prepare("INSERT INTO redacao_paginas (lote_id, pagina, ra_lido, situacao, aluno_ra) VALUES (?, ?, ?, 'aluno', ?)").run(lote, p, ra, ra);
db.prepare("INSERT INTO redacao_correcoes (lote_id, pagina, aluno_ra, professor_id, c1, c2, c3, c4, c5, total, observacao, marcacoes, enviada_em) VALUES (?, 1, '20000', ?, 160, 160, 120, 160, 120, 720, 'Bom texto', '[{\"x\":0.1,\"y\":0.2,\"w\":0.3,\"h\":0.02,\"c\":1}]', '2026-05-02T12:00:00Z')").run(lote, prof);
r = await adm('/api/adm/desempenho/espelhos');
ok('Espelhos: lote mostra 2 folhas, 1 corrigida, 0 espelhos', r.status === 200 && r.data.lotes.length === 1 && r.data.lotes[0].folhas === 2 && r.data.lotes[0].corrigidas === 1 && r.data.lotes[0].espelhos === 0, JSON.stringify(r.data.lotes));
r = await adm('/api/adm/desempenho/espelhos/' + lote);
ok('Dados do espelho: só folhas corrigidas, com notas, giro e destaques', r.status === 200 && r.data.folhas.length === 1 && r.data.folhas[0].total === 720 && r.data.folhas[0].marcacoes.length === 1 && 'angulo' in r.data.folhas[0] && r.data.lote.codigo === '3EMA', JSON.stringify(r.data));
await adm('/api/adm/desempenho/imagem?bimestre=1&prova=ESPELHO&ra=20000&n=1', 'PUT', jpeg(5));
r = await adm('/api/adm/desempenho/documentos', 'POST', { bimestre: 1, prova: 'ESPELHO', ra: '20000', paginas: 1, lote_id: lote });
const r4 = await adm('/api/adm/desempenho/espelhos');
ok('Espelho registrado conta no lote', r.status === 200 && r4.data.lotes[0].espelhos === 1);

for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK  ').length;
console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`);
process.exit(bad ? 1 : 0);
