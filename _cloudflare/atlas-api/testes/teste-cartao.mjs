// Cartão-resposta (21/11/2026): o módulo atlas-cartao.js acha a grade das bolhas pelos retângulos de registro e
// pelos ArUco, aguenta marcas comidas, canto cortado e folha torta (modelo calibrado na melhor página do lote), e
// a leitura das bolhas confere com o que foi marcado. Também o gabarito.js: formatos aceitos e recusados.
// Cartão sintético desenhado num canvas, com a geometria do cartão real (150 dpi): nenhum dado real.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ATLAS = fileURLToPath(new URL('../../../atlas/', import.meta.url));
const { lerGabarito, respostasValidas, cartoesValidos, corrigir } = await import('../gabarito.js');
const results = [];
const ok = (n, c, e = '') => results.push([c ? 'OK' : 'FALHOU', n, String(e).slice(0, 300)]);
const falha = f => { try { f(); return null; } catch (e) { return e.message || String(e); } };

/* ---------- gabarito.js ---------- */
let g = lerGabarito('GABARITO OFICIAL\nTotal de questoes: 4\n------\nQ.91: A\nQ.92: b\nQ.93: X\nQ.94: C/A\n');
ok('Formato da coordenação ("Q.91: A"): começa na 91, 4 questões, anulada e dupla normalizadas', g.inicio === 91 && JSON.stringify(g.respostas) === '["A","B","X","A/C"]', JSON.stringify(g));
g = lerGabarito('1 A\n2) B\n3 - anulada\n4. E');
ok('Variações de separador e "anulada" por extenso', g.inicio === 1 && JSON.stringify(g.respostas) === '["A","B","X","E"]', JSON.stringify(g));
g = lerGabarito('ABXDE', 91);
ok('Sequência de letras com a primeira questão informada', g.inicio === 91 && g.respostas.join('') === 'ABXDE');
g = lerGabarito('A, B, C/D, E');
ok('Letras separadas por vírgula, com dupla', JSON.stringify(g.respostas) === '["A","B","C/D","E"]');
ok('Recusa resposta fora de A–E', /não entendida/.test(falha(() => lerGabarito('Q.1: A\nQ.2: F'))));
ok('Recusa buraco na numeração', /Falta a questão 2/.test(falha(() => lerGabarito('Q.1: A\nQ.3: B'))));
ok('Recusa questão repetida', /duas vezes/.test(falha(() => lerGabarito('1 A\n1 B'))));
ok('Recusa linha solta no meio das numeradas', /linhas que não são/.test(falha(() => lerGabarito('1 A\nobs: conferir\n2 B'))));
ok('Recusa gabarito vazio', /vazio/.test(falha(() => lerGabarito('   '))));
ok('Recusa mais de 200 questões', /mais de 200/.test(falha(() => lerGabarito('A'.repeat(201)))));
ok('Respostas do aluno: aceita letras, "_" e "*"; recusa outra coisa', respostasValidas('ab_*e') === 'AB_*E' && respostasValidas('') === null && /inválidas/.test(falha(() => respostasValidas('ABF'))));
const grade = { w: 900, h: 1270, t: [[1, 2], [3, 4]], b: [[1, 9], [3, 9]], esq: [[0, 5]], dir: [[9, 5]], blocos: [[0, 1]], linhas: 1 };
ok('Grades: lista do tamanho das páginas, nulas permitidas, guardada compacta', JSON.parse(cartoesValidos([grade, null], 2)).length === 2 && cartoesValidos([null, null], 2) === null);
ok('Grades: recusa tamanho diferente do número de páginas e forma errada', /não batem/.test(falha(() => cartoesValidos([grade], 2))) && /inválida/.test(falha(() => cartoesValidos([{ ...grade, blocos: [[0, 7]] }], 1))));
ok('Correção: anulada vale, dupla aceita as duas, branco e "*" não contam como erro', JSON.stringify(corrigir(['A', 'X', 'C/D', 'E', 'B'], 'AXD_*')) === JSON.stringify({ questoes: 5, acertos: 2, erros: 0, brancos: 2, anuladas: 1, valem: 4 }), JSON.stringify(corrigir(['A', 'X', 'C/D', 'E', 'B'], 'AXD_*')));

