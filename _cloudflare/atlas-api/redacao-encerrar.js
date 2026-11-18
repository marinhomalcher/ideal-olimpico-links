// Encerramento automático do ano da Redação (política de privacidade aprovada em 18/11/2026;
// decisão do Marinho em 18/11/2026: automático, sem tela e sem botão).
// Roda na madrugada de 31/12 (cron diário, 3h17 de Brasília) e apaga, do ano que termina:
// correções e notas, índice de folhas, lotes e os PDFs no R2 (redacao/<ano>/…), envios,
// alunos de redação, turmas e o vínculo professora ↔ turma, importações e os registros (eventos)
// de redação do ano. Também o "Meu desempenho" do ano: os documentos no banco e a pasta <ano> no
// SharePoint dos resultados (mapas de desempenho e espelhos). Professoras, digitalizadores, coordenadores e usuários continuam cadastrados.
// No fim faz uma cópia de segurança nova (já sem redação), apaga as anteriores, registra o evento
// "redacao_ano_encerrado" e manda o relatório por e-mail ao ADM.
// Se não houver nada do ano para apagar, não faz nada (nem e-mail), então pode rodar mais de uma vez.
import { apagarAnoSharePoint } from './desempenho.js';
const LOTE_LINHAS = 500;      // linhas apagadas por comando
const LOTE_R2 = 500;          // objetos apagados por vez (o R2 aceita até 1.000 chaves por delete)
const MAX_RODADAS = 5000;     // trava de segurança do laço

/* Tabelas do ano, na ordem em que podem ser apagadas (as que dependem de outras vêm primeiro). */
const ETAPAS = [
  { chave: 'desempenho', contar: 'SELECT COUNT(*) AS n FROM desempenho_documentos WHERE ano = ?',
    apagar: 'DELETE FROM desempenho_documentos WHERE rowid IN (SELECT rowid FROM desempenho_documentos WHERE ano = ? LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'correcoes', contar: 'SELECT COUNT(*) AS n FROM redacao_correcoes WHERE lote_id IN (SELECT id FROM redacao_lotes WHERE ano = ?)',
    apagar: 'DELETE FROM redacao_correcoes WHERE rowid IN (SELECT rowid FROM redacao_correcoes WHERE lote_id IN (SELECT id FROM redacao_lotes WHERE ano = ?) LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'paginas', contar: 'SELECT COUNT(*) AS n FROM redacao_paginas WHERE lote_id IN (SELECT id FROM redacao_lotes WHERE ano = ?)',
    apagar: 'DELETE FROM redacao_paginas WHERE rowid IN (SELECT rowid FROM redacao_paginas WHERE lote_id IN (SELECT id FROM redacao_lotes WHERE ano = ?) LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'lotes', contar: 'SELECT COUNT(*) AS n FROM redacao_lotes WHERE ano = ?',
    apagar: 'DELETE FROM redacao_lotes WHERE rowid IN (SELECT rowid FROM redacao_lotes WHERE ano = ? LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'envios', contar: 'SELECT COUNT(*) AS n FROM redacao_envios WHERE ano = ?',
    apagar: 'DELETE FROM redacao_envios WHERE rowid IN (SELECT rowid FROM redacao_envios WHERE ano = ? LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'alunos', contar: 'SELECT COUNT(*) AS n FROM redacao_alunos WHERE ano = ?',
    apagar: 'DELETE FROM redacao_alunos WHERE rowid IN (SELECT rowid FROM redacao_alunos WHERE ano = ? LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'vinculos', contar: 'SELECT COUNT(*) AS n FROM redacao_professor_turmas WHERE turma_id IN (SELECT id FROM redacao_turmas WHERE ano = ?)',
    apagar: 'DELETE FROM redacao_professor_turmas WHERE rowid IN (SELECT rowid FROM redacao_professor_turmas WHERE turma_id IN (SELECT id FROM redacao_turmas WHERE ano = ?) LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'turmas', contar: 'SELECT COUNT(*) AS n FROM redacao_turmas WHERE ano = ?',
    apagar: 'DELETE FROM redacao_turmas WHERE rowid IN (SELECT rowid FROM redacao_turmas WHERE ano = ? LIMIT ' + LOTE_LINHAS + ')' },
  { chave: 'importacoes', contar: 'SELECT COUNT(*) AS n FROM redacao_importacoes WHERE ano = ?',
    apagar: 'DELETE FROM redacao_importacoes WHERE rowid IN (SELECT rowid FROM redacao_importacoes WHERE ano = ? LIMIT ' + LOTE_LINHAS + ')' },
  /* registros de redação do ano (citam RA e lotes); o próprio registro do encerramento fica */
  { chave: 'eventos', args: ano => [ano + '-', (ano + 1) + '-'],
    contar: "SELECT COUNT(*) AS n FROM eventos WHERE acao LIKE 'redacao_%' AND acao <> 'redacao_ano_encerrado' AND criado_em >= ? AND criado_em < ?",
    apagar: "DELETE FROM eventos WHERE rowid IN (SELECT rowid FROM eventos WHERE acao LIKE 'redacao_%' AND acao <> 'redacao_ano_encerrado' AND criado_em >= ? AND criado_em < ? LIMIT " + LOTE_LINHAS + ')' }
];
export const NOMES = { pdfs: 'PDFs no armazenamento', desempenho: 'mapas e espelhos do Meu desempenho', correcoes: 'correções (notas)', paginas: 'folhas', lotes: 'lotes', envios: 'envios', alunos: 'alunos de redação',
  vinculos: 'vínculos professora ↔ turma', turmas: 'turmas', importacoes: 'importações', eventos: 'registros de redação' };

