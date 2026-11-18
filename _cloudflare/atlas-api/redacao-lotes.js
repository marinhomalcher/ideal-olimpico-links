// Recebimento dos PDFs da Redação. Desde 17/11/2026 (v17): o digitalizador escolhe só bimestre e unidade;
// o navegador lê o RA de cada folha, separa as páginas por turma e cada turma recebe as suas no lote dela
// (um lote por turma e bimestre). Folhas que chegam depois entram no fim do mesmo lote.
import { RedacaoError } from './redacao-cadastros.js';
import { devolverCondenada } from './redacao-correcao.js';

const MAX_PDF = 50 * 1024 * 1024;
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

async function guardarPdf(env, request, chave) {
  const pdf = await corpoPdf(request);
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
  return pdf.tamanho();
}

async function envioDoDigitalizador(env, id, pessoa) {
  if (!/^[0-9a-f-]{36}$/.test(String(id || ''))) erro(400, 'Envio inválido.');
  const envio = await env.DB.prepare('SELECT * FROM redacao_envios WHERE id = ?').bind(id).first();
  if (!envio || envio.digitalizador_id !== pessoa.id) erro(404, 'Envio não encontrado.');
  if (envio.desfeito_em) erro(409, 'Este envio foi desfeito.');
  return envio;
}

/* Começa um envio: bimestre e unidade escolhidos pelo digitalizador. */
async function novoEnvio(env, body, pessoa, ano, registrar) {
  const bimestre = numero(body?.bimestre, 1, 4);
  const unidade = String(body?.unidade || '');
  if (!pessoa.unidades.includes(unidade)) erro(403, 'Esta unidade não está vinculada ao seu cadastro.');
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO redacao_envios (id, ano, bimestre, unidade, digitalizador_id, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, ano, bimestre, unidade, pessoa.id, agora()).run();
  await registrar(env, 'redacao_envio_iniciado', { envio_id: id, ano, bimestre, unidade }, pessoa.id);
  return { ok: true, envio_id: id };
}

/* Lote novo de uma turma (as páginas dela, separadas no navegador). A turma pode ser de outra
   unidade: aluno que mudou de unidade segue para a turma onde está no cadastro. */
