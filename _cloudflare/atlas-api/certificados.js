// "Certificados" do portal do aluno (20/11/2026). Os PDFs ficam no site "Resultados IDEAL OLÍMPICO" do SharePoint,
// em CERTIFICADOS/<ano>/<RA>/<SIGLA - descrição>.pdf (pasta montada pela ferramenta organizar-certificados.py e
// sincronizada pelo OneDrive). O Apps Script confere a sessão do aluno e manda só o RA dele; esta rota lista os
// arquivos dele e devolve links temporários (cerca de 1 h) para baixar. Ficam guardados até o aluno sair da escola.
import { RedacaoError } from './redacao-cadastros.js';
import { base, graph } from './desempenho.js';

const erro = (status, mensagem) => { throw new RedacaoError(status, mensagem); };
const raValido = v => { const s = String(v ?? '').trim(); if (!/^\d{1,15}$/.test(s)) erro(400, 'RA inválido.'); return s; };
const PASTA = 'CERTIFICADOS';
const MAX_ANOS = 30;

/* Itens de uma pasta (até 200; uma página do Graph basta para os anos e para um aluno). 404 = pasta não existe. */
async function filhos(env, rel) {
  const r = await graph(env, base(env) + '/root:/' + rel.split('/').map(encodeURIComponent).join('/') + ':/children?$top=200');
  if (r.status === 404) return [];
  if (!r.ok) erro(502, 'Não foi possível ler os certificados agora. Tente de novo em instantes.');
  const d = await r.json().catch(() => ({}));
  return Array.isArray(d.value) ? d.value : [];
}

export async function rotaCertificadosPortal(env, body) {
  const ra = raValido(body?.ra);
  const anos = (await filhos(env, PASTA))
    .filter(x => x.folder && /^(19|20)\d\d$/.test(x.name)).map(x => x.name).sort().reverse().slice(0, MAX_ANOS);
  const certificados = [];
  for (const ano of anos) {
    for (const it of await filhos(env, PASTA + '/' + ano + '/' + ra)) {
      if (!it.file || !/\.pdf$/i.test(it.name || '')) continue;
      certificados.push({
        ano: Number(ano),
        nome: it.name.replace(/\.pdf$/i, ''),
        tamanho: Number(it.size) || 0,
        url: it['@microsoft.graph.downloadUrl'] || null
      });
    }
  }
  certificados.sort((a, b) => b.ano - a.ano || a.nome.localeCompare(b.nome, 'pt-BR'));
  return { ok: true, certificados, anos: anos.map(Number) };
}
