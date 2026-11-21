// Cadastros da Redação. As notas e os PDFs serão adicionados em entregas posteriores.
const UNIDADES = ['BC', 'AM', 'CN'];
/* EF1 fica fora da Redação (decisão do Marinho, 15/11/2026): turmas e alunos do EF1 foram apagados e a planilha os ignora. */
const SEGMENTOS = ['EF2', 'EM'];
const EMAIL = /^[a-z0-9._+-]+@grupoideal\.com\.br$/;

export class RedacaoError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function erro(status, message) { throw new RedacaoError(status, message); }
function texto(value, max = 120) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > max) erro(400, 'Há um campo de texto vazio ou grande demais.');
  return s;
}
function inteiro(value, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) erro(400, 'Número inválido.');
  return n;
}
function anoAtual(hojeSP, env) { return Number(hojeSP(env).slice(0, 4)); }
function validarTurma(row, ano) {
  const unidade = texto(row.unidade, 2).toUpperCase();
  const segmento = texto(row.segmento, 3).toUpperCase();
  const serie = texto(row.serie, 30);
  const codigo = texto(row.codigo, 30).toUpperCase();
  if (!UNIDADES.includes(unidade) || !SEGMENTOS.includes(segmento)) erro(400, 'Unidade ou segmento inválido.');
  if (segmento === 'EM' && !/^[123]ª Série$/.test(serie)) erro(400, 'Série do Ensino Médio inválida.');
  if (!/^[A-Z0-9-]+$/.test(codigo)) erro(400, 'Código da turma inválido.');
  return { ano, unidade, segmento, serie, codigo };
}
function chaveTurma(t) { return [t.ano, t.unidade, t.segmento, t.serie, t.codigo].join('|'); }
function validarAlunos(rows, ano) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 3000) erro(400, 'A planilha deve conter de 1 a 3000 alunos.');
  const vistos = new Set();
  return rows.map((row, i) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) erro(400, `Linha ${i + 2}: dados inválidos.`);
    const ra = String(row.ra ?? '').trim();
    if (!/^\d{1,15}$/.test(ra)) erro(400, `Linha ${i + 2}: RA inválido.`);
    if (vistos.has(ra)) erro(400, `Linha ${i + 2}: RA repetido na planilha.`);
    vistos.add(ra);
    const nome = texto(row.nome, 160);
    const turma = validarTurma(row, ano);
    return { ra, nome, ...turma };
  });
}
async function todasTurmas(env, ano) {
  return (await env.DB.prepare('SELECT id, ano, unidade, segmento, serie, codigo, ativa FROM redacao_turmas WHERE ano = ? ORDER BY unidade, segmento, serie, codigo').bind(ano).all()).results;
}
async function todosAlunos(env) {
  return (await env.DB.prepare('SELECT a.ra, a.nome, a.ano, a.segmento, a.serie, a.turma_id, t.unidade, t.codigo FROM redacao_alunos a JOIN redacao_turmas t ON t.id = a.turma_id').all()).results;
}
async function prepararImportacao(env, rows, ano) {
  const alunos = validarAlunos(rows, ano);
  const [turmas, existentes] = await Promise.all([todasTurmas(env, ano), todosAlunos(env)]);
  const porTurma = new Map(turmas.map(t => [chaveTurma(t), t]));
  const porRa = new Map(existentes.map(a => [a.ra, a]));
  const novasTurmas = new Map(), conflitos = [], mudancas = [], gravar = [];
  let novos = 0, atualizados = 0;
  for (const a of alunos) {
    const chave = chaveTurma(a);
    if (!porTurma.has(chave)) novasTurmas.set(chave, { ano, unidade: a.unidade, segmento: a.segmento, serie: a.serie, codigo: a.codigo });
    const anterior = porRa.get(a.ra);
    if (!anterior) { novos++; gravar.push(a); continue; }
    if (anterior.ano === ano && (anterior.segmento !== a.segmento || anterior.serie !== a.serie)) {
      conflitos.push({ ra: a.ra, motivo: 'Mudança de série ou segmento no mesmo ano.' });
      continue;
    }
    if (anterior.nome !== a.nome || anterior.ano !== ano || anterior.unidade !== a.unidade || anterior.codigo !== a.codigo || anterior.serie !== a.serie) {
      atualizados++;
      gravar.push(a);
      mudancas.push({ ra: a.ra, nome: a.nome, antes: `${anterior.unidade} · ${anterior.codigo}`, depois: `${a.unidade} · ${a.codigo}` });
    }
  }
  return { alunos, gravar, novasTurmas: [...novasTurmas.values()], conflitos, mudancas, novos, atualizados };
}
function validarIds(ids, max = 100) {
  if (!Array.isArray(ids) || ids.length > max) erro(400, 'Lista de turmas inválida.');
  const result = ids.map(x => inteiro(x, 1, 1000000000));
  if (new Set(result).size !== result.length) erro(400, 'Turma repetida na seleção.');
  return result;
}
async function equipe(env) {
  const pessoas = (await env.DB.prepare(
    'SELECT e.usuario_id AS id, u.nome, u.email, e.funcao, e.ativo, CASE WHEN u.disciplina IS NULL AND u.digitador = 0 THEN 1 ELSE 0 END AS somente_redacao FROM redacao_equipe e JOIN usuarios u ON u.id = e.usuario_id ORDER BY u.nome COLLATE NOCASE'
  ).all()).results;
  const turmas = (await env.DB.prepare('SELECT usuario_id, turma_id FROM redacao_professor_turmas').all()).results;
  const unidades = (await env.DB.prepare('SELECT usuario_id, unidade FROM redacao_digitalizador_unidades').all()).results;
  return pessoas.map(p => ({ ...p, ativo: p.ativo === 1, somente_redacao: p.somente_redacao === 1, turmas: turmas.filter(x => x.usuario_id === p.id).map(x => x.turma_id), unidades: unidades.filter(x => x.usuario_id === p.id).map(x => x.unidade) }));
}
async function validarAtribuicoes(env, funcao, body) {
  const turmas = funcao === 'professor' ? validarIds(body.turmas || []) : [];
  const unidades = funcao === 'digitalizador' ? (Array.isArray(body.unidades) ? body.unidades : []) : [];
  if (unidades.length > 3 || new Set(unidades).size !== unidades.length || unidades.some(x => !UNIDADES.includes(x))) erro(400, 'Unidades inválidas.');
  if (funcao === 'professor' && turmas.length) {
    await validarTurmaDaProfessora(env, turmas, body.usuario_id || null);
    const disponiveis = new Set((await env.DB.prepare('SELECT id FROM redacao_turmas WHERE ativa = 1').all()).results.map(x => x.id));
    if (turmas.some(id => !disponiveis.has(id))) erro(400, 'Uma turma selecionada não existe ou está inativa.');
  }
  return { turmas, unidades };
}

