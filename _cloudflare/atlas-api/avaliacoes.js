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
  "(SELECT COUNT(*) FROM avaliacao_pedidos pe WHERE pe.selecao_id = s.id AND pe.professor_id = ap.professor_id AND pe.estado <> 'aberto') AS pedidos_respondidos " +
  'FROM avaliacao_professores ap JOIN selecoes s ON s.id = ap.selecao_id JOIN provas p ON p.id = s.prova_id ';

function publica(r, hoje, naoUteis) {
  const encerrado = !!r.avaliacao_prazo_em && r.avaliacao_prazo_em < agora();
  return {
    id: r.selecao_id, disciplina: r.disciplina, fase: r.fase, situacao: r.situacao,
    prova: { id: r.prova_id, serie: r.serie, tipo: r.tipo, modalidade: r.modalidade, bimestre: r.bimestre, ano: r.ano, aplicacao: r.aplicacao, situacao: r.prova_situacao, nome: nomeProva(r) },
    total: r.total, visto_ate: r.visto_ate, visto_completo_em: r.visto_completo_em, decisao: r.decisao, decidido_em: r.decidido_em,
    aberta_em: r.avaliacao_aberta_em, prazo_em: r.avaliacao_prazo_em, prazo_encerrado: encerrado,
    dias_uteis_restantes: r.avaliacao_prazo_em && !encerrado ? diasUteisAte(hoje, r.avaliacao_prazo_em, naoUteis) : 0,
    concordo: r.concordo, pedidos: r.pedidos, pedidos_respondidos: r.pedidos_respondidos
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
async function situacaoDasQuestoes(env, av) {
  const { results: votos } = await env.DB.prepare('SELECT item_id, em FROM avaliacao_votos WHERE selecao_id = ? AND professor_id = ?').bind(av.selecao_id, av.professor_id).all();
  const { results: pedidos } = await env.DB.prepare('SELECT id, item_id, tipo, texto, estado, rodada, criado_em FROM avaliacao_pedidos WHERE selecao_id = ? AND professor_id = ? ORDER BY id').bind(av.selecao_id, av.professor_id).all();
  const voto = new Map(votos.map(v => [v.item_id, v.em]));
  const pedido = new Map();
  for (const p of pedidos) pedido.set(p.item_id, { id: p.id, tipo: p.tipo, tipo_nome: TIPOS_PEDIDO[p.tipo], texto: p.texto, estado: p.estado, rodada: p.rodada, criado_em: p.criado_em });
  return { voto, pedido };
}
const podeMexer = av => {
  if (av.fase !== 'avaliacao') erro(409, 'Esta avaliação já foi encerrada.');
  if (av.decisao !== 'pendente') erro(409, 'Você já finalizou esta avaliação.');
};

export async function rotaAvaliacoesProfessor(request, env, path, user, h) {
  if (user.papel === 'digitador') erro(403, 'Área restrita aos professores.');
  const naoUteis = await diasNaoUteis(env);
  const hoje = h.hojeSP();

  if (path === '/api/avaliacoes' && request.method === 'GET') {
    const { results } = await env.DB.prepare(SQL_AVALIACAO + "WHERE ap.professor_id = ? ORDER BY (ap.decisao = 'pendente') DESC, s.avaliacao_prazo_em, s.id").bind(user.id).all();
    const avaliacoes = results.map(r => publica(r, hoje, naoUteis));
    return { ok: true, codigo: await codigoDoProfessor(env, user.id), pendentes: avaliacoes.filter(a => a.decisao === 'pendente' && a.fase === 'avaliacao').length, avaliacoes };
  }

  const m = path.match(/^\/api\/avaliacoes\/(\d+)(?:\/(finalizar|questao\/(\d+)(?:\/(voto|pedido))?))?$/);
  if (!m) erro(404, 'Rota indisponível.');
  const av = await avaliacaoDoProfessor(env, m[1], user.id);
  const total = av.total;
  const codigo = await codigoDoProfessor(env, user.id);

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
    const sem = qs.map((q, k) => (voto.has(q.id) || pedido.has(q.id)) ? null : k + 1).filter(Boolean);
    if (sem.length) erro(409, (sem.length === 1 ? 'A questão ' + sem[0] + ' ainda está sem resposta.' : 'Faltam ' + sem.length + ' questões sem resposta: ' + sem.join(', ') + '.') + ' Marque "Concordo" ou peça mudança em cada uma.');
    const decisao = pedido.size ? 'pediu_mudanca' : 'aprovou';
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
    await env.DB.batch([
      env.DB.prepare("DELETE FROM avaliacao_mensagens WHERE pedido_id IN (SELECT id FROM avaliacao_pedidos WHERE selecao_id = ? AND professor_id = ? AND item_id = ? AND estado = 'aberto')").bind(av.selecao_id, user.id, q.id),
      env.DB.prepare("DELETE FROM avaliacao_pedidos WHERE selecao_id = ? AND professor_id = ? AND item_id = ? AND estado = 'aberto'").bind(av.selecao_id, user.id, q.id),
      env.DB.prepare('INSERT INTO avaliacao_votos (selecao_id, professor_id, item_id, voto, em) VALUES (?, ?, ?, ?, ?) ON CONFLICT(selecao_id, professor_id, item_id) DO UPDATE SET em = excluded.em').bind(av.selecao_id, user.id, q.id, 'concordo', t)
    ]);
    return { ok: true, n, concordo: true, pedido: null };
  }

  if (m[4] === 'pedido' && request.method === 'POST') {
    podeMexer(av);
    const body = await h.readJson(request);
    const tipo = String(body.tipo || '');
    if (!TIPOS_PEDIDO[tipo]) erro(400, 'Escolha o tipo do pedido: trocar a questão ou corrigir texto ou gabarito.');
    const texto = String(body.texto ?? '').replace(/\r\n?/g, '\n').trim();
    if (texto.length < 3 || texto.length > 2000) erro(400, 'Explique ao supervisor o que precisa mudar (3 a 2000 caracteres).');
    const existente = await env.DB.prepare('SELECT id, estado FROM avaliacao_pedidos WHERE selecao_id = ? AND professor_id = ? AND item_id = ?').bind(av.selecao_id, user.id, q.id).first();
    if (existente && existente.estado !== 'aberto') erro(409, 'O supervisor já respondeu a este pedido.');
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
    return { ok: true, n, concordo: false, pedido: { id: row.id, tipo, tipo_nome: TIPOS_PEDIDO[tipo], texto, estado: 'aberto', rodada: 1, criado_em: t } };
  }
  erro(404, 'Rota indisponível.');
}
