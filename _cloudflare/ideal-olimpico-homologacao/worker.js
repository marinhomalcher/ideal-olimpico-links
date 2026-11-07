// Test-only Cloudflare Worker. Secrets belong in Worker variables, never in Git.
const ALLOWED_ORIGIN = 'https://idealolimpico.com.br';
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const METHODS = Object.freeze({
  autenticarAluno: 2,
  confirmarCadastroAluno: 2,
  solicitarAlteracaoCadastral: 2,
  encerrarSessaoAluno: 1,
  getCatalogoGrupo: 1,
  getOpcoesLiteratura: 1,
  validarCompeticaoSerie: 2,
  verificarInscricaoExistente: 2,
  verificarCarrinhoAluno: 2,
  criarPedido: 2,
  listarPedidosAluno: 1,
  cancelarPedidoAluno: 2,
  obterPixPedido: 2,
  enviarComprovantePedido: 3
});

function reply(body, status, origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  };
  if (origin === ALLOWED_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '600';
  }
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);
    if (url.pathname !== '/api' || origin !== ALLOWED_ORIGIN) {
      return reply({ ok: false, error: 'Rota indisponível.' }, 404, origin);
    }
    if (request.method === 'OPTIONS') return reply(null, 204, origin);
    if (request.method !== 'POST') return reply({ ok: false, error: 'Método não permitido.' }, 405, origin);
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
      return reply({ ok: false, error: 'Formato inválido.' }, 415, origin);
    }
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) {
      return reply({ ok: false, error: 'Arquivo excede o limite do teste.' }, 413, origin);
    }
    const backend = env.APPS_SCRIPT_TEST_EXEC_URL;
    const secret = env.PORTAL_TEST_PROXY_SECRET;
    if (!backend || !secret) return reply({ ok: false, error: 'Teste não configurado.' }, 503, origin);
    let parsed;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return reply({ ok: false, error: 'Arquivo excede o limite do teste.' }, 413, origin);
      parsed = JSON.parse(raw);
    } catch {
      return reply({ ok: false, error: 'Dados inválidos.' }, 400, origin);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        !Object.hasOwn(METHODS, parsed.method) || !Array.isArray(parsed.args) ||
        parsed.args.length !== METHODS[parsed.method]) {
      return reply({ ok: false, error: 'Operação não permitida.' }, 400, origin);
    }
    try {
      const target = new URL(backend);
      if (target.protocol !== 'https:' || target.hostname !== 'script.google.com' ||
          !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(target.pathname) || target.search || target.hash) {
        return reply({ ok: false, error: 'Teste não configurado.' }, 503, origin);
      }
      const upstream = await fetch(target.href, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: JSON.stringify({ method: parsed.method, args: parsed.args, secret }),
        redirect: 'follow'
      });
      if (!upstream.ok) throw new Error('Backend indisponível');
      const result = await upstream.json();
      if (!result || typeof result.ok !== 'boolean') throw new Error('Resposta inválida');
      return reply(result, 200, origin);
    } catch {
      return reply({ ok: false, error: 'A conexão de teste falhou. Verifique o estado antes de repetir uma operação.' }, 502, origin);
    }
  }
};
