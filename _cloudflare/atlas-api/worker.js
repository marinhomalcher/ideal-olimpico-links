// ATLAS — servidor (Cloudflare Worker).
// Administração: login "Entrar com Google", liberado SOMENTE para o e-mail em ADMIN_EMAIL.
// Professores e Supervisores: login por código no e-mail institucional.
// Questões: enviadas pelo Professor e analisadas pelo Supervisor da disciplina (tabelas itens/item_versoes/revisoes).
// Nenhum segredo neste arquivo: o token de sessão é aleatório e só o hash dele fica no banco.
const ALLOWED_ORIGINS = Object.freeze(['https://idealolimpico.com.br', 'https://www.idealolimpico.com.br']);
const DISCIPLINAS = Object.freeze(['Artes', 'Biologia', 'Filosofia', 'Física', 'Geografia', 'História',
  'Inglês', 'Literatura', 'Matemática', 'Português', 'Química', 'Sociologia']);
// Regra da escola: somente @grupoideal.com.br (sem subdomínios, sem exceções).
const EMAIL_INSTITUCIONAL = /^[a-z0-9._-]+@grupoideal\.com\.br$/;
const EMAIL_LOGIN_ATLAS = /^[a-z0-9._+-]+@grupoideal\.com\.br$/;
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
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Max-Age'] = '600';
  }
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

// Resposta JSON com as imagens trocadas por links assinados.
async function replyAssinado(env, body, status, origin) {
  const resp = reply(body, status, origin);
  const texto = await assinarImagensNoTexto(env, await resp.text());
  return new Response(texto, { status: resp.status, headers: resp.headers });
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- férias: ATLAS fechado para professores, supervisores e digitadores ----------
// Julho inteiro e de 15 de dezembro a 31 de janeiro (horário de Brasília). Só a Administração entra.
function hojeSP(env) {
  const teste = env && env.ATLAS_HOJE_TESTE;   // só para testes automáticos (AAAA-MM-DD)
  if (teste && /^\d{4}-\d{2}-\d{2}$/.test(teste)) return teste;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
function emFerias(env) {
  const [, m, d] = hojeSP(env).split('-').map(Number);
  return m === 7 || m === 1 || (m === 12 && d >= 15);
}
function voltaDasFerias(env) {
  const [a, m] = hojeSP(env).split('-').map(Number);
  return m === 7 ? '1º de agosto' : '1º de fevereiro';
}
function bloquearFerias(env) {
  if (!emFerias(env)) return;
  const e = new HttpError(423, 'FÉRIAS. O ATLAS está fechado para professores e supervisores e reabre em ' + voltaDasFerias(env) + '.');
  e.extra = { ferias: true, reabre: voltaDasFerias(env) };
  throw e;
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

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Formato inválido.');
  }
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Dados grandes demais.');
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
  if (!EMAIL_INSTITUCIONAL.test(email) || email.length > 120) throw new HttpError(400, 'Use um e-mail @grupoideal.com.br.');
  return email;
}
function limparDisciplina(value) {
  if (!DISCIPLINAS.includes(value)) throw new HttpError(400, 'Escolha uma disciplina válida.');
  return value;
}

async function listarProfessores(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, nome, email, disciplina, papel, ativo, digitador, acesso_ate FROM usuarios WHERE papel IN ('professor','supervisor') ORDER BY nome COLLATE NOCASE"
  ).all();
  return results.map(r => ({ ...r, ativo: r.ativo === 1, digitador: r.digitador === 1 }));
}
function limparAcessoAte(value) {
  if (value === undefined || value === null || value === '') return null;
  const v = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) throw new HttpError(400, 'Data de término do acesso inválida.');
  return v;
}

async function emailEmUso(env, email, exceptId = null) {
  const row = await env.DB.prepare('SELECT id FROM usuarios WHERE email = ?').bind(email).first();
  return row && row.id !== exceptId;
}


async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join('');
}
function secureEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function gerarCodigoAcesso() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return String(value[0] % 1000000).padStart(6, '0');
}
async function consultarLimiteLogin(env, key, windowSeconds, maxRequests) {
  const now = Math.floor(Date.now() / 1000);
  const sql = 'INSERT INTO login_rate_limits (chave, janela_inicio, quantidade) VALUES (?, ?, 1) ' +
    'ON CONFLICT(chave) DO UPDATE SET ' +
    'janela_inicio = CASE WHEN login_rate_limits.janela_inicio + ? <= excluded.janela_inicio ' +
    'THEN excluded.janela_inicio ELSE login_rate_limits.janela_inicio END, ' +
    'quantidade = CASE WHEN login_rate_limits.janela_inicio + ? <= excluded.janela_inicio ' +
    'THEN 1 ELSE login_rate_limits.quantidade + 1 END RETURNING quantidade, janela_inicio';
  const row = await env.DB.prepare(sql).bind(key, now, windowSeconds, windowSeconds).first();
  await env.DB.prepare('DELETE FROM login_rate_limits WHERE janela_inicio < ?')
    .bind(now - 172800).run();
  return { permitido: Number(row?.quantidade || 0) <= maxRequests, aguardeMinutos: Math.max(1, Math.ceil((Number(row?.janela_inicio || now) + windowSeconds - now) / 60)) };
}
async function contarTentativaLogin(env, key, windowSeconds, maxRequests) {
  return (await consultarLimiteLogin(env, key, windowSeconds, maxRequests)).permitido;
}
// ---------- envio de e-mail pela Microsoft (Graph), como olimpiadas@grupoideal.com.br ----------
// Configuração: MS_TENANT_ID, MS_CLIENT_ID e MS_REMETENTE em [vars]; MS_CLIENT_SECRET como segredo no painel.
// O aplicativo só tem "Application Mail.Send" restrito à caixa do remetente (RBAC for Applications no Exchange).
// Sem MS_CLIENT_SECRET, ou se a Microsoft recusar, usa o enviador antigo (Apps Script) como reserva.
let tokenMicrosoft = null; // { valor, expira } — reaproveitado entre pedidos na mesma instância
function microsoftConfigurado(env) {
  return !!(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET && env.MS_REMETENTE);
}
async function tokenDaMicrosoft(env) {
  if (tokenMicrosoft && tokenMicrosoft.cliente === env.MS_CLIENT_ID && tokenMicrosoft.expira > Date.now() + 60000) return tokenMicrosoft.valor;
  const resp = await fetch('https://login.microsoftonline.com/' + encodeURIComponent(env.MS_TENANT_ID) + '/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString()
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok || !dados.access_token) throw new Error('token Microsoft recusado (' + resp.status + ' ' + (dados.error || '') + ')');
  tokenMicrosoft = { valor: dados.access_token, cliente: env.MS_CLIENT_ID, expira: Date.now() + Number(dados.expires_in || 3000) * 1000 };
  return tokenMicrosoft.valor;
}
async function enviarPelaMicrosoft(env, para, assunto, texto) {
  const token = await tokenDaMicrosoft(env);
  const resp = await fetch('https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(env.MS_REMETENTE) + '/sendMail', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: { subject: assunto, body: { contentType: 'Text', content: texto }, toRecipients: [{ emailAddress: { address: para } }] },
      saveToSentItems: true
    })
  });
  if (resp.status !== 202) {
    const erro = await resp.json().catch(() => ({}));
    if (resp.status === 401) tokenMicrosoft = null;
    throw new Error('envio Microsoft recusado (' + resp.status + ' ' + (erro?.error?.code || '') + ')');
  }
}
// Envio único usado por códigos e avisos. Devolve true se algum caminho aceitou.
async function enviarEmail(env, para, assunto, texto, reservaAppsScript) {
  if (microsoftConfigurado(env)) {
    try { await enviarPelaMicrosoft(env, para, assunto, texto); return true; }
    catch (error) { console.warn('ATLAS e-mail pela Microsoft falhou; tentando o enviador reserva:', error && error.message); }
  }
  return reservaAppsScript ? await reservaAppsScript() : false;
}

