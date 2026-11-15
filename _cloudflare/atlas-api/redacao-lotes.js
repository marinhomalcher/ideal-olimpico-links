// Recebimento dos PDFs da Redação. Leitura de cartões e correção virão depois.
import { RedacaoError } from './redacao-cadastros.js';
import { devolverCondenada } from './redacao-correcao.js';

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
    "WHERE u.id = ? AND u.ativo = 1 AND e.ativo = 1 AND e.digitalizador = 1"
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
    't.unidade, t.segmento, t.serie, t.codigo, u.nome AS digitalizador, ' +
    'p.total AS paginas, p.aluno AS paginas_aluno, p.avulsa AS paginas_avulsa, p.duvida AS paginas_duvida, p.descartada AS paginas_descartada, cc.condenadas AS paginas_condenada ' +
    'FROM redacao_lotes l JOIN redacao_turmas t ON t.id = l.turma_id ' +
    'JOIN usuarios u ON u.id = l.digitalizador_id ' +
    "LEFT JOIN (SELECT lote_id, COUNT(*) AS total, SUM(situacao = 'aluno') AS aluno, SUM(situacao = 'avulsa') AS avulsa, " +
    "SUM(situacao = 'duvida') AS duvida, SUM(situacao = 'descartada') AS descartada FROM redacao_paginas GROUP BY lote_id) p ON p.lote_id = l.id " +
    "LEFT JOIN (SELECT lote_id, COUNT(*) AS condenadas FROM redacao_correcoes WHERE condenada = 1 GROUP BY lote_id) cc ON cc.lote_id = l.id " +
    'WHERE l.ano = ?' + filtro +
    ' ORDER BY l.enviado_em DESC, l.id DESC'
  ).bind(ano, ...(unidades || [])).all()).results;
}

async function lotePorId(env, id) {
  return await env.DB.prepare(
    'SELECT l.*, t.unidade, t.codigo, t.ano AS turma_ano FROM redacao_lotes l JOIN redacao_turmas t ON t.id = l.turma_id WHERE l.id = ?'
  ).bind(id).first();
}

