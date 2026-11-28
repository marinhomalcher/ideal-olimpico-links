// "Cadastros e funções" pela planilha (23/11/2026): a planilha é só do banco de questões
// (nome, e-mail e disciplina). A prévia confere sem gravar; a importação grava pelo salvarPessoa e define
// supervisores. Redação, digitalização, coordenação, prazo e ativo/inativo ficam como estão no banco.
// Dados fictícios; banco em memória.
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
const env = { DB: { prepare: sql => stmt(sql), batch: async ops => { for (const o of ops) await o.run(); } }, ADMIN_EMAIL: 'adm@example.com', ATLAS_HOJE_TESTE: '2026-11-23' };
db.prepare('INSERT INTO sessoes (token_hash, tipo, email, usuario_id, expira_em) VALUES (?, ?, ?, ?, ?)').run(createHash('sha256').update('adm-token').digest('hex'), 'adm', 'adm@example.com', null, '2099-01-01T00:00:00Z');
async function api(path, method = 'GET', body) {
  const r = await worker.fetch(new Request('https://atlas-api.example' + path, { method, headers: { Origin: 'https://idealolimpico.com.br', Authorization: 'Bearer adm-token', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: r.status, data: await r.json() };
}
const conta = sql => db.prepare(sql).get().n;
const pessoa = email => db.prepare('SELECT id, nome, disciplina, papel, ativo, digitador, classificador, acesso_ate FROM usuarios WHERE email = ?').get(email);
const turmasDe = id => db.prepare('SELECT turma_id FROM redacao_professor_turmas WHERE usuario_id = ?').all(id).map(x => x.turma_id);
const unidadesDe = id => db.prepare('SELECT unidade FROM redacao_digitalizador_unidades WHERE usuario_id = ? ORDER BY unidade').all(id).map(x => x.unidade).join(',');
const coordDe = id => db.prepare('SELECT serie FROM coordenadores WHERE usuario_id = ? ORDER BY serie').all(id).map(x => x.serie).join('|');
const turmaBC = db.prepare("SELECT id FROM redacao_turmas WHERE unidade = 'BC' AND codigo = '1EMA'").get().id;
const turmaAM = db.prepare("SELECT id FROM redacao_turmas WHERE unidade = 'AM' AND codigo = '2EMA'").get().id;

/* Uma pessoa cadastrada pela tela, com TODAS as funções que a planilha não controla. */
let r = await api('/api/adm/pessoas', 'POST', { nome: 'Marta Completa', email: 'marta@grupoideal.com.br', ativo: false, acesso_ate: '2027-03-31',
  banco: { tipo: 'professor', disciplina: 'Português', classificador: true },
  redacao: { professor: { turmas: [turmaBC] }, digitalizador: { unidades: ['BC', 'CN'] } },
  coordenacao: [{ unidade: 'BC', segmento: 'EM', serie: '1ª Série' }] });
ok('Cadastro pela tela continua funcionando', r.status === 200, r.data.error);
const marta = pessoa('marta@grupoideal.com.br');

/* A planilha do dia a dia: nome, e-mail e disciplina. Função vazia = professor. */
const linhas = [
  { linha: 2, nome: 'Anderson Moraes', email: 'anderson.moraes', disciplina: 'Artes', funcao: '' },
  { linha: 3, nome: 'Juliana Medeiros', email: 'juliana.lima@grupoideal.com.br', disciplina: 'artes', funcao: '' },
  { linha: 4, nome: 'Ana Supervisora', email: 'ana.sup', disciplina: 'matemática', funcao: 'Supervisor' },
  { linha: 5, nome: 'Carla Digitadora', email: 'carla.dig', disciplina: '', funcao: 'DIGITADOR' },
  { linha: 6, nome: 'Marta Completa', email: 'marta@grupoideal.com.br', disciplina: 'Português', funcao: '' }
];
r = await api('/api/adm/pessoas/previa', 'POST', { pessoas: linhas });
ok('Prévia: 4 novos e 1 sem mudança, nenhum erro', r.status === 200 && r.data.novos === 4 && r.data.iguais === 1 && r.data.atualizados === 0 && r.data.erros.length === 0, JSON.stringify(r.data.erros || r.data));
ok('Prévia lista o supervisor de Matemática', r.data.supervisores.length === 1 && r.data.supervisores[0].disciplina === 'Matemática' && r.data.supervisores[0].nome === 'Ana Supervisora');
ok('Prévia não grava nada', conta('SELECT COUNT(*) AS n FROM usuarios') === 1 && conta("SELECT COUNT(*) AS n FROM eventos WHERE acao = 'pessoas_importadas'") === 0);

r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: linhas });
ok('Importação grava as pessoas novas e devolve a lista', r.status === 200 && conta('SELECT COUNT(*) AS n FROM usuarios') === 5 && r.data.pessoas.length === 5, r.data.error);
const anderson = pessoa('anderson.moraes@grupoideal.com.br'), juliana = pessoa('juliana.lima@grupoideal.com.br');
ok('Só nome, e-mail e disciplina: vira professor da disciplina (e-mail sem @ é completado)',
  anderson && anderson.disciplina === 'Artes' && anderson.papel === 'professor' && anderson.digitador === 0 && anderson.ativo === 1, JSON.stringify(anderson));
ok('Disciplina em minúsculas vira a oficial', juliana && juliana.disciplina === 'Artes', JSON.stringify(juliana));
const ana = pessoa('ana.sup@grupoideal.com.br'), carla = pessoa('carla.dig@grupoideal.com.br');
ok('FUNÇÃO SUPERVISOR: vira supervisor da disciplina', ana && ana.papel === 'supervisor' && ana.disciplina === 'Matemática', JSON.stringify(ana));
ok('FUNÇÃO DIGITADOR: sem disciplina e sem classificador', carla && carla.digitador === 1 && carla.disciplina === null && carla.classificador === 0, JSON.stringify(carla));
ok('Pessoa nova entra sem prazo de acesso e ativa', anderson.acesso_ate === null && carla.ativo === 1);
ok('Evento de importação registrado', conta("SELECT COUNT(*) AS n FROM eventos WHERE acao = 'pessoas_importadas'") === 1);

/* O ponto central: a planilha não apaga o que não está nela. */
const m2 = pessoa('marta@grupoideal.com.br');
ok('Importar NÃO apaga a turma de redação de quem está na planilha', turmasDe(m2.id).join(',') === String(turmaBC), turmasDe(m2.id).join(','));
ok('Importar NÃO apaga as unidades do digitalizador', unidadesDe(m2.id) === 'BC,CN', unidadesDe(m2.id));
ok('Importar NÃO apaga a coordenação', coordDe(m2.id) === '1ª Série', coordDe(m2.id));
ok('Importar NÃO mexe no prazo de acesso, no ativo/inativo nem no classificador',
  m2.acesso_ate === '2027-03-31' && m2.ativo === 0 && m2.classificador === 1, JSON.stringify(m2));
ok('Nome e disciplina de quem já existe continuam os mesmos', m2.nome === 'Marta Completa' && m2.disciplina === 'Português' && m2.id === marta.id);

/* Reenviar a mesma planilha não muda nada. */
r = await api('/api/adm/pessoas/previa', 'POST', { pessoas: linhas });
ok('Reenviar a mesma planilha: tudo igual', r.status === 200 && r.data.iguais === 5 && r.data.novos === 0 && r.data.atualizados === 0, JSON.stringify(r.data));

/* Trocar disciplina e tirar alguém de supervisor. */
const trocas = [
  { linha: 2, nome: 'Anderson Moraes Silva', email: 'anderson.moraes', disciplina: 'História', funcao: '' },
  { linha: 3, nome: 'Ana Supervisora', email: 'ana.sup', disciplina: 'Matemática', funcao: 'PROFESSOR' }
];
r = await api('/api/adm/pessoas/previa', 'POST', { pessoas: trocas });
ok('Prévia vê as duas linhas como atualizadas', r.status === 200 && r.data.atualizados === 2 && r.data.novos === 0, JSON.stringify(r.data));
r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: trocas });
ok('Nome e disciplina trocados; quem veio como PROFESSOR deixa de ser supervisor',
  r.status === 200 && pessoa('anderson.moraes@grupoideal.com.br').disciplina === 'História' &&
  pessoa('anderson.moraes@grupoideal.com.br').nome === 'Anderson Moraes Silva' &&
  pessoa('ana.sup@grupoideal.com.br').papel === 'professor', r.data.error);
