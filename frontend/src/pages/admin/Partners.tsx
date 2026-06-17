import { partners } from "@/data/mock";

const statusColor: Record<string, string> = {
  Ativo: "text-success bg-success/10",
  Setup: "text-warning bg-warning/10",
  Pausado: "text-muted-foreground bg-muted",
};

export default function AdminPartners() {
  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Parceiros</h1>
          <p className="text-sm text-muted-foreground">Lojistas integrados via API ou webhook.</p>
        </div>
        <button className="btn-primary !py-2 !px-4 text-xs">+ Novo parceiro</button>
      </header>

      <div className="surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-5 py-3">Nome</th><th className="px-5 py-3">Integração</th>
              <th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Volume 30d</th><th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {partners.map((p) => (
              <tr key={p.nome} className="border-b border-border/50 last:border-0 hover:bg-white/5">
                <td className="px-5 py-3 font-semibold">{p.nome}</td>
                <td className="px-5 py-3 text-muted-foreground">{p.integracao}</td>
                <td className="px-5 py-3"><span className={`rounded-full px-2 py-1 text-xs ${statusColor[p.status]}`}>{p.status}</span></td>
                <td className="px-5 py-3 text-right tabular-nums">{p.volume}</td>
                <td className="px-5 py-3 text-right"><button className="text-xs text-primary hover:underline">Detalhes</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="surface p-6">
        <h2 className="font-display text-lg font-semibold">Chave de API</h2>
        <p className="mt-1 text-sm text-muted-foreground">Use para autenticar requisições no ambiente sandbox.</p>
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-3 font-mono text-xs">
          <span className="truncate">bmoto_sandbox_•••••••••••••••••••••••••••••••</span>
          <button className="ml-auto text-primary hover:underline">Copiar</button>
        </div>
      </div>
    </div>
  );
}