// Lê só o começo para validar a assinatura; o restante segue em fluxo para o R2.
async function corpoPdf(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf') {
    erro(415, 'Escolha um arquivo PDF.');
  }
  const tamanhoInformado = Number(request.headers.get('Content-Length') || 0);
  if (tamanhoInformado > MAX_PDF) erro(413, 'O PDF ultrapassa 50 MB.');
  /* O R2 só guarda um fluxo de tamanho conhecido; o navegador sempre informa o tamanho do arquivo. */
  if (!Number.isInteger(tamanhoInformado) || tamanhoInformado < 1) erro(411, 'Não foi possível saber o tamanho do PDF. Tente enviar de novo.');
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
  return { fluxo, informado: tamanhoInformado, tamanho: () => bytes, grandeDemais: () => grandeDemais };
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
    /* A Cloudflare recusa fluxo sem tamanho ("must have a known length"): passa pelo
       FixedLengthStream com o tamanho informado pelo navegador. */
    const fixo = new FixedLengthStream(pdf.informado);
    const copia = pdf.fluxo.pipeTo(fixo.writable);
    copia.catch(() => {});
    await env.IMAGENS.put(chave, fixo.readable, { httpMetadata: { contentType: 'application/pdf' } });
    await copia;
  } catch (error) {
    await env.IMAGENS.delete(chave).catch(() => {});
    if (pdf.grandeDemais()) erro(413, 'O PDF ultrapassa 50 MB.');
    if (pdf.tamanho() !== pdf.informado) erro(400, 'O envio do PDF foi interrompido. Tente de novo.');
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

/* ---------- índice por página (uma folha por aluno, só frente) ---------- */
/* Situação de cada RA em relação à turma do lote (consulta só leitura). */
async function situacaoRas(env, ras, ano) {
  const achados = new Map();
  for (let i = 0; i < ras.length; i += 80) {
    const parte = ras.slice(i, i + 80);
    if (!parte.length) continue;
    const linhas = (await env.DB.prepare(
      `SELECT a.ra, a.nome, a.turma_id, t.unidade, t.codigo FROM redacao_alunos a JOIN redacao_turmas t ON t.id = a.turma_id WHERE a.ano = ? AND a.ra IN (${parte.map(() => '?').join(',')})`
    ).bind(ano, ...parte).all()).results;
    for (const l of linhas) achados.set(l.ra, l);
  }
  return achados;
}

/* Recebe a leitura feita no navegador e decide no servidor a situação de cada página:
   sem código → avulsa (a professora escolhe o aluno); RA da turma → aluno;
   outra turma/unidade, fora do cadastro ou RA repetido → dúvida para o ADM. */
async function gravarPaginas(env, lote, body, quem, registrar, usuarioId) {
  if (lote.cancelado_em) erro(409, 'Este lote foi cancelado.');
  /* Depois que a professora começou a corrigir, o índice não pode ser refeito (as notas se perderiam). */
  if (await env.DB.prepare('SELECT 1 FROM redacao_correcoes WHERE lote_id = ? LIMIT 1').bind(lote.id).first()) {
    erro(409, 'Este lote já tem redações corrigidas pela professora; a leitura não pode ser refeita.');
  }
  const lista = Array.isArray(body?.paginas) ? body.paginas : null;
  if (!lista || !lista.length || lista.length > 400) erro(400, 'Leitura das páginas inválida.');
  const paginas = lista.map((p, i) => {
    const ra = p?.ra === null || p?.ra === undefined || p?.ra === '' ? null : String(p.ra).trim();
    const angulo = Number(p?.angulo ?? 0), marcadores = Number(p?.marcadores ?? 0);
    if (Number(p?.pagina) !== i + 1 || (ra !== null && !/^\d{1,15}$/.test(ra)) || !Number.isFinite(angulo) || Math.abs(angulo) > 45 ||
        !Number.isInteger(marcadores) || marcadores < 0 || marcadores > 4) erro(400, `Leitura da página ${i + 1} inválida.`);
    return { pagina: i + 1, ra, angulo: Math.round(angulo * 100) / 100, invertida: p?.invertida ? 1 : 0, marcadores };
  });
  const achados = await situacaoRas(env, [...new Set(paginas.map(p => p.ra).filter(Boolean))], lote.turma_ano);
  const vezes = {};
  for (const p of paginas) if (p.ra) vezes[p.ra] = (vezes[p.ra] || 0) + 1;
  for (const p of paginas) {
    const a = p.ra ? achados.get(p.ra) : null;
    p.aluno_ra = null; p.motivo = null;
    if (!p.ra) p.situacao = 'avulsa';
    else if (!a) { p.situacao = 'duvida'; p.motivo = 'fora_cadastro'; }
    else if (a.unidade !== lote.unidade) { p.situacao = 'duvida'; p.motivo = 'outra_unidade'; }
    else if (a.turma_id !== lote.turma_id) { p.situacao = 'duvida'; p.motivo = 'outra_turma'; }
    else if (vezes[p.ra] > 1) { p.situacao = 'duvida'; p.motivo = 'repetido'; }
    else { p.situacao = 'aluno'; p.aluno_ra = p.ra; }
  }
  const ops = [env.DB.prepare('DELETE FROM redacao_paginas WHERE lote_id = ?').bind(lote.id)];
  for (const p of paginas) ops.push(env.DB.prepare(
    'INSERT INTO redacao_paginas (lote_id, pagina, ra_lido, angulo, invertida, marcadores, situacao, motivo, aluno_ra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(lote.id, p.pagina, p.ra, p.angulo, p.invertida, p.marcadores, p.situacao, p.motivo, p.aluno_ra));
  await env.DB.batch(ops);
  const resumo = resumoPaginas(paginas);
  await registrar(env, 'redacao_paginas_gravadas', { lote_id: lote.id, por: quem, ...resumo }, usuarioId);
  return { ok: true, resumo };
}
function resumoPaginas(paginas) {
  const r = { paginas: paginas.length, aluno: 0, avulsa: 0, duvida: 0, descartada: 0 };
  for (const p of paginas) r[p.situacao]++;
  return r;
}
async function paginasDoLote(env, lote) {
  const paginas = (await env.DB.prepare(
    'SELECT p.pagina, p.ra_lido, p.angulo, p.invertida, p.marcadores, p.situacao, p.motivo, p.aluno_ra, p.resolvido_por, p.resolvido_em, a.nome AS aluno_nome, ' +
    'l.nome AS lido_nome, tl.codigo AS lido_turma, tl.unidade AS lido_unidade, ' +
    'c.condenada, c.condenada_motivo, c.observacao AS condenada_obs, CASE WHEN c.enviada_em IS NOT NULL AND c.condenada = 0 THEN 1 ELSE 0 END AS corrigida ' +
    'FROM redacao_paginas p LEFT JOIN redacao_alunos a ON a.ra = p.aluno_ra ' +
    'LEFT JOIN redacao_correcoes c ON c.lote_id = p.lote_id AND c.pagina = p.pagina ' +
    'LEFT JOIN redacao_alunos l ON l.ra = p.ra_lido LEFT JOIN redacao_turmas tl ON tl.id = l.turma_id ' +
    'WHERE p.lote_id = ? ORDER BY p.pagina'
  ).bind(lote.id).all()).results;
  const alunos = (await env.DB.prepare(
    'SELECT ra, nome FROM redacao_alunos WHERE turma_id = ? ORDER BY nome COLLATE NOCASE'
  ).bind(lote.turma_id).all()).results;
  const resumo = resumoPaginas(paginas);
  resumo.condenada = paginas.filter(p => p.condenada).length;
  resumo.corrigida = paginas.filter(p => p.corrigida).length;
  return { ok: true, lote: { id: lote.id, codigo: lote.codigo, unidade: lote.unidade, bimestre: lote.bimestre, nome_arquivo: lote.nome_arquivo, cancelado: !!lote.cancelado_em }, paginas, alunos, resumo };
}
/* Decisão do ADM numa página: atribuir a um aluno do cadastro ou descartar. */
async function resolverPagina(env, lote, n, body, sessao, registrar) {
  if (lote.cancelado_em) erro(409, 'Este lote foi cancelado.');
  const p = await env.DB.prepare('SELECT * FROM redacao_paginas WHERE lote_id = ? AND pagina = ?').bind(lote.id, n).first();
  if (!p) erro(404, 'Página não encontrada.');
  const horario = agora(), quem = sessao.email || 'adm';
  /* Folha já corrigida não muda aqui; condenada pela professora pode ser devolvida, trocada ou descartada. */
  const corr = await env.DB.prepare('SELECT condenada FROM redacao_correcoes WHERE lote_id = ? AND pagina = ?').bind(lote.id, n).first();
  if (corr && !corr.condenada) erro(409, 'Esta folha já foi corrigida pela professora e não pode ser alterada aqui.');
  if (body?.acao === 'devolver') {
    await devolverCondenada(env, lote.id, n);
    await registrar(env, 'redacao_condenada_devolvida', { lote_id: lote.id, pagina: n, adm: quem });
    return await paginasDoLote(env, lote);
  }
  if (body?.acao === 'descartar') {
    if (corr) await devolverCondenada(env, lote.id, n);
    await env.DB.prepare("UPDATE redacao_paginas SET situacao = 'descartada', aluno_ra = NULL, resolvido_por = ?, resolvido_em = ? WHERE lote_id = ? AND pagina = ?")
      .bind(quem, horario, lote.id, n).run();
  } else if (body?.acao === 'atribuir') {
    const ra = String(body.ra ?? '').trim();
    if (!/^\d{1,15}$/.test(ra)) erro(400, 'Informe o RA do aluno.');
    const aluno = await env.DB.prepare('SELECT ra, nome FROM redacao_alunos WHERE ra = ? AND ano = ?').bind(ra, lote.turma_ano).first();
    if (!aluno) erro(404, 'RA não encontrado no cadastro de alunos.');
    const ocupada = await env.DB.prepare("SELECT pagina FROM redacao_paginas WHERE lote_id = ? AND aluno_ra = ? AND situacao = 'aluno' AND pagina <> ?").bind(lote.id, ra, n).first();
    if (ocupada) erro(409, `Este aluno já está na página ${ocupada.pagina} deste lote. Descarte ou corrija aquela página antes.`);
    if (corr) await devolverCondenada(env, lote.id, n);
    await env.DB.prepare("UPDATE redacao_paginas SET situacao = 'aluno', aluno_ra = ?, resolvido_por = ?, resolvido_em = ? WHERE lote_id = ? AND pagina = ?")
      .bind(ra, quem, horario, lote.id, n).run();
  } else erro(400, 'Ação inválida.');
  await registrar(env, 'redacao_pagina_resolvida', { lote_id: lote.id, pagina: n, acao: body.acao, ra: body.ra ?? null, adm: quem });
  return await paginasDoLote(env, lote);
}

/* Antes do envio: de que turma é cada RA lido nas folhas? Só leitura, nada é gravado.
   Nome e turma só aparecem para alunos das unidades do digitalizador. */
async function conferirRas(env, body, pessoa, ano) {
  const turmaId = numero(body?.turma_id, 1, 1000000000);
  const turma = await env.DB.prepare('SELECT id, unidade, codigo FROM redacao_turmas WHERE id = ? AND ano = ? AND ativa = 1').bind(turmaId, ano).first();
  if (!turma || !pessoa.unidades.includes(turma.unidade)) erro(404, 'Turma não encontrada.');
  const ras = [...new Set((Array.isArray(body.ras) ? body.ras : []).map(r => String(r ?? '').trim()))];
  if (ras.length > 300 || ras.some(r => !/^\d{1,15}$/.test(r))) erro(400, 'Lista de RAs inválida.');
  const cadastrados = (await env.DB.prepare('SELECT COUNT(*) AS n FROM redacao_alunos WHERE ano = ?').bind(ano).first()).n;
  const achados = new Map();
  for (let i = 0; i < ras.length; i += 80) {
    const parte = ras.slice(i, i + 80);
    const linhas = (await env.DB.prepare(
      `SELECT a.ra, a.nome, a.turma_id, t.unidade, t.codigo FROM redacao_alunos a JOIN redacao_turmas t ON t.id = a.turma_id WHERE a.ano = ? AND a.ra IN (${parte.map(() => '?').join(',')})`
    ).bind(ano, ...parte).all()).results;
    for (const l of linhas) achados.set(l.ra, l);
  }
  const alunos = ras.map(ra => {
    const a = achados.get(ra);
    if (!a) return { ra, situacao: 'fora_cadastro' };
    if (!pessoa.unidades.includes(a.unidade)) return { ra, situacao: 'outra_unidade', unidade: a.unidade };
    return { ra, nome: a.nome, codigo: a.codigo, unidade: a.unidade, situacao: a.turma_id === turma.id ? 'turma' : 'outra_turma' };
  });
  return { ok: true, turma: turma.codigo, cadastro_vazio: cadastrados === 0, alunos };
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

export async function rotaLotesUsuario(request, env, path, { sessaoAtual, hojeSP, registrar, readJson }) {
  if (!path.startsWith('/api/redacao/lotes')) return null;
  const pessoa = await digitalizador(request, env, sessaoAtual);
  const ano = anoAtual(hojeSP, env);
  if (path === '/api/redacao/lotes' && request.method === 'GET') {
    return { ok: true, ano, turmas: await turmasPermitidas(env, ano, pessoa.unidades), lotes: await lotes(env, ano, pessoa.unidades) };
  }
  if (path === '/api/redacao/lotes' && request.method === 'POST') return await enviar(request, env, new URL(request.url), pessoa, hojeSP, registrar);
  if (path === '/api/redacao/lotes/conferir' && request.method === 'POST') return await conferirRas(env, await readJson(request), pessoa, ano);
  const mp = path.match(/^\/api\/redacao\/lotes\/(\d+)\/paginas$/);
  if (mp && request.method === 'POST') {
    const lote = await lotePorId(env, numero(mp[1], 1, 1000000000));
    if (!lote || !pessoa.unidades.includes(lote.unidade) || lote.digitalizador_id !== pessoa.id) erro(404, 'Lote não encontrado.');
    if (agora() > lote.cancelavel_ate) erro(403, 'O prazo de 2 horas terminou. Peça ao ADM para refazer a leitura.');
    return await gravarPaginas(env, lote, await readJson(request), pessoa.email || pessoa.nome, registrar, pessoa.id);
  }
  const m = path.match(/^\/api\/redacao\/lotes\/(\d+)(\/pdf)?$/);
  if (m) {
    const lote = await lotePorId(env, numero(m[1], 1, 1000000000));
    if (!lote || !pessoa.unidades.includes(lote.unidade)) erro(404, 'Lote não encontrado.');
    if (m[2] && request.method === 'GET' && !lote.cancelado_em) return await pdfDoLote(env, lote);
    if (!m[2] && request.method === 'DELETE') return await cancelar(env, lote, pessoa, registrar);
  }
  erro(404, 'Rota indisponível.');
}

export async function rotaLotesAdm(request, env, path, { hojeSP, registrar, sessao, readJson }) {
  if (!path.startsWith('/api/adm/redacao/lotes')) return null;
  const ano = anoAtual(hojeSP, env);
  if (path === '/api/adm/redacao/lotes' && request.method === 'GET') return { ok: true, ano, lotes: await lotes(env, ano) };
  const mp = path.match(/^\/api\/adm\/redacao\/lotes\/(\d+)\/paginas(?:\/(\d+))?$/);
  if (mp) {
    const lote = await lotePorId(env, numero(mp[1], 1, 1000000000));
    if (!lote) erro(404, 'Lote não encontrado.');
    if (!mp[2] && request.method === 'GET') return await paginasDoLote(env, lote);
    if (!mp[2] && request.method === 'POST') { await gravarPaginas(env, lote, await readJson(request), sessao.email || 'adm', registrar, null); return await paginasDoLote(env, lote); }
    if (mp[2] && request.method === 'POST') return await resolverPagina(env, lote, numero(mp[2], 1, 400), await readJson(request), sessao, registrar);
  }
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
