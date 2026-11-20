// "Meu desempenho" do portal do aluno (aprovado pelo Marinho em 17/11/2026; SharePoint liberado em 18/11/2026).
// Documentos de cada aluno por bimestre: mapa de desempenho do Simulado Particulares, do ENEM 1º dia e do
// ENEM 2º dia, e o espelho da redação. As páginas ficam como JPEG no site "Resultados IDEAL OLÍMPICO"
// (Sites.Selected, só escrita nesse site): <ano>/B<bimestre>/<prova>/<RA>/p<n>.jpg.
// O ADM envia e libera; o aluno vê pelo portal (Apps Script → esta API com o segredo PORTAL_ATLAS_SECRET),
// recebendo só links temporários das imagens dele. Guarda: só o ano corrente (encerramento de 31/12).
import { RedacaoError } from './redacao-cadastros.js';

export const PROVAS = Object.freeze({ PART: 'Simulado Particulares', ENEM1: 'Simulado ENEM · 1º dia', ENEM2: 'Simulado ENEM · 2º dia', ESPELHO: 'Espelho da redação' });
const MAX_IMAGEM = 4 * 1024 * 1024;   /* envio simples do Graph aceita até 4 MB por arquivo */
const MAX_PAGINAS = 40;
const erro = (status, mensagem) => { throw new RedacaoError(status, mensagem); };
const agora = () => new Date().toISOString();
const inteiro = (v, min, max) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) erro(400, 'Número inválido.'); return n; };
const prova = v => { if (!Object.hasOwn(PROVAS, v)) erro(400, 'Prova inválida.'); return v; };
const raValido = v => { const s = String(v ?? '').trim(); if (!/^\d{1,15}$/.test(s)) erro(400, 'RA inválido.'); return s; };

/* ---------- Microsoft Graph (token próprio, com cache na instância) ---------- */
let token = null;
async function tokenGraph(env) {
  if (token && token.cliente === env.MS_CLIENT_ID && token.expira > Date.now() + 60000) return token.valor;
  if (!env.MS_TENANT_ID || !env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET) erro(503, 'Microsoft não configurada.');
  const r = await fetch('https://login.microsoftonline.com/' + encodeURIComponent(env.MS_TENANT_ID) + '/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString()
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) erro(502, 'A Microsoft recusou a chave do ATLAS.');
  token = { valor: d.access_token, cliente: env.MS_CLIENT_ID, expira: Date.now() + Number(d.expires_in || 3000) * 1000 };
  return token.valor;
}
export function base(env) {
  if (!env.SHAREPOINT_SITE) erro(503, 'SharePoint dos resultados não configurado.');
  return 'https://graph.microsoft.com/v1.0/sites/' + encodeURIComponent(env.SHAREPOINT_SITE) + '/drive';
}
const caminho = (ano, bimestre, p, ra, n) => `${ano}/B${bimestre}/${p}/${ra}/p${n}.jpg`;
export async function graph(env, url, op = {}) {
  const t = await tokenGraph(env);
  const r = await fetch(url, { ...op, headers: { Authorization: 'Bearer ' + t, ...(op.headers || {}) } });
  if (r.status === 401) token = null;
  return r;
}
/* Link temporário (pré-autenticado, vale cerca de 1 h) de uma página. No SharePoint ele não vem com $select. */
async function linkTemporario(env, ano, bimestre, p, ra, n) {
  const url = base(env) + '/root:/' + caminho(ano, bimestre, p, ra, n);
  const r = await graph(env, url);
  if (r.ok) { const d = await r.json().catch(() => ({})); if (d['@microsoft.graph.downloadUrl']) return d['@microsoft.graph.downloadUrl']; }
  const c = await graph(env, url + ':/content', { redirect: 'manual' });
  if (c.status >= 300 && c.status < 400 && c.headers.get('Location')) return c.headers.get('Location');
  return null;
}
async function apagarCaminho(env, rel) {
  const r = await graph(env, base(env) + '/root:/' + rel, { method: 'DELETE' });
  return r.status === 204 || r.status === 404;
}
/* Encerramento do ano: apaga a pasta do ano no SharePoint (vai para a lixeira do site). */
export async function apagarAnoSharePoint(env, ano) {
  if (!env.SHAREPOINT_SITE || !env.MS_CLIENT_SECRET) return false;
  try { return await apagarCaminho(env, String(ano)); } catch { return false; }
}

