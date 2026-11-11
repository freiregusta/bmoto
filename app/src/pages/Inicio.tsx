/**
 * Inicio — a casa do entregador.
 *
 * Monta-se a partir dos módulos disponíveis: cada módulo com `Resumo`
 * registrado entrega seu próprio card; os demais entram como atalho. Produto
 * novo no admin aparece aqui sem ninguém mexer nesta tela.
 */

import { Link } from "react-router-dom";
import { Card, Carregando, Chip, Icone, SecaoTitulo } from "@/components/ui";
import { usePlataforma } from "@/platform/PlatformProvider";
import { obterModulo } from "@/platform/registry";
import { usePerfil } from "@/platform/PerfilProvider";
import { rotaModulo } from "@/rotas";

export default function Inicio() {
  const { disponiveis, modulos, carregando, modoDemo } = usePlataforma();
  const { perfil } = usePerfil();

  if (carregando) return <Card><Carregando /></Card>;

  const comResumo = disponiveis.filter((m) => obterModulo(m.id)?.Resumo);
  const atalhos = disponiveis.filter((m) => !obterModulo(m.id)?.Resumo && m.id !== "inicio");
  const emBreve = modulos.filter((m) => !m.enabled && m.fase !== "legado");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-ink-muted">Boa rodada,</p>
        <h1 className="text-2xl font-bold">{perfil.nome.split(" ")[0]}</h1>
      </div>

      {comResumo.map((m) => {
        const Resumo = obterModulo(m.id)!.Resumo!;
        return <Resumo key={m.id} modulo={m} />;
      })}

      {atalhos.length > 0 && (
        <section>
          <SecaoTitulo titulo="Seus produtos" subtitulo="Tudo que a BMoto resolve para você" />
          <div className="grid grid-cols-2 gap-3">
            {atalhos.map((m) => (
              <Link key={m.id} to={rotaModulo(m.id)}
                    className="card flex flex-col gap-2 transition hover:border-mint/30">
                <Icone nome={m.icone} className="h-6 w-6 text-mint" />
                <span className="font-semibold leading-snug">{m.titulo}</span>
                <span className="text-xs leading-relaxed text-ink-faint">{m.descricao}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {emBreve.length > 0 && (
        <section>
          <SecaoTitulo titulo="Em breve" subtitulo="Produtos desligados no painel de administração" />
          <div className="flex flex-wrap gap-2">
            {emBreve.map((m) => (
              <Chip key={m.id} tom="off">
                <Icone nome={m.icone} className="h-3.5 w-3.5" />
                {m.titulo}
              </Chip>
            ))}
          </div>
        </section>
      )}

      {modoDemo && (
        <p className="text-xs leading-relaxed text-ink-faint">
          Modo demonstração: o app está rodando com dados locais porque não encontrou o backend.
          Suba o FastAPI (<code>uvicorn api:app</code>) e recarregue para ver os dados reais.
        </p>
      )}
    </div>
  );
}
