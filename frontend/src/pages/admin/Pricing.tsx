import { pricing } from "@/data/mock";

export default function AdminPricing() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold">Pricing</h1>
        <p className="text-sm text-muted-foreground">Tabela de taxas e CET por produto. Edite e publique para a esteira.</p>
      </header>

      <div className="surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-5 py-3">Produto</th><th className="px-5 py-3">Score mínimo</th>
              <th className="px-5 py-3">Prazo máx.</th><th className="px-5 py-3 text-right">Taxa a.m.</th>
              <th className="px-5 py-3 text-right">CET a.a.</th><th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {pricing.map((p) => (
              <tr key={p.produto} className="border-b border-border/50 last:border-0">
                <td className="px-5 py-3 font-semibold">{p.produto}</td>
                <td className="px-5 py-3"><input defaultValue={p.scoreMin} className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm" /></td>
                <td className="px-5 py-3"><input defaultValue={p.prazoMax} className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm" /> meses</td>
                <td className="px-5 py-3 text-right"><input defaultValue={p.taxaMes} className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right text-sm" /> %</td>
                <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{p.cet.toFixed(1)}%</td>
                <td className="px-5 py-3 text-right">
                  <button className="text-xs text-primary hover:underline">Publicar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
