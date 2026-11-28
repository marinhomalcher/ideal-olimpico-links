// Rotas do ADM para o calendário de dias não úteis (prazos de 3 dias úteis da avaliação das provas).
// GET  /api/adm/calendario?ano=2026            lista os dias do ano
// POST /api/adm/calendario                     { data, motivo, ativo }  cria ou altera um dia
// PUT  /api/adm/calendario/AAAA-MM-DD          { ativo, motivo? }       liga ou desliga
// DELETE /api/adm/calendario/AAAA-MM-DD                                 apaga um dia
// POST /api/adm/calendario/carregar            { ano }                  cria os dias padrão do ano (não mexe nos que já existem)
import { calendarioPadrao } from './diasuteis.js';
import { RedacaoError } from './redacao-cadastros.js';

const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

function dataValida(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(texto + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto && d.getUTCFullYear() >= 2026 && d.getUTCFullYear() <= 2100;
}
const motivoLimpo = (m) => String(m ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
const diaSemana = (data) => SEMANA[new Date(data + 'T00:00:00Z').getUTCDay()];
const publico = (r) => ({ data: r.data, motivo: r.motivo, ativo: r.ativo === 1, dia_semana: diaSemana(r.data), fim_de_semana: [0, 6].includes(new Date(r.data + 'T00:00:00Z').getUTCDay()) });

export async function rotaCalendarioAdm(request, env, path, url, h) {
  if (!path.startsWith('/api/adm/calendario')) return null;
  const erro = (status, mensagem) => { throw new RedacaoError(status, mensagem); };

  if (path === '/api/adm/calendario' && request.method === 'GET') {
    const ano = Number(url.searchParams.get('ano')) || Number(h.hojeSP().slice(0, 4));
    if (!Number.isInteger(ano) || ano < 2026 || ano > 2100) erro(400, 'Ano inválido.');
    const { results } = await env.DB.prepare('SELECT data, motivo, ativo FROM dias_nao_uteis WHERE data >= ? AND data <= ? ORDER BY data')
      .bind(ano + '-01-01', ano + '-12-31').all();
    return { ok: true, ano, dias: results.map(publico) };
  }

  if (path === '/api/adm/calendario' && request.method === 'POST') {
    const b = await h.readJson(request);
    if (!dataValida(b?.data)) erro(400, 'Data inválida (use AAAA-MM-DD, de 2026 em diante).');
    const motivo = motivoLimpo(b.motivo);
    if (!motivo) erro(400, 'Escreva o motivo.');
    const ativo = b.ativo === false || b.ativo === 0 ? 0 : 1;
    await env.DB.prepare('INSERT INTO dias_nao_uteis (data, motivo, ativo) VALUES (?, ?, ?) ON CONFLICT(data) DO UPDATE SET motivo = excluded.motivo, ativo = excluded.ativo')
      .bind(b.data, motivo, ativo).run();
    await h.registrar(env, 'calendario_dia_salvo', { adm: h.sessao.email, data: b.data, motivo, ativo });
    return { ok: true, dia: publico({ data: b.data, motivo, ativo }) };
  }

  if (path === '/api/adm/calendario/carregar' && request.method === 'POST') {
    const b = await h.readJson(request);
    const ano = Number(b?.ano);
    if (!Number.isInteger(ano) || ano < 2026 || ano > 2100) erro(400, 'Ano inválido.');
    const dias = calendarioPadrao(ano);
    const existentes = new Set((await env.DB.prepare('SELECT data FROM dias_nao_uteis WHERE data >= ? AND data <= ?').bind(ano + '-01-01', ano + '-12-31').all()).results.map(r => r.data));
    const novos = dias.filter(d => !existentes.has(d.data));
    if (novos.length) await env.DB.batch(novos.map(d => env.DB.prepare('INSERT INTO dias_nao_uteis (data, motivo, ativo) VALUES (?, ?, ?)').bind(d.data, d.motivo, d.ativo)));
    await h.registrar(env, 'calendario_ano_carregado', { adm: h.sessao.email, ano, novos: novos.length });
    return { ok: true, ano, novos: novos.length };
  }

  const m = path.match(/^\/api\/adm\/calendario\/(\d{4}-\d{2}-\d{2})$/);
  if (!m || !dataValida(m[1])) erro(404, 'Rota indisponível.');
  const atual = await env.DB.prepare('SELECT data, motivo, ativo FROM dias_nao_uteis WHERE data = ?').bind(m[1]).first();
  if (!atual) erro(404, 'Este dia não está no calendário.');

  if (request.method === 'PUT') {
    const b = await h.readJson(request);
    const ativo = b?.ativo === undefined ? atual.ativo : (b.ativo ? 1 : 0);
    const motivo = b?.motivo === undefined ? atual.motivo : motivoLimpo(b.motivo);
    if (!motivo) erro(400, 'Escreva o motivo.');
    await env.DB.prepare('UPDATE dias_nao_uteis SET motivo = ?, ativo = ? WHERE data = ?').bind(motivo, ativo, m[1]).run();
    await h.registrar(env, 'calendario_dia_salvo', { adm: h.sessao.email, data: m[1], motivo, ativo });
    return { ok: true, dia: publico({ data: m[1], motivo, ativo }) };
  }
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM dias_nao_uteis WHERE data = ?').bind(m[1]).run();
    await h.registrar(env, 'calendario_dia_apagado', { adm: h.sessao.email, data: m[1] });
    return { ok: true };
  }
  erro(405, 'Método não permitido.');
}
