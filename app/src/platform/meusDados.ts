/**
 * meusDados.ts — os ganhos e custos do entregador.
 *
 * Dado real e dele: o que recebeu em cada app, quantos km rodou, quanto gasta.
 * A verdade fica no banco (Supabase, com RLS — ninguém alcança a linha de
 * outro), e o aparelho guarda uma cópia para o app abrir e funcionar sem
 * sinal. Quando não dá para gravar no servidor, a tela diz que ficou só no
 * aparelho, em vez de fingir que subiu.
 *
 * A conta da margem é feita **no servidor** (edge function `resumo`). O
 * cálculo local existe apenas como espelho para o modo sem conexão, e já
 * divergiu uma vez: o app rateava o custo fixo por dia, o servidor
 * multiplicava pelos meses lançados. O servidor está certo, e é dele o número
 * sempre que ele responde.
 */

import { comFallback, configurado, funcao, SemBackend, supabase, usuarioId }
  from "@/lib/supabase";
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
  limite_mei_ano?: number;
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

const CAMPOS_GANHO = "app, competencia, bruto, corridas, km, horas, origem";

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

const numero = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Normaliza o que vem do Postgres (numeric pode chegar como texto). */
const doBanco = (l: any): Lancamento => ({
  app: String(l.app), competencia: String(l.competencia),
  bruto: numero(l.bruto), corridas: numero(l.corridas),
  km: numero(l.km), horas: numero(l.horas), origem: l.origem ?? undefined,
});

/**
 * O que a pessoa já lançou. Busca no servidor e espelha no aparelho; sem
 * servidor, devolve a cópia local e avisa que não sincronizou.
 */
export async function lancamentos(): Promise<{ itens: Lancamento[]; sincronizado: boolean }> {
  const local = () => ({
    itens: [...lancamentosLocais()].sort((a, b) => b.competencia.localeCompare(a.competencia)),
    sincronizado: false,
  });
  if (!configurado || !(await usuarioId())) return local();

  const { data, error } = await supabase
    .from("ganhos").select(CAMPOS_GANHO)
    .order("competencia", { ascending: false }).order("app");
  if (error || !data) return local();

  const itens = data.map(doBanco);
  gravarLocal(CHAVE_LANC, itens);
  return { itens, sincronizado: true };
}

/** Lança (ou corrige) um período. Relançar o mesmo app e mês substitui. */
export async function lancar(l: Lancamento): Promise<{ sincronizado: boolean }> {
  const atuais = lancamentosLocais().filter(
    (x) => !(x.app === l.app && x.competencia === l.competencia),
  );
  gravarLocal(CHAVE_LANC, [...atuais, l]);

  const u = await usuarioId();
  if (!u) return { sincronizado: false };
  const { error } = await supabase.from("ganhos").upsert({
    user_id: u, app: l.app, competencia: l.competencia,
    bruto: l.bruto, corridas: l.corridas || 0, km: l.km || 0, horas: l.horas || 0,
    origem: l.origem ?? "declarado",
  }, { onConflict: "user_id,app,competencia" });
  return { sincronizado: !error };
}

export async function apagarLancamento(app: string, competencia: string): Promise<void> {
  gravarLocal(
    CHAVE_LANC,
    lancamentosLocais().filter((x) => !(x.app === app && x.competencia === competencia)),
  );
  const u = await usuarioId();
  if (!u) return;
  await supabase.from("ganhos").delete()
    .eq("user_id", u).eq("app", app).eq("competencia", competencia);
}

/** Os custos guardados. Servidor primeiro; sem ele, a cópia do aparelho. */
export async function custos(): Promise<{ valores: Custos; sincronizado: boolean }> {
  if (!configurado || !(await usuarioId()))
    return { valores: custosLocais(), sincronizado: false };
  const { data, error } = await supabase.from("custos").select("*").maybeSingle();
  if (error) return { valores: custosLocais(), sincronizado: false };
  if (!data) return { valores: custosLocais(), sincronizado: true };

  const valores = { ...CUSTOS_VAZIOS } as Custos;
  for (const chave of Object.keys(CUSTOS_VAZIOS) as Array<keyof Custos>)
    valores[chave] = numero((data as any)[chave]);
  gravarLocal(CHAVE_CUSTOS, valores);
  return { valores, sincronizado: true };
}

