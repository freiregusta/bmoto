/**
 * Meus ganhos — o dado real, lançado pelo entregador.
 *
 * Por que lançar à mão: não existe API pública de ganhos no iFood, Rappi ou
 * 99 para terceiros. O caminho regulado é Open Finance — ler, com
 * consentimento, os repasses que caem na conta dele. Enquanto esse conector
 * não está no ar, o número verdadeiro é o do extrato semanal que a plataforma
 * já manda, digitado aqui. Nada é estimado.
 */

import { useCallback, useEffect, useState } from "react";
import { Aviso, Campo, Card, Carregando, Chip, Icone, Metrica, SecaoTitulo, Vazio }
  from "@/components/ui";
import { brl, numero, paraNumero } from "@/lib/format";
import { APPS_CONHECIDOS } from "@/platform/catalogo-local";
import { usePerfil } from "@/platform/PerfilProvider";
import {
  apagarLancamento, competenciaAtual, competenciasRecentes, lancamentosLocais, lancar,
  resumo as carregarResumo, rotuloCompetencia, type Lancamento, type Resumo,
} from "@/platform/meusDados";
import type { ModuleDefinition, ModuleProps } from "@/platform/registry";
import { rotaModulo } from "@/rotas";

function GanhosTela(_: ModuleProps) {
  const { perfil } = usePerfil();
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [lancando, setLancando] = useState(false);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setLancamentos([...lancamentosLocais()].sort((a, b) =>
      b.competencia.localeCompare(a.competencia)));
    setResumo(await carregarResumo(perfil.cpf, 6));
    setCarregando(false);
  }, [perfil.cpf]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  if (carregando && !resumo) return <Card><Carregando /></Card>;

  return (
    <div className="space-y-4">
      {resumo?.sincronizado === false && (
        <Aviso tom="atencao" titulo="Salvo só neste aparelho">
          O servidor não respondeu. Seus lançamentos ficam aqui e sobem assim que a conexão
          voltar.
        </Aviso>
      )}

      {resumo?.tem_dados ? (
        <>
          <Card>
            <p className="label">Você recebeu, nos últimos {resumo.meses_lancados}{" "}
              {resumo.meses_lancados === 1 ? "mês" : "meses"}</p>
            <p className="mt-1 font-display text-4xl font-extrabold text-mint">
              {brl(resumo.bruto_total)}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              média de {brl(resumo.bruto_medio_mensal)} por mês
            </p>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <Metrica rotulo="Km rodados" valor={numero(resumo.km_total, 0)}
                     detalhe={`${numero(resumo.corridas_total)} corridas`} />
            <Metrica rotulo="Horas" valor={numero(resumo.horas_total, 0)}
                     detalhe={resumo.horas_total
                       ? `${brl((resumo.bruto_total ?? 0) / resumo.horas_total)}/h bruto`
                       : "informe suas horas"} />
          </div>

          {!resumo.custos_informados && (
            <Aviso tom="info" titulo="Falta o seu custo">
              Com o bruto a gente só sabe o que entrou. Informe combustível, manutenção e
              depreciação em <a className="text-mint underline" href={rotaModulo("margem")}>
              Margem</a> para ver quanto realmente sobra.
            </Aviso>
          )}

          {resumo.por_app && Object.keys(resumo.por_app).length > 1 && (
            <Card>
              <SecaoTitulo titulo="De onde veio" />
              <ul className="space-y-2">
                {Object.entries(resumo.por_app)
                  .sort((a, b) => b[1].bruto - a[1].bruto)
                  .map(([app, d]) => (
                    <li key={app} className="flex items-center gap-3 text-sm">
                      <span className="flex-1">{nomeApp(app)}</span>
                      <span className="text-ink-faint">{numero(d.corridas)} corridas</span>
                      <span className="font-semibold">{brl(d.bruto)}</span>
                    </li>
                  ))}
              </ul>
            </Card>
          )}
        </>
      ) : (
        <Vazio icone="TrendingUp" titulo="Comece lançando o que você recebeu">
          Pegue o extrato semanal do app e lance mês a mês. É esse número que destrava a
          margem real e a simulação de crédito — e ele é seu, não um palpite nosso.
        </Vazio>
      )}

      <Card>
        <SecaoTitulo titulo="Lançar um período"
                     subtitulo="Pode corrigir depois: relançar o mesmo app e mês substitui" />
        <FormularioLancamento
          enviando={lancando}
          onLancar={async (l) => {
            setLancando(true);
            await lancar(perfil.cpf, l);
            setLancando(false);
            await recarregar();
          }}
        />
      </Card>

      {lancamentos.length > 0 && (
        <Card>
          <SecaoTitulo titulo="O que você já lançou" />
          <ul className="divide-y divide-white/8">
            {lancamentos.map((l) => (
              <li key={`${l.app}-${l.competencia}`} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {nomeApp(l.app)} · {rotuloCompetencia(l.competencia)}
                  </p>
                  <p className="text-xs text-ink-faint">
                    {numero(l.km, 0)} km · {numero(l.corridas)} corridas · {numero(l.horas, 0)} h
                  </p>
                </div>
                <span className="font-semibold">{brl(l.bruto)}</span>
                <button className="btn-ghost btn-sm text-danger"
                        aria-label={`Apagar ${nomeApp(l.app)} ${l.competencia}`}
                        onClick={async () => {
                          await apagarLancamento(perfil.cpf, l.app, l.competencia);
                          await recarregar();
                        }}>
                  <Icone nome="Trash2" className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <SecaoTitulo titulo="Por que não puxamos sozinhos?" />
        <p className="text-sm leading-relaxed text-ink-muted">
          iFood, Rappi e 99 não abrem os ganhos do entregador para terceiros. O caminho
          regulado é o Open Finance: com a sua autorização, ler na sua conta os repasses que
          essas plataformas depositam. Estamos construindo esse conector — até ele entrar, o
          lançamento aqui é o que há de verdadeiro.
        </p>
      </Card>
    </div>
  );
}

function FormularioLancamento({ enviando, onLancar }: {
  enviando: boolean; onLancar: (l: Lancamento) => void | Promise<void>;
}) {
  const [f, setF] = useState({ app: "ifood", competencia: competenciaAtual(),
                               bruto: "", corridas: "", km: "", horas: "" });
  const [erro, setErro] = useState("");
  const d = (chave: keyof typeof f, valor: string) => setF((a) => ({ ...a, [chave]: valor }));

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const bruto = paraNumero(f.bruto);
        if (bruto <= 0) return setErro("Informe quanto você recebeu no período.");
        setErro("");
        await onLancar({ app: f.app, competencia: f.competencia, bruto,
                         corridas: Math.round(paraNumero(f.corridas)),
                         km: paraNumero(f.km), horas: paraNumero(f.horas),
                         origem: "declarado" });
        setF({ ...f, bruto: "", corridas: "", km: "", horas: "" });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="App">
          <select className="input" value={f.app} onChange={(e) => d("app", e.target.value)}>
            {APPS_CONHECIDOS.map((a) => (
              <option key={a.slug} value={a.slug}>{a.nome}</option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Mês">
          <select className="input" value={f.competencia}
                  onChange={(e) => d("competencia", e.target.value)}>
            {competenciasRecentes(8).map((c) => (
              <option key={c} value={c}>{rotuloCompetencia(c)}</option>
            ))}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Quanto recebeu no mês" obrigatorio erro={erro}>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-ink-faint">
            R$
          </span>
          <input className="input pl-10" inputMode="decimal" value={f.bruto}
                 onChange={(e) => d("bruto", e.target.value)} placeholder="0,00" />
        </div>
      </Campo>
      <div className="grid grid-cols-3 gap-3">
        <Campo rotulo="Corridas">
          <input className="input" inputMode="numeric" value={f.corridas}
                 onChange={(e) => d("corridas", e.target.value)} />
        </Campo>
        <Campo rotulo="Km">
          <input className="input" inputMode="decimal" value={f.km}
                 onChange={(e) => d("km", e.target.value)} />
        </Campo>
        <Campo rotulo="Horas">
          <input className="input" inputMode="decimal" value={f.horas}
                 onChange={(e) => d("horas", e.target.value)} />
        </Campo>
      </div>
      <button className="btn-primary w-full" type="submit" disabled={enviando}>
        {enviando ? "Salvando…" : "Lançar"}
      </button>
    </form>
  );
}

const nomeApp = (slug: string) =>
  APPS_CONHECIDOS.find((a) => a.slug === slug)?.nome ?? slug;

function GanhosResumo({ modulo }: ModuleProps) {
  const { perfil } = usePerfil();
  const [r, setR] = useState<Resumo | null>(null);
  useEffect(() => {
    let vivo = true;
    void carregarResumo(perfil.cpf, 3).then((x) => vivo && setR(x));
    return () => { vivo = false; };
  }, [perfil.cpf]);

  if (!r) return null;

  if (!r.tem_dados)
    return (
      <Card className="flex items-center gap-4">
        <div className="rounded-full bg-mint/12 p-3">
          <Icone nome="TrendingUp" className="h-5 w-5 text-mint" />
        </div>
        <div className="flex-1">
          <p className="font-semibold">Lance seus ganhos</p>
          <p className="text-xs text-ink-faint">É o que destrava margem real e simulação</p>
        </div>
        <a href={rotaModulo(modulo.id)} className="btn-primary btn-sm">Lançar</a>
      </Card>
    );

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="label">Média mensal que você lançou</p>
          <p className="mt-1 font-display text-3xl font-extrabold text-mint">
            {brl(r.bruto_medio_mensal)}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {r.meses_lancados} {r.meses_lancados === 1 ? "mês lançado" : "meses lançados"}
            {r.sincronizado === false && " · salvo no aparelho"}
          </p>
        </div>
        <a href={rotaModulo(modulo.id)} className="btn-ghost btn-sm">Ver</a>
      </div>
      {r.margem && (
        <p className="mt-3 flex items-center gap-2 text-xs">
          <Chip tom="on">líquido {brl(r.margem.liquido_medio_mensal)}</Chip>
          <span className="text-ink-faint">depois dos seus custos</span>
        </p>
      )}
    </Card>
  );
}

export const moduloGanhos: ModuleDefinition = {
  id: "ganhos",
  Component: GanhosTela,
  Resumo: GanhosResumo,
};
