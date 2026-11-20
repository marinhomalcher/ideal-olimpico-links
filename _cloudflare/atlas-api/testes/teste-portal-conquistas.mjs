// Portal do aluno: "Manter conectado por 5 dias" e aba "Minhas conquistas" (18/11/2026; anos do aluno e
// cadastro bloqueado em 19/11/2026), com o Worker do portal simulado. Alunos e medalhas fictícios (matrícula 99999), sem dado real.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const INS = fileURLToPath(new URL('../../../inscricoes/', import.meta.url));
const results = [];
const ok = (n, c, e = '') => results.push([c ? 'OK' : 'FALHOU', n, String(e).slice(0, 300)]);
const ORIGEM = 'https://idealolimpico.com.br';
const tipos = { html: 'text/html; charset=utf-8', js: 'application/javascript', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', json: 'application/json' };

const ALUNO = { matricula: '99999', nome: 'ALUNO TESTE', email: '99999@aluno.grupoideal.com.br', unidade: 'BATISTA CAMPOS', serie: '3ª SÉRIE', segmento: 'EM', dataNascimento: '01/01/2009', cpf: '52998224725', whatsappAluno: '(91) 99999-9999', emailPessoal: 'familia@example.com', anoAtual: 2026, contatosConfirmadosNesteAno: true };
const CHAVE = 'L99999' + 'abcdef01' + 'a'.repeat(64);
const CAT = {
  OBMEP: { s: 'OBMEP', n: 'Olimpíada Brasileira de Matemática', a: 'Matemática' },
  OBA: { s: 'OBA', n: 'Olimpíada Brasileira de Astronomia', a: 'Ciências e Tecnologia' },
  MATIFIC: { s: 'MATIFIC', n: 'Matific', a: 'Matemática' },
  OBR: { s: 'OBR', n: 'Olimpíada Brasileira de Robótica', a: 'Ciências e Tecnologia' },
  OP: { s: 'OP', n: 'Olimpíada de Português', a: 'Linguagens' },
  OBF: { s: 'OBF', n: 'Olimpíada Brasileira de Física', a: 'Física' },
  ONFIL: { s: 'ONFIL', n: 'Olimpíada Nacional de Filosofia', a: 'Outras' }
};
let CONQ = {
  // Resultados publicados de 2023 a 2025; o aluno participa desde 2024 e o ano corrente é 2026 (v61: anosAluno).
  atualizadoEm: '18/11/2026 às 21:00', anos: [2025, 2024, 2023], catalogo: CAT, anoAtual: 2026, primeiroAno: 2024, anosAluno: [2026, 2025, 2024],
  participou: { 2025: ['OBMEP', 'OBA', 'MATIFIC', 'OBR', 'OP', 'OBF', 'ONFIL'], 2024: ['OBMEP', 'OBA'], 2023: ['OBMEP'] },
  conquistas: [[2025, 'OBMEP', 'ouro', '', ''], [2025, 'MATIFIC', 'ouro', 'Ruby', ''], [2025, 'OBR', 'bronze', '', 'Regional'], [2025, 'OBR', 'mencao', '', 'Nacional'],
    [2025, 'OP', 'prata', '', ''], [2024, 'OBMEP', 'bronze', '', ''], [2024, 'OBA', 'ouro', '', ''], [2025, 'XSS', 'ouro<script>', '', '']]
};
let retomarResposta = 'ok';
const chamadas = [];

const browser = await chromium.launch();
async function contexto(viewport) {
  const ctx = await browser.newContext(viewport);
  await ctx.route(ORIGEM + '/inscricoes/**', route => {
    let f = new URL(route.request().url()).pathname.replace('/inscricoes/', '');
    if (f === '' || f.endsWith('/')) f += 'index.html';
    if (!fs.existsSync(INS + f)) return route.fulfill({ status: 404, body: 'nao encontrado' });
    return route.fulfill({ status: 200, contentType: tipos[f.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(INS + f) });
  });
  await ctx.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: 'window.QRCode=function(){}' }));
  await ctx.route('https://ideal-olimpico-producao.marinhomalcher.workers.dev/**', route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': ORIGEM, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } });
    let c = {}; try { c = JSON.parse(req.postData() || '{}'); } catch {}
    chamadas.push(c);
    const r = data => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': ORIGEM }, body: JSON.stringify({ ok: true, data }) });
    const falha = error => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': ORIGEM }, body: JSON.stringify({ ok: false, error }) });
    if (c.method === 'solicitarCodigoAluno') return r({ ok: true, email: ALUNO.email });
    if (c.method === 'autenticarAlunoCodigo') return r({ status: 'OK', sessao: 'S'.repeat(64), aluno: ALUNO });
    if (c.method === 'lembrarAcessoAluno') return r({ chave: CHAVE, ate: Date.now() + 5 * 86400e3 });
    if (c.method === 'retomarSessaoAluno') return retomarResposta === 'ok' ? r({ status: 'OK', sessao: 'R'.repeat(64), aluno: ALUNO }) : falha(retomarResposta);
    if (c.method === 'confirmarCadastroAluno') return r({ home: [] });
    if (c.method === 'listarPedidosAluno') return r({ pedidos: [] });
    if (c.method === 'meuDesempenho') return r({ ano: 2026, documentos: [] });
    if (c.method === 'minhasConquistas') return CONQ === 'SEM_FUNCAO' ? falha('Operação não permitida.') : r(CONQ);
    return r({});
  });
  await ctx.addInitScript(() => { window.__cspv = []; document.addEventListener('securitypolicyviolation', e => window.__cspv.push(e.violatedDirective + ' ' + (e.blockedURI || ''))); });
  return ctx;
}
const erros = [];
const metodos = () => chamadas.map(c => c.method);
async function loginCodigo(page, lembrar) {
  await page.fill('#matriculaInput', '99999');
  await page.click('#loginBtn');
  await page.waitForSelector('#etapaCodigo:not(.hidden)');
  if (lembrar) await page.check('#lembrarCheck');
  await page.fill('#codigoInput', '123456');
  await page.click('#codigoBtn');
  await page.waitForSelector('#cadastroSec:not(.hidden)');
}
const guardado = page => page.evaluate(() => localStorage.getItem('idealPortalAcessoLembrado'));

