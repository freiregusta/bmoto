/**
 * useAdmin — leitura e escrita do catálogo.
 *
 * Sem servidor o painel fica vazio e diz isso. Mostrar um catálogo local aqui
 * seria pior do que inútil: o administrador acharia que cadastrou fornecedor
 * quando não cadastrou nada.
 *
 * Um hook genérico (`useRecurso`) resolve carregar/recarregar/erro para todas
 * as telas do painel, para cada uma só cuidar do seu formulário.
 */

import { useCallback, useEffect, useState } from "react";
import { api, comFallback } from "@/lib/api";
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
      setDados(await comFallback(buscar, fallback));
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

const VAZIO_RESUMO: Resumo = {
  modulos: { total: 0, ligados: 0, prontos: 0 },
  conexoes: { total: 0, ativas: 0 },
  produtos_credito: { total: 0, ativos: 0 },
  apps_entrega: { total: 0, ativos: 0 },
  jornadas: 0,
  pendencias: [],
};

const VAZIO_TIPOS: TiposAdmin = {
  ports: [], adapters: [], tipos_produto_credito: [], tipos_integracao_app: [], tipos_passo: [],
};

export const useResumo = () =>
  useRecurso<Resumo>(() => api.get("/admin/resumo"), () => VAZIO_RESUMO);

export const useTipos = () =>
  useRecurso<TiposAdmin>(() => api.get("/admin/tipos"), () => VAZIO_TIPOS);

export const useConexoes = () =>
  useRecurso<{ conexoes: Conexao[] }>(() => api.get("/admin/conexoes"),
                                      () => ({ conexoes: [] }));

export const useProdutosCredito = () =>
  useRecurso<{ produtos: ProdutoCredito[] }>(() => api.get("/admin/produtos-credito"),
                                             () => ({ produtos: [] }));

export const useApps = () =>
  useRecurso<{ apps: AppEntrega[] }>(() => api.get("/admin/apps-entrega"),
                                     () => ({ apps: [] }));

export const useJornadas = () =>
  useRecurso<{ jornadas: Jornada[] }>(() => api.get("/admin/jornadas"),
                                      () => ({ jornadas: [] }));

export const useModulosAdmin = () =>
  useRecurso<{ modulos: Modulo[]; jornadas: Array<{ id: string; nome: string; modulo_id: string | null }> }>(
    () => api.get("/admin/modulos"),
    () => ({ modulos: [], jornadas: [] }),
  );

export const useAuditoria = () =>
  useRecurso<{ registros: RegistroAuditoria[] }>(() => api.get("/admin/auditoria?limite=80"),
                                                 () => ({ registros: [] }));

/**
 * Escrita: devolve mensagem de erro legível em vez de estourar na tela.
 *
 * O discriminante é TEXTO, não booleano, de propósito: embutido no projeto do
 * Lovable o app compila com `strict: false`, e sem `strictNullChecks` o
 * TypeScript não estreita união por literal booleano — por literal de texto,
 * sim. Assim o mesmo código compila nas duas configurações.
 */
export type Resultado<T> =
  | { estado: "ok"; dados: T }
  | { estado: "erro"; erro: string };

export async function salvar<T>(fn: () => Promise<T>): Promise<Resultado<T>> {
  try {
    return { estado: "ok", dados: await fn() };
  } catch (e) {
    return { estado: "erro", erro: e instanceof Error ? e.message : "não deu para salvar" };
  }
}
