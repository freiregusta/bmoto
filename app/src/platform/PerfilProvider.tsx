/**
 * PerfilProvider — quem está usando o app.
 *
 * Quem abre o app pela primeira vez NÃO tem perfil: `cadastrado` é falso e a
 * entrada manda para o cadastro. Nada de usuário de exemplo já logado — a
 * primeira tela de um app novo é criar a conta.
 *
 * Sem backend de autenticação ainda, o cadastro fica no aparelho. Quando
 * entrar o login de verdade (OTP por SMS + token do BaaS), só este arquivo
 * muda: as telas já consomem `usePerfil()`.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export interface Perfil {
  cpf: string;
  nome: string;
  nascimento: string;
  celular: string;
  email: string;
  cnpjMei: string | null;
  /** Score interno simulado até o bureau entrar. */
  score: number;
  cadastrado: boolean;
}

/** Ninguém, ainda. É o estado de quem acabou de instalar o app. */
const VAZIO: Perfil = {
  cpf: "",
  nome: "",
  nascimento: "",
  celular: "",
  email: "",
  cnpjMei: null,
  score: 640,
  cadastrado: false,
};

/**
 * O que as jornadas já criaram para esta pessoa. Fica no aparelho enquanto não
 * há login: é o que permite a tela da conta saber que existe conta, a da MEI
 * saber o CNPJ, e assim por diante.
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

const CHAVE = "bmoto.perfil";
const CHAVE_CARTEIRA = "bmoto.carteira";

export interface DadosCadastro {
  nome: string;
  cpf: string;
  nascimento: string;
  celular: string;
  email?: string;
}

interface Ctx {
  perfil: Perfil;
  carteira: Carteira;
  /** Já criou conta neste aparelho? */
  autenticado: boolean;
  atualizar: (parcial: Partial<Perfil>) => void;
  cadastrar: (dados: DadosCadastro) => void;
  /** Entrar com um cadastro já feito neste aparelho. */
  entrar: (cpf: string) => boolean;
  sair: () => void;
  /** Guarda o que uma jornada concluída produziu. */
  registrarEntregaveis: (contexto: Record<string, any>) => void;
  limpar: () => void;
}

const PerfilCtx = createContext<Ctx | null>(null);

const soDigitos = (v: string) => v.replace(/\D/g, "");

function ler(): Perfil {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return VAZIO;
    const lido = JSON.parse(bruto) as Partial<Perfil>;
    return { ...VAZIO, ...lido };
  } catch {
    return VAZIO;
  }
}

function lerCarteira(): Carteira {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_CARTEIRA) ?? "{}") as Carteira;
  } catch {
    return {};
  }
}

export function PerfilProvider({ children }: { children: ReactNode }) {
  const [perfil, setPerfil] = useState<Perfil>(ler);
  const [carteira, setCarteira] = useState<Carteira>(lerCarteira);

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(perfil));
      localStorage.setItem(CHAVE_CARTEIRA, JSON.stringify(carteira));
    } catch {
      /* navegação privada ou armazenamento cheio: o app segue em memória */
    }
  }, [perfil, carteira]);

  const atualizar = useCallback((parcial: Partial<Perfil>) => {
    setPerfil((p) => ({ ...p, ...parcial }));
  }, []);

  const cadastrar = useCallback((dados: DadosCadastro) => {
    setPerfil((p) => ({
      ...p,
      nome: dados.nome.trim(),
      cpf: soDigitos(dados.cpf),
      nascimento: dados.nascimento,
      celular: dados.celular,
      email: dados.email ?? "",
      cadastrado: true,
    }));
  }, []);

  const entrar = useCallback((cpf: string) => {
    const guardado = ler();
    if (!guardado.cpf || soDigitos(cpf) !== guardado.cpf) return false;
    setPerfil({ ...guardado, cadastrado: true });
    return true;
  }, []);

  const sair = useCallback(() => {
    // Sair não apaga o cadastro: só tira a sessão deste aparelho.
    setPerfil((p) => ({ ...p, cadastrado: false }));
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
    // a MEI muda a política de alguns produtos: mantém o perfil coerente
    if (ctx.mei?.cnpj) setPerfil((p) => ({ ...p, cnpjMei: ctx.mei.cnpj }));
  }, []);

  const limpar = useCallback(() => {
    setPerfil(VAZIO);
    setCarteira({});
    try {
      localStorage.removeItem(CHAVE);
      localStorage.removeItem(CHAVE_CARTEIRA);
    } catch {
      /* idem */
    }
  }, []);

  const valor = useMemo(
    () => ({ perfil, carteira, autenticado: perfil.cadastrado, atualizar, cadastrar,
             entrar, sair, registrarEntregaveis, limpar }),
    [perfil, carteira, atualizar, cadastrar, entrar, sair, registrarEntregaveis, limpar],
  );
  return <PerfilCtx.Provider value={valor}>{children}</PerfilCtx.Provider>;
}

export function usePerfil(): Ctx {
  const ctx = useContext(PerfilCtx);
  if (!ctx) throw new Error("usePerfil precisa estar dentro de <PerfilProvider>");
  return ctx;
}
