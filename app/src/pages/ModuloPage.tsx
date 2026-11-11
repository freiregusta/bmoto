/**
 * ModuloPage — resolve QUALQUER módulo por id.
 *
 * Tem tela dedicada registrada? usa. Não tem? roda a jornada configurada.
 * Está desligado? diz isso em vez de dar 404 — o entregador merece saber que
 * o produto existe e está por vir.
 */

import { useParams } from "react-router-dom";
import { Card, Carregando, Vazio } from "@/components/ui";
import { Indisponivel } from "@/components/Indisponivel";
import { JornadaRunner } from "@/components/JornadaRunner";
import { usePlataforma } from "@/platform/PlatformProvider";
import { obterModulo } from "@/platform/registry";

export default function ModuloPage() {
  const { moduloId = "" } = useParams();
  const { porId, carregando } = usePlataforma();

  if (carregando) return <Card><Carregando /></Card>;

  const modulo = porId(moduloId);
  if (!modulo)
    return (
      <Vazio icone="SearchX" titulo="Produto não encontrado">
        Não existe um módulo <code className="text-mint">{moduloId}</code> nesta instalação.
      </Vazio>
    );

  // Desligado ou sem fornecedor: a mesma verdade, dita do mesmo jeito.
  if (!modulo.enabled || !modulo.pronto)
    return (
      <div className="space-y-5">
        <header>
          <h1 className="text-xl font-bold">{modulo.titulo}</h1>
        </header>
        <Indisponivel modulo={modulo} />
      </div>
    );

  const def = obterModulo(modulo.id);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold">{modulo.titulo}</h1>
        <p className="mt-1 text-sm text-ink-muted">{modulo.descricao}</p>
      </header>
      {def ? <def.Component modulo={modulo} /> : <JornadaRunner modulo={modulo} />}
    </div>
  );
}
