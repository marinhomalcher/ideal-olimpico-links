// Aprovação das provas pelos professores — etapa B (decisões do Marinho em 27/11/2026; desenho em DESENHO_APROVACAO_PROVAS.md).
// Quando o supervisor finaliza a seleção de uma prova, os professores da MESMA disciplina e da MESMA série (professor_series)
// recebem só um aviso por e-mail (sem a prova) e avaliam dentro do ATLAS, questão por questão: "Concordo" ou pedido de mudança
// ("Trocar a questão" ou "Corrigir texto ou gabarito"). Prazo de 3 dias úteis pelo calendário de Belém. Quando todos aprovam,
// a seleção fica "liberada" e o supervisor ganha o botão "Enviar para o diagramador". Etapas C (respostas do supervisor,
// tréplica) e D (agendador, prazo, relatórios) vêm depois.
//
// Segurança: só quem tem linha em avaliacao_professores vê a seleção (professor da disciplina e da série, nunca de outra);
// a questão vai ao navegador na versão congelada ao finalizar; cada abertura fica em avaliacao_visualizacoes; o nome do autor
// da questão não sai; o e-mail não leva conteúdo da prova. O navegador desenha a questão em imagem com marca-d'água
// ("GRUPO IDEAL · uso interno" + código do professor): inibe cópia, não impede foto de tela.
import { RedacaoError } from './redacao-cadastros.js';
import { diasNaoUteis, prazoEmDiasUteis, diasUteisAte } from './diasuteis.js';
import { NOME_MODALIDADE, dataBR } from './prova-word.js';
import { tabelaDeCodigos } from './codigo-supervisor.js';

const erro = (status, mensagem) => { throw new RedacaoError(status, mensagem); };
const LINK_ATLAS = 'https://idealolimpico.com.br/atlas/';
const PRAZO_DIAS_UTEIS = 3;
const PEDIDO_HORAS = 24;                         // horas corridas para o supervisor responder (usado pela etapa C)
const TIPOS_PEDIDO = Object.freeze({ trocar: 'Trocar a questão', corrigir: 'Corrigir texto ou gabarito' });
const PEDIDO_ENCERRADO = "('aceito','aceito_auto','decidido_adm')";
const agora = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const nomeProva = p => p.serie + 'ª série · ' + p.tipo + ' · ' + (NOME_MODALIDADE[p.modalidade] || p.modalidade);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* "AAAA-MM-DDTHH:MM:SSZ" -> "DD/MM/AAAA às HHhMM" no relógio de Belém (UTC-3 o ano todo). */
export function dataHoraBelem(iso) {
  const d = new Date(new Date(iso).getTime() - 3 * 3600000);
  if (Number.isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' às ' + p(d.getUTCHours()) + 'h' + p(d.getUTCMinutes());
}

// ---------- quem avalia ----------
/* Professores ativos da disciplina que lecionam na série da prova (qualquer turma). Colaboradores (digitador) ficam de fora. */
async function professoresQueAvaliam(env, disciplina, serie) {
  const { results } = await env.DB.prepare(
    "SELECT u.id, u.nome, u.email FROM usuarios u JOIN professor_series ps ON ps.usuario_id = u.id AND ps.serie = ? " +
    "WHERE u.papel = 'professor' AND u.ativo = 1 AND u.disciplina = ? AND COALESCE(u.digitador, 0) = 0 " +
    "AND (u.acesso_ate IS NULL OR u.acesso_ate >= date('now','-3 hours')) ORDER BY u.nome COLLATE NOCASE"
  ).bind(Number(serie), disciplina).all();
  return results;
}

// ---------- e-mail de aviso (só o aviso; a prova não vai) ----------
export function emailAvisoAvaliacao({ nome, disciplina, prova, prazoEm, total }) {
  const nomeP = nomeProva(prova);
  const prazoTxt = dataHoraBelem(prazoEm);
  const link = LINK_ATLAS + 'professor-avaliar.html';
  const assunto = 'ATLAS: há uma avaliação aguardando a sua aprovação (' + nomeP + ')';
  const texto = 'Olá, ' + nome + '!\n\n' +
    'O supervisor de ' + disciplina + ' escolheu as ' + total + ' questões de ' + disciplina + ' da prova ' + nomeP +
    ' (' + prova.bimestre + 'º bimestre), que será aplicada em ' + dataBR(prova.aplicacao) + '.\n\n' +
    'Prazo: ' + PRAZO_DIAS_UTEIS + ' dias úteis, até ' + prazoTxt + '.\n\n' +
    'Avalie no ATLAS: ' + link + '\n\n' +
    'Por segurança, a prova não vai neste e-mail: você a vê dentro do ATLAS, com o seu login.\n\nATLAS · Grupo Educacional Ideal';
  const html = '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#eeeaeb;font-family:Arial,Helvetica,sans-serif;color:#30282b">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#fff;border-radius:18px;overflow:hidden">' +
    '<tr><td style="background:#b71c2a;background-image:linear-gradient(90deg,#e8506a,#98151d);padding:26px 34px;color:#fff;font-size:22px;font-weight:bold;letter-spacing:.12em">ATLAS</td></tr>' +
    '<tr><td style="padding:26px 34px 10px;font-size:13px;color:#70676b">Para: ' + esc(nome) + '</td></tr>' +
    '<tr><td style="padding:0 34px 12px;font-size:24px;line-height:1.25;font-weight:bold;color:#98151d">Há uma avaliação aguardando a sua aprovação</td></tr>' +
    '<tr><td style="padding:0 34px 18px;font-size:16px;line-height:1.5">O supervisor de ' + esc(disciplina) + ' escolheu as ' + total + ' questões de ' + esc(disciplina) + ' da prova <b>' + esc(nomeP) + '</b> (' + prova.bimestre + 'º bimestre), que será aplicada em <b>' + esc(dataBR(prova.aplicacao)) + '</b>.</td></tr>' +
    '<tr><td style="padding:0 34px 22px"><div style="border:2px solid #f2a20c;background:#fff6e0;border-radius:12px;padding:14px 18px;font-size:16px;font-weight:bold;color:#7a5600">Prazo: ' + PRAZO_DIAS_UTEIS + ' dias úteis, até ' + esc(prazoTxt) + '</div></td></tr>' +
    '<tr><td style="padding:0 34px 20px" align="center"><a href="' + link + '" style="display:block;background:#e8690b;background-image:linear-gradient(90deg,#f2a20c,#e8500f);color:#fff;text-decoration:none;font-size:18px;font-weight:bold;letter-spacing:.04em;padding:18px 24px;border-radius:999px;text-align:center">AVALIAR AGORA →</a></td></tr>' +
    '<tr><td style="padding:0 34px 30px;font-size:13px;color:#70676b;line-height:1.5">Por segurança, a prova não vai neste e-mail: você a vê dentro do ATLAS, com o seu login.<br>Se o botão não abrir, copie este endereço: ' + link + '</td></tr>' +
    '</table></td></tr></table></body></html>';
  return { assunto, texto, html };
}

// ---------- abertura (chamada por "Finalizar prova" do supervisor) ----------
/* Congela as versões das questões, grava a fase e o prazo, cria uma linha por professor e manda os avisos.
   Devolve null quando não há professor para avaliar (a seleção nasce "liberada"); senão { fase, prazo_em, professores }. */
export async function abrirAvaliacao(env, sel, prova, h) {
  const profs = await professoresQueAvaliam(env, sel.disciplina, prova.serie);
  const t = agora();
  const prazo = prazoEmDiasUteis(t, PRAZO_DIAS_UTEIS, await diasNaoUteis(env));
  const fase = profs.length ? 'avaliacao' : 'liberada';
  const ops = [
    env.DB.prepare('DELETE FROM avaliacao_mensagens WHERE pedido_id IN (SELECT id FROM avaliacao_pedidos WHERE selecao_id = ?)').bind(sel.id),
    ...['avaliacao_pedidos', 'avaliacao_votos', 'avaliacao_visualizacoes', 'avaliacao_professores'].map(tb => env.DB.prepare('DELETE FROM ' + tb + ' WHERE selecao_id = ?').bind(sel.id)),
    env.DB.prepare('UPDATE selecao_itens SET versao = (SELECT versao_atual FROM itens WHERE itens.id = selecao_itens.item_id), ' +
      'grupo_versao = (SELECT g.versao_atual FROM grupos g JOIN itens it ON it.grupo_id = g.id WHERE it.id = selecao_itens.item_id) WHERE selecao_id = ?').bind(sel.id),
    env.DB.prepare('UPDATE selecoes SET fase = ?, avaliacao_aberta_em = ?, avaliacao_prazo_em = ?, liberada_em = ?, atualizado_em = ? WHERE id = ?')
      .bind(fase, t, prazo, fase === 'liberada' ? t : null, t, sel.id),
    ...profs.map(p => env.DB.prepare('INSERT INTO avaliacao_professores (selecao_id, professor_id, avisado_em) VALUES (?, ?, ?)').bind(sel.id, p.id, t))
  ];
  await env.DB.batch(ops);
  await h.registrar(env, 'avaliacao_aberta', { selecao: sel.id, prova: prova.id, fase, prazo, professores: profs.map(p => p.id) }, sel.supervisor_id);
  if (!profs.length) return null;
  const total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM selecao_itens WHERE selecao_id = ?').bind(sel.id).first()).n;
  for (const p of profs) {
    const m = emailAvisoAvaliacao({ nome: p.nome, disciplina: sel.disciplina, prova, prazoEm: prazo, total });
    h.avisar(env, p.email, m.assunto, m.texto, false, m.html);
  }
  return { fase, prazo_em: prazo, professores: profs.length };
}

/* Resumo para o supervisor e o ADM (sem nomes: a etapa C mostra por código). */
export async function resumoAvaliacao(env, sel) {
  if (!sel.fase) return null;
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(decisao = 'aprovou') AS aprovaram, SUM(decisao = 'pediu_mudanca') AS pediram_mudanca, SUM(decisao = 'pendente') AS pendentes, " +
    "SUM(decisao = 'dispensado') AS dispensados, SUM(visto_completo_em IS NOT NULL) AS viram FROM avaliacao_professores WHERE selecao_id = ?"
  ).bind(sel.id).first();
  const ped = await env.DB.prepare('SELECT COUNT(*) AS n FROM avaliacao_pedidos WHERE selecao_id = ? AND estado NOT IN ' + PEDIDO_ENCERRADO).bind(sel.id).first();
  return { fase: sel.fase, aberta_em: sel.avaliacao_aberta_em, prazo_em: sel.avaliacao_prazo_em, liberada_em: sel.liberada_em,
    total: r.total || 0, aprovaram: r.aprovaram || 0, pediram_mudanca: r.pediram_mudanca || 0, pendentes: r.pendentes || 0, dispensados: r.dispensados || 0, viram: r.viram || 0, pedidos_abertos: ped.n };
}

