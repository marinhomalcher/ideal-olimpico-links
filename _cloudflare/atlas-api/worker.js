// ATLAS — servidor (Cloudflare Worker).
// Administração: login "Entrar com Google", liberado SOMENTE para o e-mail em ADMIN_EMAIL.
// Professores: login por código no e-mail institucional (próxima etapa; rotas ainda fechadas).
// Nenhum segredo neste arquivo: o token de sessão é aleatório e só o hash dele fica no banco.
const ALLOWED_ORIGINS = Object.freeze(['https://idealolimpico.com.br', 'https://www.idealolimpico.com.br']);
const DISCIPLINAS = Object.freeze(['Artes', 'Biologia', 'Filosofia', 'Física', 'Geografia', 'História',
  'Inglês', 'Literatura', 'Matemática', 'Português', 'Química', 'Sociologia']);
const EMAIL_INSTITUCIONAL = /^[a-z0-9._-]+@([a-z0-9-]+\.)*grupoideal\.com\.br$/;
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = Object.freeze(['accounts.google.com', 'https://accounts.google.com']);
const SESSAO_ADM_HORAS = 8;
const MAX_BODY_BYTES = 64 * 1024;

let googleKeysCache = { keys: null, expires: 0 };

function reply(body, status, origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Max-Age'] = '600';
  }
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- utilidades ----------
function b64urlToBytes(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function isoDaqui(horas) {
  return new Date(Date.now() + horas * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function agoraIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

async function readJson(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Formato inválido.');
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Dados grandes demais.');
  let data;
  try { data = JSON.parse(text); } catch { throw new HttpError(400, 'Dados inválidos.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Dados inválidos.');
  return data;
}

// ---------- login Google (verificação do ID token) ----------
async function googleKeys(forceRefresh = false) {
  if (!forceRefresh && googleKeysCache.keys && Date.now() < googleKeysCache.expires) return googleKeysCache.keys;
  const response = await fetch(GOOGLE_CERTS_URL);
  if (!response.ok) throw new HttpError(503, 'Não foi possível confirmar o login com o Google.');
  const data = await response.json();
  const maxAge = Number((response.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  googleKeysCache = { keys: Array.isArray(data.keys) ? data.keys : [], expires: Date.now() + Math.min(maxAge, 86400) * 1000 };
  return googleKeysCache.keys;
}

async function verifyGoogleIdToken(token, env) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw new HttpError(401, 'Login inválido.');
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch { throw new HttpError(401, 'Login inválido.'); }
  if (header.alg !== 'RS256' || !header.kid) throw new HttpError(401, 'Login inválido.');
  let jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true)).find(k => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'Login inválido.');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!valid) throw new HttpError(401, 'Login inválido.');
  const now = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.includes(payload.iss) || payload.aud !== env.GOOGLE_CLIENT_ID ||
      typeof payload.exp !== 'number' || payload.exp < now - 60 ||
      (typeof payload.iat === 'number' && payload.iat > now + 300)) {
    throw new HttpError(401, 'Login inválido ou expirado. Entre novamente.');
  }
  if (payload.email_verified !== true || typeof payload.email !== 'string') throw new HttpError(403, 'Conta Google sem e-mail confirmado.');
  return payload;
}

// ---------- sessões ----------
async function criarSessao(env, tipo, email, usuarioId, horas) {
  const token = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
  const expira = isoDaqui(horas);
  await env.DB.prepare('DELETE FROM sessoes WHERE expira_em < ?').bind(agoraIso()).run();
  await env.DB.prepare('INSERT INTO sessoes (token_hash, tipo, email, usuario_id, expira_em) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), tipo, email, usuarioId, expira).run();
  return { token, expira_em: expira };
}

async function sessaoAtual(request, env, tipo) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token.length > 200) throw new HttpError(401, 'Faça login para continuar.');
  const row = await env.DB.prepare('SELECT token_hash, tipo, email, usuario_id, expira_em FROM sessoes WHERE token_hash = ?')
    .bind(await sha256Hex(token)).first();
  if (!row || row.tipo !== tipo || row.expira_em < agoraIso()) throw new HttpError(401, 'Sessão expirada. Faça login novamente.');
  if (tipo === 'adm' && row.email.toLowerCase() !== String(env.ADMIN_EMAIL || '').toLowerCase()) {
    throw new HttpError(403, 'Acesso restrito ao administrador.');
  }
  return row;
}

