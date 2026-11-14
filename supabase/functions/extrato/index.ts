/**
 * extrato — lê o extrato do entregador e separa o que é repasse de plataforma.
 *
 *   POST { acao: "conferir", conteudo }  -> mostra o que reconheceu, sem gravar
 *   POST { acao: "importar", conteudo }  -> grava como lançamento de ganho
 *
 * Conferir antes de gravar é deliberado: ler o extrato de alguém e salvar por
 * conta própria seria exatamente o que destrói a confiança que um produto
 * financeiro precisa ter. A pessoa vê o que entendemos e confirma.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { classificar, lerCsv, paraLancamentos, type RegraApp } from "./classificador.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const autorizacao = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: autorizacao } } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return responder({ erro: "nao_autenticado" }, 401);

  let corpo: { acao?: string; conteudo?: string };
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "corpo_invalido" }, 400);
  }

  const acao = corpo.acao ?? "conferir";
  if (!corpo.conteudo?.trim())
    return responder({ erro: "sem_conteudo", mensagem: "Envie o extrato." }, 400);

  // As regras de reconhecimento vivem no catálogo, editáveis no admin.
  const { data: apps, error } = await supabase
    .from("apps_entrega")
    .select("slug, nome, identificadores, cnpjs")
    .eq("ativo", true);
  if (error) return responder({ erro: "catalogo_indisponivel", detalhe: error.message }, 500);

  const regras: RegraApp[] = (apps ?? []).map((a) => ({
    slug: a.slug,
    nome: a.nome,
    cnpjs: a.cnpjs ?? [],
    // Sem identificador cadastrado, o nome da plataforma é o palpite mínimo.
    identificadores: (a.identificadores ?? []).length ? a.identificadores : [a.nome],
  }));

  let transacoes;
  try {
    transacoes = lerCsv(corpo.conteudo);
  } catch (e) {
    return responder({ erro: "formato_nao_reconhecido", mensagem: String(e.message ?? e) }, 422);
  }
  if (!transacoes.length)
    return responder({
      erro: "nada_para_ler",
      mensagem: "Não consegui ler nenhuma linha com data e valor.",
    }, 422);

  const c = classificar(transacoes, regras);
  const resumo = {
    linhas_lidas: transacoes.length,
    creditos_total: c.total_creditos,
    identificado_total: c.total_identificado,
    cobertura: c.cobertura,
    por_app: c.por_app,
    por_competencia: c.por_competencia,
    nao_identificados: c.nao_identificados.slice(0, 20).map((t) => ({
      data: t.data, valor: t.valor, descricao: t.descricao ?? "", pagador: t.pagador_nome ?? "",
    })),
    nao_identificados_total: c.nao_identificados.length,
  };

  if (acao === "conferir") return responder(resumo);

  if (acao !== "importar") return responder({ erro: "acao_desconhecida" }, 400);

  if (!Object.keys(c.por_app).length)
    return responder({
      erro: "nenhum_repasse_reconhecido",
      mensagem: "Li o extrato mas não reconheci repasse de plataforma nenhuma. " +
                "Confira os identificadores em Admin → Apps de entrega.",
      ...resumo,
    }, 422);

  // Um lançamento por app e mês: relançar corrige, não duplica.
  const linhas = paraLancamentos(c).map((l) => ({ ...l, user_id: user.id }));
  const { error: erroGravacao } = await supabase
    .from("ganhos")
    .upsert(linhas, { onConflict: "user_id,app,competencia" });
  if (erroGravacao)
    return responder({ erro: "falha_ao_gravar", detalhe: erroGravacao.message }, 500);

  return responder({ lancamentos: linhas.length, ...resumo });
});
