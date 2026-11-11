/**
 * Indisponivel — a tela de um produto que ainda não existe.
 *
 * Em vez de simular conta, cartão ou apólice, diz a verdade: o que falta no
 * mundo real para aquilo funcionar, o que já dá para fazer hoje, e oferece
 * entrar na fila — que é uma lista de verdade, gravada no servidor.
 */

import { useState } from "react";
import { Aviso, Card, Icone, SecaoTitulo } from "./ui";
import { api } from "@/lib/api";
import { usePerfil } from "@/platform/PerfilProvider";
import { DEPENDENCIA } from "@/platform/catalogo-local";
import type { Modulo, PortId } from "@/platform/types";
import { rotaModulo } from "@/rotas";

/** O que já é real hoje e substitui, em parte, o produto que falta. */
const ENQUANTO_ISSO: Record<string, { texto: string; modulo?: string; rotulo?: string }> = {
  conta: { texto: "Lance seus ganhos e acompanhe quanto sobra de verdade — é o mesmo "
                  + "histórico que vai destravar a conta e o crédito depois.",
           modulo: "ganhos", rotulo: "Lançar meus ganhos" },
  mei: { texto: "O DAS de transporte em 2026 é R$ 86,05 por mês. Coloque esse valor nos seus "
                + "custos fixos para a margem já considerá-lo.",
         modulo: "margem", rotulo: "Incluir nos meus custos" },
  moto: { texto: "Simule quanto caberia na sua renda antes de o financiamento existir.",
          modulo: "credito", rotulo: "Simular" },
  cartao: { texto: "Simule o limite que a sua moto sustentaria como garantia.",
            modulo: "credito", rotulo: "Simular" },
  seguro: { texto: "Enquanto não há apólice, mantenha o custo do seguro nos seus fixos para "
                   + "não subestimar a margem.",
            modulo: "margem", rotulo: "Ajustar meus custos" },
  saude: { texto: "O plano coletivo pela MEI exige CNPJ ativo há 6 meses — o relógio começa "
                  + "quando a MEI abre." },
};

export function Indisponivel({ modulo }: { modulo: Modulo }) {
  const { perfil } = usePerfil();
  const [estado, setEstado] = useState<"idle" | "enviando" | "ok" | "erro">("idle");
  const enquanto = ENQUANTO_ISSO[modulo.id];

  const portsFaltando: PortId[] = modulo.requisitos
    .filter((r) => !modulo.providers[r.port])
    .map((r) => r.port);

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-white/[.06] p-3">
            <Icone nome={modulo.icone} className="h-6 w-6 text-ink-muted" />
          </div>
          <div>
            <p className="font-semibold">{modulo.titulo} ainda não está no ar</p>
            <p className="mt-1 text-sm text-ink-muted">{modulo.descricao}</p>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-navy-500/40 p-4">
          <p className="label">O que falta para existir</p>
          <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
            {(portsFaltando.length ? portsFaltando : (["conta"] as PortId[])).map((port) => (
              <li key={port} className="flex gap-2">
                <Icone nome="Circle" className="mt-1.5 h-1.5 w-1.5 shrink-0 text-ink-faint" />
                {DEPENDENCIA[port]}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            Preferimos dizer isto a mostrar um saldo que não existe.
          </p>
        </div>

        {enquanto && (
          <Aviso tom="info" titulo="O que dá para fazer agora">
            {enquanto.texto}
            {enquanto.modulo && (
              <a href={rotaModulo(enquanto.modulo)}
                 className="btn-ghost btn-sm mt-3 w-full">
                {enquanto.rotulo}
              </a>
            )}
          </Aviso>
        )}
      </Card>

      <Card className="space-y-3">
        <SecaoTitulo titulo="Quer ser avisado?"
                     subtitulo="A gente chama quando entrar no ar" />
        {estado === "ok" ? (
          <Aviso tom="ok">Anotado. Você está na fila de {modulo.titulo}.</Aviso>
        ) : (
          <>
            <button className="btn-primary w-full" disabled={estado === "enviando"}
                    onClick={async () => {
                      setEstado("enviando");
                      try {
                        await api.post("/me/interesse", {
                          cpf: perfil.cpf, produto: modulo.id, celular: perfil.celular,
                        });
                        setEstado("ok");
                      } catch {
                        setEstado("erro");
                      }
                    }}>
              {estado === "enviando" ? "Anotando…" : "Me avise quando chegar"}
            </button>
            {estado === "erro" && (
              <Aviso tom="erro">
                Não deu para registrar agora — o servidor não respondeu. Tente de novo mais
                tarde.
              </Aviso>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
