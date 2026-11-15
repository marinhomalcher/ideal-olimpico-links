// Correção das redações pela professora (bloco A): só as turmas dela, só folhas identificadas.
// A nota é conferida aqui no servidor: valores permitidos, motivos obrigatórios e total recalculado.
import { RedacaoError } from './redacao-cadastros.js';

const erro = (status, mensagem) => { throw new RedacaoError(status, mensagem); };
const agora = () => new Date().toISOString();
const inteiro = (v, min, max) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) erro(400, 'Número inválido.'); return n; };

export const ESCALA = [0, 40, 80, 120, 160, 200];
export const ESCALA_C2 = [40, 80, 120, 160, 200];
/* Listas aprovadas pelo Marinho (em minúsculas). */
export const MOTIVOS_ZERO = [
  'em branco', 'texto insuficiente (até 7 linhas válidas)', 'cópia integral ou em mais da metade do texto', 'fuga ao tema',
  'não atendimento ao tipo dissertativo-argumentativo', 'anulação proposital (impropérios, desenhos etc.)',
  'sinal gráfico sem função no texto', 'trecho deliberadamente desconectado do tema', 'identificação no espaço destinado ao texto',
  'predomínio de língua estrangeira', 'escrita original ilegível'
];
export const MOTIVOS_C5 = [
  'não apresenta proposta de intervenção', 'proposta integralmente copiada da prova',
  'proposta que desrespeita os direitos humanos', 'proposta sem relação sequer com o assunto'
];
export const MOTIVOS_CONDENAR = ['folha ilegível', 'erro de digitalização', 'folha de outro aluno', 'outro'];

async function professora(request, env, sessaoAtual) {
  const sessao = await sessaoAtual(request, env, 'usuario');
  const p = await env.DB.prepare(
    "SELECT u.id, u.nome, u.email FROM redacao_equipe e JOIN usuarios u ON u.id = e.usuario_id WHERE u.id = ? AND u.ativo = 1 AND e.ativo = 1 AND e.funcao = 'professor'"
  ).bind(sessao.usuario_id).first();
  if (!p) erro(403, 'Apenas professores de Redação corrigem redações.');
  return p;
}

/* Lote ativo de uma turma da professora (senão, 404). */
async function loteDaProfessora(env, loteId, pessoa) {
  const lote = await env.DB.prepare(
    'SELECT l.id, l.ano, l.bimestre, l.turma_id, l.r2_key, l.nome_arquivo, l.cancelado_em, t.unidade, t.segmento, t.serie, t.codigo ' +
    'FROM redacao_lotes l JOIN redacao_turmas t ON t.id = l.turma_id ' +
    'JOIN redacao_professor_turmas pt ON pt.turma_id = l.turma_id AND pt.usuario_id = ? WHERE l.id = ?'
  ).bind(pessoa.id, loteId).first();
  if (!lote || lote.cancelado_em) erro(404, 'Lote não encontrado.');
  return lote;
}

/* Folhas que a professora corrige agora: só as identificadas (situação 'aluno'). */
async function folhas(env, lote) {
  return (await env.DB.prepare(
    'SELECT p.pagina, p.aluno_ra AS ra, a.nome, p.angulo, p.invertida, c.total, c.c1, c.c2, c.c3, c.c4, c.c5, c.zero_motivo, c.c5_motivo, c.observacao, ' +
    'c.condenada, c.condenada_motivo, c.enviada_em, c.revisada_em, c.segundos ' +
    "FROM redacao_paginas p LEFT JOIN redacao_alunos a ON a.ra = p.aluno_ra LEFT JOIN redacao_correcoes c ON c.lote_id = p.lote_id AND c.pagina = p.pagina " +
    "WHERE p.lote_id = ? AND p.situacao = 'aluno' ORDER BY p.pagina"
  ).bind(lote.id).all()).results.map(f => ({ ...f, estado: !f.enviada_em ? 'pendente' : f.condenada ? 'condenada' : 'corrigida' }));
}

function progresso(lista) {
  const r = { folhas: lista.length, corrigidas: 0, condenadas: 0, pendentes: 0 };
  for (const f of lista) r[f.estado === 'corrigida' ? 'corrigidas' : f.estado === 'condenada' ? 'condenadas' : 'pendentes']++;
  return r;
}