ok('Quem ficou fora da planilha não é tocado', unidadesDe(m2.id) === 'BC,CN' && pessoa('carla.dig@grupoideal.com.br').digitador === 1);

/* Pessoa que já existe e não tem função no banco: linha em branco é aceita e não apaga nada. */
r = await api('/api/adm/pessoas', 'POST', { nome: 'Dora Redação', email: 'dora.red@grupoideal.com.br',
  banco: null, redacao: { professor: null, digitalizador: { unidades: ['AM'] } }, coordenacao: [] });
const dora = pessoa('dora.red@grupoideal.com.br');
r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: [{ linha: 2, nome: 'Dora Redação', email: 'dora.red', disciplina: '', funcao: '' }] });
ok('Quem já existe sem função no banco: linha em branco passa e nada é apagado',
  r.status === 200 && r.data.iguais === 1 && pessoa('dora.red@grupoideal.com.br').disciplina === null && unidadesDe(dora.id) === 'AM', JSON.stringify(r.data.erros || ''));

/* REDAÇÃO: só cadastra a pessoa, sem função no banco (a turma é escolhida no site). */
r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: [
  { linha: 2, nome: 'Rita Redatora', email: 'rita.red', disciplina: 'Redação', funcao: '' },
  { linha: 3, nome: 'Rui Redator', email: 'rui.red', disciplina: '', funcao: 'REDAÇÃO' }
] });
const rita = pessoa('rita.red@grupoideal.com.br'), rui = pessoa('rui.red@grupoideal.com.br');
ok('REDAÇÃO na disciplina ou na função: cadastra a pessoa sem função no banco',
  r.status === 200 && rita && rita.disciplina === null && rita.digitador === 0 && rita.ativo === 1 && rui && rui.disciplina === null, JSON.stringify(r.data.erros || [rita, rui]));

