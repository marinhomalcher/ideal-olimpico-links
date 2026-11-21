/* ATLAS · cartão-resposta: acha a grade das bolhas numa página digitalizada.
   O cartão da escola é um só: seis blocos de quinze questões, cinco alternativas (90 posições); a prova usa as
   primeiras. Nos quatro cantos há marcas ArUco. Em cima e embaixo de cada bloco há cinco retângulos deitados, e
   nas laterais da folha quinze retângulos em pé: os centroides deles, cruzados, são os centros das bolhas.
   Pela experiência com os cartões reais de 2026: o scanner come marcas, corta cantos e estica um bloco, então
   a grade sai de três fontes e fica a que encosta melhor nas marcas que a página realmente tem:
     1. as próprias marcas da página (quando vieram todas);
     2. um modelo calibrado na melhor página do lote, posto na folha pelos ArUco (homografia) e encaixado nas marcas;
     3. o mesmo modelo encostado pelo retângulo das marcas, quando faltam ArUco.
   Usado pela tela do ADM na hora do envio; o portal só recebe a grade pronta e desenha. Depende de
   AtlasAlinhamento (binarizar, componentes). */
(function () {
  'use strict';
  const LAYOUT_PADRAO = Object.freeze({ blocos: 6, linhas: 15, alternativas: 5 });
  const LIMITE_MARCAS = 64;
  const LETRAS = 'ABCDE';
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

  /* ---------- marcas ---------- */
  function mesmoTamanho(cand) {
    if (cand.length < 10) return [];
    const mw = med(cand.map(c => c.w)), mh = med(cand.map(c => c.h));
    return cand.filter(c => Math.abs(c.w - mw) <= Math.max(2, mw * 0.4) && Math.abs(c.h - mh) <= Math.max(2, mh * 0.4));
  }
  /* Retângulos de registro: manchas cheias e alongadas, todas do mesmo tamanho. Deitadas dão a coluna da
     alternativa; em pé dão a linha da questão. */
  function marcasDeRegistro(comps, W) {
    const solidas = comps.filter(c => c.area >= 20 && c.w >= 4 && c.h >= 4 && c.w <= W * 0.05 && c.h <= W * 0.05 && c.area / (c.w * c.h) >= 0.80);
    const alonga = (a, b) => a / b >= 1.3 && a / b <= 4.5;
    return { deitadas: mesmoTamanho(solidas.filter(c => alonga(c.w, c.h))), empe: mesmoTamanho(solidas.filter(c => alonga(c.h, c.w))) };
  }
  function agrupar(itens, valor, tol) {
    const ord = [...itens].sort((a, b) => valor(a) - valor(b)), gs = [];
    for (const it of ord) { const g = gs[gs.length - 1]; if (g && valor(it) - valor(g[g.length - 1]) <= tol) g.push(it); else gs.push([it]); }
    return gs;
  }
  /* Marcas igualmente espaçadas: as que o scan comeu voltam pelo passo das vizinhas (índice pelo passo
     mediano; cada eixo vira uma reta ajustada aos índices). */
  function regularizar(ps, eixo) {
    const ord = [...ps].sort((a, b) => a[eixo] - b[eixo]);
    if (ord.length < 3) return ord.map(p => ({ x: p.cx, y: p.cy }));
    const d = []; for (let i = 1; i < ord.length; i++) d.push(ord[i][eixo] - ord[i - 1][eixo]);
    const ordD = [...d].sort((a, b) => a - b), passo = med(ordD.slice(0, Math.max(1, Math.ceil(d.length * 0.6)))) || 1;
    if (passo < 2) return [];
    const idx = [0];
    for (let i = 1; i < ord.length; i++) idx.push(idx[i - 1] + Math.min(LIMITE_MARCAS, Math.max(1, Math.round(d[i - 1] / passo))));
    if (idx[idx.length - 1] + 1 > LIMITE_MARCAS) return [];
    const reta = sel => {
      const n = ord.length, mi = idx.reduce((s, x) => s + x, 0) / n, mv = ord.reduce((s, p) => s + sel(p), 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { num += (idx[i] - mi) * (sel(ord[i]) - mv); den += (idx[i] - mi) ** 2; }
      const b = den ? num / den : 0; return { a: mv - b * mi, b };
    };
    const rx = reta(p => p.cx), ry = reta(p => p.cy), total = idx[idx.length - 1] + 1;
    return Array.from({ length: total }, (_, k) => ({ x: rx.a + rx.b * k, y: ry.a + ry.b * k }));
  }
  /* Uma fileira de cima ou de baixo: grupos de marcas com um vão maior entre os blocos. */
  function fileiraEmBlocos(ps) {
    const ord = [...ps].sort((a, b) => a.cx - b.cx);
    if (ord.length < 3) return [];
    const d = []; for (let i = 1; i < ord.length; i++) d.push(ord[i].cx - ord[i - 1].cx);
    const passo = med(d.slice().sort((a, b) => a - b).slice(0, Math.ceil(d.length * 0.7))) || med(d);
    if (!passo) return [];
    const blocos = [[ord[0]]];
    for (let i = 1; i < ord.length; i++) { if (ord[i].cx - ord[i - 1].cx > passo * 1.7) blocos.push([]); blocos[blocos.length - 1].push(ord[i]); }
    const regs = blocos.map(b => regularizar(b, 'cx'));
    if (regs.some(r => !r.length)) return [];
    const k = med(regs.map(r => r.length));
    if (!k || k > 12) return [];
    const vaos = []; for (let i = 1; i < regs.length; i++) vaos.push(regs[i][0].x - regs[i - 1][regs[i - 1].length - 1].x);
    const vao = med(vaos);
    /* bloco a que falta uma marca na ponta: o lado certo é o que deixa os vãos entre blocos iguais */
    return regs.map((r, i) => {
      while (r.length < k) {
        const p = r.length > 1 ? r[1].x - r[0].x : passo;
        const faltaAtras = i > 0 && Math.abs(r[0].x - regs[i - 1][regs[i - 1].length - 1].x - vao) > p * 0.5;
        if (faltaAtras) r.unshift({ x: r[0].x - p, y: r[0].y }); else r.push({ x: r[r.length - 1].x + p, y: r[r.length - 1].y });
      }
      return r;
    });
  }

  /* ---------- a grade ---------- */
  function centroDe(g, col, li) {
    const c = g.t[col], f = g.b[col], e = g.esq[li], d = g.dir[li];
    if (!c || !f || !e || !d) return null;
    const fy = (e.y + d.y) / 2, k = (fy - c.y) / ((f.y - c.y) || 1);
    const x = c.x + (f.x - c.x) * k;
    const fx = (c.x + f.x) / 2, j = (fx - e.x) / ((d.x - e.x) || 1);
    const y = e.y + (d.y - e.y) * (isFinite(j) ? j : 0.5);
    return { x, y };
  }
  /* Questão k (0, 1, 2…) → bloco e linha; as questões descem o bloco e passam ao bloco seguinte. */
  function posicaoDe(g, k) {
    const bloco = Math.floor(k / g.linhas), lin = k % g.linhas;
    return g.blocos[bloco] ? { col: g.blocos[bloco][0], lin } : null;
  }
  function montarGrade(marcas, W, H, layout) {
    const fileiras = agrupar(marcas.deitadas, m => m.cy, H * 0.02).filter(g => g.length >= 5);
    const colunas = agrupar(marcas.empe, m => m.cx, W * 0.02).filter(g => g.length >= 8);
    if (!fileiras.length || !colunas.length) return null;
    const cima = fileiraEmBlocos(fileiras[0]);
    const baixo = fileiras.length > 1 ? fileiraEmBlocos(fileiras[fileiras.length - 1]) : cima;
    if (!cima.length || !baixo.length || cima.length !== baixo.length) return null;
    const t = cima.flat(), b = baixo.flat();
    if (t.length !== b.length) return null;
    const blocos = []; let n = 0;
    for (const g of cima) { blocos.push(g.map((_, i) => n + i)); n += g.length; }
    const lados = [...colunas].sort((a, b) => b.length - a.length).slice(0, 2).sort((a, b) => a[0].cx - b[0].cx);
    let esq = regularizar(lados[0], 'cy'), dir = regularizar(lados[1] || lados[0], 'cy');
    /* um lado perdeu marcas: o completo vale pelos dois (o par cima/baixo já cobre a inclinação em x) */
    if (esq.length !== dir.length) { if (esq.length > dir.length) dir = esq; else esq = dir; }
    /* faltando uma linha na ponta, ela volta do lado que deixa as folgas até as fileiras parecidas */
    const alvo = layout.linhas, meio = a => a.reduce((s, p) => s + p.y, 0) / a.length;
    if (alvo && esq.length >= 3 && esq.length < alvo) {
      const cimaY = meio(t), baixoY = meio(b);
      const estica = seq => {
        const passo = seq[1].y - seq[0].y;
        while (seq.length < alvo) {
          const dx = seq[1].x - seq[0].x;
          if (seq[0].y - cimaY > baixoY - seq[seq.length - 1].y) seq.unshift({ x: seq[0].x - dx, y: seq[0].y - passo });
          else { const u = seq[seq.length - 1]; seq.push({ x: u.x + dx, y: u.y + passo }); }
        }
        return seq;
      };
      esq = estica([...esq]); dir = estica([...dir]);
    }
    if (!esq.length) return null;
    const intacta = fileiras[0].length === t.length && fileiras[fileiras.length - 1].length === b.length
      && lados[0].length === esq.length && (!lados[1] || lados[1].length === dir.length);
    return { t, b, esq, dir, blocos, linhas: esq.length, intacta };
  }
  function completa(g, layout, questoes) {
    if (!g) return false;
    if (g.blocos.length !== layout.blocos || g.linhas !== layout.linhas || g.blocos[0].length !== layout.alternativas) return false;
    return g.blocos.length * g.linhas >= (questoes || 0) && g.blocos.every(b => b.length === g.blocos[0].length);
  }

  /* ---------- âncoras: os quatro ArUco ---------- */
  function cantosAruco(comps, W, H) {
    const quase = comps.filter(c => c.w >= W * 0.018 && c.h >= W * 0.018 && c.w <= W * 0.07 && c.h <= W * 0.07
      && Math.abs(c.w - c.h) <= Math.max(c.w, c.h) * 0.3 && c.area / (c.w * c.h) >= 0.45
      && (c.cx < W * 0.18 || c.cx > W * 0.82) && (c.cy < H * 0.15 || c.cy > H * 0.85));
    if (quase.length < 3) return null;
    const m = med(quase.map(c => c.w));
    const bons = quase.filter(c => Math.abs(c.w - m) <= m * 0.3 && Math.abs(c.h - m) <= m * 0.3);
    const quad = (dx, dy) => {
      const lista = bons.filter(c => (dx < 0 ? c.cx < W / 2 : c.cx > W / 2) && (dy < 0 ? c.cy < H / 2 : c.cy > H / 2));
      if (!lista.length) return null;
      const alvo = [dx < 0 ? 0 : W, dy < 0 ? 0 : H];
      return lista.sort((a, b) => Math.hypot(a.cx - alvo[0], a.cy - alvo[1]) - Math.hypot(b.cx - alvo[0], b.cy - alvo[1]))[0];
    };
    const q = [quad(-1, -1), quad(1, -1), quad(1, 1), quad(-1, 1)].map(c => c ? { x: c.cx, y: c.cy } : null);
    const faltam = q.map((c, i) => c ? -1 : i).filter(i => i >= 0);
    /* um canto rasgado ou cortado no scan não invalida a folha: os outros três o reconstroem */
    if (faltam.length === 1) { const i = faltam[0], a = q[(i + 1) % 4], b = q[(i + 2) % 4], c = q[(i + 3) % 4]; q[i] = { x: a.x + c.x - b.x, y: a.y + c.y - b.y }; }
    return q.every(Boolean) ? q : null;
  }
  function resolver(A, v) {
    const n = v.length;
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [v[c], v[p]] = [v[p], v[c]];
      if (!A[c][c]) return null;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        v[r] -= f * v[c];
      }
    }
    return v.map((x, i) => x / A[i][i]);
  }
  /* Homografia entre o quadrado unitário e os quatro ArUco (ida: unitário → página; volta: página → unitário). */
  function homografia(d, volta) {
    const s = [[0, 0], [1, 0], [1, 1], [0, 1]], A = [], v = [];
    for (let i = 0; i < 4; i++) {
      const [u, w] = volta ? [d[i].x, d[i].y] : s[i], [x, y] = volta ? s[i] : [d[i].x, d[i].y];
      A.push([u, w, 1, 0, 0, 0, -u * x, -w * x]); v.push(x);
      A.push([0, 0, 0, u, w, 1, -u * y, -w * y]); v.push(y);
    }
    const h = resolver(A, v);
    if (!h) return null;
    return (u, w) => { const z = h[6] * u + h[7] * w + 1; return { x: (h[0] * u + h[1] * w + h[2]) / z, y: (h[3] * u + h[4] * w + h[5]) / z }; };
  }

  /* ---------- modelo: a grade em coordenadas relativas aos ArUco ---------- */
  function calibrar(g, ancoras) {
    const inv = homografia(ancoras, true); if (!inv) return null;
    const uv = p => { const r = inv(p.x, p.y); return { u: r.x, v: r.y }; };
    return { t: g.t.map(uv), b: g.b.map(uv), esq: g.esq.map(uv), dir: g.dir.map(uv), blocos: g.blocos, linhas: g.linhas };
  }
  function gradeDoModelo(modelo, ancoras) {
    const H = homografia(ancoras, false); if (!H) return null;
    const pt = p => H(p.u, p.v);
    return { t: modelo.t.map(pt), b: modelo.b.map(pt), esq: modelo.esq.map(pt), dir: modelo.dir.map(pt), blocos: modelo.blocos, linhas: modelo.linhas };
  }
  /* Sem os ArUco: encosta o retângulo das marcas do modelo no das marcas da página e deixa o encaixe fino terminar. */
  function encaixarModelo(modelo, marcas) {
    const todas = [...marcas.deitadas, ...marcas.empe];
    if (todas.length < 20) return null;
    const cx = todas.map(c => c.cx), cy = todas.map(c => c.cy);
    const alvo = { x0: Math.min(...cx), x1: Math.max(...cx), y0: Math.min(...cy), y1: Math.max(...cy) };
    const mod = [...modelo.t, ...modelo.b, ...modelo.esq, ...modelo.dir];
    const mu = mod.map(p => p.u), mv = mod.map(p => p.v);
    const de = { x0: Math.min(...mu), x1: Math.max(...mu), y0: Math.min(...mv), y1: Math.max(...mv) };
    const ex = (alvo.x1 - alvo.x0) / ((de.x1 - de.x0) || 1), ey = (alvo.y1 - alvo.y0) / ((de.y1 - de.y0) || 1);
    const leva = p => ({ x: alvo.x0 + (p.u - de.x0) * ex, y: alvo.y0 + (p.v - de.y0) * ey });
    return { t: modelo.t.map(leva), b: modelo.b.map(leva), esq: modelo.esq.map(leva), dir: modelo.dir.map(leva), blocos: modelo.blocos, linhas: modelo.linhas };
  }
  function afimPorPares(pares) {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], vx = [0, 0, 0], vy = [0, 0, 0];
    for (const [p, q] of pares) {
      const l = [p.x, p.y, 1];
      for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[i][j] += l[i] * l[j]; vx[i] += l[i] * q.cx; vy[i] += l[i] * q.cy; }
    }
    const a = resolver(M.map(r => [...r]), [...vx]), b = resolver(M.map(r => [...r]), [...vy]);
    return a && b ? (p => ({ x: a[0] * p.x + a[1] * p.y + a[2], y: b[0] * p.x + b[1] * p.y + b[2] })) : null;
  }
  const maisProxima = (p, cands, tol) => {
    let melhor = null, dist = tol;
    for (const c of cands) { const d = Math.hypot(c.cx - p.x, c.cy - p.y); if (d < dist) { dist = d; melhor = c; } }
    return melhor;
  };
  /* Encaixe fino: o modelo posto pelos ArUco é puxado para as marcas que a página tem (afim por mínimos
     quadrados, em rodadas cada vez mais exigentes) e, no fim, onde há marca de verdade ela manda. */
  function refinar(g, marcas) {
    const passoV = Math.abs(g.esq[1] ? g.esq[1].y - g.esq[0].y : 20), passoH = Math.abs(g.t[1] ? g.t[1].x - g.t[0].x : 20);
    for (const fator of [1.6, 0.8, 0.45]) {
      const tol = passoV * fator, pares = [];
      const juntar = (pontos, cands) => { for (const p of pontos) { const m = maisProxima(p, cands, tol); if (m) pares.push([p, m]); } };
      juntar([...g.t, ...g.b], marcas.deitadas); juntar([...g.esq, ...g.dir], marcas.empe);
      if (pares.length < 20) break;
      const f = afimPorPares(pares); if (!f) break;
      g = { ...g, t: g.t.map(f), b: g.b.map(f), esq: g.esq.map(f), dir: g.dir.map(f) };
    }
    const encostar = (pontos, cands, tol) => pontos.map(p => { const m = maisProxima(p, cands, tol); return m ? { x: m.cx, y: m.cy } : p; });
    return { ...g, t: encostar(g.t, marcas.deitadas, passoH * 0.45), b: encostar(g.b, marcas.deitadas, passoH * 0.45), esq: encostar(g.esq, marcas.empe, passoV * 0.45), dir: encostar(g.dir, marcas.empe, passoV * 0.45) };
  }
  /* Quanto a grade se afasta das marcas que a página realmente tem (menor é melhor). */
  function desencontro(g, marcas) {
    let soma = 0, n = 0;
    const conta = (pontos, cands) => { for (const p of pontos) { let d = 1e9; for (const c of cands) { const t = Math.hypot(c.cx - p.x, c.cy - p.y); if (t < d) d = t; } soma += Math.min(d, 50); n++; } };
    conta([...g.t, ...g.b], marcas.deitadas); conta([...g.esq, ...g.dir], marcas.empe);
    return n ? soma / n : 1e9;
  }

  /* ---------- a página ---------- */
  /* Mede uma página (canvas já desenhado): devolve o que dá para extrair dela, sem decidir a grade ainda. */
  function medir(canvas, layout = LAYOUT_PADRAO, questoes = 0) {
    const A = window.AtlasAlinhamento;
    const W = canvas.width, H = canvas.height;
    const bin = A.binarizar(canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H));
    const comps = A.componentes(bin, W, H).map(s => ({ ...s, cx: s.sx / s.area, cy: s.sy / s.area, w: s.x1 - s.x0 + 1, h: s.y1 - s.y0 + 1 }));
    const marcas = marcasDeRegistro(comps, W);
    const porMarcas = montarGrade(marcas, W, H, layout);
    const m = { W, H, layout, questoes, ancoras: cantosAruco(comps, W, H), porMarcas, bin,
      marcas: { deitadas: marcas.deitadas.map(c => ({ cx: c.cx, cy: c.cy })), empe: marcas.empe.map(c => ({ cx: c.cx, cy: c.cy })) } };
    m.completa = completa(porMarcas, layout, questoes);
    m.intacta = !!(porMarcas && porMarcas.intacta);
    return m;
  }
  /* O molde do lote sai da melhor página medida: completa, de preferência sem remendo, com mais marcas. */
  function melhorModelo(medicoes) {
    let melhor = null, pontos = -1;
    for (const m of medicoes) {
      if (!m || !m.ancoras || !m.completa) continue;
      const p = (m.intacta ? 1e6 : 0) + m.marcas.deitadas.length + m.marcas.empe.length;
      if (p > pontos) { pontos = p; melhor = m; }
    }
    return melhor ? calibrar(melhor.porMarcas, melhor.ancoras) : null;
  }
  /* Decide a grade de uma página medida, com ou sem modelo. */
  function escolherGrade(m, modelo) {
    if (!m) return null;
    const opcoes = [];
    /* a grade remendada só ganha do modelo se encostar nitidamente melhor nas marcas da página */
    if (m.completa) opcoes.push({ g: m.porMarcas, peso: m.intacta ? 0 : 3 });
    const doModelo = modelo ? (m.ancoras ? gradeDoModelo(modelo, m.ancoras) : encaixarModelo(modelo, m.marcas)) : null;
    if (doModelo) opcoes.push({ g: refinar(doModelo, m.marcas), peso: 0 });
    if (!opcoes.length) return null;
    for (const o of opcoes) o.nota = desencontro(o.g, m.marcas) + o.peso;
    opcoes.sort((a, b) => a.nota - b.nota);
    const g = opcoes[0].g;
    return completa(g, m.layout, m.questoes) ? g : null;
  }
  /* Forma guardada no banco e mandada ao portal: só números, com uma casa decimal. */
  function serializar(g, W, H) {
    if (!g) return null;
    const r = v => Math.round(v * 10) / 10, pts = a => a.map(p => [r(p.x), r(p.y)]);
    return { w: W, h: H, t: pts(g.t), b: pts(g.b), esq: pts(g.esq), dir: pts(g.dir), blocos: g.blocos, linhas: g.linhas };
  }
  function desserializar(s) {
    if (!s || !Array.isArray(s.t)) return null;
    const pts = a => a.map(p => ({ x: p[0], y: p[1] }));
    return { t: pts(s.t), b: pts(s.b), esq: pts(s.esq), dir: pts(s.dir), blocos: s.blocos, linhas: s.linhas };
  }

  /* ---------- leitura das bolhas (conferência; o oficial vem da planilha de correção) ---------- */
  function preenchimento(bin, W, H, cx, cy, raio) {
    let dentro = 0, pintados = 0;
    const r = Math.round(raio), x0 = Math.round(cx), y0 = Math.round(cy);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      dentro++; if (bin[y * W + x]) pintados++;
    }
    return dentro ? pintados / dentro : 0;
  }
  /* Lê o que o aluno marcou: uma letra por questão, "_" em branco, "*" dupla marcação. Só o miolo da bolha
     conta (o anel impresso inflaria a bolha vazia) e o corte sai do próprio cartão (caneta fraca, scan claro). */
  function lerRespostas(m, g, questoes) {
    const p0 = centroDe(g, 0, 0), p1 = centroDe(g, 1, 0);
    if (!p0 || !p1) return '';
    const raio = Math.max(3, Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.22), linhas = [];
    for (let q = 0; q < questoes; q++) {
      const pos = posicaoDe(g, q);
      if (!pos) { linhas.push(null); continue; }
      const vals = [];
      for (let a = 0; a < g.blocos[0].length; a++) { const p = centroDe(g, pos.col + a, pos.lin); vals.push(p ? preenchimento(m.bin, m.W, m.H, p.x, p.y, raio) : 0); }
      linhas.push(vals);
    }
    const maximos = linhas.filter(Boolean).map(v => Math.max(...v)).sort((a, b) => a - b);
    const tipico = maximos.length ? maximos[Math.floor(maximos.length * 0.6)] : 0.5;
    const corte = Math.max(0.12, tipico * 0.45);
    let out = '';
    for (const vals of linhas) {
      if (!vals) { out += '_'; continue; }
      const max = Math.max(...vals), i = vals.indexOf(max), segundo = Math.max(...vals.filter((_, k) => k !== i));
      const marcada = max >= corte || (max >= 0.1 && segundo <= max * 0.25);
      out += !marcada ? '_' : (segundo > Math.max(corte, max * 0.72) ? '*' : LETRAS[i]);
    }
    return out;
  }

  window.AtlasCartao = { LAYOUT_PADRAO, medir, melhorModelo, escolherGrade, serializar, desserializar, centroDe, posicaoDe, lerRespostas };
})();
