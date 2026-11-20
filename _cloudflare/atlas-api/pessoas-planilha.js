// "Cadastros e funções" pela planilha (20/11/2026): o ADM baixa a planilha com as pessoas atuais, edita e
// manda de volta; a prévia confere tudo sem gravar, e a importação grava pelo mesmo salvarPessoa da tela.
// Pessoas que não estão na planilha não são apagadas (igual aos alunos). Uma linha por pessoa:
//   NOME COMPLETO | E-MAIL | BANCO DE QUESTÕES (vazio, PROFESSOR, SUPERVISOR ou DIGITADOR) | DISCIPLINA |
//   CLASSIFICADOR (SIM) | PROFESSOR DE REDAÇÃO (turma: "BC 1EMA") | DIGITALIZADOR (unidades: "BC; AM") |
//   COORDENADOR ("BC EM 1ª Série; BC EM 2ª Série") | ACESSO ATÉ (AAAA-MM-DD ou DD/MM/AAAA) | ATIVO (SIM/NÃO)
import { RedacaoError } from './redacao-cadastros.js';
import { listarPessoas, salvarPessoa } from './pessoas.js';

const erro = (status, mensagem) => { throw new RedacaoError(status, mensagem); };
const UNIDADES = ['BC', 'AM', 'CN'];
const SEGMENTOS = ['EF2', 'EM'];
export const COLUNAS = Object.freeze(['NOME COMPLETO', 'E-MAIL', 'BANCO DE QUESTÕES', 'DISCIPLINA', 'CLASSIFICADOR',
  'PROFESSOR DE REDAÇÃO (TURMA)', 'DIGITALIZADOR (UNIDADES)', 'COORDENADOR (UNIDADE SEGMENTO SÉRIE)', 'ACESSO ATÉ', 'ATIVO']);
const MAX_LINHAS = 500;

const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const chave = s => semAcento(s).trim().toUpperCase().replace(/\s+/g, ' ');
const texto = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const lista = s => String(s ?? '').split(/[;,\n]/).map(x => x.trim()).filter(Boolean);
const simNao = (s, padrao) => { const k = chave(s); if (!k) return padrao; if (['SIM', 'S', 'X', 'TRUE', '1'].includes(k)) return true; if (['NAO', 'N', 'FALSE', '0'].includes(k)) return false; return null; };

/* Turmas do ano (ativas) e as combinações unidade/segmento/série que existem. */
async function turmasDoAno(env, ano) {
  const turmas = (await env.DB.prepare('SELECT id, unidade, segmento, serie, codigo FROM redacao_turmas WHERE ano = ? AND ativa = 1').bind(ano).all()).results;
  const porCodigo = new Map(turmas.map(t => [t.unidade + ' ' + chave(t.codigo), t]));
  const series = new Map();
  for (const t of turmas) series.set(t.unidade + '|' + t.segmento + '|' + chave(t.serie), { unidade: t.unidade, segmento: t.segmento, serie: t.serie });
  return { turmas, porCodigo, series };
}

