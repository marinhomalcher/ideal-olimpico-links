// Campo de tags (palavras-chave) das questões do ATLAS.
// Uso: const tags = AtlasTags.setup('tags'); tags.get() → ['ecologia', 'enem 2023']; tags.set([...]).
(function () {
  const MAX_TAGS = 12, MAX_LEN = 40;
  function normalizar(valor) {
    return String(valor || '').replace(/^#+/, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR').slice(0, MAX_LEN);
  }
  function lista(valor) {
    const bruto = Array.isArray(valor) ? valor : String(valor || '').split(/[,;\n]/);
    const out = [];
    for (const v of bruto) { const t = normalizar(v); if (t && !out.includes(t) && out.length < MAX_TAGS) out.push(t); }
    return out;
  }
  function estilo() {
    if (document.getElementById('atlas-tags-css')) return;
    const css = document.createElement('style'); css.id = 'atlas-tags-css';
    css.textContent = '.atlas-tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1px solid #d8cdd0;border-radius:8px;padding:6px 8px;background:#fff;min-height:42px;cursor:text}' +
      '.atlas-tags:focus-within{outline:3px solid #9b111a25;border-color:#98151d}' +
      '.atlas-tag{display:inline-flex;align-items:center;gap:4px;background:#fbecef;color:#7a1219;border-radius:999px;padding:3px 4px 3px 10px;font-size:13px;font-weight:bold}' +
      '.atlas-tag button{border:0;background:transparent;color:#7a1219;cursor:pointer;font-size:15px;line-height:1;padding:0 4px;border-radius:999px}' +
      '.atlas-tag button:hover{background:#f3d4da}' +
      '.atlas-tags input{border:0!important;outline:0!important;flex:1 1 160px;min-width:120px;padding:4px!important;font:inherit;background:transparent;box-shadow:none!important;width:auto!important}' +
      '.atlas-tag-view{display:inline-block;background:#fbecef;color:#7a1219;border-radius:999px;padding:1px 9px;font-size:12px;font-weight:bold;margin:2px 4px 2px 0}';
    document.head.append(css);
  }
  function setup(id) {
    estilo();
    const original = document.getElementById(id);
    const caixa = document.createElement('div'); caixa.className = 'atlas-tags'; caixa.id = id + '-caixa';
    const input = document.createElement('input'); input.id = id; input.type = 'text'; input.autocomplete = 'off';
    input.placeholder = original?.getAttribute('placeholder') || 'Digite e tecle Enter (ou vírgula)';
    input.setAttribute('aria-label', original?.getAttribute('aria-label') || 'Tags da questão');
    caixa.append(input);
    if (original) original.replaceWith(caixa);
    let tags = [];
    function desenhar() {
      caixa.querySelectorAll('.atlas-tag').forEach(n => n.remove());
      for (const t of tags) {
        const chip = document.createElement('span'); chip.className = 'atlas-tag'; chip.textContent = t;
        const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Remover a tag ' + t);
        x.addEventListener('click', ev => { ev.stopPropagation(); tags = tags.filter(v => v !== t); desenhar(); input.focus(); });
        chip.append(x); caixa.insertBefore(chip, input);
      }
      input.disabled = false;
      input.placeholder = tags.length >= MAX_TAGS ? 'Máximo de ' + MAX_TAGS + ' tags' : (original?.getAttribute('placeholder') || 'Digite e tecle Enter (ou vírgula)');
    }
    function adicionar(texto) {
      const novas = lista(texto);
      for (const t of novas) if (!tags.includes(t) && tags.length < MAX_TAGS) tags.push(t);
      input.value = ''; desenhar();
    }
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ',' || ev.key === ';' || ev.key === 'Tab' && input.value.trim()) { if (input.value.trim() || ev.key !== 'Tab') ev.preventDefault(); if (input.value.trim()) adicionar(input.value); }
      else if (ev.key === 'Backspace' && !input.value && tags.length) { tags.pop(); desenhar(); }
    });
    input.addEventListener('paste', ev => { const t = ev.clipboardData?.getData('text/plain'); if (t && /[,;\n]/.test(t)) { ev.preventDefault(); adicionar(t); } });
    input.addEventListener('blur', () => { if (input.value.trim()) adicionar(input.value); });
    caixa.addEventListener('click', () => input.focus());
    return {
      get() { if (input.value.trim()) adicionar(input.value); return tags.slice(); },
      set(v) { tags = lista(v); input.value = ''; desenhar(); }
    };
  }
  function html(tags, escapeHTML) {
    const esc = escapeHTML || (s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    estilo();
    return lista(tags).map(t => '<span class="atlas-tag-view">#' + esc(t) + '</span>').join('');
  }
  window.AtlasTags = { setup, lista, html, MAX_TAGS, MAX_LEN };
})();