async function turmasComLotes(env, pessoa, ano) {
  const turmas = (await env.DB.prepare(
    'SELECT t.id, t.unidade, t.segmento, t.serie, t.codigo FROM redacao_professor_turmas pt JOIN redacao_turmas t ON t.id = pt.turma_id ' +
    'WHERE pt.usuario_id = ? AND t.ano = ? AND t.ativa = 1 ORDER BY t.unidade, t.segmento, t.serie, t.codigo'
  ).bind(pessoa.id, ano).all()).results;
  for (const t of turmas) {
    t.lotes = (await env.DB.prepare(
      "SELECT l.id, l.bimestre, l.enviado_em, " +
      "(SELECT COUNT(*) FROM redacao_paginas p WHERE p.lote_id = l.id AND p.situacao = 'aluno') AS folhas, " +
      "(SELECT COUNT(*) FROM redacao_correcoes c JOIN redacao_paginas p ON p.lote_id = c.lote_id AND p.pagina = c.pagina AND p.situacao = 'aluno' WHERE c.lote_id = l.id AND c.condenada = 0) AS corrigidas, " +
      "(SELECT COUNT(*) FROM redacao_correcoes c JOIN redacao_paginas p ON p.lote_id = c.lote_id AND p.pagina = c.pagina AND p.situacao = 'aluno' WHERE c.lote_id = l.id AND c.condenada = 1) AS condenadas " +
      'FROM redacao_lotes l WHERE l.turma_id = ? AND l.ano = ? AND l.cancelado_em IS NULL ORDER BY l.bimestre'
    ).bind(t.id, ano).all()).results;
  }
  return turmas;
}

/* Confere e calcula a nota enviada. Devolve as colunas a gravar. */
export function conferirNota(body) {
  const obs = String(body?.observacao ?? '').trim().slice(0, 1000) || null;
  if (body?.condenar) {
    const motivo = String(body.motivo ?? '').trim();
    if (!MOTIVOS_CONDENAR.includes(motivo)) erro(400, 'Escolha o motivo para condenar a página.');
    return { c1: null, c2: null, c3: null, c4: null, c5: null, total: null, zero_motivo: null, c5_motivo: null, observacao: obs, condenada: 1, condenada_motivo: motivo };
  }
  const zero = body?.zero_motivo ? String(body.zero_motivo).trim() : '';
  if (zero) {
    if (!MOTIVOS_ZERO.includes(zero)) erro(400, 'Motivo da nota zero inválido.');
    return { c1: null, c2: null, c3: null, c4: null, c5: null, total: 0, zero_motivo: zero, c5_motivo: null, observacao: obs, condenada: 0, condenada_motivo: null };
  }
  const v = {};
  for (const k of ['c1', 'c2', 'c3', 'c4', 'c5']) {
    const n = Number(body?.[k]);
    if (body?.[k] === null || body?.[k] === undefined || body?.[k] === '' || !(k === 'c2' ? ESCALA_C2 : ESCALA).includes(n)) {
      erro(400, k === 'c2' ? 'A C2 vai de 40 a 200 (o zero da C2 só existe zerando a redação inteira).' : `Nota da ${k.toUpperCase()} inválida.`);
    }
    v[k] = n;
  }
  let c5m = null;
  if (v.c5 === 0) {
    c5m = String(body?.c5_motivo ?? '').trim();
    if (!MOTIVOS_C5.includes(c5m)) erro(400, 'Informe o motivo da nota zero na C5.');
  }
  return { ...v, total: v.c1 + v.c2 + v.c3 + v.c4 + v.c5, zero_motivo: null, c5_motivo: c5m, observacao: obs, condenada: 0, condenada_motivo: null };
}