async function enviarCodigoAcesso(env, email, codigo) {
  const assunto = 'Seu código de acesso ao ATLAS';
  const texto = 'Seu código para entrar no ATLAS é: ' + codigo +
    '\n\nEle expira em 10 minutos. Se você não solicitou este código, ignore esta mensagem.\n\n' + LINK_ATLAS;
  const ok = await enviarEmail(env, email, assunto, texto, async () => {
    if (!env.ATLAS_MAILER_URL) return false;
    try {
      const response = await fetch(env.ATLAS_MAILER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segredo: env.ATLAS_MAILER_SECRET, email, codigo })
      });
      const result = await response.json().catch(() => null);
      return response.ok && result?.ok === true;
    } catch { return false; }
  });
  if (!ok) throw new HttpError(502, 'Não foi possível enviar o código. Tente novamente mais tarde.');
}
async function solicitarCodigoAcesso(request, env) {
  if (!env.ATLAS_MAILER_SECRET || (!env.ATLAS_MAILER_URL && !microsoftConfigurado(env))) {
    throw new HttpError(503, 'O envio de códigos ainda não está configurado.');
  }
  bloquearFerias(env);
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  if (email.length > 120 || !EMAIL_LOGIN_ATLAS.test(email)) {
    throw new HttpError(400, 'Informe um e-mail institucional válido.');
  }

  const emailKey = await hmacHex(env.ATLAS_MAILER_SECRET, 'email:' + email);
  const ip = request.headers.get('CF-Connecting-IP') || 'indisponivel';
  const ipKey = await hmacHex(env.ATLAS_MAILER_SECRET, 'ip:' + ip);
  const limiteEmail = await consultarLimiteLogin(env, emailKey, 3600, 10);
  const limiteIp = await consultarLimiteLogin(env, ipKey, 3600, 120);
  if (!limiteEmail.permitido || !limiteIp.permitido) {
    const minutos = Math.max(limiteEmail.permitido ? 0 : limiteEmail.aguardeMinutos,
      limiteIp.permitido ? 0 : limiteIp.aguardeMinutos);
    throw new HttpError(429, 'Muitas solicitações de código. Aguarde ' + minutos +
      (minutos === 1 ? ' minuto' : ' minutos') + ' e tente novamente.');
  }

  // O intervalo vale também para endereços não cadastrados, evitando revelar cadastros.
  const cooldownKey = await hmacHex(env.ATLAS_MAILER_SECRET, 'cooldown:' + email);
  const intervalo = await consultarLimiteLogin(env, cooldownKey, 60, 1);
  if (!intervalo.permitido) {
    throw new HttpError(429, 'Aguarde ' + intervalo.aguardeMinutos +
      (intervalo.aguardeMinutos === 1 ? ' minuto' : ' minutos') + ' antes de pedir outro código.');
  }

  const user = await env.DB.prepare(
    "SELECT id, nome, email, disciplina, papel FROM usuarios " +
    "WHERE email = ? COLLATE NOCASE AND ativo = 1 AND papel IN ('professor','supervisor') AND (acesso_ate IS NULL OR acesso_ate >= date('now','-3 hours'))"
  ).bind(email).first();
  if (!user) return { ok: true };

  const codigo = gerarCodigoAcesso();
  const codigoHash = await hmacHex(env.ATLAS_MAILER_SECRET, 'codigo:' + user.id + ':' + codigo);
  const expira = Math.floor(Date.now() / 1000) + 600;
  await env.DB.prepare(
    'INSERT INTO login_codigos (usuario_id, codigo_hash, expira_em, tentativas) VALUES (?, ?, ?, 0) ' +
    'ON CONFLICT(usuario_id) DO UPDATE SET codigo_hash = excluded.codigo_hash, ' +
    'expira_em = excluded.expira_em, tentativas = 0'
  ).bind(user.id, codigoHash, expira).run();

  try {
    await enviarCodigoAcesso(env, email, codigo);
  } catch (error) {
    await env.DB.prepare('DELETE FROM login_codigos WHERE usuario_id = ?').bind(user.id).run();
    throw error;
  }
  return { ok: true };
}
async function verificarCodigoAcesso(request, env) {
  if (!env.ATLAS_MAILER_SECRET) throw new HttpError(503, 'O login ainda não está configurado.');
  bloquearFerias(env);
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  const codigo = body.codigo;
  if (email.length > 120 || !EMAIL_LOGIN_ATLAS.test(email) ||
      typeof codigo !== 'string' || !/^\d{6}$/.test(codigo)) {
    throw new HttpError(400, 'E-mail ou código inválido.');
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'indisponivel';
  const ipKey = await hmacHex(env.ATLAS_MAILER_SECRET || '', 'verify-ip:' + ip);
  const emailKey = await hmacHex(env.ATLAS_MAILER_SECRET || '', 'verify-email:' + email);
  const permitIp = await contarTentativaLogin(env, ipKey, 3600, 150);
  const permitEmail = await contarTentativaLogin(env, emailKey, 3600, 10);
  if (!permitIp || !permitEmail) throw new HttpError(429, 'Muitas tentativas. Aguarde e tente novamente.');

  const user = await env.DB.prepare(
    "SELECT id, nome, email, disciplina, CASE WHEN digitador = 1 THEN 'digitador' ELSE papel END AS papel FROM usuarios " +
    "WHERE email = ? COLLATE NOCASE AND ativo = 1 AND papel IN ('professor','supervisor') AND (acesso_ate IS NULL OR acesso_ate >= date('now','-3 hours'))"
  ).bind(email).first();
  if (!user) throw new HttpError(401, 'Código inválido ou expirado.');
  // O perfil NÃO é escolhido pelo navegador: a área de destino vem do papel no banco
  // (e só é revelada depois de o código ser conferido).

  const agora = Math.floor(Date.now() / 1000);
  const registro = await env.DB.prepare(
    'UPDATE login_codigos SET tentativas = tentativas + 1 ' +
    'WHERE usuario_id = ? AND expira_em > ? AND tentativas < 5 ' +
    'RETURNING codigo_hash, tentativas'
  ).bind(user.id, agora).first();
  if (!registro) throw new HttpError(401, 'Código inválido ou expirado.');

  const codigoHash = await hmacHex(env.ATLAS_MAILER_SECRET || '', 'codigo:' + user.id + ':' + codigo);
  if (!secureEqual(registro.codigo_hash, codigoHash)) {
    if (registro.tentativas >= 5) {
      await env.DB.prepare('DELETE FROM login_codigos WHERE usuario_id = ?').bind(user.id).run();
    }
    throw new HttpError(401, 'Código inválido ou expirado.');
  }

  const consumido = await env.DB.prepare(
    'DELETE FROM login_codigos WHERE usuario_id = ? AND codigo_hash = ? AND expira_em > ? ' +
    'RETURNING usuario_id'
  ).bind(user.id, codigoHash, agora).first();
  if (!consumido) throw new HttpError(401, 'Código inválido ou expirado.');

  const lembrar = body.lembrar === true;
  const sessao = await criarSessao(env, 'usuario', user.email.toLowerCase(), user.id, lembrar ? 24 * 7 : 8);
  await registrar(env, 'login_codigo_confirmado', { papel: user.papel }, user.id);
  return {
    ok: true,
    ...sessao,
    usuario: { id: user.id, nome: user.nome, email: user.email, disciplina: user.disciplina, papel: user.papel }
  };
}

// ---------- questões (itens) ----------
// Código oficial: letra da disciplina + 7 dígitos aleatórios (sem zero à esquerda, nunca todos iguais).
const LETRA_DISCIPLINA = Object.freeze({
  'Artes': 'A', 'Biologia': 'B', 'Filosofia': 'F', 'Física': 'Y', 'Geografia': 'G', 'História': 'H',
  'Inglês': 'I', 'Literatura': 'L', 'Matemática': 'M', 'Português': 'P', 'Química': 'Q', 'Sociologia': 'S'
});
const MAX_ITEM_BYTES = 1500 * 1024;          // limite por questão (o D1 aceita até 2 MB por linha)
// Referência no padrão ABNT/ENEM: "Acesso em: ..." sempre na linha de baixo.
function formatarReferencia(v) {
  return String(v || '').replace(/\r\n?/g, '\n').replace(/[ \t\u00a0]*\n?[ \t\u00a0]*(Acesso em\s*:)/gi, '\n$1')
    .replace(/[ \t\u00a0]+$/gm, '').replace(/^\n+/, '').trim();
}
const CAMPOS_TEXTO = Object.freeze(['etapa', 'ano', 'origem', 'fonte', 'dificuldade', 'assunto', 'subtema',
  'nivel4', 'nivel5', 'bloom', 'referencia', 'gabarito']);
const CAMPOS_RICOS = Object.freeze(['texto-base', 'comando', 'alt-a', 'alt-b', 'alt-c', 'alt-d', 'alt-e', 'resolucao']);
function validarRico(nome, v) {
  if (typeof v !== 'string') throw new HttpError(400, 'Campo inválido: ' + nome + '.');
  if (HTML_PROIBIDO.test(v)) throw new HttpError(400, 'O campo "' + nome + '" contém conteúdo não permitido.');
  for (const img of v.match(/<img\b[^>]*>/gi) || []) {
    const src = (img.match(/\ssrc\s*=\s*"([^"]*)"/i) || [])[1] || '';
    if (!/^data:image\/(png|jpeg|webp);base64,/i.test(src) && !/^atlas:img\/[0-9a-f]{32}$/.test(src)) {
      throw new HttpError(400, 'O campo "' + nome + '" tem uma imagem de origem não permitida. Cole a imagem de novo.');
    }
  }
  return v;
}
// Textos de apoio além do primeiro (Texto II, III, IV): cada um com texto (rico) e referência.
const MAX_TEXTOS_EXTRAS = 3;
function limparTextosExtras(lista) {
  if (lista === undefined || lista === null) return [];
  if (!Array.isArray(lista)) throw new HttpError(400, 'Textos de apoio inválidos.');
  const out = [];
  for (const t of lista) {
    if (!t || typeof t !== 'object') throw new HttpError(400, 'Textos de apoio inválidos.');
    const texto = validarRico('texto ' + (out.length + 2), t.texto === undefined || t.texto === null ? '' : t.texto);
    const ref = t.referencia === undefined || t.referencia === null ? '' : t.referencia;
    if (typeof ref !== 'string' || ref.length > 1000) throw new HttpError(400, 'Referência de texto inválida.');
    const vazio = !texto.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() && !/<img\b/i.test(texto);
    if (vazio && !ref.trim()) continue;
    if (vazio) throw new HttpError(400, 'O texto ' + ['II', 'III', 'IV'][out.length] + ' tem referência mas está vazio.');
    out.push({ texto, referencia: formatarReferencia(ref) });
  }
  if (out.length > MAX_TEXTOS_EXTRAS) throw new HttpError(400, 'Use no máximo 4 textos de apoio por questão.');
  return out;
}
const HTML_PROIBIDO = /<\s*\/?\s*(script|iframe|object|embed|style|link|meta|form|base)\b|\son[a-z]+\s*=|javascript\s*:|vbscript\s*:/i;

function gerarCodigoItem(disciplina) {
  const letra = LETRA_DISCIPLINA[disciplina];
  if (!letra) throw new HttpError(400, 'Disciplina sem letra definida.');
  const buf = new Uint32Array(8);
  for (;;) {
    crypto.getRandomValues(buf);
    let digitos = String(1 + (buf[0] % 9));
    for (let i = 1; i < 7; i++) digitos += String(buf[i] % 10);
    if (!/^(\d)\1{6}$/.test(digitos)) return letra + digitos;
  }
}

function validarDados(input, opcoes = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Dados da questão inválidos.');
  const d = { rich: true };
  for (const campo of CAMPOS_TEXTO) {
    const v = input[campo] === undefined || input[campo] === null ? '' : input[campo];
    if (typeof v !== 'string') throw new HttpError(400, 'Campo inválido: ' + campo + '.');
    const limite = campo === 'referencia' ? 1000 : 300;
    if (v.length > limite) throw new HttpError(400, 'Campo grande demais: ' + campo + '.');
    d[campo] = campo === 'referencia' ? formatarReferencia(v) : v.trim();
  }
  for (const campo of CAMPOS_RICOS) {
    const v = input[campo] === undefined || input[campo] === null ? '' : input[campo];
    if (typeof v !== 'string') throw new HttpError(400, 'Campo inválido: ' + campo + '.');
    if (HTML_PROIBIDO.test(v)) throw new HttpError(400, 'O campo "' + campo + '" contém conteúdo não permitido.');
    for (const img of v.match(/<img\b[^>]*>/gi) || []) {
      const src = (img.match(/\ssrc\s*=\s*"([^"]*)"/i) || [])[1] || '';
      if (!/^data:image\/(png|jpeg|webp);base64,/i.test(src) && !/^atlas:img\/[0-9a-f]{32}$/.test(src)) {
        throw new HttpError(400, 'O campo "' + campo + '" tem uma imagem de origem não permitida. Cole a imagem de novo.');
      }
    }
    d[campo] = v;
  }
  d.textos_extras = limparTextosExtras(input.textos_extras);
  // Fonte (referência) da imagem de cada alternativa — opcional; sai em letra pequena.
  for (const l of 'abcde') {
    const v = input['ref-' + l] === undefined || input['ref-' + l] === null ? '' : input['ref-' + l];
    if (typeof v !== 'string' || v.length > 1000) throw new HttpError(400, 'Fonte da alternativa ' + l.toUpperCase() + ' inválida.');
    d['ref-' + l] = formatarReferencia(v);
  }
  // Formato na prova: 2 colunas (padrão) ou largura total.
  d.layout = input.layout === 'pagina' ? 'pagina' : 'coluna';
  // Tags (palavras-chave): até 12, cada uma com até 40 caracteres, minúsculas, sem repetir.
  const tagsBrutas = input.tags === undefined || input.tags === null ? [] : input.tags;
  if (!Array.isArray(tagsBrutas) && typeof tagsBrutas !== 'string') throw new HttpError(400, 'Tags inválidas.');
  const tags = [];
  for (const t of (Array.isArray(tagsBrutas) ? tagsBrutas : tagsBrutas.split(/[,;\n]/))) {
    if (typeof t !== 'string') throw new HttpError(400, 'Tags inválidas.');
    const n = t.replace(/^#+/, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
    if (!n) continue;
    if (n.length > 40) throw new HttpError(400, 'Cada tag pode ter até 40 caracteres.');
    if (/[<>]/.test(n)) throw new HttpError(400, 'Tag com caractere não permitido.');
    if (!tags.includes(n)) tags.push(n);
  }
  if (tags.length > 12) throw new HttpError(400, 'Use no máximo 12 tags por questão.');
  d.tags = tags;
  const vazio = v => !String(v).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() && !/<img\b/i.test(v);
  if (!['em', 'ef2'].includes(d.etapa)) throw new HttpError(400, 'Escolha a etapa.');
  // 'acervo' = prova antiga da escola, enviada pelo ADM ou pelo digitador (sem fonte conhecida).
  if (!['autoral', 'enem', 'outros', 'acervo'].includes(d.origem)) throw new HttpError(400, 'Escolha a origem da questão.');
  // Questões enviadas pelo ADM ou pelo digitador chegam sem classificação: o Supervisor classifica.
  const semClassificacao = opcoes.importacao === true;
  if (!(semClassificacao && !d.dificuldade) && !['Fácil', 'Média', 'Difícil'].includes(d.dificuldade)) throw new HttpError(400, 'Escolha a dificuldade prevista.');
  if (!(semClassificacao && !d.bloom) && !['Lembrar', 'Compreender', 'Aplicar', 'Analisar', 'Avaliar'].includes(d.bloom)) throw new HttpError(400, 'Escolha o nível cognitivo.');
  if (!semClassificacao && !d.assunto) throw new HttpError(400, 'Escolha o assunto principal.');
  if (!['A', 'B', 'C', 'D', 'E'].includes(d.gabarito)) throw new HttpError(400, 'Escolha o gabarito (A a E).');
  if (vazio(d.comando)) throw new HttpError(400, 'Preencha o comando da questão.');
  for (const l of 'abcde') if (vazio(d['alt-' + l])) throw new HttpError(400, 'Preencha a alternativa ' + l.toUpperCase() + '.');
  d.fonte = d.origem === 'outros' ? d.fonte.toLocaleUpperCase('pt-BR') : '';
  const json = JSON.stringify(d);
  if (new TextEncoder().encode(json).length > MAX_ITEM_BYTES) {
    throw new HttpError(413, 'A questão ficou grande demais (imagens pesadas). Use imagens menores ou recortes.');
  }
  return json;
}

// ---------- imagens no R2 (bucket privado "atlas-imagens", binding IMAGENS) ----------
// No banco a imagem fica como  src="atlas:img/<id>"  (id = 32 hexadecimais aleatórios).
// Nas respostas da API o servidor troca por um link assinado e temporário:
//   https://atlas-api.../img/<id>?e=<expira>&s=<assinatura>
// Ao salvar, o link assinado volta a ser "atlas:img/<id>" (a assinatura prova que o id veio do servidor).
const IMG_VALIDADE_SEG = 24 * 3600;
const MAX_IMAGEM_BYTES = 3 * 1024 * 1024;
const TIPOS_IMAGEM = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const API_PUBLICA = 'https://atlas-api.marinhomalcher.workers.dev';
const RE_IMG_CANONICA = /atlas:img\/([0-9a-f]{32})/g;
const RE_IMG_ASSINADA = /https:\/\/[a-z0-9.-]+(?::\d+)?\/img\/([0-9a-f]{32})\?e=(\d{1,12})(?:&amp;|&)s=([0-9a-f]{64})/g;

function segredoImagens(env) {
  if (!env.ATLAS_MAILER_SECRET) throw new HttpError(503, 'Imagens indisponíveis: configuração ausente.');
  return env.ATLAS_MAILER_SECRET;
}
async function assinaturaImagem(env, id, exp) {
  return hmacHex(segredoImagens(env), 'img:' + id + ':' + exp);
}
async function linkImagem(env, id) {
  // Expiração arredondada à hora: o mesmo link vale para várias leituras (melhor para o cache do navegador).
  const exp = (Math.floor(Date.now() / 1000 / 3600) + 1) * 3600 + IMG_VALIDADE_SEG;
  return API_PUBLICA + '/img/' + id + '?e=' + exp + '&s=' + await assinaturaImagem(env, id, exp);
}
// Troca, em todo o JSON de resposta, "atlas:img/<id>" por links assinados.
async function assinarImagensNoTexto(env, texto) {
  const ids = [...new Set([...texto.matchAll(RE_IMG_CANONICA)].map(m => m[1]))];
  if (!ids.length) return texto;
  const links = new Map();
  for (const id of ids) links.set(id, await linkImagem(env, id));
  return texto.replace(RE_IMG_CANONICA, (_, id) => links.get(id));
}
// Ao salvar: link assinado válido (mesmo vencido) -> forma canônica. Link adulterado é recusado.
async function normalizarImagens(env, texto) {
  const achados = [...String(texto).matchAll(RE_IMG_ASSINADA)];
  if (!achados.length) return texto;
  const trocas = new Map();
  for (const [link, id, exp, sig] of achados) {
    if (trocas.has(link)) continue;
    if (await assinaturaImagem(env, id, exp) !== sig) throw new HttpError(400, 'Imagem com endereço inválido. Cole a imagem de novo.');
    trocas.set(link, 'atlas:img/' + id);
  }
  return String(texto).replace(RE_IMG_ASSINADA, link => trocas.get(link));
}
async function validarDadosComImagens(env, input, opcoes = {}) {
  if (input && typeof input === 'object') {
    const copia = { ...input };
    for (const campo of CAMPOS_RICOS) if (typeof copia[campo] === 'string') copia[campo] = await normalizarImagens(env, copia[campo]);
    if (Array.isArray(copia.textos_extras)) copia.textos_extras = await Promise.all(copia.textos_extras.map(async t => (t && typeof t.texto === 'string') ? { ...t, texto: await normalizarImagens(env, t.texto) } : t));
    return validarDados(copia, opcoes);
  }
  return validarDados(input, opcoes);
}
function classificacaoCompleta(d) {
  return !!(d && d.assunto && d.bloom && d.dificuldade);
}
function idImagemNovo() {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function guardarImagem(env, bytes, tipo, quem) {
  if (!env.IMAGENS) throw new HttpError(503, 'Armazenamento de imagens indisponível.');
  if (!TIPOS_IMAGEM[tipo]) throw new HttpError(415, 'Use imagens PNG, JPG ou WebP.');
  if (!bytes.byteLength) throw new HttpError(400, 'Imagem vazia.');
  if (bytes.byteLength > MAX_IMAGEM_BYTES) throw new HttpError(413, 'Imagem grande demais (máximo de 3 MB).');
  const id = idImagemNovo();
  await env.IMAGENS.put('img/' + id, bytes, { httpMetadata: { contentType: tipo }, customMetadata: { por: String(quem || '') } });
  return id;
}
async function receberImagem(request, env, quem) {
  const tipo = String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const tamanho = Number(request.headers.get('Content-Length') || 0);
  if (tamanho > MAX_IMAGEM_BYTES) throw new HttpError(413, 'Imagem grande demais (máximo de 3 MB).');
  const bytes = new Uint8Array(await request.arrayBuffer());
  const id = await guardarImagem(env, bytes, tipo, quem);
  return { ok: true, id, url: await linkImagem(env, id) };
}
// Entrega pública da imagem, só com link assinado e dentro do prazo.
async function entregarImagem(request, env, url) {
  const m = url.pathname.match(/^\/img\/([0-9a-f]{32})$/);
  const exp = url.searchParams.get('e') || '';
  const sig = url.searchParams.get('s') || '';
  if (!m || !/^\d{1,12}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return new Response('Não encontrada', { status: 404 });
  if (Number(exp) < Date.now() / 1000) return new Response('Link vencido. Recarregue a página.', { status: 403 });
  if (await assinaturaImagem(env, m[1], exp) !== sig) return new Response('Não encontrada', { status: 404 });
  if (!env.IMAGENS) return new Response('Indisponível', { status: 503 });
  const obj = await env.IMAGENS.get('img/' + m[1]);
  if (!obj) return new Response('Não encontrada', { status: 404 });
  return new Response(obj.body, { headers: {
    'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'cross-origin'
  } });
}
// ADM: move as imagens antigas (embutidas como data:) de todas as versões para o R2, aos poucos.
async function migrarImagensAntigas(env, sessao, lote = 15) {
  const { results } = await env.DB.prepare(
    "SELECT item_id, versao, dados FROM item_versoes WHERE dados LIKE '%data:image/%' LIMIT ?"
  ).bind(lote).all();
  let imagens = 0;
  for (const row of results) {
    const dados = JSON.parse(row.dados);
    for (const campo of Object.keys(dados)) {
      if (typeof dados[campo] !== 'string' || !dados[campo].includes('data:image/')) continue;
      const partes = [];
      let resto = dados[campo];
      const re = /data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)/;
      let achado;
      while ((achado = resto.match(re))) {
        const bin = atob(achado[2]);
        const bytes = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
        const id = await guardarImagem(env, bytes, achado[1], 'migracao');
        imagens++;
        partes.push(resto.slice(0, achado.index), 'atlas:img/' + id);
        resto = resto.slice(achado.index + achado[0].length);
      }
      partes.push(resto);
      dados[campo] = partes.join('');
    }
    await env.DB.prepare('UPDATE item_versoes SET dados = ? WHERE item_id = ? AND versao = ?')
      .bind(JSON.stringify(dados), row.item_id, row.versao).run();
  }
  const faltam = await env.DB.prepare("SELECT COUNT(*) AS n FROM item_versoes WHERE dados LIKE '%data:image/%'").first();
  if (results.length) await registrar(env, 'imagens_migradas', { adm: sessao.email, versoes: results.length, imagens });
  return { ok: true, versoes: results.length, imagens, faltam: faltam.n };
}

async function usuarioDaSessao(request, env) {
  const sessao = await sessaoAtual(request, env, 'usuario');
  bloquearFerias(env);
  const user = await env.DB.prepare(
    "SELECT id, nome, email, disciplina, CASE WHEN digitador = 1 THEN 'digitador' ELSE papel END AS papel FROM usuarios WHERE id = ? AND ativo = 1 AND papel IN ('professor','supervisor') AND (acesso_ate IS NULL OR acesso_ate >= date('now','-3 hours'))"
  ).bind(sessao.usuario_id).first();
  if (!user) throw new HttpError(401, 'Acesso desativado. Entre novamente.');
  return user;
}

const SQL_RESUMO_ITEM =
  'SELECT i.id, i.codigo, i.disciplina, i.situacao, i.versao_atual, i.criado_em, i.atualizado_em, i.grupo_id, i.ordem_grupo, (SELECT gg.codigo FROM grupos gg WHERE gg.id = i.grupo_id) AS grupo_codigo, ' +
  'u.nome AS autor, json_extract(v.dados, \'$.assunto\') AS assunto, json_extract(v.dados, \'$.tags\') AS tags, (v.autor_id <> i.autor_id AND ue.papel = \'supervisor\') AS editada_supervisor, (v.autor_id <> i.autor_id AND ue.papel = \'adm\') AS corrigida_adm, ' +
  '(SELECT r.motivo FROM revisoes r WHERE r.item_id = i.id ORDER BY r.id DESC LIMIT 1) AS ultimo_motivo, ' +
  '(COALESCE(json_extract(v.dados, \'$.assunto\'), \'\') = \'\' OR COALESCE(json_extract(v.dados, \'$.bloom\'), \'\') = \'\' OR COALESCE(json_extract(v.dados, \'$.dificuldade\'), \'\') = \'\' OR ((u.papel = \'adm\' OR u.digitador = 1) AND json_array_length(COALESCE(json_extract(v.dados, \'$.tags\'), \'[]\')) < 2)) AS classificar, ' +
  '(CASE WHEN u.papel = \'adm\' THEN \'adm\' WHEN u.digitador = 1 THEN \'digitador\' ELSE \'professor\' END) AS autor_tipo, ' +
  '(i.assinatura IS NOT NULL AND i.assinatura <> \'\' AND EXISTS (SELECT 1 FROM itens rr WHERE rr.disciplina = i.disciplina AND rr.assinatura = i.assinatura AND rr.id <> i.id AND rr.situacao <> \'descartado\')) AS tem_repetida, ' +
  '(SELECT r.decisao FROM revisoes r WHERE r.item_id = i.id ORDER BY r.id DESC LIMIT 1) AS ultima_decisao ' +
  'FROM itens i JOIN usuarios u ON u.id = i.autor_id ' +
  'JOIN item_versoes v ON v.item_id = i.id AND v.versao = i.versao_atual JOIN usuarios ue ON ue.id = v.autor_id ';

async function itemPorCodigo(env, codigo) {
  if (!/^[A-Z]\d{7}$/.test(codigo)) throw new HttpError(404, 'Questão não encontrada.');
  const item = await env.DB.prepare(SQL_RESUMO_ITEM + 'WHERE i.codigo = ?').bind(codigo).first();
  if (!item) throw new HttpError(404, 'Questão não encontrada.');
  return item;
}

function podeVer(user, item, autorId) {
  return autorId === user.id || (user.papel === 'supervisor' && user.disciplina === item.disciplina);
}

// ---------- questões repetidas ----------
// Assinatura = SHA-256 do texto-base + comando + alternativas, sem formatação, acentos, pontuação e espaços.
// Imagens não entram (só o texto). Questão só com imagens fica sem assinatura (não dá para comparar).
function textoPlano(html) {
  return String(html || '')
    .replace(/<span class="katex-mathml">[\s\S]*?<\/span>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}
async function assinaturaDe(dados) {
  const partes = ['texto-base', 'comando', 'alt-a', 'alt-b', 'alt-c', 'alt-d', 'alt-e'].map(c => textoPlano(dados && dados[c]));
  // Textos II, III... entram junto do texto I (questões antigas, sem textos extras, mantêm a mesma assinatura).
  if (dados && Array.isArray(dados.textos_extras)) partes[0] += dados.textos_extras.map(t => textoPlano(t && t.texto)).join('');
  if (!partes.slice(1).join('')) return '';
  return sha256Hex(partes.join('|'));
}
// Calcula a assinatura das questões da disciplina que ainda não têm (novas colunas ou texto alterado).
async function preencherAssinaturas(env, disciplina) {
  const { results } = await env.DB.prepare(
    'SELECT i.id, i.grupo_id, v.dados FROM itens i JOIN item_versoes v ON v.item_id = i.id AND v.versao = i.versao_atual ' +
    'WHERE i.disciplina = ? AND i.assinatura IS NULL LIMIT 300'
  ).bind(disciplina).all();
  const ops = [];
  for (const r of results) {
    const inj = await injetarGrupo(env, r.grupo_id, JSON.parse(r.dados));
    ops.push(env.DB.prepare('UPDATE itens SET assinatura = ? WHERE id = ?').bind(await assinaturaDe(inj.dados), r.id));
  }
  for (let k = 0; k < ops.length; k += 50) await env.DB.batch(ops.slice(k, k + 50));
}
async function repetidasDe(env, disciplina, assinatura, excluirId = null) {
  if (!assinatura) return [];
  await preencherAssinaturas(env, disciplina);
  const { results } = await env.DB.prepare(
    "SELECT codigo, situacao FROM itens WHERE disciplina = ? AND assinatura = ? AND situacao <> 'descartado' AND id IS NOT ? ORDER BY id LIMIT 10"
  ).bind(disciplina, assinatura, excluirId).all();
  return results;
}
function erroRepetida(repetidas) {
  const nomes = { analise: 'em análise', ajustes: 'aguardando ajuste', aprovado: 'aprovada', rascunho: 'rascunho' };
  const e = new HttpError(409, 'Esta questão parece igual a outra que já está no banco: ' +
    repetidas.map(r => r.codigo + ' (' + (nomes[r.situacao] || r.situacao) + ')').join(', ') + '.');
  e.extra = { repetidas };
  return e;
}

// ---------- envio de questões sem classificação (ADM e digitador) ----------
async function enviarSemClassificacao(env, request, autorId, origemEnvio) {
  const body = await readJson(request, MAX_ITEM_BYTES + 64 * 1024);
  const disciplina = limparDisciplina(body.disciplina);
  const entrada = { ...(body.dados || {}) };
  for (const k of ['assunto', 'subtema', 'nivel4', 'nivel5', 'bloom', 'dificuldade', 'fonte']) entrada[k] = '';
  // Prova antiga da escola: origem fixa "Acervo Ideal"; as tags ficam com o Supervisor.
  entrada.origem = 'acervo'; entrada.tags = [];
  if (!entrada.etapa) entrada.etapa = 'em';
  const dados = await validarDadosComImagens(env, entrada, { importacao: true });
  const assinatura = await assinaturaDe(JSON.parse(dados));
  if (body.confirmar_repetida !== true) {
    const repetidas = await repetidasDe(env, disciplina, assinatura);
    if (repetidas.length) throw erroRepetida(repetidas);
  }
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const codigo = gerarCodigoItem(disciplina);
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO itens (codigo, disciplina, autor_id, situacao, versao_atual, assinatura) VALUES (?, ?, ?, 'analise', 1, ?)")
          .bind(codigo, disciplina, autorId, assinatura),
        env.DB.prepare('INSERT INTO item_versoes (item_id, versao, dados, autor_id) SELECT id, 1, ?, ? FROM itens WHERE codigo = ?').bind(dados, autorId, codigo),
        env.DB.prepare("INSERT INTO eventos (usuario_id, acao, item_id, detalhe) SELECT ?, 'item_enviado', id, ? FROM itens WHERE codigo = ?")
          .bind(autorId, JSON.stringify({ codigo, versao: 1, sem_classificacao: true, por: origemEnvio }), codigo)
      ]);
      return { ok: true, item: { codigo, disciplina, situacao: 'analise' } };
    } catch (error) {
      if (!/UNIQUE/i.test(String(error && error.message))) throw error;
    }
  }
  throw new HttpError(503, 'Não foi possível gerar o código da questão. Tente novamente.');
}

