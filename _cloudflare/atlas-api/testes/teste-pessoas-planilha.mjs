// "Cadastros e funções" pela planilha (20/11/2026): prévia confere sem gravar; importação grava pelo salvarPessoa
// e define supervisores; pessoas fora da planilha ficam como estão. Dados fictícios; banco em memória.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const worker = (await import('../worker.js')).default;
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(repo + '_cloudflare/atlas-api/schema.sql', 'utf8'));
const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'OK' : 'FALHOU', name, String(extra).slice(0, 300)]);
function stmt(sql, args = []) {
  return { bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }) };
}
const env = { DB: { prepare: sql => stmt(sql), batch: async ops => { for (const o of ops) await o.run(); } }, ADMIN_EMAIL: 'adm@example.com', ATLAS_HOJE_TESTE: '2026-11-20' };
db.prepare('INSERT INTO sessoes (token_hash, tipo, email, usuario_id, expira_em) VALUES (?, ?, ?, ?, ?)').run(createHash('sha256').update('adm-token').digest('hex'), 'adm', 'adm@example.com', null, '2099-01-01T00:00:00Z');
async function api(path, method = 'GET', body) {
  const r = await worker.fetch(new Request('https://atlas-api.example' + path, { method, headers: { Origin: 'https://idealolimpico.com.br', Authorization: 'Bearer adm-token', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: r.status, data: await r.json() };
}
const conta = sql => db.prepare(sql).get().n;
const pessoa = email => db.prepare('SELECT id, nome, disciplina, papel, ativo, digitador, classificador, acesso_ate FROM usuarios WHERE email = ?').get(email);

/* Uma pessoa já cadastrada pela tela (fora da planilha): não pode ser tocada. */
let r = await api('/api/adm/pessoas', 'POST', { nome: 'Fora Da Planilha', email: 'fora@grupoideal.com.br', banco: { tipo: 'professor', disciplina: 'Física', classificador: false }, redacao: { professor: null, digitalizador: null }, coordenacao: [] });
ok('Cadastro pela tela continua funcionando', r.status === 200, r.data.error);
const turmaBC = db.prepare("SELECT id FROM redacao_turmas WHERE unidade = 'BC' AND codigo = '1EMA'").get().id;
const turmaAM = db.prepare("SELECT id FROM redacao_turmas WHERE unidade = 'AM' AND codigo = '2EMA'").get().id;

const linhas = [
  { nome: 'Ana Professora', email: 'ana.prof', banco: 'Supervisor', disciplina: 'matemática', classificador: '', turma: 'BC 1EMA', unidades: '', coordenacao: '', acesso_ate: '', ativo: 'SIM' },
  { nome: 'Bruno Digitalizador', email: 'bruno.dig@grupoideal.com.br', banco: '', disciplina: '', classificador: '', turma: '', unidades: 'BC; Cidade Nova', coordenacao: 'BC EM 1ª Série; BC EM 2ª série', acesso_ate: '31/12/2026', ativo: '' },
  { nome: 'Carla Digitadora', email: 'carla.dig', banco: 'DIGITADOR', disciplina: 'Química', classificador: 'SIM', turma: '', unidades: '', coordenacao: '', acesso_ate: '2027-01-15', ativo: 'NÃO' },
  { nome: 'Fora Da Planilha', email: 'fora@grupoideal.com.br', banco: 'professor', disciplina: 'Física', classificador: 'sim', turma: '', unidades: '', coordenacao: '', acesso_ate: '', ativo: 'SIM' }
];
r = await api('/api/adm/pessoas/previa', 'POST', { pessoas: linhas });
ok('Prévia: 3 novos, 1 atualizado (classificador), nenhum erro', r.status === 200 && r.data.novos === 3 && r.data.atualizados === 1 && r.data.iguais === 0 && r.data.erros.length === 0, JSON.stringify(r.data));
ok('Prévia lista o supervisor de Matemática', r.data.supervisores.length === 1 && r.data.supervisores[0].disciplina === 'Matemática' && r.data.supervisores[0].nome === 'Ana Professora');
ok('Prévia não grava nada', conta('SELECT COUNT(*) AS n FROM usuarios') === 1 && conta('SELECT COUNT(*) AS n FROM eventos WHERE acao = \'pessoas_importadas\'') === 0);

r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: linhas });
ok('Importação: grava as 4 pessoas e devolve a lista', r.status === 200 && conta('SELECT COUNT(*) AS n FROM usuarios') === 4 && r.data.pessoas.length === 4, r.data.error);
const ana = pessoa('ana.prof@grupoideal.com.br'), bruno = pessoa('bruno.dig@grupoideal.com.br'), carla = pessoa('carla.dig@grupoideal.com.br'), fora = pessoa('fora@grupoideal.com.br');
ok('E-mail sem @ é completado; disciplina em minúsculas vira a oficial; supervisor definido', ana && ana.disciplina === 'Matemática' && ana.papel === 'supervisor' && ana.ativo === 1, JSON.stringify(ana));
ok('Turma de redação "BC 1EMA" vinculada e equipe marcada como professora', db.prepare('SELECT turma_id FROM redacao_professor_turmas WHERE usuario_id = ?').get(ana.id)?.turma_id === turmaBC && db.prepare('SELECT professor FROM redacao_equipe WHERE usuario_id = ?').get(ana.id)?.professor === 1);
ok('Digitalizador: unidades por sigla e por nome; coordenação em duas séries; data DD/MM/AAAA aceita', bruno && bruno.disciplina === null && bruno.acesso_ate === '2026-12-31' &&
  db.prepare('SELECT unidade FROM redacao_digitalizador_unidades WHERE usuario_id = ? ORDER BY unidade').all(bruno.id).map(x => x.unidade).join(',') === 'BC,CN' &&
  db.prepare('SELECT serie FROM coordenadores WHERE usuario_id = ? ORDER BY serie').all(bruno.id).map(x => x.serie).join('|') === '1ª Série|2ª Série', JSON.stringify(bruno));
ok('Digitador do banco: sem disciplina nem classificador, inativo, com prazo', carla && carla.digitador === 1 && carla.disciplina === null && carla.classificador === 0 && carla.ativo === 0 && carla.acesso_ate === '2027-01-15', JSON.stringify(carla));
ok('Pessoa já existente é atualizada pelo e-mail (classificador ligado), sem duplicar', fora && fora.classificador === 1 && conta("SELECT COUNT(*) AS n FROM usuarios WHERE email = 'fora@grupoideal.com.br'") === 1);
ok('Evento de importação registrado', conta("SELECT COUNT(*) AS n FROM eventos WHERE acao = 'pessoas_importadas'") === 1);

r = await api('/api/adm/pessoas/previa', 'POST', { pessoas: linhas });
ok('Reenviar a mesma planilha: tudo igual, nada a atualizar', r.status === 200 && r.data.iguais === 4 && r.data.novos === 0 && r.data.atualizados === 0, JSON.stringify(r.data));

/* Mover a turma de Ana para outra pessoa da mesma planilha, e Ana vira professora comum; Bruno some da planilha (fica como está). */
const movida = [
  { ...linhas[0], banco: 'PROFESSOR', turma: '' },
  { nome: 'Dora Redação', email: 'dora.red', banco: '', disciplina: '', classificador: '', turma: 'BC 1EMA', unidades: '', coordenacao: '', acesso_ate: '', ativo: 'SIM' }
];
r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: movida });
const dora = pessoa('dora.red@grupoideal.com.br');
ok('Turma passa de uma pessoa para outra na mesma planilha', r.status === 200 && dora && db.prepare('SELECT usuario_id FROM redacao_professor_turmas WHERE turma_id = ?').get(turmaBC)?.usuario_id === dora.id, r.data.error);
ok('Quem veio como PROFESSOR deixa de ser supervisor; quem ficou fora da planilha não muda', pessoa('ana.prof@grupoideal.com.br').papel === 'professor' && conta('SELECT COUNT(*) AS n FROM redacao_digitalizador_unidades WHERE usuario_id = ' + bruno.id) === 2);

