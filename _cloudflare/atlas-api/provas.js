// Provas do bimestre e Diagramador (decisões do Marinho em 23 e 24/11/2026).
// O ADM define o formato de cada prova (série, turma, modalidade, data de aplicação e quantas questões de cada
// disciplina). Cada disciplina entra com uma seleção do supervisor, que só finaliza com a quantidade exata.
// Quando todas as disciplinas finalizam, a prova fecha: o caderno vira Word e vai por e-mail aos Diagramadores
// (sem gabarito). O ADM acompanha em "Avaliações", baixa o Word, reenvia o e-mail e marca a prova como aplicada.
import { RedacaoError } from './redacao-cadastros.js';
import { gerarCadernoDocx, ORDEM_DISCIPLINAS, NOME_MODALIDADE, INICIO_NUMERACAO, nomeArquivoProva, dataBR } from './prova-word.js';
import { listarDiagramadores } from './pessoas.js';

const erro = (status, mensagem) => { throw new RedacaoError(status, mensagem); };
export const TIPOS_PROVA = Object.freeze(['REG', 'MED', 'MIL']);
export const MODALIDADES = Object.freeze(['PART', 'ENEM1', 'ENEM2']);
// Regra do Marinho (24/11/2026): ENEM 1º dia = linguagens e humanas; ENEM 2º dia = Biologia, Física, Química e Matemática.
const DIA2 = Object.freeze(['Biologia', 'Física', 'Química', 'Matemática']);
export const disciplinaPermitida = (disciplina, modalidade) => modalidade === 'ENEM1' ? !DIA2.includes(disciplina) : modalidade === 'ENEM2' ? DIA2.includes(disciplina) : true;
const LINK_ATLAS = 'https://idealolimpico.com.br/atlas/';
const API_PUBLICA = 'https://atlas-api.marinhomalcher.workers.dev';
const ANEXO_MAX = 2.5 * 1024 * 1024;        // acima disso o e-mail vai só com o link (limite do envio pela Microsoft)
const LINK_VALIDADE_SEG = 30 * 24 * 3600;
const agora = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const nomeProva = p => p.serie + 'ª série · ' + p.tipo + ' · ' + (NOME_MODALIDADE[p.modalidade] || p.modalidade);
const ordem = d => { const i = ORDEM_DISCIPLINAS.indexOf(d); return i < 0 ? 99 : i; };