// ---------- grupos de questões (testlets) ----------
// Um grupo tem um texto-base (e referência) compartilhado, com versões próprias em grupo_versoes.
// Cada questão do grupo continua com código, versões e análise próprios; no banco, o texto-base dela fica vazio
// e o servidor injeta o texto do grupo ao devolver a questão. Ao salvar, o texto volta para o grupo.
const MIN_ITENS_GRUPO = 2, MAX_ITENS_GRUPO = 10;
const MIN_TAGS = 2;
function exigirTags(dadosJson, prefixo = '') {
  const d = JSON.parse(dadosJson);
  if (!Array.isArray(d.tags) || d.tags.length < MIN_TAGS) throw new HttpError(400, prefixo + 'Coloque pelo menos ' + MIN_TAGS + ' tags (palavras-chave) na questão.');
}

function gerarCodigoGrupo(disciplina) {
  const letra = LETRA_DISCIPLINA[disciplina];
  if (!letra) throw new HttpError(400, 'Disciplina sem código definido.');
  const d = new Uint32Array(1); crypto.getRandomValues(d);
  return 'G' + letra + String(100000 + (d[0] % 900000));
}
async function validarTextoGrupo(env, input) {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Texto-base do grupo inválido.');
  let texto = input['texto-base'];
  const ref = input.referencia === undefined || input.referencia === null ? '' : input.referencia;
  if (typeof texto !== 'string' || typeof ref !== 'string') throw new HttpError(400, 'Texto-base do grupo inválido.');
  if (ref.length > 1000) throw new HttpError(400, 'Referência grande demais.');
  texto = await normalizarImagens(env, texto);
  if (HTML_PROIBIDO.test(texto)) throw new HttpError(400, 'O texto-base contém conteúdo não permitido.');
  for (const img of texto.match(/<img\b[^>]*>/gi) || []) {
    const src = (img.match(/\ssrc\s*=\s*"([^"]*)"/i) || [])[1] || '';
    if (!/^data:image\/(png|jpeg|webp);base64,/i.test(src) && !/^atlas:img\/[0-9a-f]{32}$/.test(src)) {
      throw new HttpError(400, 'O texto-base tem uma imagem de origem não permitida. Cole a imagem de novo.');
    }
  }
  if (!texto.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() && !/<img\b/i.test(texto)) {
    throw new HttpError(400, 'Preencha o texto-base compartilhado do grupo.');
  }
  let extras = input.textos_extras;
  if (Array.isArray(extras)) extras = await Promise.all(extras.map(async t => (t && typeof t.texto === 'string') ? { ...t, texto: await normalizarImagens(env, t.texto) } : t));
  const json = JSON.stringify({ 'texto-base': texto, referencia: formatarReferencia(ref), textos_extras: limparTextosExtras(extras),
    layout: input.layout === 'pagina' ? 'pagina' : 'coluna' });
  if (new TextEncoder().encode(json).length > MAX_ITEM_BYTES) throw new HttpError(413, 'O texto-base ficou grande demais.');
  return json;
}
async function dadosDoGrupo(env, grupoId, versao = null) {
  const g = await env.DB.prepare('SELECT id, codigo, versao_atual FROM grupos WHERE id = ?').bind(grupoId).first();
  if (!g) return null;
  const v = await env.DB.prepare('SELECT dados FROM grupo_versoes WHERE grupo_id = ? AND versao = ?').bind(g.id, versao || g.versao_atual).first();
  const { results: membros } = await env.DB.prepare(
    'SELECT codigo, situacao, ordem_grupo AS ordem FROM itens WHERE grupo_id = ? ORDER BY ordem_grupo, id'
  ).bind(g.id).all();
  return { id: g.id, codigo: g.codigo, versao: versao || g.versao_atual, versao_atual: g.versao_atual, dados: JSON.parse(v ? v.dados : '{}'), membros };
}
// Coloca no "dados" da questão o texto-base e a referência do grupo (para exibir e editar como antes).
async function injetarGrupo(env, grupoId, dados, versao = null) {
  if (!grupoId) return { dados, grupo: null };
  const g = await dadosDoGrupo(env, grupoId, versao);
  if (!g) return { dados, grupo: null };
  return {
    dados: { ...dados, 'texto-base': g.dados['texto-base'] || '', referencia: g.dados.referencia || '',
      textos_extras: Array.isArray(g.dados.textos_extras) ? g.dados.textos_extras : [], layout: g.dados.layout === 'pagina' ? 'pagina' : 'coluna' },
    grupo: { codigo: g.codigo, versao: g.versao, versao_atual: g.versao_atual, membros: g.membros }
  };
}
// Ao salvar uma questão de grupo: separa o texto compartilhado. Se ele mudou, cria nova versão do grupo
// (Professor/Supervisor só enquanto nenhuma questão do grupo estiver aprovada; o ADM sempre).
async function gravacaoDoGrupo(env, item, dadosJson, autorId, papel) {
  if (!item.grupo_id) return { dados: dadosJson, ops: [] };
  const d = JSON.parse(dadosJson);
  const canon = x => JSON.stringify({ t: x['texto-base'] || '', r: x.referencia || '', e: Array.isArray(x.textos_extras) ? x.textos_extras : [] });
  const textoNovo = { 'texto-base': d['texto-base'] || '', referencia: d.referencia || '', textos_extras: d.textos_extras || [], layout: d.layout === 'pagina' ? 'pagina' : 'coluna' };
  d['texto-base'] = ''; d.referencia = ''; d.textos_extras = [];
  const g = await dadosDoGrupo(env, item.grupo_id);
  const ops = [];
  const textoMudou = g && canon(textoNovo) !== canon(g.dados);
  const layoutMudou = g && textoNovo.layout !== (g.dados.layout === 'pagina' ? 'pagina' : 'coluna');
  if (g && (textoMudou || layoutMudou)) {
    // Mudar só o formato (1 ou 2 colunas) é permitido mesmo com questões do grupo já aprovadas.
    if (textoMudou && papel !== 'adm' && g.membros.some(m => m.situacao === 'aprovado')) {
      throw new HttpError(409, 'O texto-base é compartilhado com questões do grupo ' + g.codigo + ' que já foram aprovadas. Para mudá-lo, peça um conserto ao administrador.');
    }
    const textoJson = await validarTextoGrupo(env, textoNovo);
    const nova = g.versao_atual + 1;
    ops.push(
      env.DB.prepare('INSERT INTO grupo_versoes (grupo_id, versao, dados, autor_id) VALUES (?, ?, ?, ?)').bind(g.id, nova, textoJson, autorId),
      env.DB.prepare("UPDATE grupos SET versao_atual = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND versao_atual = ?").bind(nova, g.id, g.versao_atual),
      env.DB.prepare("INSERT INTO eventos (usuario_id, acao, detalhe) VALUES (?, 'grupo_texto_alterado', ?)").bind(autorId, JSON.stringify({ grupo: g.codigo, versao: nova, por: papel })),
      env.DB.prepare('UPDATE itens SET assinatura = NULL WHERE grupo_id = ?').bind(g.id)
    );
  }
  return { dados: JSON.stringify(d), ops };
}
// Enviar um grupo novo: texto compartilhado + 2 a 10 questões.
async function criarGrupo(request, env, user) {
  const body = await readJson(request, (MAX_ITEM_BYTES + 64 * 1024) * 3);
  const textoJson = await validarTextoGrupo(env, body.texto || {});
  const lista = Array.isArray(body.itens) ? body.itens : [];
  if (lista.length < MIN_ITENS_GRUPO || lista.length > MAX_ITENS_GRUPO) {
    throw new HttpError(400, 'Um grupo precisa ter de ' + MIN_ITENS_GRUPO + ' a ' + MAX_ITENS_GRUPO + ' questões.');
  }
  const dadosItens = [], assinaturas = [];
  const textoGrupo = JSON.parse(textoJson);
  for (let k = 0; k < lista.length; k++) {
    try {
      const dj = await validarDadosComImagens(env, { ...(lista[k] || {}), 'texto-base': '', referencia: '', textos_extras: [], layout: textoGrupo.layout });
      exigirTags(dj);
      const d = JSON.parse(dj);
      dadosItens.push(JSON.stringify(d));
      assinaturas.push(await assinaturaDe({ ...d, 'texto-base': textoGrupo['texto-base'], textos_extras: textoGrupo.textos_extras }));
    } catch (error) {
      if (error instanceof HttpError) throw new HttpError(error.status, 'Questão ' + (k + 1) + ' do grupo: ' + error.message);
      throw error;
    }
  }
  if (body.confirmar_repetida !== true) {
    const todas = [];
    for (const a of assinaturas) for (const r of await repetidasDe(env, user.disciplina, a)) if (!todas.some(t => t.codigo === r.codigo)) todas.push(r);
    if (todas.length) throw erroRepetida(todas);
  }
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const codigoGrupo = gerarCodigoGrupo(user.disciplina);
    const codigos = new Set();
    while (codigos.size < dadosItens.length) codigos.add(gerarCodigoItem(user.disciplina));
    const lista2 = [...codigos];
    const ops = [
      env.DB.prepare('INSERT INTO grupos (codigo, disciplina, autor_id) VALUES (?, ?, ?)').bind(codigoGrupo, user.disciplina, user.id),
      env.DB.prepare('INSERT INTO grupo_versoes (grupo_id, versao, dados, autor_id) SELECT id, 1, ?, ? FROM grupos WHERE codigo = ?').bind(textoJson, user.id, codigoGrupo)
    ];
    lista2.forEach((codigo, k) => ops.push(
      env.DB.prepare("INSERT INTO itens (codigo, disciplina, autor_id, situacao, versao_atual, grupo_id, ordem_grupo, assinatura) SELECT ?, ?, ?, 'analise', 1, id, ?, ? FROM grupos WHERE codigo = ?")
        .bind(codigo, user.disciplina, user.id, k + 1, assinaturas[k], codigoGrupo),
      env.DB.prepare('INSERT INTO item_versoes (item_id, versao, dados, autor_id) SELECT id, 1, ?, ? FROM itens WHERE codigo = ?').bind(dadosItens[k], user.id, codigo),
      env.DB.prepare("INSERT INTO eventos (usuario_id, acao, item_id, detalhe) SELECT ?, 'item_enviado', id, ? FROM itens WHERE codigo = ?")
        .bind(user.id, JSON.stringify({ codigo, versao: 1, grupo: codigoGrupo }), codigo)
    ));
    try {
      await env.DB.batch(ops);
      return { ok: true, grupo: { codigo: codigoGrupo, itens: lista2 } };
    } catch (error) {
      if (!/UNIQUE/i.test(String(error && error.message))) throw error;
    }
  }
  throw new HttpError(503, 'Não foi possível gerar os códigos. Tente novamente.');
}

