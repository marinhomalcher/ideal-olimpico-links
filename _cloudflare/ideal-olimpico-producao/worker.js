// Portal de produção. Sem as três variáveis de ambiente, responde 503 e não acessa a planilha.
const ALLOWED_ORIGINS = Object.freeze(['https://idealolimpico.com.br', 'https://www.idealolimpico.com.br']);
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
const SESSION_ARGUMENT_INDEX = Object.freeze({
  confirmarCadastroAluno: 0,
  solicitarAlteracaoCadastral: 0,
  encerrarSessaoAluno: 0,
  getOpcoesLiteratura: 0,
  validarCompeticaoSerie: 1,
  verificarInscricaoExistente: 0,
  verificarCarrinhoAluno: 0,
  criarPedido: 0,
  listarPedidosAluno: 0,
  cancelarPedidoAluno: 0,
  obterPixPedido: 0
});

function reply(body, status, origin, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
    ...extraHeaders
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '600';
  }
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

async function readLimitedText(request) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        try { await reader.cancel(); } catch {}
        const error = new Error('body-too-large');
        error.code = 'BODY_TOO_LARGE';
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function opaqueRateLimitKey(rateKeySecret, scope, value) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(rateKeySecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC', cryptoKey, encoder.encode(scope + '\n' + String(value ?? ''))
  ));
  return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function isRateLimited(binding, key) {
  if (!binding || typeof binding.limit !== 'function') throw new Error('Rate limiter not configured');
  const result = await binding.limit({ key });
  if (!result || typeof result.success !== 'boolean') throw new Error('Invalid rate limiter response');
  return !result.success;
}

function sanitizeCorrectionResult(result) {
  if (!result || !result.ok || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return result;
  const data = { ...result.data };
  let safeUrl = '';
  try {
    const candidate = new URL(String(data.whatsappUrl || ''));
    if (candidate.protocol === 'https:' && candidate.hostname === 'wa.me' &&
        !candidate.port && !candidate.username && !candidate.password &&
        /^\/55\d{10,11}$/.test(candidate.pathname)) {
      safeUrl = candidate.origin + candidate.pathname;
    }
  } catch {}
  data.whatsappUrl = safeUrl;
  data.whatsappConfigurado = Boolean(safeUrl);
  return { ...result, data };
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);
    if (url.pathname !== '/api' || url.search !== '' || !ALLOWED_ORIGINS.includes(origin)) {
      return reply({ ok: false, error: 'Rota indisponível.' }, 404, origin);
    }
    if (request.method === 'OPTIONS') return reply(null, 204, origin);
    if (request.method !== 'POST') return reply({ ok: false, error: 'Método não permitido.' }, 405, origin);
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
      return reply({ ok: false, error: 'Formato inválido.' }, 415, origin);
    }
    const lengthHeader = request.headers.get('Content-Length');
    if (lengthHeader && /^\d+$/.test(lengthHeader) && Number(lengthHeader) > MAX_BODY_BYTES) {
      return reply({ ok: false, error: 'Arquivo excede o limite permitido.' }, 413, origin);
    }
    const backend = env.APPS_SCRIPT_PROD_EXEC_URL;
    const secret = env.PORTAL_PROD_PROXY_SECRET;
    const rateKeySecret = env.PORTAL_RATE_KEY_SECRET;
    if (!backend || !secret || !rateKeySecret) return reply({ ok: false, error: 'Conexão não configurada.' }, 503, origin);
    let parsed;
    try {
      parsed = JSON.parse(await readLimitedText(request));
    } catch (error) {
      if (error && error.code === 'BODY_TOO_LARGE') {
        return reply({ ok: false, error: 'Arquivo excede o limite permitido.' }, 413, origin);
      }
      return reply({ ok: false, error: 'Dados inválidos.' }, 400, origin);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        !Object.hasOwn(METHODS, parsed.method) || !Array.isArray(parsed.args) ||
        parsed.args.length !== METHODS[parsed.method]) {
      return reply({ ok: false, error: 'Operação não permitida.' }, 400, origin);
    }

    try {
      if (parsed.method === 'autenticarAluno') {
        // A generous network-level ceiling slows matrícula enumeration while
        // leaving the per-matrícula limiter as the primary login control.
        // Cloudflare supplies this header for direct client requests. If it is
        // absent, the per-matrícula limit still applies.
        const clientIp = request.headers.get('CF-Connecting-IP')?.trim();
        if (clientIp) {
          const ipKey = await opaqueRateLimitKey(rateKeySecret, 'login-ip', clientIp);
          if (await isRateLimited(env.PORTAL_LOGIN_IP_LIMITER, ipKey)) {
            return reply(
              { ok: false, error: 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.' },
              429, origin, { 'Retry-After': '60' }
            );
          }
        }
      }
      let limiter;
      let scope;
      let value;
      if (parsed.method === 'autenticarAluno') {
        limiter = env.PORTAL_LOGIN_LIMITER;
        scope = 'login-matricula';
        value = parsed.args[0];
      } else if (parsed.method === 'enviarComprovantePedido') {
        limiter = env.PORTAL_UPLOAD_LIMITER;
        scope = 'upload-sessao';
        value = parsed.args[0];
      } else if (parsed.method === 'getCatalogoGrupo') {
        // The catalog endpoint has no student session argument. Give this
        // public, read-only resource its own high ceiling so one busy group
        // cannot consume the per-student request budget.
        limiter = env.PORTAL_CATALOG_LIMITER;
        scope = 'catalog-group';
        value = parsed.args[0];
      } else if (Object.hasOwn(SESSION_ARGUMENT_INDEX, parsed.method)) {
        limiter = env.PORTAL_SESSION_LIMITER;
        scope = 'sessao';
        value = parsed.args[SESSION_ARGUMENT_INDEX[parsed.method]];
      } else {
        return reply({ ok: false, error: 'Operação não configurada.' }, 400, origin);
      }
      const key = await opaqueRateLimitKey(rateKeySecret, scope, value);
      if (await isRateLimited(limiter, key)) {
        return reply(
          { ok: false, error: 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.' },
          429, origin, { 'Retry-After': '60' }
        );
      }
    } catch {
      return reply({ ok: false, error: 'Serviço temporariamente indisponível.' }, 503, origin);
    }

    try {
      const target = new URL(backend);
      if (target.protocol !== 'https:' || target.hostname !== 'script.google.com' || target.username || target.password || target.port ||
          !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(target.pathname) || target.search || target.hash) {
        return reply({ ok: false, error: 'Conexão não configurada.' }, 503, origin);
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
      const safeResult = parsed.method === 'solicitarAlteracaoCadastral' ? sanitizeCorrectionResult(result) : result;
      return reply(safeResult, 200, origin);
    } catch {
      return reply({ ok: false, error: 'A conexão falhou. Verifique o estado antes de repetir uma operação.' }, 502, origin);
    }
  }
};