/* Erros: cada linha com o motivo; importação recusada; nada gravado. */
const antes = conta('SELECT COUNT(*) AS n FROM usuarios');
const ruins = [
  { nome: 'E', email: 'erro1', banco: 'PROFESSOR', disciplina: 'Astrologia', turma: '', unidades: '', coordenacao: '', acesso_ate: '', ativo: '' },
  { nome: 'Erro Dois', email: 'erro2@gmail.com', banco: '', disciplina: '', turma: 'BC 9ZZZ', unidades: 'XX', coordenacao: 'BC EM 7ª Série', acesso_ate: '2026-13-40', ativo: 'TALVEZ' },
  { nome: 'Erro Tres', email: 'erro3', banco: 'SUPERVISOR', disciplina: 'Matemática', turma: '', unidades: '', coordenacao: '', acesso_ate: '', ativo: '' },
  { nome: 'Erro Quatro', email: 'erro3', banco: 'SUPERVISOR', disciplina: 'Matemática', turma: '', unidades: '', coordenacao: '', acesso_ate: '', ativo: '' },
  { nome: 'Sem Funcao', email: 'erro5', banco: '', disciplina: '', turma: '', unidades: '', coordenacao: '', acesso_ate: '', ativo: '' },
  { nome: 'Turma Alheia', email: 'erro6', banco: '', disciplina: '', turma: 'BC 1EMA', unidades: '', coordenacao: '', acesso_ate: '', ativo: '' }
];
r = await api('/api/adm/pessoas/previa', 'POST', { pessoas: ruins });
const motivos = Object.fromEntries((r.data.erros || []).map(e => [e.linha, e.motivo]));
ok('Prévia aponta cada problema com a linha (a linha 4, certa, fica de fora)', r.status === 200 && r.data.erros.map(e => e.linha).join(',') === '2,3,5,6,7', r.data.erros.map(e => e.linha + ': ' + e.motivo).join(' | '));
ok('Nome curto e disciplina desconhecida', /nome/.test(motivos[2] || '') && /Astrologia/.test(motivos[2] || ''), motivos[2]);
ok('E-mail fora do domínio, turma, unidade, coordenação, data e ativo inválidos', ['grupoideal', '9ZZZ', 'XX', '7ª Série', 'Data', 'Ativo'].every(t => (motivos[3] || '').includes(t)), motivos[3]);
ok('E-mail repetido e dois supervisores da mesma disciplina', /repetido/.test(motivos[5] || '') && /Duas pessoas/.test(motivos[5] || ''), motivos[5]);
ok('Linha sem função nenhuma', /pelo menos uma função/.test(motivos[6] || ''), motivos[6]);
ok('Turma que é de pessoa fora da planilha', /Dora Redação/.test(motivos[7] || ''), motivos[7]);
r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: ruins });
ok('Importação com erros é recusada (409) e não grava', r.status === 409 && conta('SELECT COUNT(*) AS n FROM usuarios') === antes, r.data.error);
r = await api('/api/adm/pessoas/previa', 'POST', { pessoas: Array.from({ length: 501 }, () => linhas[0]) });
ok('Mais de 500 linhas: recusado', r.status === 400);