// ---------- leitura ----------
async function provaPorId(env, id) {
  const p = await env.DB.prepare('SELECT * FROM provas WHERE id = ?').bind(Number(id)).first();
  if (!p) erro(404, 'Prova não encontrada.');
  return p;
}
async function disciplinasDaProva(env, provaId) {
  const { results } = await env.DB.prepare(
    'SELECT pd.disciplina, pd.quantidade, pd.selecao_id, s.situacao AS sel_situacao, s.enviada_em AS sel_enviada_em, ' +
    '(SELECT COUNT(*) FROM selecao_itens si WHERE si.selecao_id = s.id) AS sel_total, u.nome AS sel_supervisor, ' +
    "(SELECT nome FROM usuarios WHERE disciplina = pd.disciplina AND papel = 'supervisor' AND ativo = 1 LIMIT 1) AS supervisor_atual " +
    'FROM prova_disciplinas pd LEFT JOIN selecoes s ON s.id = pd.selecao_id LEFT JOIN usuarios u ON u.id = s.supervisor_id WHERE pd.prova_id = ?'
  ).bind(provaId).all();
  return results.sort((a, b) => ordem(a.disciplina) - ordem(b.disciplina)).map(r => ({
    disciplina: r.disciplina, quantidade: r.quantidade, supervisor: r.supervisor_atual || null,
    selecao: r.selecao_id ? { id: r.selecao_id, situacao: r.sel_situacao, total: r.sel_total, supervisor: r.sel_supervisor, enviada_em: r.sel_enviada_em } : null
  }));
}
function provaPublica(p) {
  const { arquivo, ...resto } = p;
  return { ...resto, enviada_para: p.enviada_para ? JSON.parse(p.enviada_para) : null, tem_word: !!arquivo };
}
/* Dados da prova que acompanham uma seleção (supervisor e ADM). */
export async function provaDaSelecao(env, sel) {
  if (!sel || !sel.prova_id) return null;
  const p = await env.DB.prepare('SELECT p.id, p.ano, p.bimestre, p.serie, p.tipo, p.modalidade, p.aplicacao, p.situacao, pd.quantidade FROM provas p JOIN prova_disciplinas pd ON pd.prova_id = p.id AND pd.disciplina = ? WHERE p.id = ?')
    .bind(sel.disciplina, sel.prova_id).first();
  return p || null;
}
/* Provas abertas em que a disciplina entra, com a seleção já ligada (se houver). */
export async function provasAbertasDaDisciplina(env, disciplina) {
  const { results } = await env.DB.prepare(
    "SELECT p.id, p.ano, p.bimestre, p.serie, p.tipo, p.modalidade, p.aplicacao, pd.quantidade, pd.selecao_id FROM provas p JOIN prova_disciplinas pd ON pd.prova_id = p.id " +
    "WHERE p.situacao = 'aberta' AND pd.disciplina = ? ORDER BY p.aplicacao, p.serie, p.tipo"
  ).bind(disciplina).all();
  return results.map(r => ({ ...r, disciplina }));
}
/* O supervisor começa a seleção de uma prova: a disciplina precisa estar na prova e ainda sem seleção. */
export async function provaParaNovaSelecao(env, disciplina, provaId) {
  const p = await env.DB.prepare('SELECT p.*, pd.quantidade, pd.selecao_id FROM provas p JOIN prova_disciplinas pd ON pd.prova_id = p.id AND pd.disciplina = ? WHERE p.id = ?')
    .bind(disciplina, Number(provaId)).first();
  if (!p) erro(404, 'Esta prova não existe ou não tem ' + disciplina + '.');
  if (p.situacao !== 'aberta') erro(409, 'Esta prova já foi fechada.');
  if (p.selecao_id) {
    const s = await env.DB.prepare('SELECT id FROM selecoes WHERE id = ?').bind(p.selecao_id).first();
    if (s) erro(409, 'Já existe uma seleção de ' + disciplina + ' para esta prova (#' + p.selecao_id + '). Continue por ela.');
  }
  return p;
}
export async function ligarSelecao(env, provaId, disciplina, selecaoId) {
  await env.DB.prepare('UPDATE prova_disciplinas SET selecao_id = ? WHERE prova_id = ? AND disciplina = ?').bind(selecaoId, provaId, disciplina).run();
}
export async function desligarSelecao(env, selecaoId) {
  await env.DB.prepare('UPDATE prova_disciplinas SET selecao_id = NULL WHERE selecao_id = ?').bind(selecaoId).run();
}

