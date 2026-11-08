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
    "SELECT id, nome, email, disciplina, papel, ativo FROM usuarios WHERE papel IN ('professor','supervisor') ORDER BY nome COLLATE NOCASE"
  ).all();
  return results.map(r => ({ ...r, ativo: r.ativo === 1 }));
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
async function contarTentativaLogin(env, key, windowSeconds, maxRequests) {
  const now = Math.floor(Date.now() / 1000);
  const sql = 'INSERT INTO login_rate_limits (chave, janela_inicio, quantidade) VALUES (?, ?, 1) ' +
    'ON CONFLICT(chave) DO UPDATE SET ' +
    'janela_inicio = CASE WHEN login_rate_limits.janela_inicio + ? <= excluded.janela_inicio ' +
    'THEN excluded.janela_inicio ELSE login_rate_limits.janela_inicio END, ' +
    'quantidade = CASE WHEN login_rate_limits.janela_inicio + ? <= excluded.janela_inicio ' +
    'THEN 1 ELSE login_rate_limits.quantidade + 1 END RETURNING quantidade';
  const row = await env.DB.prepare(sql).bind(key, now, windowSeconds, windowSeconds).first();
  await env.DB.prepare('DELETE FROM login_rate_limits WHERE janela_inicio < ?')
    .bind(now - 172800).run();
  return Number(row?.quantidade || 0) <= maxRequests;
}
async function enviarCodigoAcesso(env, email, codigo) {
  const response = await fetch(env.ATLAS_MAILER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segredo: env.ATLAS_MAILER_SECRET, email, codigo })
  });
  let result = null;
  try { result = await response.json(); } catch {}
  if (!response.ok || result?.ok !== true) {
    throw new HttpError(502, 'Não foi possível enviar o código. Tente novamente mais tarde.');
  }
}
async function solicitarCodigoAcesso(request, env) {
  if (!env.ATLAS_MAILER_URL || !env.ATLAS_MAILER_SECRET) {
    throw new HttpError(503, 'O envio de códigos ainda não está configurado.');
  }
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();
  if (email.length > 120 || !EMAIL_LOGIN_ATLAS.test(email)) {
    throw new HttpError(400, 'Informe um e-mail institucional válido.');
  }

  const emailKey = await hmacHex(env.ATLAS_MAILER_SECRET, 'email:' + email);
  const ip = request.headers.get('CF-Connecting-IP') || 'indisponivel';
  const ipKey = await hmacHex(env.ATLAS_MAILER_SECRET, 'ip:' + ip);
  const permitEmail = await contarTentativaLogin(env, emailKey, 3600, 5);
  const permitIp = await contarTentativaLogin(env, ipKey, 3600, 120);
  if (!permitEmail || !permitIp) return { ok: true };

  const user = await env.DB.prepare(
    "SELECT id, nome, email, disciplina, papel FROM usuarios " +
    "WHERE email = ? COLLATE NOCASE AND ativo = 1 AND papel IN ('professor','supervisor')"
  ).bind(email).first();
  if (!user) return { ok: true };

  const cooldownKey = await hmacHex(env.ATLAS_MAILER_SECRET, 'cooldown:' + email);
  if (!await contarTentativaLogin(env, cooldownKey, 60, 1)) return { ok: true };

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
    "SELECT id, nome, email, disciplina, papel FROM usuarios " +
    "WHERE email = ? COLLATE NOCASE AND ativo = 1 AND papel IN ('professor','supervisor')"
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
const CAMPOS_TEXTO = Object.freeze(['etapa', 'ano', 'origem', 'fonte', 'dificuldade', 'assunto', 'subtema',
  'nivel4', 'nivel5', 'bloom', 'referencia', 'gabarito']);
const CAMPOS_RICOS = Object.freeze(['texto-base', 'comando', 'alt-a', 'alt-b', 'alt-c', 'alt-d', 'alt-e', 'resolucao']);
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

function validarDados(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Dados da questão inválidos.');
  const d = { rich: true };
  for (const campo of CAMPOS_TEXTO) {
    const v = input[campo] === undefined || input[campo] === null ? '' : input[campo];
    if (typeof v !== 'string') throw new HttpError(400, 'Campo inválido: ' + campo + '.');
    const limite = campo === 'referencia' ? 1000 : 300;
    if (v.length > limite) throw new HttpError(400, 'Campo grande demais: ' + campo + '.');
    d[campo] = v.trim();
  }
  for (const campo of CAMPOS_RICOS) {
    const v = input[campo] === undefined || input[campo] === null ? '' : input[campo];
    if (typeof v !== 'string') throw new HttpError(400, 'Campo inválido: ' + campo + '.');
    if (HTML_PROIBIDO.test(v)) throw new HttpError(400, 'O campo "' + campo + '" contém conteúdo não permitido.');
    d[campo] = v;
  }
  const vazio = v => !String(v).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() && !/<img\b/i.test(v);
  if (!['em', 'ef2'].includes(d.etapa)) throw new HttpError(400, 'Escolha a etapa.');
  if (!['autoral', 'enem', 'outros'].includes(d.origem)) throw new HttpError(400, 'Escolha a origem da questão.');
  if (!['Fácil', 'Média', 'Difícil'].includes(d.dificuldade)) throw new HttpError(400, 'Escolha a dificuldade prevista.');
  if (!['Lembrar', 'Compreender', 'Aplicar', 'Analisar', 'Avaliar'].includes(d.bloom)) throw new HttpError(400, 'Escolha o nível cognitivo.');
  if (!d.assunto) throw new HttpError(400, 'Escolha o assunto principal.');
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

async function usuarioDaSessao(request, env) {
  const sessao = await sessaoAtual(request, env, 'usuario');
  const user = await env.DB.prepare(
    "SELECT id, nome, email, disciplina, papel FROM usuarios WHERE id = ? AND ativo = 1 AND papel IN ('professor','supervisor')"
  ).bind(sessao.usuario_id).first();
  if (!user) throw new HttpError(401, 'Acesso desativado. Entre novamente.');
  return user;
}

const SQL_RESUMO_ITEM =
  'SELECT i.id, i.codigo, i.disciplina, i.situacao, i.versao_atual, i.criado_em, i.atualizado_em, ' +
  'u.nome AS autor, json_extract(v.dados, \'$.assunto\') AS assunto, (v.autor_id <> i.autor_id AND ue.papel = \'supervisor\') AS editada_supervisor, (v.autor_id <> i.autor_id AND ue.papel = \'adm\') AS corrigida_adm, ' +
  '(SELECT r.motivo FROM revisoes r WHERE r.item_id = i.id ORDER BY r.id DESC LIMIT 1) AS ultimo_motivo, ' +
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

async function rotasItens(request, env, path) {
  const user = await usuarioDaSessao(request, env);

  // Enviar questão nova
  if (path === '/api/itens' && request.method === 'POST') {
    const body = await readJson(request, MAX_ITEM_BYTES + 64 * 1024);
    const dados = validarDados(body.dados);
    for (let tentativa = 0; tentativa < 10; tentativa++) {
      const codigo = gerarCodigoItem(user.disciplina);
      try {
        await env.DB.batch([
          env.DB.prepare("INSERT INTO itens (codigo, disciplina, autor_id, situacao, versao_atual) VALUES (?, ?, ?, 'analise', 1)")
            .bind(codigo, user.disciplina, user.id),
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

  // Minhas questões
  if (path === '/api/itens/meus' && request.method === 'GET') {
    const { results } = await env.DB.prepare(SQL_RESUMO_ITEM + 'WHERE i.autor_id = ? ORDER BY i.atualizado_em DESC, i.id DESC LIMIT 300')
      .bind(user.id).all();
    return { ok: true, itens: results.map(({ id, ...r }) => r) };
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
    const { id, ...resumo } = item;
    return { ok: true, item: { ...resumo, dados: JSON.parse(versao.dados), revisoes, versoes, consertos, e_autor: autorId === user.id } };
  }

  // Reenviar após pedido de ajuste (só o autor; gera nova versão)
  if (match && request.method === 'PUT') {
    const item = await itemPorCodigo(env, match[1]);
    const autorId = (await env.DB.prepare('SELECT autor_id FROM itens WHERE id = ?').bind(item.id).first()).autor_id;
    if (autorId !== user.id) throw new HttpError(404, 'Questão não encontrada.');
    if (item.situacao !== 'ajustes') throw new HttpError(409, 'Esta questão não está aguardando ajuste.');
    const body = await readJson(request, MAX_ITEM_BYTES + 64 * 1024);
    if (body.versao !== item.versao_atual) throw new HttpError(409, 'A questão mudou desde que você a abriu. Recarregue a página.');
    const dados = validarDados(body.dados);
    const nova = item.versao_atual + 1;
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO item_versoes (item_id, versao, dados, autor_id) VALUES (?, ?, ?, ?)').bind(item.id, nova, dados, user.id),
        env.DB.prepare("UPDATE itens SET versao_atual = ?, situacao = 'analise', atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND versao_atual = ? AND situacao = 'ajustes'")
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

  if (path === '/api/supervisor/fila' && request.method === 'GET') {
    const situacao = url.searchParams.get('situacao') || 'analise';
    if (!['analise', 'ajustes', 'aprovado', 'descartado'].includes(situacao)) throw new HttpError(400, 'Situação inválida.');
    const { results } = await env.DB.prepare(SQL_RESUMO_ITEM + 'WHERE i.disciplina = ? AND i.situacao = ? ORDER BY i.atualizado_em ASC, i.id ASC LIMIT 300')
      .bind(user.disciplina, situacao).all();
    return { ok: true, disciplina: user.disciplina, itens: results.map(({ id, ...r }) => r) };
  }

  // Editar (correção pequena): nova versão feita pelo Supervisor; a questão continua em análise.
  const edicao = path.match(/^\/api\/supervisor\/itens\/([A-Z]\d{7})$/);
  if (edicao && request.method === 'PUT') {
    const item = await itemPorCodigo(env, edicao[1]);
    if (item.disciplina !== user.disciplina) throw new HttpError(404, 'Questão não encontrada.');
    if (item.situacao !== 'analise') throw new HttpError(409, 'Só é possível editar questões em análise.');
    const body = await readJson(request, MAX_ITEM_BYTES + 64 * 1024);
    if (body.versao !== item.versao_atual) throw new HttpError(409, 'A questão mudou desde que você a abriu. Volte à fila e abra de novo.');
    const dados = validarDados(body.dados);
    const nova = item.versao_atual + 1;
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO item_versoes (item_id, versao, dados, autor_id) VALUES (?, ?, ?, ?)').bind(item.id, nova, dados, user.id),
        env.DB.prepare("UPDATE itens SET versao_atual = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND versao_atual = ? AND situacao = 'analise'")
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
    avisar(env, autorInfo.email, 'ATLAS: a questão ' + item.codigo + ' ' + frase,
      'Olá, ' + (autorInfo.nome || 'professor(a)') + '.\n\nA sua questão ' + item.codigo + ' ' + frase + '.' +
      (motivo ? '\n\nMotivo: ' + motivo : '') + (decisao === 'ajuste' ? '\n\nAbra o ATLAS, vá em "Minhas questões" e clique em "Corrigir".' : '') +
      '\n\n' + LINK_ATLAS);
    return { ok: true, item: { codigo: item.codigo, situacao: nova } };
  }
  throw new HttpError(404, 'Rota indisponível.');
}

// ---------- avisos por e-mail ----------
// Só envia quando ATLAS_AVISOS_ATIVOS = "1" (o Apps Script precisa aceitar o tipo "aviso").
// Uma falha no envio nunca desfaz a ação que gerou o aviso.
function avisar(env, para, assunto, texto) {
  if (env.ATLAS_AVISOS_ATIVOS !== '1') return;
  if (!env.ATLAS_MAILER_URL || !env.ATLAS_MAILER_SECRET || !para) {
    console.warn('ATLAS aviso não enviado: configuração ou destinatário ausente.');
    return;
  }
  const envio = fetch(env.ATLAS_MAILER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segredo: env.ATLAS_MAILER_SECRET, tipo: 'aviso', email: para, assunto, texto })
  }).then(async response => {
    let resultado = null;
    try { resultado = await response.json(); } catch {}
    if (!response.ok || resultado?.ok !== true) {
      console.warn('ATLAS aviso recusado pelo mailer:', response.status, resultado?.erro || 'resposta inválida');
    }
  }).catch(() => {
    console.warn('ATLAS aviso não enviado: falha de conexão com o mailer.');
  });
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
  const { id, ...resumo } = item;
  return { ...resumo, dados: JSON.parse(versao.dados), revisoes, versoes, consertos, autor_id: autor.autor_id };
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
      pode_desfazer: !!descartadoEm && diasDesde(descartadoEm) <= DIAS_DESFAZER_DESCARTE,
      prazo_dias: DIAS_DESFAZER_DESCARTE } };
  }

  if (m[2] && request.method === 'POST') {
    if (item.situacao !== 'descartado') throw new HttpError(409, 'Esta questão não está descartada.');
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
    const dados = validarDados(body.dados);
    const consertoId = body.conserto_id === undefined || body.conserto_id === null ? null : Number(body.conserto_id);
    let conserto = null;
    if (consertoId !== null) {
      conserto = await env.DB.prepare("SELECT id, solicitante_id FROM consertos WHERE id = ? AND item_id = ? AND situacao = 'pendente'").bind(consertoId, item.id).first();
      if (!conserto) throw new HttpError(409, 'Pedido de conserto não encontrado ou já resolvido.');
    }
    const admId = await admUsuarioId(env);
    const nova = item.versao_atual + 1;
    const ops = [
      env.DB.prepare('INSERT INTO item_versoes (item_id, versao, dados, autor_id) VALUES (?, ?, ?, ?)').bind(item.id, nova, dados, admId),
      env.DB.prepare("UPDATE itens SET versao_atual = ?, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND versao_atual = ? AND situacao = 'aprovado'")
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
  if (path === '/api/adm/avisos/testar' && request.method === 'POST') {
    if (env.ATLAS_AVISOS_ATIVOS !== '1' || !env.ATLAS_MAILER_URL || !env.ATLAS_MAILER_SECRET) {
      throw new HttpError(503, 'Os avisos por e-mail não estão configurados nesta versão.');
    }
    const permitido = await contarTentativaLogin(env, 'adm-aviso-teste', 60, 1);
    if (!permitido) throw new HttpError(429, 'Aguarde um minuto antes de repetir o teste.');
    let response;
    try {
      response = await fetch(env.ATLAS_MAILER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segredo: env.ATLAS_MAILER_SECRET,
          tipo: 'aviso',
          email: String(env.ADMIN_EMAIL).toLowerCase(),
          assunto: 'ATLAS: teste de aviso por e-mail',
          texto: 'Este é um teste dos avisos do ATLAS. Enviado em ' + agoraIso() + '.'
        })
      });
    } catch {
      throw new HttpError(502, 'Não foi possível conectar ao serviço de e-mail.');
    }
    let result = null;
    try { result = await response.json(); } catch {}
    if (!response.ok || result?.ok !== true) {
      const erro = /^[a-z0-9_]{1,40}$/.test(result?.erro || '') ? result.erro : 'resposta_invalida';
      console.warn('ATLAS aviso de teste recusado:', response.status, erro);
      throw new HttpError(502, 'O serviço de e-mail recusou o teste (' + erro + ').');
    }
    return { ok: true, mensagem: 'O serviço de e-mail aceitou o aviso. Confira a caixa de entrada do ADM.' };
  }
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
  async fetch(request, envOriginal, ctx) {
    const env = Object.assign(Object.create(envOriginal || {}), { __ctx: ctx });
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return reply(null, 204, origin);
    try {
      if (url.pathname === '/api/saude' && request.method === 'GET') {
        const row = await env.DB.prepare("SELECT valor FROM meta WHERE chave = 'schema_versao'").first();
        return reply({ ok: true, modo: 'teste', banco: 'conectado', schema: row ? row.valor : null, avisos_ativos: env.ATLAS_AVISOS_ATIVOS === '1' }, 200, origin);
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
        const usuario = await env.DB.prepare(
          "SELECT id, nome, email, disciplina, papel FROM usuarios WHERE id = ? AND ativo = 1 AND papel IN ('professor','supervisor')"
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
      if (url.pathname === '/api/itens' || url.pathname.startsWith('/api/itens/')) {
        if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(403, 'Origem não permitida.');
        return reply(await rotasItens(request, env, url.pathname), 200, origin);
      }
      if (url.pathname.startsWith('/api/supervisor/')) {
        if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(403, 'Origem não permitida.');
        return reply(await rotasSupervisor(request, env, url.pathname, url), 200, origin);
      }
      if (url.pathname.startsWith('/api/adm/')) {
        if (!ALLOWED_ORIGINS.includes(origin)) throw new HttpError(403, 'Origem não permitida.');
        return reply(await rotasAdm(request, env, url.pathname), 200, origin);
      }
      if (url.pathname.startsWith('/api/')) {
        throw new HttpError(404, 'Rota indisponível.');
      }
      throw new HttpError(404, 'Rota indisponível.');
    } catch (error) {
      if (error instanceof HttpError) return reply({ ok: false, error: error.message }, error.status, origin);
      return reply({ ok: false, error: 'Erro interno. Tente novamente.' }, 500, origin);
    }
  }
};
