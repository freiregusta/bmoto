/**
 * PlatformProvider — carrega os manifestos e deixa o app inteiro orientado por eles.
 *
 * Nenhuma tela decide se um produto existe: ela pergunta ao contexto. Ligar um
 * módulo no admin muda a navegação na próxima carga, sem build.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, comDemo } from "@/lib/api";
import { MODULOS_DEMO } from "./demo";
import type { Modulo } from "./types";

interface PlatformCtx {
  modulos: Modulo[];
  /** Ligados e com fornecedor capaz — é o que entra na navegação. */
  disponiveis: Modulo[];
  porId: (id: string) => Modulo | undefined;
  ligado: (id: string) => boolean;
  carregando: boolean;
  erro: string | null;
  modoDemo: boolean;
  recarregar: () => Promise<void>;
}

const Ctx = createContext<PlatformCtx | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [modulos, setModulos] = useState<Modulo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [modoDemo, setModoDemo] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      let demo = false;
      const dados = await comDemo(
        () => api.get<{ modules: Modulo[] }>("/platform/modules"),
        () => {
          demo = true;
          return { modules: MODULOS_DEMO };
        },
      );
      setModoDemo(demo);
      setModulos([...dados.modules].sort((a, b) => a.ordem - b.ordem));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao carregar os módulos");
      setModulos(MODULOS_DEMO);
      setModoDemo(true);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const valor = useMemo<PlatformCtx>(() => {
    const porId = (id: string) => modulos.find((m) => m.id === id);
    return {
      modulos,
      disponiveis: modulos.filter((m) => m.enabled && m.pronto),
      porId,
      ligado: (id: string) => Boolean(porId(id)?.enabled),
      carregando,
      erro,
      modoDemo,
      recarregar: carregar,
    };
  }, [modulos, carregando, erro, modoDemo, carregar]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function usePlataforma(): PlatformCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlataforma precisa estar dentro de <PlatformProvider>");
  return ctx;
}
