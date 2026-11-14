// Recebimento dos PDFs da Redação. Leitura de cartões e correção virão depois.
import { RedacaoError } from './redacao-cadastros.js';

const MAX_PDF = 50 * 1024 * 1024;
const HORAS_CANCELAMENTO = 2;
const erro = (status, mensagem) => { throw new RedacaoError(status, mensagem); };
const numero = (valor, min, max) => {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) erro(400, 'Número inválido.');
  return n;
};
const agora = () => new Date().toISOString();
const anoAtual = (hojeSP, env) => Number(hojeSP(env).slice(0, 4));

async function digitalizador(request, env, sessaoAtual) {
  const sessao = await sessaoAtual(request, env, 'usuario');
  const pessoa = await env.DB.prepare(
    "SELECT u.id, u.nome, u.email FROM usuarios u JOIN redacao_equipe e ON e.usuario_id = u.id " +
    "WHERE u.id = ? AND u.ativo = 1 AND e.ativo = 1 AND e.funcao = 'digitalizador'"
  ).bind(sessao.usuario_id).first();
  if (!pessoa) erro(403, 'Apenas digitalizadores ativos podem receber lotes.');
  const unidades = (await env.DB.prepare(
    'SELECT unidade FROM redacao_digitalizador_unidades WHERE usuario_id = ? ORDER BY unidade'
  ).bind(pessoa.id).all()).results.map(r => r.unidade);
  return { ...pessoa, unidades };
}

async function turmasPermitidas(env, ano, unidades) {
  if (!unidades.length) return [];
  const marcas = unidades.map(() => '?').join(',');
  return (await env.DB.prepare(
    `SELECT id, ano, unidade, segmento, serie, codigo FROM redacao_turmas WHERE ano = ? AND ativa = 1 AND unidade IN (${marcas}) ORDER BY unidade, segmento, serie, codigo`
  ).bind(ano, ...unidades).all()).results;
}

async function lotes(env, ano, unidades = null) {
  if (unidades && !unidades.length) return [];
  const filtro = unidades ? ` AND t.unidade IN (${unidades.map(() => '?').join(',')})` : '';
  return (await env.DB.prepare(
    'SELECT l.id, l.ano, l.bimestre, l.turma_id, l.digitalizador_id, l.nome_arquivo, l.bytes, ' +
    'l.enviado_em, l.cancelavel_ate, l.cancelado_em, l.cancelado_por, l.arquivo_excluido_em, ' +
    't.unidade, t.segmento, t.serie, t.codigo, u.nome AS digitalizador ' +
    'FROM redacao_lotes l JOIN redacao_turmas t ON t.id = l.turma_id ' +
    'JOIN usuarios u ON u.id = l.digitalizador_id WHERE l.ano = ?' + filtro +
    ' ORDER BY l.enviado_em DESC, l.id DESC'
  ).bind(ano, ...(unidades || [])).all()).results;
}

async function lotePorId(env, id) {
  return await env.DB.prepare(
    'SELECT l.*, t.unidade, t.codigo FROM redacao_lotes l JOIN redacao_turmas t ON t.id = l.turma_id WHERE l.id = ?'
  ).bind(id).first();
}

// Lê só o começo para validar a assinatura; o restante segue em fluxo para o R2.
async function corpoPdf(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf') {
    erro(415, 'Escolha um arquivo PDF.');
  }
  const tamanhoInformado = Number(request.headers.get('Content-Length') || 0);
  if (tamanhoInformado > MAX_PDF) erro(413, 'O PDF ultrapassa 50 MB.');
  if (!request.body) erro(400, 'O PDF está vazio.');
  const leitor = request.body.getReader();
  const iniciais = [];
  const assinatura = new Uint8Array(5);
  let assinaturaLida = 0, bytes = 0, grandeDemais = false;
  while (assinaturaLida < 5) {
    const { value, done } = await leitor.read();
    if (done) erro(400, 'O PDF está vazio ou incompleto.');
    const pedaco = value instanceof Uint8Array ? value : new Uint8Array(value);
    bytes += pedaco.byteLength;
    if (bytes > MAX_PDF) erro(413, 'O PDF ultrapassa 50 MB.');
    iniciais.push(pedaco);
    const n = Math.min(5 - assinaturaLida, pedaco.byteLength);
    assinatura.set(pedaco.subarray(0, n), assinaturaLida);
    assinaturaLida += n;
  }
  if (String.fromCharCode(...assinatura) !== '%PDF-') {
    await leitor.cancel();
    erro(415, 'O arquivo não é um PDF válido.');
  }
  const fluxo = new ReadableStream({
    async pull(controlador) {
      if (iniciais.length) { controlador.enqueue(iniciais.shift()); return; }
      const { value, done } = await leitor.read();
      if (done) { controlador.close(); return; }
      bytes += value.byteLength;
      if (bytes > MAX_PDF) {
        grandeDemais = true;
        controlador.error(new Error('PDF maior que 50 MB.'));
        await leitor.cancel();
        return;
      }
      controlador.enqueue(value);
    },
    cancel(motivo) { return leitor.cancel(motivo); }
  });
  return { fluxo, tamanho: () => bytes, grandeDemais: () => grandeDemais };
}

