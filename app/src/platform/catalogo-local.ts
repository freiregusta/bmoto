/**
 * catalogo-local.ts — o catálogo de produtos quando o servidor não responde.
 *
 * Isto é CATÁLOGO, não dado de ninguém: nomes, descrições e de que fornecedor
 * cada produto depende. Nenhum saldo, nenhuma renda, nenhum número de pessoa
 * aparece aqui — sem servidor, o que é do entregador continua sendo só o que
 * ele lançou no aparelho.
 *
 * Tudo que depende de fornecedor entra com `pronto: false` e a dependência à
 * mostra, porque é a verdade: não existe conta, cartão nem apólice enquanto
 * não houver contrato.
 */

import type { Modulo, PortId } from "./types";

/** O que falta no mundo real para cada capacidade deixar de ser promessa. */
export const DEPENDENCIA: Record<PortId, string> = {
  conta: "um BaaS contratado (conta individual e Pix)",
  cartao: "um emissor de cartão contratado",
  kyc: "um fornecedor de verificação de identidade",
  credito: "a SCD/emissor e o funding",
  seguro: "uma seguradora parceira e registro de representante (CNSP 431)",
  saude: "uma operadora ou administradora de benefícios",
  contador: "o Integra Contador (Serpro), com e-CNPJ e procuração e-CAC",
  renda: "Open Finance por participante certificado, ou convênio com a plataforma",
};

function m(
  id: string, titulo: string, descricao: string, icone: string, ordem: number,
  requisitos: PortId[], fase: Modulo["fase"] = "mvp", tags: string[] = [],
): Modulo {
  return {
    id, titulo, descricao, icone, ordem, fase, tags,
    rota: `/app/${id}`,
    enabled: true,
    // Sem servidor não há fornecedor configurado: o que depende de um não está pronto.
    pronto: requisitos.length === 0,
    requisitos: requisitos.map((port) => ({ port, capabilities: [] })),
    providers: Object.fromEntries(requisitos.map((p) => [p, null])),
    origem_flag: "codigo",
  };
}

export const CATALOGO_LOCAL: Modulo[] = [
  m("ganhos", "Meus ganhos", "O que você recebeu em cada app, lançado por você.",
    "TrendingUp", 10, [], "mvp", ["real"]),
  m("margem", "Margem líquida real", "Custo por km e quanto sobra de verdade.",
    "Calculator", 20, [], "mvp", ["real"]),
  m("credito", "Simulação de crédito", "O que cabe no seu bolso, pela sua renda real.",
    "Banknote", 30, [], "mvp", ["real"]),
  m("conta", "Conta BMoto", "Conta individual com Pix, onde caem os repasses dos apps.",
    "Wallet", 40, ["conta", "kyc"], "fase2", ["baas"]),
  m("mei", "MEI e contabilidade", "Abertura da MEI, DAS mensal, DASN anual e nota fiscal.",
    "FileText", 50, ["contador"], "fase2", ["contabil"]),
  m("moto", "Financiamento de moto", "Moto com parcela debitada do repasse.",
    "Bike", 60, ["credito", "conta"], "fase2", ["credito"]),
  m("cartao", "Cartão com garantia da moto", "Crédito com limite lastreado na moto.",
    "CreditCard", 70, ["cartao"], "fase2", ["credito"]),
  m("seguro", "Seguro de vida e acidentes", "Vida, acidentes pessoais e diária por incapacidade.",
    "Shield", 80, ["seguro"], "fase2", ["seguros"]),
  m("saude", "Seguro saúde", "Plano coletivo pela MEI ou por adesão.",
    "HeartPulse", 90, ["saude"], "fase3", ["seguros"]),
];

/** Apps de entrega de onde a renda pode vir. Lista, não integração. */
export const APPS_CONHECIDOS = [
  { slug: "ifood", nome: "iFood" },
  { slug: "rappi", nome: "Rappi" },
  { slug: "99", nome: "99Food" },
  { slug: "uber", nome: "Uber Eats" },
  { slug: "loggi", nome: "Loggi" },
  { slug: "outros", nome: "Outro app ou particular" },
];