/* Tela: o quadro existe, carrega o ExcelJS com integridade e monta o modelo com as 10 colunas. */
const html = fs.readFileSync(repo + 'atlas/admin.html', 'utf8');
ok('admin.html tem o quadro "Pessoas pela planilha" com baixar, conferir e importar', /id="sec-planilha"/.test(html) && /id="pl-baixar"/.test(html) && /id="pl-previa"/.test(html) && /id="pl-importar"/.test(html) && /id="pl-arquivo"/.test(html));
ok('ExcelJS vem do jsDelivr com integridade (igual à página de alunos)', /exceljs@4\.4\.0\/dist\/exceljs\.min\.js/.test(html) && /integrity='sha384-Pqp51FUN2\/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf\+arZvACkLkirlPz'/.test(html));
const { COLUNAS } = await import('../pessoas-planilha.js');
ok('Tela e servidor usam as mesmas 10 colunas', COLUNAS.length === 10 && COLUNAS.every(c => html.includes(c)), COLUNAS.filter(c => !html.includes(c)).join('|'));

for (const [estado, nome, extra] of results) console.log(estado.padEnd(7), nome, extra ? '— ' + extra : '');
const falhas = results.filter(x => x[0] === 'FALHOU').length;
console.log(falhas ? `FALHOU: ${falhas} falha(s) em ${results.length}` : `TODOS: ${results.length} verificações passaram`);
if (falhas) process.exitCode = 1;
