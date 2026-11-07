// Confere no servidor a sessão institucional antes de abrir uma área do ATLAS.
document.documentElement.style.visibility = 'hidden';
window.ATLAS_AUTH_READY = (async () => {
  const perfil = location.pathname.endsWith('supervisor.html') ? 'Supervisor' : 'Professor';
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
