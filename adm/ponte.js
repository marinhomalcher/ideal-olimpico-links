// Ações na planilha do portal a partir do /adm/ (etapa 2, lote A, 20/11/2026).
// Os cartões <button class="card acao" data-acao="..."> chamam, pela ponte do coordenador (iframe do Apps Script,
// implantação da coordenação, só a conta autorizada), as mesmas rotinas do menu da planilha. O protocolo é o da
// página /inscricoes/coordenador/: a ponte avisa "ready" com um nonce, esta página autoriza, e cada chamada vai
// por postMessage e volta com um resultado. Sem janelas do navegador: a confirmação é um segundo clique.
(() => {
  'use strict';
  const PERMITIDAS = new Set(['coordenadorAtualizarCatalogo', 'coordenadorAtualizarConquistas']);
  const frame = document.getElementById('ponteCoordenador');
  const botoes = [...document.querySelectorAll('button.card.acao')];
  if (!frame || !botoes.length) return;
  const pendentes = new Map();
  let fonte = null, origem = '', conectada = false, conectando = null, seq = 0, ocupado = false, timerConexao = 0;

  function origemConfiavel(o) {
    try { const u = new URL(o); return u.protocol === 'https:' && (u.hostname === 'script.google.com' || u.hostname === 'script.googleusercontent.com' || u.hostname.endsWith('-script.googleusercontent.com')); } catch { return false; }
  }
  function janelaDaPonte(source) {
    if (!source) return false;
    let atual = source;
    for (let n = 0; n < 8 && atual && atual !== window; n++) {
      if (atual === frame.contentWindow) return true;
      try { const pai = atual.parent; if (!pai || pai === atual) return false; atual = pai; } catch { return false; }
    }
    return atual === frame.contentWindow;
  }
  function config() { return window.COORD_CONFIG || {}; }
  function mensagemDe(botao) { return botao.closest('.grupo').querySelector('.acao-msg'); }
  function mostrar(el, texto, tipo, linkTexto, linkUrl) {
    el.textContent = texto || '';
    el.className = 'acao-msg' + (tipo ? ' ' + tipo : '');
    if (linkTexto && linkUrl) {
      el.append(' ');
      const a = document.createElement('a'); a.href = linkUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = linkTexto; el.append(a);
      el.append('.');
    }
  }
  function ocupar(v) { ocupado = v; botoes.forEach(b => { b.disabled = v; }); }

  /* Conexão: carrega a ponte uma vez; a promessa resolve quando a ponte confirma a autorização. */
  function conectar() {
    if (conectada) return Promise.resolve();
    if (conectando) return conectando;
    const cfg = config();
    if (!cfg.bridgeUrl) return Promise.reject(new Error('A conexão privada com a planilha ainda não foi configurada.'));
    conectando = new Promise((resolve, reject) => {
      pendentes.set('__conexao', { resolve, reject });
      frame.src = cfg.bridgeUrl;
      timerConexao = setTimeout(() => {
        const p = pendentes.get('__conexao'); pendentes.delete('__conexao'); conectando = null;
        const e = new Error('Não foi possível conectar com a sua conta Google nesta janela.'); e.code = 'PONTE_TIMEOUT';
        if (p) p.reject(e);
      }, 12000);
    });
    return conectando;
  }
  function chamar(metodo, lento) {
    if (!conectada || !PERMITIDAS.has(metodo)) return Promise.reject(new Error('A conexão privada ainda não está pronta.'));
    const id = 'adm-' + (++seq) + '-' + Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pendentes.delete(id); reject(new Error('O Google não respondeu a tempo. Recarregue a página e tente de novo.')); }, lento ? 120000 : 45000);
      pendentes.set(id, { resolve, reject, timer });
      fonte.postMessage({ type: 'ideal-coord-call', id, method: metodo, args: [] }, origem);
    });
  }
  window.addEventListener('message', ev => {
    if (!janelaDaPonte(ev.source) || !origemConfiavel(ev.origin) || !ev.data || typeof ev.data !== 'object') return;
    const d = ev.data;
    if (d.type === 'ideal-coord-ready' && typeof d.nonce === 'string' && d.nonce.length >= 24) {
      fonte = ev.source; origem = ev.origin;
      fonte.postMessage({ type: 'ideal-coord-authorize', nonce: d.nonce }, origem);
      return;
    }
    if (ev.source !== fonte || ev.origin !== origem) return;
    if (d.type === 'ideal-coord-connected') {
      conectada = true; clearTimeout(timerConexao);
      const p = pendentes.get('__conexao'); pendentes.delete('__conexao');
      if (p) p.resolve();
      return;
    }
    if (d.type === 'ideal-coord-result' && typeof d.id === 'string') {
      const p = pendentes.get(d.id); if (!p) return;
      clearTimeout(p.timer); pendentes.delete(d.id);
      if (d.ok) p.resolve(d.data); else p.reject(new Error(String(d.error || 'A operação falhou.')));
    }
  });

  /* Clique: ações marcadas com data-confirmar pedem um segundo clique em 8 s. */
  let aguardandoConfirmacao = null, timerConfirmacao = 0;
  function desarmar() {
    if (!aguardandoConfirmacao) return;
    aguardandoConfirmacao.classList.remove('confirmar'); aguardandoConfirmacao.querySelector('em').textContent = 'Executar';
    aguardandoConfirmacao = null; clearTimeout(timerConfirmacao);
  }
  async function executar(botao) {
    const metodo = botao.dataset.acao, msg = mensagemDe(botao), rotulo = botao.querySelector('em');
    if (!PERMITIDAS.has(metodo)) return;
    ocupar(true);
    try {
      if (!conectada) { mostrar(msg, 'Conectando à planilha pela sua conta Google…'); await conectar(); }
      mostrar(msg, botao.dataset.lento ? 'Executando… pode levar até 2 minutos.' : 'Executando…');
      rotulo.textContent = 'Executando…';
      const r = await chamar(metodo, !!botao.dataset.lento);
      mostrar(msg, String(r && r.mensagem || 'Pronto.'), 'ok');
    } catch (e) {
      if (e && e.code === 'PONTE_TIMEOUT') mostrar(msg, e.message + ' Entre no Google com a conta autorizada,', 'error', 'abra a conexão segura em outra aba', config().standaloneUrl || config().bridgeUrl);
      else mostrar(msg, (e && e.message) || 'A operação falhou.', 'error');
    } finally {
      rotulo.textContent = 'Executar';
      ocupar(false);
    }
  }
  botoes.forEach(b => b.addEventListener('click', () => {
    if (ocupado) return;
    if (b.dataset.confirmar && aguardandoConfirmacao !== b) {
      desarmar();
      aguardandoConfirmacao = b; b.classList.add('confirmar'); b.querySelector('em').textContent = 'Clique de novo para confirmar';
      mostrar(mensagemDe(b), 'Tem certeza? Clique de novo no cartão para confirmar (ou espere 8 s para cancelar).');
      timerConfirmacao = setTimeout(() => { mostrar(mensagemDe(b), ''); desarmar(); }, 8000);
      return;
    }
    desarmar();
    executar(b);
  }));
})();