/* Lê uma linha da planilha e devolve o cadastro pronto (ou a lista de problemas dela). */
function lerLinha(l, n, h, { porCodigo, series }) {
  const problemas = [], p = { linha: n };
  const falha = m => { problemas.push(m); };
  try { p.nome = h.limparNome(l.nome); } catch (e) { falha(e.message); }
  try { p.email = h.limparEmail(l.email); } catch (e) { falha(e.message); }
  const banco = chave(l.banco).replace(/\s+/g, ' ');
  if (!banco) p.banco = null;
  else if (['PROFESSOR', 'PROFESSORA', 'PROF', 'SIM'].includes(banco)) p.banco = 'professor';
  else if (['SUPERVISOR', 'SUPERVISORA'].includes(banco)) p.banco = 'supervisor';
  else if (['DIGITADOR', 'DIGITADORA'].includes(banco)) p.banco = 'digitador';
  else falha('Banco de questões: use PROFESSOR, SUPERVISOR, DIGITADOR ou deixe em branco.');
  const disc = chave(l.disciplina);
  p.disciplina = disc ? (h.DISCIPLINAS.find(d => chave(d) === disc) || null) : null;
  if (disc && !p.disciplina) falha('Disciplina desconhecida: ' + texto(l.disciplina, 40) + '.');
  if ((p.banco === 'professor' || p.banco === 'supervisor') && !p.disciplina) falha('Professor ou supervisor do banco precisa da disciplina.');
  if (p.banco === 'digitador') p.disciplina = null;
  const cl = simNao(l.classificador, false);
  if (cl === null) falha('Classificador: use SIM ou deixe em branco.');
  p.classificador = !!cl && (p.banco === 'professor' || p.banco === 'supervisor');
  p.turmas = [];
  for (const t of lista(l.turma)) {
    const k = chave(t);
    const m = porCodigo.get(k);
    if (!m) falha('Turma de redação desconhecida: ' + texto(t, 30) + ' (use "UNIDADE CÓDIGO", como "BC 1EMA").');
    else p.turmas.push(m.id);
  }
  p.turmas = [...new Set(p.turmas)];
  if (p.turmas.length > 1) falha('Cada professor de redação pode ter somente uma turma.');
  p.unidades = [];
  for (const u of lista(l.unidades)) {
    const k = chave(u);
    const m = UNIDADES.find(x => x === k) || ({ 'BATISTA CAMPOS': 'BC', 'AUGUSTO MONTENEGRO': 'AM', 'CIDADE NOVA': 'CN' })[k];
    if (!m) falha('Unidade desconhecida para o digitalizador: ' + texto(u, 30) + ' (use BC, AM ou CN).');
    else if (!p.unidades.includes(m)) p.unidades.push(m);
  }
  p.coordenacao = [];
  for (const c of lista(l.coordenacao)) {
    const partes = c.trim().split(/\s+/);
    const unidade = chave(partes[0] || ''), segmento = chave(partes[1] || ''), serie = partes.slice(2).join(' ').trim();
    const m = UNIDADES.includes(unidade) && SEGMENTOS.includes(segmento) ? series.get(unidade + '|' + segmento + '|' + chave(serie)) : null;
    if (!m) falha('Coordenação desconhecida: ' + texto(c, 40) + ' (use "UNIDADE SEGMENTO SÉRIE", como "BC EM 1ª Série").');
    else if (!p.coordenacao.some(x => x.unidade === m.unidade && x.segmento === m.segmento && x.serie === m.serie)) p.coordenacao.push({ ...m });
  }
  let data = String(l.acesso_ate ?? '').trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data);
  if (br) data = br[3] + '-' + br[2] + '-' + br[1];
  if (/^\d{4}-\d{2}-\d{2}T/.test(data)) data = data.slice(0, 10);
  try { p.acesso_ate = h.limparAcessoAte(data); } catch (e) { falha(e.message); }
  const at = simNao(l.ativo, true);
  if (at === null) falha('Ativo: use SIM ou NÃO.');
  p.ativo = at !== false;
  if (!p.banco && !p.turmas.length && !p.unidades.length && !p.coordenacao.length) falha('Marque pelo menos uma função (banco, redação, digitalizador ou coordenador).');
  return { p, problemas };
}

/* O que a pessoa é hoje, no mesmo formato da linha, para saber se a planilha muda algo. */
function retrato(x) {
  const banco = x.digitador ? 'digitador' : x.disciplina ? (x.papel === 'supervisor' ? 'supervisor' : 'professor') : null;
  return JSON.stringify({ nome: x.nome, banco, disciplina: x.disciplina || null, classificador: !!x.classificador, turmas: [...x.redacao.turmas].sort(),
    unidades: [...x.redacao.unidades].sort(), coordenacao: x.coordenacao.map(c => c.unidade + '|' + c.segmento + '|' + c.serie).sort(),
    acesso_ate: x.acesso_ate || null, ativo: !!x.ativo });
}
const retratoDaLinha = p => JSON.stringify({ nome: p.nome, banco: p.banco, disciplina: p.disciplina, classificador: p.classificador, turmas: [...p.turmas].sort(),
  unidades: [...p.unidades].sort(), coordenacao: p.coordenacao.map(c => c.unidade + '|' + c.segmento + '|' + c.serie).sort(), acesso_ate: p.acesso_ate, ativo: p.ativo });

/* Prévia: confere a planilha inteira sem gravar nada. */
export async function prepararPessoas(env, linhas, ano, h) {
  if (!Array.isArray(linhas)) erro(400, 'Dados inválidos.');
  if (linhas.length > MAX_LINHAS) erro(400, 'A planilha tem mais de ' + MAX_LINHAS + ' linhas.');
  const ref = await turmasDoAno(env, ano);
  const atuais = await listarPessoas(env);
  const porEmail = new Map(atuais.map(x => [String(x.email).toLowerCase(), x]));
  const erros = [], pessoas = [], vistos = new Map(), supervisores = new Map(), turmasVistas = new Map();
  linhas.forEach((l, i) => {
    const n = Number(l?.linha) || i + 2;
    const { p, problemas } = lerLinha(l || {}, n, h, ref);
    if (p.email) {
      if (vistos.has(p.email)) problemas.push('E-mail repetido na planilha (linha ' + vistos.get(p.email) + ').');
      vistos.set(p.email, n);
    }
    if (p.banco === 'supervisor' && p.disciplina) {
      if (supervisores.has(p.disciplina)) problemas.push('Duas pessoas marcadas como supervisor de ' + p.disciplina + ' (linha ' + supervisores.get(p.disciplina) + ').');
      supervisores.set(p.disciplina, n);
      if (!p.ativo) problemas.push('Supervisor precisa estar ativo.');
    }
    for (const t of p.turmas) {
      if (turmasVistas.has(t)) problemas.push('A mesma turma de redação aparece em duas linhas (linha ' + turmasVistas.get(t) + ').');
      turmasVistas.set(t, n);
    }
    if (problemas.length) { erros.push({ linha: n, email: p.email || texto(l?.email, 60), nome: p.nome || texto(l?.nome, 60), motivo: problemas.join(' ') }); return; }
    const atual = porEmail.get(p.email);
    p.id = atual ? atual.id : null;
    p.situacao = !atual ? 'novo' : retrato(atual) === retratoDaLinha(p) ? 'igual' : 'atualizado';
    pessoas.push(p);
  });
  /* Turma que a planilha dá a alguém mas hoje é de uma pessoa fora da planilha: conflito, como na tela. */
  const idsNaPlanilha = new Set(pessoas.map(p => p.id).filter(Boolean));
  for (const p of pessoas) for (const t of p.turmas) {
    const dona = atuais.find(x => x.redacao.turmas.includes(t) && x.id !== p.id && !idsNaPlanilha.has(x.id));
    if (dona) erros.push({ linha: p.linha, email: p.email, nome: p.nome, motivo: 'A turma de redação já é de ' + dona.nome + ', que não está na planilha. Inclua essa pessoa na planilha sem a turma, ou retire a turma dela na tela.' });
  }
  const cont = s => pessoas.filter(p => p.situacao === s).length;
  return { ano, linhas: linhas.length, novos: cont('novo'), atualizados: cont('atualizado'), iguais: cont('igual'),
    supervisores: [...supervisores.keys()].sort().map(d => ({ disciplina: d, nome: pessoas.find(p => p.banco === 'supervisor' && p.disciplina === d)?.nome || '' })),
    erros: erros.sort((a, b) => a.linha - b.linha), pessoas };
}

