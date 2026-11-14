/**
 * resumo — renda, custos e margem líquida do entregador.
 *
 *   GET /resumo?meses=3
 *
 * Só lê e soma o que o próprio entregador lançou. Quando falta dado, a
 * resposta diz o que falta em vez de preencher com estimativa.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { resumo } from "./financeiro.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const responder = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), {
      status, headers: { ...CORS, "Content-Type": "application/json" },
    });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return responder({ erro: "nao_autenticado" }, 401);

  const meses = Number(new URL(req.url).searchParams.get("meses") ?? 3) || 3;

  // RLS filtra por user_id; não há como pedir o dado de outra pessoa.
  const [{ data: ganhos, error: e1 }, { data: custos, error: e2 }] = await Promise.all([
    supabase.from("ganhos").select("app, competencia, bruto, corridas, km, horas, origem"),
    supabase.from("custos").select("*").maybeSingle(),
  ]);
  if (e1) return responder({ erro: "falha_ao_ler_ganhos", detalhe: e1.message }, 500);
  if (e2) return responder({ erro: "falha_ao_ler_custos", detalhe: e2.message }, 500);

  return responder(resumo(ganhos ?? [], custos ?? null, meses));
});
