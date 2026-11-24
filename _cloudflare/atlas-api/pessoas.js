// "Cadastros e funções": cadastro único de pessoas. Uma pessoa pode acumular funções:
// banco de questões (professor da disciplina, supervisor, classificador ou digitador),
// Redação (professor de redação com turmas, digitalizador com unidades) e coordenador
// (unidade/segmento/série; por enquanto só recebe o Excel das notas) e Diagramador (recebe por e-mail o caderno
// de cada prova fechada; não entra no ATLAS).
import { RedacaoError, validarTurmaDaProfessora } from './redacao-cadastros.js';

const erro = (status, mensagem) => { throw new RedacaoError(status, mensagem); };
const UNIDADES = ['BC', 'AM', 'CN'];
const SEGMENTOS = ['EF2', 'EM'];
// Quem corrige redação: ou não tem disciplina no banco de questões (professor de redação mesmo),
// ou é da área de linguagens. Professor de Matemática, Física e afins não corrige redação.
export const LINGUAGENS = Object.freeze(['Português', 'Literatura', 'Inglês', 'Artes']);

export async function listarPessoas(env) {
  const pessoas = (await env.DB.prepare(
    "SELECT id, nome, email, disciplina, papel, ativo, digitador, acesso_ate, classificador, diagramador FROM usuarios WHERE papel IN ('professor','supervisor') ORDER BY nome COLLATE NOCASE"
  ).all()).results;
  const equipe = new Map((await env.DB.prepare('SELECT usuario_id, professor, digitalizador, ativo FROM redacao_equipe').all()).results.map(e => [e.usuario_id, e]));
  const turmas = (await env.DB.prepare('SELECT usuario_id, turma_id FROM redacao_professor_turmas').all()).results;
  const unidades = (await env.DB.prepare('SELECT usuario_id, unidade FROM redacao_digitalizador_unidades').all()).results;
  const coord = (await env.DB.prepare('SELECT usuario_id, unidade, segmento, serie FROM coordenadores ORDER BY unidade, segmento, serie').all()).results;
  return pessoas.map(p => {
    const e = equipe.get(p.id);
    return {
      ...p, ativo: p.ativo === 1, digitador: p.digitador === 1, classificador: p.classificador === 1, diagramador: p.diagramador === 1,
      banco: !!p.disciplina || p.digitador === 1,
      redacao: {
        professor: !!e && e.professor === 1, digitalizador: !!e && e.digitalizador === 1,
        turmas: turmas.filter(x => x.usuario_id === p.id).map(x => x.turma_id),
        unidades: unidades.filter(x => x.usuario_id === p.id).map(x => x.unidade)
      },
      coordenacao: coord.filter(x => x.usuario_id === p.id).map(({ unidade, segmento, serie }) => ({ unidade, segmento, serie }))
    };
  });
}