async function salvar(env, lote, n, body, pessoa, registrar) {
  const pag = await env.DB.prepare("SELECT aluno_ra FROM redacao_paginas WHERE lote_id = ? AND pagina = ? AND situacao = 'aluno'").bind(lote.id, n).first();
  if (!pag) erro(404, 'Folha não encontrada ou ainda sem aluno.');
  const nota = conferirNota(body);
  const anterior = await env.DB.prepare('SELECT enviada_em, condenada FROM redacao_correcoes WHERE lote_id = ? AND pagina = ?').bind(lote.id, n).first();
  const h = agora();
  if (!anterior) {
    /* Tempo só da primeira correção (sem pausa; se fechar, recomeça do zero na tela). */
    const segundos = Math.max(0, Math.min(86400, Math.round(Number(body?.segundos) || 0)));
    await env.DB.prepare(
      'INSERT INTO redacao_correcoes (lote_id, pagina, aluno_ra, professor_id, c1, c2, c3, c4, c5, total, zero_motivo, c5_motivo, observacao, condenada, condenada_motivo, segundos, enviada_em) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(lote.id, n, pag.aluno_ra, pessoa.id, nota.c1, nota.c2, nota.c3, nota.c4, nota.c5, nota.total, nota.zero_motivo, nota.c5_motivo, nota.observacao, nota.condenada, nota.condenada_motivo, segundos, h).run();
  } else {
    if (anterior.condenada) erro(409, 'Esta página foi condenada e está com o ADM.');
    await env.DB.prepare(
      'UPDATE redacao_correcoes SET professor_id = ?, c1 = ?, c2 = ?, c3 = ?, c4 = ?, c5 = ?, total = ?, zero_motivo = ?, c5_motivo = ?, observacao = ?, condenada = ?, condenada_motivo = ?, revisada_em = ? WHERE lote_id = ? AND pagina = ?'
    ).bind(pessoa.id, nota.c1, nota.c2, nota.c3, nota.c4, nota.c5, nota.total, nota.zero_motivo, nota.c5_motivo, nota.observacao, nota.condenada, nota.condenada_motivo, h, lote.id, n).run();
  }
  await registrar(env, nota.condenada ? 'redacao_pagina_condenada' : anterior ? 'redacao_correcao_revisada' : 'redacao_correcao_enviada',
    { lote_id: lote.id, pagina: n, total: nota.total, motivo: nota.condenada_motivo }, pessoa.id);
  const lista = await folhas(env, lote);
  return { ok: true, folha: lista.find(f => f.pagina === n), progresso: progresso(lista) };
}

export async function rotaCorrecao(request, env, path, { sessaoAtual, hojeSP, registrar, readJson }) {
  if (!path.startsWith('/api/redacao/correcao')) return null;
  const pessoa = await professora(request, env, sessaoAtual);
  const ano = Number(hojeSP(env).slice(0, 4));
  if (path === '/api/redacao/correcao/turmas' && request.method === 'GET') {
    return { ok: true, ano, turmas: await turmasComLotes(env, pessoa, ano), motivos: { zero: MOTIVOS_ZERO, c5: MOTIVOS_C5, condenar: MOTIVOS_CONDENAR } };
  }
  const m = path.match(/^\/api\/redacao\/correcao\/lotes\/(\d+)(?:\/(pdf|paginas\/(\d+)))?$/);
  if (m) {
    const lote = await loteDaProfessora(env, inteiro(m[1], 1, 1000000000), pessoa);
    if (!m[2] && request.method === 'GET') {
      const lista = await folhas(env, lote);
      return { ok: true, professora: pessoa.nome, lote: { id: lote.id, bimestre: lote.bimestre, ano: lote.ano, unidade: lote.unidade, segmento: lote.segmento, serie: lote.serie, codigo: lote.codigo },
        folhas: lista, progresso: progresso(lista), motivos: { zero: MOTIVOS_ZERO, c5: MOTIVOS_C5, condenar: MOTIVOS_CONDENAR } };
    }
    if (m[2] === 'pdf' && request.method === 'GET') {
      if (!env.IMAGENS) erro(503, 'Armazenamento de PDFs indisponível.');
      const objeto = await env.IMAGENS.get(lote.r2_key);
      if (!objeto) erro(404, 'PDF indisponível. Avise o administrador.');
      return { __pdf: true, body: objeto.body, nome: lote.nome_arquivo };
    }
    if (m[3] && request.method === 'POST') return await salvar(env, lote, inteiro(m[3], 1, 400), await readJson(request), pessoa, registrar);
  }
  erro(404, 'Rota indisponível.');
}

/* ---------- ADM: páginas condenadas pela professora ---------- */
export async function condenadasDoLote(env, loteId) {
  return (await env.DB.prepare('SELECT pagina, condenada_motivo, observacao FROM redacao_correcoes WHERE lote_id = ? AND condenada = 1').bind(loteId).all()).results;
}
/* "Devolver à professora": apaga a condenação; a folha volta a ficar pendente. */
export async function devolverCondenada(env, loteId, pagina) {
  const r = await env.DB.prepare('DELETE FROM redacao_correcoes WHERE lote_id = ? AND pagina = ? AND condenada = 1').bind(loteId, pagina).run();
  if (!r.meta?.changes) erro(404, 'Esta página não está condenada.');
}
