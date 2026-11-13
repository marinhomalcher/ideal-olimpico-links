// Formulário de envio sem classificação (ADM e digitador): só disciplina + conteúdo.
// A classificação (assunto, subtema, Bloom, dificuldade) fica com o Supervisor da disciplina.
window.AtlasEnvioSimples = (function () {
  const DISCIPLINAS = ['Artes', 'Biologia', 'Filosofia', 'Física', 'Geografia', 'História', 'Inglês', 'Literatura', 'Matemática', 'Português', 'Química', 'Sociologia'];
  const CSS = `
.envio-simples .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:17px}.envio-simples .wide{grid-column:1/-1}
.envio-simples label{display:block;color:#5d5054;font-size:13px;font-weight:bold;margin-bottom:6px}
.envio-simples input,.envio-simples select,.envio-simples textarea{width:100%;border:1px solid #d8cdd0;background:#fff;color:#30282b;border-radius:8px;padding:10px 12px;font:inherit}
.envio-simples input:focus,.envio-simples select:focus{outline:3px solid #9b111a25;border-color:#98151d}
.envio-simples .hint{font-size:12px;color:#776c70;margin:8px 0 0}
.envio-simples .panel h2{font-size:18px;color:#6e2026;margin:0 0 4px}.envio-simples .description{margin:0 0 18px;color:#70676b;font-size:13px}
.envio-simples .alt{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;margin-bottom:12px;align-items:start}
.envio-simples .alt>strong{border-radius:8px;background:#fbecef;color:#98151d;padding:9px;text-align:center}
.envio-simples .actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:22px}
.envio-simples .primary{border:1px solid #98151d;background:#98151d;color:#fff;border-radius:8px;padding:10px 17px;font-weight:bold;cursor:pointer}
.envio-simples .primary:disabled{opacity:.5;cursor:not-allowed}
.envio-simples .secondary{border:1px solid #cbaeb2;background:#fff;color:#98151d;border-radius:8px;padding:9px 13px;font-weight:bold;cursor:pointer}
.envio-simples .status{font-size:12px;color:#7d6268;background:#fff6ea;border:1px solid #ebd5b8;border-radius:8px;padding:10px 12px}
.envio-simples .is-invalid{border-color:#b21d27!important;outline:2px solid #b21d2733!important}
.envio-simples .field-error{color:#a21923;font-size:12px;font-weight:700;margin:5px 0 0}
.envio-simples .validation-summary{border:1px solid #dca8ad;background:#fff3f4;color:#70171e;border-radius:9px;padding:12px 15px;margin:14px 0}
.envio-simples .repetida-box{background:#d9480f;color:#fff;border-radius:11px;padding:14px 16px;margin:10px 0;box-shadow:0 4px 14px #d9480f40}.envio-simples .repetida-box strong{font-size:16px}.envio-simples .repetida-box p{margin:4px 0 0}.envio-simples .repetida-box .secondary{background:#fff;border-color:#fff;color:#a8320a}.envio-simples .repetida-box .primary{background:#7a1f05;border-color:#7a1f05}.envio-simples .repetida-box .actions{margin-top:8px}
.envio-simples .ok-box{background:#ecf7f0;border:1px solid #b9dfc6;color:#1f5f39;border-radius:8px;padding:12px 14px;margin:0 0 16px;font-weight:bold}
.envio-simples .preview{border:1px solid #e6dadd;background:#fff;border-radius:10px;padding:20px;margin-top:14px}.envio-simples .preview .stem{text-align:justify;text-align-last:left}.envio-simples .preview .stem+.choice{margin-top:1.1em}.envio-simples .preview .choice{margin:7px 0}.envio-simples .preview .answer{font-size:12px;color:#87656b;margin-top:15px}
.envio-simples #es-fonte{text-transform:uppercase}
.envio-simples .sessao-lista{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.envio-simples .sessao-lista span{font-family:ui-monospace,Consolas,monospace;font-weight:bold;background:#fbecef;color:#7a1219;border-radius:999px;padding:3px 10px;font-size:13px}
.rich-editor{width:100%;min-height:90px;border:1px solid #d8cdd0;background:white;border-radius:8px;padding:10px 12px;outline:none;white-space:pre-wrap;overflow-wrap:anywhere}.rich-editor.long{min-height:145px}.rich-editor:focus{outline:3px solid #9b111a25;border-color:#98151d}.rich-editor:empty:before{content:attr(data-placeholder);color:#8a7f82;pointer-events:none}
.rich-editor img,.preview img{max-width:100%;max-height:380px;height:auto;display:block;margin:10px 0}img[style*="width"]{max-height:none!important;height:auto!important}
.rich-editor .atlas-equation,.preview .atlas-equation{display:inline;vertical-align:baseline;padding:0;border:0;background:transparent;white-space:nowrap}.rich-editor .atlas-equation .katex,.preview .atlas-equation .katex{font-size:1.15em}
.rich-editor .atlas-equation[data-display="block"],.preview .atlas-equation[data-display="block"]{display:block;text-align:center;margin:10px 0}
.atlas-latex-document{white-space:pre-wrap}.alt .rich-editor{min-height:66px;text-align:justify;text-align-last:left}.alt .rich-editor strong{border-radius:0;background:transparent;color:inherit;padding:0}
.atlas-tags:has(.is-invalid){border-color:#b21d27!important}
#equation-dialog{border:1px solid #e6dadd;border-radius:12px;box-shadow:0 18px 60px #29151b55;width:min(560px,calc(100% - 30px));padding:22px}#equation-dialog::backdrop{background:#1f1119a8}#equation-dialog h2{margin:0 0 8px;color:#98151d}#equation-dialog .modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:18px}#equation-dialog input{width:100%;border:1px solid #d8cdd0;border-radius:8px;padding:10px 12px;font:inherit}#equation-preview{min-height:62px;border:1px solid #e6dadd;padding:12px;overflow:auto;margin-top:10px}#equation-preview .katex{font-size:1.35em}.math-error{color:#b21d27}
@media(max-width:740px){.envio-simples .grid{grid-template-columns:1fr}.envio-simples .wide{grid-column:auto}}`;

  const HTML = `
<div id="es-ok" class="ok-box" role="status" hidden></div>
<form id="es-form" novalidate>
<section class="panel"><h2>1. Disciplina e origem</h2><p class="description">Escolha só a disciplina. Assunto, subtema, nível cognitivo e dificuldade são classificados depois pelo Supervisor da disciplina.</p><div class="grid">
<div><label for="es-disciplina">Disciplina</label><select id="es-disciplina"><option value="">Selecione a disciplina</option>${DISCIPLINAS.map(d => `<option>${d}</option>`).join('')}</select></div>
<div><label for="es-etapa">Etapa</label><select id="es-etapa"><option value="em">Ensino Médio</option><option value="ef2">Ensino Fundamental II</option></select></div>
<div id="es-ano-row" hidden><label for="es-ano">Ano de referência</label><select id="es-ano"><option value="">Selecione</option><option>6º ano</option><option>7º ano</option><option>8º ano</option><option>9º ano</option></select></div>
<div><label for="es-origem">Origem</label><select id="es-origem"><option value="">Selecione</option><option value="autoral">Autoral</option><option value="enem">ENEM</option><option value="outros">Outros</option></select></div>
<div class="wide" id="es-fonte-row" hidden><label for="es-fonte">Fonte (opcional)</label><input id="es-fonte" autocomplete="off" placeholder="Ex.: IDEAL 2023, FUVEST 2024"></div>
<div class="wide"><label for="es-tags">Tags (opcional)</label><input id="es-tags" placeholder="Ex.: gráfico, ecologia — tecle Enter ou vírgula após cada uma"><p class="hint">Opcional. O Supervisor pode completar depois.</p></div>
</div><p class="hint">A disciplina e a origem continuam escolhidas depois de cada envio, para agilizar a digitação de uma prova inteira.</p></section>
<section class="panel"><h2>2. Conteúdo da questão</h2><p class="description">Cole texto, imagens (Ctrl+V) ou LaTeX. Se colar as cinco alternativas juntas no campo A, elas são separadas automaticamente.</p><div class="grid">
<div class="wide"><label for="texto-base">Texto-base ou estímulo (quando houver)</label><textarea id="texto-base" class="long" placeholder="Cole o texto de apoio, gráfico ou material de referência"></textarea></div>
<div class="wide"><label for="es-referencia">Referência do texto ou da imagem (quando houver)</label><textarea id="es-referencia" placeholder="Fonte em estilo ENEM/INEP, sem hiperlink"></textarea></div>
<div class="wide"><label for="comando">Comando da questão</label><textarea id="comando" class="long" placeholder="O que o estudante deve responder"></textarea></div>
</div></section>
<section class="panel"><h2>3. Alternativas e gabarito</h2>
${'abcde'.split('').map(l => `<div class="alt"><strong>${l.toUpperCase()}</strong><textarea id="alt-${l}" aria-label="Alternativa ${l.toUpperCase()}"></textarea></div>`).join('')}
<label for="es-gabarito">Gabarito</label><select id="es-gabarito" style="max-width:320px"><option value="">Selecione a alternativa correta</option><option>A</option><option>B</option><option>C</option><option>D</option><option>E</option></select>
<div style="margin-top:17px"><label for="resolucao">Resolução (opcional)</label><textarea id="resolucao" class="long" placeholder="Digite ou cole a resolução"></textarea></div></section>
<section class="panel"><h2>4. Conferir e enviar</h2>
<div id="es-resumo" class="validation-summary" role="alert" hidden></div>
<div id="es-repetida" class="repetida-box" hidden role="alertdialog"><strong>Atenção: possível questão repetida</strong><p id="es-repetida-texto"></p><div class="actions"><button type="button" class="secondary" id="es-rep-cancelar">Não enviar</button><button type="button" class="primary" id="es-rep-enviar">Enviar mesmo assim</button></div></div>
<div id="es-previa" class="preview" hidden></div>
<div class="actions"><button type="button" class="secondary" id="es-visualizar">Visualizar questão</button><button type="submit" class="primary" id="es-enviar">Enviar para o Supervisor</button></div>
<p class="status" id="es-status" role="status">A questão vai para o Supervisor da disciplina, que faz a classificação antes de aprovar.</p>
<div id="es-sessao" hidden><p class="hint" style="margin-top:14px"><strong>Enviadas nesta sessão:</strong> <span id="es-sessao-n">0</span></p><div class="sessao-lista" id="es-sessao-lista"></div></div>
</section>
</form>
<dialog id="equation-dialog" aria-labelledby="eq-title"><h2 id="eq-title">Inserir equação</h2><label for="equation-input">Escreva a expressão em LaTeX</label><input id="equation-input" placeholder="Ex.: \\frac{a}{b}"><p class="hint">Use \\sen para seno em português. Dê dois cliques na equação para editar.</p><div id="equation-preview" aria-label="Prévia da equação"></div><p id="equation-error" class="field-error" role="alert" hidden>Revise a expressão: há um comando ou agrupamento inválido.</p><div class="modal-actions"><button type="button" class="secondary" onclick="this.closest('dialog').close()">Cancelar</button><button type="button" class="primary" id="equation-insert">Inserir</button></div></dialog>`;

  function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function montar(area, opcoes) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    area.classList.add('envio-simples'); area.innerHTML = HTML;
    const $ = s => area.querySelector(s) || document.querySelector(s);
    const rich = AtlasRich.setup(); const tags = AtlasTags.setup('es-tags');
    const form = $('#es-form'), status = $('#es-status'), previa = $('#es-previa'), btn = $('#es-enviar'), resumo = $('#es-resumo');
    const origem = $('#es-origem'), fonte = $('#es-fonte'), etapa = $('#es-etapa');
    const enviadas = [];
    let previsto = false, tentou = false, confirmarRepetida = false;
    if (opcoes.disciplinaFixa) { $('#es-disciplina').value = opcoes.disciplinaFixa; }
    origem.addEventListener('change', () => { $('#es-fonte-row').hidden = origem.value !== 'outros'; if (origem.value !== 'outros') fonte.value = ''; });
    etapa.addEventListener('change', () => { $('#es-ano-row').hidden = etapa.value !== 'ef2'; if (etapa.value !== 'ef2') $('#es-ano').value = ''; });
    fonte.addEventListener('input', () => { const a = fonte.selectionStart, b = fonte.selectionEnd; fonte.value = fonte.value.toLocaleUpperCase('pt-BR'); fonte.setSelectionRange(a, b); });

    const obrigatorios = [['es-disciplina', 'Disciplina'], ['es-origem', 'Origem'], ['comando', 'Comando da questão'], ['alt-a', 'Alternativa A'], ['alt-b', 'Alternativa B'], ['alt-c', 'Alternativa C'], ['alt-d', 'Alternativa D'], ['alt-e', 'Alternativa E'], ['es-gabarito', 'Gabarito']];
    function preenchido(id) { return AtlasRich.ids.includes(id) ? rich.valid(id) : !!document.getElementById(id).value.trim(); }
    function faltando() { const f = obrigatorios.filter(([id]) => !preenchido(id)); if (etapa.value === 'ef2' && !$('#es-ano').value) f.push(['es-ano', 'Ano de referência']); return f; }
    function marcar(lista) {
      area.querySelectorAll('.field-error').forEach(n => n.remove()); area.querySelectorAll('.is-invalid').forEach(n => n.classList.remove('is-invalid'));
      resumo.hidden = !lista.length; resumo.replaceChildren(); if (!lista.length) return;
      const t = document.createElement('strong'); t.textContent = 'Faltam ' + lista.length + (lista.length === 1 ? ' campo obrigatório: ' : ' campos obrigatórios: '); resumo.append(t, document.createTextNode(lista.map(x => x[1]).join(', ') + '.'));
      for (const [id, nome] of lista) { const f = document.getElementById(id); f.classList.add('is-invalid'); const e = document.createElement('p'); e.className = 'field-error'; e.textContent = 'Preencha ' + nome.toLowerCase() + '.'; (f.closest('.alt') || f).after(e); }
    }
    function validar() { tentou = true; const f = faltando(); marcar(f); if (f.length) { status.textContent = 'Faltam campos obrigatórios. Veja a lista acima.'; const c = document.getElementById(f[0][0]); c.focus(); c.scrollIntoView({ behavior: 'smooth', block: 'center' }); return false; } return true; }
    function coletar() {
      const d = { etapa: etapa.value, ano: $('#es-ano').value, origem: origem.value, fonte: origem.value === 'outros' ? fonte.value.trim().toLocaleUpperCase('pt-BR') : '', referencia: $('#es-referencia').value.trim(), gabarito: $('#es-gabarito').value, tags: tags.get(), rich: true };
      for (const id of AtlasRich.ids) d[id] = rich.valid(id) ? rich.read(id) : '';
      return d;
    }
    function mostrarPrevia() {
      const d = coletar(), body = v => AtlasRich.clean(v);
      let h = '<h2>Prévia da questão</h2><p class="hint">' + esc($('#es-disciplina').value) + ' · sem classificação (o Supervisor classifica)</p>' + (d.tags.length ? '<p>' + AtlasTags.html(d.tags) + '</p>' : '');
      if (d['texto-base']) h += '<div class="stem">' + body(d['texto-base']) + '</div>';
      if (d.referencia) h += '<p class="hint">' + esc(d.referencia) + '</p>';
      h += '<div class="stem">' + body(d.comando) + '</div>';
      for (const l of 'abcde') h += '<div class="choice"><strong>' + l.toUpperCase() + ')</strong> ' + body(d['alt-' + l]) + '</div>';
      h += '<p class="answer">Gabarito: ' + esc(d.gabarito) + '</p>';
      if (d.resolucao) h += '<div class="stem"><strong>Resolução:</strong><br>' + body(d.resolucao) + '</div>';
      previa.innerHTML = h; previa.hidden = false; previsto = true; status.textContent = 'Confira a prévia. Depois, clique em Enviar para o Supervisor.'; previa.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function invalidar() { previsto = false; previa.hidden = true; if (tentou) marcar(faltando()); }
    form.addEventListener('input', invalidar); form.addEventListener('change', invalidar);
    $('#es-visualizar').addEventListener('click', () => { if (validar()) mostrarPrevia(); });
    $('#es-rep-cancelar').addEventListener('click', () => { $('#es-repetida').hidden = true; status.textContent = 'Envio cancelado. Nada foi enviado.'; });
    $('#es-rep-enviar').addEventListener('click', () => { $('#es-repetida').hidden = true; confirmarRepetida = true; form.requestSubmit(); });
    form.addEventListener('submit', async ev => {
      ev.preventDefault(); if (!validar()) return; if (!previsto) { mostrarPrevia(); return; }
      btn.disabled = true; status.textContent = 'Enviando…';
      const disciplina = $('#es-disciplina').value;
      try {
        const r = await opcoes.enviar({ disciplina, dados: coletar(), confirmar_repetida: confirmarRepetida });
        confirmarRepetida = false;
        // Mantém disciplina, etapa, ano, origem e fonte para a próxima questão da mesma prova.
        rich.clear(); tags.set([]); $('#es-referencia').value = ''; $('#es-gabarito').value = ''; previa.hidden = true; previsto = false; tentou = false; marcar([]);
        enviadas.push(r.item.codigo); $('#es-sessao').hidden = false; $('#es-sessao-n').textContent = String(enviadas.length);
        const s = document.createElement('span'); s.textContent = r.item.codigo; $('#es-sessao-lista').append(s);
        const ok = $('#es-ok'); ok.textContent = 'Questão enviada para o Supervisor de ' + disciplina + '. Código: ' + r.item.codigo + '. Pode digitar a próxima.'; ok.hidden = false;
        status.textContent = 'Enviada: ' + r.item.codigo + '.';
        if (opcoes.aoEnviar) opcoes.aoEnviar(r);
        area.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        confirmarRepetida = false;
        if (e.dados && e.dados.repetidas) { $('#es-repetida-texto').textContent = e.message + ' Confira se não é a mesma questão antes de enviar.'; $('#es-repetida').hidden = false; $('#es-repetida').scrollIntoView({ behavior: 'smooth', block: 'center' }); status.textContent = 'Envio pausado: possível questão repetida.'; }
        else if (e.message !== '__sessao__') status.textContent = e.message;
      } finally { btn.disabled = false; }
    });
    return { coletar };
  }
  return { montar, DISCIPLINAS };
})();
