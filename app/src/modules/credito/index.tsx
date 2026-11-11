/**
 * Simulação de crédito — a conta real sobre a renda real.
 *
 * O que é verdadeiro aqui: a política do produto (taxa, prazo, ticket, LTV,
 * comprometimento máximo) e a renda que o entregador lançou. A conta é a
 * mesma que vai rodar no dia da proposta.
 *
 * O que ainda NÃO é: a aprovação. Não há bureau contratado nem emissor, então
 * a tela nunca diz "aprovado" — diz quanto caberia no bolso e lista o que
 * falta para virar oferta de verdade.
 */

import { useCallback, useEffect, useState } from "react";
import { Aviso, Campo, Card, Carregando, Chip, Icone, SecaoTitulo, Vazio } from "@/components/ui";
import { api, comFallback } from "@/lib/api";
import { brl, paraNumero, pct } from "@/lib/format";
import { usePerfil } from "@/platform/PerfilProvider";
import { rendaParaCredito, resumo as carregarResumo, type Resumo } from "@/platform/meusDados";
import type { ModuleDefinition, ModuleProps } from "@/platform/registry";
import type { ProdutoCredito } from "@/platform/types";
import { rotaModulo } from "@/rotas";

interface Simulacao {
  produto: string;
  tipo: string;
  simulacao: boolean;
  cabe_no_bolso: boolean;
  score_avaliado: boolean;
  recusas: string[];
  limite: number;
  principal: number;
  parcelas: number;
  parcela: number;
  taxa_mensal: number;
  cet_anual: number;
  comprometimento: number;
  garantia?: { tipo: string | null; valor: number; ltv_max: number } | null;
  renda_considerada: { renda_media: number; meses_renda: number; fonte: string };
  pendencias_para_virar_oferta: string[];
}

const MOTIVOS: Record<string, string> = {
  renda_abaixo_do_minimo: "a renda lançada está abaixo do mínimo deste produto",
  historico_de_renda_insuficiente: "faltam meses de histórico lançado",
  garantia_obrigatoria: "este produto exige uma garantia",
  abaixo_do_ticket_minimo: "o valor que caberia fica abaixo do mínimo do produto",
  exige_mei_ativa: "este produto exige MEI ativa",
  produto_inativo: "o produto está desativado",
  idade_fora_da_politica: "a idade está fora da faixa da política",
};

function CreditoTela(_: ModuleProps) {
  const { perfil } = usePerfil();
  const [produtos, setProdutos] = useState<ProdutoCredito[] | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [semServidor, setSemServidor] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setResumo(await carregarResumo(perfil.cpf, 6));
    let offline = false;
    const d = await comFallback(
      () => api.get<{ produtos: ProdutoCredito[] }>("/admin/produtos-credito"),
      () => {
        offline = true;
        return { produtos: [] as ProdutoCredito[] };
      },
    ).catch(() => {
      offline = true;
      return { produtos: [] as ProdutoCredito[] };
    });
    setSemServidor(offline);
    setProdutos(d.produtos.filter((p) => p.ativo));
    setCarregando(false);
  }, [perfil.cpf]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (carregando) return <Card><Carregando /></Card>;

  const renda = resumo ? rendaParaCredito(resumo) : { valor: 0, fonte: "nenhuma", meses: 0 };

  if (renda.meses === 0)
    return (
      <Vazio icone="Banknote" titulo="Simule com a sua renda, não com um chute"
             acao={<a href={rotaModulo("ganhos")} className="btn-primary btn-sm mt-2">
               Lançar meus ganhos</a>}>
        Lance o que você recebeu nos últimos meses e a simulação usa esse número — o mesmo que
        entraria numa análise de crédito de verdade.
      </Vazio>
    );

  if (semServidor || !produtos?.length)
    return (
      <Aviso tom="atencao" titulo="Simulação indisponível sem o servidor">
        As regras de cada produto (taxa, prazo, limite) ficam no servidor, e ele não respondeu.
        Preferimos não simular a simular com número errado.
      </Aviso>
    );

  return (
    <div className="space-y-4">
      <Card>
        <p className="label">Renda considerada</p>
        <p className="mt-1 font-display text-3xl font-extrabold text-mint">{brl(renda.valor)}</p>
        <p className="mt-1 text-sm text-ink-muted">
          {renda.fonte} · {renda.meses} {renda.meses === 1 ? "mês" : "meses"}
        </p>
      </Card>

      {produtos.map((p) => (
        <ProdutoSimulavel key={p.id} produto={p} cpf={perfil.cpf} />
      ))}

      <Card>
        <SecaoTitulo titulo="Por que não é uma oferta" />
        <p className="text-sm leading-relaxed text-ink-muted">
          A conta é real: taxa, prazo, limite por garantia e o teto de comprometimento da sua
          renda. O que falta para virar proposta é análise de crédito em bureau contratado,
          verificação de identidade e o emissor que assina o contrato.
        </p>
      </Card>
    </div>
  );
}

