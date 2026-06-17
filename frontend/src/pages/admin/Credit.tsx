import { creditPolicies } from "@/data/mock";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function AdminCredit() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold">Política de crédito</h1>
        <p className="text-sm text-muted-foreground">Limites e fluxo de aprovação por faixa de score.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-5">
        {creditPolicies.map((p) => (
          <div key={p.faixa} className="surface p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{p.faixa}</div>
            <div className="mt-3 font-display text-2xl font-bold">{p.limite ? fmt(p.limite) : "—"}</div>
            <div className="mt-1 text-xs text-muted-foreground">Comprom. máx.: {p.comprometimento}</div>
            <div className="mt-4 inline-flex rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{p.aprovacao}</div>
          </div>
        ))}
      </div>

      <div className="surface p-6">
        <h2 className="font-display text-lg font-semibold">Regras adicionais</h2>
        <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
          <li>• Idade mínima: 18 anos / Idade máxima: 75 anos no fim do contrato</li>
          <li>• Renda mínima comprovada: R$ 1.412</li>
          <li>• Negativação ativa em SCR &gt; R$ 500 → recusa automática</li>
          <li>• Consulta SCR Bacen obrigatória acima de R$ 3.000</li>
          <li>• Reanálise manual permitida em até 48h pela mesa de crédito</li>
        </ul>
      </div>
    </div>
  );
}
