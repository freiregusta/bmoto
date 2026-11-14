/**
 * JornadaRunner — a tela genérica de qualquer produto.
 *
 * Um módulo sem tela dedicada usa isto e funciona por completo: título,
 * progresso, passo atual, recusa, mesa e entregáveis. É o que permite ligar um
 * produto novo no admin e já vendê-lo no app.
 */

import { useEffect } from "react";
import { Aviso, Card, Carregando, Progresso, Vazio } from "./ui";
import { Entregaveis, PassoRenderer } from "./PassoRenderer";
import { useJornada } from "@/platform/useJornada";
import { usePerfil } from "@/platform/PerfilProvider";
import type { Modulo } from "@/platform/types";

const MOTIVOS: Record<string, string> = {
  score_abaixo_do_minimo: "o histórico de crédito ainda não atende a política",
  renda_abaixo_do_minimo: "a renda média dos apps ficou abaixo do mínimo",
  renda_insuficiente: "a renda média dos apps ficou abaixo do mínimo",
  idade_fora_da_politica: "a idade está fora da faixa aceita",
  exige_mei_ativa: "este produto pede MEI ativa",
  kyc_reprovado: "não conseguimos confirmar sua identidade",
  historico_de_renda_insuficiente: "precisamos de mais meses de histórico nos apps",
  garantia_obrigatoria: "este produto exige uma garantia",
  abaixo_do_ticket_minimo: "o valor aprovado ficou abaixo do mínimo do produto",
  produto_inativo: "o produto está desativado no momento",
};

export function JornadaRunner({ modulo, onConcluir }: {
  modulo: Modulo;
  /** Chamado quando a jornada conclui, com o contexto final. */
  onConcluir?: (contexto: Record<string, any>) => void;
}) {
  const { perfil, registrarEntregaveis } = usePerfil();
  const j = useJornada(modulo.id, perfil.cpf);

  // Inicia sozinha: o entregador abriu o módulo para contratar, não para clicar em "começar".
  useEffect(() => {
    if (j.jornada && !j.estado && !j.enviando) {
      void j.iniciar({ nome: perfil.nome, nascimento: perfil.nascimento,
                       celular: perfil.celular, email: perfil.email,
                       cnpj_mei: perfil.cnpjMei });
    }
  }, [j.jornada, j.estado, j.enviando]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jornada concluída: guarda o que ela criou (conta, CNPJ, apólice, contrato).
  useEffect(() => {
    if (j.estado?.status === "CONCLUIDA") {
      registrarEntregaveis(j.estado.contexto ?? {});
      onConcluir?.(j.estado.contexto ?? {});
    }
  }, [j.estado?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (j.carregando) return <Card><Carregando texto="Carregando a jornada…" /></Card>;

  if (!j.jornada)
    return (
      <Vazio icone="Route" titulo="Nenhuma jornada configurada">
        O módulo <strong>{modulo.titulo}</strong> está ligado, mas ninguém montou a jornada dele
        ainda. Monte em Admin → Jornadas e ela aparece aqui na hora.
      </Vazio>
    );

  if (j.erro && !j.estado) return <Aviso tom="erro" titulo="Não deu para começar">{j.erro}</Aviso>;
  if (!j.estado) return <Card><Carregando texto="Preparando…" /></Card>;

  const { estado } = j;
  const recusas: string[] = estado.contexto?.oferta?.recusas ?? [];
  const falha = j.ultimaFalha;

  return (
    <div className="space-y-4">
      <Card>
        <Progresso atual={estado.progresso.concluidos} total={estado.progresso.total} />
      </Card>

      {estado.status === "EM_ANDAMENTO" && estado.passo_atual && (
        <Card className="animate-fade-up">
          <h3 className="text-base font-bold">{estado.passo_atual.titulo}</h3>
          {estado.passo_atual.descricao && (
            <p className="mt-1 text-sm text-ink-muted">{estado.passo_atual.descricao}</p>
          )}
          <div className="mt-4">
            <PassoRenderer passo={estado.passo_atual} estado={estado} enviando={j.enviando}
                           falha={falha} onResponder={(r) => void j.avancar(r)} />
          </div>
        </Card>
      )}

      {estado.status === "CONCLUIDA" && (
        <Card className="space-y-4">
          <Aviso tom="ok" titulo="Tudo pronto">
            {estado.jornada.nome} concluída. O que foi criado já está na sua conta.
          </Aviso>
          <Entregaveis ctx={estado.contexto} />
        </Card>
      )}

      {estado.status === "RECUSADA" && (
        <Card className="space-y-4">
          <Aviso tom="erro" titulo="Não deu agora">
            {recusas.length || falha?.erro ? (
              <>
                Motivo:{" "}
                {(recusas.length ? recusas : [falha?.erro])
                  .map((m) => MOTIVOS[String(m)] ?? String(m))
                  .join("; ")}
                .
              </>
            ) : (
              "Não foi possível seguir com este pedido agora."
            )}
          </Aviso>
          <p className="text-sm text-ink-muted">
            Conectar mais apps de entrega e manter o histórico em dia costuma melhorar a análise
            em poucas semanas.
          </p>
          <button className="btn-ghost w-full" onClick={j.reiniciar}>Tentar de novo</button>
        </Card>
      )}

      {estado.status === "PENDENTE_MESA" && (
        <Card>
          <Aviso tom="atencao" titulo="Em análise na nossa mesa">
            Um analista vai olhar seu caso. Você recebe a resposta pelo app, normalmente no mesmo
            dia útil.
          </Aviso>
        </Card>
      )}

      {j.erro && <Aviso tom="erro">{j.erro}</Aviso>}
    </div>
  );
}
