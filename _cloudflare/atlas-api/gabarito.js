// Gabarito oficial e cartão-resposta do aluno ("Meu desempenho", pedido do Marinho em 21/11/2026).
// O gabarito é um por bimestre, prova, série e trilha (MED ou REG: fazem provas diferentes; o curso militar
// usa o mesmo do MED). Entra como texto, no formato que a coordenação já gera ("Q.91: A", uma por linha) ou
// numa sequência de letras; "X" (ou "anulada") vale para todos; "A/C" aceita as duas. As respostas do aluno
// vêm da planilha de correção (uma letra por questão; "_" em branco, "*" dupla marcação) e a grade das bolhas
// vem da tela do ADM (atlas-cartao.js), já na forma guardada. Aqui só se lê, confere e limita tamanhos.
import { RedacaoError } from './redacao-cadastros.js';

export const TRILHAS = Object.freeze(['MED', 'REG']);
export const SERIES = Object.freeze(['1', '2', '3', '6', '7', '8', '9']);
export const MAX_QUESTOES = 200;
const erro = (status, mensagem) => { throw new RedacaoError(status, mensagem); };

/* Uma resposta do gabarito: letra, "X" (anulada) ou letras separadas por barra. */
function resposta(v) {
  const s = String(v || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  if (s === 'X' || s === '*' || s.startsWith('ANUL')) return 'X';
  if (/^[A-E](\/[A-E])*$/.test(s)) return [...new Set(s.split('/'))].sort().join('/');
  return null;
}
/* Lê o texto do gabarito. Devolve { inicio, respostas } ou lança 400 com o motivo. */
export function lerGabarito(texto, inicioPadrao = 1) {
  const t = String(texto || '').replace(/\r/g, '');
  if (t.trim().length > 20000) erro(400, 'Gabarito grande demais.');
  const numeradas = new Map();
  let linhasComNumero = 0, linhasSemNada = 0;
  for (const linhaCrua of t.split('\n')) {
    const linha = linhaCrua.trim();
    if (!linha || /^-+$/.test(linha) || /^(gabarito|total de quest)/i.test(linha)) continue;
    const m = linha.match(/^(?:Q\.?\s*)?(\d{1,3})\s*[:).\-–]?\s*([A-Za-z*/]+)?\s*$/i);
    if (m) {
      linhasComNumero++;
      const n = Number(m[1]), r = resposta(m[2]);
      if (!r) erro(400, `Questão ${n}: resposta "${(m[2] || '').trim() || '(vazia)'}" não entendida (use A a E, X para anulada ou A/C).`);
      if (numeradas.has(n)) erro(400, `Questão ${n} aparece duas vezes.`);
      numeradas.set(n, r);
    } else linhasSemNada++;
  }
  let inicio, respostas;
  if (numeradas.size) {
    if (linhasSemNada) erro(400, 'Há linhas que não são "número: resposta". Confira o texto.');
    const ns = [...numeradas.keys()].sort((a, b) => a - b);
    inicio = ns[0];
    for (let i = 0; i < ns.length; i++) if (ns[i] !== inicio + i) erro(400, `Falta a questão ${inicio + i}.`);
    respostas = ns.map(n => numeradas.get(n));
  } else {
    /* sequência de letras: "ABEDC…" ou "A B E D C", "A, B, E"; "X" anulada; "A/C" dupla */
    const partes = t.trim().split(/[\s,;]+/).filter(Boolean);
    const soLetras = partes.length === 1 && /^[A-EXa-ex]+$/.test(partes[0]) ? partes[0].split('') : partes;
    respostas = soLetras.map(p => { const r = resposta(p); if (!r) erro(400, `Resposta "${p}" não entendida (use A a E, X para anulada ou A/C).`); return r; });
    inicio = Number(inicioPadrao);
    if (!Number.isInteger(inicio) || inicio < 1 || inicio > 999) erro(400, 'Número da primeira questão inválido.');
  }
  if (!respostas.length) erro(400, 'Gabarito vazio.');
  if (respostas.length > MAX_QUESTOES) erro(400, `Gabarito com mais de ${MAX_QUESTOES} questões.`);
  return { inicio, respostas };
}

export const serieValida = v => { const s = String(v ?? '').trim(); if (!SERIES.includes(s)) erro(400, 'Série inválida.'); return s; };
export const trilhaValida = v => { const s = String(v ?? '').trim().toUpperCase(); if (!TRILHAS.includes(s)) erro(400, 'Trilha inválida (MED ou REG).'); return s; };
/* Respostas do aluno vindas da planilha: letras, "_" (em branco) e "*" (dupla). */
export function respostasValidas(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim().toUpperCase();
  if (!/^[A-E_*]{1,200}$/.test(s)) erro(400, 'Respostas do aluno inválidas: use só A a E, "_" e "*".');
  return s;
}
/* Grades das páginas, como atlas-cartao.js serializa: números com uma casa; o resto é recusado. */
const num = (v, max) => { const n = Number(v); if (!Number.isFinite(n) || n < -1000 || n > max) erro(400, 'Grade do cartão inválida.'); return Math.round(n * 10) / 10; };
function gradeValida(g) {
  if (g === null) return null;
  if (!g || typeof g !== 'object') erro(400, 'Grade do cartão inválida.');
  const w = num(g.w, 20000), h = num(g.h, 20000);
  const pontos = a => { if (!Array.isArray(a) || a.length < 1 || a.length > 64) erro(400, 'Grade do cartão inválida.'); return a.map(p => { if (!Array.isArray(p) || p.length !== 2) erro(400, 'Grade do cartão inválida.'); return [num(p[0], 20000), num(p[1], 20000)]; }); };
  const t = pontos(g.t), b = pontos(g.b), esq = pontos(g.esq), dir = pontos(g.dir);
  if (t.length !== b.length || esq.length !== dir.length) erro(400, 'Grade do cartão inválida.');
  if (!Array.isArray(g.blocos) || !g.blocos.length || g.blocos.length > 12) erro(400, 'Grade do cartão inválida.');
  const blocos = g.blocos.map(bl => { if (!Array.isArray(bl) || !bl.length || bl.length > 10) erro(400, 'Grade do cartão inválida.'); return bl.map(i => { if (!Number.isInteger(i) || i < 0 || i >= t.length) erro(400, 'Grade do cartão inválida.'); return i; }); });
  const linhas = Number(g.linhas);
  if (!Number.isInteger(linhas) || linhas < 1 || linhas > esq.length) erro(400, 'Grade do cartão inválida.');
  return { w, h, t, b, esq, dir, blocos, linhas };
}
export function cartoesValidos(v, paginas) {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length !== paginas) erro(400, 'Grades do cartão não batem com o número de páginas.');
  const lista = v.map(gradeValida);
  if (!lista.some(Boolean)) return null;
  const s = JSON.stringify(lista);
  if (s.length > 120000) erro(400, 'Grades do cartão grandes demais.');
  return s;
}
/* Resumo que o aluno vê: acertos, erros, em branco, anuladas (anulada conta a favor de todos). */
export function corrigir(gabarito, respostas) {
  let acertos = 0, erros = 0, brancos = 0, anuladas = 0;
  for (let i = 0; i < gabarito.length; i++) {
    const g = gabarito[i], m = respostas ? respostas[i] : undefined;
    if (g === 'X') { anuladas++; continue; }
    if (!m || m === '_' || m === '*') { brancos++; continue; }
    if (g.split('/').includes(m)) acertos++; else erros++;
  }
  return { questoes: gabarito.length, acertos, erros, brancos, anuladas, valem: gabarito.length - anuladas };
}