// ---------- fechamento: Word + e-mail ao Diagramador ----------
async function assinaturaProva(h, id, exp) { return h.hmacHex(h.segredo(), 'prova:' + id + ':' + exp); }
export async function linkProva(h, prova) {
  const exp = Math.floor(Date.now() / 1000) + LINK_VALIDADE_SEG;
  return API_PUBLICA + '/provas/' + prova.id + '/' + encodeURIComponent(nomeArquivoProva(prova)) + '?e=' + exp + '&s=' + await assinaturaProva(h, prova.id, exp);
}
/* Entrega pública do Word pelo link assinado do e-mail (sem login: o Diagramador não entra no ATLAS). */
export async function entregarProva(env, url, h) {
  const m = url.pathname.match(/^\/provas\/(\d+)\/[^/]+$/);
  if (!m) return null;
  const exp = Number(url.searchParams.get('e')), sig = String(url.searchParams.get('s') || '');
  if (!exp || !/^[0-9a-f]{64}$/.test(sig)) erro(404, 'Link inválido.');
  if (await assinaturaProva(h, m[1], exp) !== sig) erro(404, 'Link inválido.');
  if (exp < Math.floor(Date.now() / 1000)) erro(410, 'Este link venceu. Peça ao administrador para reenviar o e-mail.');
  const p = await env.DB.prepare('SELECT * FROM provas WHERE id = ?').bind(Number(m[1])).first();
  if (!p || !p.arquivo || !env.IMAGENS) erro(404, 'Arquivo não encontrado.');
  const obj = await env.IMAGENS.get(p.arquivo);
  if (!obj) erro(404, 'Arquivo não encontrado.');
  return { nome: nomeArquivoProva(p), corpo: obj.body };
}
async function blocosDaProva(env, prova, h) {
  const discs = await disciplinasDaProva(env, prova.id);
  const blocos = [];
  for (const d of discs) {
    if (!d.selecao) erro(409, 'A disciplina ' + d.disciplina + ' ainda não enviou a seleção.');
    const sel = await env.DB.prepare('SELECT s.*, u.nome AS supervisor FROM selecoes s JOIN usuarios u ON u.id = s.supervisor_id WHERE s.id = ?').bind(d.selecao.id).first();
    const itens = await h.itensDaSelecao(env, sel, true);
    blocos.push({ disciplina: d.disciplina, itens: itens.map(i => ({ codigo: i.codigo, dados: i.dados, grupo: i.grupo ? { codigo: i.grupo.codigo } : null })) });
  }
  return blocos;
}
async function gerarWord(env, prova, h) {
  if (!env.IMAGENS) erro(503, 'Armazenamento indisponível.');
  const blocos = await blocosDaProva(env, prova, h);
  const lerImagem = async id => { const o = await env.IMAGENS.get('img/' + id); return o ? new Uint8Array(await new Response(o.body).arrayBuffer()) : null; };
  const docx = await gerarCadernoDocx(prova, blocos, lerImagem);
  const chave = 'provas/' + prova.id + '/' + nomeArquivoProva(prova);
  await env.IMAGENS.put(chave, docx, { httpMetadata: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, customMetadata: { prova: String(prova.id) } });
  await env.DB.prepare("UPDATE provas SET arquivo = ?, atualizado_em = ? WHERE id = ?").bind(chave, agora(), prova.id).run();
  return { chave, docx };
}
async function wordDaProva(env, prova, h) {
  if (prova.arquivo && env.IMAGENS) {
    const obj = await env.IMAGENS.get(prova.arquivo);
    if (obj) return { chave: prova.arquivo, docx: new Uint8Array(await new Response(obj.body).arrayBuffer()) };
  }
  return gerarWord(env, prova, h);
}
function resumoDisciplinas(discs) { return discs.map(d => d.disciplina + ' ' + d.quantidade).join(', '); }
/* Manda o Word aos Diagramadores. Devolve { ok, para, aviso }. */
async function enviarAoDiagramador(env, prova, h, reenvio) {
  const diag = await listarDiagramadores(env);
  if (!diag.length) return { ok: false, para: [], aviso: 'Nenhum Diagramador cadastrado. Cadastre em Professores e colaboradores e clique em Enviar ao Diagramador.' };
  const { docx } = await wordDaProva(env, prova, h);
  const discs = await disciplinasDaProva(env, prova.id);
  const total = discs.reduce((a, d) => a + d.quantidade, 0);
  const link = await linkProva(h, prova);
  const nome = nomeArquivoProva(prova);
  const assunto = 'ATLAS: caderno da prova ' + nomeProva(prova) + ' (' + prova.bimestre + 'º bimestre' + (reenvio ? ', reenvio' : '') + ')';
  const texto = 'Olá! Segue o caderno da prova para diagramação.\n\n' +
    'Prova: ' + nomeProva(prova) + ' · ' + prova.bimestre + 'º bimestre de ' + prova.ano + '\n' +
    'Aplicação: ' + dataBR(prova.aplicacao) + '\n' +
    'Questões: ' + total + ' (numeradas de ' + INICIO_NUMERACAO[prova.modalidade] + ' a ' + (INICIO_NUMERACAO[prova.modalidade] + total - 1) + ')\n' +
    'Disciplinas: ' + resumoDisciplinas(discs) + '\n\n' +
    (docx.length <= ANEXO_MAX ? 'O arquivo Word está em anexo (' + nome + ').' : 'O arquivo Word ficou grande para ir em anexo.') +
    ' Ele também pode ser baixado por este link, válido por 30 dias:\n' + link + '\n\n' +
    'O gabarito não vai neste e-mail: fica com a coordenação.\n\nATLAS · Grupo Educacional Ideal';
  const anexos = docx.length <= ANEXO_MAX ? [{ nome, tipo: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: docx }] : [];
  const para = diag.map(d => d.email);
  const ok = await h.enviarEmailComAnexos(env, para, assunto, texto, anexos);
  if (!ok) return { ok: false, para, aviso: 'O e-mail ao Diagramador não saiu (falha no envio). Clique em Enviar ao Diagramador para tentar de novo.' };
  return { ok: true, para, aviso: null };
}
/* Chamado depois de cada seleção finalizada: se todas as disciplinas enviaram, fecha a prova e manda ao Diagramador. */
export async function fecharProvaSeCompleta(env, provaId, h) {
  const prova = await provaPorId(env, provaId);
  if (prova.situacao !== 'aberta') return { fechada: false };
  const discs = await disciplinasDaProva(env, prova.id);
  if (!discs.every(d => d.selecao && d.selecao.situacao === 'enviada')) return { fechada: false, faltam: discs.filter(d => !d.selecao || d.selecao.situacao !== 'enviada').map(d => d.disciplina) };
  const t = agora();
  // O Word e o e-mail não podem derrubar a finalização do supervisor: se falharem, a prova fica "fechada" com o aviso e o ADM reenvia.
  let r;
  try {
    await gerarWord(env, prova, h);
    r = await enviarAoDiagramador(env, await provaPorId(env, prova.id), h, false);
  } catch (e) {
    r = { ok: false, para: [], aviso: 'O caderno em Word não pôde ser gerado agora (' + (e && e.message) + '). Clique em Enviar ao Diagramador para tentar de novo.' };
  }
  if (r.ok) await env.DB.prepare("UPDATE provas SET situacao = 'enviada', enviada_em = ?, enviada_para = ?, aviso = NULL, atualizado_em = ? WHERE id = ?").bind(t, JSON.stringify(r.para), t, prova.id).run();
  else await env.DB.prepare("UPDATE provas SET situacao = 'fechada', aviso = ?, atualizado_em = ? WHERE id = ?").bind(r.aviso, t, prova.id).run();
  await h.registrar(env, r.ok ? 'prova_enviada' : 'prova_fechada', { prova: prova.id, para: r.para, aviso: r.aviso });
  h.avisar(env, env.ADMIN_EMAIL, 'ATLAS: prova ' + nomeProva(prova) + ' fechada' + (r.ok ? ' e enviada ao Diagramador' : ' — e-mail NÃO enviado'),
    'Todas as disciplinas da prova ' + nomeProva(prova) + ' (' + prova.bimestre + 'º bimestre de ' + prova.ano + ', aplicação em ' + dataBR(prova.aplicacao) + ') finalizaram as seleções.\n\n' +
    (r.ok ? 'O caderno em Word foi enviado para: ' + r.para.join(', ') + '.' : r.aviso) + '\n\n' + LINK_ATLAS + 'admin-avaliacoes.html', true);
  return { fechada: true, enviada: r.ok };
}
/* Devolução de uma seleção pelo ADM: a prova fechada (ainda sem e-mail) volta a aberta; a já enviada não pode ser devolvida. */
export async function aoDevolverSelecao(env, sel) {
  if (!sel.prova_id) return;
  const p = await provaPorId(env, sel.prova_id);
  if (p.situacao === 'enviada' || p.situacao === 'aplicada') erro(409, 'Esta prova já foi ao Diagramador. Combine a troca diretamente com ele.');
  if (p.situacao === 'fechada') await env.DB.prepare("UPDATE provas SET situacao = 'aberta', aviso = NULL, atualizado_em = ? WHERE id = ?").bind(agora(), p.id).run();
}

