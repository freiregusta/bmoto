/**
 * apagar-conta — o direito de ser esquecido, funcionando.
 *
 *   POST { confirmacao: "APAGAR" }
 *
 * Apaga ganhos, custos, interesses, perfil e o próprio login. A LGPD dá ao
 * titular o direito à eliminação dos dados (art. 18, VI), e um botão que só
 * limpa o aparelho enquanto o banco guarda tudo é propaganda enganosa.
 *
 * Quem pode apagar: só o próprio dono, identificado pelo token da sessão. A
 * chave de serviço é usada apenas para remover o usuário do Auth — o id
 * apagado é sempre o do token, nunca um id que venha no corpo da requisição.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

  const url = Deno.env.get("SUPABASE_URL")!;
  const comoUsuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  const { data: { user } } = await comoUsuario.auth.getUser();
  if (!user) return responder({ erro: "nao_autenticado" }, 401);

  // Confirmação explícita: apagar conta não acontece por clique perdido.
  let corpo: { confirmacao?: string } = {};
  try { corpo = await req.json(); } catch { /* sem corpo */ }
  if (corpo.confirmacao !== "APAGAR")
    return responder({ erro: "confirmacao_necessaria" }, 400);

  // As tabelas do titular saem pelo próprio token: o RLS já limita ao dono.
  for (const tabela of ["ganhos", "custos", "interesses", "perfis"]) {
    const { error } = await comoUsuario.from(tabela).delete().eq("user_id", user.id);
    if (error) return responder({ erro: "falha_ao_apagar", tabela, detalhe: error.message }, 500);
  }

  // O login só o Auth remove, e isso exige chave de serviço.
  const servico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!servico)
    return responder({
      dados_apagados: true, login_apagado: false,
      mensagem: "Seus dados foram apagados. O login continua existindo — avise o suporte " +
                "para removê-lo.",
    });

  const admin = createClient(url, servico, { auth: { persistSession: false } });
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error)
    return responder({
      dados_apagados: true, login_apagado: false,
      mensagem: "Seus dados foram apagados, mas o login não pôde ser removido agora.",
      detalhe: error.message,
    }, 207);

  return responder({ dados_apagados: true, login_apagado: true });
});
