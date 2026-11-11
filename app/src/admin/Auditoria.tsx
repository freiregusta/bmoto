/** Auditoria — quem mudou o quê, quando. Exigência óbvia de um painel que mexe em crédito. */

import { Card, Carregando, Chip, Icone, SecaoTitulo, Vazio } from "@/components/ui";
import { dataHora } from "@/lib/format";
import { useAuditoria } from "./useAdmin";

const TOM: Record<string, "on" | "off" | "warn" | "danger" | "neutro"> = {
  criar: "on", atualizar: "neutro", desligar: "warn", remover: "danger", testar: "neutro",
};

export default function Auditoria() {
  const { dados, carregando, recarregar } = useAuditoria();

  if (carregando) return <Carregando />;

  const registros = dados?.registros ?? [];

  return (
    <div className="space-y-6">
      <SecaoTitulo titulo="Auditoria" subtitulo="Toda alteração no catálogo fica registrada"
                   acao={<button className="btn-ghost btn-sm" onClick={() => void recarregar()}>
                     <Icone nome="RefreshCw" className="h-3.5 w-3.5" />Atualizar
                   </button>} />

      {registros.length === 0 ? (
        <Vazio icone="ScrollText" titulo="Nada registrado ainda">
          Assim que alguém criar ou alterar uma conexão, produto, app ou módulo, aparece aqui.
        </Vazio>
      ) : (
        <Card>
          <ul className="divide-y divide-white/8">
            {registros.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tom={TOM[r.acao] ?? "neutro"}>{r.acao}</Chip>
                  <span className="text-sm font-medium">{r.entidade}</span>
                  <code className="text-xs text-mint">{r.entidade_id}</code>
                  <span className="ml-auto text-xs text-ink-faint">{dataHora(r.em)}</span>
                </div>
                <p className="mt-1 text-xs text-ink-faint">por {r.quem}</p>
                {r.antes && r.depois && <Diferencas antes={r.antes} depois={r.depois} />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Diferencas({ antes, depois }: {
  antes: Record<string, any>; depois: Record<string, any>;
}) {
  const chaves = [...new Set([...Object.keys(antes), ...Object.keys(depois)])]
    .filter((k) => !["atualizado_em", "criado_em"].includes(k))
    .filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(depois[k]));
  if (chaves.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs">
      {chaves.slice(0, 6).map((k) => (
        <li key={k} className="flex flex-wrap gap-1.5 text-ink-faint">
          <span className="font-mono text-ink-muted">{k}</span>
          <span className="line-through">{resumir(antes[k])}</span>
          <Icone nome="ArrowRight" className="h-3 w-3" />
          <span className="text-mint">{resumir(depois[k])}</span>
        </li>
      ))}
      {chaves.length > 6 && (
        <li className="text-ink-faint">… e mais {chaves.length - 6} campos</li>
      )}
    </ul>
  );
}

function resumir(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    const t = JSON.stringify(v);
    return t.length > 60 ? `${t.slice(0, 60)}…` : t;
  }
  return String(v);
}
