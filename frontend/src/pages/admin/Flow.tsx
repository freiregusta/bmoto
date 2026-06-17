import { flowStages } from "@/data/mock";
import { ArrowRight } from "lucide-react";

export default function AdminFlow() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold">Fluxo de originação</h1>
        <p className="text-sm text-muted-foreground">Etapas, responsáveis e SLAs da esteira BMoto.</p>
      </header>

      <div className="flex flex-wrap items-stretch gap-3">
        {flowStages.map((s, i) => (
          <div key={s.etapa} className="flex items-center gap-3">
            <div className="surface min-w-[200px] p-5">
              <div className="text-xs text-primary">Etapa {i + 1}</div>
              <div className="mt-2 font-display text-lg font-semibold">{s.etapa}</div>
              <div className="mt-1 text-xs text-muted-foreground">{s.responsavel}</div>
              <div className="mt-3 inline-flex rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">SLA {s.sla}</div>
            </div>
            {i < flowStages.length - 1 && <ArrowRight className="hidden h-5 w-5 text-muted-foreground md:block" />}
          </div>
        ))}
      </div>
    </div>
  );
}