/* ---------- atlas-cartao.js, num navegador ---------- */
const browser = await chromium.launch();
const page = await browser.newPage();
const erros = [];
page.on('pageerror', e => erros.push(e.message));
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ path: ATLAS + 'atlas-alinhamento.js' });
await page.addScriptTag({ path: ATLAS + 'atlas-cartao.js' });
const R1 = 'ABCDEABCDEABCDE' + 'EDCBAEDCBAEDCBA' + 'AAAAABBBBBCCCCC' + 'DDDDDEEEEEABCDE' + 'CEADBCEADBCEADB' + 'BDACEBDACEBDACE';
const R2 = 'EEEEEDDDDDCCCCC' + 'BBBBBAAAAAEDCBA' + 'ABCDEABCDEABCDE' + 'CCCCCAAAAAEEEEE' + 'BADCEBADCEBADCE' + 'DBECADBECADBECA';
const r = await page.evaluate(([R1, R2]) => {
  const C = window.AtlasCartao;
  /* geometria do cartão real a 150 dpi: 6 blocos (x inicial de cada um), passo 26,7 px entre alternativas,
     fileiras de marcas em y = 958 e 1506, 15 linhas a partir de 1007 com passo 34, laterais em x = 34 e 1211 */
  const X0 = [96, 282, 475, 696, 884, 1071], PASSO = 26.7, YT = 958, YB = 1506, Y0 = 1007, PL = 34, XE = 34, XD = 1211;
  const ARUCO = [[37, 60], [1181, 45], [1197, 1649], [53, 1666]];
  function desenhar(respostas, op = {}) {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1753;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.save();
    if (op.rot) { g.translate(620, 876); g.rotate(op.rot * Math.PI / 180); g.translate(-620 + (op.dx || 0), -876 + (op.dy || 0)); }
    g.fillStyle = '#000';
    ARUCO.forEach(([x, y], i) => { if (op.semCanto === i) return; g.fillRect(x - 19, y - 19, 38, 38); g.fillStyle = '#fff'; for (const [a, b] of [[-12, -12], [4, -12], [-12, 4], [4, 4]]) g.fillRect(x + a, y + b, 8, 8); g.fillStyle = '#000'; });
    let col = 0;
    for (const x0 of X0) for (let a = 0; a < 5; a++, col++) {
      const x = x0 + a * PASSO;
      if (!(op.semCima || []).includes(col)) g.fillRect(x - 8.5, YT - 5, 17, 10);
      if (!(op.semBaixo || []).includes(col)) g.fillRect(x - 8.5, YB - 5, 17, 10);
    }
    for (let l = 0; l < 15; l++) { const y = Y0 + l * PL; if (!(op.semEsq || []).includes(l)) g.fillRect(XE - 5, y - 8.5, 10, 17); if (!(op.semDir || []).includes(l)) g.fillRect(XD - 5, y - 8.5, 10, 17); }
    for (let q = 0; q < 90; q++) {
      const bloco = Math.floor(q / 15), l = q % 15, y = Y0 + l * PL;
      for (let a = 0; a < 5; a++) {
        const x = X0[bloco] + a * PASSO;
        g.beginPath(); g.arc(x, y, 9, 0, 7); g.lineWidth = 1.2; g.strokeStyle = '#777'; g.stroke();
        if ('ABCDE'[a] === respostas[q]) { g.beginPath(); g.arc(x, y, 7.5, 0, 7); g.fillStyle = '#111'; g.fill(); }
      }
    }
    g.restore();
    return c;
  }
  const limpa = desenhar(R1);
  /* folha estragada: torta 0,6°, deslocada, sem o ArUco de cima à esquerda, sem 3 marcas de cima, sem 2 laterais */
  const torta = desenhar(R2, { rot: 0.6, dx: 9, dy: -6, semCanto: 0, semCima: [7, 16, 29], semEsq: [0, 8], semDir: [14] });
  const vazia = document.createElement('canvas'); vazia.width = 1240; vazia.height = 1753; const gv = vazia.getContext('2d'); gv.fillStyle = '#fff'; gv.fillRect(0, 0, 1240, 1753); gv.fillStyle = '#000'; gv.font = '40px sans-serif'; gv.fillText('Mapa de desempenho (sem bolhas)', 200, 500);
  const m1 = C.medir(limpa), m2 = C.medir(torta), m3 = C.medir(vazia);
  const g1 = C.escolherGrade(m1, null);
  const modelo = C.melhorModelo([m2, m1]);
  const g2 = C.escolherGrade(m2, modelo), g2semModelo = C.escolherGrade(m2, null), g3 = C.escolherGrade(m3, modelo);
  const s1 = C.serializar(g1, m1.W, m1.H);
  const centro = C.centroDe(g1, 0, 0), ultimo = C.centroDe(g1, 29, 14);
  const d = C.desserializar(s1), centroD = C.centroDe(d, 0, 0);
  return {
    m1: { intacta: m1.intacta, completa: m1.completa, ancoras: !!m1.ancoras, deitadas: m1.marcas.deitadas.length, empe: m1.marcas.empe.length },
    m2: { intacta: m2.intacta, completa: m2.completa, ancoras: !!m2.ancoras, deitadas: m2.marcas.deitadas.length, empe: m2.marcas.empe.length },
    g1: !!g1, blocos: g1 && g1.blocos.length, alts: g1 && g1.blocos[0].length, linhas: g1 && g1.linhas,
    leitura1: g1 && C.lerRespostas(m1, g1, 90), modelo: !!modelo, g2: !!g2, leitura2: g2 && C.lerRespostas(m2, g2, 90), g2semModelo: !!g2semModelo, g3: g3 === null,
    s1: { w: s1.w, h: s1.h, t: s1.t.length, b: s1.b.length, esq: s1.esq.length, dir: s1.dir.length, blocos: s1.blocos.length, linhas: s1.linhas, decimal: s1.t.every(p => Number.isFinite(p[0]) && Math.round(p[0] * 10) === p[0] * 10) },
    centro, ultimo, centroD, json: JSON.stringify(s1).length
  };
}, [R1, R2]);
ok('Folha limpa: 60 marcas deitadas, 30 em pé, 4 ArUco, grade intacta e completa', r.m1.intacta && r.m1.completa && r.m1.ancoras && r.m1.deitadas === 60 && r.m1.empe === 30, JSON.stringify(r.m1));
ok('Grade: 6 blocos de 5 alternativas e 15 linhas', r.g1 && r.blocos === 6 && r.alts === 5 && r.linhas === 15, JSON.stringify([r.blocos, r.alts, r.linhas]));
ok('Centro da 1ª bolha e da última caem onde foram desenhadas (±1 px)', r.centro && Math.abs(r.centro.x - 96) <= 1 && Math.abs(r.centro.y - 1007) <= 1 && Math.abs(r.ultimo.x - (1071 + 4 * 26.7)) <= 1 && Math.abs(r.ultimo.y - (1007 + 14 * 34)) <= 1, JSON.stringify([r.centro, r.ultimo]));
ok('Leitura das 90 bolhas da folha limpa bate com o que foi marcado', r.leitura1 === R1, r.leitura1);
ok('Folha torta e estragada: perdeu marcas e um canto (o canto volta pelos outros três)', !r.m2.intacta && r.m2.ancoras && r.m2.deitadas === 57 && r.m2.empe === 27, JSON.stringify(r.m2));
ok('Modelo calibrado na folha limpa; a estragada ganha grade pelo modelo', r.modelo && r.g2);
ok('Leitura das 90 bolhas da folha estragada bate (marcas comidas, canto cortado, 0,6° torta)', r.leitura2 === R2, r.leitura2);
ok('Página que não é cartão (um mapa com texto) fica sem grade', r.g3);
ok('Forma guardada: 30 marcas de cima e de baixo, 15 de cada lado, 6 blocos, 15 linhas, uma casa decimal, ~1,5 KB', r.s1.t === 30 && r.s1.b === 30 && r.s1.esq === 15 && r.s1.dir === 15 && r.s1.blocos === 6 && r.s1.linhas === 15 && r.s1.decimal && r.s1.w === 1240 && r.s1.h === 1753 && r.json < 2500, JSON.stringify(r.s1) + ' ' + r.json);
ok('Desserializar devolve a mesma geometria', r.centroD && Math.abs(r.centroD.x - r.centro.x) < 0.2 && Math.abs(r.centroD.y - r.centro.y) < 0.2);
ok('Sem erro de JavaScript', erros.length === 0, erros.join('|'));
await browser.close();

for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK').length;
console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`);
