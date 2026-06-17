import { useEffect, useState } from "react";
import { listOperacoes, brl, pct, ESTADOS_CONCLUIDOS, ESTADOS_RECUSADOS } from "@/lib/api";
import type { Operacao, Estado } from "@/lib/api";
import { Search } from "lucide-react";

const statusColor: Record<string, string> = {
  CEDIDA_FIDC:"text-success bg-success/10", DESEMBOLSADA:"text-success bg-success/10",
  OFERTA_VENCEDORA:"text-warning bg-warning/10", ACEITA:"text-warning bg-warning/10",
  EM_FORMALIZACAO:"text-warning bg-warning/10", CCB_ASSINADA:"text-warning bg-warning/10",
  AVERBANDO:"text-warning bg-warning/10", REPROVADA_CREDITO:"text-destructive bg-destructive/10",
  KYC_REPROVADO:"text-destructive bg-destructive/10", AVERBACAO_FALHA:"text-destructive bg-destructive/10",
};
const estadoLabel: Record<string, string> = {
  RECEBIDA:"Recebida", PRECIFICANDO:"Precificando", OFERTA_ENVIADA:"Oferta enviada",
  OFERTA_VENCEDORA:"Aguardando aceite", ACEITA:"Aceita", EM_FORMALIZACAO:"Formalização",
  CCB_ASSINADA:"CCB assinada", AVERBANDO:"Averbando", AVERBADA:"Averbada",
  DESEMBOLSANDO:"Desembolsando", DESEMBOLSADA:"Desembolsada", CONTABILIZADA:"Contabilizada",
  CEDIDA_FIDC:"Paga/Cedida", REPROVADA_CREDITO:"Recusada", LEILAO_PERDIDO:"Perdeu leilão",
  EXPIRADA:"Expirada", KYC_REPROVADO:"KYC reprovado", AVERBACAO_FALHA:"Averbação falhou",
  PIX_FALHA:"Pix falhou", CANCELADA:"Cancelada", INVIAVEL_PRICING:"Inviável",
};

type Filtro = "Todas" | "Em andamento" | "Concluídas" | "Recusadas";

const EM_ANDAMENTO = new Set<Estado>([
  'OFERTA_ENVIADA','OFERTA_VENCEDORA','ACEITA','EM_FORMALIZACAO',
  'CCB_ASSINADA','AVERBANDO','AVERBADA','DESEMBOLSANDO',
]);

export default function AdminProposals() {
  const [ops, setOps] = useState<Operacao[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("Todas");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    listOperacoes().then(setOps).catch(() => {});
    const iv = setInterval(() => listOperacoes().then(setOps).catch(() => {}), 10000);
    return () => clearInterval(iv);
  }, []);

  const filtradas = ops
    .filter(o => {
      if (filtro === "Em andamento") return EM_ANDAMENTO.has(o.estado as Estado);
      if (filtro === "Concluídas") return ESTADOS_CONCLUIDOS.has(o.estado as Estado);
      if (filtro === "Recusadas") return ESTADOS_RECUSADOS.has(o.estado as Estado);
      return true;
    })
    .filter(o => !busca || o.proposal_id.toLowerCase().includes(busca.toLowerCase()));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Propostas</h1>
          <p className="text-sm text-muted-foreground">{filtradas.length} operações no período.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por ID" className="w-48 bg-transparent outline-none placeholder:text-muted-foreground" />
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {(["Todas","Em andamento","Concluídas","Recusadas"] as Filtro[]).map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            className={`rounded-full border px-4 py-1.5 text-xs ${
              filtro === f ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}>{f}</button>
        ))}
      </div>

      <div className="surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-5 py-3">ID</th>
              <th className="px-5 py-3">Estado</th>
              <th className="px-5 py-3 text-right">Liberado</th>
              <th className="px-5 py-3">Parcela</th>
              <th className="px-5 py-3 text-right">Taxa a.m.</th>
              <th className="px-5 py-3 text-right">CET a.m.</th>
              <th className="px-5 py-3">Histórico</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">Nenhuma operação encontrada.</td></tr>
            )}
            {filtradas.map((o) => (
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
                <td className="px-5 py-3 text-xs text-muted-foreground">{o.historico.length} etapas</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
