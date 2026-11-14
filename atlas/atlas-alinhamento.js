/* ATLAS · Redação · alinhamento das folhas escaneadas.
   Acha os 4 marcadores em "L" da FOLHA DE REDAÇÃO, endireita e centraliza a página
   (giro + deslocamento + escala, sem deformar a letra) e percebe folha de cabeça para baixo.
   Tudo roda no navegador; nada é enviado ao servidor. */
(function () {
  'use strict';

  /* Medidas da folha (A4), em fração da página: canto externo de cada marcador em "L".
     se = superior esquerdo, sd = superior direito, ie = inferior esquerdo, id = inferior direito. */
  const MODELO = {
    proporcao: 841.92 / 595.32,
    cantos: { se: [0.0707, 0.1826], sd: [0.9329, 0.1826], ie: [0.0707, 0.9401], id: [0.9329, 0.9401] },
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
    return b;
  }

  /* Abertura 3×3 (erosão + dilatação): apaga traços finos, como a linha vermelha da assinatura,
     que no scan em cinza escurece e encosta no "L"; os braços grossos do marcador continuam. */
  function abrir(b, w, h) {
    const passo = (ent, minimo) => {
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
    };
    return passo(passo(b, true), false);
  }

  /* Componentes conectados (4 vizinhos), com caixa, área, centro e os 4 pontos extremos. */
  function componentes(b, w, h) {
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
    return [...st.values()];
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
    const achados = {};
    for (const t of TIPOS) {
      const o = MODELO.cantos[OPOSTO[t]];
      const esperados = [[MODELO.cantos[t][0] * w, MODELO.cantos[t][1] * h], [(1 - o[0]) * w, (1 - o[1]) * h]];
      let melhor = null, dist = 0.15 * w;
      for (const c of cands) if (c.tipo === t) for (const esp of esperados) {
        const d = Math.hypot(c.ponto[0] - esp[0], c.ponto[1] - esp[1]);
        if (d < dist) { dist = d; melhor = c; }
      }
      if (melhor) achados[t] = melhor.ponto;
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
    const giro = Math.atan2(m.q, m.p) * 180 / Math.PI;
    const inclinacao = invertida ? ((giro + 360) % 360) - 180 : giro;
    return {
      largura: W, altura: H, centro, matriz: { p: m.p, q: m.q, e: m.e, f: m.f },
      marcadores: usados.length, cantos: achados, invertida,
      inclinacao: Math.round(inclinacao * 100) / 100,   /* giro aplicado para endireitar (graus, + = horário) */
      escala: Math.round(Math.hypot(m.p, m.q) * 1000) / 1000,
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

  window.AtlasAlinhamento = { MODELO, analisar, desenhar, matrizFinal, abrirPdf, desenharPagina };
})();