// ---------- validação do formato ----------
function validarFormato(body, h, atual = null) {
  const ano = Number(body.ano ?? (atual && atual.ano)), bimestre = Number(body.bimestre ?? (atual && atual.bimestre));
  const anoHoje = Number(h.hojeSP().slice(0, 4));
  if (!Number.isInteger(ano) || ano < anoHoje - 1 || ano > anoHoje + 1) erro(400, 'Ano inválido.');
  if (![1, 2, 3, 4].includes(bimestre)) erro(400, 'Escolha o bimestre.');
  const serie = Number(body.serie ?? (atual && atual.serie)), tipo = String(body.tipo ?? (atual && atual.tipo) ?? '').toUpperCase(), modalidade = String(body.modalidade ?? (atual && atual.modalidade) ?? '').toUpperCase();
  if (![1, 2, 3].includes(serie)) erro(400, 'Escolha a série (1ª, 2ª ou 3ª).');
  if (!TIPOS_PROVA.includes(tipo)) erro(400, 'Escolha a turma (REG, MED ou MIL).');
  if (!MODALIDADES.includes(modalidade)) erro(400, 'Escolha a modalidade: Simulado particular ou Simulado ENEM (1º ou 2º dia).');
  const aplicacao = String(body.aplicacao ?? (atual && atual.aplicacao) ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(aplicacao) || Number.isNaN(Date.parse(aplicacao + 'T12:00:00Z'))) erro(400, 'Informe a data de aplicação.');
  const lista = Array.isArray(body.disciplinas) ? body.disciplinas : null;
  if (!lista || !lista.length) erro(400, 'Marque pelo menos uma disciplina.');
  if (lista.length > ORDEM_DISCIPLINAS.length) erro(400, 'Disciplinas demais.');
  const vistas = new Set(), disciplinas = [];
  for (const d of lista) {
    const nome = String(d && d.disciplina || ''), q = Number(d && d.quantidade);
    if (!h.DISCIPLINAS.includes(nome)) erro(400, 'Disciplina inválida: ' + nome);
    if (vistas.has(nome)) erro(400, nome + ' aparece duas vezes.');
    if (!Number.isInteger(q) || q < 1 || q > 200) erro(400, 'Quantidade de ' + nome + ' inválida (1 a 200).');
    if (!disciplinaPermitida(nome, modalidade)) erro(400, modalidade === 'ENEM1' ? nome + ' não entra no ENEM 1º dia (só linguagens e humanas).' : nome + ' não entra no ENEM 2º dia (só Biologia, Física, Química e Matemática).');
    vistas.add(nome); disciplinas.push({ disciplina: nome, quantidade: q });
  }
  disciplinas.sort((a, b) => ordem(a.disciplina) - ordem(b.disciplina));
  return { ano, bimestre, serie, tipo, modalidade, aplicacao, disciplinas };
}

