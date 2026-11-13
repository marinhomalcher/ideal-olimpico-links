// Tela de FÉRIAS: o ATLAS fica fechado para professores, supervisores e digitadores em julho e de 15/12 a 31/01.
window.ATLAS_FERIAS = function (reabre, fechavel) {
  if (document.getElementById('atlas-ferias')) return;
  const mostrar = () => {
    document.documentElement.style.visibility = '';
    const d = document.createElement('div'); d.id = 'atlas-ferias'; d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-label', 'Férias');
    d.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#fbecef;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:Arial,Helvetica,sans-serif';
    const t = document.createElement('div'); t.textContent = 'FÉRIAS';
    t.style.cssText = 'font-size:clamp(72px,18vw,200px);font-weight:900;letter-spacing:.06em;color:#98151d;line-height:1';
    const p = document.createElement('p'); p.textContent = 'O ATLAS está fechado para professores e supervisores' + (reabre ? ' e reabre em ' + reabre : '') + '. Bom descanso!';
    p.style.cssText = 'font-size:clamp(16px,2.4vw,22px);color:#6e2026;max-width:640px;margin:22px 0 26px;line-height:1.45';
    const b = document.createElement('button'); b.type = 'button'; b.textContent = fechavel ? 'Fechar' : 'Voltar ao início';
    b.style.cssText = 'border:1px solid #98151d;background:#98151d;color:#fff;border-radius:10px;padding:12px 22px;font:bold 16px Arial,sans-serif;cursor:pointer';
    b.addEventListener('click', () => { if (fechavel) d.remove(); else location.href = 'index.html'; });
    d.append(t, p, b); document.body.append(d); b.focus();
  };
  if (document.body) mostrar(); else document.addEventListener('DOMContentLoaded', mostrar);
};
