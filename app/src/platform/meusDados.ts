/**
 * meusDados.ts — os ganhos e custos do entregador.
 *
 * Dado real e dele: o que recebeu em cada app, quantos km rodou, quanto gasta.
 * Guarda no aparelho e sincroniza com o servidor (`/me/*`) quando ele responde.
 * Se não responder, continua funcionando — e diz que não sincronizou, em vez
 * de fingir.
 *
 * O cálculo de margem existe nos dois lados (aqui e em `plataforma/ganhos.py`)
 * com as MESMAS fórmulas, testadas em ambos. Com servidor, manda o número
 * dele; sem servidor, calcula aqui.
 */

import { api, comFallback } from "@/lib/api";
import { custoPorKm, type Parametros } from "@/modules/margem/calculo";

export interface Lancamento {
  app: string;
  competencia: string;          // "2026-11"
  bruto: number;
  corridas: number;
  km: number;
  horas: number;
  origem?: string;
}

export interface Custos {
  consumo_km_l: number;
  preco_combustivel: number;
  custo_oleo: number;
  km_troca_oleo: number;
  custo_pneus: number;
  km_pneus: number;
  custo_revisao: number;
  km_revisao: number;
  valor_moto: number;
  vida_util_km: number;
  das_mei: number;
  parcela_moto: number;
  seguro: number;
  outros_fixos: number;
}

export const CUSTOS_VAZIOS: Custos = {
  consumo_km_l: 0, preco_combustivel: 0, custo_oleo: 0, km_troca_oleo: 0,
  custo_pneus: 0, km_pneus: 0, custo_revisao: 0, km_revisao: 0,
  valor_moto: 0, vida_util_km: 0, das_mei: 0, parcela_moto: 0, seguro: 0, outros_fixos: 0,
};

export interface Resumo {
  tem_dados: boolean;
  meses_lancados: number;
  competencias?: string[];
  bruto_total?: number;
  bruto_medio_mensal?: number;
  km_total?: number;
  corridas_total?: number;
  horas_total?: number;
  por_app?: Record<string, { bruto: number; corridas: number; km: number }>;
  por_competencia?: Array<{ competencia: string; bruto: number; km: number;
                           corridas: number; horas: number; apps: string[] }>;
  custos_informados: boolean;
  margem: null | {
    custo_por_km: { combustivel: number; manutencao: number; depreciacao: number; total: number };
    custo_variavel: number;
    custo_fixo: number;
    custo_total: number;
    liquido_total: number;
    liquido_medio_mensal: number;
    liquido_por_km: number | null;
    liquido_por_hora: number | null;
    liquido_por_corrida: number | null;
    margem: number;
    ponto_equilibrio_mensal: number;
  };
  sincronizado?: boolean;
}

const CHAVE_LANC = "bmoto.ganhos";
const CHAVE_CUSTOS = "bmoto.custos";

function lerLocal<T>(chave: string, padrao: T): T {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? (JSON.parse(bruto) as T) : padrao;
  } catch {
    return padrao;
  }
}

function gravarLocal(chave: string, valor: unknown): void {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* navegação privada: segue só em memória nesta sessão */
  }
}

export const lancamentosLocais = (): Lancamento[] => lerLocal<Lancamento[]>(CHAVE_LANC, []);
export const custosLocais = (): Custos => ({ ...CUSTOS_VAZIOS, ...lerLocal(CHAVE_CUSTOS, {}) });

export const custosInformados = (c: Custos): boolean =>
  c.consumo_km_l > 0 && c.preco_combustivel > 0;

/** Lança (ou corrige) um período. Grava local e tenta o servidor. */
export async function lancar(cpf: string, l: Lancamento): Promise<{ sincronizado: boolean }> {
  const atuais = lancamentosLocais().filter(
    (x) => !(x.app === l.app && x.competencia === l.competencia),
  );
  gravarLocal(CHAVE_LANC, [...atuais, l]);
  return { sincronizado: await tentar(() => api.post("/me/ganhos", { cpf, ...l })) };
}

export async function apagarLancamento(cpf: string, app: string, competencia: string) {
  gravarLocal(
    CHAVE_LANC,
    lancamentosLocais().filter((x) => !(x.app === app && x.competencia === competencia)),
  );
  await tentar(() => api.del(`/me/ganhos/${app}/${competencia}?cpf=${cpf}`));
}

export async function salvarCustos(cpf: string, c: Custos): Promise<{ sincronizado: boolean }> {
  gravarLocal(CHAVE_CUSTOS, c);
  return { sincronizado: await tentar(() => api.put(`/me/custos?cpf=${cpf}`, c)) };
}

async function tentar(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}

/**
 * O resumo que as telas mostram. Prefere o servidor; sem ele, calcula local
 * com as mesmas fórmulas. Nos dois casos, só sobre dado lançado.
 */
export async function resumo(cpf: string, meses = 3): Promise<Resumo> {
  const local = () => ({ ...resumoLocal(meses), sincronizado: false });
  const doServidor = await comFallback(
    () => api.get<Resumo>(`/me/resumo?cpf=${cpf}&meses=${meses}`),
    local,
  ).catch(local);
  return { ...doServidor, sincronizado: doServidor.sincronizado !== false };
}