async function rotasItens(request, env, path) {
  const user = await usuarioDaSessao(request, env);
  if (user.papel === 'digitador') {
    if (path === '/api/itens/digitador' && request.method === 'POST') return await enviarSemClassificacao(env, request, user.id, 'digitador');
    if (path === '/api/itens/meus' && request.method === 'GET') {
      const { results } = await env.DB.prepare(SQL_RESUMO_ITEM + 'WHERE i.autor_id = ? ORDER BY i.id DESC LIMIT 300').bind(user.id).all();
      return { ok: true, itens: results.map(({ id, grupo_id, tags, ...r }) => ({ ...r, tags: tags ? JSON.parse(tags) : [] })) };
    }
    throw new HttpError(403, 'Esta área é só para envio de questões pelo digitador.');
  }

  // Enviar questão nova
  if (path === '/api/itens' && request.method === 'POST') {
    const body = await readJson(request, MAX_ITEM_BYTES + 64 * 1024);
    const dados = await validarDadosComImagens(env, body.dados);
    exigirTags(dados);
    const assinatura = await assinaturaDe(JSON.parse(dados));
    if (body.confirmar_repetida !== true) {
      const repetidas = await repetidasDe(env, user.disciplina, assinatura);
      if (repetidas.length) throw erroRepetida(repetidas);
    }
    for (let tentativa = 0; tentativa < 10; tentativa++) {
      const codigo = gerarCodigoItem(user.disciplina);
      try {
        await env.DB.batch([
          env.DB.prepare("INSERT INTO itens (codigo, disciplina, autor_id, situacao, versao_atual, assinatura) VALUES (?, ?, ?, 'analise', 1, ?)")
            .bind(codigo, user.disciplina, user.id, assinatura),
          env.DB.prepare('INSERT INTO item_versoes (item_id, versao, dados, autor_id) SELECT id, 1, ?, ? FROM itens WHERE codigo = ?')
            .bind(dados, user.id, codigo),
          env.DB.prepare("INSERT INTO eventos (usuario_id, acao, item_id, detalhe) SELECT ?, 'item_enviado', id, ? FROM itens WHERE codigo = ?")
            .bind(user.id, JSON.stringify({ codigo, versao: 1 }), codigo)
        ]);
        return { ok: true, item: { codigo, situacao: 'analise', versao: 1, disciplina: user.disciplina } };
      } catch (error) {
        if (!/UNIQUE/i.test(String(error && error.message))) throw error;   // código repetido: sorteia outro
      }
    }
    throw new HttpError(503, 'Não foi possível gerar o código da questão. Tente novamente.');
  }

  if (path === '/api/itens/grupo' && request.method === 'POST') return await criarGrupo(request, env, user);

  // Minhas questões
  // Quadro do professor: o que ele enviou em cada mês do ano e como as questões estão hoje.
  if (path === '/api/itens/meus/resumo' && request.method === 'GET') {
    const u = new URL(request.url);
    const ano = Number(u.searchParams.get('ano')) || anoAtualSP();
    const rel = await relatorioProducao(env, new URL('https://x/?recorte=professor&valor=' + user.id + '&ano=' + ano));
    const l = rel.linhas[0] || { meses: Array(12).fill(0), total: 0, aprovado: 0, analise: 0, ajustes: 0, descartado: 0, corrigidas: 0 };
    // Situação de hoje das questões enviadas em cada mês.
    const { results: rs } = await env.DB.prepare(
      "SELECT CAST(strftime('%m', datetime(criado_em, '-3 hours')) AS INTEGER) AS mes, situacao, COUNT(*) AS n FROM itens " +
      "WHERE autor_id = ? AND strftime('%Y', datetime(criado_em, '-3 hours')) = ? GROUP BY mes, situacao"
    ).bind(user.id, String(ano)).all();
    const porMes = Array.from({ length: 12 }, () => ({ enviadas: 0, aprovado: 0, analise: 0, ajustes: 0, descartado: 0 }));
    for (const r of rs) { const m = porMes[r.mes - 1]; m.enviadas += r.n; if (r.situacao in m) m[r.situacao] += r.n; }
    return { ok: true, ano, mes_atual: Number(new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', month: 'numeric' }).format(new Date())),
      meses: l.meses, por_mes: porMes, total: l.total, aprovado: l.aprovado, analise: l.analise, ajustes: l.ajustes, descartado: l.descartado, corrigidas: l.corrigidas };
  }
  if (path === '/api/itens/meus' && request.method === 'GET') {
    const { results } = await env.DB.prepare(SQL_RESUMO_ITEM + 'WHERE i.autor_id = ? ORDER BY i.atualizado_em DESC, i.id DESC LIMIT 300')
      .bind(user.id).all();
    return { ok: true, itens: results.map(({ id, grupo_id, tags, ...r }) => ({ ...r, tags: tags ? JSON.parse(tags) : [] })) };
  }

  const match = path.match(/^\/api\/itens\/([A-Z]\d{7})$/);
  if (match && request.method === 'GET') {
    const item = await itemPorCodigo(env, match[1]);
    const autorId = (await env.DB.prepare('SELECT autor_id FROM itens WHERE id = ?').bind(item.id).first()).autor_id;
    if (!podeVer(user, item, autorId)) throw new HttpError(404, 'Questão não encontrada.');
    const versao = await env.DB.prepare('SELECT dados, criado_em FROM item_versoes WHERE item_id = ? AND versao = ?')
      .bind(item.id, item.versao_atual).first();
    const { results: revisoes } = await env.DB.prepare(
      'SELECT r.versao, r.decisao, r.motivo, r.criado_em, u.nome AS supervisor FROM revisoes r JOIN usuarios u ON u.id = r.supervisor_id WHERE r.item_id = ? ORDER BY r.id'
    ).bind(item.id).all();
    const { results: versoes } = await env.DB.prepare(
      'SELECT v.versao, v.criado_em, u.nome AS autor, u.papel AS papel_autor, (v.autor_id <> ?) AS pelo_supervisor FROM item_versoes v JOIN usuarios u ON u.id = v.autor_id WHERE v.item_id = ? ORDER BY v.versao'
    ).bind(autorId, item.id).all();
    const { results: consertos } = await env.DB.prepare(
      'SELECT c.motivo, c.situacao, c.resposta, c.criado_em, c.resolvido_em, u.nome AS solicitante FROM consertos c JOIN usuarios u ON u.id = c.solicitante_id WHERE c.item_id = ? ORDER BY c.id'
    ).bind(item.id).all();
    const { id, grupo_id, ...resumo } = item;
    const inj = await injetarGrupo(env, grupo_id, JSON.parse(versao.dados));
    const repetidas = await repetidasDe(env, item.disciplina, await assinaturaDe(inj.dados), item.id);
    return { ok: true, item: { ...resumo, dados: inj.dados, grupo: inj.grupo, repetidas, revisoes, versoes, consertos, e_autor: autorId === user.id } };
  }

  // Reenviar após pedido de ajuste (só o autor; gera nova versão)
  if (match && request.method === 'PUT') {
    const item = await itemPorCodigo(env, match[1]);
    const autorId = (await env.DB.prepare('SELECT autor_id FROM itens WHERE id = ?').bind(item.id).first()).autor_id;
    if (autorId !== user.id) throw new HttpError(404, 'Questão não encontrada.');
    if (item.situacao !== 'ajustes') throw new HttpError(409, 'Esta questão não está aguardando ajuste.');
    const body = await readJson(request, MAX_ITEM_BYTES + 64 * 1024);
    if (body.versao !== item.versao_atual) throw new HttpError(409, 'A questão mudou desde que você a abriu. Recarregue a página.');
    const dadosProf = await validarDadosComImagens(env, body.dados);
    exigirTags(dadosProf);
    const grp = await gravacaoDoGrupo(env, item, dadosProf, user.id, 'professor');
    const dados = grp.dados;
    const nova = item.versao_atual + 1;
    try {
      await env.DB.batch([
        ...grp.ops,
        env.DB.prepare('INSERT INTO item_versoes (item_id, versao, dados, autor_id) VALUES (?, ?, ?, ?)').bind(item.id, nova, dados, user.id),
        env.DB.prepare("UPDATE itens SET versao_atual = ?, situacao = 'analise', assinatura = NULL, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND versao_atual = ? AND situacao = 'ajustes'")
          .bind(nova, item.id, item.versao_atual),
        env.DB.prepare("INSERT INTO eventos (usuario_id, acao, item_id, detalhe) VALUES (?, 'item_reenviado', ?, ?)")
          .bind(user.id, item.id, JSON.stringify({ codigo: item.codigo, versao: nova }))
      ]);
    } catch (error) {
      if (/UNIQUE|PRIMARY/i.test(String(error && error.message))) throw new HttpError(409, 'Esta questão já foi reenviada.');
      throw error;
    }
    return { ok: true, item: { codigo: item.codigo, situacao: 'analise', versao: nova } };
  }
  throw new HttpError(404, 'Rota indisponível.');
}

async function rotasSupervisor(request, env, path, url) {
  const user = await usuarioDaSessao(request, env);
  if (user.papel !== 'supervisor') throw new HttpError(403, 'Área restrita ao Supervisor da disciplina.');
  const selecoes = await rotasSelecoesSupervisor(request, env, path, url, user);
  if (selecoes) return selecoes;

  if (path === '/api/supervisor/fila' && request.method === 'GET') {
    const situacao = url.searchParams.get('situacao') || 'analise';
    if (!['analise', 'ajustes', 'aprovado', 'descartado'].includes(situacao)) throw new HttpError(400, 'Situação inválida.');
    await preencherAssinaturas(env, user.disciplina);
    const { results } = await env.DB.prepare(SQL_RESUMO_ITEM + 'WHERE i.disciplina = ? AND i.situacao = ? ORDER BY i.atualizado_em ASC, i.id ASC LIMIT 300')
      .bind(user.disciplina, situacao).all();
    return { ok: true, disciplina: user.disciplina, itens: results.map(({ id, grupo_id, tags, ...r }) => ({ ...r, tags: tags ? JSON.parse(tags) : [] })) };
  }

  // Editar (correção pequena): nova versão feita pelo Supervisor; a questão continua em análise.
  const edicao = path.match(/^\/api\/supervisor\/itens\/([A-Z]\d{7})$/);
  if (edicao && request.method === 'PUT') {
    const item = await itemPorCodigo(env, edicao[1]);
    if (item.disciplina !== user.disciplina) throw new HttpError(404, 'Questão não encontrada.');
    if (item.situacao !== 'analise') throw new HttpError(409, 'Só é possível editar questões em análise.');
    const body = await readJson(request, MAX_ITEM_BYTES + 64 * 1024);
    if (body.versao !== item.versao_atual) throw new HttpError(409, 'A questão mudou desde que você a abriu. Volte à fila e abra de novo.');
    // O Supervisor ajusta conteúdo, tags e classificação (assunto, subtema, detalhamentos, Bloom);
    // etapa, origem, fonte e dificuldade prevista continuam como o professor informou.
    const atualSup = JSON.parse((await env.DB.prepare('SELECT dados FROM item_versoes WHERE item_id = ? AND versao = ?').bind(item.id, item.versao_atual).first()).dados);
    if (body.dados && typeof body.dados === 'object') {
      for (const k of ['etapa', 'ano', 'origem', 'fonte']) body.dados[k] = atualSup[k] ?? '';
      if (atualSup.dificuldade) body.dados.dificuldade = atualSup.dificuldade;   // só define quando a questão chegou sem dificuldade
    }
    const grp = await gravacaoDoGrupo(env, item, await validarDadosComImagens(env, body.dados, { importacao: !classificacaoCompleta(atualSup) }), user.id, 'supervisor');
    const dados = grp.dados;
    const nova = item.versao_atual + 1;
    try {
      await env.DB.batch([
        ...grp.ops,
        env.DB.prepare('INSERT INTO item_versoes (item_id, versao, dados, autor_id) VALUES (?, ?, ?, ?)').bind(item.id, nova, dados, user.id),
        env.DB.prepare("UPDATE itens SET versao_atual = ?, assinatura = NULL, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND versao_atual = ? AND situacao = 'analise'")
          .bind(nova, item.id, item.versao_atual),
        env.DB.prepare("INSERT INTO eventos (usuario_id, acao, item_id, detalhe) VALUES (?, 'item_editado_supervisor', ?, ?)")
          .bind(user.id, item.id, JSON.stringify({ codigo: item.codigo, versao: nova }))
      ]);
    } catch (error) {
      if (/UNIQUE|PRIMARY/i.test(String(error && error.message))) throw new HttpError(409, 'A questão acabou de ser alterada. Abra de novo.');
      throw error;
    }
    return { ok: true, item: { codigo: item.codigo, situacao: 'analise', versao: nova } };
  }

  // Pedir conserto ao ADM (questão já aprovada).
  const pedido = path.match(/^\/api\/supervisor\/itens\/([A-Z]\d{7})\/conserto$/);
  if (pedido && request.method === 'POST') {
    const item = await itemPorCodigo(env, pedido[1]);
    if (item.disciplina !== user.disciplina) throw new HttpError(404, 'Questão não encontrada.');
    if (item.situacao !== 'aprovado') throw new HttpError(409, 'Pedidos de conserto valem só para questões aprovadas.');
    const body = await readJson(request);
    const motivo = String(body.motivo ?? '').trim();
    if (motivo.length < 3 || motivo.length > 2000) throw new HttpError(400, 'Descreva o conserto necessário.');
    const aberto = await env.DB.prepare("SELECT id FROM consertos WHERE item_id = ? AND situacao = 'pendente'").bind(item.id).first();
    if (aberto) throw new HttpError(409, 'Já existe um pedido de conserto aguardando o administrador.');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO consertos (item_id, solicitante_id, motivo) VALUES (?, ?, ?)').bind(item.id, user.id, motivo),
      env.DB.prepare("INSERT INTO eventos (usuario_id, acao, item_id, detalhe) VALUES (?, 'conserto_solicitado', ?, ?)")
        .bind(user.id, item.id, JSON.stringify({ codigo: item.codigo }))
    ]);
    avisar(env, env.ADMIN_EMAIL, 'ATLAS: pedido de conserto da questão ' + item.codigo,
      user.nome + ' (Supervisor de ' + user.disciplina + ') pediu um conserto na questão ' + item.codigo + ':\n\n' + motivo + '\n\n' + LINK_ATLAS + 'admin-questoes.html');
    return { ok: true };
  }

  const match = path.match(/^\/api\/supervisor\/itens\/([A-Z]\d{7})\/decisao$/);
  if (match && request.method === 'POST') {
    const item = await itemPorCodigo(env, match[1]);
    if (item.disciplina !== user.disciplina) throw new HttpError(404, 'Questão não encontrada.');
    const body = await readJson(request);
    const decisao = body.decisao;
    if (!['aprovar', 'ajuste', 'descartar'].includes(decisao)) throw new HttpError(400, 'Decisão inválida.');
    const motivo = String(body.motivo ?? '').trim();
    if (decisao === 'ajuste' && (motivo.length < 3 || motivo.length > 2000)) throw new HttpError(400, 'Descreva o ajuste necessário.');
    if (decisao === 'descartar' && (motivo.length < 3 || motivo.length > 2000)) throw new HttpError(400, 'Informe o motivo do descarte.');
    if (body.versao !== item.versao_atual) throw new HttpError(409, 'A questão mudou desde que você a abriu. Volte à fila e abra de novo.');
    if (decisao === 'aprovar') {
      const dv = JSON.parse((await env.DB.prepare('SELECT dados FROM item_versoes WHERE item_id = ? AND versao = ?').bind(item.id, item.versao_atual).first()).dados);
      if (!classificacaoCompleta(dv)) throw new HttpError(409, 'Classifique a questão antes de aprovar: assunto, nível cognitivo (Bloom) e dificuldade. Use "Editar item".');
      if (item.autor_tipo !== 'professor' && !(Array.isArray(dv.tags) && dv.tags.length >= 2)) throw new HttpError(409, 'Coloque pelo menos 2 tags antes de aprovar. Use "Editar item".');
    }
    if (decisao === 'ajuste' && item.autor_tipo !== 'professor') {
      throw new HttpError(409, 'Esta questão foi enviada pela Administração/digitação: não há professor para corrigir. Use "Editar item" para ajustar você mesmo.');
    }
    // Muda a situação primeiro e só se ela ainda estiver "em análise" nesta versão (evita decisão dupla).
    const nova = { aprovar: 'aprovado', ajuste: 'ajustes', descartar: 'descartado' }[decisao];
    // Descartar vale para questões em análise ou aguardando ajuste; aprovar/ajuste só para "em análise".
    const situacoesValidas = decisao === 'descartar' ? "('analise','ajustes')" : "('analise')";
    const alterado = await env.DB.prepare(
      "UPDATE itens SET situacao = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND situacao IN " + situacoesValidas + " AND versao_atual = ? RETURNING id"
    ).bind(nova, item.id, item.versao_atual).first();
    if (!alterado) throw new HttpError(409, 'Esta questão já foi analisada.');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO revisoes (item_id, versao, supervisor_id, decisao, motivo) VALUES (?, ?, ?, ?, ?)')
        .bind(item.id, item.versao_atual, user.id, decisao, motivo || null),
      env.DB.prepare('INSERT INTO eventos (usuario_id, acao, item_id, detalhe) VALUES (?, ?, ?, ?)')
        .bind(user.id, { aprovar: 'item_aprovado', ajuste: 'item_ajuste_solicitado', descartar: 'item_descartado' }[decisao], item.id, JSON.stringify({ codigo: item.codigo, versao: item.versao_atual }))
    ]);
    const autorInfo = await emailDoAutor(env, item.id);
    const frase = { aprovar: 'foi aprovada pelo Supervisor', ajuste: 'precisa de ajuste', descartar: 'foi descartada pelo Supervisor' }[decisao];
    if (item.autor_tipo === 'professor') avisar(env, autorInfo.email, 'ATLAS: a questão ' + item.codigo + ' ' + frase,
      'Olá, ' + (autorInfo.nome || 'professor(a)') + '.\n\nA sua questão ' + item.codigo + ' ' + frase + '.' +
      (motivo ? '\n\nMotivo: ' + motivo : '') + (decisao === 'ajuste' ? '\n\nAbra o ATLAS, vá em "Minhas questões" e clique em "Corrigir".' : '') +
      '\n\n' + LINK_ATLAS);
    return { ok: true, item: { codigo: item.codigo, situacao: nova } };
  }
  throw new HttpError(404, 'Rota indisponível.');
}