/* ---------- ADM ---------- */
async function alunosDoAno(env, ano) {
  return (await env.DB.prepare(
    'SELECT a.ra, a.nome, a.serie, a.segmento, t.unidade, t.codigo FROM redacao_alunos a JOIN redacao_turmas t ON t.id = a.turma_id WHERE a.ano = ? ORDER BY a.nome COLLATE NOCASE'
  ).bind(ano).all()).results;
}
async function documentos(env, ano, bimestre, p) {
  return (await env.DB.prepare(
    'SELECT d.id, d.ra, d.paginas, d.enviado_em, d.liberado_em, d.lote_id, a.nome, t.unidade, t.codigo FROM desempenho_documentos d ' +
    'LEFT JOIN redacao_alunos a ON a.ra = d.ra LEFT JOIN redacao_turmas t ON t.id = a.turma_id ' +
    'WHERE d.ano = ? AND d.bimestre = ? AND d.prova = ? ORDER BY a.nome COLLATE NOCASE, d.ra'
  ).bind(ano, bimestre, p).all()).results;
}
async function resumo(env, ano) {
  return (await env.DB.prepare(
    'SELECT bimestre, prova, COUNT(*) AS documentos, SUM(liberado_em IS NOT NULL) AS liberados FROM desempenho_documentos WHERE ano = ? GROUP BY bimestre, prova ORDER BY bimestre, prova'
  ).bind(ano).all()).results;
}

/* Imagem de uma página (JPEG vindo do navegador do ADM) direto para o SharePoint. */
async function receberImagem(request, env, url, ano) {
  const b = inteiro(url.searchParams.get('bimestre'), 1, 4), p = prova(url.searchParams.get('prova'));
  const ra = raValido(url.searchParams.get('ra')), n = inteiro(url.searchParams.get('n'), 1, MAX_PAGINAS);
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'image/jpeg') erro(415, 'Envie a página como imagem JPEG.');
  if (Number(request.headers.get('Content-Length') || 0) > MAX_IMAGEM) erro(413, 'Imagem maior que 4 MB.');
  const corpo = new Uint8Array(await request.arrayBuffer());
  if (!corpo.length || corpo.length > MAX_IMAGEM) erro(413, 'Imagem vazia ou maior que 4 MB.');
  if (corpo[0] !== 0xFF || corpo[1] !== 0xD8) erro(415, 'O arquivo não é uma imagem JPEG.');
  if (!await env.DB.prepare('SELECT 1 FROM redacao_alunos WHERE ra = ? AND ano = ?').bind(ra, ano).first()) erro(404, 'Aluno não encontrado na lista do ano.');
  const r = await graph(env, base(env) + '/root:/' + caminho(ano, b, p, ra, n) + ':/content', { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: corpo });
  if (r.status !== 200 && r.status !== 201) erro(502, 'O SharePoint recusou a imagem (' + r.status + '). Tente de novo.');
  return { ok: true };
}

/* Registra (ou substitui) o documento de um aluno depois que todas as páginas subiram. */
async function registrar(env, body, ano, quem, registrarEvento) {
  const b = inteiro(body?.bimestre, 1, 4), p = prova(body?.prova), ra = raValido(body?.ra), paginas = inteiro(body?.paginas, 1, MAX_PAGINAS);
  const loteId = body?.lote_id ? inteiro(body.lote_id, 1, 1000000000) : null;
  if (!await env.DB.prepare('SELECT 1 FROM redacao_alunos WHERE ra = ? AND ano = ?').bind(ra, ano).first()) erro(404, 'Aluno não encontrado na lista do ano.');
  const antigo = await env.DB.prepare('SELECT id, paginas, liberado_em FROM desempenho_documentos WHERE ano = ? AND bimestre = ? AND prova = ? AND ra = ?').bind(ano, b, p, ra).first();
  /* páginas que sobraram de uma versão anterior maior saem do SharePoint */
  if (antigo && antigo.paginas > paginas) for (let n = paginas + 1; n <= antigo.paginas; n++) await apagarCaminho(env, caminho(ano, b, p, ra, n)).catch(() => {});
  await env.DB.prepare(
    'INSERT INTO desempenho_documentos (ano, bimestre, prova, ra, paginas, lote_id, enviado_em, enviado_por, liberado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT (ano, bimestre, prova, ra) DO UPDATE SET paginas = excluded.paginas, lote_id = excluded.lote_id, enviado_em = excluded.enviado_em, enviado_por = excluded.enviado_por'
  ).bind(ano, b, p, ra, paginas, loteId, agora(), quem, antigo?.liberado_em || null).run();
  await registrarEvento(env, 'redacao_desempenho_enviado', { ano, bimestre: b, prova: p, ra, paginas, substituiu: !!antigo });
  return { ok: true, substituiu: !!antigo };
}