/* Quando todos aprovaram (ou foram dispensados) e não há pedido em aberto, a seleção fica liberada e o supervisor é avisado. */
export async function liberarSeCompleta(env, selecaoId, h) {
  const s = await env.DB.prepare('SELECT s.*, (SELECT COUNT(*) FROM selecao_itens si WHERE si.selecao_id = s.id) AS total FROM selecoes s WHERE s.id = ?').bind(selecaoId).first();
  if (!s || s.fase !== 'avaliacao') return false;
  const pend = await env.DB.prepare("SELECT COUNT(*) AS n FROM avaliacao_professores WHERE selecao_id = ? AND decisao NOT IN ('aprovou','dispensado')").bind(s.id).first();
  const abertos = await env.DB.prepare('SELECT COUNT(*) AS n FROM avaliacao_pedidos WHERE selecao_id = ? AND estado NOT IN ' + PEDIDO_ENCERRADO).bind(s.id).first();
  if (pend.n || abertos.n) return false;
  const t = agora();
  const ok = await env.DB.prepare("UPDATE selecoes SET fase = 'liberada', liberada_em = ?, atualizado_em = ? WHERE id = ? AND fase = 'avaliacao' RETURNING id").bind(t, t, s.id).first();
  if (!ok) return false;
  await h.registrar(env, 'avaliacao_liberada', { selecao: s.id }, null);
  const prova = s.prova_id ? await env.DB.prepare('SELECT * FROM provas WHERE id = ?').bind(s.prova_id).first() : null;
  const destinos = new Set();
  const criador = await env.DB.prepare('SELECT email FROM usuarios WHERE id = ? AND ativo = 1').bind(s.supervisor_id).first();
  if (criador) destinos.add(criador.email);
  const atual = await h.supervisorDaDisciplina(env, s.disciplina);
  if (atual) destinos.add(atual.email);
  const nomeP = prova ? nomeProva(prova) : s.serie + 'ª série ' + s.tipo;
  for (const para of destinos) {
    h.avisar(env, para, 'ATLAS: os professores aprovaram a prova ' + nomeP + ' — pode enviar ao Diagramador',
      'Todos os professores de ' + s.disciplina + ' da ' + s.serie + 'ª série aprovaram a seleção #' + s.id + ' (' + nomeP + ').\n\n' +
      'Abra a seleção no ATLAS e clique no botão verde "Enviar para o diagramador":\n' + LINK_ATLAS + 'supervisor-selecoes.html?id=' + s.id);
  }
  return true;
}

// ---------- rotas do professor: /api/avaliacoes ----------
async function codigoDoProfessor(env, id) {
  const tabela = await tabelaDeCodigos(env, { obrigatorio: false });
  return tabela.porId.get(id) || null;
}
const SQL_AVALIACAO =
  'SELECT ap.selecao_id, ap.professor_id, ap.visto_ate, ap.visto_completo_em, ap.decisao, ap.decidido_em, ' +
  's.disciplina, s.situacao, s.fase, s.avaliacao_aberta_em, s.avaliacao_prazo_em, s.liberada_em, s.supervisor_id, ' +
  'p.id AS prova_id, p.serie, p.tipo, p.modalidade, p.bimestre, p.ano, p.aplicacao, p.situacao AS prova_situacao, ' +
  '(SELECT COUNT(*) FROM selecao_itens si WHERE si.selecao_id = s.id) AS total, ' +
  '(SELECT COUNT(*) FROM avaliacao_votos vo WHERE vo.selecao_id = s.id AND vo.professor_id = ap.professor_id) AS concordo, ' +
  '(SELECT COUNT(*) FROM avaliacao_pedidos pe WHERE pe.selecao_id = s.id AND pe.professor_id = ap.professor_id) AS pedidos, ' +
  "(SELECT COUNT(*) FROM avaliacao_pedidos pe WHERE pe.selecao_id = s.id AND pe.professor_id = ap.professor_id AND pe.estado <> 'aberto') AS pedidos_respondidos, " +
  "(SELECT COUNT(*) FROM avaliacao_pedidos pe WHERE pe.selecao_id = s.id AND pe.professor_id = ap.professor_id AND pe.estado = 'respondido') AS pedidos_aguardando_voce, " +
  "(SELECT COUNT(*) FROM avaliacao_pedidos pe WHERE pe.selecao_id = s.id AND pe.professor_id = ap.professor_id AND pe.estado NOT IN " + PEDIDO_ENCERRADO + ") AS pedidos_em_aberto " +
  'FROM avaliacao_professores ap JOIN selecoes s ON s.id = ap.selecao_id JOIN provas p ON p.id = s.prova_id ';

