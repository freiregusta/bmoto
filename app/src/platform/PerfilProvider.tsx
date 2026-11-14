/**
 * PerfilProvider — quem está usando o app, de verdade.
 *
 * A sessão vem do Supabase Auth: a pessoa informa o e-mail, recebe um código
 * de 6 dígitos e entra. Sem senha, de propósito — senha é a primeira coisa que
 * se esquece e o primeiro motivo de abandono num app que a pessoa abre uma vez
 * por semana. O código vai por e-mail porque SMS no Brasil exige provedor
 * contratado; quando entrar, só este arquivo muda.
 *
 * Entrar não é o mesmo que ter conta: `autenticado` só fica verdadeiro quando
 * existe sessão E o perfil tem nome e CPF. É o que faz a jornada começar do
 * começo para quem acabou de instalar.
 *
 * O perfil mora na tabela `perfis`, protegida por RLS — o banco só devolve a
 * linha de quem está logado. O app não precisa (e não consegue) pedir a de
 * outra pessoa.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState }
  from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { configurado, supabase } from "@/lib/supabase";

/** Versão do texto de consentimento que a tela de cadastro apresenta. */
export const VERSAO_LGPD = "2026-11";

export interface Perfil {
  cpf: string;
  nome: string;
  nascimento: string;
  celular: string;
  email: string;
  cnpjMei: string | null;
  cadastrado: boolean;
}

/** Ninguém, ainda. É o estado de quem acabou de instalar o app. */
const VAZIO: Perfil = {
  cpf: "", nome: "", nascimento: "", celular: "", email: "",
  cnpjMei: null, cadastrado: false,
};

/**
 * O que as jornadas já criaram para esta pessoa. Enquanto não há fornecedor
 * contratado para conta, cartão e afins, isto fica vazio — e as telas dizem
 * que o produto não existe ainda, em vez de mostrar um saldo inventado.
 */
export interface Carteira {
  conta?: { conta_id: string; agencia: string; numero: string; chave_pix?: string | null };
  cartao?: { cartao_id: string; limite: number; ultimos4: string; modalidade: string };
  mei?: { cnpj: string; cnae: string; aberto_em: string };
  contrato?: { contrato_id: string; parcelas: number; parcela: number; produto: string };
  apolice?: { apolice_id: string; produto: string; premio_mensal: number };
  plano_saude?: { apolice_id: string; premio_mensal: number };
  apps_conectados?: Array<{ app: string; nome: string; consentimento_id: string }>;
  renda_media?: number;
}

const CHAVE_CARTEIRA = "bmoto.carteira";
const CHAVE_PERFIL_LOCAL = "bmoto.perfil";       // cache, para abrir sem esperar a rede

export interface DadosCadastro {
  nome: string;
  cpf: string;
  nascimento: string;
  celular: string;
  aceitouLgpd: boolean;
}

export type Resultado = { estado: "ok" } | { estado: "erro"; erro: string };

interface Ctx {
  perfil: Perfil;
  carteira: Carteira;
  /** Sessão válida E perfil preenchido. */
  autenticado: boolean;
  /** Entrou, mas ainda não completou o cadastro. */
  precisaCompletarCadastro: boolean;
  /** Ainda verificando se existe sessão guardada. */
  carregando: boolean;
  /** Manda o código de 6 dígitos para o e-mail. */
  enviarCodigo: (email: string) => Promise<Resultado>;
  /** Confere o código e abre a sessão. */
  confirmarCodigo: (email: string, codigo: string) => Promise<Resultado>;
  /** Completa o cadastro de quem já entrou. */
  cadastrar: (dados: DadosCadastro) => Promise<Resultado>;
  atualizar: (parcial: Partial<Perfil>) => Promise<void>;
  sair: () => Promise<void>;
  registrarEntregaveis: (contexto: Record<string, any>) => void;
}

const PerfilCtx = createContext<Ctx | null>(null);

