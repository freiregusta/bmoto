export const kpis = {
  originacaoMes: 48_320_000,
  taxaAprovacao: 67.4,
  inadimplencia: 2.8,
  ticketMedio: 1840,
};

export const originationSeries = [
  { m: "Jan", v: 22 }, { m: "Fev", v: 28 }, { m: "Mar", v: 31 },
  { m: "Abr", v: 35 }, { m: "Mai", v: 41 }, { m: "Jun", v: 38 },
  { m: "Jul", v: 44 }, { m: "Ago", v: 47 }, { m: "Set", v: 52 },
  { m: "Out", v: 49 }, { m: "Nov", v: 54 }, { m: "Dez", v: 48 },
];

export type ProposalStatus = "Aprovada" | "Em análise" | "Recusada" | "Paga";
export const proposals: Array<{
  id: string; cliente: string; loja: string; valor: number;
  parcelas: number; produto: string; status: ProposalStatus; data: string;
}> = [
  { id: "PR-10421", cliente: "Maria S.",   loja: "MotoCenter SP",    valor: 8200,  parcelas: 24, produto: "CDC",            status: "Aprovada",   data: "2026-06-16" },
  { id: "PR-10420", cliente: "João P.",    loja: "BikePoint RJ",     valor: 3400,  parcelas: 12, produto: "BNPL",           status: "Em análise", data: "2026-06-16" },
  { id: "PR-10419", cliente: "Ana L.",     loja: "MotoCenter SP",    valor: 15600, parcelas: 36, produto: "CDC",            status: "Aprovada",   data: "2026-06-15" },
  { id: "PR-10418", cliente: "Pedro R.",   loja: "Garagem Norte",    valor: 980,   parcelas: 6,  produto: "Crédito Pessoal", status: "Paga",       data: "2026-06-15" },
  { id: "PR-10417", cliente: "Carla M.",   loja: "BikePoint RJ",     valor: 5200,  parcelas: 18, produto: "Private Label",   status: "Recusada",   data: "2026-06-14" },
  { id: "PR-10416", cliente: "Lucas T.",   loja: "Velocity Store",   valor: 11200, parcelas: 24, produto: "CDC",            status: "Aprovada",   data: "2026-06-14" },
  { id: "PR-10415", cliente: "Beatriz O.", loja: "MotoCenter SP",    valor: 2700,  parcelas: 10, produto: "BNPL",           status: "Aprovada",   data: "2026-06-13" },
];

export const pricing = [
  { produto: "CDC",             scoreMin: 600, prazoMax: 36, taxaMes: 2.49, cet: 38.4 },
  { produto: "Crédito Pessoal", scoreMin: 650, prazoMax: 24, taxaMes: 3.10, cet: 46.8 },
  { produto: "Private Label",   scoreMin: 550, prazoMax: 18, taxaMes: 4.20, cet: 64.1 },
  { produto: "BNPL",            scoreMin: 500, prazoMax: 12, taxaMes: 0.00, cet: 0.0 },
];

export const creditPolicies = [
  { faixa: "AAA (800+)", limite: 30000, comprometimento: "30%", aprovacao: "Automática" },
  { faixa: "AA (700-799)", limite: 18000, comprometimento: "25%", aprovacao: "Automática" },
  { faixa: "A (600-699)", limite: 8000,  comprometimento: "20%", aprovacao: "Mesa rápida" },
  { faixa: "B (500-599)", limite: 2500,  comprometimento: "15%", aprovacao: "Mesa de crédito" },
  { faixa: "C (<500)",    limite: 0,     comprometimento: "—",   aprovacao: "Recusa" },
];

export const partners = [
  { nome: "MotoCenter SP",   integracao: "API v2", status: "Ativo",  volume: "R$ 12,4M" },
  { nome: "BikePoint RJ",    integracao: "API v2", status: "Ativo",  volume: "R$ 8,1M" },
  { nome: "Garagem Norte",   integracao: "Webhook",status: "Ativo",  volume: "R$ 3,2M" },
  { nome: "Velocity Store",  integracao: "API v2", status: "Setup",  volume: "—" },
  { nome: "RodaLivre BH",    integracao: "Webhook",status: "Pausado",volume: "R$ 1,1M" },
];

export const flowStages = [
  { etapa: "Simulação",     responsavel: "Cliente / PDV", sla: "Imediato" },
  { etapa: "KYC + Bureau",  responsavel: "Motor BMoto",   sla: "< 8s" },
  { etapa: "Score & Política", responsavel: "Motor BMoto", sla: "< 2s" },
  { etapa: "Aprovação",     responsavel: "Auto / Mesa",   sla: "0 — 4h" },
  { etapa: "Assinatura",    responsavel: "Cliente",       sla: "< 24h" },
  { etapa: "Liberação",     responsavel: "BMoto",         sla: "Mesmo dia" },
];
