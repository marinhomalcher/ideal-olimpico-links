// Código fixo por pessoa, mostrado ao Supervisor no lugar do nome (decisão do Marinho, 27/11/2026).
// Padrão: "P-" + 4 caracteres de um alfabeto sem 0, O, 1, I e L (ex.: P-K7M2). Calculado por HMAC-SHA256
// com o segredo SUPERVISOR_CODIGO_SECRET (só na Cloudflare, nunca no repositório nem em log). Mesma pessoa
// (mesmo id) = sempre o mesmo código; não há tabela nova. Trocar o segredo embaralha todos os códigos.
// Sem o segredo, usa um segredo já existente como reserva (ATLAS_MAILER_SECRET), para o servidor não parar.
// Só o ADM vê a relação código → nome (listarPessoas).

export const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 símbolos, sem 0/O e 1/I/L
export const PADRAO_CODIGO = /^P-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

export function segredoDoCodigo(env) {
  return env.SUPERVISOR_CODIGO_SECRET || env.ATLAS_MAILER_SECRET || null;
}
export function origemDoSegredo(env) {
  return env.SUPERVISOR_CODIGO_SECRET ? 'segredo' : (env.ATLAS_MAILER_SECRET ? 'reserva' : 'ausente');
}

async function hmacBytes(secret, texto) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(texto)));
}

function bytesParaCodigo(bytes) {
  let s = '';
  for (let k = 0; k < 4; k++) s += ALFABETO_CODIGO[bytes[k] % ALFABETO_CODIGO.length];
  return 'P-' + s;
}

/* Código de uma chave (id numérico ou, na falta dele, o nome), com o deslocamento n para resolver colisão. */
export async function codigoDe(secret, chave, n = 0) {
  return bytesParaCodigo(await hmacBytes(secret, 'atlas-supervisor-codigo:' + chave + (n ? ':' + n : '')));
}

/* Resolve colisões de forma determinística: as pessoas são tratadas na ordem dada (ids crescentes) e quem vem
   antes fica com o código base; quem colide recebe o próximo deslocamento livre. Assim quem já existia nunca
   muda de código quando alguém novo é cadastrado. `calcular(chave, n)` devolve o código; é separado para poder
   ser testado sem HMAC. */
export async function resolverCodigos(pessoas, calcular) {
  const usados = new Set();
  const porId = new Map();
  for (const p of pessoas) {
    let n = 0, c = await calcular(p.chave, 0);
    while (usados.has(c)) { n++; c = await calcular(p.chave, n); if (n > 50) break; }
    usados.add(c);
    porId.set(p.id, c);
  }
  return porId;
}

/* Tabela id → código e nome → código de todas as pessoas (professor, supervisor, adm), para uma requisição. */
export async function tabelaDeCodigos(env, { obrigatorio = true } = {}) {
  const secret = segredoDoCodigo(env);
  if (!secret) {
    if (obrigatorio) { const e = new Error('Código do supervisor sem segredo (SUPERVISOR_CODIGO_SECRET).'); e.status = 500; throw e; }
    return { porId: new Map(), porNome: new Map(), async deNome() { return null; } };
  }
  const { results } = await env.DB.prepare('SELECT id, nome FROM usuarios ORDER BY id').all();
  const porId = await resolverCodigos(results.map(r => ({ id: r.id, chave: 'id:' + r.id })), (chave, n) => codigoDe(secret, chave, n));
  const porNome = new Map();
  for (const r of results) if (!porNome.has(r.nome)) porNome.set(r.nome, porId.get(r.id));
  return {
    porId,
    porNome,
    // Nome que não está mais no cadastro (apagado) ainda vira um código estável, derivado do próprio nome.
    async deNome(nome) { return porNome.get(nome) || codigoDe(secret, 'nome:' + nome); }
  };
}

const CHAVES_NOME = new Set(['autor', 'classificada_por']);

/* Troca, numa resposta das rotas do Supervisor, todo nome de pessoa pelo código. O tipo de quem enviou
   (autor_tipo) e tudo o mais ficam como estão. Listas chamadas `professores` (nomes) viram listas de códigos. */
export async function codificarNomes(valor, tabela, chave) {
  if (Array.isArray(valor)) {
    const saida = [];
    for (const v of valor) saida.push(await codificarNomes(v, tabela, chave === 'professores' ? 'professores' : undefined));
    return saida;
  }
  if (valor && typeof valor === 'object') {
    const o = {};
    for (const k of Object.keys(valor)) {
      const v = valor[k];
      if (CHAVES_NOME.has(k) && typeof v === 'string' && v) o[k] = await tabela.deNome(v);
      else if (k === 'classificacao' && v && typeof v === 'object' && !Array.isArray(v)) o[k] = { ...v, por: typeof v.por === 'string' && v.por ? await tabela.deNome(v.por) : v.por };
      else if (k === 'professores' && Array.isArray(v)) {
        o[k] = [];
        for (const p of v) o[k].push(typeof p === 'string' ? await tabela.deNome(p) : await codificarNomes(p, tabela));
      }
      else o[k] = await codificarNomes(v, tabela, k);
    }
    return o;
  }
  if (chave === 'professores' && typeof valor === 'string' && valor) return tabela.deNome(valor);
  return valor;
}
