/** Mais — todos os módulos, inclusive os que não estão na barra inferior. */

import { Link } from "react-router-dom";
import { Card, Chip, Icone, SecaoTitulo } from "@/components/ui";
import { usePlataforma } from "@/platform/PlatformProvider";
import { temTelaDedicada } from "@/platform/registry";

export default function Mais() {
  const { modulos } = usePlataforma();
  const ligados = modulos.filter((m) => m.enabled);
  const desligados = modulos.filter((m) => !m.enabled);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Tudo da BMoto</h1>

      <section className="space-y-2">
        {ligados.map((m) => (
          <Link key={m.id} to={m.rota}
                className="card flex items-center gap-4 transition hover:border-mint/30">
            <div className="rounded-xl bg-mint/12 p-2.5">
              <Icone nome={m.icone} className="h-5 w-5 text-mint" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{m.titulo}</p>
              <p className="truncate text-xs text-ink-faint">{m.descricao}</p>
            </div>
            {!m.pronto && <Chip tom="warn">sem fornecedor</Chip>}
            {m.pronto && !temTelaDedicada(m.id) && <Chip tom="neutro">jornada</Chip>}
            <Icone nome="ChevronRight" className="h-4 w-4 text-ink-faint" />
          </Link>
        ))}
      </section>

      {desligados.length > 0 && (
        <section>
          <SecaoTitulo titulo="Desligados" subtitulo="Ligue no painel de administração" />
          <Card className="space-y-2">
            {desligados.map((m) => (
              <div key={m.id} className="flex items-center gap-3 text-sm">
                <Icone nome={m.icone} className="h-4 w-4 text-ink-faint" />
                <span className="flex-1 text-ink-muted">{m.titulo}</span>
                <Chip tom="off">{m.fase === "legado" ? "legado" : m.fase}</Chip>
              </div>
            ))}
          </Card>
        </section>
      )}

      <Link to="/admin" className="btn-ghost w-full">
        <Icone nome="SlidersHorizontal" className="h-4 w-4" />
        Painel de administração
      </Link>
    </div>
  );
}
