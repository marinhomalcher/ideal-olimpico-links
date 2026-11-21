// Portal de produção. Sem as três variáveis de ambiente, responde 503 e não acessa a planilha.
const ALLOWED_ORIGINS = Object.freeze(['https://idealolimpico.com.br', 'https://www.idealolimpico.com.br']);
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const METHODS = Object.freeze({
  solicitarCodigoAluno: 1,
  autenticarAlunoCodigo: 2,
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
  enviarComprovantePedido: 3,
  meuDesempenho: 1,
  paginasDesempenho: 2,
  lembrarAcessoAluno: 1,
  retomarSessaoAluno: 1,
  minhasConquistas: 1,
  meusCertificados: 1
});
// Login por código no e-mail: limite por IP e por matrícula, com a mesma chave por matrícula
// para os dois (pedir código e tentar código somam no mesmo teto).
const LOGIN_METHODS = Object.freeze(['solicitarCodigoAluno', 'autenticarAlunoCodigo']);
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
  obterPixPedido: 0,
  meuDesempenho: 0,
  paginasDesempenho: 0,
  lembrarAcessoAluno: 0,
  // A chave assinada de 5 dias faz o papel da sessão para o limite de pedidos.
  retomarSessaoAluno: 0,
  minhasConquistas: 0,
  meusCertificados: 0
});

// Operações só de leitura: repetir não duplica pedido, pagamento, código nem e-mail.
const RETRY_METHODS = Object.freeze([
  'getCatalogoGrupo', 'getOpcoesLiteratura', 'validarCompeticaoSerie', 'verificarInscricaoExistente',
  'verificarCarrinhoAluno', 'listarPedidosAluno', 'meuDesempenho', 'paginasDesempenho',
  'minhasConquistas', 'retomarSessaoAluno', 'meusCertificados'
]);
const RETRY_WAITS_MS = Object.freeze([800, 2000]);
// Texto que o Apps Script devolve quando a planilha recusa o acesso (erro interno, não regra de negócio).
const TRANSIENT_ERROR = 'Falha na operação. Tente novamente em instantes.';
// O catálogo é público e igual para todos: fica na memória deste Worker por 60 s e, enquanto uma busca
// está em andamento, as chamadas iguais esperam por ela em vez de ir de novo ao Apps Script.
// (No teste de carga de 18/11/2026, acima de 100 chamadas simultâneas a planilha recusava o acesso.)
const CATALOG_MEMO_MS = 60000;
const catalogMemo = new Map();
const catalogPending = new Map();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function callBackend(url, body, canRetry) {
  for (let attempt = 0; ; attempt++) {
    const last = !canRetry || attempt >= RETRY_WAITS_MS.length;
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body,
        redirect: 'follow'
      });
      if (!upstream.ok) throw new Error('Backend indisponível');
      const result = await upstream.json();
      if (!result || typeof result.ok !== 'boolean') throw new Error('Resposta inválida');
      if (!last && result.ok === false && result.error === TRANSIENT_ERROR) { await sleep(RETRY_WAITS_MS[attempt]); continue; }
      return result;
    } catch (error) {
      if (last) throw error;
      await sleep(RETRY_WAITS_MS[attempt]);
    }
  }
}

async function catalogoComMemo(grupo, buscar) {
  const chave = String(grupo ?? '').trim().toUpperCase();
  const pronto = catalogMemo.get(chave);
  if (pronto && pronto.expira > Date.now()) return pronto.result;
  let pendente = catalogPending.get(chave);
  if (!pendente) {
    pendente = buscar().then(result => {
      if (result.ok) catalogMemo.set(chave, { result, expira: Date.now() + CATALOG_MEMO_MS });
      return result;
    }).finally(() => catalogPending.delete(chave));
    catalogPending.set(chave, pendente);
  }
  return pendente;
}

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
// ---------- ATLAS como base dos dados do aluno (21/11/2026) ----------
// Depois do login (código ou acesso lembrado), os dados que o ATLAS tem do aluno prevalecem sobre os da
// planilha, e a resposta leva uma "prova" (HMAC) que liga a sessão à matrícula. Na confirmação de dados,
// a prova volta dentro dos dados: o Worker grava no ATLAS primeiro e depois na planilha do Apps Script.
// Sem ATLAS_API_URL + PORTAL_ATLAS_SECRET (segredo, no painel da Cloudflare), tudo segue como antes.
const ATLAS_METODOS_LOGIN = Object.freeze(['autenticarAlunoCodigo', 'retomarSessaoAluno']);
const ATLAS_CAMPOS = Object.freeze(['nome', 'serie', 'segmento', 'dataNascimento', 'cpf', 'emailPessoal', 'whatsappAluno',
  'responsavelNome', 'responsavelVinculo', 'responsavelWhatsapp', 'contatosConfirmadosAno', 'contatosConfirmadosNesteAno', 'anoAtual']);
