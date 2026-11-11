/**
 * PerfilProvider — quem está usando o app.
 *
 * Sem backend de autenticação ainda: o perfil fica no aparelho. Quando entrar
 * o login (OTP por SMS + token do BaaS), só este arquivo muda — as telas já
 * consomem `usePerfil()`.
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

const PADRAO: Perfil = {
  cpf: "12345678909",
  nome: "João Entregador",
  nascimento: "1995-03-10",
  celular: "(11) 99999-0000",
  email: "joao@exemplo.com",
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

interface Ctx {
  perfil: Perfil;
  carteira: Carteira;
  atualizar: (parcial: Partial<Perfil>) => void;
  /** Guarda o que uma jornada concluída produziu. */
  registrarEntregaveis: (contexto: Record<string, any>) => void;
  limpar: () => void;
}

const PerfilCtx = createContext<Ctx | null>(null);

function ler(): Perfil {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return PADRAO;
    const lido = JSON.parse(bruto) as Partial<Perfil>;
    return { ...PADRAO, ...lido };
  } catch {
    return PADRAO;
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
    setPerfil(PADRAO);
    setCarteira({});
    try {
      localStorage.removeItem(CHAVE);
      localStorage.removeItem(CHAVE_CARTEIRA);
    } catch {
      /* idem */
    }
  }, []);

  const valor = useMemo(
    () => ({ perfil, carteira, atualizar, registrarEntregaveis, limpar }),
    [perfil, carteira, atualizar, registrarEntregaveis, limpar],
  );
  return <PerfilCtx.Provider value={valor}>{children}</PerfilCtx.Provider>;
}

export function usePerfil(): Ctx {
  const ctx = useContext(PerfilCtx);
  if (!ctx) throw new Error("usePerfil precisa estar dentro de <PerfilProvider>");
  return ctx;
}
