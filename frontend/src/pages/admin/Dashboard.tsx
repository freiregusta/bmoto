import { useEffect, useState } from "react";
import { listOperacoes, calcKpis, brl, pct, ESTADOS_RECUSADOS } from "@/lib/api";
import type { Operacao } from "@/lib/api";
import { OriginationChart } from "@/components/admin/OriginationChart";
import { TrendingUp, CheckCircle2, AlertTriangle, Wallet } from "lucide-react";

const statusColor: Record<string, string> = {
  CEDIDA_FIDC:      "text-success bg-success/10",
  DESEMBOLSADA:     "text-success bg-success/10",
  OFERTA_VENCEDORA: "text-warning bg-warning/10",
  ACEITA:           "text-warning bg-warning/10",
  EM_FORMALIZACAO:  "text-warning bg-warning/10",
  REPROVADA_CREDITO:"text-destructive bg-destructive/10",
  KYC_REPROVADO:    "text-destructive bg-destructive/10",
};
const estadoLabel: Record<string, string> = {
  CEDIDA_FIDC:"Paga/Cedida", DESEMBOLSADA:"Desembolsada", OFERTA_VENCEDORA:"Aguardando aceite",
  ACEITA:"Aceita", EM_FORMALIZACAO:"Formalização", CCB_ASSINADA:"CCB assinada",
  AVERBANDO:"Averbando", REPROVADA_CREDITO:"Recusada", LEILAO_PERDIDO:"Perdeu leilão",
};

export default function AdminDashboard() {
  const [ops, setOps] = useState<Operacao[]>([]);

  useEffect(() => {
    listOperacoes().then(setOps).catch(() => setOps([]));
    const iv = setInterval(() => listOperacoes().then(setOps).catch(() => {}), 15000);
    return () => clearInterval(iv);
  }, []);

  const kpis = calcKpis(ops);

  const cards = [
    { label: "Originação do mês",  value: brl(kpis.originacaoMes),          delta: "", icon: TrendingUp },
    { label: "Taxa de aprovação",  value: `${kpis.taxaAprovacao}%`,          delta: "", icon: CheckCircle2 },
    { label: "Inadimplência 90d",  value: `${kpis.inadimplencia}%`,          delta: "", icon: AlertTriangle },
    { label: "Ticket médio",       value: brl(kpis.ticketMedio),             delta: "", icon: Wallet },
  ];

  // funil a partir das operações reais
  const total      = ops.length;
  const propostas  = ops.filter(o => o.estado !== 'RECEBIDA').length;
  const aprovadas  = ops.filter(o => !ESTADOS_RECUSADOS.has(o.estado) && o.pricing).length;
  const contratadas= ops.filter(o => ['DESEMBOLSADA','CONTABILIZADA','CEDIDA_FIDC'].includes(o.estado)).length;
  const funil = [
    { l: "Solicitações", v: total,      p: 100 },
    { l: "Propostas",    v: propostas,  p: total ? (propostas / total) * 100 : 0 },
    { l: "Aprovadas",    v: aprovadas,  p: total ? (aprovadas / total) * 100 : 0 },
    { l: "Contratadas",  v: contratadas,p: total ? (contratadas / total) * 100 : 0 },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão consolidada da originação BMoto.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="surface p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{c.label}</span>
              <c.icon className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-3 font-display text-2xl font-bold">{c.value}</div>
            {c.delta && <div className="mt-1 text-xs text-success">{c.delta}</div>}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <OriginationChart />
        <div className="surface p-6">
          <div className="text-sm text-muted-foreground">Funil de aprovação</div>
          <div className="mt-4 space-y-3">
            {funil.map((s) => (
              <div key={s.l}>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{s.l}</span>
                  <span className="font-medium">{s.v.toLocaleString("pt-BR")}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-gradient-mint transition-all duration-700" style={{ width: `${s.p}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="surface overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="font-display text-lg font-semibold">Últimas operações</h2>
          <a href="/admin/propostas" className="text-xs text-primary hover:underline">Ver todas →</a>
        </div>
        {ops.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            Nenhuma operação ainda. Aguardando solicitações do leilão.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-5 py-3">ID</th>
                <th className="px-5 py-3">Estado</th>
                <th className="px-5 py-3 text-right">Liberado</th>
                <th className="px-5 py-3">Parcela</th>
                <th className="px-5 py-3 text-right">Taxa a.m.</th>
                <th className="px-5 py-3 text-right">CET a.m.</th>
              </tr>
            </thead>
            <tbody>
              {ops.slice(0, 6).map((o) => (
                <tr key={o.proposal_id} className="border-b border-border/50 last:border-0 hover:bg-white/5">
                  <td className="px-5 py-3 font-mono text-xs">{o.proposal_id}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs ${statusColor[o.estado] ?? "text-muted-foreground bg-muted"}`}>
                      {estadoLabel[o.estado] ?? o.estado}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{o.pricing ? brl(o.pricing.liberado) : "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {o.pricing ? `${brl(o.pricing.parcela)} × ${o.pricing.prazo_meses}x` : "—"}
                  </td>
                  <td className="px-5 py-3 text-right">{o.pricing ? pct(o.pricing.taxa_am) : "—"}</td>
                  <td className="px-5 py-3 text-right">{o.pricing ? pct(o.pricing.cet_am) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