function prefixoR2(ano) { return 'redacao/' + ano + '/'; }
const args = (e, ano) => (e.args ? e.args(ano) : [ano]);

async function contarR2(env, ano) {
  if (!env.IMAGENS) return 0;
  let total = 0, cursor;
  do {
    const r = await env.IMAGENS.list({ prefix: prefixoR2(ano), cursor });
    total += r.objects.length;
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return total;
}

/* Quanto há do ano para apagar (usado antes de começar e nos testes). */
export async function contagens(env, ano) {
  const c = { pdfs: await contarR2(env, ano) };
  for (const e of ETAPAS) c[e.chave] = (await env.DB.prepare(e.contar).bind(...args(e, ano)).first()).n;
  return c;
}

/* Apaga tudo do ano, em lotes. Devolve quanto apagou de cada coisa. */
async function apagarTudo(env, ano) {
  const apagados = {};
  const soma = (k, n) => { if (n) apagados[k] = (apagados[k] || 0) + n; };
  let rodadas = 0;
  if (env.IMAGENS) {
    for (;;) {
      if (++rodadas > MAX_RODADAS) throw new Error('Encerramento: laço do R2 passou do limite.');
      const r = await env.IMAGENS.list({ prefix: prefixoR2(ano), limit: LOTE_R2 });
      const chaves = r.objects.map(o => o.key);
      if (!chaves.length) break;
      await env.IMAGENS.delete(chaves);
      soma('pdfs', chaves.length);
      if (!r.truncated) break;
    }
  }
  for (const e of ETAPAS) {
    for (;;) {
      if (++rodadas > MAX_RODADAS) throw new Error('Encerramento: laço do banco passou do limite.');
      const n = (await env.DB.prepare(e.apagar).bind(...args(e, ano)).run()).meta?.changes || 0;
      soma(e.chave, n);
      if (n < LOTE_LINHAS) break;
    }
  }
  return apagados;
}

function textoRelatorio(relatorio) {
  const linhas = Object.keys(NOMES).map(k => `- ${NOMES[k]}: ${(relatorio.apagados[k] || 0).toLocaleString('pt-BR')}`);
  return `O ATLAS encerrou o ano ${relatorio.ano} da Redação em ${relatorio.data.split('-').reverse().join('/')}, conforme a política de privacidade.\n\n` +
    `O que foi apagado:\n${linhas.join('\n')}\n\n` +
    (relatorio.sharepoint === false ? 'ATENÇÃO: a pasta ' + relatorio.ano + ' do SharePoint dos resultados não pôde ser apagada; apague à mão no site Resultados IDEAL OLÍMPICO.\n\n' : '') +
    (relatorio.copia ? `Cópia de segurança nova (já sem redação): ${relatorio.copia}\n` : 'Cópia de segurança nova: não foi possível fazer (armazenamento indisponível).\n') +
    `Cópias anteriores apagadas: ${relatorio.copias_removidas}\n\n` +
    'Professoras, digitalizadores e coordenadores continuam cadastrados. As turmas do ano novo entram pela planilha de alunos.\n\n' +
    'https://idealolimpico.com.br/atlas/admin.html';
}

/* Chamada pela rotina agendada. Só age em 31/12; em qualquer outro dia volta sem fazer nada. */
export async function encerrarAnoAutomatico(env, { hojeSP, registrar, fazerBackup, listarBackups, avisar }) {
  const hoje = hojeSP(env);
  if (!hoje.endsWith('-12-31')) return null;
  const ano = Number(hoje.slice(0, 4));
  const antes = await contagens(env, ano);
  if (Object.values(antes).every(n => !n)) return null;    /* nada do ano: já encerrado ou sem uso */

  const apagados = await apagarTudo(env, ano);
  /* imagens do Meu desempenho: a pasta do ano no SharePoint (vai para a lixeira do site) */
  const sharepoint = antes.desempenho ? await apagarAnoSharePoint(env, ano) : null;
  /* cópia nova (já sem redação) e as anteriores saem, como decidido em 18/11/2026 */
  let copia = null, copias_removidas = 0;
  if (env.IMAGENS) {
    copia = await fazerBackup(env, 'encerramento-redacao-' + ano);
    for (const antiga of await listarBackups(env)) {
      if (antiga.nome === copia.nome) continue;
      await env.IMAGENS.delete(antiga.chave);
      copias_removidas++;
    }
  }
  const relatorio = { ano, data: hoje, apagados, sharepoint, copia: copia?.nome || null, copias_removidas };
  await registrar(env, 'redacao_ano_encerrado', relatorio);
  if (env.ADMIN_EMAIL) avisar(env, env.ADMIN_EMAIL, 'ATLAS: ano ' + ano + ' da Redação encerrado', textoRelatorio(relatorio), true);
  return relatorio;
}
