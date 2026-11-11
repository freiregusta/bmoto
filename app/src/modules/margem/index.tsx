/**
 * Margem líquida real — o que sobra depois do custo de rodar.
 *
 * Tudo aqui sai de dois dados reais: o que o entregador lançou em Ganhos e os
 * custos que ele informou. Sem lançamento, não há margem — e a tela diz isso,
 * em vez de mostrar um número bonito que não é de ninguém.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Aviso, Campo, Card, Carregando, Chip, Icone, Metrica, SecaoTitulo, Vazio }
  from "@/components/ui";
import { brl, numero, paraNumero, pct } from "@/lib/format";
import { usePerfil } from "@/platform/PerfilProvider";
import {
  CUSTOS_VAZIOS, custosInformados, custosLocais, resumo as carregarResumo, salvarCustos,
  type Custos, type Resumo,
} from "@/platform/meusDados";
import type { ModuleDefinition, ModuleProps } from "@/platform/registry";
import { rotaModulo } from "@/rotas";
import { avaliarCorrida } from "./calculo";

type Aba = "resultado" | "corrida" | "custos";

function MargemTela(_: ModuleProps) {
  const { perfil } = usePerfil();
  const [aba, setAba] = useState<Aba>("resultado");
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [custos, setCustos] = useState<Custos>(custosLocais);
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setCustos(custosLocais());
    setResumo(await carregarResumo(perfil.cpf, 6));
    setCarregando(false);
  }, [perfil.cpf]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  if (carregando && !resumo) return <Card><Carregando /></Card>;

  const temCustos = custosInformados(custos);
  const custoKm = resumo?.margem?.custo_por_km.total ?? 0;

  return (
    <div className="space-y-4">
      <nav className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/[.03] p-1">
        {([["resultado", "Resultado"], ["corrida", "Vale a pena?"],
           ["custos", "Meus custos"]] as const).map(([id, rotulo]) => (
          <button key={id} onClick={() => setAba(id)} aria-pressed={aba === id}
                  className={`rounded-lg py-2 text-xs font-semibold transition ${
                    aba === id ? "bg-mint text-navy" : "text-ink-muted hover:text-ink"}`}>
            {rotulo}
          </button>
        ))}
      </nav>

      {aba === "resultado" && <Resultado resumo={resumo} temCustos={temCustos}
                                         onIrParaCustos={() => setAba("custos")} />}

      {aba === "corrida" && (
        temCustos
          ? <ValeAPena custoKm={custoKm} />
          : <Vazio icone="Calculator" titulo="Informe seus custos primeiro"
                   acao={<button className="btn-primary btn-sm mt-2"
                                 onClick={() => setAba("custos")}>Informar custos</button>}>
              Sem saber quanto custa o seu quilômetro, dizer se uma corrida vale a pena seria
              chute. São dois campos para começar: consumo da moto e preço do litro.
            </Vazio>
      )}

      {aba === "custos" && (
        <EditorCustos
          inicial={custos}
          onSalvar={async (c) => {
            await salvarCustos(perfil.cpf, c);
            await recarregar();
            setAba("resultado");
          }}
        />
      )}
    </div>
  );
}

function Resultado({ resumo, temCustos, onIrParaCustos }: {
  resumo: Resumo | null; temCustos: boolean; onIrParaCustos: () => void;
}) {
  if (!resumo?.tem_dados)
    return (
      <Vazio icone="TrendingUp" titulo="Lance seus ganhos primeiro"
             acao={<a href={rotaModulo("ganhos")} className="btn-primary btn-sm mt-2">
               Lançar ganhos</a>}>
        A margem é o que sobra do que você recebeu. Sem o que entrou, não há o que calcular.
      </Vazio>
    );

  if (!temCustos || !resumo.margem)
    return (
      <div className="space-y-4">
        <Card>
          <p className="label">Você recebeu (bruto)</p>
          <p className="mt-1 font-display text-3xl font-extrabold">
            {brl(resumo.bruto_total)}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            em {resumo.meses_lancados} {resumo.meses_lancados === 1 ? "mês" : "meses"} ·{" "}
            {numero(resumo.km_total, 0)} km
          </p>
        </Card>
        <Vazio icone="Calculator" titulo="Falta quanto custa rodar"
               acao={<button className="btn-primary btn-sm mt-2" onClick={onIrParaCustos}>
                 Informar meus custos</button>}>
          Combustível, óleo, pneu, revisão e a depreciação da moto. Com isso a gente mostra
          quanto de verdade ficou no seu bolso.
        </Vazio>
      </div>
    );

  const m = resumo.margem;
  const meses = resumo.meses_lancados;

  return (
    <>
      <Card>
        <p className="label">Sobrou de verdade</p>
        <p className={`mt-1 font-display text-4xl font-extrabold ${
          m.liquido_total >= 0 ? "text-mint" : "text-danger"}`}>
          {brl(m.liquido_total)}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          de {brl(resumo.bruto_total)} brutos em {meses} {meses === 1 ? "mês" : "meses"} ·
          margem {pct(m.margem, 1)}
        </p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div className="h-full bg-danger/70"
               style={{ width: `${Math.min((m.custo_total / (resumo.bruto_total || 1)) * 100, 100)}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-ink-faint">
          {pct(m.custo_total / (resumo.bruto_total || 1), 0)} do que entrou foi para custo
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Metrica rotulo="Por km" valor={brl(m.liquido_por_km ?? 0)}
                 detalhe={`custo ${brl(m.custo_por_km.total, 2)}/km`} />
        <Metrica rotulo="Por hora" valor={brl(m.liquido_por_hora ?? 0)}
                 detalhe={resumo.horas_total ? `${numero(resumo.horas_total, 0)} h lançadas`
                                             : "lance suas horas"} />
        <Metrica rotulo="Por corrida" valor={brl(m.liquido_por_corrida ?? 0)}
                 detalhe={`${numero(resumo.corridas_total)} corridas`} />
        <Metrica rotulo="Precisa faturar" valor={brl(m.ponto_equilibrio_mensal)}
                 detalhe="por mês, só para empatar" tom="danger" />
      </div>

      <Card>
        <SecaoTitulo titulo="Para onde foi o dinheiro" />
        <ul className="space-y-2 text-sm">
          <Gasto rotulo="Combustível"
                 valor={m.custo_por_km.combustivel * (resumo.km_total ?? 0)}
                 total={m.custo_total} />
          <Gasto rotulo="Manutenção (óleo, pneu, revisão)"
                 valor={m.custo_por_km.manutencao * (resumo.km_total ?? 0)}
                 total={m.custo_total} />
          <Gasto rotulo="Depreciação da moto"
                 valor={m.custo_por_km.depreciacao * (resumo.km_total ?? 0)}
                 total={m.custo_total} />
          <Gasto rotulo="Fixos (DAS, parcela, seguro)" valor={m.custo_fixo}
                 total={m.custo_total} />
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-ink-faint">
          A depreciação é o custo que não dói hoje e aparece quando a moto precisa ser
          trocada. Entra aqui para o número ser honesto.
        </p>
      </Card>
    </>
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
                     subtitulo={`Seu custo hoje é ${brl(custoKm, 2)} por km`} />
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

const CAMPOS: Array<[keyof Custos, string, string]> = [
  ["consumo_km_l", "Consumo (km/l)", "Quantos km sua moto faz com 1 litro"],
  ["preco_combustivel", "Preço do litro (R$)", ""],
  ["custo_oleo", "Troca de óleo (R$)", ""],
  ["km_troca_oleo", "A cada quantos km troca o óleo", ""],
  ["custo_pneus", "Par de pneus (R$)", ""],
  ["km_pneus", "Duração dos pneus (km)", ""],
  ["custo_revisao", "Revisão (R$)", ""],
  ["km_revisao", "Intervalo da revisão (km)", ""],
  ["valor_moto", "Valor da moto (R$)", "Base da depreciação"],
  ["vida_util_km", "Vida útil da moto (km)", "Quanto ela roda até precisar ser trocada"],
  ["das_mei", "DAS da MEI (R$/mês)", "Em 2026, R$ 86,05 para transporte"],
  ["parcela_moto", "Parcela da moto (R$/mês)", ""],
  ["seguro", "Seguro (R$/mês)", ""],
  ["outros_fixos", "Outros fixos (R$/mês)", "Celular, bag, aluguel de garagem"],
];

function EditorCustos({ inicial, onSalvar }: {
  inicial: Custos; onSalvar: (c: Custos) => void | Promise<void>;
}) {
  const [c, setC] = useState<Custos>({ ...CUSTOS_VAZIOS, ...inicial });
  const [salvando, setSalvando] = useState(false);
  const faltaEssencial = !custosInformados(c);

  return (
    <Card className="space-y-4">
      <SecaoTitulo titulo="Meus custos"
                   subtitulo="Os seus números, não uma média de mercado" />
      {faltaEssencial && (
        <Aviso tom="info">
          Consumo e preço do litro são o mínimo para calcular o custo por km. O resto refina.
        </Aviso>
      )}
      <div className="grid grid-cols-2 gap-3">
        {CAMPOS.map(([chave, rotulo, ajuda]) => (
          <Campo key={chave} rotulo={rotulo} ajuda={ajuda}
                 obrigatorio={chave === "consumo_km_l" || chave === "preco_combustivel"}>
            <input className="input" inputMode="decimal"
                   value={c[chave] === 0 ? "" : String(c[chave])} placeholder="0"
                   onChange={(e) => setC({ ...c, [chave]: paraNumero(e.target.value) })} />
          </Campo>
        ))}
      </div>
      <button className="btn-primary w-full" disabled={salvando}
              onClick={async () => {
                setSalvando(true);
                await onSalvar(c);
                setSalvando(false);
              }}>
        {salvando ? "Salvando…" : "Salvar meus custos"}
      </button>
    </Card>
  );
}

function MargemResumo({ modulo }: ModuleProps) {
  const { perfil } = usePerfil();
  const [r, setR] = useState<Resumo | null>(null);
  useEffect(() => {
    let vivo = true;
    void carregarResumo(perfil.cpf, 3).then((x) => vivo && setR(x));
    return () => { vivo = false; };
  }, [perfil.cpf]);

  if (!r?.tem_dados || !r.margem) return null;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label">Líquido real</p>
          <p className={`mt-1 font-display text-3xl font-extrabold ${
            r.margem.liquido_total >= 0 ? "text-mint" : "text-danger"}`}>
            {brl(r.margem.liquido_medio_mensal)}
            <span className="ml-1 text-sm font-semibold text-ink-muted">/mês</span>
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            custo {brl(r.margem.custo_por_km.total, 2)}/km · margem {pct(r.margem.margem, 0)}
          </p>
        </div>
        <a href={rotaModulo(modulo.id)} className="btn-ghost btn-sm">
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
