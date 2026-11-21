// Cadastro completo de alunos (pedido do Marinho em 21/11/2026): o ATLAS é a base dos dados do aluno.
// A planilha da escola (15 colunas) entra pela tela Alunos, com prévia; a lista da Redação (EF2 e EM) é
// atualizada na mesma importação. O Portal do aluno lê e grava aqui (rotas /api/portal/aluno*), por meio do
// Worker do portal, com o segredo entre servidores. Quem não está na planilha não é apagado durante o ano.
import { RedacaoError, importarAlunosRedacao } from './redacao-cadastros.js';

const erro = (status, mensagem) => { throw new RedacaoError(status, mensagem); };
const UNIDADES = { BC: 'BC', AM: 'AM', CN: 'CN', 'BATISTA CAMPOS': 'BC', 'AUGUSTO MONTENEGRO': 'AM', 'CIDADE NOVA': 'CN' };
const SEGMENTOS = ['EF1', 'EF2', 'EM'];
const VINCULOS = ['Mãe', 'Pai', 'Avó/Avô', 'Tutor legal', 'Outro'];
const MAX_LINHAS = 5000;
/* Colunas da planilha da escola, na ordem; IDADE é calculada pela data de nascimento. */
export const COLUNAS = Object.freeze(['NOME COMPLETO', 'RA', 'FILIAL', 'SÉRIE', 'CODTURMA', 'SEGMENTO', 'SEXO', 'DAT_NASC', 'IDADE', 'CPF',
  'EMAIL INSTITUCIONAL ALUNO', 'EMAIL PESSOAL ALUNO', 'RESPONSÁVEL FINANCEIRO', 'EMAIL PESSOAL RESPONSÁVEL', 'TELEFONE']);
/* Colunas preenchidas pelo aluno no Portal (ficam depois das 15 na planilha atual). */
export const COLUNAS_PORTAL = Object.freeze(['WHATSAPP ALUNO', 'VÍNCULO DO RESPONSÁVEL', 'WHATSAPP RESPONSÁVEL', 'CONFIRMADO NO PORTAL']);
const CAMPOS_ESCOLA = ['nome', 'unidade', 'serie', 'turma', 'segmento', 'sexo', 'nascimento', 'cpf', 'email_institucional', 'email_pessoal', 'responsavel', 'responsavel_email', 'telefone'];
const CAMPOS_PORTAL = ['whatsapp_aluno', 'responsavel_vinculo', 'responsavel_whatsapp'];

const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const chave = s => semAcento(s).trim().toUpperCase().replace(/\s+/g, ' ');
const texto = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const digitos = s => String(s ?? '').replace(/\D/g, '');
const raValido = ra => { const s = String(ra ?? '').trim(); if (!/^\d{1,15}$/.test(s)) erro(400, 'Matrícula inválida.'); return s; };