function publica(r, hoje, naoUteis) {
  const encerrado = !!r.avaliacao_prazo_em && r.avaliacao_prazo_em < agora();
  return {
    id: r.selecao_id, disciplina: r.disciplina, fase: r.fase, situacao: r.situacao,
    prova: { id: r.prova_id, serie: r.serie, tipo: r.tipo, modalidade: r.modalidade, bimestre: r.bimestre, ano: r.ano, aplicacao: r.aplicacao, situacao: r.prova_situacao, nome: nomeProva(r) },
    total: r.total, visto_ate: r.visto_ate, visto_completo_em: r.visto_completo_em, decisao: r.decisao, decidido_em: r.decidido_em,
    aberta_em: r.avaliacao_aberta_em, prazo_em: r.avaliacao_prazo_em, prazo_encerrado: encerrado,
    dias_uteis_restantes: r.avaliacao_prazo_em && !encerrado ? diasUteisAte(hoje, r.avaliacao_prazo_em, naoUteis) : 0,
    concordo: r.concordo, pedidos: r.pedidos, pedidos_respondidos: r.pedidos_respondidos, pedidos_aguardando_voce: r.pedidos_aguardando_voce, pedidos_em_aberto: r.pedidos_em_aberto
  };
}

async function avaliacaoDoProfessor(env, id, professorId) {
  const r = await env.DB.prepare(SQL_AVALIACAO + 'WHERE ap.selecao_id = ? AND ap.professor_id = ?').bind(Number(id), professorId).first();
  if (!r) erro(404, 'Avaliação não encontrada.');
  return r;
}
/* Questões da seleção na versão congelada ao finalizar (o texto do grupo também na versão congelada). */
async function questoesDaAvaliacao(env, selecaoId, h, comDados) {
  const { results } = await env.DB.prepare(
    'SELECT i.id, i.codigo, i.grupo_id, si.ordem, si.versao, si.grupo_versao' + (comDados ? ', v.dados' : '') + ' FROM selecao_itens si JOIN itens i ON i.id = si.item_id ' +
    (comDados ? 'JOIN item_versoes v ON v.item_id = i.id AND v.versao = COALESCE(si.versao, i.versao_atual) ' : '') +
    'WHERE si.selecao_id = ? ORDER BY si.ordem'
  ).bind(selecaoId).all();
  if (!comDados) return results;
  const out = [];
  for (const r of results) {
    const inj = await h.injetarGrupo(env, r.grupo_id, JSON.parse(r.dados), r.grupo_versao);
    out.push({ id: r.id, codigo: r.codigo, ordem: r.ordem, dados: inj.dados, grupo: inj.grupo ? { codigo: inj.grupo.codigo, membros: (inj.grupo.membros || []).map(m => m.codigo) } : null });
  }
  return out;
}
/* Só os campos que o professor precisa ver: nada de autor, tags internas ou histórico. */
function dadosParaVer(d) {
  const campos = ['etapa', 'ano', 'texto-base', 'referencia', 'textos_extras', 'layout', 'comando', 'alt-a', 'alt-b', 'alt-c', 'alt-d', 'alt-e', 'ref-a', 'ref-b', 'ref-c', 'ref-d', 'ref-e', 'gabarito', 'resolucao', 'assunto', 'subtema', 'dificuldade', 'bloom', 'origem', 'fonte', 'rich'];
  const o = {};
  for (const k of campos) if (d[k] !== undefined) o[k] = d[k];
  return o;
}
const ESTADO_NOME = Object.freeze({ aberto: 'Aguardando o supervisor', respondido: 'O supervisor respondeu', aceito: 'Aceito', aceito_auto: 'Aceito automaticamente', treplica: 'Tréplica: aguardando o supervisor', adm: 'Impasse: o ADM decide', decidido_adm: 'Decidido pelo ADM' });
const PEDIDO_ABERTO = p => !['aceito', 'aceito_auto', 'decidido_adm'].includes(p.estado);
async function mensagensDoPedido(env, pedidoId) {
  const { results } = await env.DB.prepare('SELECT autor, tipo, texto, criado_em FROM avaliacao_mensagens WHERE pedido_id = ? ORDER BY id').bind(pedidoId).all();
  return results;
}
function pedidoPublico(p, mensagens) {
  return { id: p.id, tipo: p.tipo, tipo_nome: TIPOS_PEDIDO[p.tipo], texto: p.texto, estado: p.estado, estado_nome: ESTADO_NOME[p.estado] || p.estado, rodada: p.rodada, prazo_em: p.prazo_em, criado_em: p.criado_em, atualizado_em: p.atualizado_em, aberto: PEDIDO_ABERTO(p), mensagens };
}
async function situacaoDasQuestoes(env, av) {
  const { results: votos } = await env.DB.prepare('SELECT item_id, em FROM avaliacao_votos WHERE selecao_id = ? AND professor_id = ?').bind(av.selecao_id, av.professor_id).all();
  const { results: pedidos } = await env.DB.prepare('SELECT * FROM avaliacao_pedidos WHERE selecao_id = ? AND professor_id = ? ORDER BY id').bind(av.selecao_id, av.professor_id).all();
  const voto = new Map(votos.map(v => [v.item_id, v.em]));
  const pedido = new Map();
  for (const p of pedidos) pedido.set(p.item_id, pedidoPublico(p, await mensagensDoPedido(env, p.id)));
  return { voto, pedido };
}
const podeMexer = av => {
  if (av.fase !== 'avaliacao') erro(409, 'Esta avaliação já foi encerrada.');
  if (av.decisao !== 'pendente') erro(409, 'Você já finalizou esta avaliação.');
};
/* Depois de um aceite ou de uma decisão do ADM: se o professor já respondeu a todas as questões e não tem pedido em aberto,
   a avaliação dele fecha como "aprovou" e a seleção pode ser liberada. */
