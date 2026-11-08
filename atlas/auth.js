// Confere no servidor a sessão institucional antes de abrir uma área do ATLAS.
document.documentElement.style.visibility = 'hidden';
window.ATLAS_AUTH_READY = (async () => {
  const perfil = /\/supervisor[\w-]*\.html$/.test(location.pathname) ? 'Supervisor' : 'Professor';
  const fail = () => {
    sessionStorage.removeItem('atlas_user_auth');
    localStorage.removeItem('atlas_user_auth');
    location.replace('index.html?perfil=' + encodeURIComponent(perfil));
    throw new Error('Sessão indisponível');
  };
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem('atlas_user_auth') || localStorage.getItem('atlas_user_auth') || 'null'); }
  catch { return fail(); }
  if (!saved?.token || !saved?.expira_em || Date.parse(saved.expira_em) <= Date.now()) return fail();
  let response, data;
  try {
    response = await fetch('https://atlas-api.marinhomalcher.workers.dev/api/login/sessao', {
      headers: { Authorization: 'Bearer ' + saved.token }, cache: 'no-store'
    });
    data = await response.json();
  } catch {
    location.replace('index.html?perfil=' + encodeURIComponent(perfil) + '&erro=conexao');
    throw new Error('Sem conexão');
  }
  if (!response.ok || data?.ok !== true || !data.usuario) return fail();
  // Professor que tentar abrir a área do Supervisor vai para a sua própria área (sem perder o login).
  if (perfil === 'Supervisor' && data.usuario.papel !== 'supervisor') {
    location.replace('professor.html');
    throw new Error('Área restrita ao Supervisor');
  }
  window.ATLAS_USER = data.usuario;
  document.documentElement.style.visibility = '';
  return data.usuario;
})();
window.ATLAS_SAIR = async function () {
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem('atlas_user_auth') || localStorage.getItem('atlas_user_auth') || 'null'); } catch {}
  sessionStorage.removeItem('atlas_user_auth');
  localStorage.removeItem('atlas_user_auth');
  if (saved?.token) {
    try {
      await fetch('https://atlas-api.marinhomalcher.workers.dev/api/login/sair', {
        method: 'POST', headers: { Authorization: 'Bearer ' + saved.token }, cache: 'no-store'
      });
    } catch {}
  }
  location.href = 'index.html';
};

// Chamada ao servidor do ATLAS com a sessão do usuário. Sessão vencida volta para o login.
window.ATLAS_API = async function (path, { method = 'GET', body, raw } = {}) {
  const perfil = /\/supervisor[\w-]*\.html$/.test(location.pathname) ? 'Supervisor' : 'Professor';
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem('atlas_user_auth') || localStorage.getItem('atlas_user_auth') || 'null'); } catch {}
  const headers = {};
  if (saved?.token) headers.Authorization = 'Bearer ' + saved.token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = raw.type || 'application/octet-stream';
  let response;
  try {
    response = await fetch('https://atlas-api.marinhomalcher.workers.dev' + path, {
      method, headers, body: raw ? raw : body === undefined ? undefined : JSON.stringify(body), cache: 'no-store'
    });
  } catch { throw new Error('Sem conexão com o servidor do ATLAS. Seus dados continuam na tela; tente novamente.'); }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    try { if (typeof window.ATLAS_ANTES_DE_SAIR === 'function') window.ATLAS_ANTES_DE_SAIR(); } catch {}
    sessionStorage.removeItem('atlas_user_auth');
    localStorage.removeItem('atlas_user_auth');
    location.replace('index.html?perfil=' + encodeURIComponent(perfil));
    throw new Error('Sessão expirada. Entre novamente.');
  }
  if (!response.ok || data.ok !== true) throw new Error(data.error || 'A operação falhou. Tente novamente.');
  return data;
};

// Imagens coladas no editor vão para o armazenamento do ATLAS (R2); a questão guarda só o endereço.
window.ATLAS_ENVIAR_IMAGEM = async function (blob) {
  return (await window.ATLAS_API('/api/imagens', { method: 'POST', raw: blob })).url;
};
// Troca links de imagem vencidos (rascunhos antigos) por links novos.
window.ATLAS_RENOVAR_IMAGENS = async function (dados) {
  const re = /https:\/\/atlas-api\.marinhomalcher\.workers\.dev\/img\/[0-9a-f]{32}\?e=\d{1,12}(?:&amp;|&)s=[0-9a-f]{64}/g;
  const links = [...new Set(Object.values(dados || {}).filter(v => typeof v === 'string').flatMap(v => v.match(re) || []))];
  if (!links.length) return dados;
  const pedido = links.map(l => l.replace(/&amp;/g, '&'));
  const { links: novos } = await window.ATLAS_API('/api/imagens/links', { method: 'POST', body: { links: pedido } });
  const out = { ...dados };
  for (const k of Object.keys(out)) if (typeof out[k] === 'string') out[k] = out[k].replace(re, l => {
    const n = novos[l.replace(/&amp;/g, '&')]; return n ? (l.includes('&amp;') ? n.replace(/&/g, '&amp;') : n) : l;
  });
  return out;
};