/* Regra única para as duas telas de cadastro: no máximo uma turma por professora
   e uma professora por turma, mesmo quando a outra pessoa está desativada. */
export async function validarTurmaDaProfessora(env, turmas, usuarioId = null) {
  if (turmas.length > 1) erro(400, 'Cada professor de Redação pode ter somente uma turma.');
  if (!turmas.length) return;
  const outra = await env.DB.prepare(
    'SELECT u.nome FROM redacao_professor_turmas pt JOIN usuarios u ON u.id = pt.usuario_id WHERE pt.turma_id = ? AND pt.usuario_id <> ? LIMIT 1'
  ).bind(turmas[0], usuarioId || 0).first();
  if (outra) erro(409, `Esta turma já está vinculada a ${outra.nome}. Retire a turma desse cadastro antes de atribuí-la a outra pessoa.`);
}

export async function rotaRedacaoAdm(request, env, path, { readJson, hojeSP, registrar, emailEmUso, sessao }) {
  if (!path.startsWith('/api/adm/redacao/')) return null;
  const ano = anoAtual(hojeSP, env);
  if (path === '/api/adm/redacao/turmas' && request.method === 'GET') return { ok: true, ano, turmas: await todasTurmas(env, ano) };
  if (path === '/api/adm/redacao/turmas' && request.method === 'POST') {
    const body = await readJson(request);
    const t = validarTurma(body, ano);
    const r = await env.DB.prepare('INSERT OR IGNORE INTO redacao_turmas (ano, unidade, segmento, serie, codigo) VALUES (?, ?, ?, ?, ?)')
      .bind(t.ano, t.unidade, t.segmento, t.serie, t.codigo).run();
    if (!r.meta?.changes) erro(409, 'Esta turma já está cadastrada.');
    await registrar(env, 'redacao_turma_cadastrada', { adm: sessao.email, turma: t });
    return { ok: true, turmas: await todasTurmas(env, ano) };
  }
  if (path === '/api/adm/redacao/equipe' && request.method === 'GET') return { ok: true, equipe: await equipe(env) };
  if (path === '/api/adm/redacao/equipe' && request.method === 'POST') {
    const body = await readJson(request);
    const nome = texto(body.nome, 120);
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 120) erro(400, 'Use um e-mail @grupoideal.com.br.');
    const funcao = body.funcao;
    if (!['professor', 'digitalizador'].includes(funcao)) erro(400, 'Função inválida.');
    const atribuicoes = await validarAtribuicoes(env, funcao, body);
    let usuario = await env.DB.prepare('SELECT id, ativo FROM usuarios WHERE email = ? COLLATE NOCASE').bind(email).first();
    if (usuario && usuario.ativo !== 1) erro(409, 'Este usuário está desativado. Reative-o antes de vinculá-lo à Redação.');
    if (!usuario) {
      if (await emailEmUso(env, email)) erro(409, 'Este e-mail já está cadastrado.');
      const r = await env.DB.prepare("INSERT INTO usuarios (nome, email, papel, ativo) VALUES (?, ?, 'professor', 1)").bind(nome, email).run();
      usuario = { id: r.meta.last_row_id };
    }
    const anterior = await env.DB.prepare('SELECT usuario_id FROM redacao_equipe WHERE usuario_id = ?').bind(usuario.id).first();
    if (anterior) erro(409, 'Esta pessoa já está cadastrada na Redação.');
    const ops = [env.DB.prepare('INSERT INTO redacao_equipe (usuario_id, funcao, professor, digitalizador) VALUES (?, ?, ?, ?)').bind(usuario.id, funcao, funcao === 'professor' ? 1 : 0, funcao === 'digitalizador' ? 1 : 0)];
    for (const id of atribuicoes.turmas) ops.push(env.DB.prepare('INSERT INTO redacao_professor_turmas (usuario_id, turma_id) VALUES (?, ?)').bind(usuario.id, id));
    for (const unidade of atribuicoes.unidades) ops.push(env.DB.prepare('INSERT INTO redacao_digitalizador_unidades (usuario_id, unidade) VALUES (?, ?)').bind(usuario.id, unidade));
    await env.DB.batch(ops);
    await registrar(env, 'redacao_equipe_cadastrada', { adm: sessao.email, usuario_id: usuario.id, funcao, ...atribuicoes });
    return { ok: true, equipe: await equipe(env) };
  }
  const equipeMatch = path.match(/^\/api\/adm\/redacao\/equipe\/(\d+)$/);
  if (equipeMatch && request.method === 'PUT') {
    const id = inteiro(equipeMatch[1], 1, 1000000000);
    const atual = await env.DB.prepare('SELECT e.usuario_id, e.funcao, u.disciplina, u.digitador FROM redacao_equipe e JOIN usuarios u ON u.id = e.usuario_id WHERE e.usuario_id = ?').bind(id).first();
    if (!atual) erro(404, 'Pessoa não encontrada.');
    const body = await readJson(request);
    const funcao = body.funcao;
    if (!['professor', 'digitalizador'].includes(funcao)) erro(400, 'Função inválida.');
    const ativo = body.ativo === false ? 0 : 1;
    const atribuicoes = await validarAtribuicoes(env, funcao, { ...body, usuario_id: id });
    const ops = [env.DB.prepare('UPDATE redacao_equipe SET funcao = ?, ativo = ?, professor = ?, digitalizador = ? WHERE usuario_id = ?').bind(funcao, ativo, funcao === 'professor' ? 1 : 0, funcao === 'digitalizador' ? 1 : 0, id),
      env.DB.prepare('DELETE FROM redacao_professor_turmas WHERE usuario_id = ?').bind(id),
      env.DB.prepare('DELETE FROM redacao_digitalizador_unidades WHERE usuario_id = ?').bind(id)];
    if (atual.disciplina === null && atual.digitador === 0) {
      const nome = texto(body.nome, 120);
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL.test(email) || email.length > 120) erro(400, 'Use um e-mail @grupoideal.com.br.');
      const ocupado = await env.DB.prepare('SELECT id FROM usuarios WHERE email = ? COLLATE NOCASE AND id <> ?').bind(email, id).first();
      if (ocupado) erro(409, 'Este e-mail já está cadastrado.');
      ops.push(env.DB.prepare('UPDATE usuarios SET nome = ?, email = ? WHERE id = ?').bind(nome, email, id));
    }
    for (const tid of atribuicoes.turmas) ops.push(env.DB.prepare('INSERT INTO redacao_professor_turmas (usuario_id, turma_id) VALUES (?, ?)').bind(id, tid));
    for (const unidade of atribuicoes.unidades) ops.push(env.DB.prepare('INSERT INTO redacao_digitalizador_unidades (usuario_id, unidade) VALUES (?, ?)').bind(id, unidade));
    await env.DB.batch(ops);
    await registrar(env, 'redacao_equipe_alterada', { adm: sessao.email, usuario_id: id, funcao, ativo, ...atribuicoes });
    return { ok: true, equipe: await equipe(env) };
  }
  if (path === '/api/adm/redacao/alunos' && request.method === 'GET') {
    const url = new URL(request.url);
    const turmaId = inteiro(url.searchParams.get('turma_id'), 1, 1000000000);
    const turma = await env.DB.prepare('SELECT id FROM redacao_turmas WHERE id = ? AND ano = ?').bind(turmaId, ano).first();
    if (!turma) erro(404, 'Turma não encontrada.');
    return { ok: true, alunos: (await env.DB.prepare('SELECT ra, nome FROM redacao_alunos WHERE turma_id = ? AND ano = ? ORDER BY nome COLLATE NOCASE').bind(turmaId, ano).all()).results };
  }
  if ((path === '/api/adm/redacao/alunos/previa' || path === '/api/adm/redacao/alunos/importar') && request.method === 'POST') {
    const body = await readJson(request, 2 * 1024 * 1024);
    if (inteiro(body.ano, 2026, 2100) !== ano) erro(400, 'Envie uma planilha do ano atual.');
    return await importarAlunosRedacao(env, Array.isArray(body.alunos) ? body.alunos : [], ano, { gravar: path.endsWith('/importar'), sessao, registrar });
  }
  erro(404, 'Rota indisponível.');
}