// ---------- avisos por e-mail ----------
// Só envia quando ATLAS_AVISOS_ATIVOS = "1". Sai pela Microsoft (olimpiadas@) e, se falhar, pelo Apps Script.
// Uma falha no envio nunca desfaz a ação que gerou o aviso.
function avisar(env, para, assunto, texto, forcar) {
  // forcar: lembretes ao próprio ADM saem mesmo com os avisos aos professores desligados.
  if (env.ATLAS_AVISOS_ATIVOS !== '1' && !forcar) return;
  if (!para || (!microsoftConfigurado(env) && (!env.ATLAS_MAILER_URL || !env.ATLAS_MAILER_SECRET))) {
    console.warn('ATLAS aviso não enviado: configuração ou destinatário ausente.');
    return;
  }
  const envio = enviarEmail(env, para, assunto, texto, async () => {
    if (!env.ATLAS_MAILER_URL || !env.ATLAS_MAILER_SECRET) return false;
    try {
      const response = await fetch(env.ATLAS_MAILER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segredo: env.ATLAS_MAILER_SECRET, tipo: 'aviso', email: para, assunto, texto })
      });
      const resultado = await response.json().catch(() => null);
      if (!response.ok || resultado?.ok !== true) console.warn('ATLAS aviso recusado pelo mailer:', response.status, resultado?.erro || 'resposta inválida');
      return response.ok && resultado?.ok === true;
    } catch { console.warn('ATLAS aviso não enviado: falha de conexão com o mailer.'); return false; }
  }).then(ok => { if (!ok) console.warn('ATLAS aviso não enviado por nenhum caminho.'); });
  if (env.__ctx && typeof env.__ctx.waitUntil === 'function') env.__ctx.waitUntil(envio);
}
const LINK_ATLAS = 'https://idealolimpico.com.br/atlas/';

async function emailDoAutor(env, itemId) {
  const row = await env.DB.prepare('SELECT u.email, u.nome FROM itens i JOIN usuarios u ON u.id = i.autor_id WHERE i.id = ?').bind(itemId).first();
  return row || {};
}
async function supervisorDaDisciplina(env, disciplina) {
  return await env.DB.prepare("SELECT id, nome, email FROM usuarios WHERE papel = 'supervisor' AND ativo = 1 AND disciplina = ?").bind(disciplina).first();
}

// ---------- questões na Administração ----------
const DIAS_DESFAZER_DESCARTE = 30;

async function admUsuarioId(env) {
  // O ADM entra com Google e não tem cadastro de professor; este registro serve de "autor" das correções.
  await env.DB.prepare("INSERT OR IGNORE INTO usuarios (nome, email, disciplina, papel, ativo) VALUES ('Administrador', ?, NULL, 'adm', 1)")
    .bind(String(env.ADMIN_EMAIL).toLowerCase()).run();
  const row = await env.DB.prepare("SELECT id FROM usuarios WHERE email = ? AND papel = 'adm'").bind(String(env.ADMIN_EMAIL).toLowerCase()).first();
  if (!row) throw new HttpError(500, 'Cadastro do administrador indisponível.');
  return row.id;
}

async function dataDescarte(env, itemId) {
  const row = await env.DB.prepare("SELECT criado_em FROM revisoes WHERE item_id = ? AND decisao = 'descartar' ORDER BY id DESC LIMIT 1").bind(itemId).first();
  return row ? row.criado_em : null;
}
function diasDesde(iso) {
  return (Date.now() - Date.parse(iso)) / 86400000;
}

async function detalheCompleto(env, item) {
  const autor = await env.DB.prepare('SELECT autor_id FROM itens WHERE id = ?').bind(item.id).first();
  const versao = await env.DB.prepare('SELECT dados FROM item_versoes WHERE item_id = ? AND versao = ?').bind(item.id, item.versao_atual).first();
  const { results: revisoes } = await env.DB.prepare(
    'SELECT r.versao, r.decisao, r.motivo, r.criado_em, u.nome AS supervisor FROM revisoes r JOIN usuarios u ON u.id = r.supervisor_id WHERE r.item_id = ? ORDER BY r.id'
  ).bind(item.id).all();
  const { results: versoes } = await env.DB.prepare(
    'SELECT v.versao, v.criado_em, u.nome AS autor, u.papel AS papel_autor, (v.autor_id <> ?) AS pelo_supervisor FROM item_versoes v JOIN usuarios u ON u.id = v.autor_id WHERE v.item_id = ? ORDER BY v.versao'
  ).bind(autor.autor_id, item.id).all();
  const { results: consertos } = await env.DB.prepare(
    'SELECT c.id, c.motivo, c.situacao, c.resposta, c.criado_em, c.resolvido_em, u.nome AS solicitante FROM consertos c JOIN usuarios u ON u.id = c.solicitante_id WHERE c.item_id = ? ORDER BY c.id'
  ).bind(item.id).all();
  const { id, grupo_id, ...resumo } = item;
  const inj = await injetarGrupo(env, grupo_id, JSON.parse(versao.dados));
  const repetidas = await repetidasDe(env, item.disciplina, await assinaturaDe(inj.dados), item.id);
  return { ...resumo, dados: inj.dados, grupo: inj.grupo, repetidas, revisoes, versoes, consertos, autor_id: autor.autor_id };
}

async function rotasAdmItens(request, env, path, sessao) {
  if (path === '/api/adm/consertos' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      "SELECT c.id, c.motivo, c.criado_em, i.codigo, i.disciplina, u.nome AS solicitante FROM consertos c " +
      "JOIN itens i ON i.id = c.item_id JOIN usuarios u ON u.id = c.solicitante_id WHERE c.situacao = 'pendente' ORDER BY c.id"
    ).all();
    return { ok: true, consertos: results };
  }
  const recusa = path.match(/^\/api\/adm\/consertos\/(\d+)\/recusar$/);
  if (recusa && request.method === 'POST') {
    const body = await readJson(request);
    const resposta = String(body.resposta ?? '').trim();
    if (resposta.length < 3 || resposta.length > 2000) throw new HttpError(400, 'Explique ao Supervisor por que o conserto não será feito.');
    const c = await env.DB.prepare(
      "UPDATE consertos SET situacao = 'recusado', resposta = ?, resolvido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND situacao = 'pendente' RETURNING item_id, solicitante_id"
    ).bind(resposta, Number(recusa[1])).first();
    if (!c) throw new HttpError(409, 'Este pedido já foi resolvido.');
    await registrar(env, 'conserto_recusado', { adm: sessao.email, conserto: Number(recusa[1]) });
    const sup = await env.DB.prepare('SELECT u.email, i.codigo FROM usuarios u, itens i WHERE u.id = ? AND i.id = ?').bind(c.solicitante_id, c.item_id).first();
    if (sup) avisar(env, sup.email, 'ATLAS: pedido de conserto da questão ' + sup.codigo + ' não atendido',
      'O administrador respondeu ao seu pedido de conserto da questão ' + sup.codigo + ':\n\n' + resposta + '\n\n' + LINK_ATLAS);
    return { ok: true };
  }

  const m = path.match(/^\/api\/adm\/itens\/([A-Z]\d{7})(\/desfazer-descarte)?$/);
  if (!m) return null;
  const item = await itemPorCodigo(env, m[1]);

  if (!m[2] && request.method === 'GET') {
    const det = await detalheCompleto(env, item);
    const descartadoEm = item.situacao === 'descartado' ? await dataDescarte(env, item.id) : null;
    return { ok: true, item: { ...det, descartado_em: descartadoEm,
      retirada: !!(await env.DB.prepare('SELECT retirada_id FROM itens WHERE id = ?').bind(item.id).first())?.retirada_id,
      pode_desfazer: !!descartadoEm && diasDesde(descartadoEm) <= DIAS_DESFAZER_DESCARTE && !(await env.DB.prepare('SELECT retirada_id FROM itens WHERE id = ?').bind(item.id).first())?.retirada_id,
      prazo_dias: DIAS_DESFAZER_DESCARTE } };
  }

  if (m[2] && request.method === 'POST') {
    if (item.situacao !== 'descartado') throw new HttpError(409, 'Esta questão não está descartada.');
    if ((await env.DB.prepare('SELECT retirada_id FROM itens WHERE id = ?').bind(item.id).first())?.retirada_id) throw new HttpError(409, 'Esta questão foi retirada junto com as do professor desligado. Para devolvê-la, use "Questões retiradas" em Professores e disciplinas.');
    const descartadoEm = await dataDescarte(env, item.id);
    if (!descartadoEm || diasDesde(descartadoEm) > DIAS_DESFAZER_DESCARTE) {
      throw new HttpError(409, 'O prazo de ' + DIAS_DESFAZER_DESCARTE + ' dias para desfazer este descarte já terminou.');
    }
    const alterado = await env.DB.prepare(
      "UPDATE itens SET situacao = 'analise', atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND situacao = 'descartado' RETURNING id"
    ).bind(item.id).first();
    if (!alterado) throw new HttpError(409, 'Esta questão acabou de ser alterada.');
    const admId = await admUsuarioId(env);
    await env.DB.prepare("INSERT INTO eventos (usuario_id, acao, item_id, detalhe) VALUES (?, 'descarte_desfeito', ?, ?)")
      .bind(admId, item.id, JSON.stringify({ adm: sessao.email, codigo: item.codigo })).run();
    const sup = await supervisorDaDisciplina(env, item.disciplina);
    if (sup) avisar(env, sup.email, 'ATLAS: questão ' + item.codigo + ' voltou para análise',
      'O administrador desfez o descarte da questão ' + item.codigo + '. Ela voltou para a sua fila de análise.\n\n' + LINK_ATLAS);
    return { ok: true, item: { codigo: item.codigo, situacao: 'analise' } };
  }

  // Correção pelo ADM de questão aprovada (nova versão; continua aprovada).
  if (!m[2] && request.method === 'PUT') {
    if (item.situacao !== 'aprovado') throw new HttpError(409, 'Só questões aprovadas são corrigidas pela Administração.');
    const body = await readJson(request, MAX_ITEM_BYTES + 64 * 1024);
    if (body.versao !== item.versao_atual) throw new HttpError(409, 'A questão mudou desde que você a abriu. Busque de novo.');
    const grp = await gravacaoDoGrupo(env, item, await validarDadosComImagens(env, body.dados), await admUsuarioId(env), 'adm');
    const dados = grp.dados;
    const consertoId = body.conserto_id === undefined || body.conserto_id === null ? null : Number(body.conserto_id);
    let conserto = null;
    if (consertoId !== null) {
      conserto = await env.DB.prepare("SELECT id, solicitante_id FROM consertos WHERE id = ? AND item_id = ? AND situacao = 'pendente'").bind(consertoId, item.id).first();
      if (!conserto) throw new HttpError(409, 'Pedido de conserto não encontrado ou já resolvido.');
    }
    const admId = await admUsuarioId(env);
    const nova = item.versao_atual + 1;
    const ops = [
      ...grp.ops,
      env.DB.prepare('INSERT INTO item_versoes (item_id, versao, dados, autor_id) VALUES (?, ?, ?, ?)').bind(item.id, nova, dados, admId),
      env.DB.prepare("UPDATE itens SET versao_atual = ?, assinatura = NULL, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND versao_atual = ? AND situacao = 'aprovado'")
        .bind(nova, item.id, item.versao_atual),
      env.DB.prepare("INSERT INTO eventos (usuario_id, acao, item_id, detalhe) VALUES (?, 'item_corrigido_adm', ?, ?)")
        .bind(admId, item.id, JSON.stringify({ adm: sessao.email, codigo: item.codigo, versao: nova, conserto: consertoId }))
    ];
    if (conserto) ops.push(env.DB.prepare("UPDATE consertos SET situacao = 'feito', resolvido_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND situacao = 'pendente'").bind(conserto.id));
    try { await env.DB.batch(ops); }
    catch (error) {
      if (/UNIQUE|PRIMARY/i.test(String(error && error.message))) throw new HttpError(409, 'A questão acabou de ser alterada. Busque de novo.');
      throw error;
    }
    if (conserto) {
      const sup = await env.DB.prepare('SELECT email FROM usuarios WHERE id = ?').bind(conserto.solicitante_id).first();
      if (sup) avisar(env, sup.email, 'ATLAS: conserto da questão ' + item.codigo + ' realizado',
        'O administrador fez o conserto que você pediu na questão ' + item.codigo + ' (agora na versão ' + nova + ').\n\n' + LINK_ATLAS);
    }
    return { ok: true, item: { codigo: item.codigo, situacao: 'aprovado', versao: nova } };
  }
  throw new HttpError(404, 'Rota indisponível.');
}

// ---------- BQI: seleções de questões para provas ----------
// A série (1ª–3ª) e o tipo (REG/MED) pertencem à seleção, não à questão.
// Regra de uso: a questão não volta ao mesmo par série/tipo no mesmo ano e acompanha a turma
// nos anos seguintes (aplicada na 1ª série em X não é oferecida à 2ª em X+1 nem à 3ª em X+2, mesmo tipo).
// "Aplicada" só quando o ADM marca a prova como enviada aos alunos.
const SERIES_SELECAO = [1, 2, 3];
const TIPOS_SELECAO = ['REG', 'MED'];
const MAX_ITENS_SELECAO = 200;
const NOME_SERIE = s => s + 'ª série';

function anoAtualSP() {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date()));
}
// Use com .bind(..., tipo, ano, serie, ano).
const SQL_ITEM_BLOQUEADO =
  "EXISTS (SELECT 1 FROM selecao_itens bi JOIN selecoes bs ON bs.id = bi.selecao_id " +
  "WHERE bi.item_id = i.id AND bs.situacao = 'aplicada' AND bs.tipo = ? AND bs.ano <= ? AND (bs.serie - bs.ano) = (? - ?))";

// Questão de grupo só entra quando todas as questões do grupo (fora as descartadas) estão aprovadas
// e nenhuma delas já foi usada para a turma. Use com .bind(..., tipo, ano, serie, ano).
const SQL_GRUPO_DISPONIVEL =
  "(i.grupo_id IS NULL OR (NOT EXISTS (SELECT 1 FROM itens g2 WHERE g2.grupo_id = i.grupo_id AND g2.situacao NOT IN ('aprovado','descartado')) " +
  "AND NOT EXISTS (SELECT 1 FROM itens g3 WHERE g3.grupo_id = i.grupo_id AND g3.situacao = 'aprovado' AND " +
  SQL_ITEM_BLOQUEADO.replace('bi.item_id = i.id', 'bi.item_id = g3.id') + ")))";

const SQL_ITEM_BANCO =
  "SELECT i.id, i.codigo, i.versao_atual, u.nome AS autor, " +
  "json_extract(v.dados, '$.assunto') AS assunto, json_extract(v.dados, '$.subtema') AS subtema, " +
  "json_extract(v.dados, '$.dificuldade') AS dificuldade, json_extract(v.dados, '$.origem') AS origem, " +
  "json_extract(v.dados, '$.fonte') AS fonte, json_extract(v.dados, '$.bloom') AS bloom, " +
  "json_extract(v.dados, '$.gabarito') AS gabarito, json_extract(v.dados, '$.tags') AS tags, substr(json_extract(v.dados, '$.comando'), 1, 800) AS comando, " +
  "i.grupo_id, i.ordem_grupo, (SELECT gg.codigo FROM grupos gg WHERE gg.id = i.grupo_id) AS grupo_codigo " +
  "FROM itens i JOIN usuarios u ON u.id = i.autor_id JOIN item_versoes v ON v.item_id = i.id AND v.versao = i.versao_atual ";

function validarSerieTipo(body) {
  const serie = Number(body.serie);
  const tipo = String(body.tipo || '').toUpperCase();
  if (!SERIES_SELECAO.includes(serie)) throw new HttpError(400, 'Escolha a série (1ª, 2ª ou 3ª).');
  if (!TIPOS_SELECAO.includes(tipo)) throw new HttpError(400, 'Escolha o tipo (REG ou MED).');
  return { serie, tipo };
}
function validarTitulo(v) {
  const t = String(v ?? '').trim();
  if (t.length > 120) throw new HttpError(400, 'O título pode ter até 120 caracteres.');
  return t || null;
}

// Usos das questões da disciplina em seleções enviadas ou aplicadas (para mostrar ao Supervisor).
async function usosDaDisciplina(env, disciplina) {
  const { results } = await env.DB.prepare(
    "SELECT si.item_id, s.id, s.serie, s.tipo, s.ano, s.situacao FROM selecao_itens si JOIN selecoes s ON s.id = si.selecao_id " +
    "WHERE s.disciplina = ? AND s.situacao IN ('enviada','aplicada')"
  ).bind(disciplina).all();
  const mapa = new Map();
  for (const r of results) {
    if (!mapa.has(r.item_id)) mapa.set(r.item_id, []);
    mapa.get(r.item_id).push({ selecao: r.id, serie: r.serie, tipo: r.tipo, ano: r.ano, situacao: r.situacao });
  }
  return mapa;
}