/* A mesma pessoa em duas linhas, uma delas só cadastro: a de só cadastro é descartada. */
r = await api('/api/adm/pessoas/previa', 'POST', { pessoas: [
  { linha: 2, nome: 'Bia Dupla', email: 'bia.dupla', disciplina: 'Português', funcao: '' },
  { linha: 3, nome: 'Bia Dupla', email: 'bia.dupla', disciplina: 'Redação', funcao: '' }
] });
ok('Professora de Português que também corrige redação: as duas linhas viram uma, sem erro',
  r.status === 200 && r.data.erros.length === 0 && r.data.novos === 1 && r.data.repetidas === 1, JSON.stringify(r.data));
r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: [
  { linha: 2, nome: 'Bia Dupla', email: 'bia.dupla', disciplina: 'Redação', funcao: '' },
  { linha: 3, nome: 'Bia Dupla', email: 'bia.dupla', disciplina: 'Português', funcao: '' }
] });
ok('A ordem das duas linhas não importa: vale a que traz a disciplina',
  r.status === 200 && pessoa('bia.dupla@grupoideal.com.br')?.disciplina === 'Português', r.data.error);

/* Planilha de três colunas: não diz nada sobre supervisor, logo não pode rebaixar quem já é. */
await api('/api/adm/pessoas/importar', 'POST', { pessoas: [{ linha: 2, nome: 'Ana Supervisora', email: 'ana.sup', disciplina: 'Matemática', funcao: 'SUPERVISOR' }] });
r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: [
  { linha: 2, nome: 'Ana Supervisora', email: 'ana.sup', disciplina: 'Matemática' }
] });
ok('Sem a coluna FUNÇÃO, quem já é supervisor da mesma disciplina continua supervisor',
  r.status === 200 && pessoa('ana.sup@grupoideal.com.br')?.papel === 'supervisor', r.data.error);
