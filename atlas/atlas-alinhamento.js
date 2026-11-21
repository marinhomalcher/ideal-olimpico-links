/* ATLAS · Redação · alinhamento das folhas escaneadas e leitura do RA (código de barras).
   Acha os 4 marcadores em "L" da FOLHA DE REDAÇÃO, endireita e centraliza a página
   (giro + deslocamento + escala, sem deformar a letra) e percebe folha de cabeça para baixo.
   Tudo roda no navegador; nada é enviado ao servidor. */
(function () {
  'use strict';

  /* Medidas da folha (A4), em fração da página: canto externo de cada marcador em "L".
     se = superior esquerdo, sd = superior direito, ie = inferior esquerdo, id = inferior direito.
     Calibrado com 35 folhas reais escaneadas (16/11/2026, Simulado ENEM 2026): o retângulo entre os
     cantos tem altura/largura = 1,2255 (de 1,2226 a 1,2337), por isso os de baixo ficam em 0,9297. */
  const MODELO = {
    proporcao: 841.92 / 595.32,
    cantos: { se: [0.0707, 0.1826], sd: [0.9329, 0.1826], ie: [0.0707, 0.9297], id: [0.9329, 0.9297] },
    cabecalho: [0.02, 0.17]   /* faixa acima dos marcadores de cima: título, nome, código de barras */
  };
  const TIPOS = ['se', 'sd', 'ie', 'id'];

  /* ---------- leitura da imagem ---------- */
  function binarizar(img) {
    /* Usa o canal vermelho: tinta preta fica escura e as linhas vermelhas da folha somem
       (no scan colorido); no scan em cinza o canal vermelho é o próprio cinza. */
    const { width: w, height: h, data } = img, n = w * h, v = new Uint8Array(n), hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) { const x = data[i * 4]; v[i] = x; hist[x]++; }
    let acum = 0, papel = 255;
    for (let k = 0; k < 256; k++) { acum += hist[k]; if (acum >= n * 0.9) { papel = k; break; } }
    const limite = Math.max(40, papel * 0.55), b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = v[i] < limite ? 1 : 0;
    b.cinza = v; b.papel = papel;
    return b;
  }

  /* Erosão (minimo) ou dilatação 3×3 de uma imagem binária. */
  function morf(ent, w, h, minimo) {
    const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0, i = y * w; x < w; x++, i++) {
      const e = x ? ent[i - 1] : ent[i], d = x < w - 1 ? ent[i + 1] : ent[i];
      t[i] = minimo ? (e & ent[i] & d) : (e | ent[i] | d);
    }
    for (let y = 0; y < h; y++) for (let x = 0, i = y * w; x < w; x++, i++) {
      const c = y ? t[i - w] : t[i], bx = y < h - 1 ? t[i + w] : t[i];
      o[i] = minimo ? (c & t[i] & bx) : (c | t[i] | bx);
    }
    return o;
  }
  /* Abertura 3×3 (erosão + dilatação): apaga traços finos, como a linha vermelha da assinatura,
     que no scan em cinza escurece e encosta no "L"; os braços grossos do marcador continuam. */
  function abrir(b, w, h) { return morf(morf(b, w, h, true), w, h, false); }
  /* Componentes conectados (4 vizinhos), com caixa, área, centro e os 4 pontos extremos.
     Se `mapa` (Int32Array w*h) vier, recebe em cada pixel o índice do componente + 1 (0 = fundo). */
  function componentes(b, w, h, mapa) {
    const rot = new Int32Array(w * h), pai = [0];
    const raiz = x => { while (pai[x] !== x) { pai[x] = pai[pai[x]]; x = pai[x]; } return x; };
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      if (!b[i]) continue;
      const e = x ? rot[i - 1] : 0, c = y ? rot[i - w] : 0;
      if (!e && !c) { pai.push(pai.length); rot[i] = pai.length - 1; }
      else if (e && c) { const re = raiz(e), rc = raiz(c); rot[i] = re < rc ? re : rc; if (re !== rc) pai[re > rc ? re : rc] = re < rc ? re : rc; }
      else rot[i] = e || c;
    }
    const m = pai.length, f = new Int32Array(m);
    for (let k = 1; k < m; k++) f[k] = raiz(k);
    const st = new Map();
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      const r = rot[i]; if (!r) continue;
      const k = f[r]; let s = st.get(k);
      if (!s) { s = { x0: x, x1: x, y0: y, y1: y, area: 0, sx: 0, sy: 0, se: [x, y], sd: [x, y], ie: [x, y], id: [x, y] }; st.set(k, s); }
      if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x; if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
      s.area++; s.sx += x; s.sy += y;
      if (x + y < s.se[0] + s.se[1]) s.se = [x, y];
      if (x - y > s.sd[0] - s.sd[1]) s.sd = [x, y];
      if (y - x > s.ie[1] - s.ie[0]) s.ie = [x, y];
      if (x + y > s.id[0] + s.id[1]) s.id = [x, y];
    }
    const lista = [...st.values()];
    if (mapa) {
      const idx = new Map([...st.keys()].map((k, i) => [k, i + 1]));
      for (let i = 0; i < w * h; i++) mapa[i] = rot[i] ? idx.get(f[rot[i]]) : 0;
    }
    return lista;
  }

  /* Um componente é marcador se tem o tamanho de um "L" e a massa puxada para o cotovelo. */
  function marcadores(comps, w) {
    const out = [];
    for (const s of comps) {
      const bw = s.x1 - s.x0 + 1, bh = s.y1 - s.y0 + 1, fill = s.area / (bw * bh);
      if (bw < 0.022 * w || bh < 0.022 * w || bw > 0.06 * w || bh > 0.06 * w) continue;
      if (bw / bh < 0.6 || bw / bh > 1.6 || fill < 0.08 || fill > 0.45) continue;
      const dx = (s.sx / s.area - (s.x0 + s.x1) / 2) / bw, dy = (s.sy / s.area - (s.y0 + s.y1) / 2) / bh;
      if (Math.abs(dx) < 0.12 || Math.abs(dy) < 0.12) continue;
      const tipo = (dy < 0 ? (dx < 0 ? 'se' : 'sd') : (dx < 0 ? 'ie' : 'id'));
      /* Canto externo do pixel extremo (o pixel x ocupa de x a x+1). */
      out.push({ tipo, ponto: [s[tipo][0] + (tipo[1] === 'd' ? 1 : 0), s[tipo][1] + (tipo[0] === 'i' ? 1 : 0)] });
    }
    return out;
  }

  /* Segunda busca de um marcador que faltou: nas folhas impressas de verdade, um "L" pode sair com
     traço fino ou pontilhado (em 11/2026 os da direita saíam com metade da espessura dos da esquerda;
     a abertura o apaga) ou emendado numa linha da folha (no scan em cinza, ou quando a compressão do
     PDF escurece a linha vermelha; o conjunto fica comprido demais). Recorta a vizinhança de onde ele
     deveria estar, engrossa 2 px (une os pontos e as falhas de até 4 px) e, para cada mancha, olha só
     a caixa do tamanho de um "L" a partir do canto externo, ignorando o que continua além dela.
     Devolve o canto externo (descontado o engrossamento) ou null. */
  function marcadorFraco(b, w, h, tipo, esperado) {
    const R = Math.round(0.08 * w), S = Math.round(0.045 * w);   /* janela; lado da caixa do "L" (braço 0,0345 + folga) */
    const x0 = Math.max(0, Math.round(esperado[0]) - R), y0 = Math.max(0, Math.round(esperado[1]) - R);
    const cw = Math.min(w, x0 + 2 * R) - x0, ch = Math.min(h, y0 + 2 * R) - y0;
    if (cw < 10 || ch < 10) return null;
    const rec = new Uint8Array(cw * ch), sx = tipo[1] === 'e' ? 1 : -1, sy = tipo[0] === 's' ? 1 : -1;
    /* Primeiro com o limiar normal; se não achar, com um limiar mais tolerante (traço que ficou cinza-claro
       ao reduzir o scan para 150 dpi), que só vale aqui dentro. */
    for (const fator of [0, 0.72]) {
      for (let y = 0; y < ch; y++) {
        const ini = (y0 + y) * w + x0;
        if (!fator) rec.set(b.subarray(ini, ini + cw), y * cw);
        else for (let x = 0; x < cw; x++) rec[y * cw + x] = b.cinza[ini + x] < b.papel * fator ? 1 : 0;
      }
      const g = morf(morf(rec, cw, ch, false), cw, ch, false), mapa = new Int32Array(cw * ch);
      let melhor = null, dist = 0.08 * w;
      const comps = componentes(g, cw, ch, mapa);
      for (let k = 0; k < comps.length; k++) {
        const c = comps[k];
        if (c.area < 30) continue;
        const [qx, qy] = c[tipo];   /* canto externo da mancha, no sentido do "L" procurado */
        /* Caixa S×S a partir desse canto, para dentro da folha: só o que está nela conta. */
        const bx0 = sx > 0 ? qx : Math.max(0, qx - S + 1), by0 = sy > 0 ? qy : Math.max(0, qy - S + 1);
        const bx1 = Math.min(cw - 1, bx0 + S - 1), by1 = Math.min(ch - 1, by0 + S - 1);
        let x_0 = cw, x_1 = -1, y_0 = ch, y_1 = -1, area = 0, mx = 0, my = 0;
        for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
          if (mapa[y * cw + x] !== k + 1) continue;   /* só a própria mancha: o que está perto não conta */
          area++; mx += x; my += y;
          if (x < x_0) x_0 = x; if (x > x_1) x_1 = x; if (y < y_0) y_0 = y; if (y > y_1) y_1 = y;
        }
        if (!area) continue;
        const bw = x_1 - x_0 + 1, bh = y_1 - y_0 + 1, fill = area / (bw * bh);
        if (bw < 0.022 * w || bh < 0.022 * w || bw / bh < 0.6 || bw / bh > 1.6 || fill < 0.08 || fill > 0.45) continue;
        const dx = (mx / area - (x_0 + x_1) / 2) / bw, dy = (my / area - (y_0 + y_1) / 2) / bh;
        if (dx * sx > -0.12 || dy * sy > -0.12) continue;   /* massa puxada para o cotovelo */
        /* Canto externo do pixel extremo, descontados os 2 px do engrossamento. */
        const p = [x0 + (sx > 0 ? x_0 + 2 : x_1 + 1 - 2), y0 + (sy > 0 ? y_0 + 2 : y_1 + 1 - 2)];
        const d = Math.hypot(p[0] - esperado[0], p[1] - esperado[1]);
        if (d < dist) { dist = d; melhor = p; }
      }
      if (melhor) return melhor;
    }
    return null;
  }

  /* ---------- geometria (números complexos: z = x + iy) ---------- */
  function ajustar(pares) {
    /* Melhor giro + escala + deslocamento (sem deformar) que leva os pontos da imagem aos do modelo. */
    const n = pares.length;
    let msx = 0, msy = 0, mtx = 0, mty = 0;
    for (const [s, t] of pares) { msx += s[0]; msy += s[1]; mtx += t[0]; mty += t[1]; }
    msx /= n; msy /= n; mtx /= n; mty /= n;
    let nr = 0, ni = 0, den = 0;
    for (const [s, t] of pares) {
      const sx = s[0] - msx, sy = s[1] - msy, tx = t[0] - mtx, ty = t[1] - mty;
      nr += tx * sx + ty * sy; ni += ty * sx - tx * sy; den += sx * sx + sy * sy;
    }
    const p = nr / den, q = ni / den;
    const m = { p, q, e: mtx - (p * msx - q * msy), f: mty - (q * msx + p * msy) };
    m.residuo = Math.max(...pares.map(([s, t]) => Math.hypot(aplicar(m, s)[0] - t[0], aplicar(m, s)[1] - t[1])));
    return m;
  }
  const aplicar = (m, [x, y]) => [m.p * x - m.q * y + m.e, m.q * x + m.p * y + m.f];
  const inverter = (m, [x, y]) => { const d = m.p * m.p + m.q * m.q, X = x - m.e, Y = y - m.f; return [(m.p * X + m.q * Y) / d, (m.p * Y - m.q * X) / d]; };
  /* Gira o resultado em torno do centro da folha final (graus; positivo = sentido horário). */
  function girarEmTorno(m, graus, cx, cy) {
    const a = graus * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const p = c * m.p - s * m.q, q = s * m.p + c * m.q;
    const ex = m.e - cx, fy = m.f - cy;
    return { p, q, e: cx + c * ex - s * fy, f: cy + s * ex + c * fy };
  }

  /* Quantas trocas claro/escuro há na faixa do cabeçalho, vista pela transformação m. */
  function tinta(b, w, h, m, W, H) {
    let trocas = 0;
    const passoY = Math.max(1, H * 0.003);
    for (let yc = H * MODELO.cabecalho[0]; yc < H * MODELO.cabecalho[1]; yc += passoY) {
      let ant = 0;
      for (let xc = W * 0.05; xc < W * 0.95; xc += 1) {
        const [x, y] = inverter(m, [xc, yc]), xi = Math.round(x), yi = Math.round(y);
        const v = xi >= 0 && yi >= 0 && xi < w && yi < h ? b[yi * w + xi] : 0;
        if (v !== ant) { trocas++; ant = v; }
      }
    }
    return trocas;
  }

  /* ---------- código de barras (Code 128) com o RA ---------- */
  /* Larguras (barra, espaço, …) de cada símbolo 0–105, tabela oficial do Code 128. */
  const C128 = '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232'.split(' ');
  const C128_IDX = new Map(C128.map((p, i) => [p, i]));
  const C128_FIM = '233111';
  /* Faixa onde a folha imprime o código (fração da folha alinhada). */
  /* Faixa onde o código de barras é procurado. Vai até 9% da altura porque, desde 17/11/2026, as folhas
     novas trazem o código ao lado do "1º DIA" (com 4 cantos em volta), mais abaixo; as antigas continuam cobertas. */
  const FAIXA_CODIGO = { x: [0.36, 0.86], y: [0.012, 0.09] };

  /* Lê um símbolo de 6 larguras; devolve o índice na tabela ou -1. */
  function simbolo(r, i) {
    let t = 0;
    for (let k = 0; k < 6; k++) t += r[i + k];
    const mod = t / 11, p = [];
    let soma = 0;
    for (let k = 0; k < 6; k++) { const q = Math.max(1, Math.min(4, Math.round(r[i + k] / mod))); p.push(q); soma += q; }
    if (soma !== 11) {
      /* Ajuste pela borda: barra+espaço vizinhos compensam tinta que "engorda" no scan. */
      const e = [r[i] + r[i + 1], r[i + 1] + r[i + 2], r[i + 2] + r[i + 3], r[i + 3] + r[i + 4]].map(x => Math.round(x / mod));
      for (const [k, cod] of C128.entries()) {
        const c = cod.split('').map(Number);
        if (c[0] + c[1] === e[0] && c[1] + c[2] === e[1] && c[2] + c[3] === e[2] && c[3] + c[4] === e[3]) return k;
      }
      return -1;
    }
    const k = C128_IDX.get(p.join(''));
    return k === undefined ? (p.join('') === C128_FIM ? 106 : -1) : k;
  }

  /* Decodifica uma sequência de larguras (começando por barra). Confere o dígito verificador. */
  function decodificar(r) {
    for (let i = 0; i + 6 <= r.length; i += 2) {
      const ini = simbolo(r, i);
      if (ini < 103 || ini > 105) continue;
      const vals = [ini];
      let j = i + 6, fim = false;
      while (j + 6 <= r.length) {
        const k = simbolo(r, j);
        if (k === 106) { fim = true; break; }
        if (k < 0) break;
        vals.push(k); j += 6;
      }
      if (!fim || vals.length < 3) continue;
      const dv = vals.pop();
      let soma = vals[0];
      for (let k = 1; k < vals.length; k++) soma += k * vals[k];
      if (soma % 103 !== dv) continue;
      let conj = ini === 103 ? 'A' : ini === 104 ? 'B' : 'C', txt = '';
      for (const v of vals.slice(1)) {
        if (conj === 'C') { if (v < 100) txt += String(v).padStart(2, '0'); else if (v === 100) conj = 'B'; else if (v === 101) conj = 'A'; }
        else if (v === 99) conj = 'C';
        else if (v === 100 && conj === 'A') conj = 'B';
        else if (v === 101 && conj === 'B') conj = 'A';
        else if (v < 96) txt += conj === 'B' ? String.fromCharCode(v + 32) : String.fromCharCode(v < 64 ? v + 32 : v - 64);
      }
      return txt;
    }
    return null;
  }

  /* Varre várias linhas da faixa do código na folha alinhada; vale a leitura mais repetida. */
  function lerCodigo(v, w, h, m, W, H) {
    const votos = new Map(), d = m.p * m.p + m.q * m.q;
    const amostra = (x, y) => {
      const X = x - m.e, Y = y - m.f, sx = (m.p * X + m.q * Y) / d, sy = (m.p * Y - m.q * X) / d;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) return 255;
      const fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
      return (v[i] * (1 - fx) + v[i + 1] * fx) * (1 - fy) + (v[i + w] * (1 - fx) + v[i + w + 1] * fx) * fy;
    };
    const x0 = FAIXA_CODIGO.x[0] * W, x1 = FAIXA_CODIGO.x[1] * W, passo = 0.5;
    for (let y = FAIXA_CODIGO.y[0] * H; y < FAIXA_CODIGO.y[1] * H; y += Math.max(1, H * 0.0015)) {
      const linha = [];
      let mn = 255, mx = 0;
      for (let x = x0; x < x1; x += passo) { const g = amostra(x, y); linha.push(g); if (g < mn) mn = g; if (g > mx) mx = g; }
      if (mx - mn < 60) continue;
      const corte = (mn + mx) / 2, r = [];
      let atual = null;
      for (const g of linha) {
        const preto = g < corte;
        if (atual === null) { if (!preto) continue; atual = true; r.push(0); }
        if (preto !== atual) { atual = preto; r.push(0); }
        r[r.length - 1] += passo;
      }
      const txt = decodificar(r);
      if (txt) votos.set(txt, (votos.get(txt) || 0) + 1);
    }
    let melhor = null, n = 0;
    for (const [t, c] of votos) if (c > n) { n = c; melhor = t; }
    return melhor && n >= 2 ? melhor : null;
  }

  /* Código de barras numa página que não é folha de redação (mapas de desempenho, PDF digital):
     varre linhas horizontais da região (frações da página) direto no canvas; vale a leitura mais repetida. */
  function lerCodigoImagem(fonte, regiao = { x: [0, 1], y: [0, 1] }) {
    const w = fonte.width, h = fonte.height;
    const d = fonte.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const votos = new Map(), x0 = Math.floor(regiao.x[0] * w), x1 = Math.ceil(regiao.x[1] * w);
    for (let y = Math.floor(regiao.y[0] * h); y < regiao.y[1] * h; y += Math.max(1, Math.round(h * 0.002))) {
      const linha = [];
      let mn = 255, mx = 0;
      for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4, g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; linha.push(g); if (g < mn) mn = g; if (g > mx) mx = g; }
      if (mx - mn < 60) continue;
      const corte = (mn + mx) / 2, r = [];
      let atual = null;
      for (const g of linha) {
        const preto = g < corte;
        if (atual === null) { if (!preto) continue; atual = true; r.push(0); }
        if (preto !== atual) { atual = preto; r.push(0); }
        r[r.length - 1]++;
      }
      const txt = decodificar(r);
      if (txt) votos.set(txt, (votos.get(txt) || 0) + 1);
    }
    let melhor = null, n = 0;
    for (const [t, c] of votos) if (c > n) { n = c; melhor = t; }
    return melhor && n >= 2 ? melhor : null;
  }

  /* ---------- análise de uma página ---------- */
  function analisar(fonte) {
    const w = fonte.width, h = fonte.height;
    const img = fonte.getContext ? fonte.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h) : fonte;
    const b = binarizar(img);
    const W = w, H = Math.round(w * MODELO.proporcao);
    const alvo = t => [MODELO.cantos[t][0] * W, MODELO.cantos[t][1] * W * MODELO.proporcao];
    const cands = marcadores(componentes(abrir(b, w, h), w, h), w);
    /* Para cada canto, o candidato do tipo certo mais perto de onde o modelo diz que ele fica,
       com a folha em pé ou de cabeça para baixo (o "L" virado continua com o mesmo formato). */
    const OPOSTO = { se: 'id', sd: 'ie', ie: 'sd', id: 'se' };
    /* Posição esperada do canto t com a folha em pé (0) ou de cabeça para baixo (1). */
    const esperado = (t, virada) => virada ? [(1 - MODELO.cantos[OPOSTO[t]][0]) * w, (1 - MODELO.cantos[OPOSTO[t]][1]) * h] : [MODELO.cantos[t][0] * w, MODELO.cantos[t][1] * h];
    const achados = {}, orient = {};
    for (const t of TIPOS) {
      let melhor = null, dist = 0.15 * w;
      for (const c of cands) if (c.tipo === t) for (const virada of [0, 1]) {
        const esp = esperado(t, virada), d = Math.hypot(c.ponto[0] - esp[0], c.ponto[1] - esp[1]);
        if (d < dist) { dist = d; melhor = c; orient[t] = virada; }
      }
      if (melhor) achados[t] = melhor.ponto;
    }
    /* Os cantos têm de concordar sobre a folha estar em pé ou virada: os que divergem da maioria saem
       (uma mancha em forma de "L" no lugar errado) e são procurados de novo na posição certa. */
    const votos = [0, 0];
    for (const t of TIPOS) if (achados[t]) votos[orient[t]]++;
    const viradas = votos[0] === votos[1] ? [0, 1] : [votos[1] > votos[0] ? 1 : 0];
    for (const t of TIPOS) if (achados[t] && !viradas.includes(orient[t])) delete achados[t];
    /* Cantos que faltaram: segunda busca (marcador impresso fraco ou emendado numa linha), na posição
       esperada da orientação que os outros indicam; sem maioria, nas duas. */
    for (const t of TIPOS) {
      if (achados[t]) continue;
      for (const virada of viradas) {
        const p = marcadorFraco(b, w, h, t, esperado(t, virada));
        if (p) { achados[t] = p; break; }
      }
    }
    const avisos = [];
    let usados = TIPOS.filter(t => achados[t]);
    let m = null;
    if (usados.length >= 2) {
      m = ajustar(usados.map(t => [achados[t], alvo(t)]));
      /* Um marcador fora do lugar (mancha, rasgo) é descartado se os outros 3 concordarem. */
      if (m.residuo > 0.006 * W && usados.length === 4) {
        let melhor = null;
        for (const fora of usados) {
          const u = usados.filter(t => t !== fora), mm = ajustar(u.map(t => [achados[t], alvo(t)]));
          if (!melhor || mm.residuo < melhor.m.residuo) melhor = { m: mm, u };
        }
        m = melhor.m; usados = melhor.u;
      }
      const escala = Math.hypot(m.p, m.q);
      if (m.residuo > 0.006 * W || escala < 0.8 || escala > 1.25) { m = null; usados = []; }
    }
    if (!m) {
      avisos.push('Marcadores dos cantos não encontrados: a página aparece como veio do scanner.');
      m = { p: 1, q: 0, e: 0, f: 0 };
    } else if (usados.length < 4) {
      avisos.push('Só ' + usados.length + ' dos 4 marcadores encontrados: alinhamento feito com eles.');
    }
    /* Cabeça para baixo: o cabeçalho (título, nome, código de barras) tem muito mais tinta
       do que o rodapé. Compara a folha como está com ela virada 180°. Com marcadores, vira em
       torno do centro do retângulo deles (assim cada "L" cai no lugar do oposto). */
    const mc = MODELO.cantos, centro = usados.length
      ? [(mc.se[0] + mc.sd[0]) / 2 * W, (mc.se[1] + mc.ie[1]) / 2 * H] : [W / 2, H / 2];
    const virada = girarEmTorno(m, 180, centro[0], centro[1]);
    const tCerta = tinta(b, w, h, m, W, H), tVirada = tinta(b, w, h, virada, W, H);
    let invertida = false;
    if (tVirada > tCerta * 1.6 && tVirada > 40) { invertida = true; m = virada; }
    else if (!(tCerta > tVirada * 1.6 && tCerta > 40)) avisos.push('Não deu para ter certeza se a folha está de cabeça para cima. Confira e use "Girar 180°" se precisar.');
    /* RA: só dígitos (folha avulsa não tem código). */
    const codigo = lerCodigo(b.cinza, w, h, m, W, H);
    const ra = codigo && /^\d{1,15}$/.test(codigo) ? codigo : null;
    const giro = Math.atan2(m.q, m.p) * 180 / Math.PI;
    const inclinacao = invertida ? ((giro + 360) % 360) - 180 : giro;
    return {
      largura: W, altura: H, centro, matriz: { p: m.p, q: m.q, e: m.e, f: m.f },
      marcadores: usados.length, cantos: achados, invertida,
      inclinacao: Math.round(inclinacao * 100) / 100,   /* giro aplicado para endireitar (graus, + = horário) */
      escala: Math.round(Math.hypot(m.p, m.q) * 1000) / 1000, ra,
      avisos
    };
  }

  /* Matriz final com o ajuste fino da tela (graus) e o botão "Girar 180°". */
  function matrizFinal(r, op = {}) {
    const graus = (op.ajuste || 0) + (op.girar ? 180 : 0);
    return graus ? girarEmTorno(r.matriz, graus, r.centro[0], r.centro[1]) : r.matriz;
  }

  /* Desenha a página alinhada em `destino` (canvas), a partir da imagem original `origem`. */
  function desenhar(destino, origem, r, op = {}) {
    destino.width = r.largura; destino.height = r.altura;
    const ctx = destino.getContext('2d'), m = matrizFinal(r, op);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.largura, r.altura);
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(m.p, m.q, -m.q, m.p, m.e, m.f);
    ctx.drawImage(origem, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (op.guia) {
      const c = MODELO.cantos, W = r.largura, H = r.largura * MODELO.proporcao;
      ctx.strokeStyle = 'rgba(0,140,200,.75)'; ctx.lineWidth = Math.max(1, W / 800); ctx.setLineDash([W / 120, W / 160]);
      ctx.strokeRect(c.se[0] * W, c.se[1] * H, (c.sd[0] - c.se[0]) * W, (c.ie[1] - c.se[1]) * H);
      ctx.setLineDash([]);
    }
    return destino;
  }

  /* ---------- PDF (pdf.js 4.10.38, conferido pela assinatura antes de usar) ---------- */
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
  const ASSINATURA = {
    'pdf.min.mjs': '+0ti2moQlmLN7WZHE2RHIf5lV8hHxhxEalN0il3YZceG26fUPyOkR0hp9daxk1i7',
    'pdf.worker.min.mjs': 'ToeVvShCxKc6CEvhHeMt0Q8A06pSPDbAlngO9nokrDmh914gk/pYd0N7D0a4Lz2o'
  };
  async function baixarConferido(nome) {
    let r;
    try { r = await fetch(PDFJS + nome); } catch { throw Error('Não foi possível carregar o leitor de PDF. Confira a internet e tente de novo.'); }
    if (!r.ok) throw Error('Não foi possível carregar o leitor de PDF. Tente de novo.');
    const buf = await r.arrayBuffer(), dig = new Uint8Array(await crypto.subtle.digest('SHA-384', buf));
    if (btoa(String.fromCharCode(...dig)) !== ASSINATURA[nome]) throw Error('O leitor de PDF baixado não confere com o esperado. Avise o ADM.');
    return URL.createObjectURL(new Blob([buf], { type: 'text/javascript' }));
  }
  let pdfjs = null;
  function carregarPdfjs() {
    return pdfjs || (pdfjs = (async () => {
      const [lib, worker] = await Promise.all([baixarConferido('pdf.min.mjs'), baixarConferido('pdf.worker.min.mjs')]);
      const mod = await import(lib);
      mod.GlobalWorkerOptions.workerSrc = worker;
      return mod;
    })().catch(e => { pdfjs = null; throw e; }));
  }
  async function abrirPdf(dados) {
    const lib = await carregarPdfjs();
    return lib.getDocument({ data: dados, isEvalSupported: false }).promise;
  }
  /* Desenha a página n (1, 2, …) num canvas novo, em `dpi` pontos por polegada. */
  async function desenharPagina(doc, n, dpi = 150) {
    const pg = await doc.getPage(n), vp = pg.getViewport({ scale: dpi / 72 });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    pg.cleanup();
    return c;
  }

  /* ---------- separar e juntar páginas (pdf-lib 1.17.1, conferido pela assinatura) ----------
     O envio automático separa o PDF da turma por destino e acrescenta folhas no fim de um lote já guardado.
     As páginas são copiadas como estão (sem comprimir de novo), então a imagem escaneada não muda. */
  const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
  const ASSINATURA_PDFLIB = 'weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI';
  let pdflib = null;
  function carregarPdfLib() {
    return pdflib || (pdflib = (async () => {
      let r;
      try { r = await fetch(PDFLIB); } catch { throw Error('Não foi possível carregar o montador de PDF. Confira a internet e tente de novo.'); }
      if (!r.ok) throw Error('Não foi possível carregar o montador de PDF. Tente de novo.');
      const buf = await r.arrayBuffer(), dig = new Uint8Array(await crypto.subtle.digest('SHA-384', buf));
      if (btoa(String.fromCharCode(...dig)) !== ASSINATURA_PDFLIB) throw Error('O montador de PDF baixado não confere com o esperado. Avise o ADM.');
      const url = URL.createObjectURL(new Blob([buf], { type: 'text/javascript' }));
      await new Promise((ok, falha) => { const sc = document.createElement('script'); sc.src = url; sc.onload = ok; sc.onerror = () => falha(Error('Não foi possível carregar o montador de PDF.')); document.head.append(sc); });
      if (!window.PDFLib) throw Error('Não foi possível carregar o montador de PDF.');
      return window.PDFLib;
    })().catch(e => { pdflib = null; throw e; }));
  }
  /* Novo PDF com as páginas `numeros` (1, 2, …) de `origem`; se `base` vier, as páginas entram depois das dela. */
  async function montarPdf(origem, numeros, base = null) {
    const { PDFDocument } = await carregarPdfLib();
    const fonte = await PDFDocument.load(origem, { ignoreEncryption: true });
    const novo = base ? await PDFDocument.load(base, { ignoreEncryption: true }) : await PDFDocument.create();
    const copias = await novo.copyPages(fonte, numeros.map(n => n - 1));
    for (const p of copias) novo.addPage(p);
    return { bytes: await novo.save(), paginas: novo.getPageCount() };
  }

  /* Cores do marca-texto da correção (chave guardada em cada destaque; sem chave = amarelo). Usadas também no espelho do aluno. */
  const CORES_MARCA = Object.freeze({ am: '#ffe066', vd: '#9be37f', az: '#8fd0ff', rs: '#ffa6c9' });
  /* Uma cor por competência (C1 a C5), como no sistema do Inep: usada na correção e no espelho do aluno. */
  const CORES_COMP = Object.freeze(['#f5c518', '#5cc27a', '#5aaee8', '#f29a4a', '#ec7fb6']);
  /* binarizar e componentes também servem ao cartão-resposta (atlas-cartao.js). */
  window.AtlasAlinhamento = { MODELO, C128, CORES_MARCA, CORES_COMP, analisar, decodificar, lerCodigoImagem, desenhar, matrizFinal, abrirPdf, desenharPagina, carregarPdfLib, montarPdf, binarizar, componentes };
})();
