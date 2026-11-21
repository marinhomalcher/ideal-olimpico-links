// Cadastro completo de alunos (21/11/2026): planilha da escola com 15 colunas, prévia e importação (com a lista
// da Redação junto), planilha modelo e planilha atual, consulta, e as rotas do Portal (ler e confirmar dados).
// Também confere os textos trocados em 21/11/2026 (títulos sem ano, nomes dos arquivos). Dados fictícios; banco em memória.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const worker = (await import('../worker.js')).default;
const sql = fs.readFileSync(repo + '_cloudflare/atlas-api/schema.sql', 'utf8');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(sql);
const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'OK' : 'FALHOU', name, String(extra).slice(0, 300)]);
function stmt(q, args = []) {
  return { bind: (...a) => stmt(q, a),
    run: async () => { const r = db.prepare(q).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    first: async () => db.prepare(q).get(...args) ?? null,
    all: async () => ({ results: db.prepare(q).all(...args) }) };
}
const SEGREDO = 'segredo-do-portal-para-os-testes-0123456789';
const env = { DB: { prepare: q => stmt(q), batch: async ops => { for (const o of ops) await o.run(); } }, ADMIN_EMAIL: 'adm@example.com', ATLAS_HOJE_TESTE: '2026-11-21', PORTAL_ATLAS_SECRET: SEGREDO };
db.prepare('INSERT INTO sessoes (token_hash, tipo, email, usuario_id, expira_em) VALUES (?, ?, ?, ?, ?)').run(createHash('sha256').update('adm-token').digest('hex'), 'adm', 'adm@example.com', null, '2099-01-01T00:00:00Z');
const origin = 'https://idealolimpico.com.br';
async function api(path, method = 'GET', body) {
  const r = await worker.fetch(new Request('https://atlas-api.example' + path, { method, headers: { Origin: origin, Authorization: 'Bearer adm-token', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: r.status, data: await r.json() };
}
async function portal(path, body, { segredo = SEGREDO, origem = null } = {}) {
  const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + segredo, ...(origem ? { Origin: origem } : {}) };
  const r = await worker.fetch(new Request('https://atlas-api.example' + path, { method: 'POST', headers: h, body: JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: r.status, data: await r.json() };
}
const conta = (q, ...a) => db.prepare(q).get(...a).n;
const aluno = ra => db.prepare('SELECT * FROM alunos WHERE ra = ?').get(ra);

/* ---------- migração ---------- */
ok('Schema 20', db.prepare("SELECT valor FROM meta WHERE chave='schema_versao'").get().valor === '20');
{ const m = new DatabaseSync(':memory:');
  m.exec(sql.split('-- ---------- v19 ----------')[0]); m.exec(fs.readFileSync(repo + '_cloudflare/atlas-api/migrations/0019_alunos.sql', 'utf8'));
  ok('Migração 0019 cria a tabela alunos e marca a versão 19', m.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'alunos'").get().n === 1 && m.prepare("SELECT valor FROM meta WHERE chave = 'schema_versao'").get().valor === '19'); }
ok('Cópia de segurança inclui a tabela alunos', /'desempenho_gabaritos', 'alunos']/.test(fs.readFileSync(repo + '_cloudflare/atlas-api/worker.js', 'utf8')));

/* ---------- importação da planilha da escola (15 colunas) ---------- */
const linhas = [
  { nome: 'Aluna Médio', ra: '30001', unidade: 'Batista Campos', serie: '3ª Série', turma: 'XEMA', segmento: 'em', sexo: 'f', nascimento: '2008-10-01', cpf: '4085514296', email_institucional: '30001@aluno.grupoideal.com.br', email_pessoal: 'Familia.Medio@example.com', responsavel: 'Responsável Médio', responsavel_email: '', telefone: '91992210167' },
  { nome: 'Aluno Fund2', ra: '30002', unidade: 'BC', serie: '7ANO', turma: '7EFA', segmento: 'EF2', sexo: 'M', nascimento: '14/03/2014', cpf: '', email_institucional: '', email_pessoal: '', responsavel: 'Responsável Fund2', responsavel_email: 'resp2@example.com', telefone: '' },
  { nome: 'Aluna Fund1', ra: '30003', unidade: 'AM', serie: '4ANO', turma: '4EFA', segmento: 'EF1', sexo: 'F', nascimento: '2.5.2017', cpf: '', email_institucional: '', email_pessoal: '', responsavel: 'Responsável Fund1', responsavel_email: '', telefone: '' }
];
let r = await api('/api/adm/alunos/previa', 'POST', { ano: 2026, alunos: linhas });
ok('Prévia: 3 novos, 1 do EF1, duas turmas novas na Redação (XEMA e 7EFA; a do EF1 não), sem conflito', r.status === 200 && r.data.novos === 3 && r.data.atualizados === 0 && r.data.ef1 === 1 && r.data.novas_turmas.map(t => t.codigo).sort().join(',') === '7EFA,XEMA' && r.data.conflitos.length === 0, JSON.stringify(r.data));
ok('Prévia não grava nada', conta('SELECT COUNT(*) AS n FROM alunos') === 0 && conta('SELECT COUNT(*) AS n FROM redacao_alunos') === 0);
r = await api('/api/adm/alunos/importar', 'POST', { ano: 2026, alunos: linhas });
ok('Importação grava os 3 alunos (com EF1) e devolve o resumo', r.status === 200 && r.data.novos === 3 && conta('SELECT COUNT(*) AS n FROM alunos') === 3, r.data.error);
const a1 = aluno('30001'), a3 = aluno('30003');
ok('Unidade por nome vira sigla; segmento em minúsculas; data AAAA-MM-DD vira DD/MM/AAAA; CPF ganha o zero perdido; e-mail em minúsculas',
  a1.unidade === 'BC' && a1.segmento === 'EM' && a1.nascimento === '01/10/2008' && a1.cpf === '04085514296' && a1.email_pessoal === 'familia.medio@example.com' && a1.sexo === 'F' && a1.telefone === '91992210167', JSON.stringify(a1));
ok('Data com pontos também é entendida (2.5.2017 → 02/05/2017)', a3.nascimento === '02/05/2017', a3.nascimento);
ok('Redação: só EF2 e EM entram em redacao_alunos, e a turma XEMA foi criada', conta('SELECT COUNT(*) AS n FROM redacao_alunos') === 2 && !db.prepare("SELECT 1 FROM redacao_alunos WHERE ra = '30003'").get() && conta("SELECT COUNT(*) AS n FROM redacao_turmas WHERE unidade = 'BC' AND codigo = 'XEMA' AND segmento = 'EM'") === 1);
ok('Eventos registrados (alunos e Redação)', conta("SELECT COUNT(*) AS n FROM eventos WHERE acao = 'alunos_importados'") === 1 && conta("SELECT COUNT(*) AS n FROM eventos WHERE acao = 'redacao_alunos_importados'") === 1);
r = await api('/api/adm/alunos/previa', 'POST', { ano: 2026, alunos: linhas });
ok('Reenviar a mesma planilha: tudo igual', r.status === 200 && r.data.iguais === 3 && r.data.novos === 0 && r.data.atualizados === 0, JSON.stringify(r.data));
r = await api('/api/adm/alunos', 'GET');
ok('Lista completa com idade calculada (01/10/2008 em 21/11/2026 = 18 anos) e as colunas da planilha', r.status === 200 && r.data.alunos.length === 3 && r.data.alunos.find(x => x.ra === '30001').idade === 18 && r.data.colunas.length === 15 && r.data.colunas_portal.length === 4 && r.data.ano === 2026, JSON.stringify(r.data).slice(0, 200));

/* erros de planilha */
r = await api('/api/adm/alunos/previa', 'POST', { ano: 2026, alunos: [{ ...linhas[0], ra: 'A1' }] });
ok('RA inválido é recusado com a linha', r.status === 400 && /Linha 2: RA inválido/.test(r.data.error), r.data.error);
r = await api('/api/adm/alunos/previa', 'POST', { ano: 2026, alunos: [{ ...linhas[0], unidade: 'XX' }] });
ok('FILIAL inválida é recusada', r.status === 400 && /FILIAL/.test(r.data.error), r.data.error);
r = await api('/api/adm/alunos/previa', 'POST', { ano: 2026, alunos: [linhas[0], linhas[0]] });
ok('RA repetido é recusado', r.status === 400 && /repetido/.test(r.data.error), r.data.error);
r = await api('/api/adm/alunos/previa', 'POST', { ano: 2025, alunos: linhas });
ok('Planilha de outro ano é recusada', r.status === 400 && /ano atual/.test(r.data.error), r.data.error);
r = await api('/api/adm/alunos/importar', 'POST', { ano: 2026, alunos: [{ ...linhas[0], serie: '2ª Série' }] });
ok('Mudança de série no mesmo ano (regra da Redação) bloqueia a importação inteira', r.status === 409 && aluno('30001').serie === '3ª Série', r.data.error);

/* ---------- Portal: ler e confirmar ---------- */
r = await portal('/api/portal/aluno', { ra: '30001' });
ok('Portal lê o aluno com os nomes dos campos do Portal (ainda não confirmado)', r.status === 200 && r.data.aluno.matricula === '30001' && r.data.aluno.nome === 'Aluna Médio' && r.data.aluno.segmento === 'EM' && r.data.aluno.dataNascimento === '01/10/2008' && r.data.aluno.email === '30001@aluno.grupoideal.com.br' && r.data.aluno.cpf === '04085514296' && r.data.aluno.emailPessoal === 'familia.medio@example.com' && r.data.aluno.contatosConfirmadosNesteAno === false && r.data.aluno.anoAtual === 2026, JSON.stringify(r.data));
r = await portal('/api/portal/aluno', { ra: '30002' });
ok('Aluno sem e-mail institucional na planilha: o Portal recebe RA@aluno.grupoideal.com.br', r.data.aluno.email === '30002@aluno.grupoideal.com.br');
r = await portal('/api/portal/aluno', { ra: '99999' });
ok('Matrícula fora da lista: aluno nulo (não é erro)', r.status === 200 && r.data.aluno === null);
r = await portal('/api/portal/aluno', { ra: '30001' }, { origem: origin });
ok('Rota do Portal recusa navegador (com Origin)', r.status === 403);
r = await portal('/api/portal/aluno', { ra: '30001' }, { segredo: 'errado' });
ok('Rota do Portal recusa segredo errado', r.status === 401);
r = await portal('/api/portal/aluno', { ra: 'x' });
ok('Matrícula inválida é recusada', r.status === 400);

const contatosEM = { whatsappAluno: '(91) 99999-9999', responsavelNome: '', responsavelVinculo: '', responsavelWhatsapp: '', emailPessoal: 'nova.familia@example.com', cpf: '529.982.247-25' };
r = await portal('/api/portal/aluno/confirmar', { ra: '30001', dados: { ...contatosEM, whatsappAluno: '' } });
ok('EM sem WhatsApp do aluno: recusado com a mensagem do Portal', r.status === 400 && /WhatsApp válido do aluno/.test(r.data.error), r.data.error);
r = await portal('/api/portal/aluno/confirmar', { ra: '30001', dados: { ...contatosEM, cpf: '11111111111' } });
ok('CPF inválido: recusado', r.status === 400 && /CPF válido/.test(r.data.error), r.data.error);
r = await portal('/api/portal/aluno/confirmar', { ra: '30001', dados: { ...contatosEM, responsavelNome: 'Só o nome' } });
ok('EM com responsável incompleto: recusado', r.status === 400 && /nome, vínculo e WhatsApp/.test(r.data.error), r.data.error);
r = await portal('/api/portal/aluno/confirmar', { ra: '30001', dados: contatosEM });
ok('Confirmação do EM grava CPF (só dígitos), e-mail, WhatsApp e a data; o Portal recebe "confirmado neste ano"', r.status === 200 && r.data.aluno.contatosConfirmadosNesteAno === true && r.data.aluno.contatosConfirmadosAno === new Date().getUTCFullYear() && aluno('30001').cpf === '52998224725' && aluno('30001').email_pessoal === 'nova.familia@example.com' && aluno('30001').whatsapp_aluno === '(91) 99999-9999' && /^\d{4}-\d{2}-\d{2}T/.test(aluno('30001').confirmado_em), JSON.stringify(r.data));
r = await portal('/api/portal/aluno/confirmar', { ra: '30003', dados: { whatsappAluno: '(91) 98888-8888', responsavelNome: '', responsavelVinculo: '', responsavelWhatsapp: '', emailPessoal: 'resp1@example.com', cpf: '52998224725' } });
ok('EF1 sem responsável: recusado', r.status === 400 && /responsável/.test(r.data.error), r.data.error);
r = await portal('/api/portal/aluno/confirmar', { ra: '30003', dados: { whatsappAluno: '(91) 98888-8888', responsavelNome: 'Mãe Fund1', responsavelVinculo: 'Mãe', responsavelWhatsapp: '(91) 97777-6666', emailPessoal: 'resp1@example.com', cpf: '52998224725' } });
ok('EF1 com responsável: grava o responsável e ignora o WhatsApp do aluno', r.status === 200 && aluno('30003').responsavel === 'Mãe Fund1' && aluno('30003').responsavel_vinculo === 'Mãe' && aluno('30003').responsavel_whatsapp === '(91) 97777-6666' && aluno('30003').whatsapp_aluno === '', JSON.stringify(r.data));
r = await portal('/api/portal/aluno/confirmar', { ra: '30003', dados: { whatsappAluno: '', responsavelNome: 'Mãe Fund1', responsavelVinculo: 'Madrinha', responsavelWhatsapp: '(91) 97777-6666', emailPessoal: 'resp1@example.com', cpf: '52998224725' } });
ok('Vínculo fora da lista do Portal: recusado', r.status === 400 && /Vínculo/.test(r.data.error), r.data.error);
r = await portal('/api/portal/aluno/confirmar', { ra: '99999', dados: contatosEM });
ok('Confirmação de matrícula fora da lista: 404', r.status === 404);

/* a planilha da escola de novo: as colunas da escola prevalecem, o que o aluno preencheu no Portal fica */
r = await api('/api/adm/alunos/importar', 'POST', { ano: 2026, alunos: linhas });
ok('Reimportar a planilha da escola: atualiza as colunas da escola (CPF e e-mail voltam) e mantém WhatsApp, vínculo e a confirmação', r.status === 200 && r.data.atualizados === 2 && aluno('30001').cpf === '04085514296' && aluno('30001').whatsapp_aluno === '(91) 99999-9999' && aluno('30001').confirmado_em && aluno('30003').responsavel_vinculo === 'Mãe', JSON.stringify(r.data));
r = await api('/api/adm/alunos/importar', 'POST', { ano: 2026, alunos: [{ ...linhas[0], whatsapp_aluno: '(91) 91111-1111', responsavel_vinculo: '', responsavel_whatsapp: '' }] });
ok('Planilha atual (com as colunas do Portal) também grava essas colunas', r.status === 200 && aluno('30001').whatsapp_aluno === '(91) 91111-1111', JSON.stringify(r.data));
r = await api('/api/adm/alunos', 'GET');
const exp = r.data.alunos.find(x => x.ra === '30001');
ok('Lista traz o que o Portal confirmou', exp.whatsapp_aluno === '(91) 91111-1111' && !!exp.confirmado_em);

/* ---------- textos trocados em 21/11/2026 ---------- */
const ler = p => fs.readFileSync(repo + p, 'utf8');
const adminHtml = ler('atlas/admin.html');
ok('Cadastros: "Professores cadastrados", "Cadastro por planilha", "Baixar planilha modelo" e arquivo "modelo de cadastro.xlsx" (sem data)', adminHtml.includes('<h2>Professores cadastrados</h2>') && adminHtml.includes('<h2>Cadastro por planilha</h2>') && adminHtml.includes('id="pl-baixar">Baixar planilha modelo</button>') && adminHtml.includes("a.download='modelo de cadastro.xlsx'") && !adminHtml.includes('Pessoas cadastradas') && !adminHtml.includes('pessoas-atlas-'));
const rel = ler('atlas/admin-relatorio.html');
ok('Relatório: "Painel de produção · …" sem o ano no título', rel.includes("'Painel de produção · '+tituloRecorte(d)") && !rel.includes("'Produção de '+d.ano"));
const red = ler('atlas/redacao-admin.html');
ok('Redação: "Turmas cadastradas" sem o ano', red.includes('Turmas cadastradas</h2>') && !red.includes('turma-ano'));
const alHtml = ler('atlas/alunos-admin.html');
ok('Alunos: "Cadastrar alunos", "Consultar alunos", botões de planilha modelo e atual, arquivos sem data', alHtml.includes('<h2>Cadastrar alunos</h2>') && alHtml.includes('<h2>Consultar alunos</h2>') && alHtml.includes('id="modelo-button"') && alHtml.includes('id="atual-button"') && alHtml.includes("'modelo de alunos.xlsx'") && alHtml.includes("'alunos.xlsx'") && !/hojeSP\(\)\+'\.xlsx'/.test(alHtml));
const hub = ler('adm/index.html');
ok('/adm/: a seção "Ações na planilha" da aba Inscrições saiu (a de Olimpíadas fica)', !/id="aba-inscricoes"[\s\S]*?<div class="grupo">[\s\S]*?id="aba-olimpiadas"/.test(hub) && !hub.includes('coordenadorDesconectarLembrados') && !hub.includes('coordenadorAtualizarHistorico') && !hub.includes('coordenadorTestarAviso'));
ok('Portal: portal.js envia a prova do ATLAS na confirmação; o Worker do portal lê e grava no ATLAS', /atlasProva/.test(ler('inscricoes/portal.js')) && /atlas:\{ra:alunoAtual\.matricula,prova:alunoAtual\.atlasProva\}/.test(ler('inscricoes/portal.js')) && /\/api\/portal\/aluno\/confirmar/.test(ler('_cloudflare/ideal-olimpico-producao/worker.js')) && /ATLAS_API_URL = "https:\/\/atlas-api\.marinhomalcher\.workers\.dev"/.test(ler('_cloudflare/ideal-olimpico-producao/wrangler.toml')));

/* ---------- tela Alunos ---------- */
const atlas = repo + 'atlas/';
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!/^[a-z0-9.-]+$/i.test(name) || !fs.existsSync(atlas + name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.json') ? 'application/json' : 'image/png');
  res.end(fs.readFileSync(atlas + name));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('https://atlas-api.marinhomalcher.workers.dev/**', async route => {
  const req = route.request(), u = new URL(req.url()), dados = req.postData();
  const rr = u.pathname === '/api/adm/sessao' ? { status: 200, data: { ok: true, email: 'adm@example.com' } }
    : await api(u.pathname + u.search, req.method(), dados ? JSON.parse(dados) : undefined);
  await route.fulfill({ status: rr.status, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' }, body: JSON.stringify(rr.data) });
});
const CDN = (process.env.ATLAS_TESTE_TMP || '/tmp/atlas-testes') + '/cdn/package/dist/exceljs.min.js';
await page.route('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js', r2 => r2.fulfill({ status: 200, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(CDN) }));
const E = require(CDN);
async function lerXlsx(download) {
  const wb = new E.Workbook();
  await wb.xlsx.load(fs.readFileSync(await download.path()));
  const ws = wb.getWorksheet('ALUNOS');
  const linhasWs = []; ws.eachRow(row => linhasWs.push(row.values.slice(1).map(v => v instanceof Date ? v.toISOString() : String(v ?? ''))));
  return { wb, ws, linhas: linhasWs };
}
await page.goto(base + '/alunos-admin.html');
await page.evaluate(() => sessionStorage.setItem('atlas_adm_token', 'adm-token'));
await page.reload();
await page.locator('#app').waitFor({ state: 'visible' });
ok('Tela: títulos "Cadastrar alunos" e "Consultar alunos"', (await page.locator('#app h2').allTextContents()).join('|') === 'Cadastrar alunos|Consultar alunos');
let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#modelo-button')]);
let x = await lerXlsx(dl);
ok('Planilha modelo: arquivo "modelo de alunos.xlsx", só os 15 títulos da planilha da escola e a aba INSTRUÇÕES', dl.suggestedFilename() === 'modelo de alunos.xlsx' && x.linhas.length === 1 && x.linhas[0].join('|') === 'NOME COMPLETO|RA|FILIAL|SÉRIE|CODTURMA|SEGMENTO|SEXO|DAT_NASC|IDADE|CPF|EMAIL INSTITUCIONAL ALUNO|EMAIL PESSOAL ALUNO|RESPONSÁVEL FINANCEIRO|EMAIL PESSOAL RESPONSÁVEL|TELEFONE' && !!x.wb.getWorksheet('INSTRUÇÕES'), dl.suggestedFilename() + ' ' + x.linhas[0].join('|'));
[dl] = await Promise.all([page.waitForEvent('download'), page.click('#atual-button')]);
x = await lerXlsx(dl);
const l1 = x.linhas.find(l => l[1] === '30001');
ok('Planilha atual: arquivo "alunos.xlsx", 15 + 4 colunas, os 3 alunos, idade calculada, WhatsApp e confirmação do Portal, números centralizados', dl.suggestedFilename() === 'alunos.xlsx' && x.linhas.length === 4 && x.linhas[0].length === 19 && x.linhas[0].slice(15).join('|') === 'WHATSAPP ALUNO|VÍNCULO DO RESPONSÁVEL|WHATSAPP RESPONSÁVEL|CONFIRMADO NO PORTAL' && l1 && l1[8] === '18' && l1[15] === '(91) 91111-1111' && /^\d{2}\/\d{2}\/\d{4}$/.test(l1[18]) && x.ws.getColumn(10).alignment?.horizontal === 'center', dl.suggestedFilename() + ' ' + JSON.stringify(l1));
await page.locator('#c-unidade').selectOption('AM');
const segs = await page.locator('#c-segmento option').allTextContents();
ok('Consulta: o Fundamental I aparece (vem do cadastro completo, não da Redação)', segs.includes('Fundamental I'), segs.join(','));
await page.locator('#c-segmento').selectOption('EF1');
await page.locator('#c-serie').selectOption('4ANO');
await page.locator('#consultar-turma').selectOption('4EFA');
await page.waitForFunction(() => /aluno\(s\) nesta turma/.test(document.querySelector('#consultar-status').textContent));
const linhaTela = await page.locator('#alunos-lista tr').first().locator('td').allTextContents();
ok('Consulta: a turma do EF1 mostra RA, nome, nascimento, WhatsApp do Portal e a data da confirmação', (await page.locator('#alunos-lista tr').count()) === 1 && linhaTela[0] === '30003' && linhaTela[1] === 'Aluna Fund1' && linhaTela[2] === '02/05/2017' && linhaTela[5] === '(91) 97777-6666' && /^\d{2}\/\d{2}\/\d{4}$/.test(linhaTela[6]), linhaTela.join('|'));
{
  const wb = new E.Workbook(), ws = wb.addWorksheet('ALUNOS');
  ws.addRow(['NOME COMPLETO', 'RA', 'FILIAL', 'SÉRIE', 'CODTURMA', 'SEGMENTO', 'SEXO', 'DAT_NASC', 'IDADE', 'CPF', 'EMAIL INSTITUCIONAL ALUNO', 'EMAIL PESSOAL ALUNO', 'RESPONSÁVEL FINANCEIRO', 'EMAIL PESSOAL RESPONSÁVEL', 'TELEFONE']);
  ws.addRow(['ALUNO DA PLANILHA', 30004, 'CN', '1ª Série', '1EMC', 'EM', 'M', new Date(Date.UTC(2009, 6, 15)), '', 4085514296, '', 'planilha@example.com', 'RESP PLANILHA', '', 91988887777]);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  await page.locator('#arquivo').setInputFiles({ name: 'ALUNOS_2026.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx });
  await page.locator('#previa-button').click();
  await page.waitForFunction(() => /Prévia pronta/.test(document.querySelector('#alunos-status').textContent), null, { timeout: 15000 }).catch(() => {});
  ok('Tela: prévia da planilha da escola (números como números, data do Excel)', /1 alunos · 1 novos/.test(await page.locator('#previa').textContent()) && /1 turmas novas na Redação/.test(await page.locator('#previa').textContent()), await page.locator('#alunos-status').textContent() + ' ' + await page.locator('#previa').textContent());
  await page.locator('#importar-button').click();
  await page.waitForFunction(() => /Importação concluída/.test(document.querySelector('#alunos-status').textContent), null, { timeout: 15000 }).catch(() => {});
  const a4 = aluno('30004');
  ok('Tela: importa com RA, CPF e telefone numéricos e a data do Excel como DD/MM/AAAA', a4 && a4.nascimento === '15/07/2009' && a4.cpf === '04085514296' && a4.telefone === '91988887777' && a4.unidade === 'CN' && conta("SELECT COUNT(*) AS n FROM redacao_alunos WHERE ra = '30004'") === 1, JSON.stringify(a4));
  const wb2 = new E.Workbook(), ws2 = wb2.addWorksheet('ALUNOS');
  ws2.addRow(['NOME COMPLETO', 'RA', 'FILIAL']); ws2.addRow(['X', '1', 'BC']);
  await page.locator('#arquivo').setInputFiles({ name: 'errada.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await wb2.xlsx.writeBuffer()) });
  await page.locator('#previa-button').click();
  await page.waitForFunction(() => /Faltam as colunas/.test(document.querySelector('#alunos-status').textContent), null, { timeout: 15000 }).catch(() => {});
  ok('Tela: planilha sem as colunas obrigatórias é recusada com a lista do que falta', /Faltam as colunas SERIE, CODTURMA, SEGMENTO/.test(await page.locator('#alunos-status').textContent()), await page.locator('#alunos-status').textContent());
}
await page.setViewportSize({ width: 390, height: 840 });
ok('Página Alunos cabe no celular', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
ok('Sem erro JavaScript na tela', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();

for (const x of results) console.log(x[0].padEnd(7), x[1], x[2]);
const falhas = results.filter(x => x[0] !== 'OK').length;
console.log(falhas ? `${falhas} falha(s)` : `TODOS: ${results.length} verificações passaram`);
process.exit(falhas ? 1 : 0);