async function registrar(env, acao, detalhe, usuarioId = null) {
  await env.DB.prepare('INSERT INTO eventos (usuario_id, acao, detalhe) VALUES (?, ?, ?)')
    .bind(usuarioId, acao, JSON.stringify(detalhe)).run();
}

// ---------- validações de cadastro ----------
function limparNome(value) {
  const nome = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (nome.length < 2 || nome.length > 120) throw new HttpError(400, 'Informe o nome do professor (2 a 120 letras).');
  return nome;
}
function limparEmail(value) {
  let email = String(value ?? '').trim().toLowerCase();
  if (email && !email.includes('@')) email += '@grupoideal.com.br';
  if (!EMAIL_INSTITUCIONAL.test(email) || email.length > 120) throw new HttpError(400, 'Use um e-mail institucional do Grupo Ideal.');
  return email;
}
function limparDisciplina(value) {
  if (!DISCIPLINAS.includes(value)) throw new HttpError(400, 'Escolha uma disciplina válida.');
  return value;
}

async function listarProfessores(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, nome, email, disciplina, papel, ativo FROM usuarios WHERE papel IN ('professor','supervisor') ORDER BY nome COLLATE NOCASE"
  ).all();
  return results.map(r => ({ ...r, ativo: r.ativo === 1 }));
}

async function emailEmUso(env, email, exceptId = null) {
  const row = await env.DB.prepare('SELECT id FROM usuarios WHERE email = ?').bind(email).first();
  return row && row.id !== exceptId;
}

