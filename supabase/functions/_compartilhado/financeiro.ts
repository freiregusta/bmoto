/**
 * financeiro.ts — a conta da renda e da margem, em um único lugar.
 *
 * Porte fiel de plataforma/ganhos.py. A conta vive no servidor, e não nas duas
 * pontas, porque app e servidor calculando o mesmo número por caminhos
 * diferentes foi exatamente o que já divergiu uma vez: o app rateava o custo
 * fixo por dia, o servidor multiplicava pelos meses lançados.
 *
 * Regra do custo fixo, para não repetir o erro: custo fixo mensal × número de
 * meses lançados. Não se rateia por dia.
 */

export interface Lancamento {
  app: string;
  competencia: string;
  bruto: number;
  corridas?: number;
  km?: number;
  horas?: number;
  origem?: string;
}

export interface Custos {
  consumo_km_l?: number; preco_combustivel?: number;
  custo_oleo?: number; km_troca_oleo?: number;
  custo_pneus?: number; km_pneus?: number;
  custo_revisao?: number; km_revisao?: number;
  valor_moto?: number; vida_util_km?: number;
  das_mei?: number; parcela_moto?: number; seguro?: number; outros_fixos?: number;
}

// Valores públicos, não inventados.
export const DAS_MEI_2026 = 86.05;                      // INSS 5% do mínimo + ISS R$ 5
export const LIMITE_MEI: Record<number, number> = {       // LC 238/2026
  2026: 81_000, 2027: 110_000, 2028: 140_000,
};
export const limiteMei = (ano = new Date().getFullYear()) =>
  LIMITE_MEI[ano] ?? LIMITE_MEI[Math.max(...Object.keys(LIMITE_MEI).map(Number))];

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Sem consumo e preço do combustível não dá para calcular custo por km. */
export const custosInformados = (c: Custos | null) =>
  !!c && n(c.consumo_km_l) > 0 && n(c.preco_combustivel) > 0;

export function custoPorKm(c: Custos) {
  const div = (a: unknown, b: unknown) => (n(b) > 0 ? n(a) / n(b) : 0);
  const combustivel = div(c.preco_combustivel, c.consumo_km_l);
  const manutencao = div(c.custo_oleo, c.km_troca_oleo)
                   + div(c.custo_pneus, c.km_pneus)
                   + div(c.custo_revisao, c.km_revisao);
  const depreciacao = div(c.valor_moto, c.vida_util_km);
  return {
    combustivel: r4(combustivel),
    manutencao: r4(manutencao),
    depreciacao: r4(depreciacao),
    total: r4(combustivel + manutencao + depreciacao),
  };
}

export const fixoMensal = (c: Custos) =>
  r2(n(c.das_mei) + n(c.parcela_moto) + n(c.seguro) + n(c.outros_fixos));

export function resumo(todos: Lancamento[], custos: Custos | null, meses = 3) {
  const informados = custosInformados(custos);

  // "Últimos 3 meses" = os 3 meses com lançamento, não os 3 do calendário:
  // quem ficou um mês parado não deve aparecer com renda menor por isso.
  const todasComp = [...new Set(todos.map((l) => l.competencia))].sort().reverse();
  const competencias = meses ? todasComp.slice(0, meses) : todasComp;
  const lancs = todos.filter((l) => competencias.includes(l.competencia));

  if (!lancs.length)
    return {
      tem_dados: false, meses_lancados: 0,
      motivo: "nenhum ganho lançado ainda",
      custos_informados: informados,
      limite_mei_ano: limiteMei(),
    };

  const soma = (f: (l: Lancamento) => number) => lancs.reduce((a, l) => a + f(l), 0);
  const bruto = r2(soma((l) => n(l.bruto)));
  const km = r1(soma((l) => n(l.km)));
  const corridas = soma((l) => n(l.corridas));
  const horas = r1(soma((l) => n(l.horas)));
  const qtd = competencias.length;

  const por_app: Record<string, { bruto: number; corridas: number; km: number }> = {};
  for (const l of lancs) {
    const d = (por_app[l.app] ??= { bruto: 0, corridas: 0, km: 0 });
    d.bruto = r2(d.bruto + n(l.bruto));
    d.corridas += n(l.corridas);
    d.km = r1(d.km + n(l.km));
  }

  const por_competencia = competencias.map((c) => {
    const mes = lancs.filter((l) => l.competencia === c);
    const s = (f: (l: Lancamento) => number) => mes.reduce((a, l) => a + f(l), 0);
    return {
      competencia: c,
      bruto: r2(s((l) => n(l.bruto))), km: r1(s((l) => n(l.km))),
      corridas: s((l) => n(l.corridas)), horas: r1(s((l) => n(l.horas))),
      apps: [...new Set(mes.map((l) => l.app))].sort(),
    };
  });

  const base = {
    tem_dados: true, meses_lancados: qtd, competencias,
    bruto_total: bruto, bruto_medio_mensal: r2(bruto / qtd),
    km_total: km, corridas_total: corridas, horas_total: horas,
    por_app, por_competencia,
    custos_informados: informados,
    limite_mei_ano: limiteMei(),
  };

  if (!informados) return { ...base, margem: null };

  const ck = custoPorKm(custos!);
  const custo_variavel = r2(ck.total * km);
  const custo_fixo = r2(fixoMensal(custos!) * qtd);   // mensal × meses, nunca por dia
  const custo_total = r2(custo_variavel + custo_fixo);
  const liquido = r2(bruto - custo_total);

  return {
    ...base,
    margem: {
      custo_por_km: ck, custo_variavel, custo_fixo, custo_total,
      liquido_total: liquido,
      liquido_medio_mensal: r2(liquido / qtd),
      liquido_por_km: km > 0 ? r2(liquido / km) : null,
      liquido_por_hora: horas > 0 ? r2(liquido / horas) : null,
      liquido_por_corrida: corridas > 0 ? r2(liquido / corridas) : null,
      margem: bruto > 0 ? r4(liquido / bruto) : 0,
      ponto_equilibrio_mensal: r2(custo_total / qtd),
    },
  };
}

/**
 * A renda que a política de crédito usa. Conservador de propósito: quando os
 * custos são conhecidos, vale o líquido — emprestar sobre o bruto de quem
 * gasta 40% rodando é vender uma parcela que não cabe.
 */
export function rendaParaCredito(todos: Lancamento[], custos: Custos | null, meses = 3) {
  const r = resumo(todos, custos, meses) as any;
  if (!r.tem_dados) return { renda_media: 0, meses_renda: 0, fonte: "nenhuma" };
  const base = r.margem ? r.margem.liquido_medio_mensal : r.bruto_medio_mensal;
  return {
    renda_media: Math.max(base, 0),
    meses_renda: r.meses_lancados,
    fonte: r.margem ? "liquido_declarado" : "bruto_declarado",
    bruto_medio_mensal: r.bruto_medio_mensal,
  };
}
