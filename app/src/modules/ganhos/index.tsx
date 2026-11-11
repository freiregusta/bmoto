/**
 * Módulo Ganhos — tela dedicada.
 *
 * Mostra a renda consolidada dos apps conectados. Sem app conectado, roda a
 * jornada de conexão. Os apps vêm do catálogo do admin: cadastrar uma
 * plataforma nova lá a faz aparecer aqui.
 */

import { useEffect, useState } from "react";
import { Aviso, Card, Chip, Icone, Metrica, SecaoTitulo } from "@/components/ui";
import { JornadaRunner } from "@/components/JornadaRunner";
import { api, comDemo } from "@/lib/api";
import { brl, numero } from "@/lib/format";
import { APPS_DEMO } from "@/platform/demo";
import { usePerfil } from "@/platform/PerfilProvider";
import type { AppEntrega } from "@/platform/types";
import type { ModuleDefinition, ModuleProps } from "@/platform/registry";

export function useAppsEntrega(): { apps: AppEntrega[]; carregando: boolean } {
  const [apps, setApps] = useState<AppEntrega[]>([]);
  const [carregando, setCarregando] = useState(true);
  useEffect(() => {
    let cancelado = false;
    comDemo(() => api.get<{ apps: AppEntrega[] }>("/admin/apps-entrega"),
            () => ({ apps: APPS_DEMO }))
      .then((d) => {
        if (!cancelado) setApps(d.apps.filter((a) => a.ativo).sort((a, b) => a.ordem - b.ordem));
      })
      .catch(() => {
        // /admin exige token: sem ele, o app usa o catálogo de demonstração
        if (!cancelado) setApps(APPS_DEMO);
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, []);
  return { apps, carregando };
}

function GanhosTela({ modulo }: ModuleProps) {
  const { carteira } = usePerfil();
  const conectados = carteira.apps_conectados ?? [];

  if (conectados.length === 0)
    return (
      <div className="space-y-4">
        <Aviso tom="info" titulo="Conecte seus apps">
          É assim que a BMoto vê sua renda real — e é o que destrava crédito sem holerite.
        </Aviso>
        <JornadaRunner modulo={modulo} />
      </div>
    );

  const media = carteira.renda_media ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <p className="label">Renda média dos últimos meses</p>
        <p className="mt-1 font-display text-4xl font-extrabold text-mint">{brl(media)}</p>
        <p className="mt-1 text-sm text-ink-muted">
          {conectados.length} {conectados.length === 1 ? "app conectado" : "apps conectados"}
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Metrica rotulo="Capacidade de parcela" valor={brl(media * 0.3)}
                 detalhe="até 30% da renda" />
        <Metrica rotulo="Antecipação possível" valor={brl(media * 0.7 * 0.5)}
                 detalhe="sobre o repasse a receber" />
      </div>

      <Card>
        <SecaoTitulo titulo="Apps conectados" />
        <ul className="space-y-2">
          {conectados.map((c) => (
            <li key={c.app}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[.03] p-3">
              <Icone nome="Smartphone" className="h-4 w-4 text-mint" />
              <span className="flex-1 text-sm font-medium">{c.nome}</span>
              <Chip tom="on">lendo</Chip>
            </li>
          ))}
        </ul>
      </Card>

      <ConectarMais modulo={modulo} conectados={conectados.map((c) => c.app)} />
    </div>
  );
}

function ConectarMais({ modulo, conectados }: { modulo: ModuleProps["modulo"]; conectados: string[] }) {
  const { apps } = useAppsEntrega();
  const faltam = apps.filter((a) => !conectados.includes(a.slug));
  if (faltam.length === 0) return null;
  return (
    <Card>
      <SecaoTitulo titulo="Conectar mais"
                   subtitulo="Mais apps conectados, melhor a sua análise de crédito" />
      <div className="flex flex-wrap gap-2">
        {faltam.map((a) => (
          <Chip key={a.slug} tom="off">{a.nome}</Chip>
        ))}
      </div>
      <a href={`${modulo.rota}?novo=1`} className="btn-ghost btn-sm mt-3 w-full">
        Conectar agora
      </a>
    </Card>
  );
}

function GanhosResumo({ modulo }: ModuleProps) {
  const { carteira } = usePerfil();
  const conectados = carteira.apps_conectados ?? [];
  if (conectados.length === 0)
    return (
      <Card className="flex items-center gap-4">
        <div className="rounded-full bg-mint/15 p-3">
          <Icone nome="TrendingUp" className="h-5 w-5 text-mint" />
        </div>
        <div className="flex-1">
          <p className="font-semibold">Conecte seus apps de entrega</p>
          <p className="text-xs text-ink-faint">Sua renda real destrava moto, cartão e crédito</p>
        </div>
        <a href={modulo.rota} className="btn-primary btn-sm">Conectar</a>
      </Card>
    );
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="label">Renda média dos apps</p>
          <p className="mt-1 font-display text-3xl font-extrabold text-mint">
            {brl(carteira.renda_media ?? 0)}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {numero(conectados.length)} {conectados.length === 1 ? "app" : "apps"} conectado
            {conectados.length === 1 ? "" : "s"}
          </p>
        </div>
        <a href={modulo.rota} className="btn-ghost btn-sm">Ver</a>
      </div>
    </Card>
  );
}

export const moduloGanhos: ModuleDefinition = {
  id: "ganhos",
  Component: GanhosTela,
  Resumo: GanhosResumo,
};