/* Cria (id = null) ou altera uma pessoa. Só mexe nas partes enviadas: banco, redacao, coordenacao, diagramador. */
export async function salvarPessoa(env, id, body, h) {
  const { limparNome, limparEmail, limparAcessoAte, emailEmUso, DISCIPLINAS, registrar, sessao } = h;
  if (!body || typeof body !== 'object') erro(400, 'Dados inválidos.');
  if (id === null) {
    /* Confere a regra da redação ANTES de inserir, para não deixar cadastro pela metade. */
    const bNovo = body.banco;
    const discNova = bNovo && bNovo.tipo === 'professor' ? bNovo.disciplina : null;
    if (body.redacao?.professor && discNova && !LINGUAGENS.includes(discNova)) {
      erro(400, 'Professor de redação só pode ser quem não tem disciplina no banco de questões ou é da área de linguagens (' + LINGUAGENS.join(', ') + ').');
    }
    const selecao = body.redacao?.professor?.turmas;
    if (Array.isArray(selecao)) await validarTurmaDaProfessora(env, [...new Set(selecao.map(Number))]);
    const nome = limparNome(body.nome), email = limparEmail(body.email);
    if (await emailEmUso(env, email)) erro(409, 'Este e-mail já está cadastrado.');
    const r = await env.DB.prepare("INSERT INTO usuarios (nome, email, disciplina, papel, ativo, digitador, acesso_ate, classificador) VALUES (?, ?, NULL, 'professor', 1, 0, ?, 0)")
      .bind(nome, email, limparAcessoAte(body.acesso_ate)).run();
    id = r.meta?.last_row_id;
  }
  const atual = await env.DB.prepare("SELECT id, nome, email, disciplina, papel, ativo, digitador, acesso_ate, classificador, diagramador FROM usuarios WHERE id = ? AND papel IN ('professor','supervisor')").bind(id).first();
  if (!atual) erro(404, 'Pessoa não encontrada.');
  const nome = body.nome !== undefined ? limparNome(body.nome) : atual.nome;
  const email = body.email !== undefined ? limparEmail(body.email) : atual.email;
  if (email.toLowerCase() !== String(atual.email).toLowerCase() && await emailEmUso(env, email, id)) erro(409, 'Este e-mail já está cadastrado.');
  const ativo = body.ativo !== undefined ? (body.ativo ? 1 : 0) : atual.ativo;
  const acessoAte = body.acesso_ate !== undefined ? limparAcessoAte(body.acesso_ate) : atual.acesso_ate;
  let { disciplina, digitador, classificador, diagramador } = atual;
  if (body.diagramador !== undefined) diagramador = body.diagramador ? 1 : 0;
  if (body.banco !== undefined) {
    const b = body.banco;
    if (!b) { disciplina = null; digitador = 0; classificador = 0; }
    else if (b.tipo === 'digitador') { disciplina = null; digitador = 1; classificador = 0; }
    else if (b.tipo === 'professor') {
      if (!DISCIPLINAS.includes(b.disciplina)) erro(400, 'Escolha uma disciplina válida.');
      disciplina = b.disciplina; digitador = 0; classificador = b.classificador === true ? 1 : 0;
    } else erro(400, 'Função no banco de questões inválida.');
  }
  /* Quem muda de disciplina, sai do banco, vira digitador ou é desativado deixa de ser supervisor. */
  const papel = (disciplina !== atual.disciplina || !ativo || digitador || !disciplina) ? 'professor' : atual.papel;
  /* A função de redação vale com o estado final: se a parte da redação não veio no corpo, olha o banco. */
  const profRedacao = body.redacao !== undefined
    ? !!(body.redacao || {}).professor
    : ((await env.DB.prepare('SELECT professor FROM redacao_equipe WHERE usuario_id = ?').bind(id).first())?.professor === 1);
  if (profRedacao && disciplina && !LINGUAGENS.includes(disciplina)) {
    erro(400, 'Professor de redação só pode ser quem não tem disciplina no banco de questões ou é da área de linguagens (' + LINGUAGENS.join(', ') + ').');
  }
  const ops = [env.DB.prepare('UPDATE usuarios SET nome = ?, email = ?, disciplina = ?, ativo = ?, papel = ?, digitador = ?, acesso_ate = ?, classificador = ?, diagramador = ? WHERE id = ?')
    .bind(nome, email, disciplina, ativo, papel, digitador, acessoAte, classificador, diagramador, id)];
  if (!classificador || !ativo || disciplina !== atual.disciplina) ops.push(env.DB.prepare('DELETE FROM reservas WHERE usuario_id = ?').bind(id));

  if (body.redacao !== undefined) {
    const r = body.redacao || {};
    const prof = !!r.professor, dig = !!r.digitalizador;
    const turmas = prof ? [...new Set((Array.isArray(r.professor.turmas) ? r.professor.turmas : []).map(Number))] : [];
    if (turmas.some(t => !Number.isInteger(t) || t < 1)) erro(400, 'Turmas inválidas.');
    await validarTurmaDaProfessora(env, turmas, id);
    if (turmas.length) {
      const ok = new Set((await env.DB.prepare(`SELECT id FROM redacao_turmas WHERE ativa = 1 AND id IN (${turmas.map(() => '?').join(',')})`).bind(...turmas).all()).results.map(x => x.id));
      if (turmas.some(t => !ok.has(t))) erro(400, 'Uma das turmas escolhidas não existe.');
    }
    const unidades = dig ? [...new Set(Array.isArray(r.digitalizador.unidades) ? r.digitalizador.unidades : [])] : [];
    if (unidades.some(u => !UNIDADES.includes(u))) erro(400, 'Unidades inválidas.');
    if (dig && !unidades.length) erro(400, 'Marque pelo menos uma unidade para o digitalizador.');
    ops.push(env.DB.prepare('DELETE FROM redacao_professor_turmas WHERE usuario_id = ?').bind(id));
    ops.push(env.DB.prepare('DELETE FROM redacao_digitalizador_unidades WHERE usuario_id = ?').bind(id));
    if (prof || dig) {
      const principal = prof ? 'professor' : 'digitalizador';
      ops.push(env.DB.prepare('INSERT INTO redacao_equipe (usuario_id, funcao, ativo, professor, digitalizador) VALUES (?, ?, 1, ?, ?) ' +
        'ON CONFLICT(usuario_id) DO UPDATE SET funcao = excluded.funcao, ativo = 1, professor = excluded.professor, digitalizador = excluded.digitalizador')
        .bind(id, principal, prof ? 1 : 0, dig ? 1 : 0));
      for (const t of turmas) ops.push(env.DB.prepare('INSERT INTO redacao_professor_turmas (usuario_id, turma_id) VALUES (?, ?)').bind(id, t));
      for (const u of unidades) ops.push(env.DB.prepare('INSERT INTO redacao_digitalizador_unidades (usuario_id, unidade) VALUES (?, ?)').bind(id, u));
    } else {
      ops.push(env.DB.prepare('DELETE FROM redacao_equipe WHERE usuario_id = ?').bind(id));
    }
  }
  if (body.coordenacao !== undefined) {
    const lista = Array.isArray(body.coordenacao) ? body.coordenacao : [];
    if (lista.length > 60) erro(400, 'Coordenação inválida.');
    const vistos = new Set();
    ops.push(env.DB.prepare('DELETE FROM coordenadores WHERE usuario_id = ?').bind(id));
    for (const c of lista) {
      const unidade = String(c?.unidade || ''), segmento = String(c?.segmento || ''), serie = String(c?.serie || '').trim();
      if (!UNIDADES.includes(unidade) || !SEGMENTOS.includes(segmento) || !serie || serie.length > 30) erro(400, 'Coordenação inválida.');
      const k = unidade + '|' + segmento + '|' + serie;
      if (vistos.has(k)) continue;
      vistos.add(k);
      ops.push(env.DB.prepare('INSERT INTO coordenadores (usuario_id, unidade, segmento, serie) VALUES (?, ?, ?, ?)').bind(id, unidade, segmento, serie));
    }
  }
  await env.DB.batch(ops);
  await registrar(env, 'pessoa_salva', { adm: sessao.email, id, nome, email, ativo, disciplina, digitador, classificador, diagramador,
    redacao: body.redacao, coordenacao: body.coordenacao });
  return id;
}

/* Diagramadores ativos: recebem por e-mail o caderno de cada prova fechada. */
export async function listarDiagramadores(env) {
  return (await env.DB.prepare("SELECT id, nome, email FROM usuarios WHERE diagramador = 1 AND ativo = 1 AND papel IN ('professor','supervisor') ORDER BY nome COLLATE NOCASE").all()).results;
}