async function liberar(env, body, ano, quem, registrarEvento) {
  const b = inteiro(body?.bimestre, 1, 4), p = prova(body?.prova), sim = body?.liberar === true;
  const r = await env.DB.prepare(sim
    ? 'UPDATE desempenho_documentos SET liberado_em = ? WHERE ano = ? AND bimestre = ? AND prova = ? AND liberado_em IS NULL'
    : 'UPDATE desempenho_documentos SET liberado_em = NULL WHERE ano = ? AND bimestre = ? AND prova = ? AND liberado_em IS NOT NULL'
  ).bind(...(sim ? [agora(), ano, b, p] : [ano, b, p])).run();
  await registrarEvento(env, sim ? 'redacao_desempenho_liberado' : 'redacao_desempenho_recolhido', { ano, bimestre: b, prova: p, por: quem, documentos: r.meta?.changes || 0 });
  return { ok: true, alterados: r.meta?.changes || 0 };
}

async function apagarDocumento(env, id, ano, quem, registrarEvento) {
  const d = await env.DB.prepare('SELECT * FROM desempenho_documentos WHERE id = ? AND ano = ?').bind(id, ano).first();
  if (!d) erro(404, 'Documento não encontrado.');
  for (let n = 1; n <= d.paginas; n++) await apagarCaminho(env, caminho(d.ano, d.bimestre, d.prova, d.ra, n)).catch(() => {});
  await env.DB.prepare('DELETE FROM desempenho_documentos WHERE id = ?').bind(id).run();
  await registrarEvento(env, 'redacao_desempenho_apagado', { ano, bimestre: d.bimestre, prova: d.prova, ra: d.ra, por: quem });
  return { ok: true };
}

/* Espelhos: lotes do ano com as folhas corrigidas e quantos espelhos já existem. */
async function lotesParaEspelho(env, ano) {
  return (await env.DB.prepare(
    "SELECT l.id, l.bimestre, t.unidade, t.segmento, t.serie, t.codigo, " +
    "(SELECT COUNT(*) FROM redacao_paginas p WHERE p.lote_id = l.id AND p.situacao = 'aluno') AS folhas, " +
    "(SELECT COUNT(*) FROM redacao_correcoes c JOIN redacao_paginas p ON p.lote_id = c.lote_id AND p.pagina = c.pagina AND p.situacao = 'aluno' WHERE c.lote_id = l.id AND c.condenada = 0 AND c.enviada_em IS NOT NULL) AS corrigidas, " +
    "(SELECT COUNT(*) FROM desempenho_documentos d WHERE d.lote_id = l.id AND d.prova = 'ESPELHO') AS espelhos " +
    'FROM redacao_lotes l JOIN redacao_turmas t ON t.id = l.turma_id WHERE l.ano = ? AND l.cancelado_em IS NULL ORDER BY l.bimestre, t.unidade, t.codigo'
  ).bind(ano).all()).results;
}
/* Dados para montar os espelhos de um lote no navegador do ADM (o PDF vem da rota de lotes do ADM). */
async function dadosEspelho(env, loteId, ano) {
  const lote = await env.DB.prepare('SELECT l.id, l.bimestre, l.ano, t.unidade, t.serie, t.codigo FROM redacao_lotes l JOIN redacao_turmas t ON t.id = l.turma_id WHERE l.id = ? AND l.ano = ? AND l.cancelado_em IS NULL').bind(loteId, ano).first();
  if (!lote) erro(404, 'Lote não encontrado.');
  const folhas = (await env.DB.prepare(
    'SELECT p.pagina, p.aluno_ra AS ra, a.nome, p.angulo, p.invertida, c.c1, c.c2, c.c3, c.c4, c.c5, c.total, c.zero_motivo, c.c5_motivo, c.observacao, c.marcacoes ' +
    "FROM redacao_paginas p JOIN redacao_correcoes c ON c.lote_id = p.lote_id AND c.pagina = p.pagina LEFT JOIN redacao_alunos a ON a.ra = p.aluno_ra " +
    "WHERE p.lote_id = ? AND p.situacao = 'aluno' AND c.condenada = 0 AND c.enviada_em IS NOT NULL ORDER BY p.pagina"
  ).bind(loteId).all()).results.map(f => { let m = []; try { m = JSON.parse(f.marcacoes || '[]'); } catch {} return { ...f, marcacoes: Array.isArray(m) ? m : [] }; });
  return { ok: true, lote, folhas };
}

