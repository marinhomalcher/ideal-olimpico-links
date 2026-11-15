// Folha de redação FICTÍCIA (ALUNO TESTE, RA inventado) e PDF "escaneado", usados nas suítes da Redação.
// Nenhum dado de aluno real.
/* PDF com uma imagem JPEG por página (como sai de um scanner). */
export function pdfDeJpegs(paginas) {
  const objs = [];
  const add = conteudo => { objs.push(conteudo); return objs.length; };
  const catalogo = add(null), raiz = add(null), kids = [];
  for (const { jpeg, w, h } of paginas) {
    const img = add(Buffer.concat([Buffer.from(`<</Type/XObject/Subtype/Image/Width ${w}/Height ${h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpeg.length}>>stream\n`), jpeg, Buffer.from('\nendstream')]));
    const desenho = 'q 595.32 0 0 841.92 0 0 cm /Im0 Do Q';
    const cont = add(Buffer.from(`<</Length ${desenho.length}>>stream\n${desenho}\nendstream`));
    kids.push(add(Buffer.from(`<</Type/Page/Parent ${raiz} 0 R/MediaBox[0 0 595.32 841.92]/Resources<</XObject<</Im0 ${img} 0 R>>>>/Contents ${cont} 0 R>>`)));
  }
  objs[catalogo - 1] = Buffer.from(`<</Type/Catalog/Pages ${raiz} 0 R>>`);
  objs[raiz - 1] = Buffer.from(`<</Type/Pages/Kids[${kids.map(k => k + ' 0 R').join(' ')}]/Count ${kids.length}>>`);
  const partes = [Buffer.from('%PDF-1.4\n')], pos = [];
  let tam = partes[0].length;
  objs.forEach((o, i) => { pos.push(tam); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]); partes.push(b); tam += b.length; });
  partes.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map(p => String(p).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<</Size ${objs.length + 1}/Root ${catalogo} 0 R>>\nstartxref\n${tam}\n%%EOF\n`));
  return Buffer.concat(partes);
}

/* Desenho da folha fictícia e do "scanner" (rodam no navegador). */
export const FOLHA_JS = `
/* Code 128: dígitos em número par usam o conjunto C; ímpar começa no B e troca para o C. Devolve as larguras. */
window.code128 = function (txt) {
  const C = window.AtlasAlinhamento.C128, vals = [];
  if (/^\d+$/.test(txt) && txt.length % 2 === 0) { vals.push(105); for (let i = 0; i < txt.length; i += 2) vals.push(Number(txt.slice(i, i + 2))); }
  else if (/^\d+$/.test(txt)) { vals.push(104, txt.charCodeAt(0) - 32, 99); for (let i = 1; i < txt.length; i += 2) vals.push(Number(txt.slice(i, i + 2))); }
  else { vals.push(104); for (const ch of txt) vals.push(ch.charCodeAt(0) - 32); }
  let soma = vals[0]; for (let i = 1; i < vals.length; i++) soma += i * vals[i];
  vals.push(soma % 103);
  return (vals.map(v => C[v]).join('') + '2331112').split('').map(Number);
};
window.folhaTeste = function (op = {}) {
  const A = window.AtlasAlinhamento, W = 1240, H = Math.round(W * A.MODELO.proporcao);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  const P = (fx, fy) => [fx * W, fy * W * A.MODELO.proporcao];
  /* cabeçalho */
  x.fillStyle = '#000'; x.font = 'bold 34px Arial'; x.fillText('FOLHA DE REDAÇÃO', 0.07 * W, 0.075 * H);
  x.fillStyle = '#c8102e'; x.font = 'bold 16px Arial'; x.fillText('ENSINO MÉDIO – SIMULADO ENEM', 0.07 * W, 0.092 * H);
  x.fillRect(0.07 * W, 0.096 * H, 0.33 * W, 2);
  x.fillStyle = '#000'; x.font = 'bold 15px Arial';
  x.fillText('Nome completo do aluno: ' + (op.avulsa ? '' : 'ALUNO TESTE'), 0.07 * W, 0.115 * H);
  x.fillText('Número do CPF: ' + (op.avulsa ? '' : '***.000.000-**'), 0.07 * W, 0.132 * H);
  x.fillText('Data de Nascimento: ' + (op.avulsa ? '' : '01/01/2009'), 0.07 * W, 0.165 * H);
  x.lineWidth = 3; x.strokeRect(0.80 * W, 0.06 * H, 0.13 * W, 0.04 * H); x.font = 'bold 30px Arial'; x.fillText('1º DIA', 0.815 * W, 0.09 * H);
  x.fillStyle = '#c8102e'; x.fillRect(0.66 * W, 0.105 * H, 0.27 * W, 0.022 * H); x.fillStyle = '#fff'; x.font = 'bold 12px Arial'; x.fillText('NÚMERO DE MATRÍCULA        SÉRIE', 0.68 * W, 0.12 * H);
  x.fillStyle = '#000'; x.font = 'bold 20px Arial'; if (!op.avulsa) x.fillText((op.ra || '73519') + '          3ª SÉRIE', 0.72 * W, 0.15 * H);
  /* linha da assinatura em vermelho, quase encostando no marcador de cima à esquerda */
  x.fillStyle = '#c8102e'; x.fillRect(0.075 * W, 0.1826 * H + 1, 0.85 * W, 2);
  /* código de barras Code 128 com o RA (como na folha real) */
  if (!op.avulsa) { const larg = window.code128(op.ra || '73519'), mod = 3, tot = larg.reduce((a, b) => a + b, 0) * mod; let px = 0.59 * W - tot / 2; larg.forEach((l, k) => { if (k % 2 === 0) { x.fillStyle = '#000'; x.fillRect(px, 0.02 * H, l * mod, 0.03 * H); } px += l * mod; }); }
  /* instruções */
  x.fillStyle = '#000'; x.font = '13px Arial';
  for (let i = 0; i < 3; i++) x.fillText((i + 1) + '. Instrução de teste para a folha fictícia de redação, linha ' + (i + 1) + '.', 0.12 * W, (0.205 + i * 0.012) * H);
  /* quadro com 30 linhas vermelhas e números */
  const y0 = 0.25 * H, y1 = 0.90 * H, x0 = 0.07 * W, x1 = 0.93 * W, alt = (y1 - y0) / 30;
  x.strokeStyle = '#c8102e'; x.lineWidth = 2; x.strokeRect(x0, y0, x1 - x0, y1 - y0); x.beginPath(); x.moveTo(x0 + 0.035 * W, y0); x.lineTo(x0 + 0.035 * W, y1); x.stroke();
  x.lineWidth = 1; x.font = 'bold 13px Arial'; x.fillStyle = '#000';
  for (let i = 0; i < 30; i++) { const y = y0 + alt * (i + 1); x.beginPath(); x.moveTo(x0, y); x.lineTo(x1, y); x.stroke(); x.fillText(String(i + 1), x0 + 8, y - 6); }
  /* "texto do aluno" em caneta */
  x.fillStyle = '#1b1b3a'; x.font = 'italic 22px serif';
  for (let i = 0; i < 24; i++) x.fillText('Texto manuscrito de teste da redação, linha ' + (i + 1) + ' com argumentos.', x0 + 0.05 * W, y0 + alt * (i + 1) - 5);
  /* rodapé com logos vermelhos */
  x.fillStyle = '#c8102e'; x.font = 'bold 40px Arial'; x.fillText('enem', 0.40 * W, 0.935 * H); x.fillText('ideal', 0.80 * W, 0.935 * H);
  x.beginPath(); x.arc(0.15 * W, 0.925 * H, 22, 0, 7); x.fill();
  /* marcadores em "L" (por último, como na impressão): braço 0,0345 da largura, espessura 0,0036 */
  const L = 0.0345 * W, T = 0.0036 * W; x.fillStyle = '#000';
  for (const [k, [fx, fy]] of Object.entries(A.MODELO.cantos)) {
    const [px, py] = P(fx, fy), dx = k[1] === 'e' ? 1 : -1, dy = k[0] === 's' ? 1 : -1;
    x.fillRect(dx > 0 ? px : px - L, dy > 0 ? py : py - T, L, T);
    x.fillRect(dx > 0 ? px : px - T, dy > 0 ? py : py - L, T, L);
  }
  return c;
};
/* Simula o scanner: gira (graus), desloca, muda a escala, opcionalmente cinza, borrão e tapa um canto. */
window.escanear = function (folha, op = {}) {
  const c = document.createElement('canvas'); c.width = folha.width; c.height = folha.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  if (op.cinza) x.filter = 'grayscale(1) blur(0.6px) contrast(0.85)';
  const cx = c.width / 2 + (op.dx || 0), cy = c.height / 2 + (op.dy || 0), s = op.escala || 1, a = (op.ang || 0) * Math.PI / 180;
  x.setTransform(s * Math.cos(a), s * Math.sin(a), -s * Math.sin(a), s * Math.cos(a), cx, cy);
  x.drawImage(folha, -folha.width / 2, -folha.height / 2);
  x.setTransform(1, 0, 0, 1, 0, 0); x.filter = 'none';
  if (op.tapar) { const [fx, fy] = window.AtlasAlinhamento.MODELO.cantos[op.tapar], p = window.leva([fx * folha.width, fy * folha.width * window.AtlasAlinhamento.MODELO.proporcao], folha, op); x.fillStyle = '#fff'; x.fillRect(p[0] - 70, p[1] - 70, 140, 140); }
  return c;
};
/* Onde um ponto da folha original cai no "scan". */
window.leva = function ([px, py], folha, op = {}) {
  const s = op.escala || 1, a = (op.ang || 0) * Math.PI / 180, qx = px - folha.width / 2, qy = py - folha.height / 2;
  return [folha.width / 2 + (op.dx || 0) + s * (qx * Math.cos(a) - qy * Math.sin(a)), folha.height / 2 + (op.dy || 0) + s * (qx * Math.sin(a) + qy * Math.cos(a))];
};
/* Erro (px) entre a folha original e a folha escaneada depois de alinhada. */
window.erroAlinhamento = function (folha, op, r, m) {
  const A = window.AtlasAlinhamento, W = folha.width, H = folha.height, pts = [[W / 2, H / 2]];
  for (const [fx, fy] of Object.values(A.MODELO.cantos)) pts.push([fx * W, fy * W * A.MODELO.proporcao]);
  m = m || r.matriz;
  return Math.max(...pts.map(p => { const s = window.leva(p, folha, op), d = [m.p * s[0] - m.q * s[1] + m.e, m.q * s[0] + m.p * s[1] + m.f]; return Math.hypot(d[0] - p[0], d[1] - p[1]); }));
};
window.jpeg = c => c.toDataURL('image/jpeg', 0.7).split(',')[1];
`;

