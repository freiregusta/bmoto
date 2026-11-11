/**
 * calculo.ts — custo por quilômetro e margem líquida real.
 *
 * É o módulo que ninguém mais entrega: mostrar ao entregador quanto ele
 * REALMENTE ganha, depois de combustível, óleo, pneu, manutenção,
 * depreciação, DAS da MEI e parcela da moto.
 *
 * Tudo aqui é aritmética pura e testada — sem backend, funciona offline.
 */

export interface Parametros {
  /** Consumo em km por litro. */
  consumo: number;
  precoCombustivel: number;
  /** Troca de óleo: custo e intervalo em km. */
  custoOleo: number;
  kmTrocaOleo: number;
  /** Pneus (par) e intervalo em km. */
  custoPneus: number;
  kmPneus: number;
  /** Revisão/manutenção periódica e intervalo em km. */
  custoRevisao: number;
  kmRevisao: number;
  /** Valor da moto e vida útil estimada em km, para a depreciação. */
  valorMoto: number;
  vidaUtilKm: number;
  /** Custos fixos mensais. */
  dasMei: number;
  parcelaMoto: number;
  seguro: number;
  outrosFixos: number;
}

export interface Periodo {
  /** Ganhos brutos no período. */
  bruto: number;
  km: number;
  corridas: number;
  horas: number;
  /** Quantos dias do mês o período cobre (para ratear o fixo). */
  diasNoPeriodo: number;
  diasNoMes: number;
}

export interface Resultado {
  custoPorKm: number;
  custoCombustivelKm: number;
  custoManutencaoKm: number;
  custoDepreciacaoKm: number;
  custoVariavel: number;
  custoFixoRateado: number;
  custoTotal: number;
  liquido: number;
  liquidoPorKm: number;
  liquidoPorHora: number;
  liquidoPorCorrida: number;
  margem: number;
  /** Quanto do bruto vira custo. */
  comprometimento: number;
  /** Bruto mínimo no período para não trabalhar de graça. */
  pontoEquilibrio: number;
}

export const PARAMETROS_PADRAO: Parametros = {
  consumo: 35,
  precoCombustivel: 6.19,
  custoOleo: 60,
  kmTrocaOleo: 2_000,
  custoPneus: 420,
  kmPneus: 15_000,
  custoRevisao: 220,
  kmRevisao: 5_000,
  valorMoto: 18_000,
  vidaUtilKm: 120_000,
  dasMei: 86.05,
  parcelaMoto: 0,
  seguro: 0,
  outrosFixos: 0,
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const seguro = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

export function custoPorKm(p: Parametros): Pick<Resultado,
  "custoPorKm" | "custoCombustivelKm" | "custoManutencaoKm" | "custoDepreciacaoKm"> {
  const combustivel = p.consumo > 0 ? p.precoCombustivel / p.consumo : 0;
  const oleo = p.kmTrocaOleo > 0 ? p.custoOleo / p.kmTrocaOleo : 0;
  const pneus = p.kmPneus > 0 ? p.custoPneus / p.kmPneus : 0;
  const revisao = p.kmRevisao > 0 ? p.custoRevisao / p.kmRevisao : 0;
  const manutencao = oleo + pneus + revisao;
  const depreciacao = p.vidaUtilKm > 0 ? p.valorMoto / p.vidaUtilKm : 0;
  return {
    custoCombustivelKm: r4(combustivel),
    custoManutencaoKm: r4(manutencao),
    custoDepreciacaoKm: r4(depreciacao),
    custoPorKm: r4(combustivel + manutencao + depreciacao),
  };
}

export function calcular(p: Parametros, periodo: Periodo): Resultado {
  const porKm = custoPorKm(p);
  const km = seguro(periodo.km);
  const bruto = seguro(periodo.bruto);

  const custoVariavel = r2(porKm.custoPorKm * km);
  const fixoMensal = seguro(p.dasMei) + seguro(p.parcelaMoto) + seguro(p.seguro) + seguro(p.outrosFixos);
  const proporcao = periodo.diasNoMes > 0
    ? Math.min(seguro(periodo.diasNoPeriodo) / periodo.diasNoMes, 1)
    : 1;
  const custoFixoRateado = r2(fixoMensal * proporcao);
  const custoTotal = r2(custoVariavel + custoFixoRateado);
  const liquido = r2(bruto - custoTotal);

  return {
    ...porKm,
    custoVariavel,
    custoFixoRateado,
    custoTotal,
    liquido,
    liquidoPorKm: km > 0 ? r2(liquido / km) : 0,
    liquidoPorHora: periodo.horas > 0 ? r2(liquido / periodo.horas) : 0,
    liquidoPorCorrida: periodo.corridas > 0 ? r2(liquido / periodo.corridas) : 0,
    margem: bruto > 0 ? r4(liquido / bruto) : 0,
    comprometimento: bruto > 0 ? r4(custoTotal / bruto) : 0,
    pontoEquilibrio: custoTotal,
  };
}

export type Veredito = "Prejuízo" | "No limite" | "Vale a pena";

/**
 * Avalia UMA corrida oferecida: a conta que o entregador faz em 3 segundos
 * na porta do restaurante. `folgaMinima` em R$/km é o que ele aceita ganhar
 * acima do próprio custo.
 */
export function avaliarCorrida(
  oferta: number, distanciaKm: number, custoKm: number, folgaMinima = 0.1,
): { veredito: Veredito; porKm: number; lucro: number; custo: number } {
  const dist = seguro(distanciaKm);
  const custo = r2(custoKm * dist);
  const lucro = r2(seguro(oferta) - custo);
  const porKm = dist > 0 ? r2(seguro(oferta) / dist) : 0;
  // Sem distância informada não há rodagem a pagar: a sobra é a oferta inteira.
  const sobraPorKm = dist > 0 ? lucro / dist : lucro;
  const veredito: Veredito =
    lucro <= 0 ? "Prejuízo" : sobraPorKm <= folgaMinima ? "No limite" : "Vale a pena";
  return { veredito, porKm, lucro, custo };
}