const ATLAS_ERRO_SALVAR = 'Não foi possível salvar os dados agora. Tente de novo em instantes.';
function atlasConfigurado(env) {
  return typeof env.ATLAS_API_URL === 'string' && /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(env.ATLAS_API_URL) &&
    typeof env.PORTAL_ATLAS_SECRET === 'string' && env.PORTAL_ATLAS_SECRET.length >= 32;
}
async function hmacHex(secret, text) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text))), b => b.toString(16).padStart(2, '0')).join('');
}
function iguaisSemVazar(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const provaAtlas = (env, sessao, ra) => hmacHex(env.PORTAL_ATLAS_SECRET, 'portal-prova:' + sessao + ':' + ra);
async function chamarAtlas(env, rota, body) {
  const r = await fetch(env.ATLAS_API_URL + rota, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.PORTAL_ATLAS_SECRET },
    body: JSON.stringify(body)
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function completarComAtlas(env, result) {
  if (!atlasConfigurado(env) || !result || !result.ok || !result.data || typeof result.data !== 'object' || result.data.status !== 'OK' ||
      typeof result.data.sessao !== 'string' || !result.data.aluno || typeof result.data.aluno !== 'object') return result;
  const ra = String(result.data.aluno.matricula ?? '');
  if (!/^\d{1,15}$/.test(ra)) return result;
  const aluno = { ...result.data.aluno };
  try {
    const r = await chamarAtlas(env, '/api/portal/aluno', { ra });
    if (r.status === 200 && r.data && r.data.ok && r.data.aluno) {
      for (const c of ATLAS_CAMPOS) aluno[c] = r.data.aluno[c];
      aluno.cpfPendente = !aluno.cpf;
      aluno.atlas = true;
    }
  } catch {}
  aluno.atlasProva = await provaAtlas(env, result.data.sessao, ra);
  return { ...result, data: { ...result.data, aluno } };
}
/* Devolve os argumentos sem a prova (que a planilha não conhece) e, se algo impedir a gravação, a mensagem. */
async function confirmarNoAtlas(env, args) {
  const dados = args[1];
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return { args };
  const { atlas: prova, ...resto } = dados;
  const limpos = [args[0], resto];
  if (!atlasConfigurado(env) || prova === undefined) return { args: limpos };
  const ra = String(prova && prova.ra ? prova.ra : ''), assinatura = String(prova && prova.prova ? prova.prova : '');
  if (typeof args[0] !== 'string' || !/^\d{1,15}$/.test(ra) || !iguaisSemVazar(await provaAtlas(env, args[0], ra), assinatura)) {
    return { args: limpos, erro: 'Sessão inválida. Saia e entre de novo para confirmar os dados.' };
  }
  try {
    const r = await chamarAtlas(env, '/api/portal/aluno/confirmar', { ra, dados: resto });
    if (r.status === 404) return { args: limpos };   // não está na lista do ATLAS: segue só na planilha
    if (r.status === 400 && r.data && typeof r.data.error === 'string') return { args: limpos, erro: r.data.error };
    if (r.status !== 200 || !r.data || !r.data.ok) return { args: limpos, erro: ATLAS_ERRO_SALVAR };
  } catch {
    return { args: limpos, erro: ATLAS_ERRO_SALVAR };
  }
  return { args: limpos };
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
      if (LOGIN_METHODS.includes(parsed.method)) {
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
      if (LOGIN_METHODS.includes(parsed.method)) {
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
      let args = parsed.args;
      if (parsed.method === 'confirmarCadastroAluno') {
        const c = await confirmarNoAtlas(env, args);
        if (c.erro) return reply({ ok: false, error: c.erro }, 200, origin);
        args = c.args;
      }
      const body = JSON.stringify({ method: parsed.method, args, secret });
      const result = parsed.method === 'getCatalogoGrupo'
        ? await catalogoComMemo(parsed.args[0], () => callBackend(target.href, body, true))
        : await callBackend(target.href, body, RETRY_METHODS.includes(parsed.method));
      let safeResult = parsed.method === 'solicitarAlteracaoCadastral' ? sanitizeCorrectionResult(result) : result;
      if (ATLAS_METODOS_LOGIN.includes(parsed.method)) safeResult = await completarComAtlas(env, safeResult);
      return reply(safeResult, 200, origin);
    } catch {
      return reply({ ok: false, error: 'A conexão falhou. Verifique o estado antes de repetir uma operação.' }, 502, origin);
    }
  }
};
