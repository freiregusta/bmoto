/**
 * rotas.ts — onde o app vive dentro do domínio.
 *
 * Existe porque o mesmo código roda em dois lugares: sozinho (base `/app`) e
 * dentro do projeto do Lovable, ao lado do protótipo antigo, que continua em
 * `/app`. Lá a base é `/v2`, definida em `.env` (`VITE_APP_BASE=/v2`).
 *
 * Nenhuma tela escreve caminho na mão: todas passam por aqui, e trocar a base
 * é mudar uma variável.
 */

export const BASE = (import.meta.env.VITE_APP_BASE ?? "/app").replace(/\/+$/, "");

export const rotaInicio = (): string => BASE || "/";
export const rotaModulo = (moduloId: string): string => `${BASE}/${moduloId}`;
export const rotaMais = (): string => `${BASE}/mais`;
export const rotaPerfil = (): string => `${BASE}/perfil`;
export const rotaAdmin = (secao = ""): string =>
  `${BASE}/admin${secao ? `/${secao}` : ""}`;