/* Lista da Redação (EF2 e EM) a partir das linhas {ra, nome, unidade, segmento, serie, codigo}: a prévia só confere;
   a importação cria as turmas novas e grava os alunos. Usada pela rota antiga e pelo cadastro completo (alunos.js). */
export async function importarAlunosRedacao(env, todas, ano, { gravar, sessao, registrar }) {
  const semEf1 = todas.filter(r => String(r?.segmento ?? '').trim().toUpperCase() !== 'EF1');
  const p = await prepararImportacao(env, semEf1, ano);
  const resumo = { ok: true, linhas: p.alunos.length, ignorados_ef1: todas.length - semEf1.length, novos: p.novos, atualizados: p.atualizados,
    novas_turmas: p.novasTurmas, mudancas: p.mudancas, conflitos: p.conflitos };
  if (!gravar) return resumo;
  if (p.conflitos.length) erro(409, 'A planilha contém mudança de série ou segmento. Corrija os RAs indicados antes de importar.');
  const turmaOps = p.novasTurmas.map(t => env.DB.prepare('INSERT OR IGNORE INTO redacao_turmas (ano, unidade, segmento, serie, codigo) VALUES (?, ?, ?, ?, ?)').bind(ano, t.unidade, t.segmento, t.serie, t.codigo));
  if (turmaOps.length) await env.DB.batch(turmaOps);
  const porTurma = new Map((await todasTurmas(env, ano)).map(t => [chaveTurma(t), t.id]));
  const ops = p.gravar.map(a => env.DB.prepare(
    'INSERT INTO redacao_alunos (ra, nome, turma_id, ano, segmento, serie) VALUES (?, ?, ?, ?, ?, ?) ' +
    "ON CONFLICT(ra) DO UPDATE SET nome = excluded.nome, turma_id = excluded.turma_id, ano = excluded.ano, segmento = excluded.segmento, serie = excluded.serie, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now')"
  ).bind(a.ra, a.nome, porTurma.get(chaveTurma(a)), ano, a.segmento, a.serie));
  for (let i = 0; i < ops.length; i += 100) await env.DB.batch(ops.slice(i, i + 100));
  await env.DB.prepare('INSERT INTO redacao_importacoes (ano, administrador, linhas, novos, atualizados) VALUES (?, ?, ?, ?, ?)')
    .bind(ano, sessao.email, p.alunos.length, p.novos, p.atualizados).run();
  await registrar(env, 'redacao_alunos_importados', { adm: sessao.email, ano, linhas: p.alunos.length, novos: p.novos, atualizados: p.atualizados });
  return resumo;
}