export async function rotaDesempenhoAdm(request, env, path, { hojeSP, readJson, registrar: registrarEvento, sessao }) {
  if (!path.startsWith('/api/adm/desempenho')) return null;
  const ano = Number(hojeSP(env).slice(0, 4)), quem = sessao?.email || 'adm', url = new URL(request.url);
  if (path === '/api/adm/desempenho' && request.method === 'GET') {
    const b = url.searchParams.get('bimestre'), p = url.searchParams.get('prova');
    return { ok: true, ano, provas: PROVAS, resumo: await resumo(env, ano), documentos: b && p ? await documentos(env, ano, inteiro(b, 1, 4), prova(p)) : [] };
  }
  if (path === '/api/adm/desempenho/alunos' && request.method === 'GET') return { ok: true, ano, alunos: await alunosDoAno(env, ano) };
  if (path === '/api/adm/desempenho/imagem' && request.method === 'PUT') return await receberImagem(request, env, url, ano);
  if (path === '/api/adm/desempenho/documentos' && request.method === 'POST') return await registrar(env, await readJson(request), ano, quem, registrarEvento);
  if (path === '/api/adm/desempenho/liberar' && request.method === 'POST') return await liberar(env, await readJson(request), ano, quem, registrarEvento);
  const md = path.match(/^\/api\/adm\/desempenho\/documentos\/(\d+)$/);
  if (md && request.method === 'DELETE') return await apagarDocumento(env, inteiro(md[1], 1, 1000000000), ano, quem, registrarEvento);
  if (path === '/api/adm/desempenho/espelhos' && request.method === 'GET') return { ok: true, ano, lotes: await lotesParaEspelho(env, ano) };
  const me = path.match(/^\/api\/adm\/desempenho\/espelhos\/(\d+)$/);
  if (me && request.method === 'GET') return await dadosEspelho(env, inteiro(me[1], 1, 1000000000), ano);
  erro(404, 'Rota indisponível.');
}

/* ---------- portal do aluno (servidor a servidor; o segredo já foi conferido por quem chama) ---------- */
export async function rotaDesempenhoPortal(env, path, body, hojeSP) {
  const ano = Number(hojeSP(env).slice(0, 4)), ra = raValido(body?.ra);
  if (path === '/api/portal/desempenho') {
    const docs = (await env.DB.prepare(
      'SELECT id, bimestre, prova, paginas, liberado_em FROM desempenho_documentos WHERE ra = ? AND ano = ? AND liberado_em IS NOT NULL ORDER BY bimestre, prova'
    ).bind(ra, ano).all()).results;
    return { ok: true, ano, provas: PROVAS, documentos: docs };
  }
  if (path === '/api/portal/desempenho/paginas') {
    const id = inteiro(body?.id, 1, 1000000000);
    const d = await env.DB.prepare('SELECT * FROM desempenho_documentos WHERE id = ? AND ano = ?').bind(id, ano).first();
    /* só o próprio aluno, e só depois de liberado */
    if (!d || d.ra !== ra || !d.liberado_em) erro(404, 'Documento não encontrado.');
    const links = [];
    for (let n = 1; n <= d.paginas; n++) {
      const l = await linkTemporario(env, d.ano, d.bimestre, d.prova, d.ra, n);
      if (!l) erro(502, 'Não foi possível abrir as páginas agora. Tente de novo em instantes.');
      links.push(l);
    }
    return { ok: true, bimestre: d.bimestre, prova: d.prova, titulo: PROVAS[d.prova], links };
  }
  erro(404, 'Rota indisponível.');
}