/* ===================== Manter conectado por 5 dias ===================== */
const ctx = await contexto({ viewport: { width: 1366, height: 900 } });
let page = await ctx.newPage();
page.on('pageerror', e => erros.push(e.message));
await page.goto(ORIGEM + '/inscricoes/');
await page.fill('#matriculaInput', '99999');
await page.click('#loginBtn');
await page.waitForSelector('#etapaCodigo:not(.hidden)');
ok('Caixinha "Manter conectado por 5 dias" aparece desmarcada', await page.evaluate(() => { const c = document.getElementById('lembrarCheck'); return !!c && !c.checked && /5 dias/.test(c.parentElement.textContent); }));
if (process.env.ATLAS_PNG_DIR) await page.screenshot({ path: process.env.ATLAS_PNG_DIR + '/portal-lembrar.png' });
await page.fill('#codigoInput', '123456');
await page.click('#codigoBtn');
await page.waitForSelector('#cadastroSec:not(.hidden)');
ok('Sem marcar: não pede chave e não guarda nada', !metodos().includes('lembrarAcessoAluno') && await guardado(page) === null);
await page.click('text=TROCAR ALUNO');
await loginCodigo(page, true);
await page.waitForFunction(() => !!localStorage.getItem('idealPortalAcessoLembrado'));
const g = JSON.parse(await guardado(page));
const pedido = chamadas.find(c => c.method === 'lembrarAcessoAluno');
ok('Marcando: pede a chave com a sessão e guarda só chave e validade', pedido && pedido.args.length === 1 && pedido.args[0] === 'S'.repeat(64) && g.chave === CHAVE && Object.keys(g).join() === 'chave,ate', JSON.stringify(g));

/* reabrir o portal: entra sozinho */
chamadas.length = 0;
await page.reload();
await page.waitForSelector('#cadastroSec:not(.hidden)');
const ret = chamadas.find(c => c.method === 'retomarSessaoAluno');
ok('Reabrindo: entra sem código, mandando só a chave', ret && ret.args.length === 1 && ret.args[0] === CHAVE && !metodos().includes('solicitarCodigoAluno'), JSON.stringify(chamadas));
ok('Reabrindo: dados travados (já confirmados), um clique para seguir', await page.evaluate(() => !document.getElementById('editarCadastroBtn').classList.contains('hidden')));
await page.click('#confirmarCadastroBtn');
await page.waitForSelector('#abasAluno:not(.hidden)');

