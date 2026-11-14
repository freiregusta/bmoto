/**
 * supabaseFalso.ts — o backend em memória que os testes usam.
 *
 * Substitui `@/lib/supabase` com a MESMA forma: sessão, tabelas e edge
 * functions. Duas escolhas deliberadas:
 *
 * 1. **As edge functions não respondem.** Os testes de interface existem para
 *    provar o comportamento sem servidor: o que o entregador lançou continua
 *    funcionando e o que depende de fornecedor aparece como indisponível. Se o
 *    falso respondesse pelas functions, os testes provariam o falso, não o app.
 * 2. **As tabelas são por usuário.** Como no RLS de verdade, uma consulta só
 *    alcança as linhas de quem está na sessão. Um teste não consegue ler, nem
 *    por acidente, o dado de outro.
 */

import { vi } from "vitest";

export const configurado = true;

export class SemBackend extends Error {
  constructor(readonly causa?: unknown) {
    super("backend indisponível");
    this.name = "SemBackend";
  }
}

export class ErroServidor extends Error {
  constructor(readonly status: number, mensagem: string, readonly corpo?: any) {
    super(mensagem);
    this.name = "ErroServidor";
  }
}

type Linha = Record<string, any>;

interface Estado {
  usuario: { id: string; email: string } | null
  tabelas: Record<string, Linha[]>;
  /** Código que o verifyOtp aceita. Fixo: teste não lê e-mail. */
  codigo: string;
  emailPendente: string;
}

const estado: Estado = {
  usuario: null,
  tabelas: {},
  codigo: "123456",
  emailPendente: "",
};

const ouvintes: Array<(evento: string, s: any) => void> = [];

const sessaoDe = (u: Estado["usuario"]) => (u ? { user: u, access_token: "falso" } : null);
const avisar = (evento: string) => ouvintes.forEach((f) => f(evento, sessaoDe(estado.usuario)));

/** Zera tudo entre testes. */
export function resetarFalso() {
  estado.usuario = null;
  estado.tabelas = {};
  estado.emailPendente = "";
  ouvintes.length = 0;
}

/** Abre uma sessão já pronta, para o teste não repetir o login em cada caso. */
export function entrarFalso(email = "carlos@teste.local", id = "u-1") {
  estado.usuario = { id, email };
  avisar("SIGNED_IN");
  return id;
}

/** Semeia linhas numa tabela, como se já estivessem no banco. */
export function semearFalso(tabela: string, linhas: Linha[]) {
  estado.tabelas[tabela] = [...(estado.tabelas[tabela] ?? []), ...linhas];
}

export const linhasFalsas = (tabela: string): Linha[] => estado.tabelas[tabela] ?? [];

// ----------------------------------------------------------- consultas

const chaveDe = (linha: Linha, campos: string[]) => campos.map((c) => linha[c]).join("\u0000");

/**
 * Construtor de consulta mínimo, no formato do supabase-js: encadeia filtros e
 * resolve quando aguardado.
 */
