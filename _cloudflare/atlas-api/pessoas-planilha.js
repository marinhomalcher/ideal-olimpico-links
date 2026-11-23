// "Cadastros e funções" pela planilha (23/11/2026): a planilha é só do banco de questões. O ADM baixa, edita
// no Excel (corrige nomes, inclui gente nova, troca disciplina ou função) e manda de volta; a prévia confere
// tudo sem gravar e a importação grava pelo mesmo salvarPessoa da tela. Uma linha por pessoa:
//   NOME COMPLETO | E-MAIL | DISCIPLINA
// Quem tem disciplina é professor dela; "Redação" na disciplina marca a pessoa como professora de
// redação (a turma dela é escolhida na tela). Supervisor e digitador são definidos na tela; a planilha
// não rebaixa ninguém. Quem já tiver uma quarta coluna FUNÇÃO (PROFESSOR, SUPERVISOR,
// DIGITADOR ou REDAÇÃO) continua sendo atendido, mas o modelo baixado não a traz mais.
// Redação, digitalização, coordenação, prazo de acesso e ativo/inativo NÃO vêm na planilha: são feitos na
// tela e a importação os mantém como estão. Quem não está na planilha também não é tocado.
import { RedacaoError } from './redacao-cadastros.js';
import { listarPessoas, salvarPessoa } from './pessoas.js';

const erro = (status, mensagem) => { throw new RedacaoError(status, mensagem); };
export const COLUNAS = Object.freeze(['NOME COMPLETO', 'E-MAIL', 'DISCIPLINA']);
export const COLUNA_OPCIONAL = 'FUNÇÃO';
const MAX_LINHAS = 500;

const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const chave = s => semAcento(s).trim().toUpperCase().replace(/\s+/g, ' ');
const texto = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/* Lê uma linha da planilha e devolve o cadastro pronto (ou a lista de problemas dela). */
function lerLinha(l, n, h, atual) {
  const problemas = [], p = { linha: n };
  const falha = m => { problemas.push(m); };
  try { p.nome = h.limparNome(l.nome); } catch (e) { falha(e.message); }
  try { p.email = h.limparEmail(l.email); } catch (e) { falha(e.message); }
  const disc = chave(l.disciplina);
  const funcao = chave(l.funcao);
  // "Redação" não é disciplina do banco de questões: a linha serve só para cadastrar a pessoa, e a turma
  // de redação é escolhida no site. Vale escrito na FUNÇÃO ou na DISCIPLINA (é como o ADM costuma anotar).
  const soCadastro = funcao === 'REDACAO' || disc === 'REDACAO';
  p.redacao = soCadastro;                                  // escreveu Redação: marca a função de redação
  p.disciplina = (disc && !soCadastro) ? (h.DISCIPLINAS.find(d => chave(d) === disc) || null) : null;
  if (disc && !soCadastro && !p.disciplina) falha('Disciplina desconhecida: ' + texto(l.disciplina, 40) + '.');
  const supervisorHoje = !!atual && atual.papel === 'supervisor' && !!atual.disciplina;
  if (soCadastro) p.banco = undefined;                     // só cadastro: não mexe no banco de questões
  else if (['PROFESSOR', 'PROFESSORA', 'PROF'].includes(funcao)) p.banco = 'professor';
  else if (['SUPERVISOR', 'SUPERVISORA'].includes(funcao)) p.banco = 'supervisor';
  else if (['DIGITADOR', 'DIGITADORA'].includes(funcao)) p.banco = 'digitador';
  else if (funcao) falha('Função: use PROFESSOR, SUPERVISOR, DIGITADOR, REDAÇÃO ou deixe em branco (em branco com disciplina = professor).');
  // Sem a coluna FUNÇÃO a planilha não diz se a pessoa é professor ou supervisor: quem já é supervisor
  // da mesma disciplina continua supervisor. Para rebaixar alguém, escreva PROFESSOR na FUNÇÃO ou use a tela.
  else if (p.disciplina && supervisorHoje && p.disciplina === atual.disciplina) p.banco = 'supervisor';
  else if (p.disciplina) p.banco = 'professor';          // o caso comum: basta nome, e-mail e disciplina
  else p.banco = undefined;                              // sem função no banco: não mexe no que a pessoa já é
  if ((p.banco === 'professor' || p.banco === 'supervisor') && !p.disciplina && !disc) falha('Informe a disciplina.');
  if (p.banco === 'digitador') p.disciplina = null;      // digitador do ADM não tem disciplina
  if (p.banco === undefined && !soCadastro && !atual) falha('Informe a disciplina para cadastrar alguém novo.');
  return { p, problemas };
}

/* Linha que não diz nada sobre o banco de questões: REDAÇÃO, ou disciplina e função em branco. */
const soCadastroDaLinha = l => {
  const d = chave(l?.disciplina), f = chave(l?.funcao);
  return f === 'REDACAO' || d === 'REDACAO' || (!d && !f);
};

/* O que a pessoa é hoje, só nas partes que a planilha controla, para saber se a linha muda algo. */
const bancoAtual = x => x.digitador ? 'digitador' : x.disciplina ? (x.papel === 'supervisor' ? 'supervisor' : 'professor') : null;
const retrato = x => JSON.stringify({ nome: x.nome, banco: bancoAtual(x), disciplina: x.disciplina || null, redacao: !!x.redacao.professor });
const retratoDaLinha = (p, atual) => JSON.stringify({ nome: p.nome,
  banco: p.banco === undefined ? (atual ? bancoAtual(atual) : null) : p.banco,
  disciplina: p.banco === undefined ? (atual ? atual.disciplina || null : null) : p.disciplina,
  redacao: p.redacao || (atual ? !!atual.redacao.professor : false) });

