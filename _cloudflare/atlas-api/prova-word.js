// Caderno da prova em Word (.docx) para o Diagramador (decisões do Marinho em 23 e 24/11/2026).
// Gera o arquivo inteiro aqui, sem biblioteca: um .docx é um ZIP com XML dentro. Cada disciplina começa em
// página nova com o cabeçalho "GRUPO EDUCACIONAL IDEAL - 50 ANOS" / "MATEMÁTICA/3ª SÉRIE - MED/SIMULADO ENEM" /
// "Aplicação: dd/mm/aaaa · questões NN a NN". Letras das alternativas sem negrito; cada questão fica inteira na
// página (keepNext); as fórmulas viram equações editáveis do Word (MathML do KaTeX -> OMML); imagens vêm do R2.

export const ORDEM_DISCIPLINAS = Object.freeze(['Inglês', 'Português', 'Literatura', 'Artes', 'Filosofia', 'Sociologia', 'História', 'Geografia', 'Biologia', 'Física', 'Química', 'Matemática']);
export const NOME_MODALIDADE = Object.freeze({ PART: 'Simulado particular', ENEM1: 'Simulado ENEM · 1º dia', ENEM2: 'Simulado ENEM · 2º dia' });
const NOME_MODALIDADE_CAB = Object.freeze({ PART: 'SIMULADO PARTICULAR', ENEM1: 'SIMULADO ENEM', ENEM2: 'SIMULADO ENEM' });
export const INICIO_NUMERACAO = Object.freeze({ PART: 1, ENEM1: 1, ENEM2: 91 });
const VINHO = '98151D', CINZA = '8B7B7F';
const LARGURA_TEXTO_TWIPS = 9638;   // A4 com margens de 2 cm
const EMU_POR_TWIP = 635;

const xml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nn = n => String(n).padStart(2, '0');
export const dataBR = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '';

