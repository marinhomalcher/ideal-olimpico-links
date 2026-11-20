// "Certificados" do portal (20/11/2026): a atlas-api lista CERTIFICADOS/<ano>/<RA>/ no SharePoint e devolve
// links temporários só dos PDFs do próprio aluno. Microsoft falsa; dados fictícios.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const worker = (await import(new URL('../worker.js?' + Date.now(), import.meta.url).href)).default;
const results = [];
const ok = (name, cond, extra = '') => results.push([cond ? 'OK  ' : 'FALHOU', name, String(extra).slice(0, 300)]);

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(fs.readFileSync(REPO + '_cloudflare/atlas-api/schema.sql', 'utf8'));
function stmt(q, args = []) {
  return {
    bind: (...a) => stmt(q, a),
    run: async () => { const r = db.prepare(q).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    first: async () => db.prepare(q).get(...args) ?? null,
    all: async () => ({ results: db.prepare(q).all(...args) })
  };
}
const SEGREDO = 'segredo-do-portal-com-mais-de-32-caracteres';
const env = {
  ATLAS_HOJE_TESTE: '2026-11-20', DB: { prepare: q => stmt(q), batch: async l => { for (const s of l) await s.run(); } },
  ADMIN_EMAIL: 'adm@example.com', MS_TENANT_ID: 'tenant-teste', MS_CLIENT_ID: 'cliente-teste', MS_CLIENT_SECRET: 'segredo-ms-teste',
  SHAREPOINT_SITE: 'site-teste', PORTAL_ATLAS_SECRET: SEGREDO
};

/* SharePoint falso: pastas e arquivos de CERTIFICADOS */
const arvore = {
  'CERTIFICADOS': [{ name: '2025', folder: {} }, { name: '2024', folder: {} }, { name: '_PENDENTES', folder: {} }, { name: 'RELATORIO_CERTIFICADOS.txt', file: {}, size: 10 }],
  'CERTIFICADOS/2025/20000': [
    { name: 'OBMEP - PARTICIPACAO.pdf', file: {}, size: 181000, '@microsoft.graph.downloadUrl': 'https://download.test/2025/20000/obmep.pdf' },
    { name: 'CANGURU.pdf', file: {}, size: 90000, '@microsoft.graph.downloadUrl': 'https://download.test/2025/20000/canguru.pdf' },
    { name: 'foto.png', file: {}, size: 5, '@microsoft.graph.downloadUrl': 'https://download.test/x.png' },
    { name: 'sub', folder: {} }
  ],
  'CERTIFICADOS/2024/20000': [{ name: 'OBR - OURO.pdf', file: {}, size: 70000 }],
  'CERTIFICADOS/2025/20001': [{ name: 'OBMEP.pdf', file: {}, size: 1, '@microsoft.graph.downloadUrl': 'https://download.test/2025/20001/obmep.pdf' }]
};
const pedidos = [];
let quebrar = false;
const G = 'https://graph.microsoft.com/v1.0/sites/site-teste/drive/root:/';
globalThis.fetch = async (url, op = {}) => {
  const u = String(url); pedidos.push(u);
  if (u.startsWith('https://login.microsoftonline.com/')) return new Response(JSON.stringify({ access_token: 'tk', expires_in: 3599 }));
  if (!u.startsWith(G)) throw new Error('fetch inesperado: ' + u);
  if (quebrar) return new Response('{}', { status: 503 });
  const m = /^(.*):\/children\?\$top=200$/.exec(decodeURIComponent(u.slice(G.length)));
  if (!m) return new Response('{}', { status: 400 });
  const itens = arvore[m[1]];
  return itens ? new Response(JSON.stringify({ value: itens })) : new Response('{}', { status: 404 });
};
async function portal(body, { segredo = SEGREDO, origin } = {}) {
  const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + segredo, ...(origin ? { Origin: origin } : {}) };
  const r = await worker.fetch(new Request('https://atlas-api.test/api/portal/certificados', { method: 'POST', headers: h, body: JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: r.status, data: await r.json() };
}

let r = await portal({ ra: '20000' });
ok('Lista os PDFs do aluno, do ano mais novo ao mais antigo, com link e tamanho', r.status === 200 && r.data.certificados.length === 3 &&
  r.data.certificados.map(c => c.ano + ':' + c.nome).join('|') === '2025:CANGURU|2025:OBMEP - PARTICIPACAO|2024:OBR - OURO' &&
  r.data.certificados[1].url === 'https://download.test/2025/20000/obmep.pdf' && r.data.certificados[1].tamanho === 181000, JSON.stringify(r.data));
ok('Só anos (pastas AAAA) contam; _PENDENTES e arquivos soltos não', JSON.stringify(r.data.anos) === '[2025,2024]');
ok('Arquivo que não é PDF e subpasta ficam de fora; sem link temporário vem url null', !r.data.certificados.some(c => /foto|sub/.test(c.nome)) && r.data.certificados[2].url === null);
ok('Pede só a pasta do RA em cada ano (nada de listar todos os alunos)', pedidos.filter(p => p.includes('children')).length === 3 && !pedidos.some(p => p.includes('20001')), pedidos.join(' '));
r = await portal({ ra: '20001' });
ok('Outro aluno vê só os dele', r.status === 200 && r.data.certificados.length === 1 && r.data.certificados[0].nome === 'OBMEP');
r = await portal({ ra: '30000' });
ok('Aluno sem pasta: lista vazia, sem erro', r.status === 200 && r.data.certificados.length === 0);
r = await portal({ ra: '20000' }, { segredo: 'errado' });
ok('Segredo errado é recusado', r.status === 401);
r = await portal({ ra: '20000' }, { origin: 'https://idealolimpico.com.br' });
ok('Chamada vinda de navegador (com Origin) é recusada', r.status === 403);
r = await portal({ ra: '1 OR 1=1' });
ok('RA inválido é recusado', r.status === 400);
r = await portal({ ra: '../2025' });
ok('RA com caminho é recusado', r.status === 400);
quebrar = true;
r = await portal({ ra: '20000' });
ok('SharePoint fora do ar: erro 502 com mensagem para tentar de novo', r.status === 502 && /Tente de novo/.test(r.data.error), JSON.stringify(r.data));
quebrar = false;
const semSite = { ...env, SHAREPOINT_SITE: '' };
r = await (async () => { const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SEGREDO }; const x = await worker.fetch(new Request('https://atlas-api.test/api/portal/certificados', { method: 'POST', headers: h, body: JSON.stringify({ ra: '20000' }) }), semSite, { waitUntil() {} }); return { status: x.status }; })();
ok('Sem SharePoint configurado: 503', r.status === 503);

for (const x of results) console.log(x.join(' | '));
const bad = results.filter(x => x[0] !== 'OK  ').length;
console.log(bad ? `\n${bad} FALHA(S)` : `\nTODOS OS TESTES PASSARAM (${results.length})`);
process.exit(bad ? 1 : 0);
