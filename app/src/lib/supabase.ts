/**
 * supabase.ts — a ligação com o backend real.
 *
 * O backend do BMoto é um projeto Supabase na região de São Paulo: banco
 * Postgres com RLS (cada entregador só alcança as linhas dele, garantido pelo
 * banco e não pela boa vontade do app) e edge functions para o que é conta —
 * leitura de extrato, margem e simulação de crédito.
 *
 * Por que a conta não é feita aqui: app e servidor calculando o mesmo número
 * por caminhos diferentes já divergiu uma vez neste projeto. Agora existe um
 * só lugar, e ele fica no servidor.
 *
 * As chaves aqui são públicas de propósito — a `anon key` identifica o
 * projeto, não autoriza nada. Quem autoriza é o RLS, com base no usuário
 * logado. Nenhum segredo de fornecedor passa pelo app.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const CHAVE = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Sem configuração não há backend: o app funciona local e diz que está local. */
export const configurado = !!(URL && CHAVE);

export const supabase: SupabaseClient = createClient(
  URL ?? "https://indisponivel.invalid",
  CHAVE ?? "sem-chave",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,       // o link de e-mail volta com a sessão na URL
      storageKey: "bmoto.auth",
    },
  },
);

/** Erro de rede/backend ausente — dispara o caminho local, nunca um número falso. */
export class SemBackend extends Error {
  constructor(readonly causa?: unknown) {
    super("backend indisponível");
    this.name = "SemBackend";
  }
}

/** Erro de negócio que veio do servidor: é a resposta, não uma falha. */
export class ErroServidor extends Error {
  constructor(readonly status: number, mensagem: string, readonly corpo?: any) {
    super(mensagem);
    this.name = "ErroServidor";
  }
}

/**
 * Chama uma edge function. Distingue três situações que não podem se misturar:
 * não ter backend (cai no local), o servidor recusar com motivo (mostra o
 * motivo) e não estar logado (manda para a entrada).
 */
export async function funcao<T>(nome: string, corpo?: unknown, metodo: "GET" | "POST" = "POST"):
  Promise<T> {
  if (!configurado) throw new SemBackend();
  const { data, error } = await supabase.functions.invoke<T>(nome, {
    method: metodo,
    ...(corpo !== undefined ? { body: corpo as Record<string, unknown> } : {}),
  });

  if (!error) return data as T;

  // FunctionsHttpError traz a resposta do servidor; o resto é rede.
  const resposta = (error as any)?.context as Response | undefined;
  if (!resposta || typeof resposta.status !== "number") throw new SemBackend(error);

  let corpoErro: any = null;
  try {
    corpoErro = await resposta.json();
  } catch {
    /* resposta sem JSON: fica o status */
  }
  throw new ErroServidor(
    resposta.status,
    corpoErro?.mensagem ?? corpoErro?.erro ?? `o servidor respondeu ${resposta.status}`,
    corpoErro,
  );
}

/** O id do usuário logado, ou null. Útil para gravar nas tabelas com RLS. */
export async function usuarioId(): Promise<string | null> {
  if (!configurado) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/**
 * Executa a chamada real e, se não houver backend, usa o caminho local.
 * Erro de negócio NÃO cai no fallback — é a resposta que a tela deve mostrar.
 */
export async function comFallback<T>(chamada: () => Promise<T>,
                                     local: () => T | Promise<T>): Promise<T> {
  try {
    return await chamada();
  } catch (e) {
    if (e instanceof SemBackend) return await local();
    throw e;
  }
}
