/**
 * simular — o que cabe no bolso do entregador, sobre a renda real dele.
 *
 *   POST { produto_id, solicitado?, parcelas?, valor_garantia?, tem_mei? }
 *
 * Isto é simulação, não oferta — e a resposta diz isso explicitamente, com a
 * lista do que ainda falta para virar proposta. A política é real; o que falta
 * é bureau de crédito e emissor contratado.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { rendaParaCredito } from "./financeiro.ts";
import { avaliar, normalizarProduto } from "./politica.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

  let corpo: Record<string, any> = {};
  try { corpo = await req.json(); } catch { /* corpo vazio é aceito */ }
  const produtoId = String(corpo.produto_id ?? "");
  if (!produtoId) return responder({ erro: "produto_nao_informado" }, 400);

  const { data: linha, error } = await supabase
    .from("produtos_credito").select("*").eq("id", produtoId).maybeSingle();
  if (error) return responder({ erro: "catalogo_indisponivel", detalhe: error.message }, 500);
  if (!linha) return responder({ erro: "produto_nao_encontrado", produto_id: produtoId }, 404);

  const produto = normalizarProduto(linha);

  const [{ data: ganhos }, { data: custos }] = await Promise.all([
    supabase.from("ganhos").select("app, competencia, bruto, corridas, km, horas"),
    supabase.from("custos").select("*").maybeSingle(),
  ]);

  const renda = rendaParaCredito(ganhos ?? [], custos ?? null,
                                 Math.max(produto.meses_renda_comprovada, 3));
  if (renda.meses_renda === 0)
    return responder({
      erro: "sem_renda_lancada",
      mensagem: "Lance seus ganhos para simular. Sem renda informada não há como " +
                "calcular o que cabe no seu bolso.",
    }, 422);

  // Não há bureau contratado, então o score não é avaliado — e sim
  // NEUTRALIZADO: a conta roda sobre o que é real (renda, prazo, garantia) e a
  // análise de crédito fica listada como pendência. Zerar o score faria a
  // simulação recusar por um dado que ninguém mediu.
  const r: Record<string, any> = avaliar(produto, {
    score: produto.score_minimo,
    renda_media: renda.renda_media,
    idade: 30,
    tem_mei: !!corpo.tem_mei,
    kyc_ok: true,
    meses_renda: renda.meses_renda,
    valor_garantia: Number(corpo.valor_garantia ?? 0),
    solicitado: corpo.solicitado != null ? Number(corpo.solicitado) : null,
    parcelas: corpo.parcelas != null ? Number(corpo.parcelas) : null,
  });

  r.cabe_no_bolso = r.aprovado;
  r.aprovado = false;            // simulação nunca aprova
  r.simulacao = true;
  r.score_avaliado = false;
  r.renda_considerada = renda;
  r.pendencias_para_virar_oferta = [
    "análise de crédito (bureau contratado)",
    "emissor/SCD para emitir o contrato",
    "verificação de identidade (KYC)",
  ];
  return responder(r);
});
