/**
 * politica.ts — o motor de crédito: o que cabe no bolso, a que taxa e prazo.
 *
 * Porte fiel de ProdutoCredito.avaliar() (plataforma/catalogo.py). O produto é
 * paramétrico e vem do catálogo — taxa, prazo, ticket, LTV, comprometimento
 * máximo. Nada de taxa chumbada no código: quem define política é quem cadastra
 * o produto no admin.
 */

export interface ProdutoCredito {
  id: string; nome: string; tipo: string;
  taxa_mensal: number; prazo_min: number; prazo_max: number;
  ticket_min: number; ticket_max: number;
  garantia_tipo: string | null; ltv_max: number;
  score_minimo: number; renda_minima: number; comprometimento_max: number;
  idade_min: number; idade_max: number;
  exige_mei: boolean; exige_kyc: boolean; meses_renda_comprovada: number;
  tac: number; iof_diario: number; iof_fixo: number;
  cobranca: string; jornada_id: string | null; ativo: boolean;
}

const num = (v: unknown, padrao = 0) => (Number.isFinite(Number(v)) ? Number(v) : padrao);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Numeric do Postgres chega como string em algumas rotas: normaliza na entrada. */
export function normalizarProduto(linha: Record<string, unknown>): ProdutoCredito {
  return {
    id: String(linha.id), nome: String(linha.nome), tipo: String(linha.tipo),
    taxa_mensal: num(linha.taxa_mensal, 0.0199),
    prazo_min: num(linha.prazo_min, 6), prazo_max: num(linha.prazo_max, 48),
    ticket_min: num(linha.ticket_min, 500), ticket_max: num(linha.ticket_max, 30_000),
    garantia_tipo: (linha.garantia_tipo as string) ?? null, ltv_max: num(linha.ltv_max),
    score_minimo: num(linha.score_minimo, 500), renda_minima: num(linha.renda_minima, 1_200),
    comprometimento_max: num(linha.comprometimento_max, 0.3),
    idade_min: num(linha.idade_min, 18), idade_max: num(linha.idade_max, 70),
    exige_mei: !!linha.exige_mei, exige_kyc: linha.exige_kyc !== false,
    meses_renda_comprovada: num(linha.meses_renda_comprovada, 3),
    tac: num(linha.tac), iof_diario: num(linha.iof_diario, 0.000082),
    iof_fixo: num(linha.iof_fixo, 0.0038),
    cobranca: String(linha.cobranca ?? "pix_automatico"),
    jornada_id: (linha.jornada_id as string) ?? null, ativo: linha.ativo !== false,
  };
}

/** Tabela Price. */
export function parcela(p: ProdutoCredito, principal: number, parcelas: number): number {
  const i = p.taxa_mensal;
  if (i <= 0) return r2(principal / parcelas);
  return r2((principal * i) / (1 - Math.pow(1 + i, -parcelas)));
}

/** CET aproximado: a taxa que zera o fluxo com TAC e IOF embutidos. */
export function cetAnual(p: ProdutoCredito, principal: number, parcelas: number): number {
  const liberado = principal - p.tac - principal * p.iof_fixo;
  const pmt = parcela(p, principal, parcelas);
  if (liberado <= 0 || pmt <= 0) return 0;
  let lo = 0, hi = 1;
  for (let k = 0; k < 80; k++) {                    // bissecção na taxa mensal
    const m = (lo + hi) / 2;
    let vp = 0;
    for (let t = 1; t <= parcelas; t++) vp += pmt / Math.pow(1 + m, t);
    if (vp > liberado) lo = m; else hi = m;
  }
  return r4(Math.pow(1 + (lo + hi) / 2, 12) - 1);
}

export const limitePorGarantia = (p: ProdutoCredito, valor: number) =>
  p.ltv_max ? r2(valor * p.ltv_max) : 0;

/** Maior principal cujo parcelamento caiba no comprometimento máximo da renda. */
export function limitePorRenda(p: ProdutoCredito, renda: number, parcelas?: number): number {
  const n = parcelas || p.prazo_max;
  const cap = renda * p.comprometimento_max;
  if (cap <= 0) return 0;
  const i = p.taxa_mensal;
  const principal = i <= 0 ? cap * n : (cap * (1 - Math.pow(1 + i, -n))) / i;
  return r2(Math.min(principal, p.ticket_max));
}

export function avaliar(p: ProdutoCredito, e: {
  score: number; renda_media: number; idade: number;
  tem_mei?: boolean; kyc_ok?: boolean; meses_renda?: number;
  valor_garantia?: number; solicitado?: number | null; parcelas?: number | null;
}) {
  const tem_mei = !!e.tem_mei, kyc_ok = e.kyc_ok !== false;
  const meses_renda = e.meses_renda ?? 12, valor_garantia = e.valor_garantia ?? 0;

  const recusas: string[] = [];
  if (!p.ativo) recusas.push("produto_inativo");
  if (e.score < p.score_minimo) recusas.push("score_abaixo_do_minimo");
  if (e.renda_media < p.renda_minima) recusas.push("renda_abaixo_do_minimo");
  if (!(e.idade >= p.idade_min && e.idade <= p.idade_max)) recusas.push("idade_fora_da_politica");
  if (p.exige_mei && !tem_mei) recusas.push("exige_mei_ativa");
  if (p.exige_kyc && !kyc_ok) recusas.push("kyc_reprovado");
  if (meses_renda < p.meses_renda_comprovada) recusas.push("historico_de_renda_insuficiente");
  if (p.garantia_tipo && p.garantia_tipo !== "nenhuma" && valor_garantia <= 0)
    recusas.push("garantia_obrigatoria");

  const n = Math.max(p.prazo_min, Math.min(e.parcelas || p.prazo_max, p.prazo_max));
  const limites = [limitePorRenda(p, e.renda_media, n), p.ticket_max];
  if (p.ltv_max && valor_garantia > 0) limites.push(limitePorGarantia(p, valor_garantia));
  const limite = r2(Math.min(...limites));
  const principal = r2(Math.min(e.solicitado || limite, limite));
  if (principal < p.ticket_min) recusas.push("abaixo_do_ticket_minimo");

  const aprovado = recusas.length === 0;
  const pmt = aprovado && principal > 0 ? parcela(p, principal, n) : 0;
  return {
    produto_id: p.id, produto: p.nome, tipo: p.tipo,
    aprovado, recusas, limite, principal, parcelas: n,
    parcela: pmt, taxa_mensal: p.taxa_mensal,
    cet_anual: aprovado && principal > 0 ? cetAnual(p, principal, n) : 0,
    comprometimento: e.renda_media > 0 ? r4(pmt / e.renda_media) : 0,
    garantia: p.garantia_tipo
      ? { tipo: p.garantia_tipo, valor: valor_garantia, ltv_max: p.ltv_max } : null,
    cobranca: p.cobranca, jornada_id: p.jornada_id,
  };
}