export async function salvarCustos(c: Custos): Promise<{ sincronizado: boolean }> {
  gravarLocal(CHAVE_CUSTOS, c);
  const u = await usuarioId();
  if (!u) return { sincronizado: false };
  const { error } = await supabase.from("custos")
    .upsert({ user_id: u, ...c }, { onConflict: "user_id" });
  return { sincronizado: !error };
}

/** Registra interesse num produto que ainda não existe. Lista de espera real. */
export async function registrarInteresse(produto: string, observacao = ""):
  Promise<{ ok: boolean }> {
  const u = await usuarioId();
  if (!u) return { ok: false };
  const { error } = await supabase.from("interesses")
    .upsert({ user_id: u, produto, observacao }, { onConflict: "user_id,produto" });
  return { ok: !error };
}

/**
 * O resumo que as telas mostram: renda, custos e margem. A conta é do
 * servidor; sem servidor, o espelho local — e aí `sincronizado` é falso para
 * a tela poder dizer isso.
 */
export async function resumo(meses = 3): Promise<Resumo> {
  const local = () => ({ ...resumoLocal(meses), sincronizado: false });
  if (!configurado) return local();
  const doServidor = await comFallback(
    () => funcao<Resumo>(`resumo?meses=${meses}`, undefined, "GET"),
    local,
  ).catch((e) => {
    if (e instanceof SemBackend) return local();
    throw e;
  });
  return { ...doServidor, sincronizado: doServidor.sincronizado !== false };
}

/** Mesmo cálculo do servidor, para quando ele não responde. */
export function resumoLocal(meses = 3): Resumo {
  const todos = [...lancamentosLocais()].sort((a, b) =>
    b.competencia.localeCompare(a.competencia));
  const competencias = [...new Set(todos.map((l) => l.competencia))].slice(0, meses);
  const lancs = todos.filter((l) => competencias.includes(l.competencia));
  const c = custosLocais();
  const informados = custosInformados(c);

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

  const por_competencia = competencias.map((comp) => {
    const doMes = lancs.filter((l) => l.competencia === comp);
    const s = (f: (l: Lancamento) => number) =>
      Math.round(doMes.reduce((a, l) => a + (f(l) || 0), 0) * 100) / 100;
    return { competencia: comp, bruto: s((l) => l.bruto), km: s((l) => l.km),
             corridas: Math.round(s((l) => l.corridas)), horas: s((l) => l.horas),
             apps: [...new Set(doMes.map((l) => l.app))].sort() };
  });

  const base: Resumo = {
    tem_dados: true, meses_lancados: n, competencias,
    bruto_total: bruto, bruto_medio_mensal: Math.round((bruto / n) * 100) / 100,
    km_total: km, corridas_total: corridas, horas_total: horas,
    por_app, por_competencia, custos_informados: informados, margem: null,
  };

  if (!informados) return base;

  const params: Parametros = {
    consumo: c.consumo_km_l, precoCombustivel: c.preco_combustivel,
    custoOleo: c.custo_oleo, kmTrocaOleo: c.km_troca_oleo,
    custoPneus: c.custo_pneus, kmPneus: c.km_pneus,
    custoRevisao: c.custo_revisao, kmRevisao: c.km_revisao,
    valorMoto: c.valor_moto, vidaUtilKm: c.vida_util_km,
    dasMei: c.das_mei, parcelaMoto: c.parcela_moto,
    seguro: c.seguro, outrosFixos: c.outros_fixos,
  };
  // Mesma conta da edge function, passo a passo: variável pelo km rodado,
  // fixo multiplicado pelos meses lançados. Nada de rateio por dias — foi aqui
  // que as duas pontas divergiram uma vez.
  const ck = custoPorKm(params);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const fixoMensal = c.das_mei + c.parcela_moto + c.seguro + c.outros_fixos;
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