/** Mesmo cálculo do backend, para quando ele não responde. */
export function resumoLocal(meses = 3): Resumo {
  const todos = [...lancamentosLocais()].sort((a, b) =>
    b.competencia.localeCompare(a.competencia));
  const competencias = [...new Set(todos.map((l) => l.competencia))].slice(0, meses);
  const lancs = todos.filter((l) => competencias.includes(l.competencia));
  const custos = custosLocais();
  const informados = custosInformados(custos);

  if (lancs.length === 0)
    return { tem_dados: false, meses_lancados: 0, custos_informados: informados, margem: null };

  const soma = (f: (l: Lancamento) => number) =>
    Math.round(lancs.reduce((a, l) => a + (f(l) || 0), 0) * 100) / 100;
  const bruto = soma((l) => l.bruto);
  const km = soma((l) => l.km);
  const corridas = Math.round(soma((l) => l.corridas));
  const horas = soma((l) => l.horas);
  const n = competencias.length;

  const por_app: Resumo["por_app"] = {};
  lancs.forEach((l) => {
    const d = (por_app![l.app] ??= { bruto: 0, corridas: 0, km: 0 });
    d.bruto = Math.round((d.bruto + l.bruto) * 100) / 100;
    d.corridas += l.corridas || 0;
    d.km = Math.round((d.km + (l.km || 0)) * 10) / 10;
  });

  const por_competencia = competencias.map((c) => {
    const doMes = lancs.filter((l) => l.competencia === c);
    const s = (f: (l: Lancamento) => number) =>
      Math.round(doMes.reduce((a, l) => a + (f(l) || 0), 0) * 100) / 100;
    return { competencia: c, bruto: s((l) => l.bruto), km: s((l) => l.km),
             corridas: Math.round(s((l) => l.corridas)), horas: s((l) => l.horas),
             apps: [...new Set(doMes.map((l) => l.app))] };
  });

  const base: Resumo = {
    tem_dados: true, meses_lancados: n, competencias,
    bruto_total: bruto, bruto_medio_mensal: Math.round((bruto / n) * 100) / 100,
    km_total: km, corridas_total: corridas, horas_total: horas,
    por_app, por_competencia, custos_informados: informados, margem: null,
  };

  if (!informados) return base;

  const params: Parametros = {
    consumo: custos.consumo_km_l, precoCombustivel: custos.preco_combustivel,
    custoOleo: custos.custo_oleo, kmTrocaOleo: custos.km_troca_oleo,
    custoPneus: custos.custo_pneus, kmPneus: custos.km_pneus,
    custoRevisao: custos.custo_revisao, kmRevisao: custos.km_revisao,
    valorMoto: custos.valor_moto, vidaUtilKm: custos.vida_util_km,
    dasMei: custos.das_mei, parcelaMoto: custos.parcela_moto,
    seguro: custos.seguro, outrosFixos: custos.outros_fixos,
  };
  // Mesma conta de `plataforma/ganhos.py`, passo a passo: variável pelo km
  // rodado, fixo multiplicado pelos meses lançados. Nada de rateio por dias —
  // foi aqui que as duas pontas divergiram uma vez.
  const ck = custoPorKm(params);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const fixoMensal = custos.das_mei + custos.parcela_moto + custos.seguro + custos.outros_fixos;
  const custoVariavel = r2(ck.custoPorKm * km);
  const custoFixo = r2(fixoMensal * n);
  const custoTotal = r2(custoVariavel + custoFixo);
  const liquido = r2(bruto - custoTotal);

  return {
    ...base,
    margem: {
      custo_por_km: { combustivel: ck.custoCombustivelKm, manutencao: ck.custoManutencaoKm,
                      depreciacao: ck.custoDepreciacaoKm, total: ck.custoPorKm },
      custo_variavel: custoVariavel, custo_fixo: custoFixo,
      custo_total: custoTotal, liquido_total: liquido,
      liquido_medio_mensal: r2(liquido / n),
      liquido_por_km: km > 0 ? r2(liquido / km) : null,
      liquido_por_hora: horas > 0 ? r2(liquido / horas) : null,
      liquido_por_corrida: corridas > 0 ? r2(liquido / corridas) : null,
      margem: bruto > 0 ? Math.round((liquido / bruto) * 10000) / 10000 : 0,
      ponto_equilibrio_mensal: r2(custoTotal / n),
    },
  };
}

/** Renda que a simulação de crédito usa: o líquido, quando conhecido. */
export function rendaParaCredito(r: Resumo): { valor: number; fonte: string; meses: number } {
  if (!r.tem_dados) return { valor: 0, fonte: "nenhuma", meses: 0 };
  return r.margem
    ? { valor: r.margem.liquido_medio_mensal, fonte: "líquido que você lançou",
        meses: r.meses_lancados }
    : { valor: r.bruto_medio_mensal ?? 0, fonte: "bruto que você lançou",
        meses: r.meses_lancados };
}

export function competenciaAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function competenciasRecentes(quantas = 6): string[] {
  const d = new Date();
  d.setDate(1);
  return Array.from({ length: quantas }, () => {
    const c = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    d.setMonth(d.getMonth() - 1);
    return c;
  });
}

export const rotuloCompetencia = (c: string): string => {
  const [ano, mes] = c.split("-").map(Number);
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun",
                 "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[(mes || 1) - 1]}/${String(ano).slice(2)}`;
};
