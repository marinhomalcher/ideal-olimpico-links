// "Encerrar ano" da Redação (política de privacidade aprovada em 18/11/2026).
// O ADM aciona na tela "Cadastros de Redação" → aba "Encerrar ano", digitando o ano para confirmar.
// Apaga, do ano letivo indicado: correções e notas, índice de folhas, lotes e os PDFs no R2
// (redacao/<ano>/…), envios, alunos de redação, turmas e o vínculo professora ↔ turma, importações
// e os registros (eventos) de redação do ano. Professoras, digitalizadores, coordenadores e usuários
// continuam cadastrados. No fim, faz uma cópia de segurança nova (já sem redação) e apaga as anteriores.
// Só pode ser usado de 1º de dezembro (o próprio ano) a 31 de janeiro (o ano anterior).
// O apagamento é feito em lotes: cada chamada faz uma parte e devolve `concluido: false` até acabar;
// a tela chama de novo até `concluido: true`. O andamento fica em `meta` ("encerramento_redacao_<ano>").
import { RedacaoError } from './redacao-cadastros.js';

const LOTE_LINHAS = 500;      // linhas apagadas por comando
const COMANDOS_POR_CHAMADA = 12;
const LOTE_R2 = 500;          // objetos apagados por chamada (o R2 aceita até 1.000 chaves por delete)

function erro(status, message) { throw new RedacaoError(status, message); }

/* Tabelas do ano, na ordem em que podem ser apagadas (as que dependem de outras vêm primeiro). */
const ETAPAS = [
  { chave: 'correcoes', contar: 'SELECT COUNT(*) AS n FROM redacao_correcoes WHERE lote_id IN (SELECT id FROM redacao_lotes WHERE ano = ?)',
    apagar: 'DELETE FROM redacao_correcoes WHERE rowid IN (SELECT rowid FROM redacao_correcoes WHERE lote_id IN (SELECT id FROM redacao_lotes WHERE ano = ?) LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'paginas', contar: 'SELECT COUNT(*) AS n FROM redacao_paginas WHERE lote_id IN (SELECT id FROM redacao_lotes WHERE ano = ?)',
    apagar: 'DELETE FROM redacao_paginas WHERE rowid IN (SELECT rowid FROM redacao_paginas WHERE lote_id IN (SELECT id FROM redacao_lotes WHERE ano = ?) LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'lotes', contar: 'SELECT COUNT(*) AS n FROM redacao_lotes WHERE ano = ?',
    apagar: 'DELETE FROM redacao_lotes WHERE rowid IN (SELECT rowid FROM redacao_lotes WHERE ano = ? LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'envios', contar: 'SELECT COUNT(*) AS n FROM redacao_envios WHERE ano = ?',
    apagar: 'DELETE FROM redacao_envios WHERE rowid IN (SELECT rowid FROM redacao_envios WHERE ano = ? LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'alunos', contar: 'SELECT COUNT(*) AS n FROM redacao_alunos WHERE ano = ?',
    apagar: 'DELETE FROM redacao_alunos WHERE rowid IN (SELECT rowid FROM redacao_alunos WHERE ano = ? LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'vinculos', contar: 'SELECT COUNT(*) AS n FROM redacao_professor_turmas WHERE turma_id IN (SELECT id FROM redacao_turmas WHERE ano = ?)',
    apagar: 'DELETE FROM redacao_professor_turmas WHERE rowid IN (SELECT rowid FROM redacao_professor_turmas WHERE turma_id IN (SELECT id FROM redacao_turmas WHERE ano = ?) LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'turmas', contar: 'SELECT COUNT(*) AS n FROM redacao_turmas WHERE ano = ?',
    apagar: 'DELETE FROM redacao_turmas WHERE rowid IN (SELECT rowid FROM redacao_turmas WHERE ano = ? LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'importacoes', contar: 'SELECT COUNT(*) AS n FROM redacao_importacoes WHERE ano = ?',
    apagar: 'DELETE FROM redacao_importacoes WHERE rowid IN (SELECT rowid FROM redacao_importacoes WHERE ano = ? LIMIT ' + LOTE_LINHAS + ')' },
  /* registros de redação do ano (citam RA e lotes); o próprio registro do encerramento fica */
  { chave: 'eventos', args: ano => [ano + '-', (ano + 1) + '-'],
    contar: "SELECT COUNT(*) AS n FROM eventos WHERE acao LIKE 'redacao_%' AND acao <> 'redacao_ano_encerrado' AND criado_em >= ? AND criado_em < ?",
    apagar: "DELETE FROM eventos WHERE rowid IN (SELECT rowid FROM eventos WHERE acao LIKE 'redacao_%' AND acao <> 'redacao_ano_encerrado' AND criado_em >= ? AND criado_em < ? LIMIT " + LOTE_LINHAS + ')' }
];
export const NOMES = { pdfs: 'PDFs no armazenamento', correcoes: 'correções (notas)', paginas: 'folhas', lotes: 'lotes', envios: 'envios', alunos: 'alunos de redação',
  vinculos: 'vínculos professora ↔ turma', turmas: 'turmas', importacoes: 'importações', eventos: 'registros de redação' };

function prefixoR2(ano) { return 'redacao/' + ano + '/'; }