/* Prévia: confere a planilha inteira sem gravar nada. */
export async function prepararPessoas(env, linhas, ano, h) {
  if (!Array.isArray(linhas)) erro(400, 'Dados inválidos.');
  if (linhas.length > MAX_LINHAS) erro(400, 'A planilha tem mais de ' + MAX_LINHAS + ' linhas.');
  const atuais = await listarPessoas(env);
  const porEmail = new Map(atuais.map(x => [String(x.email).toLowerCase(), x]));
  const erros = [], pessoas = [], vistos = new Map(), supervisores = new Map();
  /* A mesma pessoa em duas linhas, uma delas só cadastro (REDAÇÃO ou em branco): a de só cadastro não
     acrescenta nada e é descartada. É como o ADM anota quem dá aula de uma disciplina e também corrige
     redação. Duas linhas com disciplinas diferentes continuam sendo erro. */
  const email_ = l => { try { return h.limparEmail((l || {}).email); } catch (e) { return ''; } };
  const comBanco = new Set();
  for (const l of linhas) { const e = email_(l); if (e && !soCadastroDaLinha(l)) comBanco.add(e); }
  let repetidas = 0;
  linhas.forEach((l, i) => {
    const n = Number(l?.linha) || i + 2;
    const email = email_(l);
    if (email && soCadastroDaLinha(l) && comBanco.has(email)) { repetidas++; return; }
    const atual = email ? porEmail.get(email) : null;
    const { p, problemas } = lerLinha(l || {}, n, h, atual);
    if (p.email) {
      if (vistos.has(p.email)) problemas.push('E-mail repetido na planilha (linha ' + vistos.get(p.email) + ').');
      vistos.set(p.email, n);
    }
    if (p.banco === 'supervisor' && p.disciplina) {
      if (supervisores.has(p.disciplina)) problemas.push('Duas pessoas marcadas como supervisor de ' + p.disciplina + ' (linha ' + supervisores.get(p.disciplina) + ').');
      supervisores.set(p.disciplina, n);
      if (atual && !atual.ativo) problemas.push('Supervisor precisa estar ativo (ative a pessoa na tela).');
    }
    if (problemas.length) { erros.push({ linha: n, email: p.email || texto(l?.email, 60), nome: p.nome || texto(l?.nome, 60), motivo: problemas.join(' ') }); return; }
    p.id = atual ? atual.id : null;
    p.classificador = atual ? !!atual.classificador : false;   // a planilha não mexe no classificador
    p.atualRedacao = atual ? atual.redacao : null;             // para marcar a redação sem perder turma nem unidades
    p.situacao = !atual ? 'novo' : retrato(atual) === retratoDaLinha(p, atual) ? 'igual' : 'atualizado';
    pessoas.push(p);
  });
  const cont = s => pessoas.filter(p => p.situacao === s).length;
  return { ano, linhas: linhas.length, repetidas, novos: cont('novo'), atualizados: cont('atualizado'), iguais: cont('igual'),
    supervisores: [...supervisores.keys()].sort().map(d => ({ disciplina: d, nome: pessoas.find(p => p.banco === 'supervisor' && p.disciplina === d)?.nome || '' })),
    erros: erros.sort((a, b) => a.linha - b.linha), pessoas };
}

/* Importação: grava cada linha pelo salvarPessoa (as mesmas regras da tela) e define os supervisores.
   Só vão no corpo as partes que a planilha controla; o resto fica como está no banco. */
export async function importarPessoas(env, prep, h) {
  if (prep.erros.length) erro(409, 'A planilha tem ' + prep.erros.length + ' linha(s) com problema. Corrija e confira de novo antes de importar.');
  const corpo = p => {
    const c = { nome: p.nome, email: p.email };
    if (p.banco !== undefined) {
      c.banco = p.banco === 'digitador' ? { tipo: 'digitador' }
        : { tipo: 'professor', disciplina: p.disciplina, classificador: p.classificador };
    }
    /* Só quando a planilha escreveu Redação: marca a função mantendo a turma e as unidades de hoje. */
    if (p.redacao) {
      const r = p.atualRedacao || {};
      c.redacao = { professor: { turmas: r.turmas || [] }, digitalizador: r.digitalizador ? { unidades: r.unidades || [] } : null };
    }
    return c;
  };
  for (const p of prep.pessoas) {
    if (!p.id) p.id = await salvarPessoa(env, null, corpo(p), h);
    else if (p.situacao !== 'igual') await salvarPessoa(env, p.id, corpo(p), h);
  }
  /* Supervisores: um por disciplina; quem veio como PROFESSOR deixa de ser supervisor. */
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
  const resumo = { ok: true, ano, linhas: prep.linhas, repetidas: prep.repetidas, novos: prep.novos, atualizados: prep.atualizados, iguais: prep.iguais, erros: prep.erros, supervisores: prep.supervisores,
    detalhes: prep.pessoas.filter(p => p.situacao !== 'igual').map(p => ({ linha: p.linha, nome: p.nome, situacao: p.situacao })) };
  if (path.endsWith('/previa')) return resumo;
  await importarPessoas(env, prep, h);
  return { ...resumo, pessoas: await listarPessoas(env) };
}
