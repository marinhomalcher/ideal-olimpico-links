// ATLAS — servidor (Cloudflare Worker). MODO DE TESTE.
// Ainda sem login: só responde a /api/saude e não expõe nenhum dado do banco.
// As rotas de questões só serão abertas depois do login com a conta Microsoft da escola.
const ALLOWED_ORIGINS = Object.freeze(['https://idealolimpico.com.br', 'https://www.idealolimpico.com.br']);

function reply(body, status, origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Max-Age'] = '600';
  }
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return reply(null, 204, origin);

    if (url.pathname === '/api/saude' && request.method === 'GET') {
      try {
        const row = await env.DB.prepare("SELECT valor FROM meta WHERE chave = 'schema_versao'").first();
        return reply({ ok: true, modo: 'teste', banco: 'conectado', schema: row ? row.valor : null }, 200, origin);
      } catch {
        return reply({ ok: false, modo: 'teste', banco: 'indisponível' }, 503, origin);
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return reply({ ok: false, error: 'Recurso ainda não liberado (aguardando login institucional).' }, 503, origin);
    }
    return reply({ ok: false, error: 'Rota indisponível.' }, 404, origin);
  }
};