async function enviar(request, env, url, pessoa, hojeSP, registrar) {
  if (!env.IMAGENS) erro(503, 'Armazenamento de PDFs indisponível.');
  const ano = anoAtual(hojeSP, env);
  const bimestre = numero(url.searchParams.get('bimestre'), 1, 4);
  const turmaId = numero(url.searchParams.get('turma_id'), 1, 1000000000);
  const turma = await env.DB.prepare(
    'SELECT id, unidade, codigo FROM redacao_turmas WHERE id = ? AND ano = ? AND ativa = 1'
  ).bind(turmaId, ano).first();
  if (!turma) erro(404, 'Turma não encontrada no ano atual.');
  if (!pessoa.unidades.includes(turma.unidade)) erro(403, 'Esta unidade não está vinculada ao seu cadastro.');
  const ocupado = await env.DB.prepare(
    'SELECT id FROM redacao_lotes WHERE ano = ? AND bimestre = ? AND turma_id = ? AND cancelado_em IS NULL'
  ).bind(ano, bimestre, turmaId).first();
  if (ocupado) erro(409, 'Já existe um lote para esta turma e bimestre.');
  const pdf = await corpoPdf(request);
  const chave = `redacao/${ano}/b${bimestre}/turma-${turmaId}/${crypto.randomUUID()}.pdf`;
  try {
    await env.IMAGENS.put(chave, pdf.fluxo, { httpMetadata: { contentType: 'application/pdf' } });
  } catch (error) {
    if (pdf.grandeDemais()) erro(413, 'O PDF ultrapassa 50 MB.');
    throw error;
  }
  const enviadoEm = agora();
  const cancelaAte = new Date(Date.now() + HORAS_CANCELAMENTO * 3600000).toISOString();
  const nome = `${turma.codigo}-${turma.unidade}-${bimestre}b.pdf`;
  let resultado;
  try {
    resultado = await env.DB.prepare(
      'INSERT INTO redacao_lotes (ano, bimestre, turma_id, digitalizador_id, r2_key, nome_arquivo, bytes, enviado_em, cancelavel_ate) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(ano, bimestre, turmaId, pessoa.id, chave, nome, pdf.tamanho(), enviadoEm, cancelaAte).run();
  } catch (error) {
    await env.IMAGENS.delete(chave).catch(() => {});
    const duplicado = await env.DB.prepare(
      'SELECT id FROM redacao_lotes WHERE ano = ? AND bimestre = ? AND turma_id = ? AND cancelado_em IS NULL'
    ).bind(ano, bimestre, turmaId).first();
    if (duplicado) erro(409, 'Outro lote já ocupou esta turma e bimestre.');
    throw error;
  }
  await registrar(env, 'redacao_lote_enviado', {
    lote_id: resultado.meta.last_row_id, ano, bimestre, turma_id: turmaId, digitalizador_id: pessoa.id, bytes: pdf.tamanho()
  }, pessoa.id);
  return { ok: true, lote_id: resultado.meta.last_row_id, cancelavel_ate: cancelaAte };
}

async function pdfDoLote(env, lote) {
  if (!env.IMAGENS) erro(503, 'Armazenamento de PDFs indisponível.');
  const objeto = await env.IMAGENS.get(lote.r2_key);
  if (!objeto) erro(404, 'PDF indisponível. Avise o administrador.');
  return { __pdf: true, body: objeto.body, nome: lote.nome_arquivo };
}

async function cancelar(env, lote, pessoa, registrar, adm = false) {
  if (lote.cancelado_em) erro(409, 'Este lote já foi cancelado.');
  if (!adm && (lote.digitalizador_id !== pessoa.id || agora() > lote.cancelavel_ate)) {
    erro(403, 'O prazo de 2 horas terminou. Procure o administrador.');
  }
  const horario = agora();
  const r = await env.DB.prepare(
    'UPDATE redacao_lotes SET cancelado_em = ?, cancelado_por = ? WHERE id = ? AND cancelado_em IS NULL RETURNING id'
  ).bind(horario, pessoa.email || pessoa.nome, lote.id).first();
  if (!r) erro(409, 'Este lote já foi cancelado.');
  let arquivoExcluido = false;
  try {
    await env.IMAGENS.delete(lote.r2_key);
    await env.DB.prepare('UPDATE redacao_lotes SET arquivo_excluido_em = ? WHERE id = ?').bind(agora(), lote.id).run();
    arquivoExcluido = true;
  } catch (error) {
    console.error('ATLAS: limpeza do PDF cancelado pendente:', lote.id, error?.message);
  }
  await registrar(env, 'redacao_lote_cancelado', { lote_id: lote.id, por: pessoa.email || pessoa.nome, arquivo_excluido: arquivoExcluido }, adm ? null : pessoa.id);
  return { ok: true, cancelado: true, arquivo_excluido: arquivoExcluido };
}

export async function rotaLotesUsuario(request, env, path, { sessaoAtual, hojeSP, registrar }) {
  if (!path.startsWith('/api/redacao/lotes')) return null;
  const pessoa = await digitalizador(request, env, sessaoAtual);
  const ano = anoAtual(hojeSP, env);
  if (path === '/api/redacao/lotes' && request.method === 'GET') {
    return { ok: true, ano, turmas: await turmasPermitidas(env, ano, pessoa.unidades), lotes: await lotes(env, ano, pessoa.unidades) };
  }
  if (path === '/api/redacao/lotes' && request.method === 'POST') return await enviar(request, env, new URL(request.url), pessoa, hojeSP, registrar);
  const m = path.match(/^\/api\/redacao\/lotes\/(\d+)(\/pdf)?$/);
  if (m) {
    const lote = await lotePorId(env, numero(m[1], 1, 1000000000));
    if (!lote || !pessoa.unidades.includes(lote.unidade)) erro(404, 'Lote não encontrado.');
    if (m[2] && request.method === 'GET' && !lote.cancelado_em) return await pdfDoLote(env, lote);
    if (!m[2] && request.method === 'DELETE') return await cancelar(env, lote, pessoa, registrar);
  }
  erro(404, 'Rota indisponível.');
}

export async function rotaLotesAdm(request, env, path, { hojeSP, registrar, sessao }) {
  if (!path.startsWith('/api/adm/redacao/lotes')) return null;
  const ano = anoAtual(hojeSP, env);
  if (path === '/api/adm/redacao/lotes' && request.method === 'GET') return { ok: true, ano, lotes: await lotes(env, ano) };
  const m = path.match(/^\/api\/adm\/redacao\/lotes\/(\d+)(\/pdf)?$/);
  if (m) {
    const lote = await lotePorId(env, numero(m[1], 1, 1000000000));
    if (!lote) erro(404, 'Lote não encontrado.');
    if (m[2] && request.method === 'GET' && !lote.cancelado_em) return await pdfDoLote(env, lote);
    if (!m[2] && request.method === 'DELETE') return await cancelar(env, lote, sessao, registrar, true);
  }
  erro(404, 'Rota indisponível.');
}

export async function limparPdfCancelados(env) {
  if (!env.IMAGENS) return;
  const pendentes = (await env.DB.prepare(
    'SELECT id, r2_key FROM redacao_lotes WHERE cancelado_em IS NOT NULL AND arquivo_excluido_em IS NULL ORDER BY id LIMIT 100'
  ).all()).results;
  for (const lote of pendentes) {
    try {
      await env.IMAGENS.delete(lote.r2_key);
      await env.DB.prepare('UPDATE redacao_lotes SET arquivo_excluido_em = ? WHERE id = ?').bind(agora(), lote.id).run();
    } catch (error) { console.error('ATLAS: PDF cancelado ainda não excluído:', lote.id, error?.message); }
  }
}