function ProdutoSimulavel({ produto, cpf }: { produto: ProdutoCredito; cpf: string }) {
  const [aberto, setAberto] = useState(false);
  const [garantia, setGarantia] = useState("");
  const [prazo, setPrazo] = useState(String(produto.prazo_max));
  const [r, setR] = useState<Simulacao | null>(null);
  const [erro, setErro] = useState("");
  const [rodando, setRodando] = useState(false);
  const exigeGarantia = Boolean(produto.garantia_tipo && produto.garantia_tipo !== "nenhuma");

  const simular = async () => {
    setRodando(true);
    setErro("");
    try {
      setR(await api.post<Simulacao>(`/me/simular/${produto.id}`, {
        cpf, parcelas: Number(prazo) || null,
        valor_garantia: paraNumero(garantia),
      }));
    } catch (e: any) {
      const detalhe = e?.corpo?.detail ?? e?.message;
      setErro(typeof detalhe === "string" ? detalhe
              : detalhe?.mensagem ?? "não deu para simular agora");
    } finally {
      setRodando(false);
    }
  };

  return (
    <Card className="space-y-3">
      <button className="flex w-full items-center justify-between gap-3 text-left"
              onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        <div>
          <p className="font-semibold">{produto.nome}</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {pct(produto.taxa_mensal)} a.m. · {produto.prazo_min} a {produto.prazo_max}x ·
            até {brl(produto.ticket_max, 0)}
          </p>
        </div>
        <Icone nome={aberto ? "ChevronUp" : "ChevronDown"} className="h-4 w-4 text-ink-faint" />
      </button>

      {aberto && (
        <div className="space-y-3 border-t border-white/8 pt-3">
          {exigeGarantia && (
            <Campo rotulo={`Valor da ${produto.garantia_tipo === "moto" ? "moto" : "garantia"}`}
                   obrigatorio ajuda={`Empresta até ${pct(produto.ltv_max, 0)} desse valor`}>
              <input className="input" inputMode="decimal" value={garantia}
                     onChange={(e) => setGarantia(e.target.value)} placeholder="0,00" />
            </Campo>
          )}
          <Campo rotulo="Em quantas vezes">
            <select className="input" value={prazo} onChange={(e) => setPrazo(e.target.value)}>
              {prazosDe(produto).map((n) => (
                <option key={n} value={n}>{n}x</option>
              ))}
            </select>
          </Campo>
          <button className="btn-primary w-full" disabled={rodando} onClick={() => void simular()}>
            {rodando ? "Calculando…" : "Simular"}
          </button>

          {erro && <Aviso tom="erro">{erro}</Aviso>}

          {r && (
            <div className={`rounded-xl border p-4 ${
              r.cabe_no_bolso ? "border-mint/30 bg-mint/[.07]" : "border-warn/30 bg-warn/[.07]"}`}>
              <div className="flex items-start justify-between gap-2">
                <Chip tom={r.cabe_no_bolso ? "on" : "warn"}>
                  {r.cabe_no_bolso ? "caberia no seu bolso" : "não fecha hoje"}
                </Chip>
                <Chip>simulação</Chip>
              </div>

              {r.cabe_no_bolso ? (
                <>
                  <p className="mt-3 font-display text-3xl font-extrabold text-mint">
                    {r.parcelas}x de {brl(r.parcela)}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {brl(r.principal)} · CET {pct(r.cet_anual, 1)} a.a. ·{" "}
                    {pct(r.comprometimento, 1)} da sua renda
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-ink-muted">
                  {r.recusas.map((m) => MOTIVOS[m] ?? m).join("; ")}.
                </p>
              )}

              <ul className="mt-4 space-y-1 border-t border-white/10 pt-3 text-xs text-ink-faint">
                <li className="font-semibold text-ink-muted">Para virar oferta, falta:</li>
                {r.pendencias_para_virar_oferta.map((p) => (
                  <li key={p} className="flex gap-2">
                    <Icone nome="Circle" className="mt-1.5 h-1 w-1 shrink-0" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function prazosDe(p: ProdutoCredito): number[] {
  const passo = p.prazo_max > 24 ? 12 : 6;
  const out: number[] = [];
  for (let n = p.prazo_min; n <= p.prazo_max; n += passo) out.push(n);
  if (out[out.length - 1] !== p.prazo_max) out.push(p.prazo_max);
  return out;
}

export const moduloCredito: ModuleDefinition = { id: "credito", Component: CreditoTela };
