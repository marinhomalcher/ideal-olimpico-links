// Hub de administração (/adm/): confere a sessão do administrador do ATLAS (/api/adm/sessao);
// sem sessão, mostra o botão "Entrar com Google" do ATLAS. O token fica no sessionStorage, na mesma
// chave das páginas admin do ATLAS (atlas_adm_token), então elas abrem já conectadas na mesma aba.
(() => {
  const API = 'https://atlas-api.marinhomalcher.workers.dev';
  const GOOGLE_CLIENT_ID = '432003570373-cscu1nvoldack2luihm9lnlsi9q2p115.apps.googleusercontent.com';
  const TOKEN_KEY = 'atlas_adm_token';
  const ABAS = ['inscricoes', 'olimpiadas', 'atlas', 'redacao'];
  const $ = s => document.querySelector(s);
  const loginSec = $('#loginSec'), appSec = $('#appSec'), badge = $('#admBadge'), loginStatus = $('#loginStatus');

  function getToken() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
  function setToken(t) { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch {} }
  function status(text, isError) { loginStatus.textContent = text || ''; loginStatus.classList.toggle('error', !!isError); }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try { response = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' }); }
    catch { throw new Error('Sem conexão com o servidor do ATLAS.'); }
    let data = {};
    try { data = await response.json(); } catch {}
    if (response.status === 401 && path !== '/api/adm/login') { setToken(''); showLogin(data.error || 'Sessão expirada. Entre novamente.'); throw new Error('__sessao__'); }
    if (!response.ok || !data.ok) throw new Error(data.error || 'A operação falhou.');
    return data;
  }

  function loadGoogle() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Não foi possível carregar o login do Google.'));
      document.head.appendChild(s);
    });
  }

  async function showLogin(message = '', isError = true) {
    appSec.classList.add('hidden'); badge.classList.add('hidden'); loginSec.classList.remove('hidden');
    status(message, isError && !!message);
    try {
      await loadGoogle();
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onCredential, auto_select: false, ux_mode: 'popup' });
      $('#googleBtn').replaceChildren();
      google.accounts.id.renderButton($('#googleBtn'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'pt-BR' });
    } catch (e) { status(e.message, true); }
  }

  async function onCredential(resp) {
    status('Confirmando login…');
    try { const data = await api('/api/adm/login', { method: 'POST', body: { credential: resp.credential } }); setToken(data.token); showApp(data.email); }
    catch (e) { if (e.message !== '__sessao__') status(e.message, true); }
  }

  function showApp(email) {
    loginSec.classList.add('hidden'); appSec.classList.remove('hidden'); badge.classList.remove('hidden');
    $('#admEmail').textContent = email || '';
    abrirAba(abaDoEndereco(), false);
    conferirDesempenho();
  }

  // Abas: a escolhida fica no endereço (#atlas), para favorito e para voltar do navegador.
  function abaDoEndereco() { const h = location.hash.replace('#', ''); return ABAS.includes(h) ? h : ABAS[0]; }
  function abrirAba(id, gravar = true) {
    for (const aba of ABAS) {
      const atual = aba === id;
      $('#tab-' + aba).setAttribute('aria-selected', atual ? 'true' : 'false');
      $('#aba-' + aba).classList.toggle('hidden', !atual);
    }
    if (gravar && location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  }
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => abrirAba(b.dataset.aba)));
  window.addEventListener('hashchange', () => abrirAba(abaDoEndereco(), false));

  // "Meu desempenho" chega com outro ramo: se a página ainda não existir no site, o cartão avisa.
  let desempenhoConferido = false;
  async function conferirDesempenho() {
    if (desempenhoConferido) return; desempenhoConferido = true;
    try {
      const r = await fetch('../atlas/desempenho-admin.html', { method: 'HEAD', cache: 'no-store' });
      if (r.ok) return;
    } catch { return; }
    const card = $('#cardDesempenho');
    card.classList.add('off'); card.removeAttribute('href'); card.setAttribute('aria-disabled', 'true');
    $('#descDesempenho').textContent = 'Mapas de desempenho e espelhos da redação. A página ainda não está publicada no site.';
    card.querySelector('em').textContent = 'Em breve';
  }

  $('#sairBtn').addEventListener('click', async () => {
    try { await api('/api/adm/sair', { method: 'POST', body: {} }); } catch {}
    setToken('');
    try { google.accounts.id.disableAutoSelect(); } catch {}
    showLogin('Você saiu da administração.', false);
  });

  (async () => {
    if (!getToken()) return showLogin();
    try { const s = await api('/api/adm/sessao'); showApp(s.email); }
    catch (e) { if (e.message !== '__sessao__') showLogin(e.message); }
  })();
})();
