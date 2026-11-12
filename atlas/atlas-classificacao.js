// Campos de classificação (assunto, subtema, detalhamentos, Bloom e, opcionalmente, dificuldade)
// para as telas de edição do Supervisor e da Administração. Usa o mesmo catálogo da tela do Professor.
(function () {
  let catalogoPromessa = null;
  function carregar() {
    if (!catalogoPromessa) {
      catalogoPromessa = Promise.all([
        fetch('catalogo-assuntos.json').then(r => { if (!r.ok) throw Error('Catálogo indisponível'); return r.json(); }),
        fetch('catalogo-literatura.json').then(r => (r.ok ? r.json() : null)).catch(() => null)
      ]).then(([cat, lit]) => ({ ...(lit?.disciplines || {}), ...cat.disciplines }))
        .catch(e => { catalogoPromessa = null; throw e; });
    }
    return catalogoPromessa;
  }
  const BLOOM = ['Lembrar', 'Compreender', 'Aplicar', 'Analisar', 'Avaliar'];
  const DIFICULDADE = ['Fácil', 'Média', 'Difícil'];
  const filhos = n => (n && typeof n === 'object' ? Object.keys(n) : []);
  function estilo() {
    if (document.getElementById('atlas-classif-css')) return;
    const css = document.createElement('style'); css.id = 'atlas-classif-css';
    css.textContent = '.atlas-classif{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 16px;margin:6px 0 4px}@media(max-width:720px){.atlas-classif{grid-template-columns:1fr}}' +
      '.atlas-classif select{max-width:100%!important;width:100%}.atlas-classif .wide{grid-column:1/-1}.atlas-classif [hidden]{display:none!important}';
    document.head.append(css);
  }
  // Monta os campos dentro de "caixa". Devolve { ler(), faltando() }.
  async function montar(caixa, { disciplina, dados = {}, comDificuldade = false, prefixo = 'cl' }) {
    estilo();
    const catalogo = await carregar();
    const arvore = catalogo[disciplina] || {};
    caixa.classList.add('atlas-classif');
    const id = n => prefixo + '-' + n;
    caixa.innerHTML =
      '<div class="wide"><label for="' + id('assunto') + '">Assunto principal</label><select id="' + id('assunto') + '"></select></div>' +
      '<div class="wide" data-linha="subtema"><label for="' + id('subtema') + '">Subtema</label><select id="' + id('subtema') + '"></select></div>' +
      '<div data-linha="nivel4"><label for="' + id('nivel4') + '">Detalhamento do subtema</label><select id="' + id('nivel4') + '"></select></div>' +
      '<div data-linha="nivel5"><label for="' + id('nivel5') + '">Detalhamento adicional</label><select id="' + id('nivel5') + '"></select></div>' +
      '<div><label for="' + id('bloom') + '">Nível cognitivo (Bloom)</label><select id="' + id('bloom') + '"></select></div>' +
      (comDificuldade ? '<div><label for="' + id('dificuldade') + '">Dificuldade prevista</label><select id="' + id('dificuldade') + '"></select></div>' : '');
    const sel = n => caixa.querySelector('#' + id(n));
    // Mantém um valor antigo que não está mais no catálogo, para não apagar a classificação sem querer.
    function preencher(s, itens, vazio, atual) {
      const lista = itens.slice();
      if (atual && !lista.includes(atual)) lista.unshift(atual);
      s.replaceChildren(new Option(vazio, ''), ...lista.map(v => new Option(v, v)));
      s.value = atual && lista.includes(atual) ? atual : '';
    }
    function niveis(atualSub, atual4, atual5) {
      const t2 = arvore[sel('assunto').value] || {};
      const subs = filhos(t2);
      preencher(sel('subtema'), subs, 'Selecione o subtema', atualSub);
      caixa.querySelector('[data-linha="subtema"]').hidden = !subs.length && !sel('subtema').value;
      const t3 = t2[sel('subtema').value] || {};
      const n4 = filhos(t3);
      preencher(sel('nivel4'), n4, 'Selecione o detalhamento', atual4);
      caixa.querySelector('[data-linha="nivel4"]').hidden = !n4.length && !sel('nivel4').value;
      const t4 = t3[sel('nivel4').value] || {};
      const n5 = filhos(t4);
      preencher(sel('nivel5'), n5, 'Selecione o detalhamento adicional', atual5);
      caixa.querySelector('[data-linha="nivel5"]').hidden = !n5.length && !sel('nivel5').value;
    }
    preencher(sel('assunto'), filhos(arvore), 'Selecione o assunto', dados.assunto || '');
    niveis(dados.subtema || '', dados.nivel4 || '', dados.nivel5 || '');
    preencher(sel('bloom'), BLOOM, 'Selecione', dados.bloom || '');
    if (comDificuldade) preencher(sel('dificuldade'), DIFICULDADE, 'Selecione', dados.dificuldade || '');
    sel('assunto').addEventListener('change', () => niveis('', '', ''));
    sel('subtema').addEventListener('change', () => niveis(sel('subtema').value, '', ''));
    sel('nivel4').addEventListener('change', () => niveis(sel('subtema').value, sel('nivel4').value, ''));
    return {
      ler() {
        const r = { assunto: sel('assunto').value, subtema: sel('subtema').value, nivel4: sel('nivel4').value, nivel5: sel('nivel5').value, bloom: sel('bloom').value };
        if (comDificuldade) r.dificuldade = sel('dificuldade').value;
        return r;
      },
      faltando() {
        if (!sel('assunto').value) return 'Escolha o assunto principal.';
        // Subtema obrigatório quando o assunto mudou ou a questão já tinha subtema (questões antigas sem subtema não travam).
        if (!caixa.querySelector('[data-linha="subtema"]').hidden && !sel('subtema').value && (sel('assunto').value !== (dados.assunto || '') || dados.subtema)) return 'Escolha o subtema.';
        if (!sel('bloom').value) return 'Escolha o nível cognitivo (Bloom).';
        if (comDificuldade && !sel('dificuldade').value) return 'Escolha a dificuldade prevista.';
        return null;
      }
    };
  }
  window.AtlasClassificacao = { carregar, montar };
})();
