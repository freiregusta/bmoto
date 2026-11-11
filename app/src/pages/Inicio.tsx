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
  const { disponiveis, aguardandoFornecedor, carregando, semServidor } = usePlataforma();
  const { perfil } = usePerfil();

  if (carregando) return <Card><Carregando /></Card>;

  const comResumo = disponiveis.filter((m) => obterModulo(m.id)?.Resumo);
  const atalhos = disponiveis.filter((m) => !obterModulo(m.id)?.Resumo && m.id !== "inicio");
  const emBreve = aguardandoFornecedor.filter((m) => m.fase !== "legado");

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
          <SecaoTitulo titulo="O que já funciona"
                       subtitulo="Sobre os seus números, não sobre estimativa" />
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
          <SecaoTitulo titulo="Ainda não está no ar"
                       subtitulo="Depende de fornecedor contratado. Toque para ver o que falta." />
          <div className="space-y-2">
            {emBreve.map((m) => (
              <Link key={m.id} to={rotaModulo(m.id)}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[.03] p-3 transition hover:bg-white/[.06]">
                <Icone nome={m.icone} className="h-4 w-4 text-ink-faint" />
                <span className="flex-1 text-sm text-ink-muted">{m.titulo}</span>
                <Chip tom="off">em construção</Chip>
              </Link>
            ))}
          </div>
        </section>
      )}

      {semServidor && (
        <p className="text-xs leading-relaxed text-ink-faint">
          Sem conexão com o servidor. O que você lançou continua aqui no aparelho e sobe quando
          a conexão voltar; o que depende de fornecedor aparece como em construção.
        </p>
      )}
    </div>
  );
}
