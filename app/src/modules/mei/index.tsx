/**
 * Módulo MEI — tela dedicada.
 *
 * Sem CNPJ, roda a jornada de abertura. Com CNPJ, mostra o DAS do mês, o
 * limite de faturamento e o calendário — a parte que tira o entregador da
 * inadimplência silenciosa.
 */

import { useEffect, useState } from "react";
import { Aviso, Card, Carregando, Chip, Icone, Metrica, SecaoTitulo } from "@/components/ui";
import { JornadaRunner } from "@/components/JornadaRunner";
import { api, comDemo } from "@/lib/api";
import { brl, data, pct } from "@/lib/format";
import { usePerfil } from "@/platform/PerfilProvider";
import type { ModuleDefinition, ModuleProps } from "@/platform/registry";

interface GuiaDas {
  competencia: string;
  valor: number;
  vencimento: string;
  codigo_barras: string;
  status: string;
}

/** Limite anual do MEI por ano-calendário (LC 238/2026). */
const LIMITE_POR_ANO: Record<number, number> = { 2026: 81_000, 2027: 110_000, 2028: 140_000 };

function competenciaAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function MeiTela({ modulo }: ModuleProps) {
  const { carteira, perfil } = usePerfil();
  const cnpj = carteira.mei?.cnpj ?? perfil.cnpjMei;

  if (!cnpj)
    return (
      <div className="space-y-4">
        <Aviso tom="info" titulo="Você ainda não tem MEI">
          Com CNPJ você emite nota, entra no plano de saúde empresarial e melhora sua análise de
          crédito. A BMoto abre e cuida do DAS todo mês.
        </Aviso>
        <JornadaRunner modulo={modulo} />
      </div>
    );

  return <MeiAtiva cnpj={cnpj} />;
}

function MeiAtiva({ cnpj }: { cnpj: string }) {
  const { carteira } = usePerfil();
  const [das, setDas] = useState<GuiaDas | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [copiado, setCopiado] = useState(false);
  const competencia = competenciaAtual();

  useEffect(() => {
    let cancelado = false;
    comDemo(
      () => api.get<GuiaDas>(`/platform/mei/${cnpj}/das/${competencia}`),
      () => ({ competencia, valor: 86.05,
               vencimento: proximoVencimento(competencia),
               codigo_barras: `858000000000${cnpj}${competencia.replace("-", "")}`,
               status: "ABERTA" }),
    )
      .then((d) => {
        if (!cancelado) setDas(d);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [cnpj, competencia]);

  const ano = new Date().getFullYear();
  const limite = LIMITE_POR_ANO[ano] ?? 81_000;
  const faturamentoAno = (carteira.renda_media ?? 0) * 12;
  const usoLimite = limite > 0 ? faturamentoAno / limite : 0;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="label">Seu CNPJ</p>
            <p className="mt-1 font-display text-xl font-bold">{formatarCnpj(cnpj)}</p>
            <p className="mt-1 text-xs text-ink-faint">
              CNAE {carteira.mei?.cnae ?? "5320-2/02"} · aberta em {data(carteira.mei?.aberto_em)}
            </p>
          </div>
          <Chip tom="on">ativa</Chip>
        </div>
      </Card>

      <Card>
        <SecaoTitulo titulo="DAS deste mês" subtitulo={`Competência ${competencia}`} />
        {carregando ? (
          <Carregando texto="Buscando a guia…" />
        ) : das ? (
          <>
            <div className="flex items-end justify-between">
              <p className="font-display text-3xl font-extrabold">{brl(das.valor)}</p>
              <Chip tom={das.status === "PAGA" ? "on" : "warn"}>
                {das.status === "PAGA" ? "pago" : `vence ${data(das.vencimento)}`}
              </Chip>
            </div>
            <button className="btn-primary mt-4 w-full"
                    onClick={() => {
                      void navigator.clipboard?.writeText(das.codigo_barras);
                      setCopiado(true);
                      window.setTimeout(() => setCopiado(false), 2000);
                    }}>
              <Icone nome={copiado ? "Check" : "Copy"} className="h-4 w-4" />
              {copiado ? "Código copiado" : "Copiar código de barras"}
            </button>
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              Pagar o DAS em dia é o que mantém o CNPJ ativo, conta a aposentadoria e segura o
              plano de saúde empresarial.
            </p>
          </>
        ) : (
          <Aviso tom="atencao">Não deu para buscar a guia agora. Tente de novo em instantes.</Aviso>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Metrica rotulo={`Limite ${ano}`} valor={brl(limite, 0)}
                 detalhe="faturamento anual permitido" />
        <Metrica rotulo="Seu ritmo" valor={pct(usoLimite, 0)}
                 tom={usoLimite > 0.85 ? "danger" : "normal"}
                 detalhe={`≈ ${brl(faturamentoAno, 0)} no ano`} />
      </div>

      {usoLimite > 0.85 && (
        <Aviso tom="atencao" titulo="Você está perto do limite do MEI">
          Passar do limite obriga a migrar para ME e muda sua tributação. A gente avisa antes e
          cuida da transição.
        </Aviso>
      )}

      <Card>
        <SecaoTitulo titulo="O que a BMoto faz por você" />
        <ul className="space-y-2 text-sm text-ink-muted">
          {[["CalendarCheck", "DAS gerado e lembrado todo mês"],
            ["FileText", "DASN anual enviada no prazo"],
            ["Receipt", "Nota fiscal quando o contratante pedir"],
            ["ShieldCheck", "CNPJ monitorado para não cair em inadimplência"]].map(([icone, texto]) => (
            <li key={texto} className="flex items-center gap-3">
              <Icone nome={icone} className="h-4 w-4 text-mint" />
              {texto}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function proximoVencimento(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const d = new Date(ano, mes, 20); // dia 20 do mês seguinte
  return d.toISOString().slice(0, 10);
}

function formatarCnpj(cnpj: string): string {
  const c = cnpj.replace(/\D/g, "").padStart(14, "0");
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export const moduloMei: ModuleDefinition = { id: "mei", Component: MeiTela };
