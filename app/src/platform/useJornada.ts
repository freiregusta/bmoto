/**
 * useJornada — roda a jornada que o admin montou.
 *
 * O componente não sabe quais passos existem: pede o estado, renderiza o passo
 * atual e devolve a resposta. Passos automáticos (kyc, renda, oferta,
 * provisionar) avançam sozinhos, com um batimento curto para o usuário ver o
 * que está acontecendo.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { EstadoJornada, Jornada } from "./types";

const PAUSA_AUTOMATICO_MS = 650;

export interface UseJornada {
  estado: EstadoJornada | null;
  jornada: Jornada | null;
  carregando: boolean;
  enviando: boolean;
  erro: string | null;
  /** Último passo que falhou (campos obrigatórios, consentimento, etc.). */
  ultimaFalha: Record<string, any> | null;
  iniciar: (contexto?: Record<string, any>) => Promise<void>;
  avancar: (resposta?: Record<string, any>) => Promise<void>;
  reiniciar: () => void;
}

export function useJornada(moduloId: string, cpf: string): UseJornada {
  const [jornada, setJornada] = useState<Jornada | null>(null);
  const [estado, setEstado] = useState<EstadoJornada | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    api.get<Jornada>(`/jornadas/modulo/${moduloId}`)
      .then((j) => {
        if (!cancelado) setJornada(j);
      })
      .catch((e) => {
        if (!cancelado) setJornada(null), setErro(mensagem(e));
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [moduloId]);

  const iniciar = useCallback(
    async (contexto: Record<string, any> = {}) => {
      if (!jornada) return;
      setEnviando(true);
      setErro(null);
      try {
        const st = await api.post<EstadoJornada>(
          `/jornadas/${jornada.id}/iniciar`, { cpf, contexto });
        if (vivo.current) setEstado(st);
      } catch (e) {
        if (vivo.current) setErro(mensagem(e));
      } finally {
        if (vivo.current) setEnviando(false);
      }
    },
    [jornada, cpf],
  );

  const avancar = useCallback(
    async (resposta: Record<string, any> = {}) => {
      if (!estado) return;
      setEnviando(true);
      setErro(null);
      try {
        const st = await api.post<EstadoJornada>(
          `/jornadas/execucao/${estado.execucao_id}/avancar`, { resposta });
        if (vivo.current) setEstado(st);
      } catch (e) {
        if (vivo.current) setErro(mensagem(e));
      } finally {
        if (vivo.current) setEnviando(false);
      }
    },
    [estado],
  );

  // Passo automático: o app não pede nada ao usuário, só mostra e segue.
  useEffect(() => {
    if (!estado || estado.status !== "EM_ANDAMENTO" || !estado.automatico || enviando) return;
    timer.current = window.setTimeout(() => void avancar({}), PAUSA_AUTOMATICO_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [estado, enviando, avancar]);

  const reiniciar = useCallback(() => {
    setEstado(null);
    setErro(null);
  }, []);

  const ultimaFalha = (() => {
    const h = estado?.historico?.at(-1);
    return h && !h.ok ? h.resultado : null;
  })();

  return { estado, jornada, carregando, enviando, erro, ultimaFalha, iniciar, avancar, reiniciar };
}

export async function recarregarEstado(execucaoId: string): Promise<EstadoJornada> {
  return api.get<EstadoJornada>(`/jornadas/execucao/${execucaoId}`);
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : "algo deu errado";
}