/* sessão de 30 min venceu no meio do uso: entra de novo sozinho */
chamadas.length = 0;
await page.evaluate(() => { retomadaEm = 0; trocarAluno(); });
await page.waitForSelector('#cadastroSec:not(.hidden)');
ok('Sessão vencida com acesso lembrado: entra de novo sozinho', metodos().includes('retomarSessaoAluno'));

/* TROCAR ALUNO apaga a chave do aparelho */
await page.click('text=TROCAR ALUNO');
ok('TROCAR ALUNO apaga a chave do aparelho', await guardado(page) === null && await page.evaluate(() => !document.getElementById('matriculaSec').classList.contains('hidden')));

/* chave vencida no aparelho: ignorada e apagada */
chamadas.length = 0;
await page.evaluate(k => localStorage.setItem('idealPortalAcessoLembrado', JSON.stringify({ chave: k, ate: Date.now() - 1000 })), CHAVE);
await page.reload();
await page.waitForTimeout(400);
ok('Chave vencida no aparelho: ignorada e apagada', !metodos().includes('retomarSessaoAluno') && await guardado(page) === null);

/* servidor recusa a chave (trocada pelo ADM): apaga e pede o código */
retomarResposta = 'Seu acesso lembrado expirou. Identifique-se novamente.';
await page.evaluate(k => localStorage.setItem('idealPortalAcessoLembrado', JSON.stringify({ chave: k, ate: Date.now() + 9e6 })), CHAVE);
await page.reload();
await page.waitForFunction(() => /acesso lembrado terminou/.test(document.getElementById('matriculaMsg').textContent));
ok('Chave recusada pelo servidor: apaga e volta para a matrícula', await guardado(page) === null && await page.evaluate(() => !document.getElementById('matriculaSec').classList.contains('hidden')));

/* falha de rede: mantém a chave para tentar depois */
retomarResposta = 'A conexão falhou. Verifique o estado antes de repetir uma operação.';
await page.evaluate(k => localStorage.setItem('idealPortalAcessoLembrado', JSON.stringify({ chave: k, ate: Date.now() + 9e6 })), CHAVE);
await page.reload();
await page.waitForFunction(() => /conexão falhou/.test(document.getElementById('matriculaMsg').textContent));
ok('Falha de rede: mantém a chave', await guardado(page) !== null);
await page.evaluate(() => localStorage.clear());
retomarResposta = 'ok';
await page.close();