async function selecaoDaDisciplina(env, id, disciplina) {
  const sel = await env.DB.prepare(
    "SELECT s.*, u.nome AS supervisor FROM selecoes s JOIN usuarios u ON u.id = s.supervisor_id WHERE s.id = ?"
  ).bind(Number(id)).first();
  if (!sel || (disciplina && sel.disciplina !== disciplina)) throw new HttpError(404, 'Seleção não encontrada.');
  return sel;
}

async function itensDaSelecao(env, sel, comDados) {
  const ano = anoAtualSP();
  const { results } = await env.DB.prepare(
    "SELECT i.id, i.codigo, i.versao_atual, i.situacao AS situacao_item, si.ordem, si.versao, si.grupo_versao, i.grupo_id, u.nome AS autor, " +
    "json_extract(v.dados, '$.assunto') AS assunto, json_extract(v.dados, '$.subtema') AS subtema, " +
    "json_extract(v.dados, '$.dificuldade') AS dificuldade, json_extract(v.dados, '$.origem') AS origem, " +
    "json_extract(v.dados, '$.bloom') AS bloom, json_extract(v.dados, '$.gabarito') AS gabarito, " +
    (comDados ? "v.dados AS dados, " : "substr(json_extract(v.dados, '$.comando'), 1, 800) AS comando, ") +
    "(" + SQL_ITEM_BLOQUEADO + " AND NOT EXISTS (SELECT 1 FROM selecao_itens pi WHERE pi.selecao_id = ? AND pi.item_id = i.id AND ? = 'aplicada')) AS bloqueado " +
    "FROM selecao_itens si JOIN itens i ON i.id = si.item_id JOIN usuarios u ON u.id = i.autor_id " +
    // Rascunho mostra a versão atual; enviada/aplicada mostra a versão congelada no envio.
    "JOIN item_versoes v ON v.item_id = i.id AND v.versao = CASE WHEN ? = 'rascunho' THEN i.versao_atual ELSE si.versao END " +
    "WHERE si.selecao_id = ? ORDER BY si.ordem"
  ).bind(sel.tipo, sel.ano || ano, sel.serie, sel.ano || ano, sel.id, sel.situacao, sel.situacao, sel.id).all();
  const out = [];
  for (const { id, dados, grupo_id, grupo_versao, ...r } of results) {
    const versaoGrupo = sel.situacao === 'rascunho' ? null : grupo_versao;
    const inj = grupo_id ? await injetarGrupo(env, grupo_id, comDados ? JSON.parse(dados) : {}, versaoGrupo) : { dados: comDados ? JSON.parse(dados) : null, grupo: null };
    out.push({ ...r, ...(comDados ? { dados: inj.dados } : {}), grupo: inj.grupo ? { codigo: inj.grupo.codigo, versao: inj.grupo.versao, versao_atual: inj.grupo.versao_atual } : null });
  }
  return out;
}

async function rotasSelecoesSupervisor(request, env, path, url, user) {
  if (!path.startsWith('/api/supervisor/selecoes') && path !== '/api/supervisor/banco') return null;
  const ano = anoAtualSP();

  // Banco: questões aprovadas da disciplina, do Ensino Médio, elegíveis para a série/tipo da seleção.
  if (path === '/api/supervisor/banco' && request.method === 'GET') {
    const sel = await selecaoDaDisciplina(env, url.searchParams.get('selecao'), user.disciplina);
    const filtros = []; const args = [user.disciplina, sel.tipo, ano, sel.serie, ano, sel.tipo, ano, sel.serie, ano];
    const f = (campo, nome) => { const v = (url.searchParams.get(nome) || '').trim(); if (v) { filtros.push("json_extract(v.dados, '$." + campo + "') = ?"); args.push(v.slice(0, 200)); } };
    f('assunto', 'assunto'); f('dificuldade', 'dificuldade'); f('origem', 'origem'); f('bloom', 'bloom');
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    if (q) {
      filtros.push("(i.codigo = ? OR json_extract(v.dados, '$.comando') LIKE ? OR json_extract(v.dados, '$.texto-base') LIKE ? OR json_extract(v.dados, '$.subtema') LIKE ? OR EXISTS (SELECT 1 FROM json_each(v.dados, '$.tags') jt WHERE jt.value LIKE ?))");
      const like = '%' + q.replace(/[%_]/g, '') + '%';
      args.push(q.toUpperCase(), like, like, like, like.toLocaleLowerCase('pt-BR'));
    }
    const tag = (url.searchParams.get('tag') || '').replace(/^#+/, '').trim().toLocaleLowerCase('pt-BR').slice(0, 40);
    if (tag) { filtros.push("EXISTS (SELECT 1 FROM json_each(v.dados, '$.tags') jt WHERE jt.value = ?)"); args.push(tag); }
    const { results } = await env.DB.prepare(
      SQL_ITEM_BANCO + "WHERE i.disciplina = ? AND i.situacao = 'aprovado' AND json_extract(v.dados, '$.etapa') = 'em' AND NOT " + SQL_ITEM_BLOQUEADO +
      " AND " + SQL_GRUPO_DISPONIVEL +
      (filtros.length ? ' AND ' + filtros.join(' AND ') : '') + " ORDER BY assunto COLLATE NOCASE, i.codigo LIMIT 301"
    ).bind(...args).all();
    // Um grupo aparece inteiro: traz as questões irmãs que o filtro não pegou.
    const vistos = new Set(results.map(r => r.id));
    for (const gid of [...new Set(results.filter(r => r.grupo_id).map(r => r.grupo_id))].slice(0, 60)) {
      const { results: irmas } = await env.DB.prepare(SQL_ITEM_BANCO + "WHERE i.grupo_id = ? AND i.situacao = 'aprovado'").bind(gid).all();
      for (const r of irmas) if (!vistos.has(r.id)) { vistos.add(r.id); results.push(r); }
    }
    const totais = {};
    for (const r of results) if (r.grupo_id) totais[r.grupo_id] = (totais[r.grupo_id] || 0) + 1;
    const { results: assuntos } = await env.DB.prepare(
      "SELECT DISTINCT json_extract(v.dados, '$.assunto') AS a FROM itens i JOIN item_versoes v ON v.item_id = i.id AND v.versao = i.versao_atual " +
      "WHERE i.disciplina = ? AND i.situacao = 'aprovado' ORDER BY a COLLATE NOCASE"
    ).bind(user.disciplina).all();
    const usos = await usosDaDisciplina(env, user.disciplina);
    const itens = results.slice(0, 360).map(({ id, tags, grupo_id, ordem_grupo, grupo_codigo, ...r }) => ({ ...r, tags: tags ? JSON.parse(tags) : [], usos: usos.get(id) || [],
      grupo: grupo_id ? { codigo: grupo_codigo, ordem: ordem_grupo, total: totais[grupo_id] } : null }));
    return { ok: true, itens, mais: results.length > 300, assuntos: assuntos.map(x => x.a).filter(Boolean) };
  }

  if (path === '/api/supervisor/selecoes' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      "SELECT s.id, s.serie, s.tipo, s.titulo, s.situacao, s.ano, s.motivo_devolucao, s.criado_em, s.atualizado_em, s.enviada_em, s.aplicada_em, " +
      "u.nome AS supervisor, (SELECT COUNT(*) FROM selecao_itens si WHERE si.selecao_id = s.id) AS total " +
      "FROM selecoes s JOIN usuarios u ON u.id = s.supervisor_id WHERE s.disciplina = ? " +
      "ORDER BY CASE s.situacao WHEN 'rascunho' THEN 0 WHEN 'enviada' THEN 1 ELSE 2 END, s.id DESC LIMIT 300"
    ).bind(user.disciplina).all();
    return { ok: true, disciplina: user.disciplina, ano, selecoes: results };
  }

  if (path === '/api/supervisor/selecoes' && request.method === 'POST') {
    const body = await readJson(request);
    const { serie, tipo } = validarSerieTipo(body);
    const titulo = validarTitulo(body.titulo);
    const row = await env.DB.prepare(
      'INSERT INTO selecoes (disciplina, supervisor_id, serie, tipo, titulo) VALUES (?, ?, ?, ?, ?) RETURNING id'
    ).bind(user.disciplina, user.id, serie, tipo, titulo).first();
    await registrar(env, 'selecao_criada', { selecao: row.id, serie, tipo }, user.id);
    return { ok: true, selecao: { id: row.id } };
  }

  const m = path.match(/^\/api\/supervisor\/selecoes\/(\d+)(\/enviar)?$/);
  if (!m) throw new HttpError(404, 'Rota indisponível.');
  const sel = await selecaoDaDisciplina(env, m[1], user.disciplina);

  if (!m[2] && request.method === 'GET') {
    return { ok: true, ano, selecao: { ...sel, itens: await itensDaSelecao(env, sel, false) } };
  }

  if (sel.situacao !== 'rascunho') {
    throw new HttpError(409, sel.situacao === 'enviada' ? 'Esta seleção já foi enviada ao administrador.' : 'Esta seleção já foi aplicada.');
  }

  if (!m[2] && request.method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM selecao_itens WHERE selecao_id = ?').bind(sel.id),
      env.DB.prepare("DELETE FROM selecoes WHERE id = ? AND situacao = 'rascunho'").bind(sel.id)
    ]);
    await registrar(env, 'selecao_excluida', { selecao: sel.id }, user.id);
    return { ok: true };
  }

  if (!m[2] && request.method === 'PUT') {
    const body = await readJson(request);
    const { serie, tipo } = validarSerieTipo({ serie: body.serie ?? sel.serie, tipo: body.tipo ?? sel.tipo });
    const titulo = body.titulo === undefined ? sel.titulo : validarTitulo(body.titulo);
    const codigos = Array.isArray(body.itens) ? body.itens.map(c => String(c).toUpperCase()) : [];
    if (codigos.length > MAX_ITENS_SELECAO) throw new HttpError(400, 'Uma seleção pode ter até ' + MAX_ITENS_SELECAO + ' questões.');
    if (new Set(codigos).size !== codigos.length) throw new HttpError(400, 'Há questões repetidas na seleção.');
    // Candidatas válidas: aprovadas, da disciplina, do Ensino Médio e elegíveis para a série/tipo.
    const { results } = await env.DB.prepare(
      "SELECT i.id, i.codigo, i.versao_atual, i.grupo_id, i.ordem_grupo FROM itens i JOIN item_versoes v ON v.item_id = i.id AND v.versao = i.versao_atual " +
      "WHERE i.disciplina = ? AND i.situacao = 'aprovado' AND json_extract(v.dados, '$.etapa') = 'em' AND NOT " + SQL_ITEM_BLOQUEADO + " AND " + SQL_GRUPO_DISPONIVEL
    ).bind(user.disciplina, tipo, ano, serie, ano, tipo, ano, serie, ano).all();
    const validas = new Map(results.map(r => [r.codigo, r]));
    const invalidas = codigos.filter(c => !validas.has(c));
    if (invalidas.length) {
      throw new HttpError(409, 'Estas questões não podem entrar nesta seleção (não aprovadas, de outra disciplina ou já usadas para ' +
        NOME_SERIE(serie) + ' ' + tipo + '): ' + invalidas.slice(0, 20).join(', ') + '.');
    }
    // Grupo (testlet) vai inteiro e com as questões juntas, na ordem do grupo.
    const membrosGrupo = new Map();
    for (const r of results) if (r.grupo_id) { if (!membrosGrupo.has(r.grupo_id)) membrosGrupo.set(r.grupo_id, []); membrosGrupo.get(r.grupo_id).push(r); }
    for (const lista of membrosGrupo.values()) lista.sort((a, b) => (a.ordem_grupo || 0) - (b.ordem_grupo || 0));
    const ordenados = []; const gruposPostos = new Set();
    for (const c of codigos) {
      const r = validas.get(c);
      if (!r.grupo_id) { ordenados.push(c); continue; }
      if (gruposPostos.has(r.grupo_id)) continue;
      const membros = membrosGrupo.get(r.grupo_id);
      const faltam = membros.filter(m => !codigos.includes(m.codigo)).map(m => m.codigo);
      if (faltam.length) throw new HttpError(409, 'Questões de grupo (texto compartilhado) entram juntas. Inclua também: ' + faltam.join(', ') + '.');
      gruposPostos.add(r.grupo_id); for (const m of membros) ordenados.push(m.codigo);
    }
    codigos.splice(0, codigos.length, ...ordenados);
    const ops = [
      env.DB.prepare("UPDATE selecoes SET serie = ?, tipo = ?, titulo = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND situacao = 'rascunho'")
        .bind(serie, tipo, titulo, sel.id),
      env.DB.prepare('DELETE FROM selecao_itens WHERE selecao_id = ?').bind(sel.id),
      ...codigos.map((c, k) => env.DB.prepare('INSERT INTO selecao_itens (selecao_id, item_id, ordem, versao) VALUES (?, ?, ?, ?)')
        .bind(sel.id, validas.get(c).id, k + 1, validas.get(c).versao_atual))
    ];
    await env.DB.batch(ops);
    return { ok: true, selecao: { id: sel.id, total: codigos.length } };
  }

  if (m[2] && request.method === 'POST') {
    const itens = await itensDaSelecao(env, sel, false);
    if (!itens.length) throw new HttpError(400, 'Adicione pelo menos uma questão antes de enviar.');
    const problemas = itens.filter(i => i.bloqueado || i.situacao_item !== 'aprovado').map(i => i.codigo);
    if (problemas.length) throw new HttpError(409, 'Retire da seleção as questões que não estão mais disponíveis: ' + problemas.join(', ') + '.');
    const enviada = await env.DB.prepare(
      "UPDATE selecoes SET situacao = 'enviada', enviada_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), motivo_devolucao = NULL " +
      "WHERE id = ? AND situacao = 'rascunho' RETURNING id"
    ).bind(sel.id).first();
    if (!enviada) throw new HttpError(409, 'Esta seleção acabou de ser alterada.');
    await env.DB.prepare('UPDATE selecao_itens SET versao = (SELECT versao_atual FROM itens WHERE itens.id = selecao_itens.item_id), ' +
      'grupo_versao = (SELECT g.versao_atual FROM grupos g JOIN itens it ON it.grupo_id = g.id WHERE it.id = selecao_itens.item_id) WHERE selecao_id = ?')
      .bind(sel.id).run();
    await registrar(env, 'selecao_enviada', { selecao: sel.id, total: itens.length }, user.id);
    avisar(env, env.ADMIN_EMAIL, 'ATLAS: seleção de ' + user.disciplina + ' recebida (' + NOME_SERIE(sel.serie) + ' ' + sel.tipo + ')',
      user.nome + ' (Supervisor de ' + user.disciplina + ') enviou a seleção #' + sel.id + (sel.titulo ? ' — ' + sel.titulo : '') +
      ', com ' + itens.length + ' questões para a ' + NOME_SERIE(sel.serie) + ' ' + sel.tipo + '.\n\n' + LINK_ATLAS + 'admin-selecoes.html?id=' + sel.id);
    return { ok: true, selecao: { id: sel.id, situacao: 'enviada' } };
  }
  throw new HttpError(404, 'Rota indisponível.');
}