export async function rotaRedacaoUsuario(request, env, path, { sessaoAtual }) {
  if (path !== '/api/redacao/sessao' || request.method !== 'GET') erro(404, 'Rota indisponível.');
  const sessao = await sessaoAtual(request, env, 'usuario');
  const pessoa = await env.DB.prepare(
    'SELECT u.id, u.nome, u.email, e.professor, e.digitalizador FROM redacao_equipe e JOIN usuarios u ON u.id = e.usuario_id WHERE e.usuario_id = ? AND e.ativo = 1 AND u.ativo = 1'
  ).bind(sessao.usuario_id).first();
  if (!pessoa || (!pessoa.professor && !pessoa.digitalizador)) erro(403, 'Você não está cadastrado na equipe de Redação.');
  /* Uma pessoa pode ser professora de redação e digitalizadora ao mesmo tempo. */
  pessoa.funcoes = [...(pessoa.professor ? ['professor'] : []), ...(pessoa.digitalizador ? ['digitalizador'] : [])];
  pessoa.funcao = pessoa.funcoes[0];
  delete pessoa.professor; delete pessoa.digitalizador;
  if (pessoa.funcoes.includes('professor')) {
    pessoa.turmas = (await env.DB.prepare(
      'SELECT t.id, t.ano, t.unidade, t.segmento, t.serie, t.codigo FROM redacao_professor_turmas pt JOIN redacao_turmas t ON t.id = pt.turma_id WHERE pt.usuario_id = ? AND t.ativa = 1 ORDER BY t.ano DESC, t.unidade, t.segmento, t.serie, t.codigo'
    ).bind(pessoa.id).all()).results;
  }
  if (pessoa.funcoes.includes('digitalizador')) {
    pessoa.unidades = (await env.DB.prepare('SELECT unidade FROM redacao_digitalizador_unidades WHERE usuario_id = ? ORDER BY unidade').bind(pessoa.id).all()).results.map(x => x.unidade);
  }
  return { ok: true, usuario: pessoa, expira_em: sessao.expira_em };
}

export async function limparAlunosVirada(env, hojeSP, registrar) {
  const hoje = hojeSP(env);
  if (!hoje.endsWith('-12-31') && !hoje.endsWith('-01-01')) return;
  const ano = Number(hoje.slice(0, 4));
  const r = await env.DB.prepare('DELETE FROM redacao_alunos WHERE ano < ? OR (ano = ? AND ? = 1)')
    .bind(ano, ano, hoje.endsWith('-12-31') ? 1 : 0).run();
  if (r.meta?.changes) await registrar(env, 'redacao_alunos_virada', { data: hoje, removidos: r.meta.changes });
}