/* ===================== Minhas conquistas ===================== */
page = await ctx.newPage();
page.on('pageerror', e => erros.push(e.message));
await page.goto(ORIGEM + '/inscricoes/');
await loginCodigo(page, false);
await page.click('#confirmarCadastroBtn');
await page.waitForSelector('#abasAluno:not(.hidden)');
ok('Abas na ordem: Desempenho, Conquistas, Competições, Pedidos', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#abasAluno .aba')].map(b => b.textContent.trim()))) === JSON.stringify(['📈 MEU DESEMPENHO', '🏆 MINHAS CONQUISTAS', '🏅 COMPETIÇÕES OLÍMPICAS', '🛒 MEUS PEDIDOS']));
await page.click('#abaConquistas');
await page.waitForSelector('#conquistasConteudo .cq-vitrine');
let e = await page.evaluate(() => ({
  ativa: document.querySelector('#abasAluno .aba.ativa')?.id, outras: ['desempenhoSec', 'home', 'pedidosSec'].every(id => document.getElementById(id).classList.contains('hidden')),
  anos: [...document.querySelectorAll('#conquistasAnos button')].map(b => b.textContent + (b.classList.contains('ativo') ? '*' : '')),
  ano: document.querySelector('.cq-ano-grande')?.textContent, tit: document.querySelector('.cq-vit-tit b')?.textContent,
  placar: [...document.querySelectorAll('.cq-vitrine .cq-cont b')].map(b => b.textContent).join(','),
  pecas: [...document.querySelectorAll('.cq-peca')].map(p => p.className.replace('cq-peca ', '') + ':' + p.querySelector('.cq-nome').textContent + ':' + p.querySelector('.cq-tipo').textContent),
  falta: [...document.querySelectorAll('.cq-mini-item span')].map(s => s.textContent),
  nota: document.getElementById('conquistasNota').textContent, turma: document.getElementById('conquistasTurma').textContent
}));
ok('Aba Conquistas ativa e as outras seções escondidas', e.ativa === 'abaConquistas' && e.outras, JSON.stringify(e));
ok('Chips: só os anos do aluno (2026 a 2024; 2023 tem resultados mas ele não estava), abre no ano mais recente com medalha', JSON.stringify(e.anos) === JSON.stringify(['Todos os anos', '2026', '2025*', '2024']) && e.ano === '2025', JSON.stringify(e.anos));
ok('Vitrine 2025: 5 conquistas, placar 2 ouros, 1 prata, 1 bronze, 1 menção', e.tit === '5 conquistas' && e.placar === '2,1,1,1', JSON.stringify(e));
ok('Vitrine: ouro primeiro, Ruby com o nome original, fase da OBR', e.pecas[0].startsWith('ouro:') && e.pecas.some(p => p === 'ouro:Matific:Ruby') && e.pecas.some(p => p === 'bronze:Olimpíada Brasileira de RobóticaRegional:Bronze') && e.pecas.at(-1).startsWith('mencao:'), JSON.stringify(e.pecas));
ok('Tipo desconhecido vindo do servidor é descartado', !e.pecas.some(p => /script|XSS/.test(p)));
ok('Ainda por conquistar em 2025: as competições sem medalha', JSON.stringify(e.falta) === JSON.stringify(['Olimpíada Brasileira de Astronomia', 'Olimpíada Brasileira de Física', 'Olimpíada Nacional de Filosofia']), JSON.stringify(e.falta));
ok('Nota com a data da atualização e privacidade', /18\/11\/2026 às 21:00/.test(e.nota) && /Só você vê/.test(e.nota) && e.turma === '3ª SÉRIE · BATISTA CAMPOS');
ok('Medalhas desenhadas em SVG (sigla gravada)', await page.evaluate(() => document.querySelectorAll('.cq-peca svg.medalha').length === 5 && [...document.querySelectorAll('.cq-peca svg text')].some(t => t.textContent === 'OBMEP')));
if (process.env.ATLAS_PNG_DIR) await page.screenshot({ path: process.env.ATLAS_PNG_DIR + '/portal-conquistas-ano.png', fullPage: true });

await page.click('[data-acao=escolherAnoConquistas][data-arg="2024"]');
e = await page.evaluate(() => ({ ano: document.querySelector('.cq-ano-grande').textContent, n: document.querySelectorAll('.cq-peca').length, falta: document.querySelectorAll('.cq-mini-item').length }));
ok('2024: 2 medalhas e nada por conquistar', e.ano === '2024' && e.n === 2 && e.falta === 0, JSON.stringify(e));
await page.click('[data-acao=escolherAnoConquistas][data-arg="2026"]');
e = await page.evaluate(() => ({ ano: document.querySelector('.cq-ano-grande').textContent, n: document.querySelectorAll('.cq-peca').length, sem: (document.querySelector('.cq-sem') || {}).textContent || '', falta: document.querySelectorAll('.cq-mini-item').length }));
ok('2026 (ano corrente, sem resultados ainda): vitrine vazia com "ainda não há medalhas", nada por conquistar', e.ano === '2026' && e.n === 0 && /ainda não há medalhas/.test(e.sem) && e.falta === 0, JSON.stringify(e));

await page.click('[data-acao=escolherAnoConquistas][data-arg="todos"]');
await page.waitForSelector('.cq-tabela');
e = await page.evaluate(() => ({
  resumo: document.querySelector('.cq-res-txt').textContent,
  linhas: [...document.querySelectorAll('.cq-tabela tbody tr')].map(tr => [tr.querySelector('.cq-comp b').textContent, ...[...tr.querySelectorAll('.cq-td')].map(td => td.textContent.trim())]),
  total: [...document.querySelectorAll('.cq-tabela tfoot .cq-td')].map(td => td.textContent).join(','),
  area: document.querySelector('.cq-tabela tbody .cq-area-chip').className
}));
ok('Todos os anos: resumo com 7 conquistas de 2024 a 2025', /7 conquistas/.test(e.resumo) && /2024 a 2025/.test(e.resumo), e.resumo);
ok('Tabela em ordem de quadro de medalhas (ouros, depois pratas...)', JSON.stringify(e.linhas.map(l => l[0])) === JSON.stringify(['Olimpíada Brasileira de Matemática', 'Matific', 'Olimpíada Brasileira de Astronomia', 'Olimpíada de Português', 'Olimpíada Brasileira de Robótica']), JSON.stringify(e.linhas));
ok('Célula mostra quantidade e anos (e o nome Ruby)', JSON.stringify(e.linhas[0]) === JSON.stringify(['Olimpíada Brasileira de Matemática', '12025', '–', '12024', '–', '2']) && e.linhas[1][1] === '12025 Ruby', JSON.stringify(e.linhas));
ok('Linha de total', e.total === '3,1,2,1,7', e.total);
ok('Área com cor por classe (sem style="")', /ar-mat/.test(e.area));
if (process.env.ATLAS_PNG_DIR) await page.screenshot({ path: process.env.ATLAS_PNG_DIR + '/portal-conquistas-todos.png', fullPage: true });

await page.click('#abaDesempenho');
ok('Trocar para Meu desempenho esconde as conquistas', await page.evaluate(() => document.getElementById('conquistasSec').classList.contains('hidden') && !document.getElementById('desempenhoSec').classList.contains('hidden')));
await page.click('#abaConquistas');
ok('Voltar para Conquistas não pede de novo', metodos().filter(m => m === 'minhasConquistas').length === 1);
ok('Nenhuma violação de CSP', (await page.evaluate(() => window.__cspv)).length === 0, (await page.evaluate(() => window.__cspv)).join('|'));
await page.click('text=TROCAR ALUNO');
ok('Trocar aluno limpa as conquistas', await page.evaluate(() => conquistas === null && document.getElementById('conquistasSec').classList.contains('hidden')));

/* sem resultados publicados */
CONQ = { atualizadoEm: '', anos: [], catalogo: {}, participou: {}, conquistas: [] };
await loginCodigo(page, false);
await page.click('#confirmarCadastroBtn');
await page.waitForSelector('#abasAluno:not(.hidden)');
await page.click('#abaConquistas');
await page.waitForSelector('.cq-vazio');
ok('Sem resultados publicados: mensagem de "vão aparecer aqui"', await page.evaluate(() => /vão aparecer aqui/.test(document.querySelector('.cq-vazio').textContent) && document.getElementById('conquistasAnos').children.length === 0));
await page.click('text=TROCAR ALUNO');
CONQ = 'SEM_FUNCAO';
await loginCodigo(page, false);
await page.click('#confirmarCadastroBtn');
await page.waitForSelector('#abasAluno:not(.hidden)');
await page.click('#abaConquistas');
await page.waitForSelector('.cq-vazio');
ok('Servidor ainda sem a função: mostra "vão aparecer aqui", sem erro', await page.evaluate(() => /vão aparecer aqui/.test(document.querySelector('.cq-vazio').textContent) && !document.getElementById('conquistasMsg').textContent));

/* cadastro bloqueado (RA/nome divergente no histórico): recado no lugar das medalhas */
await page.click('text=TROCAR ALUNO');
CONQ = { atualizadoEm: '19/11/2026 às 17:48', anos: [2025, 2024], catalogo: CAT, anoAtual: 2026, primeiroAno: 2024, anosAluno: [2026, 2025, 2024], participou: { 2025: ['OBMEP'] },
  conquistas: [], bloqueado: true, mensagem: 'Encontramos uma divergência no seu cadastro (RA ou nome). Procure o Prof. Marinho <b>x</b>.' };
await loginCodigo(page, false);
await page.click('#confirmarCadastroBtn');
await page.waitForSelector('#abasAluno:not(.hidden)');
await page.click('#abaConquistas');
await page.waitForSelector('.cq-bloqueado');
e = await page.evaluate(() => ({ txt: document.querySelector('.cq-bloqueado').textContent, html: document.querySelector('.cq-bloqueado').innerHTML, chips: document.getElementById('conquistasAnos').children.length, pecas: document.querySelectorAll('.cq-peca, .cq-tabela').length, nota: document.getElementById('conquistasNota').textContent }));
ok('Bloqueado: recado do servidor no lugar das medalhas, sem chips de ano', /conferir o seu cadastro/.test(e.txt) && /divergência no seu cadastro/.test(e.txt) && e.chips === 0 && e.pecas === 0, JSON.stringify(e));
ok('Bloqueado: recado escapado (sem HTML do servidor) e nota de privacidade mantida', !/<b>/.test(e.html) && /&lt;b&gt;/.test(e.html) && /Só você vê/.test(e.nota), e.html.slice(-120));

/* servidor anterior à v61 (sem anosAluno): chips com todos os anos de resultados; medalha fora de anosAluno nunca some */
await page.click('text=TROCAR ALUNO');
CONQ = { atualizadoEm: '18/11/2026 às 21:00', anos: [2025, 2024], catalogo: CAT, participou: { 2025: ['OBMEP'], 2024: ['OBA'] }, conquistas: [[2024, 'OBA', 'ouro', '', '']] };
await loginCodigo(page, false);
await page.click('#confirmarCadastroBtn');
await page.waitForSelector('#abasAluno:not(.hidden)');
await page.click('#abaConquistas');
await page.waitForSelector('.cq-vitrine');
e = await page.evaluate(() => [...document.querySelectorAll('#conquistasAnos button')].map(b => b.textContent + (b.classList.contains('ativo') ? '*' : '')));
ok('Sem anosAluno (servidor antigo): chips com os anos de resultados, abre no ano da medalha', JSON.stringify(e) === JSON.stringify(['Todos os anos', '2025', '2024*']), JSON.stringify(e));
await page.click('text=TROCAR ALUNO');
CONQ = { atualizadoEm: '18/11/2026 às 21:00', anos: [2025, 2024], catalogo: CAT, anoAtual: 2026, anosAluno: [2026], participou: { 2025: ['OBMEP'], 2024: ['OBA'] }, conquistas: [[2024, 'OBA', 'ouro', '', '']] };
await loginCodigo(page, false);
await page.click('#confirmarCadastroBtn');
await page.waitForSelector('#abasAluno:not(.hidden)');
await page.click('#abaConquistas');
await page.waitForSelector('.cq-vitrine');
e = await page.evaluate(() => [...document.querySelectorAll('#conquistasAnos button')].map(b => b.textContent + (b.classList.contains('ativo') ? '*' : '')));
ok('anosAluno sem o ano da medalha (cache antigo no servidor): o ano da medalha entra mesmo assim', JSON.stringify(e) === JSON.stringify(['Todos os anos', '2026', '2024*']), JSON.stringify(e));
await page.close();
await ctx.close();

/* celular */
CONQ = {
  atualizadoEm: '18/11/2026 às 21:00', anos: [2025, 2024], catalogo: CAT, participou: { 2025: ['OBMEP', 'OBA', 'MATIFIC', 'OBR', 'OP'], 2024: ['OBMEP', 'OBA'] },
  conquistas: [[2025, 'OBMEP', 'ouro', '', ''], [2025, 'MATIFIC', 'ouro', 'Ruby', ''], [2025, 'OBR', 'bronze', '', 'Regional'], [2025, 'OP', 'prata', '', ''], [2024, 'OBA', 'ouro', '', '']]
};
const cel = await contexto({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page = await cel.newPage();
page.on('pageerror', e2 => erros.push(e2.message));
await page.goto(ORIGEM + '/inscricoes/');
await loginCodigo(page, false);
await page.click('#confirmarCadastroBtn');
await page.waitForSelector('#abasAluno:not(.hidden)');
const abas = await page.evaluate(() => { const b = [...document.querySelectorAll('#abasAluno .aba')].map(x => x.getBoundingClientRect()); return { linhas: new Set(b.map(r => Math.round(r.top))).size, colunas: new Set(b.map(r => Math.round(r.left))).size }; });
ok('Celular: 4 abas em 2 linhas de 2', abas.linhas === 2 && abas.colunas === 2, JSON.stringify(abas));
await page.click('#abaConquistas');
await page.waitForSelector('.cq-vitrine');
let larg = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
ok('Celular, vitrine: sem rolagem para o lado', larg[0] <= larg[1], larg.join('/'));
if (process.env.ATLAS_PNG_DIR) await page.screenshot({ path: process.env.ATLAS_PNG_DIR + '/portal-conquistas-celular.png', fullPage: true });
await page.click('[data-acao=escolherAnoConquistas][data-arg="todos"]');
await page.waitForSelector('.cq-tabela');
larg = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
ok('Celular, tabela: sem rolagem para o lado', larg[0] <= larg[1], larg.join('/'));
if (process.env.ATLAS_PNG_DIR) await page.screenshot({ path: process.env.ATLAS_PNG_DIR + '/portal-conquistas-celular-todos.png', fullPage: true });
await cel.close();

await browser.close();
ok('Sem erro de JavaScript', erros.length === 0, erros.join('|'));
for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK').length;
console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`);
process.exit(bad ? 1 : 0);