async function rotasSelecoesAdm(request, env, path, url, sessao) {
  if (!path.startsWith('/api/adm/selecoes')) return null;
  if (path === '/api/adm/selecoes' && request.method === 'GET') {
    const situacao = url.searchParams.get('situacao') || 'enviada';
    if (!['enviada', 'aplicada'].includes(situacao)) throw new HttpError(400, 'Situação inválida.');
    const { results } = await env.DB.prepare(
      "SELECT s.id, s.disciplina, s.serie, s.tipo, s.titulo, s.situacao, s.ano, s.enviada_em, s.aplicada_em, u.nome AS supervisor, " +
      "(SELECT COUNT(*) FROM selecao_itens si WHERE si.selecao_id = s.id) AS total " +
      "FROM selecoes s JOIN usuarios u ON u.id = s.supervisor_id WHERE s.situacao = ? ORDER BY " +
      (situacao === 'enviada' ? 's.enviada_em ASC' : 's.aplicada_em DESC') + " LIMIT 300"
    ).bind(situacao).all();
    return { ok: true, ano: anoAtualSP(), selecoes: results };
  }
  const m = path.match(/^\/api\/adm\/selecoes\/(\d+)(\/aplicar|\/devolver)?$/);
  if (!m) throw new HttpError(404, 'Rota indisponível.');
  const sel = await selecaoDaDisciplina(env, m[1], null);
  if (sel.situacao === 'rascunho') throw new HttpError(404, 'Seleção não encontrada.');

  if (!m[2] && request.method === 'GET') {
    return { ok: true, selecao: { ...sel, itens: await itensDaSelecao(env, sel, true) } };
  }
  if (sel.situacao !== 'enviada') throw new HttpError(409, 'Esta seleção já foi aplicada.');
  const admId = await admUsuarioId(env);

  if (m[2] === '/aplicar' && request.method === 'POST') {
    const ano = anoAtualSP();
    const { results: conflitos } = await env.DB.prepare(
      "SELECT i.codigo FROM selecao_itens si JOIN itens i ON i.id = si.item_id WHERE si.selecao_id = ? AND " + SQL_ITEM_BLOQUEADO
    ).bind(sel.id, sel.tipo, ano, sel.serie, ano).all();
    if (conflitos.length) {
      throw new HttpError(409, 'Estas questões já foram aplicadas para esta turma (' + NOME_SERIE(sel.serie) + ' ' + sel.tipo + '): ' +
        conflitos.map(c => c.codigo).join(', ') + '. Devolva a seleção ao Supervisor para trocá-las.');
    }
    const ok = await env.DB.prepare(
      "UPDATE selecoes SET situacao = 'aplicada', ano = ?, aplicada_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') " +
      "WHERE id = ? AND situacao = 'enviada' RETURNING id"
    ).bind(ano, sel.id).first();
    if (!ok) throw new HttpError(409, 'Esta seleção acabou de ser alterada.');
    await registrar(env, 'selecao_aplicada', { adm: sessao.email, selecao: sel.id, ano }, admId);
    return { ok: true, selecao: { id: sel.id, situacao: 'aplicada', ano } };
  }

  if (m[2] === '/devolver' && request.method === 'POST') {
    const body = await readJson(request);
    const motivo = String(body.motivo ?? '').trim();
    if (motivo.length < 3 || motivo.length > 2000) throw new HttpError(400, 'Explique ao Supervisor o que precisa mudar.');
    const ok = await env.DB.prepare(
      "UPDATE selecoes SET situacao = 'rascunho', motivo_devolucao = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND situacao = 'enviada' RETURNING id"
    ).bind(motivo, sel.id).first();
    if (!ok) throw new HttpError(409, 'Esta seleção acabou de ser alterada.');
    await registrar(env, 'selecao_devolvida', { adm: sessao.email, selecao: sel.id }, admId);
    const destinos = new Set();
    const criador = await env.DB.prepare('SELECT email FROM usuarios WHERE id = ? AND ativo = 1').bind(sel.supervisor_id).first();
    if (criador) destinos.add(criador.email);
    const atual = await supervisorDaDisciplina(env, sel.disciplina);
    if (atual) destinos.add(atual.email);
    for (const para of destinos) {
      avisar(env, para, 'ATLAS: seleção #' + sel.id + ' devolvida pelo administrador',
        'O administrador devolveu a seleção #' + sel.id + ' (' + NOME_SERIE(sel.serie) + ' ' + sel.tipo + ') para ajustes:\n\n' + motivo +
        '\n\n' + LINK_ATLAS + 'supervisor-selecoes.html?id=' + sel.id);
    }
    return { ok: true, selecao: { id: sel.id, situacao: 'rascunho' } };
  }
  throw new HttpError(404, 'Rota indisponível.');
}

// ---------- cópias de segurança (banco D1 -> R2, pasta "backups/") ----------
// Automática todo dia de madrugada (cron no wrangler.toml) e manual pela Administração.
// Guarda as tabelas de conteúdo e cadastro; não guarda sessões nem códigos de login.
// As imagens já ficam no R2 e não são copiadas de novo.
const TABELAS_BACKUP = ['meta', 'usuarios', 'retiradas', 'grupos', 'grupo_versoes', 'itens', 'item_versoes', 'revisoes', 'consertos', 'selecoes', 'selecao_itens', 'eventos'];
const MANTER_BACKUPS = 60;

