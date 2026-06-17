// src/pages/formalizacao/Formalizacao.tsx
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import Layout from '../../components/Layout'
import { getOperacao, aceitar, kyc, assinarCCB, brl, pct } from '../../lib/api'
import type { Operacao, Estado } from '../../lib/api'

const WHATSAPP = 'https://wa.me/5511999999999'

const ESTADOS_ESPERA = new Set<Estado>([
  'CCB_ASSINADA', 'AVERBANDO', 'AVERBADA',
])
const ESTADOS_PIX = new Set<Estado>(['DESEMBOLSANDO'])
const ESTADOS_SUCESSO = new Set<Estado>(['DESEMBOLSADA', 'CEDIDA_FIDC', 'CONTABILIZADA'])
const ESTADOS_ERRO: Partial<Record<Estado, string>> = {
  KYC_REPROVADO: 'Não conseguimos verificar sua identidade. Entre em contato.',
  AVERBACAO_FALHA: 'Houve um problema ao reservar sua margem. Entre em contato.',
  PIX_FALHA: 'O pagamento não foi concluído. Entre em contato.',
  EXPIRADA: 'Sua proposta expirou. Solicite uma nova.',
  CANCELADA: 'Esta operação foi cancelada.',
  LEILAO_PERDIDO: 'Proposta não disponível no momento.',
  INVIAVEL_PRICING: 'Não foi possível calcular uma oferta para seu perfil.',
  REPROVADA_CREDITO: 'Proposta não aprovada no momento.',
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16">
      <div className="w-12 h-12 border-4 border-brand-100 border-t-brand-900 rounded-full animate-spin" />
      <p className="text-gray-500 text-sm">{label}</p>
    </div>
  )
}

