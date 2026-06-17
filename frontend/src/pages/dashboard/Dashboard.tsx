// src/pages/dashboard/Dashboard.tsx
import { useEffect, useState } from 'react'
import { listOperacoes, brl, pct } from '../../lib/api'
import type { Operacao, Estado } from '../../lib/api'

const PWD = import.meta.env.VITE_DASHBOARD_PASSWORD ?? 'bmoto'

const EM_ANDAMENTO = new Set<Estado>([
  'OFERTA_ENVIADA','OFERTA_VENCEDORA','ACEITA','EM_FORMALIZACAO',
  'CCB_ASSINADA','AVERBANDO','AVERBADA','DESEMBOLSANDO',
])
const CONCLUIDAS = new Set<Estado>(['DESEMBOLSADA','CONTABILIZADA','CEDIDA_FIDC'])
const RECUSADAS = new Set<Estado>([
  'LEILAO_PERDIDO','REPROVADA_CREDITO','INVIAVEL_PRICING',
  'KYC_REPROVADO','AVERBACAO_FALHA','PIX_FALHA','CANCELADA','EXPIRADA',
])

type Filtro = 'TODAS' | 'EM_ANDAMENTO' | 'CONCLUIDAS' | 'RECUSADAS'

const ESTADO_LABEL: Record<string, string> = {
  RECEBIDA:'Recebida', PRECIFICANDO:'Precificando', OFERTA_ENVIADA:'Oferta enviada',
  OFERTA_VENCEDORA:'Aguardando aceite', ACEITA:'Aceita', EM_FORMALIZACAO:'Em formalização',
  CCB_ASSINADA:'CCB assinada', AVERBANDO:'Averbando', AVERBADA:'Averbada',
  DESEMBOLSANDO:'Desembolsando', DESEMBOLSADA:'Desembolsada', CONTABILIZADA:'Contabilizada',
  CEDIDA_FIDC:'Cedida ao FIDC', REPROVADA_CREDITO:'Reprovada', INVIAVEL_PRICING:'Inviável',
  LEILAO_PERDIDO:'Perdeu leilão', EXPIRADA:'Expirada', KYC_REPROVADO:'KYC reprovado',
  AVERBACAO_FALHA:'Averbação falhou', PIX_FALHA:'Pix falhou', CANCELADA:'Cancelada',
}

const COR_ESTADO: Record<string, string> = {
  CEDIDA_FIDC:'bg-green-100 text-green-800', DESEMBOLSADA:'bg-green-100 text-green-800',
  CONTABILIZADA:'bg-green-100 text-green-800', OFERTA_VENCEDORA:'bg-blue-100 text-blue-800',
  ACEITA:'bg-blue-100 text-blue-800', EM_FORMALIZACAO:'bg-blue-100 text-blue-800',
  CCB_ASSINADA:'bg-yellow-100 text-yellow-800', AVERBANDO:'bg-yellow-100 text-yellow-800',
  REPROVADA_CREDITO:'bg-red-100 text-red-700', KYC_REPROVADO:'bg-red-100 text-red-700',
  AVERBACAO_FALHA:'bg-red-100 text-red-700', PIX_FALHA:'bg-red-100 text-red-700',
}

const TRILHA_ESTADOS: Estado[] = [
  'RECEBIDA','OFERTA_ENVIADA','OFERTA_VENCEDORA','ACEITA',
  'EM_FORMALIZACAO','CCB_ASSINADA','AVERBANDO','AVERBADA',
  'DESEMBOLSANDO','DESEMBOLSADA','CEDIDA_FIDC',
]

