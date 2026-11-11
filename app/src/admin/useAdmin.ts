/**
 * useAdmin — leitura e escrita do catálogo, com modo demo.
 *
 * Um hook genérico (`useRecurso`) resolve carregar/recarregar/erro para todas
 * as telas do painel, para cada uma só cuidar do seu formulário.
 */

import { useCallback, useEffect, useState } from "react";
import { api, comDemo } from "@/lib/api";
import {
  APPS_DEMO, CONEXOES_DEMO, JORNADAS_DEMO, PRODUTOS_CREDITO_DEMO, TIPOS_DEMO, resumoDemo,
} from "@/platform/demo";
import type {
  AppEntrega, Conexao, Jornada, Modulo, ProdutoCredito, RegistroAuditoria, Resumo, TiposAdmin,
} from "@/platform/types";

export interface Recurso<T> {
  dados: T | null;
  carregando: boolean;
  erro: string | null;
  recarregar: () => Promise<void>;
}

export function useRecurso<T>(buscar: () => Promise<T>, fallback: () => T, deps: unknown[] = []):
  Recurso<T> {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await comDemo(buscar, fallback));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao carregar");
      setDados(fallback());
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return { dados, carregando, erro, recarregar: carregar };
}

export const useResumo = () =>
  useRecurso<Resumo>(() => api.get("/admin/resumo"), resumoDemo);

export const useTipos = () =>
  useRecurso<TiposAdmin>(() => api.get("/admin/tipos"), () => TIPOS_DEMO);

export const useConexoes = () =>
  useRecurso<{ conexoes: Conexao[] }>(() => api.get("/admin/conexoes"),
                                      () => ({ conexoes: CONEXOES_DEMO }));

export const useProdutosCredito = () =>
  useRecurso<{ produtos: ProdutoCredito[] }>(() => api.get("/admin/produtos-credito"),
                                             () => ({ produtos: PRODUTOS_CREDITO_DEMO }));

export const useApps = () =>
  useRecurso<{ apps: AppEntrega[] }>(() => api.get("/admin/apps-entrega"),
                                     () => ({ apps: APPS_DEMO }));

export const useJornadas = () =>
  useRecurso<{ jornadas: Jornada[] }>(() => api.get("/admin/jornadas"),
                                      () => ({ jornadas: JORNADAS_DEMO }));

export const useModulosAdmin = () =>
  useRecurso<{ modulos: Modulo[]; jornadas: Array<{ id: string; nome: string; modulo_id: string | null }> }>(
    () => api.get("/admin/modulos"),
    () => ({ modulos: [], jornadas: JORNADAS_DEMO.map((j) => ({ id: j.id, nome: j.nome, modulo_id: j.modulo_id ?? null })) }),
  );

export const useAuditoria = () =>
  useRecurso<{ registros: RegistroAuditoria[] }>(() => api.get("/admin/auditoria?limite=80"),
                                                 () => ({ registros: [] }));

/** Escrita: devolve mensagem de erro legível em vez de estourar na tela. */
export async function salvar<T>(fn: () => Promise<T>): Promise<{ ok: true; dados: T } | { ok: false; erro: string }> {
  try {
    return { ok: true, dados: await fn() };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "não deu para salvar" };
  }
}
