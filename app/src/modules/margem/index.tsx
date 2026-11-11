/**
 * Módulo Margem líquida real — tela dedicada.
 *
 * Duas coisas que o entregador usa todo dia:
 *  1. quanto sobrou de verdade no período;
 *  2. se ESTA corrida que acabou de aparecer vale a pena.
 */

import { useMemo, useState } from "react";
import { Card, Campo, Chip, Icone, Metrica, SecaoTitulo } from "@/components/ui";
import { brl, numero, paraNumero, pct } from "@/lib/format";
import { usePerfil } from "@/platform/PerfilProvider";
import type { ModuleDefinition, ModuleProps } from "@/platform/registry";
import { PARAMETROS_PADRAO, avaliarCorrida, calcular, type Parametros, type Periodo }
  from "./calculo";

const CHAVE = "bmoto.margem.parametros";

function lerParametros(): Parametros {
  try {
    return { ...PARAMETROS_PADRAO, ...JSON.parse(localStorage.getItem(CHAVE) ?? "{}") };
  } catch {
    return PARAMETROS_PADRAO;
  }
}

const PERIODOS: Record<string, { rotulo: string; dias: number; fator: number }> = {
  dia: { rotulo: "Hoje", dias: 1, fator: 1 / 26 },
  semana: { rotulo: "Semana", dias: 7, fator: 6 / 26 },
  mes: { rotulo: "Mês", dias: 30, fator: 1 },
};