// ---------- entidades e analisador de HTML/XML (só o que o editor do ATLAS produz) ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function desentidar(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return e in ENT ? ENT[e] : m;
  });
}
const VAZIAS = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'mspace', 'mprescripts', 'none', 'mglyph', 'malignmark']);
// Árvore simples: { tag, attrs, children } e textos como strings. Tolera tags sem fechamento.
export function analisar(html) {
  const raiz = { tag: '#raiz', attrs: {}, children: [] };
  const pilha = [raiz];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {   // fechamento
      const t = m[1].toLowerCase();
      for (let i = pilha.length - 1; i > 0; i--) if (pilha[i].tag === t) { pilha.length = i; break; }
      continue;
    }
    if (m[2]) {
      const tag = m[2].toLowerCase(), attrs = {};
      for (const a of (m[3] || '').matchAll(/([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[a[1].toLowerCase()] = desentidar(a[3] ?? a[4] ?? a[5] ?? '');
      const no = { tag, attrs, children: [] };
      pilha[pilha.length - 1].children.push(no);
      if (!m[4] && !VAZIAS.has(tag)) pilha.push(no);
      continue;
    }
    if (m[5]) pilha[pilha.length - 1].children.push(desentidar(m[5]));
  }
  return raiz;
}
const textoDe = no => typeof no === 'string' ? no : no.children.map(textoDe).join('');
const classes = no => String(no.attrs && no.attrs.class || '').split(/\s+/).filter(Boolean);

// ---------- MathML (saída do KaTeX) -> OMML (equação editável do Word) ----------
function mr(texto, opc = {}) {
  if (texto === '') return '';
  return '<m:r>' + (opc.normal ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : '') + '<m:t xml:space="preserve">' + xml(texto) + '</m:t></m:r>';
}
const filhosElem = no => no.children.filter(c => typeof c !== 'string' || c.trim());
function omml(no) {
  if (typeof no === 'string') return no.trim() ? mr(no.trim()) : '';
  const f = filhosElem(no), t = no.tag, a = no.attrs || {};
  const seq = lista => lista.map(omml).join('');
  switch (t) {
    case 'math': case 'semantics': case 'mstyle': case 'mpadded': case 'menclose': case 'merror': return seq(f);
    case 'annotation': case 'annotation-xml': case 'mphantom': return '';
    case 'mrow': {
      // (…) [...] {…} |…| : primeiro e último filhos são fence -> m:d
      if (f.length >= 2 && typeof f[0] !== 'string' && typeof f[f.length - 1] !== 'string' && f[0].tag === 'mo' && f[f.length - 1].tag === 'mo' && f[0].attrs.fence === 'true' && f[f.length - 1].attrs.fence === 'true') {
        const b = textoDe(f[0]).trim(), e = textoDe(f[f.length - 1]).trim();
        return '<m:d><m:dPr>' + (b !== '(' ? '<m:begChr m:val="' + xml(b) + '"/>' : '') + (e !== ')' ? '<m:endChr m:val="' + xml(e) + '"/>' : '') + '</m:dPr><m:e>' + seq(f.slice(1, -1)) + '</m:e></m:d>';
      }
      return seq(f);
    }
    case 'mi': case 'mn': case 'mo': case 'mtext': case 'ms': {
      const s = textoDe(no).replace(/⁢|⁡|⁣/g, '');   // invisible times / apply function
      return t === 'mtext' ? mr(s, { normal: true }) : mr(s.trim() === '' ? '' : s);
    }
    case 'mspace': return mr(' ');
    case 'mfrac': return '<m:f>' + (a.linethickness === '0' || a.linethickness === '0px' ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : '') + '<m:num>' + omml(f[0] || '') + '</m:num><m:den>' + omml(f[1] || '') + '</m:den></m:f>';
    case 'msup': return '<m:sSup><m:e>' + omml(f[0] || '') + '</m:e><m:sup>' + omml(f[1] || '') + '</m:sup></m:sSup>';
    case 'msub': return '<m:sSub><m:e>' + omml(f[0] || '') + '</m:e><m:sub>' + omml(f[1] || '') + '</m:sub></m:sSub>';
    case 'msubsup': return '<m:sSubSup><m:e>' + omml(f[0] || '') + '</m:e><m:sub>' + omml(f[1] || '') + '</m:sub><m:sup>' + omml(f[2] || '') + '</m:sup></m:sSubSup>';
    case 'msqrt': return '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>' + seq(f) + '</m:e></m:rad>';
    case 'mroot': return '<m:rad><m:deg>' + omml(f[1] || '') + '</m:deg><m:e>' + omml(f[0] || '') + '</m:e></m:rad>';
    case 'mover': {
      if (a.accent === 'true' && f[1]) return '<m:acc><m:accPr><m:chr m:val="' + xml(textoDe(f[1]).trim()) + '"/></m:accPr><m:e>' + omml(f[0] || '') + '</m:e></m:acc>';
      return '<m:limUpp><m:e>' + omml(f[0] || '') + '</m:e><m:lim>' + omml(f[1] || '') + '</m:lim></m:limUpp>';
    }
    case 'munder': return '<m:limLow><m:e>' + omml(f[0] || '') + '</m:e><m:lim>' + omml(f[1] || '') + '</m:lim></m:limLow>';
    case 'munderover': {
      const base = textoDe(f[0] || '').trim();
      if (/^[∑∏∫∬∭∮⋃⋂]$/.test(base)) return '<m:nary><m:naryPr><m:chr m:val="' + xml(base) + '"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>' + omml(f[1] || '') + '</m:sub><m:sup>' + omml(f[2] || '') + '</m:sup><m:e/></m:nary>';
      return '<m:limUpp><m:e><m:limLow><m:e>' + omml(f[0] || '') + '</m:e><m:lim>' + omml(f[1] || '') + '</m:lim></m:limLow></m:e><m:lim>' + omml(f[2] || '') + '</m:lim></m:limUpp>';
    }
    case 'mtable': {
      const linhas = f.filter(x => x.tag === 'mtr' || x.tag === 'mlabeledtr');
      // "fração" montada como tabela de 2 linhas com traço (array + \hline): vira fração de verdade
      if (linhas.length === 2 && /solid/.test(a.rowlines || '') && linhas.every(l => filhosElem(l).length === 1)) {
        return '<m:f><m:num>' + seq(filhosElem(linhas[0])) + '</m:num><m:den>' + seq(filhosElem(linhas[1])) + '</m:den></m:f>';
      }
      const ncol = Math.max(1, ...linhas.map(l => filhosElem(l).length));
      return '<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="' + ncol + '"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>' +
        linhas.map(l => '<m:mr>' + filhosElem(l).map(c => '<m:e>' + seq(filhosElem(c)) + '</m:e>').join('') + '</m:mr>').join('') + '</m:m>';
    }
    case 'mtr': case 'mtd': return seq(f);
    case 'mfenced': return '<m:d><m:dPr><m:begChr m:val="' + xml(a.open ?? '(') + '"/><m:endChr m:val="' + xml(a.close ?? ')') + '"/></m:dPr>' + f.map(c => '<m:e>' + omml(c) + '</m:e>').join('') + '</m:d>';
    case 'mmultiscripts': return seq(f);
    default: return seq(f);
  }
}
// Equação do editor: <span class="atlas-equation" data-latex="…"><span class="katex"><span class="katex-mathml"><math>…</math>…
export function equacaoOmml(noSpan) {
  const achar = no => { if (typeof no === 'string') return null; if (no.tag === 'math') return no; for (const c of no.children) { const r = achar(c); if (r) return r; } return null; };
  const math = achar(noSpan);
  if (math) { const o = omml(math); if (o) return o; }
  const latex = noSpan.attrs && noSpan.attrs['data-latex'];
  return latex ? mr(latex, { normal: true }) : '';
}

// ---------- imagens: tamanho em pixels (JPEG, PNG, WebP) ----------
function tamanhoImagem(b) {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (u[0] === 0x89 && u[1] === 0x50 && u.length > 24) return { tipo: 'png', w: dv.getUint32(16), h: dv.getUint32(20) };
  if (u[0] === 0xff && u[1] === 0xd8) {
    let i = 2;
    while (i + 9 < u.length) {
      if (u[i] !== 0xff) { i++; continue; }
      const marca = u[i + 1];
      if (marca === 0xd8 || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) { i += 2; continue; }
      const len = dv.getUint16(i + 2);
      if ((marca >= 0xc0 && marca <= 0xc3) || (marca >= 0xc5 && marca <= 0xc7) || (marca >= 0xc9 && marca <= 0xcb) || (marca >= 0xcd && marca <= 0xcf)) return { tipo: 'jpeg', h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
      i += 2 + len;
    }
    return { tipo: 'jpeg', w: 600, h: 400 };
  }
  if (u.length > 30 && String.fromCharCode(...u.slice(0, 4)) === 'RIFF' && String.fromCharCode(...u.slice(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...u.slice(12, 16));
    if (chunk === 'VP8X') return { tipo: 'webp', w: 1 + (u[24] | (u[25] << 8) | (u[26] << 16)), h: 1 + (u[27] | (u[28] << 8) | (u[29] << 16)) };
    if (chunk === 'VP8L') { const b0 = u[21], b1 = u[22], b2 = u[23], b3 = u[24]; return { tipo: 'webp', w: 1 + (((b1 & 0x3f) << 8) | b0), h: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }; }
    if (chunk === 'VP8 ') return { tipo: 'webp', w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
  }
  return { tipo: 'png', w: 600, h: 400 };
}

// ---------- parágrafos do Word ----------
const PARA_ESPACO = '<w:spacing w:after="120" w:line="276" w:lineRule="auto"/>';
function run(texto, fmt = {}) {
  if (!texto) return '';
  const rpr = (fmt.bold ? '<w:b/>' : '') + (fmt.italic ? '<w:i/>' : '') + (fmt.underline ? '<w:u w:val="single"/>' : '') +
    (fmt.fonte ? '<w:rFonts w:ascii="' + fmt.fonte + '" w:hAnsi="' + fmt.fonte + '" w:cs="' + fmt.fonte + '"/>' : '') +
    (fmt.cor ? '<w:color w:val="' + fmt.cor + '"/>' : '') + (fmt.tam ? '<w:sz w:val="' + fmt.tam + '"/><w:szCs w:val="' + fmt.tam + '"/>' : '') +
    (fmt.sup ? '<w:vertAlign w:val="superscript"/>' : '') + (fmt.sub ? '<w:vertAlign w:val="subscript"/>' : '');
  // quebras de linha (\n) viram <w:br/>; tabulação vira <w:tab/>
  const partes = String(texto).split(/(\n|\t)/).map(p => p === '\n' ? '<w:br/>' : p === '\t' ? '<w:tab/>' : (p ? '<w:t xml:space="preserve">' + xml(p) + '</w:t>' : '')).join('');
  return '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + partes + '</w:r>';
}
function paragrafo(conteudo, p = {}) {
  const ppr = (p.keepNext ? '<w:keepNext/>' : '') + (p.keepLines ? '<w:keepLines/>' : '') + (p.pageBreakBefore ? '<w:pageBreakBefore/>' : '') +
    (p.borda ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="' + VINHO + '"/></w:pBdr>' : '') +
    (p.sombra ? '<w:shd w:val="clear" w:color="auto" w:fill="FBECEF"/>' : '') +
    (p.tabs ? '<w:tabs>' + p.tabs + '</w:tabs>' : '') +
    (p.spacing || PARA_ESPACO) +
    (p.ind ? p.ind : '') +
    (p.jc ? '<w:jc w:val="' + p.jc + '"/>' : '');
  return '<w:p>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + conteudo + '</w:p>';
}
const RECUO_ALT = '<w:ind w:left="425" w:hanging="425"/>';

// Converte o HTML de um campo (texto-base, comando, alternativa) em parágrafos do Word.
// ctx: { imagens: fn(idOuData) -> {rId, w, h} | null, prefixo: runs no começo do 1º parágrafo, recuo, keepNext, jc }
function htmlParaParagrafos(html, ctx) {
  const raiz = analisar(String(html || ''));
  const saida = [];
  let runsAtuais = [], primeiro = true, pAtual = {};
  const abrirP = (opc = {}) => { fecharP(); pAtual = opc; };
  const fecharP = () => {
    while (runsAtuais.length && runsAtuais[runsAtuais.length - 1] === '<w:r><w:br/></w:r>') runsAtuais.pop();
    const temConteudo = runsAtuais.some(r => r.length);
    if (temConteudo || (primeiro && ctx.prefixo)) {
      let conteudo = runsAtuais.join('');
      let opc = { keepNext: ctx.keepNext !== false, keepLines: true, jc: pAtual.jc || ctx.jc || 'both', ind: pAtual.ind || (ctx.recuo ? RECUO_ALT : '') };
      if (primeiro && ctx.prefixo) { conteudo = ctx.prefixo + conteudo; if (ctx.tabs) opc.tabs = ctx.tabs; }
      if (pAtual.equacaoBloco) opc.jc = 'center';
      saida.push(paragrafo(conteudo, opc));
      primeiro = false;
    }
    runsAtuais = []; pAtual = {};
  };
  const andar = (no, fmt, ambiente) => {
    if (typeof no === 'string') { runsAtuais.push(run(no.replace(/\r/g, ''), fmt)); return; }
    const t = no.tag, cls = classes(no);
    if (cls.includes('atlas-equation')) {
      const o = equacaoOmml(no);
      if (!o) return;
      if (no.attrs['data-display'] === 'block') { abrirP({ equacaoBloco: true }); runsAtuais.push('<m:oMathPara><m:oMath>' + o + '</m:oMath></m:oMathPara>'); fecharP(); }
      else runsAtuais.push('<m:oMath>' + o + '</m:oMath>');
      return;
    }
    if (cls.includes('katex-mathml') || cls.includes('katex-html') || t === 'annotation') return;
    switch (t) {
      case 'br': runsAtuais.push('<w:r><w:br/></w:r>'); return;
      case 'b': case 'strong': return no.children.forEach(c => andar(c, { ...fmt, bold: true }, ambiente));
      case 'i': case 'em': return no.children.forEach(c => andar(c, { ...fmt, italic: true }, ambiente));
      case 'u': return no.children.forEach(c => andar(c, { ...fmt, underline: true }, ambiente));
      case 'sup': return no.children.forEach(c => andar(c, { ...fmt, sup: true }, ambiente));
      case 'sub': return no.children.forEach(c => andar(c, { ...fmt, sub: true }, ambiente));
      case 'img': {
        const img = ctx.imagens(no.attrs.src || '', no.attrs.style || '');
        if (!img) return;
        abrirP({ jc: 'center' });
        runsAtuais.push(desenhoImagem(img));
        fecharP();
        return;
      }
      case 'table': {
        fecharP();
        const linhas = [];
        const coletar = n => { if (typeof n === 'string') return; if (n.tag === 'tr') linhas.push(n); else n.children.forEach(coletar); };
        coletar(no);
        if (linhas.length) saida.push(tabela(linhas, fmt));
        return;
      }
      case 'ul': case 'ol': {
        let k = 0;
        for (const li of no.children) {
          if (typeof li === 'string' || li.tag !== 'li') continue;
          k++;
          abrirP({ ind: '<w:ind w:left="567" w:hanging="283"/>', jc: 'left' });
          runsAtuais.push(run((t === 'ol' ? k + '.' : '•') + '\t', fmt));
          li.children.forEach(c => andar(c, fmt, 'li'));
          fecharP();
        }
        return;
      }
      case 'div': case 'p': case 'li': case 'section': case 'article': case 'blockquote': {
        if (cls.includes('versos')) {   // bloco de versos: cada linha num parágrafo, com recuo (ou centralizado)
          const centro = cls.includes('centro');
          const linhasV = []; let atual = '';
          const colher = n => { if (typeof n === 'string') { atual += n; return; } if (n.tag === 'br') { linhasV.push(atual); atual = ''; return; } if (n.tag === 'div' || n.tag === 'p') { if (atual.trim()) { linhasV.push(atual); atual = ''; } n.children.forEach(colher); if (atual.trim()) { linhasV.push(atual); atual = ''; } return; } n.children.forEach(colher); };
          colher(no); if (atual.trim()) linhasV.push(atual);
          for (const l of linhasV.flatMap(x => x.split('\n'))) { if (!l.trim()) continue; abrirP({ ind: centro ? '' : '<w:ind w:left="567"/>', jc: centro ? 'center' : 'left' }); runsAtuais.push(run(l.trim(), fmt)); fecharP(); }
          return;
        }
        // bloco comum: fecha o parágrafo corrente e abre outro
        const temBloco = no.children.some(c => typeof c !== 'string' && ['div', 'p', 'table', 'ul', 'ol', 'img'].includes(c.tag));
        if (!temBloco) { abrirP(); no.children.forEach(c => andar(c, fmt, ambiente)); fecharP(); }
        else { fecharP(); no.children.forEach(c => andar(c, fmt, ambiente)); fecharP(); }
        return;
      }
      default: return no.children.forEach(c => andar(c, fmt, ambiente));
    }
  };
  raiz.children.forEach(c => andar(c, {}, 'raiz'));
  fecharP();
  return saida;
}
function tabela(linhas, fmt) {
  const ncol = Math.max(1, ...linhas.map(l => l.children.filter(c => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th')).length));
  const larg = Math.floor(LARGURA_TEXTO_TWIPS / ncol);
  const borda = '<w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/>';
  let t = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:jc w:val="center"/><w:tblBorders>' + borda + '</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' + '<w:gridCol w:w="' + larg + '"/>'.repeat(ncol) + '</w:tblGrid>';
  for (const l of linhas) {
    t += '<w:tr>';
    for (const c of l.children) {
      if (typeof c === 'string' || (c.tag !== 'td' && c.tag !== 'th')) continue;
      const paras = htmlParaParagrafos(c.children.map(serializar).join(''), { imagens: () => null, keepNext: false, jc: 'left' });
      t += '<w:tc><w:tcPr><w:tcW w:w="' + larg + '" w:type="dxa"/></w:tcPr>' + (paras.length ? paras.map(p => p.replace(PARA_ESPACO, '<w:spacing w:after="40"/>')) .join('') : '<w:p/>') + '</w:tc>';
    }
    t += '</w:tr>';
  }
  return t + '</w:tbl>' + paragrafo('', { spacing: '<w:spacing w:after="60"/>' });
}
// Volta um nó da árvore para HTML (para reaproveitar o conversor dentro das células).
function serializar(no) {
  if (typeof no === 'string') return xml(no);
  const attrs = Object.entries(no.attrs || {}).map(([k, v]) => ' ' + k + '="' + xml(v) + '"').join('');
  return '<' + no.tag + attrs + '>' + (VAZIAS.has(no.tag) ? '' : no.children.map(serializar).join('') + '</' + no.tag + '>');
}
let contadorDesenho = 0;
function desenhoImagem(img) {
  const id = ++contadorDesenho;
  const cx = img.w * EMU_POR_TWIP, cy = img.h * EMU_POR_TWIP;
  return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + id + '" name="Imagem ' + id + '"/>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="Imagem ' + id + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + img.rId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}

// ---------- ZIP (deflate quando o ambiente tem CompressionStream; senão, sem compressão) ----------
const CRC_TAB = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u) { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC_TAB[(c ^ u[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function deflateRaw(u) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const escritor = cs.writable.getWriter(); escritor.write(u); escritor.close();
    const partes = []; const leitor = cs.readable.getReader();
    for (;;) { const { value, done } = await leitor.read(); if (done) break; partes.push(value); }
    const total = partes.reduce((a, b) => a + b.length, 0); const saida = new Uint8Array(total); let o = 0;
    for (const p of partes) { saida.set(p, o); o += p.length; }
    return saida;
  } catch { return null; }
}
export async function zipar(arquivos) {   // [{ nome, dados: Uint8Array|string }]
  const enc = new TextEncoder(), locais = [], centrais = []; let offset = 0;
  const dosData = (() => { const d = new Date(); return { t: ((d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1)) & 0xffff, d: (((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()) & 0xffff }; })();
  for (const a of arquivos) {
    const nome = enc.encode(a.nome), dados = typeof a.dados === 'string' ? enc.encode(a.dados) : a.dados;
    const comp = await deflateRaw(dados); const metodo = comp && comp.length < dados.length ? 8 : 0; const corpo = metodo ? comp : dados;
    const crc = crc32(dados);
    const cab = new Uint8Array(30 + nome.length); const dv = new DataView(cab.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, metodo, true); dv.setUint16(10, dosData.t, true); dv.setUint16(12, dosData.d, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, corpo.length, true); dv.setUint32(22, dados.length, true); dv.setUint16(26, nome.length, true); dv.setUint16(28, 0, true); cab.set(nome, 30);
    locais.push(cab, corpo);
    const cen = new Uint8Array(46 + nome.length); const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, metodo, true); cv.setUint16(12, dosData.t, true); cv.setUint16(14, dosData.d, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, corpo.length, true); cv.setUint32(24, dados.length, true); cv.setUint16(28, nome.length, true); cv.setUint32(42, offset, true); cen.set(nome, 46);
    centrais.push(cen); offset += cab.length + corpo.length;
  }
  const tamCentral = centrais.reduce((a, b) => a + b.length, 0);
  const fim = new Uint8Array(22); const fv = new DataView(fim.buffer);
  fv.setUint32(0, 0x06054b50, true); fv.setUint16(8, arquivos.length, true); fv.setUint16(10, arquivos.length, true); fv.setUint32(12, tamCentral, true); fv.setUint32(16, offset, true);
  const total = offset + tamCentral + 22; const saida = new Uint8Array(total); let o = 0;
  for (const p of [...locais, ...centrais, fim]) { saida.set(p, o); o += p.length; }
  return saida;
}

// ---------- o caderno ----------
const ROMANOS = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function listaTextos(d) {
  const extras = Array.isArray(d.textos_extras) ? d.textos_extras : [];
  return [{ texto: d['texto-base'] || '', referencia: d.referencia || '' }, ...extras.map(t => ({ texto: t && t.texto || '', referencia: t && t.referencia || '' }))].filter(t => t.texto || t.referencia);
}
export function nomeArquivoProva(p) { return 'Prova_' + p.serie + p.tipo + '_' + p.bimestre + 'BIM_' + (p.modalidade === 'PART' ? 'PART' : p.modalidade === 'ENEM1' ? 'ENEM_1DIA' : 'ENEM_2DIA') + '_' + p.ano + '.docx'; }
export function cabecalhoProva(p, disciplina) { return disciplina.toUpperCase() + '/' + p.serie + 'ª SÉRIE - ' + p.tipo + '/' + NOME_MODALIDADE_CAB[p.modalidade]; }

/* prova: { serie, tipo, modalidade, bimestre, ano, aplicacao }
   blocos: [{ disciplina, itens: [{ codigo, dados, grupo: {codigo}|null }] }], já na ordem do caderno
   lerImagem: async (id) -> Uint8Array|null (imagens "atlas:img/<id>" do R2)
   Devolve Uint8Array com o .docx. */
export async function gerarCadernoDocx(prova, blocos, lerImagem) {
  contadorDesenho = 0;
  const midias = [], relsExtras = [];
  const cacheImg = new Map();
  const dec64 = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  async function carregar(src) {
    if (cacheImg.has(src)) return cacheImg.get(src);
    let bytes = null;
    const m = src.match(/^atlas:img\/([0-9a-f]{32})$/) || src.match(/\/img\/([0-9a-f]{32})\?/);
    if (m) { try { bytes = await lerImagem(m[1]); } catch { bytes = null; } }
    else if (/^data:image\/(png|jpeg|webp);base64,/i.test(src)) { try { bytes = dec64(src.slice(src.indexOf(',') + 1)); } catch { bytes = null; } }
    let r = null;
    if (bytes && bytes.length) {
      const t = tamanhoImagem(bytes);
      const n = midias.length + 1, ext = t.tipo === 'jpeg' ? 'jpeg' : t.tipo;
      const rId = 'rIdImg' + n;
      midias.push({ nome: 'word/media/imagem' + n + '.' + ext, dados: bytes, ext });
      relsExtras.push('<Relationship Id="' + rId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/imagem' + n + '.' + ext + '"/>');
      r = { rId, px: t };
    }
    cacheImg.set(src, r);
    return r;
  }
  // 1ª passada: carrega todas as imagens (o conversor de HTML é síncrono)
  const todosHtml = [];
  for (const b of blocos) for (const it of b.itens) { const d = it.dados || {}; for (const t of listaTextos(d)) todosHtml.push(t.texto); todosHtml.push(d.comando || ''); for (const l of 'abcde') todosHtml.push(d['alt-' + l] || ''); }
  for (const h of todosHtml) for (const m of String(h).matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) await carregar(desentidar(m[1]));
  const imagens = (src) => {
    const r = cacheImg.get(src);
    if (!r) return null;
    // Tamanho aprovado pelo Marinho no exemplo de 23/11/2026: a imagem como se tivesse 150 dpi, no máximo a largura do texto.
    const larguraNatural = Math.round(r.px.w * 15 * 96 / 150);   // px -> twips
    const w = Math.min(larguraNatural, LARGURA_TEXTO_TWIPS);
    return { rId: r.rId, w, h: Math.max(1, Math.round(w * r.px.h / r.px.w)) };
  };

  const corpo = [];
  let numero = INICIO_NUMERACAO[prova.modalidade] || 1;
  let primeiroBloco = true;
  for (const bloco of blocos) {
    const n = bloco.itens.length;
    const ini = numero, fim = numero + n - 1;
    corpo.push(paragrafo(run('GRUPO EDUCACIONAL IDEAL - 50 ANOS', { bold: true, cor: VINHO, tam: 20 }), { pageBreakBefore: !primeiroBloco, keepNext: true, spacing: '<w:spacing w:after="0"/>' }));
    corpo.push(paragrafo(run(cabecalhoProva(prova, bloco.disciplina), { bold: true, tam: 28 }), { keepNext: true, spacing: '<w:spacing w:after="60"/>' }));
    corpo.push(paragrafo(run('Aplicação: ' + dataBR(prova.aplicacao) + ' · questões ' + nn(ini) + ' a ' + nn(fim), { tam: 18, cor: '70676B' }), { keepNext: true, borda: true, spacing: '<w:spacing w:after="240"/>' }));
    primeiroBloco = false;
    for (let k = 0; k < bloco.itens.length; k++) {
      const it = bloco.itens[k];
      let d = it.dados || {};
      const g = it.grupo && it.grupo.codigo, ant = k > 0 && bloco.itens[k - 1].grupo && bloco.itens[k - 1].grupo.codigo;
      if (g && g !== ant) {   // texto compartilhado do grupo, uma vez só
        let m = 0; for (let j = k; j < bloco.itens.length && bloco.itens[j].grupo && bloco.itens[j].grupo.codigo === g; j++) m++;
        corpo.push(paragrafo(run('Texto para as questões ' + nn(numero) + ' a ' + nn(numero + m - 1), { bold: true, cor: VINHO, tam: 22 }), { keepNext: true, spacing: '<w:spacing w:before="240" w:after="120"/>' }));
        corpo.push(...textosParagrafos(d, imagens));
      }
      if (g) d = { ...d, 'texto-base': '', referencia: '', textos_extras: [] };
      corpo.push(paragrafo(run('QUESTÃO ' + nn(numero), { bold: true, cor: VINHO, tam: 24 }) + run('\t' + (it.codigo || ''), { fonte: 'Consolas', tam: 16, cor: CINZA }),
        { keepNext: true, spacing: '<w:spacing w:before="' + (k === 0 && !(g && g !== ant) ? 0 : 240) + '" w:after="120"/>', tabs: '<w:tab w:val="right" w:pos="' + LARGURA_TEXTO_TWIPS + '"/>' }));
      if (!g) corpo.push(...textosParagrafos(d, imagens));
      corpo.push(...htmlParaParagrafos(d.comando, { imagens, keepNext: true }));
      const letras = 'abcde'.split('').filter(l => d['alt-' + l]);
      letras.forEach((l, i) => {
        const ultima = i === letras.length - 1;
        corpo.push(...htmlParaParagrafos(d['alt-' + l], { imagens, keepNext: !ultima, recuo: true, prefixo: run(l.toUpperCase() + ')\t'), tabs: '<w:tab w:val="left" w:pos="425"/>', jc: 'both' }));
        if (d['ref-' + l]) corpo.push(paragrafo(run(String(d['ref-' + l]), { tam: 16, cor: '555555' }), { keepNext: !ultima, jc: 'right', ind: RECUO_ALT.replace('w:hanging="425"', 'w:hanging="0"'), spacing: '<w:spacing w:after="100"/>' }));
      });
      numero++;
    }
  }

  const nomeRodape = 'ATLAS · ' + prova.serie + 'ª série ' + prova.tipo + ' · ' + (NOME_MODALIDADE[prova.modalidade] || prova.modalidade) + ' · ' + prova.bimestre + 'º bimestre de ' + prova.ano + ' · página ';
  const documento = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">' +
    '<w:body>' + corpo.join('') +
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdRodape"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>';
  const rodape = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' + run(nomeRodape, { tam: 16, cor: CINZA }) + '<w:r><w:rPr><w:sz w:val="16"/><w:color w:val="' + CINZA + '"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="' + CINZA + '"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="' + CINZA + '"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="' + CINZA + '"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="' + CINZA + '"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>';
  const estilos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>' + PARA_ESPACO + '</w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TabelaNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>';
  const tipos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="webp" ContentType="image/webp"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>';
  const relsRaiz = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const relsDoc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdEstilos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rIdRodape" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' + relsExtras.join('') + '</Relationships>';
  return zipar([
    { nome: '[Content_Types].xml', dados: tipos }, { nome: '_rels/.rels', dados: relsRaiz }, { nome: 'word/document.xml', dados: documento },
    { nome: 'word/_rels/document.xml.rels', dados: relsDoc }, { nome: 'word/styles.xml', dados: estilos }, { nome: 'word/footer1.xml', dados: rodape },
    ...midias.map(m => ({ nome: m.nome, dados: m.dados }))
  ]);
}
function textosParagrafos(d, imagens) {
  const lista = listaTextos(d), varios = lista.length > 1, saida = [];
  lista.forEach((t, k) => {
    if (varios) saida.push(paragrafo(run('TEXTO ' + ROMANOS[k], { bold: true }), { keepNext: true, jc: 'center', spacing: '<w:spacing w:before="160" w:after="80"/>' }));
    if (t.texto) saida.push(...htmlParaParagrafos(t.texto, { imagens, keepNext: true }));
    if (t.referencia) saida.push(paragrafo(run(String(t.referencia), { tam: 16, cor: '555555' }), { keepNext: true, jc: 'right', spacing: '<w:spacing w:after="120"/>' }));
  });
  return saida;
}

// Texto puro de um campo (para o reconhecimento da prova final, 2ª entrega) — sem fórmulas, sem tags.
export function textoPuroHtml(html) {
  const raiz = analisar(String(html || ''));
  const andar = no => typeof no === 'string' ? no : (classes(no).includes('atlas-equation') ? ' ' : no.children.map(andar).join(no.tag === 'br' || no.tag === 'div' || no.tag === 'p' ? '\n' : ''));
  return andar(raiz).replace(/\s+/g, ' ').trim();
}
