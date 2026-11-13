/**
 * ImportarExtrato — o atalho para quem não quer digitar mês a mês.
 *
 * O entregador exporta o extrato da conta onde recebe (ou o relatório que a
 * plataforma manda) e sobe aqui. O servidor lê, separa o que é repasse de app
 * e **mostra antes de gravar**: ele confere o que entendemos do extrato dele
 * e só então confirma.
 *
 * É o mesmo classificador que o conector de Open Finance usa. Quando o
 * consentimento estiver no ar, isto aqui vira o caminho alternativo — para
 * quem recebe em banco que não participa, ou prefere não conectar.
 */

import { useRef, useState } from "react";
import { Aviso, Card, Chip, Icone, SecaoTitulo } from "@/components/ui";
import { api, SemBackend } from "@/lib/api";
import { brl, data as formatarData, pct } from "@/lib/format";
import { usePerfil } from "@/platform/PerfilProvider";
import { rotuloCompetencia } from "@/platform/meusDados";

interface Conferencia {
  linhas_lidas: number;
  creditos_total: number;
  identificado_total: number;
  cobertura: number;
  por_app: Record<string, { nome: string; total: number; lancamentos: number;
                            competencias: Record<string, number> }>;
  por_competencia: Record<string, number>;
  nao_identificados: Array<{ data: string; valor: number; descricao: string; pagador: string }>;
  nao_identificados_total: number;
  lancamentos?: number;
}

const LIMITE_BYTES = 2_000_000;

/**
 * Ler o extrato acontece no servidor. Sem ele, o erro é esse — e dizer
 * "não consegui ler o arquivo" culparia o arquivo do entregador por um
 * problema que é nosso.
 */
function mensagemDeErro(e: unknown, padrao: string): string {
  if (e instanceof SemBackend)
    return "O servidor não respondeu. A leitura do extrato acontece lá, então tente de novo "
         + "daqui a pouco — enquanto isso dá para lançar o mês na mão, aqui embaixo.";
  const detalhe = (e as any)?.corpo?.detail;
  if (typeof detalhe === "string") return detalhe;
  return detalhe?.mensagem ?? padrao;
}

export function ImportarExtrato({ onImportado }: { onImportado: () => void | Promise<void> }) {
  const { perfil } = usePerfil();
  const [conteudo, setConteudo] = useState("");
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const [estado, setEstado] = useState<"idle" | "conferindo" | "importando" | "ok">("idle");
  const [erro, setErro] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const conferir = async (texto: string) => {
    setEstado("conferindo");
    setErro("");
    setConferencia(null);
    try {
      setConferencia(await api.post<Conferencia>("/me/extrato/conferir",
                                                 { cpf: perfil.cpf, conteudo: texto }));
    } catch (e: any) {
      setErro(mensagemDeErro(e, "não consegui ler este arquivo"));
    } finally {
      setEstado("idle");
    }
  };

  const importar = async () => {
    setEstado("importando");
    setErro("");
    try {
      const r = await api.post<Conferencia>("/me/extrato/importar",
                                            { cpf: perfil.cpf, conteudo });
      setConferencia(r);
      setEstado("ok");
      await onImportado();
    } catch (e: any) {
      setErro(mensagemDeErro(e, "não deu para importar"));
      setEstado("idle");
    }
  };

  return (
    <Card className="space-y-4">
      <SecaoTitulo titulo="Importar do extrato"
                   subtitulo="Em vez de digitar: suba o extrato e a gente separa o que é repasse" />

      <input ref={input} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only"
             onChange={async (e) => {
               const arquivo = e.target.files?.[0];
               if (!arquivo) return;
               if (arquivo.size > LIMITE_BYTES) {
                 setErro("Arquivo muito grande. Exporte um período menor.");
                 return;
               }
               const texto = await arquivo.text();
               setNomeArquivo(arquivo.name);
               setConteudo(texto);
               await conferir(texto);
             }} />

      <button className="btn-ghost w-full" onClick={() => input.current?.click()}
              disabled={estado === "conferindo" || estado === "importando"}>
        <Icone nome="FileText" className="h-4 w-4" />
        {estado === "conferindo" ? "Lendo…" : nomeArquivo || "Escolher arquivo (CSV)"}
      </button>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {conferencia && (
        <div className="space-y-3">
          <div className="rounded-xl border border-white/10 bg-navy-500/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="label">Reconhecido como repasse</p>
              <Chip tom={conferencia.cobertura >= 0.8 ? "on" : "warn"}>
                {pct(conferencia.cobertura, 0)} do que entrou
              </Chip>
            </div>
            <p className="mt-1 font-display text-2xl font-bold text-mint">
              {brl(conferencia.identificado_total)}
            </p>
            <p className="mt-0.5 text-xs text-ink-faint">
              de {brl(conferencia.creditos_total)} em créditos · {conferencia.linhas_lidas} linhas
              lidas
            </p>

            <ul className="mt-3 space-y-1.5 text-sm">
              {Object.entries(conferencia.por_app).map(([slug, app]) => (
                <li key={slug} className="flex items-center gap-2">
                  <Icone nome="CheckCircle2" className="h-3.5 w-3.5 text-mint" />
                  <span className="flex-1">{app.nome}</span>
                  <span className="text-ink-faint">
                    {Object.keys(app.competencias).map(rotuloCompetencia).join(", ")}
                  </span>
                  <span className="font-semibold">{brl(app.total)}</span>
                </li>
              ))}
            </ul>
          </div>

          {conferencia.nao_identificados_total > 0 && (
            <details className="rounded-xl border border-white/10 bg-white/[.03] p-3">
              <summary className="cursor-pointer text-sm text-ink-muted">
                {conferencia.nao_identificados_total} crédito
                {conferencia.nao_identificados_total === 1 ? "" : "s"} que não reconhecemos
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-ink-faint">
                {conferencia.nao_identificados.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span>{formatarData(t.data)}</span>
                    <span className="flex-1 truncate">{t.pagador || t.descricao}</span>
                    <span>{brl(t.valor)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-faint">
                Ficam de fora: só entra como renda o que veio de plataforma de entrega.
              </p>
            </details>
          )}

          {estado === "ok" ? (
            <Aviso tom="ok">
              Importado: {conferencia.lancamentos} {conferencia.lancamentos === 1
                ? "período lançado" : "períodos lançados"}.
            </Aviso>
          ) : (
            <button className="btn-primary w-full" disabled={estado === "importando"}
                    onClick={() => void importar()}>
              {estado === "importando" ? "Importando…" : "Confirmar e lançar"}
            </button>
          )}
        </div>
      )}

      <p className="text-xs leading-relaxed text-ink-faint">
        Exporte o extrato em CSV no app do seu banco. Nada sai do seu aparelho antes de você
        conferir o que reconhecemos.
      </p>
    </Card>
  );
}
