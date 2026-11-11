/**
 * PlatformProvider — carrega os manifestos e deixa o app inteiro orientado por eles.
 *
 * Nenhuma tela decide se um produto existe: ela pergunta ao contexto. Ligar um
 * módulo no admin muda a navegação na próxima carga, sem build.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, comFallback } from "@/lib/api";
import { CATALOGO_LOCAL } from "./catalogo-local";
import type { Modulo } from "./types";

interface PlatformCtx {
  modulos: Modulo[];
  /** Ligados e com fornecedor capaz — é o que entra na navegação. */
  disponiveis: Modulo[];
  /** Ligados mas sem fornecedor: existem no plano, não na vida ainda. */
  aguardandoFornecedor: Modulo[];
  porId: (id: string) => Modulo | undefined;
  ligado: (id: string) => boolean;
  carregando: boolean;
  erro: string | null;
  /** O servidor não respondeu: o catálogo é local e nada de produto é real. */
  semServidor: boolean;
  recarregar: () => Promise<void>;
}

const Ctx = createContext<PlatformCtx | null>(null);

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [modulos, setModulos] = useState<Modulo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [semServidor, setSemServidor] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      let offline = false;
      const dados = await comFallback(
        () => api.get<{ modules: Modulo[] }>("/platform/modules"),
        () => {
          offline = true;
          return { modules: CATALOGO_LOCAL };
        },
      );
      setSemServidor(offline);
      setModulos([...dados.modules].sort((a, b) => a.ordem - b.ordem));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao carregar os módulos");
      setModulos(CATALOGO_LOCAL);
      setSemServidor(true);
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
      aguardandoFornecedor: modulos.filter((m) => m.enabled && !m.pronto),
      porId,
      ligado: (id: string) => Boolean(porId(id)?.enabled),
      carregando,
      erro,
      semServidor,
      recarregar: carregar,
    };
  }, [modulos, carregando, erro, semServidor, carregar]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function usePlataforma(): PlatformCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlataforma precisa estar dentro de <PlatformProvider>");
  return ctx;
}
