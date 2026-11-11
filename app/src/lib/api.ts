/**
 * api.ts — cliente único do backend.
 *
 * Duas decisões que importam:
 *
 * 1. **Modo demo**: sem backend no ar, o app não quebra. `api` tenta a rede e,
 *    se não houver resposta, cai para `demo.ts` (manifestos e jornadas
 *    equivalentes aos do seed). Assim dá para apresentar o app em qualquer
 *    lugar, e o mesmo código roda contra o FastAPI de verdade.
 * 2. **Token de admin** fica em memória + sessionStorage, nunca em código.
 */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";
const TIMEOUT_MS = 12_000;
const CHAVE_TOKEN = "bmoto.admin.token";

let tokenAdmin: string | null = null;
let backendVivo: boolean | null = null;

export function definirTokenAdmin(token: string | null) {
  tokenAdmin = token;
  try {
    if (token) sessionStorage.setItem(CHAVE_TOKEN, token);
    else sessionStorage.removeItem(CHAVE_TOKEN);
  } catch {
    /* navegação privada: o token vale só para esta sessão de memória */
  }
}

export function obterTokenAdmin(): string | null {
  if (tokenAdmin !== null) return tokenAdmin;
  try {
    tokenAdmin = sessionStorage.getItem(CHAVE_TOKEN);
  } catch {
    tokenAdmin = null;
  }
  return tokenAdmin;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly corpo?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

/** Erro de rede/backend ausente — dispara o modo demo. */
export class SemBackend extends Error {
  constructor() {
    super("backend indisponível");
    this.name = "SemBackend";
  }
}

type Metodo = "GET" | "POST" | "PUT" | "DELETE";

async function bruto<T>(metodo: Metodo, caminho: string, corpo?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const token = obterTokenAdmin();
    const res = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      signal: ctrl.signal,
      headers: {
        ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { "X-Admin-Token": token } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    // Resposta que não é JSON quase sempre quer dizer "não tem backend aqui":
    // um SPA servindo index.html para qualquer rota, ou um proxy no meio.
    // Tratar como backend ausente leva ao modo demo em vez de uma tela quebrada.
    const tipo = res.headers.get("content-type") ?? "";
    if (res.ok && !tipo.includes("json")) throw new SemBackend();

    backendVivo = true;
    const texto = await res.text();
    const dados = texto ? safeJson(texto) : null;
    if (!res.ok) {
      const detalhe = (dados as any)?.detail ?? res.statusText;
      throw new ApiError(res.status, typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe), dados);
    }
    return dados as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    backendVivo = false;
    throw new SemBackend();
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

export const api = {
  get: <T>(caminho: string) => bruto<T>("GET", caminho),
  post: <T>(caminho: string, corpo?: unknown) => bruto<T>("POST", caminho, corpo ?? {}),
  put: <T>(caminho: string, corpo?: unknown) => bruto<T>("PUT", caminho, corpo ?? {}),
  del: <T>(caminho: string) => bruto<T>("DELETE", caminho),
  backendVivo: () => backendVivo,
};

/**
 * Executa a chamada real e, se o backend não responder, usa o fallback de demo.
 * Erros de negócio (4xx/5xx) NÃO caem no fallback — eles são a resposta.
 */
export async function comDemo<T>(chamada: () => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
  try {
    return await chamada();
  } catch (e) {
    if (e instanceof SemBackend) return await fallback();
    throw e;
  }
}