r = await api('/api/adm/pessoas/previa', 'POST', { pessoas: [
  { linha: 2, nome: 'Ana Supervisora', email: 'ana.sup', disciplina: 'Matemática' }
] });
ok('E a prévia vê a linha como sem mudança', r.status === 200 && r.data.iguais === 1, JSON.stringify(r.data));
r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: [
  { linha: 2, nome: 'Ana Supervisora', email: 'ana.sup', disciplina: 'Matemática', funcao: 'PROFESSOR' }
] });
ok('Escrevendo PROFESSOR na FUNÇÃO, aí sim ela deixa de ser supervisora',
  r.status === 200 && pessoa('ana.sup@grupoideal.com.br')?.papel === 'professor', r.data.error);
r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: [
  { linha: 2, nome: 'Ana Supervisora', email: 'ana.sup', disciplina: 'Geografia', funcao: 'SUPERVISOR' },
  { linha: 3, nome: 'Ana Supervisora 2', email: 'ana.sup2', disciplina: 'Geografia' }
] });
ok('Trocar a disciplina do supervisor não arrasta o cargo para a disciplina nova sem querer',
  r.status === 200 && pessoa('ana.sup@grupoideal.com.br')?.papel === 'supervisor' && pessoa('ana.sup2@grupoideal.com.br')?.papel === 'professor', r.data.error);

/* Erros: cada linha com o motivo; importação recusada; nada gravado. */
const antes = conta('SELECT COUNT(*) AS n FROM usuarios');
const ruins = [
  { linha: 2, nome: 'E', email: 'erro1', disciplina: 'Astrologia', funcao: '' },
  { linha: 3, nome: 'Erro Dois', email: 'erro2@gmail.com', disciplina: 'Física', funcao: '' },
  { linha: 4, nome: 'Erro Tres', email: 'erro3', disciplina: 'Química', funcao: 'SUPERVISOR' },
  { linha: 5, nome: 'Erro Quatro', email: 'erro3', disciplina: 'Química', funcao: 'SUPERVISOR' },
  { linha: 6, nome: 'Sem Nada', email: 'erro5', disciplina: '', funcao: '' },
  { linha: 10, nome: 'Duas Disciplinas', email: 'erro8', disciplina: 'Física', funcao: '' },
  { linha: 11, nome: 'Duas Disciplinas', email: 'erro8', disciplina: 'Literatura', funcao: '' },
  { linha: 7, nome: 'Funcao Errada', email: 'erro6', disciplina: 'Física', funcao: 'CHEFE' },
  { linha: 8, nome: 'Supervisor Sem Disciplina', email: 'erro7', disciplina: '', funcao: 'SUPERVISOR' },
  { linha: 9, nome: 'Marta Completa', email: 'marta@grupoideal.com.br', disciplina: 'Português', funcao: 'SUPERVISOR' }
];
r = await api('/api/adm/pessoas/previa', 'POST', { pessoas: ruins });
const motivos = Object.fromEntries((r.data.erros || []).map(e => [e.linha, e.motivo]));
ok('Prévia aponta cada problema com a linha (a linha 4, certa, fica de fora)', r.status === 200 && r.data.erros.map(e => e.linha).join(',') === '2,3,5,6,7,8,9,11', r.data.erros.map(e => e.linha + ': ' + e.motivo).join(' | '));
ok('Nome curto e disciplina desconhecida', /nome/i.test(motivos[2] || '') && /Astrologia/.test(motivos[2] || ''), motivos[2]);
ok('E-mail fora do domínio (gmail) é recusado', /grupoideal/.test(motivos[3] || ''), motivos[3]);
ok('E-mail repetido e dois supervisores da mesma disciplina', /repetido/.test(motivos[5] || '') && /Duas pessoas/.test(motivos[5] || ''), motivos[5]);
ok('Pessoa nova sem disciplina é recusada', /Informe a disciplina/.test(motivos[6] || ''), motivos[6]);
ok('Mesma pessoa com duas disciplinas diferentes continua sendo erro', /repetido/.test(motivos[11] || ''), motivos[11]);
ok('Função inválida é recusada', /PROFESSOR, SUPERVISOR, DIGITADOR, REDAÇÃO/.test(motivos[7] || ''), motivos[7]);
ok('Supervisor sem disciplina é recusado', /Informe a disciplina/.test(motivos[8] || ''), motivos[8]);
ok('Supervisor precisa estar ativo', /ativo/.test(motivos[9] || ''), motivos[9]);
r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: ruins });
ok('Importação com erros é recusada (409) e não grava', r.status === 409 && conta('SELECT COUNT(*) AS n FROM usuarios') === antes, r.data.error);
r = await api('/api/adm/pessoas/previa', 'POST', { pessoas: Array.from({ length: 501 }, () => linhas[0]) });
ok('Mais de 500 linhas: recusado', r.status === 400);