/* Data de nascimento como DD/MM/AAAA (aceita AAAA-MM-DD e datas do Excel); o que não é data fica como veio. */
export function normalizarData(valor) {
  const s = String(valor ?? '').trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (m) return m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + m[3];
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  return s.slice(0, 20);
}
/* Idade em anos completos na data de hoje (vazio se a data não for DD/MM/AAAA). */
export function idade(nascimento, hoje) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(nascimento || '');
  if (!m) return '';
  const [a, mes, d] = hoje.split('-').map(Number);
  let n = a - Number(m[3]);
  if (mes < Number(m[2]) || (mes === Number(m[2]) && d < Number(m[1]))) n--;
  return n >= 0 && n < 120 ? n : '';
}
/* CPF só com dígitos; 9 ou 10 dígitos ganham os zeros à esquerda que o Excel costuma apagar. */
function limparCpf(valor) {
  const d = digitos(valor).slice(0, 14);
  return d.length >= 9 && d.length < 11 ? d.padStart(11, '0') : d;
}
function cpfValido(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = 11 - (s % 11); return r >= 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
const whatsappValido = valor => /^\d{2}9\d{8}$/.test(digitos(valor));
const emailValido = s => !!s && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/* Uma linha da planilha → campos do banco. Erros citam a linha da planilha (cabeçalho = 1). */
function validarLinha(row, i) {
  const linha = `Linha ${i + 2}: `;
  if (!row || typeof row !== 'object' || Array.isArray(row)) erro(400, linha + 'dados inválidos.');
  const ra = String(row.ra ?? '').trim();
  if (!/^\d{1,15}$/.test(ra)) erro(400, linha + 'RA inválido.');
  const nome = texto(row.nome, 160);
  if (!nome) erro(400, linha + 'nome vazio.');
  const unidade = UNIDADES[chave(row.unidade)];
  if (!unidade) erro(400, linha + 'FILIAL inválida (use BC, AM ou CN).');
  const segmento = chave(row.segmento).replace(/\s+/g, '');
  if (!SEGMENTOS.includes(segmento)) erro(400, linha + 'SEGMENTO inválido (use EF1, EF2 ou EM).');
  const serie = texto(row.serie, 30);
  if (!serie) erro(400, linha + 'SÉRIE vazia.');
  const turma = texto(row.turma ?? row.codigo, 30).toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(turma)) erro(400, linha + 'CODTURMA inválido.');
  const a = { ra, nome, unidade, serie, turma, segmento,
    sexo: texto(row.sexo, 10).toUpperCase(), nascimento: normalizarData(row.nascimento), cpf: limparCpf(row.cpf),
    email_institucional: texto(row.email_institucional, 120).toLowerCase(), email_pessoal: texto(row.email_pessoal, 120).toLowerCase(),
    responsavel: texto(row.responsavel, 160), responsavel_email: texto(row.responsavel_email, 120).toLowerCase(), telefone: texto(row.telefone, 40) };
  /* Campos do Portal: só entram quando a planilha traz a coluna (planilha atual); a da escola não traz. */
  for (const c of CAMPOS_PORTAL) a[c] = c in row && row[c] !== undefined && row[c] !== null ? texto(row[c], 60) : null;
  return a;
}
function validarLinhas(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_LINHAS) erro(400, `A planilha deve conter de 1 a ${MAX_LINHAS} alunos.`);
  const vistos = new Set();
  return rows.map((row, i) => {
    const a = validarLinha(row, i);
    if (vistos.has(a.ra)) erro(400, `Linha ${i + 2}: RA repetido na planilha.`);
    vistos.add(a.ra);
    return a;
  });
}
async function todos(env) {
  return (await env.DB.prepare('SELECT * FROM alunos ORDER BY unidade, segmento, serie, turma, nome COLLATE NOCASE').all()).results;
}
function mudou(anterior, a) {
  if (CAMPOS_ESCOLA.some(c => (anterior[c] ?? '') !== a[c])) return true;
  return CAMPOS_PORTAL.some(c => a[c] !== null && (anterior[c] ?? '') !== a[c]);
}
const UPSERT = 'INSERT INTO alunos (ra, nome, unidade, serie, turma, segmento, sexo, nascimento, cpf, email_institucional, email_pessoal, responsavel, responsavel_email, telefone, ' +
  "whatsapp_aluno, responsavel_vinculo, responsavel_whatsapp, ano) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, ''), COALESCE(?, ''), COALESCE(?, ''), ?) " +
  'ON CONFLICT(ra) DO UPDATE SET nome = excluded.nome, unidade = excluded.unidade, serie = excluded.serie, turma = excluded.turma, segmento = excluded.segmento, sexo = excluded.sexo, ' +
  'nascimento = excluded.nascimento, cpf = excluded.cpf, email_institucional = excluded.email_institucional, email_pessoal = excluded.email_pessoal, responsavel = excluded.responsavel, ' +
  'responsavel_email = excluded.responsavel_email, telefone = excluded.telefone, whatsapp_aluno = COALESCE(?, whatsapp_aluno), responsavel_vinculo = COALESCE(?, responsavel_vinculo), ' +
  "responsavel_whatsapp = COALESCE(?, responsavel_whatsapp), ano = excluded.ano, atualizado_em = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";