// ---------- rotas do ADM ----------
export async function rotaProvasAdm(request, env, path, url, h) {
  if (!path.startsWith('/api/adm/provas')) return null;
  if (path === '/api/adm/provas' && request.method === 'GET') {
    const ano = Number(url.searchParams.get('ano')) || Number(h.hojeSP().slice(0, 4));
    const bim = Number(url.searchParams.get('bimestre'));
    const { results } = await env.DB.prepare('SELECT * FROM provas WHERE ano = ?' + (bim ? ' AND bimestre = ?' : '') + ' ORDER BY aplicacao DESC, serie, tipo, modalidade').bind(...(bim ? [ano, bim] : [ano])).all();
    const provas = [];
    for (const p of results) provas.push({ ...provaPublica(p), disciplinas: await disciplinasDaProva(env, p.id) });
    return { ok: true, ano, provas, diagramadores: (await listarDiagramadores(env)).map(d => d.email) };
  }
  if (path === '/api/adm/provas' && request.method === 'POST') {
    const f = validarFormato(await h.readJson(request), h);
    const r = await env.DB.prepare('INSERT INTO provas (ano, bimestre, serie, tipo, modalidade, aplicacao) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
      .bind(f.ano, f.bimestre, f.serie, f.tipo, f.modalidade, f.aplicacao).first();
    await env.DB.batch(f.disciplinas.map(d => env.DB.prepare('INSERT INTO prova_disciplinas (prova_id, disciplina, quantidade) VALUES (?, ?, ?)').bind(r.id, d.disciplina, d.quantidade)));
    await h.registrar(env, 'prova_criada', { adm: h.sessao.email, prova: r.id, ...f });
    return { ok: true, prova: { id: r.id } };
  }
  const m = path.match(/^\/api\/adm\/provas\/(\d+)(\/enviar|\/word|\/aplicar)?$/);
  if (!m) erro(404, 'Rota indisponível.');
  const prova = await provaPorId(env, m[1]);
  const discs = await disciplinasDaProva(env, prova.id);

  if (!m[2] && request.method === 'PUT') {
    if (prova.situacao !== 'aberta') erro(409, 'Esta prova já foi fechada: o formato não muda mais.');
    const f = validarFormato(await h.readJson(request), h, prova);
    const comSelecao = discs.filter(d => d.selecao);
    if (comSelecao.length && (f.serie !== prova.serie || f.tipo !== prova.tipo || f.modalidade !== prova.modalidade)) erro(409, 'Série, turma e modalidade não mudam depois que um supervisor começou a seleção.');
    for (const d of comSelecao) {
      const nova = f.disciplinas.find(x => x.disciplina === d.disciplina);
      if (!nova) erro(409, d.disciplina + ' já tem seleção (#' + d.selecao.id + ') e não pode sair da prova.');
      if (d.selecao.situacao !== 'rascunho' && nova.quantidade !== d.quantidade) erro(409, d.disciplina + ' já finalizou com ' + d.quantidade + ' questões; devolva a seleção ao supervisor antes de mudar a quantidade.');
    }
    const ops = [env.DB.prepare('UPDATE provas SET ano = ?, bimestre = ?, serie = ?, tipo = ?, modalidade = ?, aplicacao = ?, atualizado_em = ? WHERE id = ?').bind(f.ano, f.bimestre, f.serie, f.tipo, f.modalidade, f.aplicacao, agora(), prova.id),
      env.DB.prepare('DELETE FROM prova_disciplinas WHERE prova_id = ?').bind(prova.id),
      ...f.disciplinas.map(d => { const ant = comSelecao.find(x => x.disciplina === d.disciplina); return env.DB.prepare('INSERT INTO prova_disciplinas (prova_id, disciplina, quantidade, selecao_id) VALUES (?, ?, ?, ?)').bind(prova.id, d.disciplina, d.quantidade, ant ? ant.selecao.id : null); })];
    await env.DB.batch(ops);
    await h.registrar(env, 'prova_alterada', { adm: h.sessao.email, prova: prova.id, ...f });
    return { ok: true, prova: { id: prova.id } };
  }
  /* Excluir (28/11/2026, decisão do Marinho): só antes de ir ao Diagramador. As seleções da prova são
     apagadas junto (mesmo com o supervisor no meio) e as questões voltam a ficar disponíveis. */
  if (!m[2] && request.method === 'DELETE') {
    if (prova.situacao === 'enviada' || prova.situacao === 'aplicada') erro(409, prova.situacao === 'enviada' ? 'Esta prova já foi enviada ao Diagramador e não pode ser excluída.' : 'Esta prova já foi aplicada e não pode ser excluída.');
    const { results: ligadas } = await env.DB.prepare('SELECT id FROM selecoes WHERE prova_id = ? UNION SELECT selecao_id FROM prova_disciplinas WHERE prova_id = ? AND selecao_id IS NOT NULL').bind(prova.id, prova.id).all();
    const sels = ligadas.map(x => x.id);
    const ops = [];
    for (const s of sels) {
      ops.push(env.DB.prepare('DELETE FROM avaliacao_mensagens WHERE pedido_id IN (SELECT id FROM avaliacao_pedidos WHERE selecao_id = ?)').bind(s));
      for (const t of ['avaliacao_pedidos', 'avaliacao_visualizacoes', 'avaliacao_professores', 'selecao_itens']) ops.push(env.DB.prepare('DELETE FROM ' + t + ' WHERE selecao_id = ?').bind(s));
    }
    ops.push(env.DB.prepare('DELETE FROM prova_disciplinas WHERE prova_id = ?').bind(prova.id));
    for (const s of sels) ops.push(env.DB.prepare('DELETE FROM selecoes WHERE id = ?').bind(s));
    ops.push(env.DB.prepare('DELETE FROM provas WHERE id = ?').bind(prova.id));
    await env.DB.batch(ops);
    await h.registrar(env, 'prova_excluida', { adm: h.sessao.email, prova: prova.id, selecoes_apagadas: sels });
    return { ok: true, selecoes_apagadas: sels.length };
  }
  if (m[2] === '/word' && request.method === 'GET') {
    if (prova.situacao === 'aberta') erro(409, 'O Word só fica pronto quando todas as disciplinas finalizarem.');
    const { docx } = await wordDaProva(env, prova, h);
    return { __arquivo: true, nome: nomeArquivoProva(prova), corpo: docx, tipo: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  if (m[2] === '/enviar' && request.method === 'POST') {
    if (prova.situacao === 'aberta') erro(409, 'A prova ainda está aberta: faltam disciplinas finalizarem.');
    const reenvio = prova.situacao === 'enviada';
    const r = await enviarAoDiagramador(env, prova, h, reenvio);
    const t = agora();
    if (!r.ok) { await env.DB.prepare('UPDATE provas SET aviso = ?, atualizado_em = ? WHERE id = ?').bind(r.aviso, t, prova.id).run(); erro(409, r.aviso); }
    if (reenvio) await env.DB.prepare("UPDATE provas SET reenviada_em = ?, enviada_para = ?, aviso = NULL, atualizado_em = ? WHERE id = ?").bind(t, JSON.stringify(r.para), t, prova.id).run();
    else await env.DB.prepare("UPDATE provas SET situacao = 'enviada', enviada_em = ?, enviada_para = ?, aviso = NULL, atualizado_em = ? WHERE id = ?").bind(t, JSON.stringify(r.para), t, prova.id).run();
    await h.registrar(env, reenvio ? 'prova_reenviada' : 'prova_enviada', { adm: h.sessao.email, prova: prova.id, para: r.para });
    return { ok: true, para: r.para };
  }
  if (m[2] === '/aplicar' && request.method === 'POST') {
    if (prova.situacao !== 'enviada') erro(409, prova.situacao === 'aplicada' ? 'Esta prova já foi marcada como aplicada.' : 'A prova ainda não foi ao Diagramador.');
    for (const d of discs) {
      const sel = await env.DB.prepare('SELECT * FROM selecoes WHERE id = ?').bind(d.selecao.id).first();
      if (sel.situacao === 'aplicada') continue;
      await h.aplicarSelecao(env, sel);
    }
    const t = agora();
    await env.DB.prepare("UPDATE provas SET situacao = 'aplicada', aplicada_em = ?, atualizado_em = ? WHERE id = ?").bind(t, t, prova.id).run();
    await h.registrar(env, 'prova_aplicada', { adm: h.sessao.email, prova: prova.id });
    return { ok: true, prova: { id: prova.id, situacao: 'aplicada' } };
  }
  erro(404, 'Rota indisponível.');
}