/* Época permitida: dezembro apaga o próprio ano; janeiro apaga o ano anterior. Fora disso, nenhum. */
export function anoPermitido(hoje) {
  const [ano, mes] = hoje.split('-').map(Number);
  if (mes === 12) return ano;
  if (mes === 1) return ano - 1;
  return null;
}

async function contarR2(env, ano) {
  if (!env.IMAGENS) return 0;
  let total = 0, cursor;
  do {
    const r = await env.IMAGENS.list({ prefix: prefixoR2(ano), cursor });
    total += r.objects.length;
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return total;
}

async function contagens(env, ano) {
  const c = { pdfs: await contarR2(env, ano) };
  for (const e of ETAPAS) c[e.chave] = (await env.DB.prepare(e.contar).bind(...(e.args ? e.args(ano) : [ano])).first()).n;
  return c;
}

function chaveMeta(ano) { return 'encerramento_redacao_' + ano; }
async function lerAndamento(env, ano) {
  const r = await env.DB.prepare('SELECT valor FROM meta WHERE chave = ?').bind(chaveMeta(ano)).first();
  if (!r) return null;
  try { return JSON.parse(r.valor); } catch { return null; }
}
async function gravarAndamento(env, ano, andamento) {
  await env.DB.prepare('INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
    .bind(chaveMeta(ano), JSON.stringify(andamento)).run();
}

/* Uma rodada de apagamento. Devolve o que apagou nesta chamada e se ainda falta algo. */
async function apagarParte(env, ano) {
  const apagados = {};
  let comandos = 0;
  if (env.IMAGENS) {
    const r = await env.IMAGENS.list({ prefix: prefixoR2(ano), limit: LOTE_R2 });
    const chaves = r.objects.map(o => o.key);
    if (chaves.length) { await env.IMAGENS.delete(chaves); apagados.pdfs = chaves.length; }
    if (r.truncated) return { apagados, concluido: false };
  }
  for (const e of ETAPAS) {
    for (;;) {
      if (comandos >= COMANDOS_POR_CHAMADA) return { apagados, concluido: false };
      const r = await env.DB.prepare(e.apagar).bind(...(e.args ? e.args(ano) : [ano])).run();
      comandos++;
      const n = r.meta?.changes || 0;
      if (n) apagados[e.chave] = (apagados[e.chave] || 0) + n;
      if (n < LOTE_LINHAS) break;
    }
  }
  return { apagados, concluido: true };
}

export async function rotaEncerrarAno(request, env, path, { readJson, hojeSP, registrar, sessao, fazerBackup, listarBackups }) {
  if (path !== '/api/adm/redacao/encerrar-ano') return null;
  const hoje = hojeSP(env);
  const permitido = anoPermitido(hoje);
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const pedido = Number(url.searchParams.get('ano') || permitido || hoje.slice(0, 4));
    if (!Number.isInteger(pedido) || pedido < 2026 || pedido > 2100) erro(400, 'Ano inválido.');
    return { ok: true, hoje, ano: pedido, ano_permitido: permitido, permitido: permitido === pedido, contagens: await contagens(env, pedido), andamento: await lerAndamento(env, pedido) };
  }
  if (request.method !== 'POST') return null;
  const body = await readJson(request);
  const ano = Number(body.ano);
  if (!Number.isInteger(ano) || ano < 2026 || ano > 2100) erro(400, 'Ano inválido.');
  if (permitido === null) erro(403, 'O encerramento só pode ser feito de 1º de dezembro a 31 de janeiro. Hoje é ' + hoje.split('-').reverse().join('/') + '.');
  if (ano !== permitido) erro(403, 'Hoje só é possível encerrar o ano ' + permitido + '.');
  if (String(body.confirmacao ?? '').trim() !== String(ano)) erro(400, 'Digite o ano ' + ano + ' para confirmar.');

  const andamento = (await lerAndamento(env, ano)) || { iniciado_em: hoje, por: sessao.email, apagados: {} };
  const parte = await apagarParte(env, ano);
  for (const [k, v] of Object.entries(parte.apagados)) andamento.apagados[k] = (andamento.apagados[k] || 0) + v;
  if (!parte.concluido) {
    await gravarAndamento(env, ano, andamento);
    return { ok: true, concluido: false, ano, apagados: parte.apagados, total: andamento.apagados };
  }
  /* Tudo apagado: cópia nova (já sem redação) e as anteriores saem, como decidido em 18/11/2026. */
  let copia = null, copias_removidas = 0;
  if (env.IMAGENS) {
    copia = await fazerBackup(env, 'encerramento-redacao-' + ano);
    for (const antiga of await listarBackups(env)) {
      if (antiga.nome === copia.nome) continue;
      await env.IMAGENS.delete(antiga.chave);
      copias_removidas++;
    }
  }
  await env.DB.prepare('DELETE FROM meta WHERE chave = ?').bind(chaveMeta(ano)).run();
  const relatorio = { ano, por: sessao.email, iniciado_em: andamento.iniciado_em, concluido_em: hoje, apagados: andamento.apagados, copia: copia?.nome || null, copias_removidas };
  await registrar(env, 'redacao_ano_encerrado', relatorio);
  return { ok: true, concluido: true, ano, apagados: parte.apagados, total: andamento.apagados, copia: copia?.nome || null, copias_removidas };
}