/* Pela lista: quem está sem disciplina pode receber uma, e quem tem pode sair do banco, sem perder
   as outras funções (é o menu "— sem disciplina —" da coluna Disciplina). */
r = await api('/api/adm/pessoas', 'POST', { nome: 'Rosa Só Redação', email: 'rosa.red@grupoideal.com.br',
  banco: null, redacao: { professor: { turmas: [turmaAM] }, digitalizador: null },
  coordenacao: [{ unidade: 'BC', segmento: 'EM', serie: '1ª Série' }] });
const rosa = pessoa('rosa.red@grupoideal.com.br');
ok('Pessoa sem disciplina pode ser criada (professora só de redação)', r.status === 200 && rosa && rosa.disciplina === null, r.data.error);
r = await api('/api/adm/pessoas/' + rosa.id, 'PUT', { banco: { tipo: 'professor', disciplina: 'Literatura', classificador: false } });
ok('Dar disciplina a quem estava sem: entra no banco e mantém turma e coordenação',
  r.status === 200 && pessoa('rosa.red@grupoideal.com.br').disciplina === 'Literatura' &&
  turmasDe(rosa.id).join(',') === String(turmaAM) && coordDe(rosa.id) === '1ª Série', r.data.error);
r = await api('/api/adm/pessoas/' + rosa.id, 'PUT', { banco: null });
ok('Escolher "sem disciplina" tira do banco e também mantém turma e coordenação',
  r.status === 200 && pessoa('rosa.red@grupoideal.com.br').disciplina === null &&
  turmasDe(rosa.id).join(',') === String(turmaAM) && coordDe(rosa.id) === '1ª Série', r.data.error);

/* Redação: só quem está sem disciplina no banco ou é da área de linguagens. */
r = await api('/api/adm/pessoas', 'POST', { nome: 'Nina Matematica', email: 'nina.mat@grupoideal.com.br',
  banco: { tipo: 'professor', disciplina: 'Matemática', classificador: false },
  redacao: { professor: { turmas: [] }, digitalizador: null }, coordenacao: [] });
ok('Professora de Matemática não pode corrigir redação', r.status === 400 && /linguagens/.test(r.data.error || ''), r.status + ' ' + r.data.error);
r = await api('/api/adm/pessoas', 'POST', { nome: 'Nina Matematica', email: 'nina.mat@grupoideal.com.br',
  banco: { tipo: 'professor', disciplina: 'Matemática', classificador: false },
  redacao: { professor: null, digitalizador: { unidades: ['BC'] } }, coordenacao: [] });