async function enviar(request, env, url, pessoa, hojeSP, registrar) {
  if (!env.IMAGENS) erro(503, 'Armazenamento de PDFs indisponível.');
  const ano = anoAtual(hojeSP, env);
  const envio = await envioDoDigitalizador(env, url.searchParams.get('envio'), pessoa);
  const turmaId = numero(url.searchParams.get('turma_id'), 1, 1000000000);
  const paginas = numero(url.searchParams.get('paginas'), 1, 400);
  const turma = await env.DB.prepare(
    'SELECT id, unidade, codigo FROM redacao_turmas WHERE id = ? AND ano = ? AND ativa = 1'
  ).bind(turmaId, ano).first();
  if (!turma) erro(404, 'Turma não encontrada no ano atual.');
  const ocupado = await env.DB.prepare(
    'SELECT id FROM redacao_lotes WHERE ano = ? AND bimestre = ? AND turma_id = ? AND cancelado_em IS NULL'
  ).bind(ano, envio.bimestre, turmaId).first();
  if (ocupado) erro(409, 'Esta turma já tem lote neste bimestre: as folhas entram no fim dele.');
  const chave = `redacao/${ano}/b${envio.bimestre}/turma-${turmaId}/${crypto.randomUUID()}.pdf`;
  const bytes = await guardarPdf(env, request, chave);
  const enviadoEm = agora();
  const nome = `${turma.codigo}-${turma.unidade}-${envio.bimestre}b.pdf`;
  let resultado;
  try {
    resultado = await env.DB.prepare(
      'INSERT INTO redacao_lotes (ano, bimestre, turma_id, digitalizador_id, r2_key, nome_arquivo, bytes, enviado_em, cancelavel_ate, paginas_arquivo) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(ano, envio.bimestre, turmaId, pessoa.id, chave, nome, bytes, enviadoEm, enviadoEm, paginas).run();
  } catch (error) {
    await env.IMAGENS.delete(chave).catch(() => {});
    const duplicado = await env.DB.prepare(
      'SELECT id FROM redacao_lotes WHERE ano = ? AND bimestre = ? AND turma_id = ? AND cancelado_em IS NULL'
    ).bind(ano, envio.bimestre, turmaId).first();
    if (duplicado) erro(409, 'Outro envio ocupou esta turma e bimestre agora há pouco. Tente de novo.');
    throw error;
  }
  await registrar(env, 'redacao_lote_enviado', {
    lote_id: resultado.meta.last_row_id, envio_id: envio.id, ano, bimestre: envio.bimestre, turma_id: turmaId, digitalizador_id: pessoa.id, bytes, paginas
  }, pessoa.id);
  return { ok: true, lote_id: resultado.meta.last_row_id };
}

/* Páginas que o PDF guardado do lote já tem (lotes antigos: maior página do índice). */
async function paginasNoArquivo(env, lote) {
  if (Number.isInteger(lote.paginas_arquivo)) return lote.paginas_arquivo;
  const r = await env.DB.prepare('SELECT MAX(pagina) AS n FROM redacao_paginas WHERE lote_id = ?').bind(lote.id).first();
  return r?.n || 0;
}

/* Turma que já tem lote no bimestre: o navegador junta o PDF guardado com as folhas novas (no fim)
   e manda o arquivo inteiro. As páginas que já existiam mantêm o número (e as correções). */
async function substituirArquivo(request, env, url, lote, pessoa, registrar) {
  if (!env.IMAGENS) erro(503, 'Armazenamento de PDFs indisponível.');
  if (lote.cancelado_em) erro(409, 'Este lote foi cancelado.');
  const envio = await envioDoDigitalizador(env, url.searchParams.get('envio'), pessoa);
  if (envio.bimestre !== lote.bimestre || envio.ano !== lote.ano) erro(400, 'O lote é de outro bimestre.');
  const antes = numero(url.searchParams.get('antes'), 0, 400);
  const depois = numero(url.searchParams.get('paginas'), 1, 400);
  if (antes !== await paginasNoArquivo(env, lote)) erro(409, 'O lote mudou enquanto você enviava. Confira e envie de novo.');
  if (depois <= antes) erro(400, 'O PDF novo precisa ter as folhas acrescentadas.');
  const chave = `redacao/${lote.ano}/b${lote.bimestre}/turma-${lote.turma_id}/${crypto.randomUUID()}.pdf`;
  const bytes = await guardarPdf(env, request, chave);
  const r = await env.DB.prepare(
    'UPDATE redacao_lotes SET r2_key = ?, bytes = ?, paginas_arquivo = ? WHERE id = ? AND cancelado_em IS NULL AND r2_key = ? RETURNING id'
  ).bind(chave, bytes, depois, lote.id, lote.r2_key).first();
  if (!r) { await env.IMAGENS.delete(chave).catch(() => {}); erro(409, 'O lote mudou enquanto você enviava. Confira e envie de novo.'); }
  await env.IMAGENS.delete(lote.r2_key).catch(() => {});
  await registrar(env, 'redacao_lote_acrescentado', { lote_id: lote.id, envio_id: envio.id, antes, depois, bytes }, pessoa.id);
  return { ok: true, lote_id: lote.id, paginas: depois };
}

/* Índice das folhas novas de um envio, decidido pelo digitalizador na tela:
   aluno (RA lido ou escolhido na lista da turma), descartada, ou para o ADM (fora do cadastro,
   folha avulsa ou RA repetido que ele não soube resolver). O servidor confere tudo de novo. */
async function acrescentarPaginas(env, lote, body, pessoa, registrar) {
  if (lote.cancelado_em) erro(409, 'Este lote foi cancelado.');
  const envio = await envioDoDigitalizador(env, body?.envio_id, pessoa);
  if (envio.bimestre !== lote.bimestre || envio.ano !== lote.ano) erro(400, 'O lote é de outro bimestre.');
  const lista = Array.isArray(body?.paginas) ? body.paginas : null;
  if (!lista || !lista.length || lista.length > 400) erro(400, 'Leitura das páginas inválida.');
  const noArquivo = await paginasNoArquivo(env, lote);
  const ultima = (await env.DB.prepare('SELECT MAX(pagina) AS n FROM redacao_paginas WHERE lote_id = ?').bind(lote.id).first())?.n || 0;
  const presentes = new Set((await env.DB.prepare("SELECT aluno_ra FROM redacao_paginas WHERE lote_id = ? AND situacao = 'aluno'").bind(lote.id).all()).results.map(r => r.aluno_ra));
  const horario = agora(), quem = pessoa.email || pessoa.nome, vistos = new Set();
  const paginas = lista.map((p, i) => {
    const pagina = Number(p?.pagina), lido = p?.ra_lido ? String(p.ra_lido).trim() : null, escolhido = p?.aluno_ra ? String(p.aluno_ra).trim() : null;
    const angulo = Number(p?.angulo ?? 0), marcadores = Number(p?.marcadores ?? 0), destino = p?.destino;
    /* Em sequência, depois da última página já indexada e dentro do PDF guardado (que já tem as folhas novas). */
    if (!Number.isInteger(pagina) || (i === 0 ? pagina <= ultima : pagina !== Number(lista[i - 1]?.pagina) + 1) || pagina > noArquivo) erro(400, `Página ${i + 1} fora da ordem do arquivo.`);
    if ((lido !== null && !/^\d{1,15}$/.test(lido)) || (escolhido !== null && !/^\d{1,15}$/.test(escolhido)) || !Number.isFinite(angulo) || Math.abs(angulo) > 45 ||
        !Number.isInteger(marcadores) || marcadores < 0 || marcadores > 4 || !['aluno', 'adm', 'descartar'].includes(destino)) erro(400, `Leitura da página ${pagina} inválida.`);
    return { pagina, lido, escolhido, angulo: Math.round(angulo * 100) / 100, invertida: p?.invertida ? 1 : 0, marcadores, destino };
  });
  const alunosTurma = new Map((await env.DB.prepare('SELECT ra, nome FROM redacao_alunos WHERE turma_id = ? AND ano = ?').bind(lote.turma_id, lote.ano).all()).results.map(a => [a.ra, a]));
  const cadastro = await situacaoRas(env, [...new Set(paginas.map(p => p.lido).filter(Boolean))], lote.ano);
  for (const p of paginas) {
    p.situacao = 'avulsa'; p.motivo = null; p.aluno_ra = null; p.resolvido = null;
    if (p.destino === 'descartar') { p.situacao = 'descartada'; p.resolvido = quem; continue; }
    if (p.destino === 'aluno') {
      const ra = p.escolhido || p.lido;
      if (!ra || !alunosTurma.has(ra)) erro(400, `Página ${p.pagina}: o aluno não é desta turma.`);
      if (presentes.has(ra) || vistos.has(ra)) erro(409, `Página ${p.pagina}: este aluno já tem folha neste lote.`);
      vistos.add(ra); p.situacao = 'aluno'; p.aluno_ra = ra;
      if (ra !== p.lido) p.resolvido = quem;
      continue;
    }
    /* destino ADM */
    if (p.lido && !cadastro.has(p.lido)) { p.situacao = 'duvida'; p.motivo = 'fora_cadastro'; }
    else if (p.lido) { p.situacao = 'duvida'; p.motivo = 'repetido'; }
  }
  const ops = paginas.map(p => env.DB.prepare(
    'INSERT INTO redacao_paginas (lote_id, pagina, ra_lido, angulo, invertida, marcadores, situacao, motivo, aluno_ra, resolvido_por, resolvido_em, envio_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(lote.id, p.pagina, p.lido, p.angulo, p.invertida, p.marcadores, p.situacao, p.motivo, p.aluno_ra, p.resolvido, p.resolvido ? horario : null, envio.id));
  await env.DB.batch(ops);
  const resumo = resumoPaginas(paginas);
  await registrar(env, 'redacao_paginas_acrescentadas', { lote_id: lote.id, envio_id: envio.id, de: paginas[0].pagina, ate: paginas.at(-1).pagina, ...resumo }, pessoa.id);
  return { ok: true, resumo };
}

/* Desfaz um envio inteiro enquanto nenhuma professora começou a corrigir aquelas folhas.
   Lote criado só com folhas deste envio é cancelado; nos outros, as folhas acrescentadas saem do índice. */
async function desfazerEnvio(env, id, pessoa, registrar) {
  const envio = await envioDoDigitalizador(env, id, pessoa);
  const corrigida = await env.DB.prepare(
    'SELECT 1 FROM redacao_paginas p JOIN redacao_correcoes c ON c.lote_id = p.lote_id AND c.pagina = p.pagina WHERE p.envio_id = ? LIMIT 1'
  ).bind(envio.id).first();
  if (corrigida) erro(409, 'Uma professora já começou a corrigir estas folhas. Para desfazer, procure o ADM.');
  const lotesDoEnvio = (await env.DB.prepare(
    'SELECT DISTINCT p.lote_id, (SELECT COUNT(*) FROM redacao_paginas q WHERE q.lote_id = p.lote_id AND (q.envio_id IS NULL OR q.envio_id <> ?)) AS outras ' +
    'FROM redacao_paginas p WHERE p.envio_id = ?'
  ).bind(envio.id, envio.id).all()).results;
  let cancelados = 0, retiradas = 0;
  for (const l of lotesDoEnvio) {
    if (!l.outras) {
      const lote = await lotePorId(env, l.lote_id);
      if (lote && !lote.cancelado_em) { await cancelar(env, lote, pessoa, registrar, true); cancelados++; }
    } else {
      const r = await env.DB.prepare('DELETE FROM redacao_paginas WHERE lote_id = ? AND envio_id = ?').bind(l.lote_id, envio.id).run();
      retiradas += r.meta?.changes || 0;
    }
  }
  await env.DB.prepare('UPDATE redacao_envios SET desfeito_em = ?, desfeito_por = ? WHERE id = ?').bind(agora(), pessoa.email || pessoa.nome, envio.id).run();
  await registrar(env, 'redacao_envio_desfeito', { envio_id: envio.id, lotes_cancelados: cancelados, folhas_retiradas: retiradas }, pessoa.id);
  return { ok: true, lotes_cancelados: cancelados, folhas_retiradas: retiradas };
}

/* Envios recentes do digitalizador, com as turmas que receberam folhas e se ainda dá para desfazer. */
async function enviosRecentes(env, pessoa, ano) {
  const envios = (await env.DB.prepare(
    'SELECT id, bimestre, unidade, criado_em, desfeito_em FROM redacao_envios WHERE digitalizador_id = ? AND ano = ? ORDER BY criado_em DESC LIMIT 30'
  ).bind(pessoa.id, ano).all()).results;
  for (const e of envios) {
    e.partes = (await env.DB.prepare(
      'SELECT l.id AS lote_id, t.codigo, t.unidade, COUNT(*) AS folhas, SUM(p.situacao = \'aluno\') AS alunos, ' +
      "SUM(p.situacao IN ('avulsa','duvida')) AS adm, SUM(c.lote_id IS NOT NULL) AS corrigidas " +
      'FROM redacao_paginas p JOIN redacao_lotes l ON l.id = p.lote_id JOIN redacao_turmas t ON t.id = l.turma_id ' +
      'LEFT JOIN redacao_correcoes c ON c.lote_id = p.lote_id AND c.pagina = p.pagina ' +
      'WHERE p.envio_id = ? GROUP BY l.id, t.codigo, t.unidade ORDER BY t.codigo'
    ).bind(e.id).all()).results;
    e.desfazer = !e.desfeito_em && e.partes.every(x => !x.corrigidas);
  }
  return envios.filter(e => e.partes.length || e.desfeito_em);
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
  const bimestre = numero(body?.bimestre, 1, 4);
  const unidade = String(body?.unidade || '');
  if (!pessoa.unidades.includes(unidade)) erro(403, 'Esta unidade não está vinculada ao seu cadastro.');
  const ras = [...new Set((Array.isArray(body.ras) ? body.ras : []).map(r => String(r ?? '').trim()))];
  if (ras.length > 400 || ras.some(r => !/^\d{1,15}$/.test(r))) erro(400, 'Lista de RAs inválida.');
  const cadastrados = (await env.DB.prepare('SELECT COUNT(*) AS n FROM redacao_alunos WHERE ano = ?').bind(ano).first()).n;
  const achados = await situacaoRas(env, ras, ano);
  const alunos = ras.map(ra => {
    const a = achados.get(ra);
    return a ? { ra, situacao: 'aluno', nome: a.nome, turma_id: a.turma_id, codigo: a.codigo, unidade: a.unidade } : { ra, situacao: 'fora_cadastro' };
  });
  /* Turmas que vão receber folhas: professora, lote já existente no bimestre e a lista de alunos
     (para o digitalizador escolher o aluno das folhas sem código). */
  const ids = [...new Set(alunos.filter(a => a.turma_id).map(a => a.turma_id))];
  const turmas = [];
  for (const id of ids) {
    const t = await env.DB.prepare('SELECT id, unidade, segmento, serie, codigo FROM redacao_turmas WHERE id = ?').bind(id).first();
    const prof = (await env.DB.prepare(
      'SELECT u.nome FROM redacao_professor_turmas pt JOIN usuarios u ON u.id = pt.usuario_id JOIN redacao_equipe e ON e.usuario_id = u.id ' +
      'WHERE pt.turma_id = ? AND u.ativo = 1 AND e.ativo = 1 AND e.professor = 1 ORDER BY u.nome'
    ).bind(id).all()).results.map(r => r.nome);
    const lote = await env.DB.prepare(
      'SELECT id, paginas_arquivo FROM redacao_lotes WHERE ano = ? AND bimestre = ? AND turma_id = ? AND cancelado_em IS NULL'
    ).bind(ano, bimestre, id).first();
    let infoLote = null;
    if (lote) {
      const ja = (await env.DB.prepare("SELECT aluno_ra FROM redacao_paginas WHERE lote_id = ? AND situacao = 'aluno'").bind(lote.id).all()).results.map(r => r.aluno_ra);
      infoLote = { id: lote.id, paginas: await paginasNoArquivo(env, { ...lote }), alunos_com_folha: ja };
    }
    const lista = (await env.DB.prepare('SELECT ra, nome FROM redacao_alunos WHERE turma_id = ? AND ano = ? ORDER BY nome COLLATE NOCASE').bind(id, ano).all()).results;
    turmas.push({ ...t, professoras: prof, lote: infoLote, alunos: lista });
  }
  return { ok: true, cadastro_vazio: cadastrados === 0, alunos, turmas };
}

/* Turmas da unidade escolhida (para o digitalizador escolher a turma quando nenhuma folha tem código). */
async function turmasDaUnidade(env, ano, unidade) {
  return (await env.DB.prepare('SELECT id, unidade, segmento, serie, codigo FROM redacao_turmas WHERE ano = ? AND ativa = 1 AND unidade = ? ORDER BY segmento, serie, codigo').bind(ano, unidade).all()).results;
}

async function pdfDoLote(env, lote) {
  if (!env.IMAGENS) erro(503, 'Armazenamento de PDFs indisponível.');
  const objeto = await env.IMAGENS.get(lote.r2_key);
  if (!objeto) erro(404, 'PDF indisponível. Avise o administrador.');
  return { __pdf: true, body: objeto.body, nome: lote.nome_arquivo };
}

async function cancelar(env, lote, pessoa, registrar, adm = false) {
  if (lote.cancelado_em) erro(409, 'Este lote já foi cancelado.');
  if (!adm) {
    if (lote.digitalizador_id !== pessoa.id) erro(403, 'Só quem enviou o lote pode cancelá-lo. Procure o administrador.');
    if (await env.DB.prepare('SELECT 1 FROM redacao_correcoes WHERE lote_id = ? LIMIT 1').bind(lote.id).first()) {
      erro(403, 'Uma professora já começou a corrigir este lote. Procure o administrador.');
    }
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
  if (!path.startsWith('/api/redacao/lotes') && !path.startsWith('/api/redacao/envios')) return null;
  const pessoa = await digitalizador(request, env, sessaoAtual);
  const ano = anoAtual(hojeSP, env);
  if (path === '/api/redacao/lotes' && request.method === 'GET') {
    const url = new URL(request.url), unidade = url.searchParams.get('unidade');
    return { ok: true, ano, turmas: await turmasPermitidas(env, ano, pessoa.unidades), lotes: await lotes(env, ano, pessoa.unidades),
      envios: await enviosRecentes(env, pessoa, ano), turmas_unidade: unidade && pessoa.unidades.includes(unidade) ? await turmasDaUnidade(env, ano, unidade) : [] };
  }
  if (path === '/api/redacao/lotes' && request.method === 'POST') return await enviar(request, env, new URL(request.url), pessoa, hojeSP, registrar);
  if (path === '/api/redacao/lotes/conferir' && request.method === 'POST') return await conferirRas(env, await readJson(request), pessoa, ano);
  if (path === '/api/redacao/envios' && request.method === 'POST') return await novoEnvio(env, await readJson(request), pessoa, ano, registrar);
  const me = path.match(/^\/api\/redacao\/envios\/([0-9a-f-]{36})$/);
  if (me && request.method === 'DELETE') return await desfazerEnvio(env, me[1], pessoa, registrar);
  const mp = path.match(/^\/api\/redacao\/lotes\/(\d+)\/(paginas|arquivo)$/);
  if (mp) {
    /* Folhas de aluno que mudou de turma ou unidade entram no lote da turma dele, mesmo de outra unidade. */
    const lote = await lotePorId(env, numero(mp[1], 1, 1000000000));
    if (!lote || lote.ano !== ano) erro(404, 'Lote não encontrado.');
    if (mp[2] === 'paginas' && request.method === 'POST') return await acrescentarPaginas(env, lote, await readJson(request), pessoa, registrar);
    if (mp[2] === 'arquivo' && request.method === 'PUT') return await substituirArquivo(request, env, new URL(request.url), lote, pessoa, registrar);
  }
  const m = path.match(/^\/api\/redacao\/lotes\/(\d+)(\/pdf)?$/);
  if (m) {
    const lote = await lotePorId(env, numero(m[1], 1, 1000000000));
    /* Para acrescentar folhas, o navegador baixa o PDF guardado do lote (inclusive de outra unidade). */
    const acrescentar = new URL(request.url).searchParams.get('acrescentar') === '1';
    if (!lote || (!pessoa.unidades.includes(lote.unidade) && !(acrescentar && lote.ano === ano))) erro(404, 'Lote não encontrado.');
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