const soDigitos = (v: string) => (v ?? "").replace(/\D/g, "");

function lerLocal<T>(chave: string, padrao: T): T {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? ({ ...padrao, ...JSON.parse(bruto) } as T) : padrao;
  } catch {
    return padrao;
  }
}

function gravarLocal(chave: string, valor: unknown) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* navegação privada: segue em memória nesta sessão */
  }
}

/** Traduz o erro do Supabase para algo que o entregador entenda. */
function mensagem(e: any): string {
  const texto = String(e?.message ?? e ?? "");
  if (/invalid|expired|token/i.test(texto))
    return "Código inválido ou expirado. Peça um novo.";
  if (/rate|limit|too many|segundos/i.test(texto))
    return "Muitas tentativas seguidas. Espere um minuto e tente de novo.";
  if (/email/i.test(texto) && /invalid/i.test(texto))
    return "Confira o e-mail digitado.";
  if (/fetch|network|Failed/i.test(texto))
    return "Sem conexão com o servidor. Tente de novo em instantes.";
  return texto || "Não deu certo. Tente de novo.";
}

export function PerfilProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil>(() => lerLocal(CHAVE_PERFIL_LOCAL, VAZIO));
  const [carteira, setCarteira] = useState<Carteira>(() => lerLocal(CHAVE_CARTEIRA, {}));
  const [carregando, setCarregando] = useState(configurado);
  const montado = useRef(true);

  useEffect(() => () => { montado.current = false; }, []);

  /** Lê a linha do perfil deste usuário. O RLS garante que é só a dele. */
  const carregarPerfil = useCallback(async (s: Session | null) => {
    if (!s) {
      setPerfil(VAZIO);
      gravarLocal(CHAVE_PERFIL_LOCAL, VAZIO);
      return;
    }
    const { data } = await supabase
      .from("perfis")
      .select("nome, cpf, nascimento, celular, cnpj_mei, lgpd_aceite_em")
      .maybeSingle();
    if (!montado.current) return;
    const novo: Perfil = {
      nome: data?.nome ?? "",
      cpf: data?.cpf ?? "",
      nascimento: data?.nascimento ?? "",
      celular: data?.celular ?? "",
      email: s.user.email ?? "",
      cnpjMei: data?.cnpj_mei ?? null,
      // Conta criada = tem nome, CPF e aceite registrado.
      cadastrado: !!(data?.nome && data?.cpf && data?.lgpd_aceite_em),
    };
    setPerfil(novo);
    gravarLocal(CHAVE_PERFIL_LOCAL, novo);
  }, []);

  useEffect(() => {
    if (!configurado) return;
    let vivo = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo) return;
      setSessao(data.session);
      await carregarPerfil(data.session);
      if (vivo) setCarregando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => {
      setSessao(s);
      void carregarPerfil(s);
    });
    return () => { vivo = false; sub.subscription.unsubscribe(); };
  }, [carregarPerfil]);

  useEffect(() => { gravarLocal(CHAVE_CARTEIRA, carteira); }, [carteira]);

  const enviarCodigo = useCallback(async (email: string): Promise<Resultado> => {
    if (!configurado) return { estado: "erro", erro: "O servidor não está configurado neste app." };
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true },   // primeiro acesso já cria a conta
    });
    return error ? { estado: "erro", erro: mensagem(error) } : { estado: "ok" };
  }, []);

  const confirmarCodigo = useCallback(
    async (email: string, codigo: string): Promise<Resultado> => {
      if (!configurado) return { estado: "erro", erro: "O servidor não está configurado neste app." };
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: soDigitos(codigo),
        type: "email",
      });
      if (error) return { estado: "erro", erro: mensagem(error) };
      setSessao(data.session);
      await carregarPerfil(data.session);
      return { estado: "ok" };
    }, [carregarPerfil]);

  const cadastrar = useCallback(async (dados: DadosCadastro): Promise<Resultado> => {
    const u = sessao?.user?.id;
    if (!u) return { estado: "erro", erro: "Entre com seu e-mail antes de criar a conta." };
    if (!dados.aceitouLgpd)
      return { estado: "erro",
               erro: "É preciso aceitar o uso dos seus dados para criar a conta." };

    const linha = {
      user_id: u,
      nome: dados.nome.trim(),
      cpf: soDigitos(dados.cpf),
      nascimento: dados.nascimento || null,
      celular: soDigitos(dados.celular),
      lgpd_aceite_em: new Date().toISOString(),
      lgpd_versao: VERSAO_LGPD,
    };
    const { error } = await supabase.from("perfis").upsert(linha, { onConflict: "user_id" });
    if (error) return { estado: "erro", erro: mensagem(error) };
    await carregarPerfil(sessao);
    return { estado: "ok" };
  }, [sessao, carregarPerfil]);

  const atualizar = useCallback(async (parcial: Partial<Perfil>) => {
    setPerfil((p) => {
      const novo = { ...p, ...parcial };
      gravarLocal(CHAVE_PERFIL_LOCAL, novo);
      return novo;
    });
    if (!sessao?.user?.id) return;
    const campos: Record<string, unknown> = {};
    if (parcial.nome !== undefined) campos.nome = parcial.nome.trim();
    if (parcial.celular !== undefined) campos.celular = soDigitos(parcial.celular);
    if (parcial.nascimento !== undefined) campos.nascimento = parcial.nascimento || null;
    if (parcial.cnpjMei !== undefined) campos.cnpj_mei = parcial.cnpjMei;
    if (Object.keys(campos).length)
      await supabase.from("perfis").update(campos).eq("user_id", sessao.user.id);
  }, [sessao]);

  const sair = useCallback(async () => {
    await supabase.auth.signOut();
    setSessao(null);
    setPerfil(VAZIO);
    gravarLocal(CHAVE_PERFIL_LOCAL, VAZIO);
  }, []);

  const registrarEntregaveis = useCallback((ctx: Record<string, any>) => {
    setCarteira((c) => ({
      ...c,
      ...(ctx.conta?.conta_id ? { conta: ctx.conta } : {}),
      ...(ctx.cartao?.cartao_id ? { cartao: ctx.cartao } : {}),
      ...(ctx.mei?.cnpj ? { mei: ctx.mei } : {}),
      ...(ctx.contrato?.contrato_id ? { contrato: ctx.contrato } : {}),
      ...(ctx.apolice?.apolice_id ? { apolice: ctx.apolice } : {}),
      ...(ctx.plano_saude?.apolice_id ? { plano_saude: ctx.plano_saude } : {}),
      ...(ctx.apps_conectados?.length ? { apps_conectados: ctx.apps_conectados } : {}),
      ...(typeof ctx.renda_media === "number" ? { renda_media: ctx.renda_media } : {}),
    }));
    if (ctx.mei?.cnpj) void atualizar({ cnpjMei: ctx.mei.cnpj });
  }, [atualizar]);

  const valor = useMemo<Ctx>(() => ({
    perfil, carteira,
    autenticado: !!sessao && perfil.cadastrado,
    precisaCompletarCadastro: !!sessao && !perfil.cadastrado,
    carregando,
    enviarCodigo, confirmarCodigo, cadastrar, atualizar, sair, registrarEntregaveis,
  }), [perfil, carteira, sessao, carregando, enviarCodigo, confirmarCodigo, cadastrar,
       atualizar, sair, registrarEntregaveis]);

  return <PerfilCtx.Provider value={valor}>{children}</PerfilCtx.Provider>;
}

export function usePerfil(): Ctx {
  const ctx = useContext(PerfilCtx);
  if (!ctx) throw new Error("usePerfil precisa estar dentro de <PerfilProvider>");
  return ctx;
}