async function concluirSePronto(env, selecaoId, professorId, h) {
  const ap = await env.DB.prepare('SELECT decisao FROM avaliacao_professores WHERE selecao_id = ? AND professor_id = ?').bind(selecaoId, professorId).first();
  if (!ap || !['pendente', 'pediu_mudanca'].includes(ap.decisao)) return false;
  const abertos = (await env.DB.prepare('SELECT COUNT(*) AS n FROM avaliacao_pedidos WHERE selecao_id = ? AND professor_id = ? AND estado NOT IN ' + PEDIDO_ENCERRADO).bind(selecaoId, professorId).first()).n;
  if (abertos) return false;
  const faltam = (await env.DB.prepare('SELECT COUNT(*) AS n FROM selecao_itens si WHERE si.selecao_id = ? AND NOT EXISTS (SELECT 1 FROM avaliacao_votos v WHERE v.selecao_id = si.selecao_id AND v.item_id = si.item_id AND v.professor_id = ?)').bind(selecaoId, professorId).first()).n;
  if (faltam) return false;
  const t = agora();
  await env.DB.prepare("UPDATE avaliacao_professores SET decisao = 'aprovou', decidido_em = ?, visto_ate = MAX(visto_ate, (SELECT COUNT(*) FROM selecao_itens WHERE selecao_id = ?)) WHERE selecao_id = ? AND professor_id = ?").bind(t, selecaoId, selecaoId, professorId).run();
  await h.registrar(env, 'avaliacao_finalizada', { selecao: selecaoId, decisao: 'aprovou', automatica: true }, professorId);
  await liberarSeCompleta(env, selecaoId, h);
  return true;
}
const mais24h = t => new Date(Date.parse(t) + PEDIDO_HORAS * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
async function cabecalhoDaSelecao(env, selecaoId) {
  const s = await env.DB.prepare('SELECT s.*, p.serie AS p_serie, p.tipo AS p_tipo, p.modalidade, p.bimestre, p.aplicacao, (SELECT COUNT(*) FROM selecao_itens si WHERE si.selecao_id = s.id) AS total FROM selecoes s LEFT JOIN provas p ON p.id = s.prova_id WHERE s.id = ?').bind(selecaoId).first();
  if (!s) erro(404, 'Seleção não encontrada.');
  s.nome = s.prova_id ? nomeProva({ serie: s.p_serie, tipo: s.p_tipo, modalidade: s.modalidade }) : s.serie + 'ª série ' + s.tipo;
  return s;
}
async function ordemDoItem(env, selecaoId, itemId) {
  const r = await env.DB.prepare('SELECT si.ordem, i.codigo FROM selecao_itens si JOIN itens i ON i.id = si.item_id WHERE si.selecao_id = ? AND si.item_id = ?').bind(selecaoId, itemId).first();
  if (r) return { n: r.ordem, codigo: r.codigo, na_selecao: true };
  const i = await env.DB.prepare('SELECT codigo FROM itens WHERE id = ?').bind(itemId).first();
  return { n: null, codigo: i ? i.codigo : '?', na_selecao: false };
}
async function emailsDoSupervisor(env, s, h) {
  const destinos = new Set();
  const criador = await env.DB.prepare('SELECT email FROM usuarios WHERE id = ? AND ativo = 1').bind(s.supervisor_id).first();
  if (criador) destinos.add(criador.email);
  const atual = await h.supervisorDaDisciplina(env, s.disciplina);
  if (atual) destinos.add(atual.email);
  return [...destinos];
}

export async function rotaAvaliacoesProfessor(request, env, path, user, h) {
  if (user.papel === 'digitador') erro(403, 'Área restrita aos professores.');
  const naoUteis = await diasNaoUteis(env);
  const hoje = h.hojeSP();

  if (path === '/api/avaliacoes' && request.method === 'GET') {
    const { results } = await env.DB.prepare(SQL_AVALIACAO + "WHERE ap.professor_id = ? ORDER BY (ap.decisao = 'pendente') DESC, s.avaliacao_prazo_em, s.id").bind(user.id).all();
    const avaliacoes = results.map(r => publica(r, hoje, naoUteis));
    return { ok: true, codigo: await codigoDoProfessor(env, user.id), pendentes: avaliacoes.filter(a => a.decisao === 'pendente' && a.fase === 'avaliacao').length, avaliacoes };
  }

  const m = path.match(/^\/api\/avaliacoes\/(\d+)(?:\/(finalizar|questao\/(\d+)(?:\/(voto|pedido))?|pedido\/(\d+)\/aceite))?$/);
  if (!m) erro(404, 'Rota indisponível.');
  const av = await avaliacaoDoProfessor(env, m[1], user.id);
  const total = av.total;
  const codigo = await codigoDoProfessor(env, user.id);

  // Resposta do professor à resposta do supervisor (etapa C): aceita, ou faz a tréplica; depois da tréplica, o impasse vai ao ADM.
  if (m[5] && request.method === 'POST') {
    const pedido = await env.DB.prepare('SELECT * FROM avaliacao_pedidos WHERE id = ? AND selecao_id = ? AND professor_id = ?').bind(Number(m[5]), av.selecao_id, user.id).first();
    if (!pedido) erro(404, 'Pedido não encontrado.');
    if (pedido.estado !== 'respondido') erro(409, 'Este pedido não está aguardando a sua resposta.');
    const body = await h.readJson(request);
    const t = agora();
    const s = await cabecalhoDaSelecao(env, av.selecao_id);
    const q = await ordemDoItem(env, av.selecao_id, pedido.item_id);
    if (body.aceito === true) {
      const ops = [
        env.DB.prepare("UPDATE avaliacao_pedidos SET estado = 'aceito', prazo_em = NULL, atualizado_em = ? WHERE id = ?").bind(t, pedido.id),
        env.DB.prepare("INSERT INTO avaliacao_mensagens (pedido_id, autor, tipo, texto, criado_em) VALUES (?, 'professor', 'aceite', ?, ?)").bind(pedido.id, String(body.texto ?? '').trim().slice(0, 2000), t)
      ];
      if (q.na_selecao) ops.push(env.DB.prepare('INSERT INTO avaliacao_votos (selecao_id, professor_id, item_id, voto, em) VALUES (?, ?, ?, ?, ?) ON CONFLICT(selecao_id, professor_id, item_id) DO UPDATE SET em = excluded.em').bind(av.selecao_id, user.id, pedido.item_id, 'concordo', t));
      await env.DB.batch(ops);
      await h.registrar(env, 'avaliacao_aceite', { selecao: av.selecao_id, pedido: pedido.id, questao: q.codigo }, user.id);
      const concluiu = await concluirSePronto(env, av.selecao_id, user.id, h);
      return { ok: true, pedido: pedidoPublico({ ...pedido, estado: 'aceito', prazo_em: null, atualizado_em: t }, await mensagensDoPedido(env, pedido.id)), concluiu };
    }
    const texto = String(body.texto ?? '').replace(/\r\n?/g, '\n').trim();
    if (texto.length < 3 || texto.length > 2000) erro(400, 'Explique por que não aceita a resposta (3 a 2000 caracteres).');
    if (pedido.rodada <= 1) {
      await env.DB.batch([
        env.DB.prepare("UPDATE avaliacao_pedidos SET estado = 'treplica', rodada = 2, prazo_em = ?, atualizado_em = ? WHERE id = ?").bind(mais24h(t), t, pedido.id),
        env.DB.prepare("INSERT INTO avaliacao_mensagens (pedido_id, autor, tipo, texto, criado_em) VALUES (?, 'professor', 'treplica', ?, ?)").bind(pedido.id, texto, t)
      ]);
      await h.registrar(env, 'avaliacao_treplica', { selecao: av.selecao_id, pedido: pedido.id, questao: q.codigo }, user.id);
      for (const para of await emailsDoSupervisor(env, s, h)) {
        h.avisar(env, para, 'ATLAS: tréplica de um professor na prova ' + s.nome + ' (questão ' + (q.n || q.codigo) + ')',
          'Um professor de ' + s.disciplina + ' não aceitou a sua resposta ao pedido de mudança da questão ' + (q.n || q.codigo) + ' da seleção #' + s.id + ' (' + s.nome + ').\n\n' +
          'Você tem 24 horas para responder de novo (ajustar a seleção ou manter com justificativa). Se o professor não aceitar, o administrador decide.\n\n' + LINK_ATLAS + 'supervisor-selecoes.html?id=' + s.id);
      }
      return { ok: true, pedido: pedidoPublico({ ...pedido, estado: 'treplica', rodada: 2, prazo_em: mais24h(t), atualizado_em: t }, await mensagensDoPedido(env, pedido.id)) };
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE avaliacao_pedidos SET estado = 'adm', prazo_em = NULL, atualizado_em = ? WHERE id = ?").bind(t, pedido.id),
      env.DB.prepare("INSERT INTO avaliacao_mensagens (pedido_id, autor, tipo, texto, criado_em) VALUES (?, 'professor', 'treplica', ?, ?)").bind(pedido.id, texto, t)
    ]);
    await h.registrar(env, 'avaliacao_impasse', { selecao: av.selecao_id, pedido: pedido.id, questao: q.codigo }, user.id);
    h.avisar(env, env.ADMIN_EMAIL, 'ATLAS: impasse na prova ' + s.nome + ' (' + s.disciplina + ', questão ' + (q.n || q.codigo) + ') — decisão do ADM',
      'Depois da tréplica, professor e supervisor de ' + s.disciplina + ' não chegaram a acordo sobre a questão ' + (q.n || q.codigo) + ' da seleção #' + s.id + ' (' + s.nome + ').\n\n' +
      'Decida em Avaliações: ' + LINK_ATLAS + 'admin-avaliacoes.html', true);
    return { ok: true, pedido: pedidoPublico({ ...pedido, estado: 'adm', prazo_em: null, atualizado_em: t }, await mensagensDoPedido(env, pedido.id)) };
  }

  // Resumo da avaliação: cabeçalho e a situação de cada questão (sem o conteúdo).
  if (!m[2] && request.method === 'GET') {
    const qs = await questoesDaAvaliacao(env, av.selecao_id, h, false);
    const { voto, pedido } = await situacaoDasQuestoes(env, av);
    return { ok: true, codigo, avaliacao: publica(av, hoje, naoUteis),
      questoes: qs.map((q, k) => ({ n: k + 1, concordo: voto.has(q.id), pedido: pedido.get(q.id) || null })) };
  }

  if (m[2] === 'finalizar' && request.method === 'POST') {
    podeMexer(av);
    const qs = await questoesDaAvaliacao(env, av.selecao_id, h, false);
    const { voto, pedido } = await situacaoDasQuestoes(env, av);
    if (av.visto_ate < total) erro(409, 'Você ainda não passou por todas as questões: faltam ' + (total - av.visto_ate) + '.');
    const sem = qs.map((q, k) => (voto.has(q.id) || (pedido.has(q.id) && pedido.get(q.id).aberto)) ? null : k + 1).filter(Boolean);
    if (sem.length) erro(409, (sem.length === 1 ? 'A questão ' + sem[0] + ' ainda está sem resposta.' : 'Faltam ' + sem.length + ' questões sem resposta: ' + sem.join(', ') + '.') + ' Marque "Concordo" ou peça mudança em cada uma.');
    const decisao = [...pedido.values()].some(p => p.aberto) ? 'pediu_mudanca' : 'aprovou';
    const t = agora();
    await env.DB.prepare("UPDATE avaliacao_professores SET decisao = ?, decidido_em = ? WHERE selecao_id = ? AND professor_id = ? AND decisao = 'pendente'").bind(decisao, t, av.selecao_id, user.id).run();
    await h.registrar(env, 'avaliacao_finalizada', { selecao: av.selecao_id, decisao, concordo: voto.size, pedidos: pedido.size }, user.id);
    const liberada = await liberarSeCompleta(env, av.selecao_id, h);
    return { ok: true, decisao, decidido_em: t, fase: liberada ? 'liberada' : av.fase };
  }

  const n = Number(m[3]);
  if (!(n >= 1 && n <= total)) erro(404, 'Questão não encontrada.');
  const qs = await questoesDaAvaliacao(env, av.selecao_id, h, m[4] ? false : true);
  const q = qs[n - 1];
  if (!q) erro(404, 'Questão não encontrada.');

  // Abrir a questão: registra a visualização e devolve o conteúdo (versão congelada) para o navegador desenhar.
  if (!m[4] && request.method === 'GET') {
    const t = agora();
    const ops = [
      env.DB.prepare('INSERT INTO avaliacao_visualizacoes (selecao_id, professor_id, item_id, em) VALUES (?, ?, ?, ?)').bind(av.selecao_id, user.id, q.id, t),
      env.DB.prepare('UPDATE avaliacao_professores SET visto_ate = MAX(visto_ate, ?) WHERE selecao_id = ? AND professor_id = ?').bind(n, av.selecao_id, user.id)
    ];
    if (n === total && !av.visto_completo_em) ops.push(env.DB.prepare('UPDATE avaliacao_professores SET visto_completo_em = ? WHERE selecao_id = ? AND professor_id = ? AND visto_completo_em IS NULL').bind(t, av.selecao_id, user.id));
    await env.DB.batch(ops);
    const { voto, pedido } = await situacaoDasQuestoes(env, av);
    return { ok: true, codigo, n, total, visto_ate: Math.max(av.visto_ate, n), visto_completo_em: av.visto_completo_em || (n === total ? t : null),
      questao: { codigo: q.codigo, dados: dadosParaVer(q.dados), grupo: q.grupo },
      concordo: voto.has(q.id), pedido: pedido.get(q.id) || null, tipos_pedido: TIPOS_PEDIDO };
  }

  if (m[4] === 'voto' && request.method === 'POST') {
    podeMexer(av);
    const body = await h.readJson(request);
    if (body.voto !== 'concordo') erro(400, 'Voto inválido.');
    const t = agora();
    // Pedido já respondido pelo supervisor (etapa C): concordar com a questão vale como aceite da resposta.
    const respondido = await env.DB.prepare("SELECT id FROM avaliacao_pedidos WHERE selecao_id = ? AND professor_id = ? AND item_id = ? AND estado = 'respondido'").bind(av.selecao_id, user.id, q.id).first();
    const pendente = await env.DB.prepare("SELECT id FROM avaliacao_pedidos WHERE selecao_id = ? AND professor_id = ? AND item_id = ? AND estado IN ('treplica','adm')").bind(av.selecao_id, user.id, q.id).first();
    if (pendente) erro(409, 'Este pedido está com o supervisor ou com o ADM: espere a resposta.');
    await env.DB.batch([
      env.DB.prepare("DELETE FROM avaliacao_mensagens WHERE pedido_id IN (SELECT id FROM avaliacao_pedidos WHERE selecao_id = ? AND professor_id = ? AND item_id = ? AND estado = 'aberto')").bind(av.selecao_id, user.id, q.id),
      env.DB.prepare("DELETE FROM avaliacao_pedidos WHERE selecao_id = ? AND professor_id = ? AND item_id = ? AND estado = 'aberto'").bind(av.selecao_id, user.id, q.id),
      ...(respondido ? [
        env.DB.prepare("UPDATE avaliacao_pedidos SET estado = 'aceito', prazo_em = NULL, atualizado_em = ? WHERE id = ?").bind(t, respondido.id),
        env.DB.prepare("INSERT INTO avaliacao_mensagens (pedido_id, autor, tipo, texto, criado_em) VALUES (?, 'professor', 'aceite', '', ?)").bind(respondido.id, t)] : []),
      env.DB.prepare('INSERT INTO avaliacao_votos (selecao_id, professor_id, item_id, voto, em) VALUES (?, ?, ?, ?, ?) ON CONFLICT(selecao_id, professor_id, item_id) DO UPDATE SET em = excluded.em').bind(av.selecao_id, user.id, q.id, 'concordo', t)
    ]);
    const { pedido } = await situacaoDasQuestoes(env, av);
    return { ok: true, n, concordo: true, pedido: pedido.get(q.id) || null };
  }

  if (m[4] === 'pedido' && request.method === 'POST') {
    podeMexer(av);
    const body = await h.readJson(request);
    const tipo = String(body.tipo || '');
    if (!TIPOS_PEDIDO[tipo]) erro(400, 'Escolha o tipo do pedido: trocar a questão ou corrigir texto ou gabarito.');
    const texto = String(body.texto ?? '').replace(/\r\n?/g, '\n').trim();
    if (texto.length < 3 || texto.length > 2000) erro(400, 'Explique ao supervisor o que precisa mudar (3 a 2000 caracteres).');
    const existente = await env.DB.prepare('SELECT id, estado FROM avaliacao_pedidos WHERE selecao_id = ? AND professor_id = ? AND item_id = ?').bind(av.selecao_id, user.id, q.id).first();
    if (existente && existente.estado !== 'aberto') erro(409, existente.estado === 'respondido' ? 'O supervisor já respondeu a este pedido: aceite a resposta ou faça a tréplica.' : PEDIDO_ABERTO(existente) ? 'Este pedido está com o supervisor ou com o ADM: espere a resposta.' : 'Este pedido já foi encerrado.');
    const t = agora();
    const prazo = new Date(Date.parse(t) + PEDIDO_HORAS * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const ops = [env.DB.prepare('DELETE FROM avaliacao_votos WHERE selecao_id = ? AND professor_id = ? AND item_id = ?').bind(av.selecao_id, user.id, q.id)];
    if (existente) ops.push(
      env.DB.prepare('DELETE FROM avaliacao_mensagens WHERE pedido_id = ?').bind(existente.id),
      env.DB.prepare('DELETE FROM avaliacao_pedidos WHERE id = ?').bind(existente.id));
    await env.DB.batch(ops);
    const row = await env.DB.prepare("INSERT INTO avaliacao_pedidos (selecao_id, professor_id, item_id, tipo, texto, estado, prazo_em, rodada, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, 'aberto', ?, 1, ?, ?) RETURNING id")
      .bind(av.selecao_id, user.id, q.id, tipo, texto, prazo, t, t).first();
    await env.DB.prepare("INSERT INTO avaliacao_mensagens (pedido_id, autor, tipo, texto, criado_em) VALUES (?, 'professor', 'pedido', ?, ?)").bind(row.id, texto, t).run();
    await h.registrar(env, 'avaliacao_pedido', { selecao: av.selecao_id, questao: q.codigo, pedido: row.id, tipo }, user.id);
    return { ok: true, n, concordo: false, pedido: pedidoPublico({ id: row.id, tipo, texto, estado: 'aberto', rodada: 1, prazo_em: prazo, criado_em: t, atualizado_em: t }, await mensagensDoPedido(env, row.id)) };
  }
  erro(404, 'Rota indisponível.');
}

// ---------- etapa C: supervisor responde, seleção muda, ADM decide ----------
/* Painel por professor. comNomes = false mostra só o código (supervisor); true mostra o nome (ADM). */
export async function painelAvaliacao(env, sel, h, comNomes) {
  const { results } = await env.DB.prepare(
    'SELECT ap.*, u.nome, (SELECT COUNT(*) FROM avaliacao_votos v WHERE v.selecao_id = ap.selecao_id AND v.professor_id = ap.professor_id) AS concordo ' +
    'FROM avaliacao_professores ap JOIN usuarios u ON u.id = ap.professor_id WHERE ap.selecao_id = ? ORDER BY u.nome COLLATE NOCASE'
  ).bind(sel.id).all();
  const tabela = await tabelaDeCodigos(env, { obrigatorio: false });
  const { results: pedidos } = await env.DB.prepare('SELECT * FROM avaliacao_pedidos WHERE selecao_id = ? ORDER BY id').bind(sel.id).all();
  const porProfessor = new Map();
  for (const p of pedidos) {
    const q = await ordemDoItem(env, sel.id, p.item_id);
    const pub = { ...pedidoPublico(p, await mensagensDoPedido(env, p.id)), n: q.n, questao: q.codigo, na_selecao: q.na_selecao, professor: tabela.porId.get(p.professor_id) || null, professor_id: comNomes ? p.professor_id : undefined };
    if (!porProfessor.has(p.professor_id)) porProfessor.set(p.professor_id, []);
    porProfessor.get(p.professor_id).push(pub);
  }
  const professores = results.map(r => ({
    codigo: tabela.porId.get(r.professor_id) || null, ...(comNomes ? { id: r.professor_id, nome: r.nome } : {}),
    visto_ate: r.visto_ate, visto_completo_em: r.visto_completo_em, decisao: r.decisao, decidido_em: r.decidido_em, avisado_em: r.avisado_em,
    dispensado_em: r.dispensado_em, concordo: r.concordo, pedidos: porProfessor.get(r.professor_id) || []
  }));
  return { ...(await resumoAvaliacao(env, sel)), professores, pedidos_abertos_lista: pedidos.filter(p => ['aberto', 'treplica'].includes(p.estado)).length, impasses: pedidos.filter(p => p.estado === 'adm').length };
}

/* A seleção mudou durante a avaliação (supervisor ajustou): congela as versões de novo, apaga os votos das questões
   alteradas ou retiradas e reabre a avaliação de quem já tinha aprovado uma delas. Devolve quem foi reaberto. */
export async function reavaliarAposMudanca(env, selecaoId, h, motivo) {
  const { results: itens } = await env.DB.prepare(
    'SELECT si.item_id, si.versao, si.grupo_versao, i.versao_atual, i.codigo, si.ordem, (SELECT g.versao_atual FROM grupos g WHERE g.id = i.grupo_id) AS grupo_atual FROM selecao_itens si JOIN itens i ON i.id = si.item_id WHERE si.selecao_id = ? ORDER BY si.ordem'
  ).bind(selecaoId).all();
  const mudados = itens.filter(x => x.versao !== null && (x.versao !== x.versao_atual || (x.grupo_versao !== null && x.grupo_atual !== null && x.grupo_versao !== x.grupo_atual)));
  const ids = itens.map(x => x.item_id);
  const ops = [
    env.DB.prepare('DELETE FROM avaliacao_votos WHERE selecao_id = ? AND item_id NOT IN (SELECT item_id FROM selecao_itens WHERE selecao_id = ?)').bind(selecaoId, selecaoId),
    ...mudados.map(x => env.DB.prepare('DELETE FROM avaliacao_votos WHERE selecao_id = ? AND item_id = ?').bind(selecaoId, x.item_id)),
    env.DB.prepare('UPDATE selecao_itens SET versao = (SELECT versao_atual FROM itens WHERE itens.id = selecao_itens.item_id), ' +
      'grupo_versao = (SELECT g.versao_atual FROM grupos g JOIN itens it ON it.grupo_id = g.id WHERE it.id = selecao_itens.item_id) WHERE selecao_id = ?').bind(selecaoId)
  ];
  await env.DB.batch(ops);
  // Quem já tinha aprovado e agora tem questão sem voto volta a "pendente" e é avisado.
  const { results: reabrir } = await env.DB.prepare(
    "SELECT ap.professor_id, u.email, u.nome FROM avaliacao_professores ap JOIN usuarios u ON u.id = ap.professor_id WHERE ap.selecao_id = ? AND ap.decisao = 'aprovou' AND " +
    '(SELECT COUNT(*) FROM avaliacao_votos v WHERE v.selecao_id = ap.selecao_id AND v.professor_id = ap.professor_id) < (SELECT COUNT(*) FROM selecao_itens si WHERE si.selecao_id = ap.selecao_id)'
  ).bind(selecaoId).all();
  if (reabrir.length) {
    await env.DB.batch(reabrir.map(r => env.DB.prepare("UPDATE avaliacao_professores SET decisao = 'pendente', decidido_em = NULL WHERE selecao_id = ? AND professor_id = ?").bind(selecaoId, r.professor_id)));
    const s = await cabecalhoDaSelecao(env, selecaoId);
    for (const r of reabrir) {
      h.avisar(env, r.email, 'ATLAS: a prova ' + s.nome + ' mudou — reveja a sua aprovação',
        'Olá, ' + r.nome + '!\n\nO supervisor de ' + s.disciplina + ' alterou a seleção da prova ' + s.nome + ' depois da sua aprovação' + (motivo ? ' (' + motivo + ')' : '') + '.\n\n' +
        'Abra a prova no ATLAS e aprove de novo só as questões que mudaram:\n' + LINK_ATLAS + 'professor-avaliar.html?id=' + s.id + '\n\nATLAS · Grupo Educacional Ideal');
    }
  }
  await h.registrar(env, 'avaliacao_selecao_alterada', { selecao: selecaoId, mudadas: mudados.map(x => x.codigo), reabertos: reabrir.map(r => r.professor_id), motivo: motivo || null }, null);
  return { mudadas: mudados.map(x => x.codigo), reabertos: reabrir.map(r => r.professor_id), itens: ids.length };
}

/* Rotas do supervisor: GET /api/supervisor/avaliacoes/:id (painel) e POST .../pedidos/:pid/responder { resposta: 'ajustei'|'mantido', texto }. */
export async function rotaAvaliacoesSupervisor(request, env, path, user, h) {
  const m = path.match(/^\/api\/supervisor\/avaliacoes\/(\d+)(?:\/pedidos\/(\d+)\/responder)?$/);
  if (!m) erro(404, 'Rota indisponível.');
  const sel = await env.DB.prepare('SELECT * FROM selecoes WHERE id = ? AND disciplina = ?').bind(Number(m[1]), user.disciplina).first();
  if (!sel) erro(404, 'Seleção não encontrada.');
  if (!m[2] && request.method === 'GET') return { ok: true, avaliacao: await painelAvaliacao(env, sel, h, false) };
  if (m[2] && request.method === 'POST') {
    if (sel.fase !== 'avaliacao') erro(409, 'Esta seleção não está em avaliação.');
    const pedido = await env.DB.prepare('SELECT * FROM avaliacao_pedidos WHERE id = ? AND selecao_id = ?').bind(Number(m[2]), sel.id).first();
    if (!pedido) erro(404, 'Pedido não encontrado.');
    if (!['aberto', 'treplica'].includes(pedido.estado)) erro(409, 'Este pedido não está aguardando a sua resposta.');
    const body = await h.readJson(request);
    const resposta = String(body.resposta || '');
    if (!['ajustei', 'mantido'].includes(resposta)) erro(400, 'Responda "ajustei" (depois de trocar ou corrigir a questão) ou "mantido" (com justificativa).');
    const texto = String(body.texto ?? '').replace(/\r\n?/g, '\n').trim();
    if (texto.length < 3 || texto.length > 2000) erro(400, 'Explique a sua resposta ao professor (3 a 2000 caracteres).');
    if (resposta === 'mantido' && pedido.rodada >= 3) erro(409, 'O administrador decidiu trocar a questão: ajuste a seleção e responda "ajustei".');
    const t = agora();
    const q = await ordemDoItem(env, sel.id, pedido.item_id);
    let mudanca = null;
    if (resposta === 'ajustei') {
      const si = await env.DB.prepare('SELECT si.versao, si.grupo_versao, i.versao_atual, (SELECT g.versao_atual FROM grupos g WHERE g.id = i.grupo_id) AS grupo_atual FROM selecao_itens si JOIN itens i ON i.id = si.item_id WHERE si.selecao_id = ? AND si.item_id = ?').bind(sel.id, pedido.item_id).first();
      const mudou = !si || si.versao === null || si.versao !== si.versao_atual || (si.grupo_versao !== null && si.grupo_atual !== null && si.grupo_versao !== si.grupo_atual);
      if (!mudou) erro(409, 'Nada mudou na questão ' + (q.n || q.codigo) + ': troque-a na seleção ou corrija-a no banco antes de responder "ajustei" — ou responda "mantido" com a justificativa.');
      mudanca = await reavaliarAposMudanca(env, sel.id, h, 'resposta ao pedido da questão ' + (q.n || q.codigo));
    }
    const fechaDireto = pedido.rodada >= 3;   // depois da decisão do ADM não há nova tréplica
    const novoEstado = fechaDireto ? 'decidido_adm' : 'respondido';
    const ops = [
      env.DB.prepare('UPDATE avaliacao_pedidos SET estado = ?, prazo_em = ?, atualizado_em = ? WHERE id = ?').bind(novoEstado, fechaDireto ? null : mais24h(t), t, pedido.id),
      env.DB.prepare("INSERT INTO avaliacao_mensagens (pedido_id, autor, tipo, texto, criado_em) VALUES (?, 'supervisor', ?, ?, ?)").bind(pedido.id, resposta, texto, t)
    ];
    // Quem pediu a mudança volta a avaliar a questão ajustada (o aceite grava o "concordo" dele).
    if (resposta === 'ajustei') ops.push(env.DB.prepare("UPDATE avaliacao_professores SET decisao = 'pendente', decidido_em = NULL WHERE selecao_id = ? AND professor_id = ? AND decisao = 'pediu_mudanca'").bind(sel.id, pedido.professor_id));
    await env.DB.batch(ops);
    await h.registrar(env, 'avaliacao_resposta', { selecao: sel.id, pedido: pedido.id, resposta, questao: q.codigo, rodada: pedido.rodada }, user.id);
    const prof = await env.DB.prepare('SELECT nome, email FROM usuarios WHERE id = ? AND ativo = 1').bind(pedido.professor_id).first();
    const s = await cabecalhoDaSelecao(env, sel.id);
    if (prof) h.avisar(env, prof.email, 'ATLAS: o supervisor respondeu ao seu pedido na prova ' + s.nome + ' (questão ' + (q.n || q.codigo) + ')',
      'Olá, ' + prof.nome + '!\n\nO supervisor de ' + s.disciplina + ' respondeu ao seu pedido de mudança da questão ' + (q.n || q.codigo) + ' da prova ' + s.nome + ': ' + (resposta === 'ajustei' ? 'ajustou a seleção' : 'manteve a questão, com justificativa') + '.\n\n' +
      (fechaDireto ? 'Como o administrador já tinha decidido, o pedido está encerrado.' : 'Você tem 24 horas para aceitar ou fazer a tréplica; sem resposta, vale como aceite.') + '\n\n' + LINK_ATLAS + 'professor-avaliar.html?id=' + s.id + '\n\nATLAS · Grupo Educacional Ideal');
    if (fechaDireto) await concluirSePronto(env, sel.id, pedido.professor_id, h);
    return { ok: true, pedido: pedidoPublico({ ...pedido, estado: novoEstado, atualizado_em: t }, await mensagensDoPedido(env, pedido.id)), mudanca };
  }
  erro(404, 'Rota indisponível.');
}

/* Rotas do ADM: GET /api/adm/avaliacoes/impasses, GET /api/adm/avaliacoes/:selecaoId (painel com nomes),
   POST /api/adm/avaliacoes/pedidos/:id/decidir { decisao: 'manter'|'trocar', texto }, POST /api/adm/avaliacoes/:selecaoId/dispensar/:professorId { motivo }. */
export async function rotaAvaliacoesAdm(request, env, path, h) {
  if (!path.startsWith('/api/adm/avaliacoes')) return null;
  if (path === '/api/adm/avaliacoes/impasses' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      "SELECT pe.*, u.nome AS professor_nome, s.disciplina, s.supervisor_id, (SELECT nome FROM usuarios WHERE id = s.supervisor_id) AS supervisor_nome FROM avaliacao_pedidos pe JOIN selecoes s ON s.id = pe.selecao_id JOIN usuarios u ON u.id = pe.professor_id WHERE pe.estado = 'adm' ORDER BY pe.atualizado_em"
    ).all();
    const impasses = [];
    for (const p of results) {
      const s = await cabecalhoDaSelecao(env, p.selecao_id);
      const q = await ordemDoItem(env, p.selecao_id, p.item_id);
      impasses.push({ ...pedidoPublico(p, await mensagensDoPedido(env, p.id)), selecao_id: p.selecao_id, prova: s.nome, disciplina: p.disciplina, professor: p.professor_nome, supervisor: p.supervisor_nome, n: q.n, questao: q.codigo, resumo: await resumoAvaliacao(env, s) });
    }
    return { ok: true, impasses };
  }
  let m = path.match(/^\/api\/adm\/avaliacoes\/pedidos\/(\d+)\/decidir$/);
  if (m && request.method === 'POST') {
    const pedido = await env.DB.prepare('SELECT * FROM avaliacao_pedidos WHERE id = ?').bind(Number(m[1])).first();
    if (!pedido) erro(404, 'Pedido não encontrado.');
    if (pedido.estado !== 'adm') erro(409, 'Este pedido não está aguardando a decisão do administrador.');
    const body = await h.readJson(request);
    const decisao = String(body.decisao || '');
    if (!['manter', 'trocar'].includes(decisao)) erro(400, 'Decida: manter a questão ou trocar (o supervisor escolhe outra).');
    const texto = String(body.texto ?? '').replace(/\r\n?/g, '\n').trim();
    if (texto.length < 3 || texto.length > 2000) erro(400, 'Escreva a justificativa da decisão (3 a 2000 caracteres).');
    const t = agora();
    const s = await cabecalhoDaSelecao(env, pedido.selecao_id);
    const q = await ordemDoItem(env, pedido.selecao_id, pedido.item_id);
    const ops = [env.DB.prepare("INSERT INTO avaliacao_mensagens (pedido_id, autor, tipo, texto, criado_em) VALUES (?, 'adm', 'decisao_adm', ?, ?)").bind(pedido.id, (decisao === 'manter' ? 'Decisão: manter a questão. ' : 'Decisão: trocar a questão. ') + texto, t)];
    if (decisao === 'manter') {
      ops.push(env.DB.prepare("UPDATE avaliacao_pedidos SET estado = 'decidido_adm', prazo_em = NULL, atualizado_em = ? WHERE id = ?").bind(t, pedido.id));
      if (q.na_selecao) ops.push(env.DB.prepare('INSERT INTO avaliacao_votos (selecao_id, professor_id, item_id, voto, em) VALUES (?, ?, ?, ?, ?) ON CONFLICT(selecao_id, professor_id, item_id) DO UPDATE SET em = excluded.em').bind(pedido.selecao_id, pedido.professor_id, pedido.item_id, 'concordo', t));
    } else {
      ops.push(env.DB.prepare("UPDATE avaliacao_pedidos SET estado = 'aberto', rodada = 3, prazo_em = ?, atualizado_em = ? WHERE id = ?").bind(mais24h(t), t, pedido.id));
    }
    await env.DB.batch(ops);
    await h.registrar(env, 'avaliacao_decisao_adm', { selecao: pedido.selecao_id, pedido: pedido.id, decisao, questao: q.codigo, adm: h.sessao ? h.sessao.email : null }, null);
    const prof = await env.DB.prepare('SELECT nome, email FROM usuarios WHERE id = ? AND ativo = 1').bind(pedido.professor_id).first();
    const assunto = 'ATLAS: decisão do administrador sobre a questão ' + (q.n || q.codigo) + ' da prova ' + s.nome;
    const corpo = 'O administrador decidiu o impasse da questão ' + (q.n || q.codigo) + ' da seleção #' + s.id + ' (' + s.nome + ', ' + s.disciplina + '): ' + (decisao === 'manter' ? 'a questão fica como está.' : 'a questão será trocada pelo supervisor.') + '\n\nJustificativa: ' + texto + '\n\n';
    if (prof) h.avisar(env, prof.email, assunto, corpo + LINK_ATLAS + 'professor-avaliar.html?id=' + s.id);
    for (const para of await emailsDoSupervisor(env, s, h)) h.avisar(env, para, assunto, corpo + (decisao === 'trocar' ? 'Troque a questão na seleção e responda "ajustei" em até 24 horas.\n' : '') + LINK_ATLAS + 'supervisor-selecoes.html?id=' + s.id);
    if (decisao === 'manter') await concluirSePronto(env, pedido.selecao_id, pedido.professor_id, h);
    return { ok: true, pedido: pedidoPublico({ ...pedido, estado: decisao === 'manter' ? 'decidido_adm' : 'aberto', rodada: decisao === 'manter' ? pedido.rodada : 3, atualizado_em: t }, await mensagensDoPedido(env, pedido.id)) };
  }
  m = path.match(/^\/api\/adm\/avaliacoes\/(\d+)\/dispensar\/(\d+)$/);
  if (m && request.method === 'POST') {
    const sel = await env.DB.prepare('SELECT * FROM selecoes WHERE id = ?').bind(Number(m[1])).first();
    if (!sel) erro(404, 'Seleção não encontrada.');
    const ap = await env.DB.prepare('SELECT * FROM avaliacao_professores WHERE selecao_id = ? AND professor_id = ?').bind(sel.id, Number(m[2])).first();
    if (!ap) erro(404, 'Professor não encontrado nesta avaliação.');
    if (['aprovou', 'dispensado'].includes(ap.decisao)) erro(409, ap.decisao === 'aprovou' ? 'Este professor já aprovou.' : 'Este professor já foi dispensado.');
    const body = await h.readJson(request);
    const motivo = String(body.motivo ?? '').trim().slice(0, 2000);
    const t = agora();
    const { results: abertos } = await env.DB.prepare('SELECT id FROM avaliacao_pedidos WHERE selecao_id = ? AND professor_id = ? AND estado NOT IN ' + PEDIDO_ENCERRADO).bind(sel.id, ap.professor_id).all();
    await env.DB.batch([
      env.DB.prepare("UPDATE avaliacao_professores SET decisao = 'dispensado', dispensado_por = ?, dispensado_em = ?, decidido_em = ? WHERE selecao_id = ? AND professor_id = ?").bind(h.sessao ? h.sessao.email : 'adm', t, t, sel.id, ap.professor_id),
      ...abertos.flatMap(p => [
        env.DB.prepare("UPDATE avaliacao_pedidos SET estado = 'decidido_adm', prazo_em = NULL, atualizado_em = ? WHERE id = ?").bind(t, p.id),
        env.DB.prepare("INSERT INTO avaliacao_mensagens (pedido_id, autor, tipo, texto, criado_em) VALUES (?, 'adm', 'decisao_adm', ?, ?)").bind(p.id, 'Professor dispensado desta avaliação pelo administrador.' + (motivo ? ' ' + motivo : ''), t)])
    ]);
    await h.registrar(env, 'avaliacao_dispensa', { selecao: sel.id, professor: ap.professor_id, motivo, adm: h.sessao ? h.sessao.email : null }, null);
    const s = await cabecalhoDaSelecao(env, sel.id);
    const prof = await env.DB.prepare('SELECT nome, email FROM usuarios WHERE id = ? AND ativo = 1').bind(ap.professor_id).first();
    if (prof) h.avisar(env, prof.email, 'ATLAS: você foi dispensado da avaliação da prova ' + s.nome, 'Olá, ' + prof.nome + '!\n\nO administrador dispensou você da avaliação da prova ' + s.nome + ' (' + s.disciplina + ').' + (motivo ? '\n\nMotivo: ' + motivo : '') + '\n\nATLAS · Grupo Educacional Ideal');
    const liberada = await liberarSeCompleta(env, sel.id, h);
    return { ok: true, professor_id: ap.professor_id, decisao: 'dispensado', liberada };
  }
  m = path.match(/^\/api\/adm\/avaliacoes\/(\d+)$/);
  if (m && request.method === 'GET') {
    const sel = await env.DB.prepare('SELECT * FROM selecoes WHERE id = ?').bind(Number(m[1])).first();
    if (!sel) erro(404, 'Seleção não encontrada.');
    return { ok: true, avaliacao: await painelAvaliacao(env, sel, h, true) };
  }
  erro(404, 'Rota indisponível.');
}