export default function Formalizacao() {
  const [params] = useSearchParams()
  const proposalId = params.get('proposal_id') ?? ''
  const [op, setOp] = useState<Operacao | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [aceite, setAceite] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!proposalId) { setError('proposal_id não informado'); setLoading(false); return }
    try {
      const data = await getOperacao(proposalId)
      setOp(data)
    } catch {
      setError('Não foi possível carregar sua proposta. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [proposalId])

  useEffect(() => { load() }, [load])

  // Polling para estados de espera
  useEffect(() => {
    if (!op) return
    const estado = op.estado as Estado
    const polling = ESTADOS_ESPERA.has(estado) || ESTADOS_PIX.has(estado)
    if (!polling) return
    const iv = setInterval(async () => {
      try {
        const data = await getOperacao(proposalId)
        setOp(data)
      } catch { /* mantém o estado atual */ }
    }, 4000)
    return () => clearInterval(iv)
  }, [op?.estado, proposalId])

  const handle = async (fn: () => Promise<Operacao>) => {
    setBusy(true)
    try { setOp(await fn()) }
    catch { setError('Ocorreu um erro. Tente novamente.') }
    finally { setBusy(false) }
  }

  if (loading) return <Layout><Spinner label="Carregando sua proposta..." /></Layout>
  if (error) return <Layout><p className="text-red-600 text-center py-8">{error}</p></Layout>
  if (!op) return null

  const estado = op.estado as Estado

  // Erro terminal
  if (ESTADOS_ERRO[estado]) {
    return (
      <Layout>
        <div className="text-center py-12">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-gray-700 mb-6">{ESTADOS_ERRO[estado]}</p>
          <a href={WHATSAPP} target="_blank" rel="noreferrer"
            className="inline-block bg-green-500 text-white px-6 py-3 rounded-lg font-medium">
            Falar no WhatsApp
          </a>
        </div>
      </Layout>
    )
  }

  // Sucesso
  if (ESTADOS_SUCESSO.has(estado)) {
    return (
      <Layout>
        <div className="text-center py-12">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-semibold text-brand-900 mb-2">
            Empréstimo concluído!
          </h2>
          <p className="text-gray-600">O valor já está na sua conta.</p>
        </div>
      </Layout>
    )
  }

  // Aguardando Pix
  if (ESTADOS_PIX.has(estado)) {
    return <Layout><Spinner label="Transferindo o valor para sua conta..." /></Layout>
  }

  // Aguardando averbação
  if (ESTADOS_ESPERA.has(estado)) {
    return <Layout><Spinner label="Reservando sua margem junto ao empregador..." /></Layout>
  }

  const p = op.pricing

  // Tela 1 — Oferta
  if (estado === 'OFERTA_VENCEDORA' && p) {
    return (
      <Layout>
        <h1 className="text-xl font-semibold text-brand-900 mb-6">Sua proposta</h1>
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 mb-6 space-y-4">
          <Row label="Valor liberado" value={brl(p.liberado)} highlight />
          <Row label="Parcela" value={`${brl(p.parcela)} × ${p.prazo_meses}x`} />
          <Row label="Taxa nominal" value={`${pct(p.taxa_am)} a.m.`} />
          <Row label="CET" value={`${pct(p.cet_am)} a.m.`} />
          <Row label="IOF" value={brl(p.iof)} />
        </div>
        <button onClick={() => handle(() => aceitar(proposalId))} disabled={busy}
          className="w-full bg-brand-900 text-white py-4 rounded-xl font-semibold text-lg
                     hover:bg-brand-700 disabled:opacity-50 transition-colors">
          {busy ? 'Aguarde...' : 'Aceitar oferta'}
        </button>
      </Layout>
    )
  }

  // Tela 2 — KYC
  if (estado === 'ACEITA') {
    return (
      <Layout>
        <h1 className="text-xl font-semibold text-brand-900 mb-4">Verificação de identidade</h1>
        <div className="bg-brand-100 rounded-xl p-5 mb-6 text-sm text-gray-700 space-y-2">
          <p>📄 Tenha em mãos seu <strong>RG ou CNH</strong>.</p>
          <p>🤳 Vamos tirar uma <strong>selfie</strong> para confirmar que é você.</p>
          <p>🔒 Seus dados são protegidos por criptografia.</p>
        </div>
        <button onClick={() => handle(() => kyc(proposalId, true))} disabled={busy}
          className="w-full bg-brand-900 text-white py-4 rounded-xl font-semibold text-lg
                     hover:bg-brand-700 disabled:opacity-50 transition-colors">
          {busy ? 'Verificando...' : 'Confirmar identidade'}
        </button>
      </Layout>
    )
  }

  // Tela 3 — CCB
  if (estado === 'EM_FORMALIZACAO' && p) {
    return (
      <Layout>
        <h1 className="text-xl font-semibold text-brand-900 mb-4">Assinar contrato</h1>
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4 text-sm space-y-2">
          <p className="font-medium text-gray-800 mb-3">Resumo da operação</p>
          <Row label="Liberado" value={brl(p.liberado)} />
          <Row label="Parcela" value={`${brl(p.parcela)} × ${p.prazo_meses}x`} />
          <Row label="Taxa" value={`${pct(p.taxa_am)} a.m.`} />
          <Row label="CET" value={`${pct(p.cet_am)} a.m.`} />
        </div>
        <label className="flex items-start gap-3 mb-6 cursor-pointer">
          <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)}
            className="mt-1 w-4 h-4 accent-brand-900" />
          <span className="text-sm text-gray-700">
            Li e aceito os termos do contrato (CCB) e autorizo o desconto das
            parcelas em folha de pagamento.
          </span>
        </label>
        <button onClick={() => handle(() => assinarCCB(proposalId))}
          disabled={!aceite || busy}
          className="w-full bg-brand-900 text-white py-4 rounded-xl font-semibold text-lg
                     hover:bg-brand-700 disabled:opacity-50 transition-colors">
          {busy ? 'Assinando...' : 'Assinar contrato'}
        </button>
      </Layout>
    )
  }

  // Fallback
  return (
    <Layout>
      <p className="text-center text-gray-500 py-8">
        Estado: <code className="font-mono">{estado}</code>
      </p>
    </Layout>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500 text-sm">{label}</span>
      <span className={highlight ? 'text-2xl font-bold text-brand-900' : 'font-medium text-gray-800'}>
        {value}
      </span>
    </div>
  )
}
