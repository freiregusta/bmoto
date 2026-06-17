// src/lib/api.ts — Integração com a API da esteira BMoto

const API = import.meta.env.VITE_API_URL ?? ''

// ---- Tipos espelhando a API ------------------------------------------------

export type Estado =
  | 'RECEBIDA' | 'PRECIFICANDO' | 'OFERTA_ENVIADA' | 'OFERTA_VENCEDORA'
  | 'ACEITA' | 'EM_FORMALIZACAO' | 'CCB_ASSINADA' | 'AVERBANDO'
  | 'AVERBADA' | 'DESEMBOLSANDO' | 'DESEMBOLSADA' | 'CONTABILIZADA'
  | 'CEDIDA_FIDC' | 'REPROVADA_CREDITO' | 'INVIAVEL_PRICING'
  | 'LEILAO_PERDIDO' | 'LEILAO_ERRO' | 'EXPIRADA'
  | 'KYC_REPROVADO' | 'AVERBACAO_FALHA' | 'PIX_FALHA' | 'CANCELADA'

export interface Pricing {
  liberado: number
  principal_financiado: number
  parcela: number
  prazo_meses: number
  taxa_am: number
  taxa_aa: number
  iof: number
  seguro: number
  cet_am: number
  cet_aa: number
  feasible: boolean
  notes: string[]
}

export interface Decisao {
  status: 'APPROVED' | 'DECLINED'
  pd: number
  score: number
  motivos: string[]
}

export interface Transicao {
  de: Estado
  evento: string
  para: Estado
}

export interface Operacao {
  proposal_id: string
  estado: Estado
  terminal: boolean
  esperando_externo: boolean
  decisao: Decisao | null
  pricing: Pricing | null
  oferta: {
    installment_quantity: number
    installment_amount: number
    available_balance: number
    amount: number
    iof: number
    annual_tax: number
    cet: number
    interest_tax: number
    monthly_cet: number
    insurance_amount: number
    entry_url: string
  } | null
  historico: Transicao[]
}

// ---- Formatação ------------------------------------------------------------

export const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export const pct = (v: number, decimals = 3) =>
  `${(v * 100).toFixed(decimals)}%`

// ---- Calls da esteira (jornada do tomador) ---------------------------------

export const getOperacao = (id: string): Promise<Operacao> =>
  fetch(`${API}/operacoes/${id}`).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

export const listOperacoes = (): Promise<Operacao[]> =>
  fetch(`${API}/operacoes`).then(r => r.json())

export const aceitar = (id: string): Promise<Operacao> =>
  fetch(`${API}/operacoes/${id}/aceite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  }).then(r => r.json())

export const kyc = (id: string, ok: boolean): Promise<Operacao> =>
  fetch(`${API}/operacoes/${id}/kyc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok }),
  }).then(r => r.json())

export const assinarCCB = (id: string): Promise<Operacao> =>
  fetch(`${API}/operacoes/${id}/ccb`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `${id}-ccb` },
  }).then(r => r.json())

// ---- KPIs calculados a partir da lista ------------------------------------

export const ESTADOS_CONCLUIDOS = new Set<Estado>([
  'DESEMBOLSADA', 'CONTABILIZADA', 'CEDIDA_FIDC',
])
export const ESTADOS_RECUSADOS = new Set<Estado>([
  'LEILAO_PERDIDO', 'REPROVADA_CREDITO', 'INVIAVEL_PRICING',
  'KYC_REPROVADO', 'AVERBACAO_FALHA', 'PIX_FALHA', 'CANCELADA', 'EXPIRADA',
])

export function calcKpis(ops: Operacao[]) {
  const aprovadas = ops.filter(o => !ESTADOS_RECUSADOS.has(o.estado) && o.pricing)
  const volume = aprovadas.reduce((s, o) => s + (o.pricing?.liberado ?? 0), 0)
  const taxaMedia = volume
    ? aprovadas.reduce((s, o) => s + (o.pricing?.taxa_am ?? 0) * (o.pricing?.liberado ?? 0), 0) / volume
    : 0
  const cetMedio = volume
    ? aprovadas.reduce((s, o) => s + (o.pricing?.cet_am ?? 0) * (o.pricing?.liberado ?? 0), 0) / volume
    : 0
  const concluidas = ops.filter(o => ESTADOS_CONCLUIDOS.has(o.estado)).length
  const aprovacao = ops.length ? (aprovadas.length / ops.length) * 100 : 0

  return {
    originacaoMes: volume,
    taxaAprovacao: parseFloat(aprovacao.toFixed(1)),
    inadimplencia: 0,           // virá de endpoint próprio (carteira)
    ticketMedio: aprovadas.length ? volume / aprovadas.length : 0,
    taxaMedia,
    cetMedio,
    conversao: ops.length ? concluidas / ops.length : 0,
  }
}
