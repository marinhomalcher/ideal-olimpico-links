// Calendário de dias não úteis e prazos em dias úteis (Belém do Pará, UTC-3 o ano todo, sem horário de verão).
// O calendário é da escola (empresa privada): vale o que o ADM marcar em "dias_nao_uteis". A tela só liga e desliga dias;
// "Carregar ano" cria os dias padrão pelas regras decididas pelo Marinho em 27/11/2026 (ver FERIADOS_BELEM.md).

const DIA_MS = 86400000;
const BELEM_MS = 3 * 3600000;

/* "AAAA-MM-DD" -> Date UTC à meia-noite */
const data = iso => new Date(iso + 'T00:00:00Z');
const iso = d => d.toISOString().slice(0, 10);
const somar = (d, n) => new Date(d.getTime() + n * DIA_MS);

/* Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return data(ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0'));
}

/* Círio de Nazaré: segundo domingo de outubro. */
export function cirio(ano) {
  const primeiro = data(ano + '-10-01');
  const ate = (7 - primeiro.getUTCDay()) % 7;     // dias até o primeiro domingo
  return somar(primeiro, ate + 7);
}

/* Dias padrão de um ano: [{ data, motivo, ativo }]. ativo = 1 conta como NÃO útil; ativo = 0 é ponto facultativo que conta como útil. */
export function calendarioPadrao(ano) {
  const p = pascoa(ano), c = cirio(ano);
  const lista = [
    [ano + '-01-01', 'Confraternização Universal', 1],
    [ano + '-01-02', 'Ponto facultativo depois do Ano Novo', 1],
    [ano + '-01-12', 'Aniversário de Belém', 1],
    [iso(somar(p, -48)), 'Carnaval (segunda-feira)', 1],
    [iso(somar(p, -47)), 'Carnaval (terça-feira)', 1],
    [iso(somar(p, -46)), 'Quarta-feira de Cinzas', 1],
    [iso(somar(p, -3)), 'Quinta-feira Santa', 0],
    [iso(somar(p, -2)), 'Sexta-feira Santa', 1],
    [ano + '-04-21', 'Tiradentes', 1],
    [ano + '-05-01', 'Dia do Trabalho', 1],
    [iso(somar(p, 60)), 'Corpus Christi', 0],
    [iso(somar(p, 61)), 'Emenda do Corpus Christi', 0],
    [ano + '-08-15', 'Adesão do Grão-Pará à Independência', 1],
    [ano + '-09-07', 'Independência do Brasil', 1],
    [ano + '-10-12', 'Nossa Senhora Aparecida', 1],
    [iso(somar(c, 1)), 'Segunda-feira depois do Círio', 1],
    [iso(somar(c, 15)), 'Recírio', 1],
    [ano + '-10-28', 'Dia do Servidor Público', 0],
    [ano + '-11-02', 'Finados', 1],
    [ano + '-11-15', 'Proclamação da República', 1],
    [ano + '-11-20', 'Consciência Negra', 1],
    [ano + '-12-25', 'Natal', 1]
  ];
  /* Datas repetidas (ex.: pós-Círio caindo em 12/10): fica uma só, com os dois motivos. */
  const porData = new Map();
  for (const [d, motivo, ativo] of lista) {
    if (porData.has(d)) { const x = porData.get(d); x.motivo += ' e ' + motivo.charAt(0).toLowerCase() + motivo.slice(1); x.ativo = Math.max(x.ativo, ativo); }
    else porData.set(d, { data: d, motivo, ativo });
  }
  return [...porData.values()].sort((a, b) => a.data.localeCompare(b.data));
}

/* Conjunto de datas "AAAA-MM-DD" marcadas como não úteis (ativo = 1) no banco. */
export async function diasNaoUteis(env) {
  const { results } = await env.DB.prepare('SELECT data FROM dias_nao_uteis WHERE ativo = 1').all();
  return new Set(results.map(r => r.data));
}

export function ehDiaUtil(dataIso, naoUteis) {
  const dow = data(dataIso).getUTCDay();
  return dow !== 0 && dow !== 6 && !naoUteis.has(dataIso);
}

/* Prazo: o mesmo horário, depois de n dias úteis. Entra e sai como instante UTC ("AAAA-MM-DDTHH:MM:SSZ");
   a data é conferida pelo calendário de Belém. */
export function prazoEmDiasUteis(instanteUtc, n, naoUteis) {
  const inicio = new Date(instanteUtc);
  if (Number.isNaN(inicio.getTime())) throw new Error('Instante inválido.');
  let local = new Date(inicio.getTime() - BELEM_MS);   // relógio de Belém
  let faltam = n;
  while (faltam > 0) {
    local = somar(local, 1);
    if (ehDiaUtil(iso(local), naoUteis)) faltam--;
  }
  return new Date(local.getTime() + BELEM_MS).toISOString().replace('.000Z', 'Z');
}

/* Quantos dias úteis ainda faltam, de hoje (data "AAAA-MM-DD" de Belém, excluída) até a data de Belém do prazo (incluída).
   Prazo já na data de hoje ou passada devolve 0. */
export function diasUteisAte(hojeIso, prazoInstanteUtc, naoUteis) {
  const fim = iso(new Date(new Date(prazoInstanteUtc).getTime() - BELEM_MS));
  if (fim <= hojeIso) return 0;
  let d = data(hojeIso), n = 0;
  while (iso(d) < fim) { d = somar(d, 1); if (ehDiaUtil(iso(d), naoUteis)) n++; }
  return n;
}