function consulta(tabela: string) {
  let filtros: Array<[string, any]> = [];
  let ordens: Array<[string, boolean]> = [];
  let operacao: "select" | "upsert" | "update" | "delete" = "select";
  let payload: Linha[] = [];
  let conflito: string[] = ["user_id"];
  let unico = false;

  const linhas = () => (estado.tabelas[tabela] ??= []);
  // Como o RLS: nada sai de uma tabela de titular sem sessão aberta.
  const visiveis = () => {
    const todas = linhas();
    if (!todas.length || !("user_id" in (todas[0] ?? {}))) return todas;
    return estado.usuario ? todas.filter((l) => l.user_id === estado.usuario!.id) : [];
  };

  const executar = () => {
    if (operacao === "select") {
      let saida = visiveis().filter((l) => filtros.every(([c, v]) => l[c] === v));
      for (const [campo, asc] of [...ordens].reverse())
        saida = [...saida].sort((a, b) =>
          (String(a[campo]) > String(b[campo]) ? 1 : -1) * (asc ? 1 : -1));
      if (unico)
        return { data: saida[0] ?? null, error: saida.length > 1
          ? { message: "mais de uma linha" } : null };
      return { data: saida, error: null };
    }
    if (operacao === "upsert") {
      for (const nova of payload) {
        const i = linhas().findIndex((l) => chaveDe(l, conflito) === chaveDe(nova, conflito));
        if (i >= 0) linhas()[i] = { ...linhas()[i], ...nova };
        else linhas().push({ ...nova });
      }
      return { data: payload, error: null };
    }
    if (operacao === "update") {
      linhas().forEach((l, i) => {
        if (filtros.every(([c, v]) => l[c] === v)) linhas()[i] = { ...l, ...payload[0] };
      });
      return { data: null, error: null };
    }
    const restantes = linhas().filter((l) => !filtros.every(([c, v]) => l[c] === v));
    estado.tabelas[tabela] = restantes;
    return { data: null, error: null };
  };

  const construtor: any = {
    select: (_campos?: string) => { operacao = "select"; return construtor; },
    insert: (dados: Linha | Linha[]) => {
      operacao = "upsert";
      payload = Array.isArray(dados) ? dados : [dados];
      return construtor;
    },
    upsert: (dados: Linha | Linha[], opcoes?: { onConflict?: string }) => {
      operacao = "upsert";
      payload = Array.isArray(dados) ? dados : [dados];
      if (opcoes?.onConflict) conflito = opcoes.onConflict.split(",").map((s) => s.trim());
      return construtor;
    },
    update: (dados: Linha) => { operacao = "update"; payload = [dados]; return construtor; },
    delete: () => { operacao = "delete"; return construtor; },
    eq: (campo: string, valor: any) => { filtros.push([campo, valor]); return construtor; },
    order: (campo: string, opcoes?: { ascending?: boolean }) => {
      ordens.push([campo, opcoes?.ascending !== false]);
      return construtor;
    },
    limit: () => construtor,
    maybeSingle: () => { unico = true; return construtor; },
    single: () => { unico = true; return construtor; },
    then: (resolver: any, rejeitar?: any) =>
      Promise.resolve(executar()).then(resolver, rejeitar),
  };
  return construtor;
}

export const supabase: any = {
  from: (tabela: string) => consulta(tabela),
  auth: {
    getSession: async () => ({ data: { session: sessaoDe(estado.usuario) }, error: null }),
    getUser: async () => ({ data: { user: estado.usuario }, error: null }),
    onAuthStateChange: (fn: (evento: string, s: any) => void) => {
      ouvintes.push(fn);
      return { data: { subscription: { unsubscribe: () => {
        const i = ouvintes.indexOf(fn);
        if (i >= 0) ouvintes.splice(i, 1);
      } } } };
    },
    signInWithOtp: async ({ email }: { email: string }) => {
      estado.emailPendente = email.trim().toLowerCase();
      return { data: {}, error: null };
    },
    verifyOtp: async ({ email, token }: { email: string; token: string }) => {
      if (token !== estado.codigo)
        return { data: { session: null }, error: { message: "Token has expired or is invalid" } };
      estado.usuario = { id: "u-1", email: email.trim().toLowerCase() };
      avisar("SIGNED_IN");
      return { data: { session: sessaoDe(estado.usuario) }, error: null };
    },
    signOut: async () => {
      estado.usuario = null;
      avisar("SIGNED_OUT");
      return { error: null };
    },
  },
  functions: {
    invoke: vi.fn(async () => ({ data: null, error: new Error("sem servidor no teste") })),
  },
};

/** As edge functions não respondem no teste: é o caminho sem servidor. */
export async function funcao<T>(_nome: string, _corpo?: unknown,
                                _metodo: "GET" | "POST" = "POST"): Promise<T> {
  throw new SemBackend();
}

export async function usuarioId(): Promise<string | null> {
  return estado.usuario?.id ?? null;
}

export async function comFallback<T>(chamada: () => Promise<T>,
                                     local: () => T | Promise<T>): Promise<T> {
  try {
    return await chamada();
  } catch (e) {
    if (e instanceof SemBackend) return await local();
    throw e;
  }
}