function MargemTela({ modulo }: ModuleProps) {
  const { carteira } = usePerfil();
  const [params, setParams] = useState<Parametros>(lerParametros);
  const [aba, setAba] = useState<"resultado" | "corrida" | "custos">("resultado");
  const [periodoId, setPeriodoId] = useState<keyof typeof PERIODOS>("mes");

  // Base mensal: usa a renda lida dos apps quando existe.
  const [bruto, setBruto] = useState(String(carteira.renda_media ?? 4030));
  const [km, setKm] = useState("1900");
  const [corridas, setCorridas] = useState("186");
  const [horas, setHoras] = useState("124");

  const salvar = (p: Parametros) => {
    setParams(p);
    try {
      localStorage.setItem(CHAVE, JSON.stringify(p));
    } catch {
      /* segue em memória */
    }
  };

  const periodo: Periodo = useMemo(() => {
    const cfg = PERIODOS[periodoId];
    return {
      bruto: paraNumero(bruto) * cfg.fator,
      km: paraNumero(km) * cfg.fator,
      corridas: Math.round(paraNumero(corridas) * cfg.fator),
      horas: paraNumero(horas) * cfg.fator,
      diasNoPeriodo: cfg.dias,
      diasNoMes: 30,
    };
  }, [bruto, km, corridas, horas, periodoId]);

  const res = useMemo(() => calcular(params, periodo), [params, periodo]);

  return (
    <div className="space-y-4">
      <nav className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/[.03] p-1">
        {([["resultado", "Resultado"], ["corrida", "Vale a pena?"], ["custos", "Seus custos"]] as const)
          .map(([id, rotulo]) => (
            <button key={id} onClick={() => setAba(id)} aria-pressed={aba === id}
                    className={`rounded-lg py-2 text-xs font-semibold transition ${
                      aba === id ? "bg-mint text-navy" : "text-ink-muted hover:text-ink"}`}>
              {rotulo}
            </button>
          ))}
      </nav>

      {aba === "resultado" && (
        <>
          <Card>
            <div className="mb-4 flex gap-1 rounded-xl border border-white/10 bg-white/[.03] p-1">
              {Object.entries(PERIODOS).map(([id, cfg]) => (
                <button key={id} onClick={() => setPeriodoId(id as keyof typeof PERIODOS)}
                        aria-pressed={periodoId === id}
                        className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
                          periodoId === id ? "bg-white/10 text-ink" : "text-ink-faint"}`}>
                  {cfg.rotulo}
                </button>
              ))}
            </div>
            <p className="label">Líquido real</p>
            <p className={`mt-1 font-display text-4xl font-extrabold ${
              res.liquido >= 0 ? "text-mint" : "text-danger"}`}>
              {brl(res.liquido)}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              de {brl(periodo.bruto)} brutos · margem {pct(res.margem, 1)}
            </p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              <div className="h-full bg-danger/70"
                   style={{ width: `${Math.min(res.comprometimento * 100, 100)}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-ink-faint">
              {pct(res.comprometimento, 0)} do que entra vai para custo
            </p>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <Metrica rotulo="Por km" valor={brl(res.liquidoPorKm)}
                     detalhe={`custo ${brl(res.custoPorKm, 2)}/km`} />
            <Metrica rotulo="Por hora" valor={brl(res.liquidoPorHora)}
                     detalhe={`${numero(periodo.horas)} h no período`} />
            <Metrica rotulo="Por corrida" valor={brl(res.liquidoPorCorrida)}
                     detalhe={`${numero(periodo.corridas)} corridas`} />
            <Metrica rotulo="Ponto de equilíbrio" valor={brl(res.pontoEquilibrio)}
                     detalhe="precisa faturar isto" tom="danger" />
          </div>

          <Card>
            <SecaoTitulo titulo="Para onde foi o dinheiro" />
            <ul className="space-y-2 text-sm">
              <Gasto rotulo="Combustível" valor={res.custoCombustivelKm * periodo.km}
                     total={res.custoTotal} />
              <Gasto rotulo="Manutenção (óleo, pneu, revisão)"
                     valor={res.custoManutencaoKm * periodo.km} total={res.custoTotal} />
              <Gasto rotulo="Depreciação da moto"
                     valor={res.custoDepreciacaoKm * periodo.km} total={res.custoTotal} />
              <Gasto rotulo="Fixos (DAS, parcela, seguro)" valor={res.custoFixoRateado}
                     total={res.custoTotal} />
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              A depreciação é o custo que ninguém sente no bolso hoje e aparece quando a moto
              precisa ser trocada. Ela entra aqui para o número ser honesto.
            </p>
          </Card>

          <Card className="space-y-3">
            <SecaoTitulo titulo="Seus números do período"
                         subtitulo="Ajuste e o cálculo acompanha" />
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Bruto no mês">
                <input className="input" inputMode="decimal" value={bruto}
                       onChange={(e) => setBruto(e.target.value)} />
              </Campo>
              <Campo rotulo="Km no mês">
                <input className="input" inputMode="decimal" value={km}
                       onChange={(e) => setKm(e.target.value)} />
              </Campo>
              <Campo rotulo="Corridas no mês">
                <input className="input" inputMode="numeric" value={corridas}
                       onChange={(e) => setCorridas(e.target.value)} />
              </Campo>
              <Campo rotulo="Horas no mês">
                <input className="input" inputMode="decimal" value={horas}
                       onChange={(e) => setHoras(e.target.value)} />
              </Campo>
            </div>
            {carteira.renda_media ? (
              <button className="btn-ghost btn-sm w-full"
                      onClick={() => setBruto(String(carteira.renda_media))}>
                <Icone nome="RefreshCw" className="h-3.5 w-3.5" />
                Usar a renda lida dos apps ({brl(carteira.renda_media)})
              </button>
            ) : null}
          </Card>
        </>
      )}

      {aba === "corrida" && <ValeAPena custoKm={res.custoPorKm} />}

      {aba === "custos" && <EditorCustos params={params} onSalvar={salvar} modulo={modulo} />}
    </div>
  );
}

function Gasto({ rotulo, valor, total }: { rotulo: string; valor: number; total: number }) {
  const parte = total > 0 ? Math.min((valor / total) * 100, 100) : 0;
  return (
    <li className="space-y-1">
      <div className="flex justify-between">
        <span className="text-ink-muted">{rotulo}</span>
        <span className="font-semibold">{brl(valor)}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div className="h-full rounded-full bg-mint/60" style={{ width: `${parte}%` }} />
      </div>
    </li>
  );
}

function ValeAPena({ custoKm }: { custoKm: number }) {
  const [oferta, setOferta] = useState("");
  const [distancia, setDistancia] = useState("");
  const r = useMemo(
    () => avaliarCorrida(paraNumero(oferta), paraNumero(distancia), custoKm),
    [oferta, distancia, custoKm],
  );
  const preenchido = paraNumero(oferta) > 0 && paraNumero(distancia) > 0;
  const tom = r.veredito === "Vale a pena" ? "on" : r.veredito === "No limite" ? "warn" : "danger";

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <SecaoTitulo titulo="Vale a pena?"
                     subtitulo="Digite a oferta e a distância antes de aceitar" />
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Oferta (R$)">
            <input className="input" inputMode="decimal" autoFocus placeholder="12,50"
                   value={oferta} onChange={(e) => setOferta(e.target.value)} />
          </Campo>
          <Campo rotulo="Distância (km)">
            <input className="input" inputMode="decimal" placeholder="7,2"
                   value={distancia} onChange={(e) => setDistancia(e.target.value)} />
          </Campo>
        </div>
      </Card>

      {preenchido && (
        <Card className="animate-fade-up text-center">
          <Chip tom={tom as any}>{r.veredito}</Chip>
          <p className={`mt-3 font-display text-4xl font-extrabold ${
            r.lucro > 0 ? "text-mint" : "text-danger"}`}>
            {brl(r.lucro)}
          </p>
          <p className="mt-1 text-sm text-ink-muted">sobra depois do custo da rodagem</p>
          <dl className="mt-5 grid grid-cols-3 gap-3 text-left text-sm">
            <div>
              <dt className="label">Oferta por km</dt>
              <dd className="mt-0.5 font-semibold">{brl(r.porKm)}</dd>
            </div>
            <div>
              <dt className="label">Seu custo</dt>
              <dd className="mt-0.5 font-semibold">{brl(r.custo)}</dd>
            </div>
            <div>
              <dt className="label">Custo por km</dt>
              <dd className="mt-0.5 font-semibold">{brl(custoKm, 2)}</dd>
            </div>
          </dl>
        </Card>
      )}
    </div>
  );
}

function EditorCustos({ params, onSalvar }: {
  params: Parametros; onSalvar: (p: Parametros) => void; modulo: ModuleProps["modulo"];
}) {
  const [p, setP] = useState(params);
  const d = (chave: keyof Parametros, valor: string) =>
    setP((atual) => ({ ...atual, [chave]: paraNumero(valor) }));
  const campos: Array<[keyof Parametros, string, string]> = [
    ["consumo", "Consumo (km/l)", "Quantos km sua moto faz com 1 litro"],
    ["precoCombustivel", "Preço do litro (R$)", ""],
    ["custoOleo", "Troca de óleo (R$)", ""],
    ["kmTrocaOleo", "A cada quantos km troca o óleo", ""],
    ["custoPneus", "Par de pneus (R$)", ""],
    ["kmPneus", "Duração dos pneus (km)", ""],
    ["custoRevisao", "Revisão (R$)", ""],
    ["kmRevisao", "Intervalo da revisão (km)", ""],
    ["valorMoto", "Valor da moto (R$)", "Base da depreciação"],
    ["vidaUtilKm", "Vida útil da moto (km)", "Quanto ela roda até precisar ser trocada"],
    ["dasMei", "DAS da MEI (R$/mês)", ""],
    ["parcelaMoto", "Parcela da moto (R$/mês)", ""],
    ["seguro", "Seguro (R$/mês)", ""],
    ["outrosFixos", "Outros fixos (R$/mês)", "Celular, suporte, bag, aluguel de garagem"],
  ];

  return (
    <Card className="space-y-4">
      <SecaoTitulo titulo="Seus custos"
                   subtitulo="Quanto mais verdadeiro aqui, mais honesta a margem" />
      <div className="grid grid-cols-2 gap-3">
        {campos.map(([chave, rotulo, ajuda]) => (
          <Campo key={chave} rotulo={rotulo} ajuda={ajuda}>
            <input className="input" inputMode="decimal" value={String(p[chave])}
                   onChange={(e) => d(chave, e.target.value)} />
          </Campo>
        ))}
      </div>
      <button className="btn-primary w-full" onClick={() => onSalvar(p)}>Salvar meus custos</button>
    </Card>
  );
}

function MargemResumo({ modulo }: ModuleProps) {
  const { carteira } = usePerfil();
  const params = lerParametros();
  const res = calcular(params, {
    bruto: carteira.renda_media ?? 4030, km: 1900, corridas: 186, horas: 124,
    diasNoPeriodo: 30, diasNoMes: 30,
  });
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label">Líquido real no mês</p>
          <p className={`mt-1 font-display text-3xl font-extrabold ${
            res.liquido >= 0 ? "text-mint" : "text-danger"}`}>
            {brl(res.liquido)}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            custo {brl(res.custoPorKm, 2)}/km · margem {pct(res.margem, 0)}
          </p>
        </div>
        <a href={modulo.rota} className="btn-ghost btn-sm">
          Abrir
          <Icone nome="ArrowRight" className="h-3.5 w-3.5" />
        </a>
      </div>
    </Card>
  );
}

export const moduloMargem: ModuleDefinition = {
  id: "margem",
  Component: MargemTela,
  Resumo: MargemResumo,
};