/* Prévia e importação da planilha completa; a lista da Redação (EF2 e EM) vai junto. */
async function importar(env, body, ano, { gravar, sessao, registrar }) {
  const alunos = validarLinhas(body.alunos);
  const porRa = new Map((await todos(env)).map(a => [a.ra, a]));
  let novos = 0, atualizados = 0, iguais = 0;
  const gravarLista = [];
  for (const a of alunos) {
    const anterior = porRa.get(a.ra);
    if (!anterior) { novos++; gravarLista.push(a); } else if (mudou(anterior, a) || anterior.ano !== ano) { atualizados++; gravarLista.push(a); } else iguais++;
  }
  const paraRedacao = alunos.map(a => ({ ra: a.ra, nome: a.nome, unidade: a.unidade, segmento: a.segmento, serie: a.serie, codigo: a.turma }));
  /* A Redação confere antes (mudança de série no mesmo ano bloqueia tudo) e grava depois dos alunos. */
  const redacao = await importarAlunosRedacao(env, paraRedacao, ano, { gravar: false, sessao, registrar });
  const resumo = { ok: true, linhas: alunos.length, novos, atualizados, iguais, ef1: alunos.filter(a => a.segmento === 'EF1').length,
    novas_turmas: redacao.novas_turmas, mudancas: redacao.mudancas, conflitos: redacao.conflitos };
  if (!gravar) return resumo;
  if (redacao.conflitos.length) erro(409, 'A planilha contém mudança de série ou segmento. Corrija os RAs indicados antes de importar.');
  const ops = gravarLista.map(a => env.DB.prepare(UPSERT).bind(a.ra, a.nome, a.unidade, a.serie, a.turma, a.segmento, a.sexo, a.nascimento, a.cpf, a.email_institucional,
    a.email_pessoal, a.responsavel, a.responsavel_email, a.telefone, a.whatsapp_aluno, a.responsavel_vinculo, a.responsavel_whatsapp, ano,
    a.whatsapp_aluno, a.responsavel_vinculo, a.responsavel_whatsapp));
  for (let i = 0; i < ops.length; i += 100) await env.DB.batch(ops.slice(i, i + 100));
  await importarAlunosRedacao(env, paraRedacao, ano, { gravar: true, sessao, registrar });
  await registrar(env, 'alunos_importados', { adm: sessao.email, ano, linhas: alunos.length, novos, atualizados });
  return resumo;
}

export async function rotaAlunosAdm(request, env, path, { readJson, hojeSP, registrar, sessao }) {
  if (!path.startsWith('/api/adm/alunos')) return null;
  const hoje = hojeSP(env), ano = Number(hoje.slice(0, 4));
  if (path === '/api/adm/alunos' && request.method === 'GET') {
    const alunos = (await todos(env)).map(a => ({ ...a, idade: idade(a.nascimento, hoje) }));
    return { ok: true, ano, hoje, colunas: COLUNAS, colunas_portal: COLUNAS_PORTAL, alunos };
  }
  if ((path === '/api/adm/alunos/previa' || path === '/api/adm/alunos/importar') && request.method === 'POST') {
    const body = await readJson(request, 4 * 1024 * 1024);
    const anoPlanilha = Number(body.ano);
    if (!Number.isInteger(anoPlanilha) || anoPlanilha !== ano) erro(400, 'Envie uma planilha do ano atual.');
    return await importar(env, body, ano, { gravar: path.endsWith('/importar'), sessao, registrar });
  }
  erro(404, 'Rota indisponível.');
}