async function fazerBackup(env, origem) {
  if (!env.IMAGENS) throw new HttpError(503, 'Armazenamento indisponível para a cópia de segurança.');
  const copia = { atlas_backup: 1, criado_em: agoraIso(), origem, tabelas: {} };
  for (const tabela of TABELAS_BACKUP) {
    const linhas = [];
    for (let ultimo = -1; ;) {
      const { results } = await env.DB.prepare('SELECT rowid AS _rowid, * FROM ' + tabela + ' WHERE rowid > ? ORDER BY rowid LIMIT 500').bind(ultimo).all();
      for (const r of results) { ultimo = r._rowid; const { _rowid, ...resto } = r; linhas.push(resto); }
      if (results.length < 500) break;
    }
    copia.tabelas[tabela] = linhas;
  }
  const nome = 'backups/atlas-' + copia.criado_em.replace(/[:]/g, '-') + '.json';
  const texto = JSON.stringify(copia);
  await env.IMAGENS.put(nome, texto, { httpMetadata: { contentType: 'application/json' }, customMetadata: { origem } });
  // Mantém só as mais recentes.
  const lista = await listarBackups(env);
  for (const velho of lista.slice(MANTER_BACKUPS)) await env.IMAGENS.delete(velho.chave);
  await registrar(env, 'backup_feito', { origem, arquivo: nome, bytes: texto.length, itens: copia.tabelas.itens.length });
  return { nome: nome.slice('backups/'.length), bytes: texto.length, itens: copia.tabelas.itens.length };
}
async function listarBackups(env) {
  const todos = [];
  let cursor;
  do {
    const r = await env.IMAGENS.list({ prefix: 'backups/', cursor });
    for (const o of r.objects) todos.push({ chave: o.key, nome: o.key.slice('backups/'.length), bytes: o.size, criado_em: o.uploaded instanceof Date ? o.uploaded.toISOString() : String(o.uploaded || '') });
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return todos.sort((a, b) => (a.nome < b.nome ? 1 : -1));
}
async function rotasBackupAdm(request, env, path, sessao) {
  if (!path.startsWith('/api/adm/backups')) return null;
  if (!env.IMAGENS) throw new HttpError(503, 'Armazenamento indisponível.');
  if (path === '/api/adm/backups' && request.method === 'GET') {
    const lista = await listarBackups(env);
    return { ok: true, backups: lista.map(({ chave, ...b }) => b) };
  }
  if (path === '/api/adm/backups' && request.method === 'POST') {
    const permitido = await contarTentativaLogin(env, 'adm-backup-manual', 60, 1);
    if (!permitido) throw new HttpError(429, 'Aguarde um minuto antes de fazer outra cópia.');
    return { ok: true, backup: await fazerBackup(env, 'manual:' + sessao.email) };
  }
  const m = path.match(/^\/api\/adm\/backups\/(atlas-[0-9TZ-]+\.json)$/);
  if (m && request.method === 'GET') {
    const obj = await env.IMAGENS.get('backups/' + m[1]);
    if (!obj) throw new HttpError(404, 'Cópia não encontrada.');
    return { __arquivo: true, nome: m[1], corpo: obj.body };
  }
  throw new HttpError(404, 'Rota indisponível.');
}

// ---------- relatório de produção (ADM) ----------
const AREAS = Object.freeze({
  LC: ['Português', 'Literatura', 'Inglês', 'Artes'],
  CH: ['História', 'Geografia', 'Filosofia', 'Sociologia'],
  CN: ['Física', 'Química', 'Biologia'],
  MT: ['Matemática']
});
// Por autor: questões enviadas em cada mês do ano (horário de Brasília) e a situação delas hoje.
async function relatorioProducao(env, url) {
  const ano = Number(url.searchParams.get('ano')) || anoAtualSP();
  if (ano < 2020 || ano > 2100) throw new HttpError(400, 'Ano inválido.');
  const recorte = url.searchParams.get('recorte') || 'todos';
  const valor = (url.searchParams.get('valor') || '').trim();
  let disciplinas = DISCIPLINAS.slice(), autorId = null;
  if (recorte === 'area') { if (!AREAS[valor]) throw new HttpError(400, 'Área inválida.'); disciplinas = AREAS[valor]; }
  else if (recorte === 'disciplina') disciplinas = [limparDisciplina(valor)];
  else if (recorte === 'professor') { autorId = Number(valor); if (!autorId) throw new HttpError(400, 'Escolha o professor.'); }
  else if (recorte !== 'todos') throw new HttpError(400, 'Recorte inválido.');
  const marcas = disciplinas.map(() => '?').join(',');
  const filtroAutor = autorId ? ' AND i.autor_id = ?' : '';
  const args = [String(ano), ...disciplinas, ...(autorId ? [autorId] : [])];
  const { results: meses } = await env.DB.prepare(
    "SELECT i.autor_id, CAST(strftime('%m', datetime(i.criado_em, '-3 hours')) AS INTEGER) AS mes, COUNT(*) AS n FROM itens i " +
    "WHERE strftime('%Y', datetime(i.criado_em, '-3 hours')) = ? AND i.disciplina IN (" + marcas + ")" + filtroAutor + " GROUP BY i.autor_id, mes"
  ).bind(...args).all();
  const { results: situacoes } = await env.DB.prepare(
    "SELECT i.autor_id, i.situacao, COUNT(*) AS n FROM itens i " +
    "WHERE strftime('%Y', datetime(i.criado_em, '-3 hours')) = ? AND i.disciplina IN (" + marcas + ")" + filtroAutor + " GROUP BY i.autor_id, i.situacao"
  ).bind(...args).all();
  const { results: correcoes } = await env.DB.prepare(
    "SELECT i.autor_id, COUNT(*) AS n FROM eventos e JOIN itens i ON i.id = e.item_id " +
    "WHERE e.acao = 'item_reenviado' AND strftime('%Y', datetime(e.criado_em, '-3 hours')) = ? AND i.disciplina IN (" + marcas + ")" + filtroAutor + " GROUP BY i.autor_id"
  ).bind(...args).all();
  // Professores ativos do recorte aparecem mesmo sem envio (para ver quem não está alimentando o banco).
  let pessoas;
  if (autorId) {
    pessoas = (await env.DB.prepare("SELECT id, nome, disciplina, papel, digitador, ativo FROM usuarios WHERE id = ?").bind(autorId).all()).results;
  } else {
    pessoas = (await env.DB.prepare(
      "SELECT id, nome, disciplina, papel, digitador, ativo FROM usuarios WHERE (papel IN ('professor','supervisor') AND digitador = 0 AND ativo = 1 AND disciplina IN (" + marcas + ")) " +
      "OR id IN (SELECT DISTINCT autor_id FROM itens WHERE strftime('%Y', datetime(criado_em, '-3 hours')) = ? AND disciplina IN (" + marcas + "))"
    ).bind(...disciplinas, String(ano), ...disciplinas).all()).results;
  }
  const linhas = new Map();
  for (const p of pessoas) {
    linhas.set(p.id, {
      id: p.id, nome: p.papel === 'adm' ? 'ADM' : p.nome,
      tipo: p.papel === 'adm' ? 'adm' : p.digitador === 1 ? 'digitador' : (p.papel === 'supervisor' ? 'supervisor' : 'professor'),
      disciplina: p.disciplina || '', ativo: p.ativo === 1,
      meses: Array(12).fill(0), total: 0, aprovado: 0, analise: 0, ajustes: 0, descartado: 0, corrigidas: 0
    });
  }
  for (const r of meses) { const l = linhas.get(r.autor_id); if (l) { l.meses[r.mes - 1] += r.n; l.total += r.n; } }
  for (const r of situacoes) { const l = linhas.get(r.autor_id); if (l && r.situacao in l) l[r.situacao] += r.n; }
  for (const r of correcoes) { const l = linhas.get(r.autor_id); if (l) l.corrigidas += r.n; }
  const ordemTipo = { professor: 0, supervisor: 0, digitador: 1, adm: 2 };
  const lista = [...linhas.values()].sort((a, b) => (ordemTipo[a.tipo] - ordemTipo[b.tipo]) || (b.total - a.total) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const totais = { meses: Array(12).fill(0), total: 0, aprovado: 0, analise: 0, ajustes: 0, descartado: 0, corrigidas: 0 };
  for (const l of lista) { l.meses.forEach((n, k) => { totais.meses[k] += n; }); for (const k of ['total', 'aprovado', 'analise', 'ajustes', 'descartado', 'corrigidas']) totais[k] += l[k]; }
  return { ok: true, ano, recorte, valor, areas: AREAS, disciplinas: DISCIPLINAS, linhas: lista, totais };
}

// ---------- retirada das questões autorais de professor desligado ----------
// Etapas: (1) o professor precisa estar DESATIVADO; (2) o ADM confirma o desligamento e informa o motivo;
// (3) digita o nome completo do professor; (4) confere o total. As questões saem do banco (ficam como
// descartadas) e podem voltar a qualquer momento durante MESES_RETIRADA meses. Vencido o prazo, o ADM
// recebe um e-mail e um aviso na Administração perguntando se exclui definitivamente.
const MESES_RETIRADA = 6, MESES_ADIAR = 3;
function somarMeses(dataISO, n) {
  const [a, m, d] = dataISO.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}
function mesmoNome(a, b) {
  const n = v => String(v || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  return !!n(a) && n(a) === n(b);
}
async function autoraisDe(env, usuarioId) {
  const { results } = await env.DB.prepare(
    "SELECT i.id, i.codigo, i.situacao, i.grupo_id, (SELECT COUNT(*) FROM selecao_itens si WHERE si.item_id = i.id) AS em_selecoes FROM itens i " +
    "JOIN item_versoes v ON v.item_id = i.id AND v.versao = i.versao_atual " +
    "WHERE i.autor_id = ? AND i.retirada_id IS NULL AND json_extract(v.dados, '$.origem') = 'autoral' ORDER BY i.id"
  ).bind(usuarioId).all();
  return results;
}
function contarSituacoes(lista) {
  const c = { aprovado: 0, analise: 0, ajustes: 0, descartado: 0, rascunho: 0 };
  for (const i of lista) c[i.situacao] = (c[i.situacao] || 0) + 1;
  return c;
}
async function retiradaPorId(env, id) {
  const r = await env.DB.prepare('SELECT r.*, u.nome, u.email, u.ativo FROM retiradas r JOIN usuarios u ON u.id = r.usuario_id WHERE r.id = ?').bind(id).first();
  if (!r) throw new HttpError(404, 'Retirada não encontrada.');
  return r;
}
function resumoRetirada(env, r) {
  const hoje = hojeSP(env);
  return { id: r.id, usuario_id: r.usuario_id, nome: r.nome, email: r.email, motivo: r.motivo, total: r.total, situacao: r.situacao,
    prazo_em: r.prazo_em, vencida: r.situacao === 'ativa' && r.prazo_em <= hoje, criado_em: r.criado_em, criado_por: r.criado_por,
    finalizado_em: r.finalizado_em, detalhe: r.detalhe ? JSON.parse(r.detalhe) : null };
}
async function rotasRetiradas(request, env, path, sessao) {
  if (path === '/api/adm/retiradas' && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT r.*, u.nome, u.email, u.ativo FROM retiradas r JOIN usuarios u ON u.id = r.usuario_id ORDER BY r.id DESC LIMIT 200').all();
    return { ok: true, meses: MESES_RETIRADA, retiradas: results.map(r => resumoRetirada(env, r)) };
  }
  if (path === '/api/adm/retiradas/previa' && request.method === 'GET') {
    const id = Number(new URL(request.url).searchParams.get('usuario'));
    const u = await env.DB.prepare("SELECT id, nome, email, disciplina, ativo FROM usuarios WHERE id = ? AND papel IN ('professor','supervisor')").bind(id).first();
    if (!u) throw new HttpError(404, 'Professor não encontrado.');
    if (u.ativo) throw new HttpError(409, 'Primeiro desative o cadastro do professor. Só professores desativados podem ter as questões retiradas.');
    const ativa = await env.DB.prepare("SELECT id FROM retiradas WHERE usuario_id = ? AND situacao = 'ativa'").bind(id).first();
    const lista = await autoraisDe(env, id);
    return { ok: true, professor: { id: u.id, nome: u.nome, email: u.email, disciplina: u.disciplina }, total: lista.length,
      por_situacao: contarSituacoes(lista), em_selecoes: lista.filter(i => i.em_selecoes > 0).length, retirada_ativa: ativa ? ativa.id : null,
      meses: MESES_RETIRADA, prazo_em: somarMeses(hojeSP(env), MESES_RETIRADA) };
  }
  if (path === '/api/adm/retiradas' && request.method === 'POST') {
    const body = await readJson(request);
    const id = Number(body.usuario_id);
    const u = await env.DB.prepare("SELECT id, nome, ativo FROM usuarios WHERE id = ? AND papel IN ('professor','supervisor')").bind(id).first();
    if (!u) throw new HttpError(404, 'Professor não encontrado.');
    if (u.ativo) throw new HttpError(409, 'Primeiro desative o cadastro do professor.');
    if (body.confirmo_desligamento !== true) throw new HttpError(400, 'Confirme que o professor foi desligado da escola.');
    const motivo = String(body.motivo || '').trim();
    if (motivo.length < 5 || motivo.length > 300) throw new HttpError(400, 'Informe o motivo (por exemplo: desligado em 10/12/2026).');
    if (!mesmoNome(body.nome_confirmacao, u.nome)) throw new HttpError(400, 'O nome digitado não confere com o cadastro. Digite o nome completo do professor.');
    if (await env.DB.prepare("SELECT id FROM retiradas WHERE usuario_id = ? AND situacao = 'ativa'").bind(id).first()) throw new HttpError(409, 'Este professor já tem uma retirada em andamento.');
    const lista = await autoraisDe(env, id);
    if (!lista.length) throw new HttpError(409, 'Este professor não tem questões autorais no banco.');
    if (Number(body.total_esperado) !== lista.length) throw new HttpError(409, 'O número de questões mudou desde a prévia. Feche e abra de novo.');
    const prazo = somarMeses(hojeSP(env), MESES_RETIRADA);
    const itens = lista.map(i => ({ id: i.id, codigo: i.codigo, situacao: i.situacao }));
    const r = await env.DB.prepare('INSERT INTO retiradas (usuario_id, motivo, itens, total, prazo_em, criado_por) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, motivo, JSON.stringify(itens), itens.length, prazo, sessao.email).run();
    const rid = r.meta.last_row_id;
    const admId = await admUsuarioId(env);
    const ops = itens.map(i => env.DB.prepare("UPDATE itens SET situacao = 'descartado', retirada_id = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND retirada_id IS NULL").bind(rid, i.id));
    ops.push(env.DB.prepare("INSERT INTO eventos (usuario_id, acao, detalhe) VALUES (?, 'questoes_retiradas', ?)").bind(admId, JSON.stringify({ adm: sessao.email, retirada: rid, professor: u.nome, total: itens.length, prazo, motivo })));
    await env.DB.batch(ops);
    return { ok: true, retirada: resumoRetirada(env, await retiradaPorId(env, rid)) };
  }
  const m = path.match(/^\/api\/adm\/retiradas\/(\d+)\/(desfazer|adiar|excluir)$/);
  if (!m || request.method !== 'POST') return null;
  const r = await retiradaPorId(env, Number(m[1]));
  if (r.situacao !== 'ativa') throw new HttpError(409, 'Esta retirada já foi encerrada.');
  const body = await readJson(request);
  const admId = await admUsuarioId(env);
  const vencida = r.prazo_em <= hojeSP(env);
  if (m[2] === 'desfazer') {
    if (!mesmoNome(body.nome_confirmacao, r.nome)) throw new HttpError(400, 'O nome digitado não confere com o cadastro.');
    const itens = JSON.parse(r.itens);
    const ops = itens.map(i => env.DB.prepare("UPDATE itens SET situacao = ?, retirada_id = NULL, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND retirada_id = ?").bind(i.situacao, i.id, r.id));
    ops.push(env.DB.prepare("UPDATE retiradas SET situacao = 'desfeita', finalizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND situacao = 'ativa'").bind(r.id));
    ops.push(env.DB.prepare("INSERT INTO eventos (usuario_id, acao, detalhe) VALUES (?, 'retirada_desfeita', ?)").bind(admId, JSON.stringify({ adm: sessao.email, retirada: r.id, professor: r.nome, total: itens.length })));
    await env.DB.batch(ops);
    return { ok: true, retirada: resumoRetirada(env, await retiradaPorId(env, r.id)) };
  }
  if (m[2] === 'adiar') {
    if (!vencida) throw new HttpError(409, 'O prazo ainda não venceu.');
    const prazo = somarMeses(hojeSP(env), MESES_ADIAR);
    await env.DB.prepare('UPDATE retiradas SET prazo_em = ?, aviso_enviado_em = NULL WHERE id = ?').bind(prazo, r.id).run();
    await registrar(env, 'retirada_adiada', { adm: sessao.email, retirada: r.id, professor: r.nome, prazo });
    return { ok: true, retirada: resumoRetirada(env, await retiradaPorId(env, r.id)) };
  }
  // excluir definitivamente
  if (!vencida) throw new HttpError(409, 'A exclusão definitiva só é liberada depois do prazo de ' + MESES_RETIRADA + ' meses (' + r.prazo_em.split('-').reverse().join('/') + ').');
  if (body.confirmo_exclusao !== true) throw new HttpError(400, 'Confirme que entende que a exclusão não pode ser desfeita.');
  if (!mesmoNome(body.nome_confirmacao, r.nome)) throw new HttpError(400, 'O nome digitado não confere com o cadastro.');
  // Cópia de segurança completa antes de apagar (se falhar, nada é apagado).
  const copia = await fazerBackup(env, 'antes-exclusao-' + r.id);
  const { results: atuais } = await env.DB.prepare('SELECT i.id, i.codigo, i.grupo_id, (SELECT COUNT(*) FROM selecao_itens si WHERE si.item_id = i.id) AS em_selecoes FROM itens i WHERE i.retirada_id = ?').bind(r.id).all();
  const apagar = atuais.filter(i => !i.em_selecoes), mantidas = atuais.filter(i => i.em_selecoes).map(i => i.codigo);
  const ops = [];
  for (const i of apagar) {
    ops.push(env.DB.prepare('DELETE FROM eventos WHERE item_id = ?').bind(i.id));
    ops.push(env.DB.prepare('DELETE FROM revisoes WHERE item_id = ?').bind(i.id));
    ops.push(env.DB.prepare('DELETE FROM consertos WHERE item_id = ?').bind(i.id));
    ops.push(env.DB.prepare('DELETE FROM item_versoes WHERE item_id = ?').bind(i.id));
    ops.push(env.DB.prepare('DELETE FROM itens WHERE id = ?').bind(i.id));
  }
  for (const g of [...new Set(apagar.map(i => i.grupo_id).filter(Boolean))]) {
    ops.push(env.DB.prepare('DELETE FROM grupo_versoes WHERE grupo_id = ? AND NOT EXISTS (SELECT 1 FROM itens WHERE grupo_id = ?)').bind(g, g));
    ops.push(env.DB.prepare('DELETE FROM grupos WHERE id = ? AND NOT EXISTS (SELECT 1 FROM itens WHERE grupo_id = ?)').bind(g, g));
  }
  const detalhe = { excluidas: apagar.length, mantidas, backup: copia ? copia.nome : null };
  ops.push(env.DB.prepare("UPDATE retiradas SET situacao = 'excluida', finalizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now'), detalhe = ? WHERE id = ?").bind(JSON.stringify(detalhe), r.id));
  ops.push(env.DB.prepare("INSERT INTO eventos (usuario_id, acao, detalhe) VALUES (?, 'retirada_excluida', ?)").bind(admId, JSON.stringify({ adm: sessao.email, retirada: r.id, professor: r.nome, ...detalhe })));
  await env.DB.batch(ops);
  return { ok: true, retirada: resumoRetirada(env, await retiradaPorId(env, r.id)) };
}
// Rotina diária: prazo vencido → e-mail ao ADM (uma vez por prazo).
async function lembrarRetiradas(env) {
  const { results } = await env.DB.prepare("SELECT r.id, r.total, r.prazo_em, r.criado_em, u.nome FROM retiradas r JOIN usuarios u ON u.id = r.usuario_id WHERE r.situacao = 'ativa' AND r.prazo_em <= ? AND r.aviso_enviado_em IS NULL").bind(hojeSP(env)).all();
  for (const r of results) {
    avisar(env, env.ADMIN_EMAIL, 'ATLAS: confirmar exclusão definitiva das questões de ' + r.nome,
      'As ' + r.total + ' questões autorais de ' + r.nome + ' foram retiradas do banco em ' + r.criado_em.slice(0, 10).split('-').reverse().join('/') +
      ' e o prazo para desfazer terminou.\n\nEntre na Administração do ATLAS (Professores e disciplinas → Questões retiradas) e escolha: excluir definitivamente, devolver ao banco ou adiar a decisão por mais ' + MESES_ADIAR + ' meses.\n\nNada é apagado sem a sua confirmação.\n\n' + LINK_ATLAS + 'admin.html', true);
    await env.DB.prepare("UPDATE retiradas SET aviso_enviado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").bind(r.id).run();
  }
  return results.length;
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
  if (path === '/api/adm/imagens' && request.method === 'POST') return await receberImagem(request, env, sessao.email);
  if (path === '/api/adm/imagens/migrar' && request.method === 'POST') return await migrarImagensAntigas(env, sessao);
  if (path === '/api/adm/imagens/situacao' && request.method === 'GET') {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM item_versoes WHERE dados LIKE '%data:image/%'").first();
    return { ok: true, versoes_com_imagem_antiga: r.n, r2: !!env.IMAGENS };
  }
  if (path === '/api/adm/relatorio' && request.method === 'GET') return await relatorioProducao(env, new URL(request.url));
  if (path === '/api/adm/itens/enviar' && request.method === 'POST') return await enviarSemClassificacao(env, request, await admUsuarioId(env), 'adm');
  const retiradas = await rotasRetiradas(request, env, path, sessao);
  if (retiradas) return retiradas;
  const backupAdm = await rotasBackupAdm(request, env, path, sessao);
  if (backupAdm) return backupAdm;
  const selecoesAdm = await rotasSelecoesAdm(request, env, path, new URL(request.url), sessao);
  if (selecoesAdm) return selecoesAdm;
  const itensAdm = await rotasAdmItens(request, env, path, sessao);
  if (itensAdm) return itensAdm;

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
    const digitador = body.digitador === true;
    const nome = limparNome(body.nome), email = limparEmail(body.email), disciplina = digitador ? null : limparDisciplina(body.disciplina);
    const acessoAte = limparAcessoAte(body.acesso_ate);
    if (await emailEmUso(env, email)) throw new HttpError(409, 'Este e-mail já está cadastrado.');
    const result = await env.DB.prepare("INSERT INTO usuarios (nome, email, disciplina, papel, ativo, digitador, acesso_ate) VALUES (?, ?, ?, 'professor', 1, ?, ?)")
      .bind(nome, email, disciplina, digitador ? 1 : 0, acessoAte).run();
    const id = result.meta?.last_row_id;
    await registrar(env, digitador ? 'digitador_cadastrado' : 'professor_cadastrado', { adm: sessao.email, id, nome, email, disciplina, acesso_ate: acessoAte });
    return { ok: true, id, professores: await listarProfessores(env) };
  }
  const match = path.match(/^\/api\/adm\/professores\/(\d+)$/);
  if (match && request.method === 'PUT') {
    const id = Number(match[1]);
    const atual = await env.DB.prepare("SELECT id, nome, email, disciplina, papel, ativo, digitador, acesso_ate FROM usuarios WHERE id = ? AND papel IN ('professor','supervisor')")
      .bind(id).first();
    if (!atual) throw new HttpError(404, 'Professor não encontrado.');
    const body = await readJson(request);
    const nome = body.nome !== undefined ? limparNome(body.nome) : atual.nome;
    const email = body.email !== undefined ? limparEmail(body.email) : atual.email;
    const digitador = body.digitador !== undefined ? (body.digitador === true ? 1 : 0) : atual.digitador;
    const disciplina = digitador ? null : (body.disciplina !== undefined ? limparDisciplina(body.disciplina) : limparDisciplina(atual.disciplina));
    const ativo = body.ativo !== undefined ? (body.ativo ? 1 : 0) : atual.ativo;
    const acessoAte = body.acesso_ate !== undefined ? limparAcessoAte(body.acesso_ate) : atual.acesso_ate;
    if (email !== atual.email && await emailEmUso(env, email, id)) throw new HttpError(409, 'Este e-mail já está cadastrado.');
    // Quem muda de disciplina ou é desativado deixa de ser supervisor.
    const papel = (disciplina !== atual.disciplina || !ativo || digitador) ? 'professor' : atual.papel;
    await env.DB.prepare('UPDATE usuarios SET nome = ?, email = ?, disciplina = ?, ativo = ?, papel = ?, digitador = ?, acesso_ate = ? WHERE id = ?')
      .bind(nome, email, disciplina, ativo, papel, digitador, acessoAte, id).run();
    await registrar(env, 'professor_alterado', { adm: sessao.email, id, antes: atual, depois: { nome, email, disciplina, ativo, papel, digitador, acesso_ate: acessoAte } });
    return { ok: true, professores: await listarProfessores(env) };
  }
  if (path === '/api/adm/supervisor' && request.method === 'POST') {
    const body = await readJson(request);
    const disciplina = limparDisciplina(body.disciplina);
    const usuarioId = body.usuario_id === null || body.usuario_id === '' ? null : Number(body.usuario_id);
    if (usuarioId !== null) {
      const prof = await env.DB.prepare("SELECT id, disciplina, ativo, digitador FROM usuarios WHERE id = ? AND papel IN ('professor','supervisor')")
        .bind(usuarioId).first();
      if (!prof) throw new HttpError(404, 'Professor não encontrado.');
      if (prof.digitador === 1) throw new HttpError(400, 'Digitador não pode ser supervisor.');
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
  async scheduled(event, envOriginal, ctx) {
    const env = Object.assign(Object.create(envOriginal || {}), { __ctx: ctx });
    ctx.waitUntil(fazerBackup(env, 'automatico').catch(error => console.error('ATLAS backup automático falhou:', error && error.message)));
    ctx.waitUntil(lembrarRetiradas(env).catch(error => console.error('ATLAS lembrete de retiradas falhou:', error && error.message)));
  },
  async fetch(request, envOriginal, ctx) {
    const env = Object.assign(Object.create(envOriginal || {}), { __ctx: ctx });
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return reply(null, 204, origin);
    try {
      if (url.pathname === '/api/saude' && request.method === 'GET') {
        const row = await env.DB.prepare("SELECT valor FROM meta WHERE chave = 'schema_versao'").first();
        return reply({ ok: true, modo: 'teste', banco: 'conectado', schema: row ? row.valor : null, avisos_ativos: env.ATLAS_AVISOS_ATIVOS === '1', envio: microsoftConfigurado(env) ? 'microsoft' : 'apps-script' }, 200, origin);
      }
      if (url.pathname === '/api/login/codigo' && request.method === 'POST') {
        if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(403, 'Origem não permitida.');
        return reply(await solicitarCodigoAcesso(request, env), 200, origin);
      }
      if (url.pathname === '/api/login/verificar' && request.method === 'POST') {
        if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(403, 'Origem não permitida.');
        return reply(await verificarCodigoAcesso(request, env), 200, origin);
      }
      if (url.pathname === '/api/login/sessao' && request.method === 'GET') {
        if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(403, 'Origem não permitida.');
        const sessao = await sessaoAtual(request, env, 'usuario');
        bloquearFerias(env);
        const usuario = await env.DB.prepare(
          "SELECT id, nome, email, disciplina, CASE WHEN digitador = 1 THEN 'digitador' ELSE papel END AS papel FROM usuarios WHERE id = ? AND ativo = 1 AND papel IN ('professor','supervisor') AND (acesso_ate IS NULL OR acesso_ate >= date('now','-3 hours'))"
        ).bind(sessao.usuario_id).first();
        if (!usuario) throw new HttpError(401, 'Acesso desativado. Entre novamente.');
        return reply({ ok: true, usuario, expira_em: sessao.expira_em }, 200, origin);
      }
      if (url.pathname === '/api/login/sair' && request.method === 'POST') {
        if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(403, 'Origem não permitida.');
        const sessao = await sessaoAtual(request, env, 'usuario');
        await env.DB.prepare('DELETE FROM sessoes WHERE token_hash = ?').bind(sessao.token_hash).run();
        return reply({ ok: true }, 200, origin);
      }
      if (url.pathname.startsWith('/img/') && request.method === 'GET') {
        return await entregarImagem(request, env, url);
      }
      if (url.pathname === '/api/imagens/links' && request.method === 'POST') {
        // Renova links vencidos (ex.: rascunho guardado no navegador por alguns dias).
        if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(403, 'Origem não permitida.');
        await usuarioDaSessao(request, env);
        const body = await readJson(request);
        const links = Array.isArray(body.links) ? body.links.slice(0, 100).map(String) : [];
        const novos = {};
        for (const link of links) {
          const canon = await normalizarImagens(env, link);
          const m = canon.match(/^atlas:img\/([0-9a-f]{32})$/);
          if (m) novos[link] = await linkImagem(env, m[1]);
        }
        return reply({ ok: true, links: novos }, 200, origin);
      }
      if (url.pathname === '/api/imagens' && request.method === 'POST') {
        if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(403, 'Origem não permitida.');
        const user = await usuarioDaSessao(request, env);
        return reply(await receberImagem(request, env, user.email), 200, origin);
      }
      if (url.pathname === '/api/itens' || url.pathname.startsWith('/api/itens/')) {
        if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(403, 'Origem não permitida.');
        return await replyAssinado(env, await rotasItens(request, env, url.pathname), 200, origin);
      }
      if (url.pathname.startsWith('/api/supervisor/')) {
        if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(403, 'Origem não permitida.');
        return await replyAssinado(env, await rotasSupervisor(request, env, url.pathname, url), 200, origin);
      }
      if (url.pathname.startsWith('/api/adm/')) {
        if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(403, 'Origem não permitida.');
        const resultado = await rotasAdm(request, env, url.pathname);
        if (resultado && resultado.__arquivo) {
          const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
            'Content-Disposition': 'attachment; filename="' + resultado.nome + '"', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin',
            'Access-Control-Allow-Origin': origin };
          return new Response(resultado.corpo, { status: 200, headers });
        }
        return await replyAssinado(env, resultado, 200, origin);
      }
      if (url.pathname.startsWith('/api/')) {
        throw new HttpError(404, 'Rota indisponível.');
      }
      throw new HttpError(404, 'Rota indisponível.');
    } catch (error) {
      if (error instanceof HttpError) return reply({ ok: false, error: error.message, ...(error.extra || {}) }, error.status, origin);
      return reply({ ok: false, error: 'Erro interno. Tente novamente.' }, 500, origin);
    }
  }
};