ok('Mas pode ser digitalizadora', r.status === 200, r.data.error);
const nina = pessoa('nina.mat@grupoideal.com.br');
r = await api('/api/adm/pessoas/' + nina.id, 'PUT', { redacao: { professor: { turmas: [] }, digitalizador: { unidades: ['BC'] } } });
ok('Nem depois, pela edição', r.status === 400 && /linguagens/.test(r.data.error || ''), r.status + ' ' + r.data.error);
for (const d of ['Português', 'Literatura', 'Inglês', 'Artes']) {
  const email = 'ling.' + d.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '') + '@grupoideal.com.br';
  const x = await api('/api/adm/pessoas', 'POST', { nome: 'Professora de ' + d, email,
    banco: { tipo: 'professor', disciplina: d, classificador: false },
    redacao: { professor: { turmas: [] }, digitalizador: null }, coordenacao: [] });
  ok('Professor(a) de ' + d + ' pode corrigir redação', x.status === 200, x.data.error);
}
/* Trocar a disciplina de quem corrige redação para fora de linguagens é recusado. */
const ling = pessoa('ling.portugues@grupoideal.com.br');
r = await api('/api/adm/pessoas/' + ling.id, 'PUT', { banco: { tipo: 'professor', disciplina: 'Física', classificador: false } });
ok('Pôr Física em quem corrige redação é recusado, com recado claro', r.status === 400 && /linguagens/.test(r.data.error || ''), r.status + ' ' + r.data.error);

/* Planilha: Redação na disciplina marca a função (e mantém o que a pessoa já tem). */
r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: [
  { linha: 2, nome: 'Vera Redação', email: 'vera.red', disciplina: 'Redação' }
] });
const vera = pessoa('vera.red@grupoideal.com.br');
const veraProf = db.prepare('SELECT professor FROM redacao_equipe WHERE usuario_id = ?').get(vera?.id)?.professor;
ok('Planilha com Redação cadastra a pessoa JÁ como professora de redação', r.status === 200 && vera && vera.disciplina === null && veraProf === 1, r.data.error);
r = await api('/api/adm/pessoas/previa', 'POST', { pessoas: [{ linha: 2, nome: 'Vera Redação', email: 'vera.red', disciplina: 'Redação' }] });
ok('Reenviar a linha de Redação não muda nada', r.status === 200 && r.data.iguais === 1, JSON.stringify(r.data));


