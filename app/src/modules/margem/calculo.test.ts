import { describe, expect, it } from "vitest";
import { PARAMETROS_PADRAO, avaliarCorrida, calcular, custoPorKm, type Periodo }
  from "./calculo";

const MES: Periodo = { bruto: 4030, km: 1900, corridas: 186, horas: 124,
                       diasNoPeriodo: 30, diasNoMes: 30 };

describe("custo por km", () => {
  it("soma combustível, manutenção e depreciação", () => {
    const c = custoPorKm(PARAMETROS_PADRAO);
    // 6,19/35 = 0,1769 de combustível
    expect(c.custoCombustivelKm).toBeCloseTo(0.1769, 3);
    // óleo 60/2000 + pneu 420/15000 + revisão 220/5000 = 0,03 + 0,028 + 0,044
    expect(c.custoManutencaoKm).toBeCloseTo(0.102, 3);
    // 18.000/120.000 = 0,15
    expect(c.custoDepreciacaoKm).toBeCloseTo(0.15, 3);
    expect(c.custoPorKm).toBeCloseTo(0.4289, 3);
  });

  it("não explode com parâmetros zerados", () => {
    const c = custoPorKm({ ...PARAMETROS_PADRAO, consumo: 0, kmTrocaOleo: 0, kmPneus: 0,
                           kmRevisao: 0, vidaUtilKm: 0 });
    expect(c.custoPorKm).toBe(0);
  });
});

describe("margem líquida real", () => {
  it("desconta variável e fixo e devolve o líquido", () => {
    const r = calcular(PARAMETROS_PADRAO, MES);
    expect(r.custoVariavel).toBeCloseTo(814.9, 0);       // 0,4289 × 1900
    expect(r.custoFixoRateado).toBeCloseTo(86.05, 2);    // só o DAS no padrão
    expect(r.liquido).toBeCloseTo(4030 - r.custoTotal, 2);
    expect(r.margem).toBeGreaterThan(0.7);
    expect(r.liquidoPorHora).toBeCloseTo(r.liquido / 124, 1);
  });

  it("rateia o fixo quando o período é menor que o mês", () => {
    const semana = { ...MES, bruto: 930, km: 440, corridas: 43, horas: 29,
                     diasNoPeriodo: 7, diasNoMes: 30 };
    const r = calcular({ ...PARAMETROS_PADRAO, parcelaMoto: 489.9 }, semana);
    const fixoMensal = 86.05 + 489.9;
    expect(r.custoFixoRateado).toBeCloseTo((fixoMensal * 7) / 30, 1);
  });

  it("acusa prejuízo quando os custos passam do bruto", () => {
    const r = calcular({ ...PARAMETROS_PADRAO, parcelaMoto: 489.9, seguro: 89 },
                       { ...MES, bruto: 900, km: 1900 });
    expect(r.liquido).toBeLessThan(0);
    expect(r.margem).toBeLessThan(0);
    expect(r.pontoEquilibrio).toBeGreaterThan(900);
  });

  it("não divide por zero quando não houve rodagem", () => {
    const r = calcular(PARAMETROS_PADRAO, { bruto: 0, km: 0, corridas: 0, horas: 0,
                                            diasNoPeriodo: 1, diasNoMes: 30 });
    expect(r.liquidoPorKm).toBe(0);
    expect(r.liquidoPorHora).toBe(0);
    expect(r.liquidoPorCorrida).toBe(0);
    expect(r.margem).toBe(0);
  });
});

describe("vale a pena aceitar a corrida", () => {
  const custoKm = custoPorKm(PARAMETROS_PADRAO).custoPorKm;   // ≈ 0,4289

  it("aprova oferta folgada", () => {
    const r = avaliarCorrida(12.5, 7, custoKm);
    expect(r.veredito).toBe("Vale a pena");
    expect(r.lucro).toBeCloseTo(12.5 - custoKm * 7, 1);
    expect(r.porKm).toBeCloseTo(1.79, 1);
  });

  it("marca prejuízo quando a oferta não cobre o custo", () => {
    expect(avaliarCorrida(4, 12, custoKm).veredito).toBe("Prejuízo");
  });

  it("marca 'no limite' quando a sobra por km é pequena", () => {
    // custo 0,4289/km: oferta de 0,50/km sobra ~0,07/km, abaixo da folga de 0,10
    expect(avaliarCorrida(5, 10, custoKm).veredito).toBe("No limite");
  });

  it("trata distância zero sem quebrar", () => {
    const r = avaliarCorrida(10, 0, custoKm);
    expect(r.porKm).toBe(0);
    expect(r.veredito).toBe("Vale a pena");
  });
});
