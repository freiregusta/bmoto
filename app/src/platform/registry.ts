/**
 * registry.ts — registro de módulos do frontend.
 *
 * O backend diz QUAIS módulos existem e se estão ligados. Este registro diz
 * se algum deles tem tela própria. A regra que dá a flexibilidade:
 *
 *   módulo com tela registrada  -> usa a tela dedicada
 *   módulo sem tela registrada  -> usa `ModuloGenerico`, que renderiza a
 *                                  jornada configurada no admin
 *
 * Ou seja: cadastrar um produto novo no admin (com uma jornada) já o faz
 * funcionar no app. Depois, se valer a pena, a gente escreve a tela dedicada
 * e ela substitui a genérica só registrando aqui — sem tocar em rota,
 * navegação ou menu.
 */

import type { ComponentType } from "react";
import type { Modulo } from "./types";

export interface ModuleProps {
  modulo: Modulo;
}

export interface ModuleDefinition {
  /** Precisa casar com o id do manifesto no backend. */
  id: string;
  /** Tela principal do módulo. */
  Component: ComponentType<ModuleProps>;
  /** Card opcional na tela inicial (resumo do módulo). */
  Resumo?: ComponentType<ModuleProps>;
  /** Substitui o ícone do manifesto, se quiser. */
  icone?: string;
}

const registro = new Map<string, ModuleDefinition>();

export function registrarModulo(def: ModuleDefinition): void {
  if (registro.has(def.id)) {
    // Substituir é legítimo (trocar a tela de um módulo), mas nunca em silêncio.
    console.info(`[bmoto] tela do módulo "${def.id}" substituída`);
  }
  registro.set(def.id, def);
}

export function registrarModulos(defs: ModuleDefinition[]): void {
  defs.forEach(registrarModulo);
}

export function obterModulo(id: string): ModuleDefinition | undefined {
  return registro.get(id);
}

export function temTelaDedicada(id: string): boolean {
  return registro.has(id);
}

export function idsRegistrados(): string[] {
  return [...registro.keys()].sort();
}

/** Só para testes: limpa o registro entre casos. */
export function _limparRegistro(): void {
  registro.clear();
}