/* Importação: grava cada linha pelo salvarPessoa (as mesmas regras da tela) e define os supervisores. */
export async function importarPessoas(env, prep, h) {
  if (prep.erros.length) erro(409, 'A planilha tem ' + prep.erros.length + ' linha(s) com problema. Corrija e confira de novo antes de importar.');
  const corpo = p => ({ nome: p.nome, email: p.email, ativo: p.ativo, acesso_ate: p.acesso_ate,
    banco: p.banco === 'digitador' ? { tipo: 'digitador' } : p.banco ? { tipo: 'professor', disciplina: p.disciplina, classificador: p.classificador } : null,
    redacao: { professor: p.turmas.length ? { turmas: p.turmas } : null, digitalizador: p.unidades.length ? { unidades: p.unidades } : null },
    coordenacao: p.coordenacao });
  /* 1) Quem é novo entra primeiro sem turma (para a turma poder vir de outra linha da planilha). */
  for (const p of prep.pessoas) if (!p.id) p.id = await salvarPessoa(env, null, { ...corpo(p), redacao: { professor: null, digitalizador: null }, coordenacao: [] }, h);
  /* 2) Solta as turmas de todo mundo que está na planilha; cada um recebe a sua de volta no passo 3. */
  const ids = prep.pessoas.map(p => p.id);
  for (let i = 0; i < ids.length; i += 100) {
    const fatia = ids.slice(i, i + 100);
    await env.DB.prepare(`DELETE FROM redacao_professor_turmas WHERE usuario_id IN (${fatia.map(() => '?').join(',')})`).bind(...fatia).run();
  }
  /* 3) Grava cada linha por inteiro. */
  for (const p of prep.pessoas) if (p.situacao !== 'igual' || p.turmas.length) await salvarPessoa(env, p.id, corpo(p), h);
  /* 4) Supervisores: um por disciplina; quem veio como PROFESSOR deixa de ser supervisor. */
  const ops = [];
  for (const p of prep.pessoas) if (p.banco === 'professor') ops.push(env.DB.prepare("UPDATE usuarios SET papel = 'professor' WHERE id = ? AND papel = 'supervisor'").bind(p.id));
  for (const p of prep.pessoas) if (p.banco === 'supervisor') {
    ops.push(env.DB.prepare("UPDATE usuarios SET papel = 'professor' WHERE papel = 'supervisor' AND disciplina = ? AND id <> ?").bind(p.disciplina, p.id));
    ops.push(env.DB.prepare("UPDATE usuarios SET papel = 'supervisor' WHERE id = ?").bind(p.id));
  }
  if (ops.length) await env.DB.batch(ops);
  await h.registrar(env, 'pessoas_importadas', { adm: h.sessao.email, linhas: prep.linhas, novos: prep.novos, atualizados: prep.atualizados, iguais: prep.iguais, supervisores: prep.supervisores });
}

export async function rotaPessoasPlanilha(env, path, body, h) {
  const ano = Number(h.hojeSP(env).slice(0, 4));
  const prep = await prepararPessoas(env, Array.isArray(body.pessoas) ? body.pessoas : [], ano, h);
  const resumo = { ok: true, ano, linhas: prep.linhas, novos: prep.novos, atualizados: prep.atualizados, iguais: prep.iguais, erros: prep.erros, supervisores: prep.supervisores,
    detalhes: prep.pessoas.filter(p => p.situacao !== 'igual').map(p => ({ linha: p.linha, nome: p.nome, situacao: p.situacao })) };
  if (path.endsWith('/previa')) return resumo;
  await importarPessoas(env, prep, h);
  return { ...resumo, pessoas: await listarPessoas(env) };
}