// ---------- rotas da Administração ----------
async function rotasAdm(request, env, path) {
  if (path === '/api/adm/login' && request.method === 'POST') {
    if (!env.GOOGLE_CLIENT_ID || !env.ADMIN_EMAIL) throw new HttpError(503, 'Login do administrador não configurado.');
    const body = await readJson(request);
    const payload = await verifyGoogleIdToken(body.credential, env);
    if (payload.email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) {
      await registrar(env, 'adm_login_recusado', { email: payload.email });
      throw new HttpError(403, 'Esta conta Google não tem acesso à Administração.');
    }
    const sessao = await criarSessao(env, 'adm', payload.email.toLowerCase(), null, SESSAO_ADM_HORAS);
    await registrar(env, 'adm_login', { email: payload.email.toLowerCase() });
    return { ok: true, ...sessao, email: payload.email.toLowerCase(), nome: payload.name || '' };
  }

  const sessao = await sessaoAtual(request, env, 'adm');

  if (path === '/api/adm/sessao' && request.method === 'GET') {
    return { ok: true, email: sessao.email, expira_em: sessao.expira_em };
  }
  if (path === '/api/adm/sair' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM sessoes WHERE token_hash = ?').bind(sessao.token_hash).run();
    return { ok: true };
  }
  if (path === '/api/adm/professores' && request.method === 'GET') {
    return { ok: true, disciplinas: DISCIPLINAS, professores: await listarProfessores(env) };
  }
  if (path === '/api/adm/professores' && request.method === 'POST') {
    const body = await readJson(request);
    const nome = limparNome(body.nome), email = limparEmail(body.email), disciplina = limparDisciplina(body.disciplina);
    if (await emailEmUso(env, email)) throw new HttpError(409, 'Este e-mail já está cadastrado.');
    const result = await env.DB.prepare("INSERT INTO usuarios (nome, email, disciplina, papel, ativo) VALUES (?, ?, ?, 'professor', 1)")
      .bind(nome, email, disciplina).run();
    const id = result.meta?.last_row_id;
    await registrar(env, 'professor_cadastrado', { adm: sessao.email, id, nome, email, disciplina });
    return { ok: true, id, professores: await listarProfessores(env) };
  }
  const match = path.match(/^\/api\/adm\/professores\/(\d+)$/);
  if (match && request.method === 'PUT') {
    const id = Number(match[1]);
    const atual = await env.DB.prepare("SELECT id, nome, email, disciplina, papel, ativo FROM usuarios WHERE id = ? AND papel IN ('professor','supervisor')")
      .bind(id).first();
    if (!atual) throw new HttpError(404, 'Professor não encontrado.');
    const body = await readJson(request);
    const nome = body.nome !== undefined ? limparNome(body.nome) : atual.nome;
    const email = body.email !== undefined ? limparEmail(body.email) : atual.email;
    const disciplina = body.disciplina !== undefined ? limparDisciplina(body.disciplina) : atual.disciplina;
    const ativo = body.ativo !== undefined ? (body.ativo ? 1 : 0) : atual.ativo;
    if (email !== atual.email && await emailEmUso(env, email, id)) throw new HttpError(409, 'Este e-mail já está cadastrado.');
    // Quem muda de disciplina ou é desativado deixa de ser supervisor.
    const papel = (disciplina !== atual.disciplina || !ativo) ? 'professor' : atual.papel;
    await env.DB.prepare('UPDATE usuarios SET nome = ?, email = ?, disciplina = ?, ativo = ?, papel = ? WHERE id = ?')
      .bind(nome, email, disciplina, ativo, papel, id).run();
    await registrar(env, 'professor_alterado', { adm: sessao.email, id, antes: atual, depois: { nome, email, disciplina, ativo, papel } });
    return { ok: true, professores: await listarProfessores(env) };
  }
  if (path === '/api/adm/supervisor' && request.method === 'POST') {
    const body = await readJson(request);
    const disciplina = limparDisciplina(body.disciplina);
    const usuarioId = body.usuario_id === null || body.usuario_id === '' ? null : Number(body.usuario_id);
    if (usuarioId !== null) {
      const prof = await env.DB.prepare("SELECT id, disciplina, ativo FROM usuarios WHERE id = ? AND papel IN ('professor','supervisor')")
        .bind(usuarioId).first();
      if (!prof) throw new HttpError(404, 'Professor não encontrado.');
      if (prof.disciplina !== disciplina) throw new HttpError(400, 'O supervisor precisa ser professor desta disciplina.');
      if (prof.ativo !== 1) throw new HttpError(400, 'Ative o professor antes de torná-lo supervisor.');
    }
    // Um supervisor por disciplina: o anterior volta a ser professor.
    await env.DB.batch([
      env.DB.prepare("UPDATE usuarios SET papel = 'professor' WHERE papel = 'supervisor' AND disciplina = ?").bind(disciplina),
      ...(usuarioId !== null ? [env.DB.prepare("UPDATE usuarios SET papel = 'supervisor' WHERE id = ?").bind(usuarioId)] : [])
    ]);
    await registrar(env, 'supervisor_definido', { adm: sessao.email, disciplina, usuario_id: usuarioId });
    return { ok: true, professores: await listarProfessores(env) };
  }
  throw new HttpError(404, 'Rota indisponível.');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return reply(null, 204, origin);
    try {
      if (url.pathname === '/api/saude' && request.method === 'GET') {
        const row = await env.DB.prepare("SELECT valor FROM meta WHERE chave = 'schema_versao'").first();
        return reply({ ok: true, modo: 'teste', banco: 'conectado', schema: row ? row.valor : null }, 200, origin);
      }
      if (url.pathname.startsWith('/api/adm/')) {
        if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(403, 'Origem não permitida.');
        return reply(await rotasAdm(request, env, url.pathname), 200, origin);
      }
      if (url.pathname.startsWith('/api/')) {
        throw new HttpError(503, 'Recurso ainda não liberado (aguardando login dos professores).');
      }
      throw new HttpError(404, 'Rota indisponível.');
    } catch (error) {
      if (error instanceof HttpError) return reply({ ok: false, error: error.message }, error.status, origin);
      return reply({ ok: false, error: 'Erro interno. Tente novamente.' }, 500, origin);
    }
  }
};
