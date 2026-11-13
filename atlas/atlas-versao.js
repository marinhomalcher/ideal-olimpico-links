// Atualização automática: quando sai uma versão nova do ATLAS, a página se recarrega sozinha
// (sem precisar de Ctrl+F5). Se a pessoa estiver digitando, aparece um aviso com "Atualizar agora".
(function () {
  const meta = document.querySelector('meta[name="atlas-versao"]');
  const minha = meta ? meta.content : '';
  if (!minha) return;
  // Tira o ?_v= que usamos para furar o cache, deixando o endereço limpo.
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('_v')) { u.searchParams.delete('_v'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); }
  } catch {}
  let digitou = false, aviso = null, nova = '';
  document.addEventListener('input', () => { digitou = true; }, true);

  function recarregar() {
    try { if (typeof window.ATLAS_ANTES_DE_SAIR === 'function') window.ATLAS_ANTES_DE_SAIR(); } catch {}
    try { sessionStorage.setItem('atlas_recarregou_para', nova); } catch {}
    const u = new URL(location.href);
    u.searchParams.set('_v', nova);
    location.replace(u.pathname + u.search + u.hash);
  }
  function mostrarAviso() {
    if (aviso) return;
    aviso = document.createElement('div');
    aviso.setAttribute('role', 'status');
    aviso.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147482000;background:#30282b;color:#fff;border-radius:12px;padding:12px 14px 12px 18px;display:flex;gap:14px;align-items:center;box-shadow:0 8px 30px #0005;font:14px/1.4 Arial,Helvetica,sans-serif;max-width:calc(100% - 24px)';
    const t = document.createElement('span');
    t.textContent = 'Saiu uma versão nova do ATLAS. Termine o que está fazendo e clique em Atualizar.';
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'Atualizar agora';
    b.style.cssText = 'border:0;background:#98151d;color:#fff;border-radius:8px;padding:8px 13px;font:bold 14px Arial,sans-serif;cursor:pointer;white-space:nowrap';
    b.addEventListener('click', recarregar);
    aviso.append(t, b);
    document.body.append(aviso);
  }
  async function conferir() {
    let v;
    try {
      const r = await fetch('versao.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      v = String((await r.json()).versao || '');
    } catch { return; }
    if (!v || v === minha) return;
    nova = v;
    let jaTentou = false;
    try { jaTentou = sessionStorage.getItem('atlas_recarregou_para') === v; } catch {}
    // Já recarregou para esta versão e a página ainda veio antiga (cache do GitHub): só avisa, sem ficar em ciclo.
    if (jaTentou) return mostrarAviso();
    if (!digitou || document.hidden) recarregar(); else mostrarAviso();
  }
  setTimeout(conferir, 3000);
  setInterval(conferir, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) conferir(); });
})();