/* ---------- Portal do aluno ---------- */
function paraPortal(a, ano) {
  const anoConf = a.confirmado_em ? Number(a.confirmado_em.slice(0, 4)) : 0;
  return { matricula: a.ra, nome: a.nome, unidade: a.unidade, serie: a.serie, segmento: a.segmento, dataNascimento: a.nascimento,
    email: a.email_institucional || (a.ra + '@aluno.grupoideal.com.br'), cpf: a.cpf, emailPessoal: a.email_pessoal, whatsappAluno: a.whatsapp_aluno,
    responsavelNome: a.responsavel, responsavelVinculo: a.responsavel_vinculo, responsavelWhatsapp: a.responsavel_whatsapp,
    contatosConfirmadosAno: anoConf, contatosConfirmadosNesteAno: anoConf === ano, anoAtual: ano };
}
/* Mesmas regras da tela do Portal (erroContatos em inscricoes/portal.js), conferidas no servidor. */
export function validarContatos(dados, segmento) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) erro(400, 'Dados inválidos.');
  const v = { emailPessoal: texto(dados.emailPessoal, 254).toLowerCase(), cpf: digitos(dados.cpf).slice(0, 11), whatsappAluno: texto(dados.whatsappAluno, 20),
    responsavelNome: texto(dados.responsavelNome, 160), responsavelVinculo: texto(dados.responsavelVinculo, 40), responsavelWhatsapp: texto(dados.responsavelWhatsapp, 20) };
  if (!emailValido(v.emailPessoal)) erro(400, 'Informe um e-mail pessoal válido. Ele pode ser do aluno ou do responsável.');
  if (!cpfValido(v.cpf)) erro(400, 'Informe um CPF válido do aluno (11 números).');
  if (v.responsavelVinculo && !VINCULOS.includes(v.responsavelVinculo)) erro(400, 'Vínculo do responsável inválido.');
  const respOk = !!(v.responsavelNome && v.responsavelVinculo && whatsappValido(v.responsavelWhatsapp));
  if (segmento === 'EF1') {
    v.whatsappAluno = '';
    if (!respOk) erro(400, 'Preencha corretamente nome, vínculo e WhatsApp do responsável.');
  } else if (segmento === 'EF2') {
    if (v.whatsappAluno && !whatsappValido(v.whatsappAluno)) erro(400, 'Confira o WhatsApp do aluno.');
    if (!respOk) erro(400, 'Preencha corretamente nome, vínculo e WhatsApp do responsável.');
  } else {
    if (!whatsappValido(v.whatsappAluno)) erro(400, 'Informe um WhatsApp válido do aluno.');
    const algumResp = !!(v.responsavelNome || v.responsavelVinculo || digitos(v.responsavelWhatsapp));
    if (algumResp && !respOk) erro(400, 'Se informar um responsável, preencha nome, vínculo e WhatsApp.');
  }
  return v;
}
export async function rotaAlunosPortal(env, path, body, hojeSP) {
  const ra = raValido(body?.ra), ano = Number(hojeSP(env).slice(0, 4));
  const buscar = () => env.DB.prepare('SELECT * FROM alunos WHERE ra = ?').bind(ra).first();
  if (path === '/api/portal/aluno') {
    const a = await buscar();
    return { ok: true, aluno: a ? paraPortal(a, ano) : null };
  }
  if (path === '/api/portal/aluno/confirmar') {
    const a = await buscar();
    if (!a) erro(404, 'Aluno não encontrado na lista do ATLAS.');
    const v = validarContatos(body?.dados, a.segmento);
    const agora = new Date().toISOString().slice(0, 19) + 'Z';
    await env.DB.prepare('UPDATE alunos SET cpf = ?, email_pessoal = ?, whatsapp_aluno = ?, responsavel = ?, responsavel_vinculo = ?, responsavel_whatsapp = ?, confirmado_em = ?, atualizado_em = ? WHERE ra = ?')
      .bind(v.cpf, v.emailPessoal, v.whatsappAluno, v.responsavelNome, v.responsavelVinculo, v.responsavelWhatsapp, agora, agora, ra).run();
    return { ok: true, aluno: paraPortal(await buscar(), ano) };
  }
  erro(404, 'Rota indisponível.');
}
