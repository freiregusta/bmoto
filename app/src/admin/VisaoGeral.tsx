/** Visão geral — o estado da plataforma em uma tela. */

import { Link } from "react-router-dom";
import { Aviso, Card, Carregando, Chip, Icone, Metrica, SecaoTitulo } from "@/components/ui";
import { api } from "@/lib/api";
import { numero } from "@/lib/format";
import { useResumo } from "./useAdmin";
import { useState } from "react";
import { rotaAdmin } from "@/rotas";

export default function VisaoGeral() {
  const { dados, carregando, recarregar } = useResumo();
  const [semeando, setSemeando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (carregando || !dados) return <Carregando />;

  const semCatalogo = dados.conexoes.total === 0;

  return (
    <div className="space-y-6">
      <SecaoTitulo
        titulo="Visão geral"
        subtitulo="O que está ligado, com qual fornecedor e o que falta"
        acao={<button className="btn-ghost btn-sm" onClick={() => void recarregar()}>
          <Icone nome="RefreshCw" className="h-3.5 w-3.5" />Atualizar
        </button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica rotulo="Módulos ligados"
                 valor={`${dados.modulos.ligados}/${dados.modulos.total}`}
                 detalhe={`${dados.modulos.prontos} com fornecedor completo`} />
        <Metrica rotulo="Conexões ativas"
                 valor={`${dados.conexoes.ativas}/${dados.conexoes.total}`}
                 detalhe="fornecedores cadastrados" />
        <Metrica rotulo="Produtos de crédito"
                 valor={`${dados.produtos_credito.ativos}/${dados.produtos_credito.total}`}
                 detalhe="ativos no catálogo" />
        <Metrica rotulo="Apps de entrega"
                 valor={`${dados.apps_entrega.ativos}/${dados.apps_entrega.total}`}
                 detalhe={`${numero(dados.jornadas)} jornadas configuradas`} />
      </div>

      {semCatalogo && (
        <Card className="space-y-3">
          <Aviso tom="atencao" titulo="Catálogo vazio">
            Nenhum fornecedor cadastrado ainda. A carga inicial cria conexões mock em todos os
            módulos, os produtos de crédito do plano, os apps de entrega e as jornadas — tudo
            editável depois.
          </Aviso>
          <button className="btn-primary" disabled={semeando}
                  onClick={async () => {
                    setSemeando(true);
                    try {
                      const r = await api.post<Record<string, number>>("/admin/seed");
                      setMsg(`Criados: ${Object.entries(r).map(([k, v]) => `${v} ${k}`).join(", ")}`);
                      await recarregar();
                    } catch (e) {
                      setMsg(e instanceof Error ? e.message : "não deu");
                    } finally {
                      setSemeando(false);
                    }
                  }}>
            {semeando ? "Carregando…" : "Fazer a carga inicial"}
          </button>
          {msg && <p className="text-sm text-ink-muted">{msg}</p>}
        </Card>
      )}

      <Card>
        <SecaoTitulo titulo="Pendências"
                     subtitulo="Módulo ligado cujo fornecedor não entrega tudo o que ele precisa" />
        {dados.pendencias.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-mint">
            <Icone nome="CheckCircle2" className="h-4 w-4" />
            Nenhuma. Todo módulo ligado tem fornecedor capaz.
          </div>
        ) : (
          <ul className="space-y-2">
            {dados.pendencias.map((p, i) => (
              <li key={i} className="rounded-xl border border-warn/30 bg-warn/[.07] p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="font-semibold">{p.produto}</strong>
                  <Chip tom="warn">{p.port}</Chip>
                  {p.provider && <span className="text-ink-faint">via {p.provider}</span>}
                </div>
                {p.faltam?.length ? (
                  <p className="mt-1.5 text-ink-muted">
                    Falta: <code className="text-warn">{p.faltam.join(", ")}</code>
                  </p>
                ) : null}
                {p.erro && <p className="mt-1.5 text-ink-muted">{p.erro}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Atalho to={rotaAdmin("conexoes")} icone="PlugZap" titulo="Cadastrar um BaaS"
                texto="Ligar um fornecedor novo a qualquer módulo, sem deploy." />
        <Atalho to={rotaAdmin("produtos")} icone="Banknote" titulo="Criar produto de crédito"
                texto="Cartão, moto, pessoal, antecipação: tudo paramétrico." />
        <Atalho to={rotaAdmin("jornadas")} icone="Route" titulo="Montar uma jornada"
                texto="Definir o passo-a-passo que o app vai executar." />
      </div>
    </div>
  );
}

function Atalho({ to, icone, titulo, texto }: {
  to: string; icone: string; titulo: string; texto: string;
}) {
  return (
    <Link to={to} className="card transition hover:border-mint/30">
      <Icone nome={icone} className="h-5 w-5 text-mint" />
      <p className="mt-2 font-semibold">{titulo}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">{texto}</p>
    </Link>
  );
}