/* SÉRIES (28/11/2026): coluna opcional; sem a coluna não mexe; em branco = nenhuma; valores inválidos dão erro. */
const seriesDe = email => db.prepare('SELECT serie FROM professor_series WHERE usuario_id = ? ORDER BY serie').all(pessoa(email).id).map(x => x.serie).join(',');
r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: [{ linha: 2, nome: 'Sérgio Séries', email: 'sergio.series', disciplina: 'Física', funcao: '', series: '1ª, 3ª série' }] });
ok('SÉRIES: "1ª, 3ª série" grava as séries 1 e 3', r.status === 200 && seriesDe('sergio.series@grupoideal.com.br') === '1,3', JSON.stringify(r.data).slice(0, 200));
r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: [{ linha: 2, nome: 'Sérgio Séries', email: 'sergio.series', disciplina: 'Física', funcao: '' }] });
ok('Sem a coluna SÉRIES (modelo antigo) as séries ficam como estão', r.status === 200 && seriesDe('sergio.series@grupoideal.com.br') === '1,3');
r = await api('/api/adm/pessoas/previa', 'POST', { pessoas: [{ linha: 2, nome: 'Sérgio Séries', email: 'sergio.series', disciplina: 'Física', funcao: '', series: '1, 3' }] });
ok('Mesmas séries na planilha: linha sem mudança', r.status === 200 && r.data.iguais === 1 && r.data.atualizados === 0, JSON.stringify(r.data).slice(0, 200));
r = await api('/api/adm/pessoas/previa', 'POST', { pessoas: [{ linha: 2, nome: 'Sérgio Séries', email: 'sergio.series', disciplina: 'Física', funcao: '', series: '4' }] });
ok('Série fora de 1 a 3 é erro da linha', r.status === 200 && r.data.erros.length === 1 && /Séries/.test(r.data.erros[0].motivo), JSON.stringify(r.data.erros));
r = await api('/api/adm/pessoas/importar', 'POST', { pessoas: [{ linha: 2, nome: 'Sérgio Séries', email: 'sergio.series', disciplina: 'Física', funcao: '', series: '' }] });
ok('SÉRIES em branco tira todas as séries', r.status === 200 && seriesDe('sergio.series@grupoideal.com.br') === '');
/* Tela: o quadro existe, carrega o ExcelJS com integridade e monta o modelo com as 4 colunas. */
const html = fs.readFileSync(repo + 'atlas/admin.html', 'utf8');
ok('admin.html tem o quadro "Cadastro por planilha" com baixar, conferir e importar', /id="sec-planilha"/.test(html) && /id="pl-baixar"/.test(html) && /id="pl-previa"/.test(html) && /id="pl-importar"/.test(html) && /id="pl-arquivo"/.test(html));
ok('ExcelJS vem do jsDelivr com integridade (igual à página de alunos)', /exceljs@4\.4\.0\/dist\/exceljs\.min\.js/.test(html) && /integrity='sha384-Pqp51FUN2\/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf\+arZvACkLkirlPz'/.test(html));
const { COLUNAS } = await import('../pessoas-planilha.js');
ok('Tela e servidor usam as mesmas 3 colunas', COLUNAS.length === 3 && COLUNAS.every(c => html.includes(c)), COLUNAS.filter(c => !html.includes(c)).join('|'));
ok('A tela lê o modelo e ainda aceita a coluna FUNÇÃO antiga', html.includes("cFuncao=achar('FUNCAO')") && html.includes("funcao:cFuncao?v(cFuncao):''") && html.includes('precisa começar com NOME COMPLETO, E-MAIL e DISCIPLINA'));
ok('A coluna Disciplina da lista tem menu para todos, com “sem disciplina” e Redação', html.includes('— sem disciplina —') && html.includes('<option value="__red__"') && !html.includes("!t.disciplina?'<small>—</small>'"));
ok('Escolher Redação marca a função de redação sem mexer no digitalizador', html.includes("if(valor==='__red__')return {banco:null,redacao:{professor:{turmas:r.turmas||[]},digitalizador:dig}}"));
ok('A tela avisa e desliga a função de redação fora da área de linguagens', html.includes("const LINGUAGENS=['Português','Literatura','Inglês','Artes']") && html.includes("$('#f-red-prof').disabled=!podeRedacao") && html.includes('id="red-prof-aviso"'));
ok('Escolher \'sem disciplina\' manda banco:null (não uma disciplina vazia)', html.includes('{banco:null}') && html.includes("'Pessoa retirada do banco de questões.'"));
ok('A tela não pede mais as colunas que saíram', !/BANCO DE QUESTÕES/.test(html) && !/PROFESSOR DE REDAÇÃO \(TURMA\)/.test(html) && !/COORDENADOR \(UNIDADE SEGMENTO SÉRIE\)/.test(html) && !/'ACESSO ATÉ'/.test(html));

for (const [estado, nome, extra] of results) console.log(estado.padEnd(7), nome, extra ? '— ' + extra : '');
const falhas = results.filter(x => x[0] === 'FALHOU').length;
console.log(falhas ? `FALHOU: ${falhas} falha(s) em ${results.length}` : `TODOS: ${results.length} verificações passaram`);
if (falhas) process.exitCode = 1;