export default function Dashboard() {
  const [auth, setAuth] = useState(false)
  const [pwd, setPwd] = useState('')
  const [ops, setOps] = useState<Operacao[]>([])
  const [filtro, setFiltro] = useState<Filtro>('TODAS')
  const [detalhe, setDetalhe] = useState<Operacao | null>(null)

  const load = async () => {
    try { setOps(await listOperacoes()) } catch { /* retém anterior */ }
  }

  useEffect(() => {
    if (!auth) return
    load()
    const iv = setInterval(load, 10000)
    return () => clearInterval(iv)
  }, [auth])

  if (!auth) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 p-8 rounded-2xl w-80">
        <p className="text-white font-semibold text-lg mb-4 text-center">BMoto — Dashboard</p>
        <input type="password" placeholder="Senha" value={pwd}
          onChange={e => setPwd(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && pwd === PWD && setAuth(true)}
          className="w-full px-4 py-3 rounded-lg bg-gray-800 text-white mb-3 outline-none
                     focus:ring-2 focus:ring-sky-400" />
        <button onClick={() => pwd === PWD && setAuth(true)}
          className="w-full bg-sky-500 text-white py-3 rounded-lg font-medium hover:bg-sky-400">
          Entrar
        </button>
        {pwd && pwd !== PWD && (
          <p className="text-red-400 text-sm text-center mt-2">Senha incorreta</p>
        )}
      </div>
    </div>
  )

  // KPIs
  const aprovadas = ops.filter(o => !RECUSADAS.has(o.estado as Estado) && o.pricing)
  const volume = aprovadas.reduce((s, o) => s + (o.pricing?.liberado ?? 0), 0)
  const taxaMedia = aprovadas.length
    ? aprovadas.reduce((s, o) => s + (o.pricing?.taxa_am ?? 0) * (o.pricing?.liberado ?? 0), 0) / (volume || 1)
    : 0
  const cetMedio = aprovadas.length
    ? aprovadas.reduce((s, o) => s + (o.pricing?.cet_am ?? 0) * (o.pricing?.liberado ?? 0), 0) / (volume || 1)
    : 0
  const concluidas = ops.filter(o => CONCLUIDAS.has(o.estado as Estado)).length
  const conversao = ops.length ? concluidas / ops.length : 0

  const filtradas = ops.filter(o => {
    if (filtro === 'EM_ANDAMENTO') return EM_ANDAMENTO.has(o.estado as Estado)
    if (filtro === 'CONCLUIDAS') return CONCLUIDAS.has(o.estado as Estado)
    if (filtro === 'RECUSADAS') return RECUSADAS.has(o.estado as Estado)
    return true
  })

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight">BMoto</span>
        <span className="text-gray-400 text-sm">Dashboard do Originador</span>
      </header>

      <div className="p-6 max-w-7xl mx-auto">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <KPICard label="Operações" value={String(ops.length)} />
          <KPICard label="Volume aprovado" value={brl(volume)} />
          <KPICard label="Taxa média" value={pct(taxaMedia) + ' a.m.'} />
          <KPICard label="CET médio" value={pct(cetMedio) + ' a.m.'} />
          <KPICard label="Conversão" value={pct(conversao, 1)} />
        </div>

        {/* Filtros */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {(['TODAS','EM_ANDAMENTO','CONCLUIDAS','RECUSADAS'] as Filtro[]).map(f => (
            <button key={f} onClick={() => setFiltro(f)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors
                ${filtro === f ? 'bg-sky-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
              {f === 'TODAS' ? 'Todas' : f === 'EM_ANDAMENTO' ? 'Em andamento' : f === 'CONCLUIDAS' ? 'Concluídas' : 'Recusadas'}
            </button>
          ))}
        </div>

        {/* Tabela */}
        <div className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 mb-6">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 text-gray-400">
              <tr>
                {['ID','Estado','Liberado','Parcela','Taxa a.m.','CET a.m.','Atualizado'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Nenhuma operação</td></tr>
              )}
              {filtradas.map(op => (
                <tr key={op.proposal_id}
                  onClick={() => setDetalhe(op)}
                  className="border-t border-gray-800 hover:bg-gray-800 cursor-pointer transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-300">{op.proposal_id}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                      ${COR_ESTADO[op.estado] ?? 'bg-gray-700 text-gray-300'}`}>
                      {ESTADO_LABEL[op.estado] ?? op.estado}
                    </span>
                  </td>
                  <td className="px-4 py-3">{op.pricing ? brl(op.pricing.liberado) : '—'}</td>
                  <td className="px-4 py-3">{op.pricing ? `${brl(op.pricing.parcela)} × ${op.pricing.prazo_meses}` : '—'}</td>
                  <td className="px-4 py-3">{op.pricing ? pct(op.pricing.taxa_am) : '—'}</td>
                  <td className="px-4 py-3">{op.pricing ? pct(op.pricing.cet_am) : '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {op.historico.length > 0
                      ? new Date().toLocaleTimeString('pt-BR')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Detalhe */}
        {detalhe && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
            onClick={() => setDetalhe(null)}>
            <div className="bg-gray-900 rounded-2xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-start mb-4">
                <h2 className="font-semibold text-lg">{detalhe.proposal_id}</h2>
                <button onClick={() => setDetalhe(null)} className="text-gray-400 hover:text-white">✕</button>
              </div>

              {/* Timeline */}
              <p className="text-gray-400 text-xs mb-3 uppercase tracking-wider">Linha do tempo</p>
              <div className="flex items-center gap-1 overflow-x-auto pb-2 mb-6">
                {TRILHA_ESTADOS.map((s, i) => {
                  const idx = TRILHA_ESTADOS.indexOf(detalhe.estado as Estado)
                  const done = i <= idx
                  return (
                    <div key={s} className="flex items-center gap-1 shrink-0">
                      <div className={`w-3 h-3 rounded-full border-2 shrink-0
                        ${done ? 'bg-sky-400 border-sky-400' : 'border-gray-600'}`} />
                      {i < TRILHA_ESTADOS.length - 1 && (
                        <div className={`w-6 h-0.5 ${done ? 'bg-sky-400' : 'bg-gray-700'}`} />
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Dados */}
              {detalhe.pricing && (
                <div className="space-y-2 text-sm mb-4">
                  <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Dados da operação</p>
                  {[
                    ['Liberado', brl(detalhe.pricing.liberado)],
                    ['Parcela', `${brl(detalhe.pricing.parcela)} × ${detalhe.pricing.prazo_meses}x`],
                    ['Taxa', `${pct(detalhe.pricing.taxa_am)} a.m.`],
                    ['CET', `${pct(detalhe.pricing.cet_am)} a.m.`],
                    ['IOF', brl(detalhe.pricing.iof)],
                  ].map(([l, v]) => (
                    <div key={l} className="flex justify-between">
                      <span className="text-gray-400">{l}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Histórico de transições */}
              <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Histórico</p>
              <div className="space-y-1">
                {detalhe.historico.map((t, i) => (
                  <div key={i} className="text-xs flex gap-2 text-gray-300">
                    <span className="text-gray-500">{ESTADO_LABEL[t.de] ?? t.de}</span>
                    <span className="text-sky-400">→</span>
                    <span>{ESTADO_LABEL[t.para] ?? t.para}</span>
                    <span className="text-gray-500 ml-auto">{t.evento}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function KPICard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className="text-white font-bold text-lg leading-tight">{value}</p>
    </div>
  )
}
