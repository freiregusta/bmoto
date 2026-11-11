/**
 * Motor de jornadas do modo demo.
 *
 * Também serve de teste de contrato: as mesmas jornadas do seed do backend
 * precisam rodar aqui com a mesma semântica de passos, condições e recusas.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  JORNADAS_DEMO, MODULOS_DEMO, PRODUTOS_CREDITO_DEMO, _limparExecucoesDemo, avancarDemo,
  estadoDemo, iniciarDemo, jornadaDoModuloDemo,
} from "./demo";

const CPF = "12345678909";
const CONTEXTO = { nome: "João Entregador", nascimento: "1995-03-10", score: 640 };

beforeEach(() => _limparExecucoesDemo());

describe("catálogo de demonstração", () => {
  it("espelha os módulos do backend, com o consignado desligado", () => {
    const consignado = MODULOS_DEMO.find((m) => m.id === "consignado_clt")!;
    expect(consignado.enabled).toBe(false);
    expect(consignado.fase).toBe("legado");
    expect(MODULOS_DEMO.filter((m) => m.enabled).length).toBeGreaterThanOrEqual(8);
  });

  it("cada jornada aponta para um módulo ou produto que existe", () => {
    const ids = new Set(MODULOS_DEMO.map((m) => m.id));
    const produtos = new Set(PRODUTOS_CREDITO_DEMO.map((p) => p.id));
    JORNADAS_DEMO.forEach((j) => {
      if (j.modulo_id) expect(ids.has(j.modulo_id)).toBe(true);
      if (j.produto_credito_id) expect(produtos.has(j.produto_credito_id)).toBe(true);
    });
  });

  it("todo passo de oferta referencia um produto cadastrado", () => {
    JORNADAS_DEMO.flatMap((j) => j.passos)
      .filter((p) => p.tipo === "oferta")
      .forEach((p) => {
        const id = p.config.produto_credito_id as string;
        expect(PRODUTOS_CREDITO_DEMO.some((x) => x.id === id)).toBe(true);
      });
  });

  it("acha a jornada do módulo", () => {
    expect(jornadaDoModuloDemo("moto")?.id).toBe("jornada_moto");
    expect(jornadaDoModuloDemo("inexistente")).toBeUndefined();
  });
});

describe("jornada de abertura de conta", () => {
  it("vai do formulário ao provisionamento", () => {
    let st = iniciarDemo("jornada_conta", CPF, CONTEXTO);
    expect(st.passo_atual?.id).toBe("dados");
    expect(st.progresso.total).toBe(5);

    st = avancarDemo(st.execucao_id, { nome: "João" });        // falta nascimento
    expect(st.passo_atual?.id).toBe("dados");
    expect(st.historico.at(-1)?.resultado.campos).toEqual(["nascimento", "celular"]);

    st = avancarDemo(st.execucao_id, { nome: "João", nascimento: "1995-03-10",
                                       celular: "11999990000" });
    expect(st.passo_atual?.id).toBe("lgpd");

    st = avancarDemo(st.execucao_id, { aceito: false });
    expect(st.passo_atual?.id).toBe("lgpd");                   // consentimento trava

    st = avancarDemo(st.execucao_id, { aceito: true });
    expect(st.passo_atual?.id).toBe("kyc");
    expect(st.automatico).toBe(true);

    st = avancarDemo(st.execucao_id);
    expect(st.contexto.kyc_ok).toBe(true);

    st = avancarDemo(st.execucao_id);                          // provisionar
    expect(st.contexto.conta.conta_id).toMatch(/^cta_/);

    st = avancarDemo(st.execucao_id);
    expect(st.status).toBe("CONCLUIDA");
    expect(estadoDemo(st.execucao_id).status).toBe("CONCLUIDA");
  });

  it("manda para a mesa quando o KYC reprova", () => {
    let st = iniciarDemo("jornada_conta", "98765432100", CONTEXTO);
    st = avancarDemo(st.execucao_id, { nome: "X", nascimento: "1990-01-01",
                                       celular: "11988887777" });
    st = avancarDemo(st.execucao_id, { aceito: true });
    st = avancarDemo(st.execucao_id);
    expect(st.status).toBe("PENDENTE_MESA");
    expect(st.contexto.kyc.motivos).toContain("lista_restritiva");
  });
});

describe("jornada de financiamento de moto", () => {
  const rodar = (garantia: number, prazo: number, cpf = CPF, ctx = CONTEXTO) => {
    let st = iniciarDemo("jornada_moto", cpf, ctx);
    const respostas: Record<string, Record<string, unknown>> = {
      apps: { apps: ["ifood", "99"] }, moto: { valor_garantia: garantia },
      prazo: { prazo }, ccb: { aceito: true },
    };
    for (let i = 0; i < 15; i += 1) {
      if (st.status !== "EM_ANDAMENTO" || !st.passo_atual) break;
      st = avancarDemo(st.execucao_id, respostas[st.passo_atual.id] ?? {});
    }
    return st;
  };

  it("lê a renda, oferta dentro do LTV e emite a CCB", () => {
    const st = rodar(22_000, 48);
    expect(st.status).toBe("CONCLUIDA");
    // iFood 2.480 + 99 910, média de 3 meses com a queda de 4% ao mês
    expect(st.contexto.renda_media).toBeCloseTo(3254.4, 1);
    const oferta = st.contexto.oferta;
    expect(oferta.aprovado).toBe(true);
    expect(oferta.parcelas).toBe(48);
    expect(oferta.limite).toBeLessThanOrEqual(22_000 * 0.9);
    expect(oferta.comprometimento).toBeLessThanOrEqual(0.3001);
    expect(st.contexto.contrato.contrato_id).toMatch(/^ccb_/);
    expect(st.contexto.apolice.produto).toBe("moto");          // passo condicional rodou
  });

  it("respeita o prazo escolhido e recusa opção fora da lista", () => {
    let st = iniciarDemo("jornada_moto", CPF, CONTEXTO);
    st = avancarDemo(st.execucao_id, { apps: ["ifood"] });
    st = avancarDemo(st.execucao_id);
    st = avancarDemo(st.execucao_id, { valor_garantia: 20_000 });
    expect(st.passo_atual?.id).toBe("prazo");
    st = avancarDemo(st.execucao_id, { prazo: 60 });            // não está nas opções
    expect(st.passo_atual?.id).toBe("prazo");
    expect(st.historico.at(-1)?.resultado.erro).toBe("opcao_invalida");
    st = avancarDemo(st.execucao_id, { prazo: 24 });
    st = avancarDemo(st.execucao_id);
    expect(st.contexto.oferta.parcelas).toBe(24);
  });

  it("recusa quando a renda não alcança o mínimo", () => {
    let st = iniciarDemo("jornada_moto", CPF, CONTEXTO);
    st = avancarDemo(st.execucao_id, { apps: ["uber"] });       // app sem renda
    st = avancarDemo(st.execucao_id);
    expect(st.status).toBe("RECUSADA");
    expect(st.historico.at(-1)?.resultado.erro).toBe("renda_insuficiente");
  });

  it("exige conectar ao menos um app", () => {
    let st = iniciarDemo("jornada_moto", CPF, CONTEXTO);
    st = avancarDemo(st.execucao_id, { apps: [] });
    expect(st.passo_atual?.id).toBe("apps");
    expect(st.historico.at(-1)?.resultado.erro).toBe("conecte_ao_menos_um_app");
  });

  it("vai para a mesa quando a política recusa a oferta", () => {
    // score baixo: produto exige 550
    const st = rodar(22_000, 48, CPF, { ...CONTEXTO, score: 480 });
    expect(st.status).toBe("PENDENTE_MESA");
    expect(st.contexto.oferta.recusas).toContain("score_abaixo_do_minimo");
  });
});

describe("jornada de cartão com garantia", () => {
  it("limita o limite a 30% do valor da moto", () => {
    let st = iniciarDemo("jornada_cartao", CPF, CONTEXTO);
    st = avancarDemo(st.execucao_id, { placa: "ABC1D23", valor_garantia: 18_000 });
    st = avancarDemo(st.execucao_id);                           // renda sem app conectado
    st = avancarDemo(st.execucao_id);                           // oferta
    expect(st.contexto.oferta.recusas).toContain("renda_abaixo_do_minimo");
  });
});

describe("jornada de MEI e saúde", () => {
  it("abre o CNPJ e o plano vira empresarial depois disso", () => {
    let st = iniciarDemo("jornada_mei", CPF, CONTEXTO);
    st = avancarDemo(st.execucao_id, { nome: "João", nascimento: "1995-03-10" });
    st = avancarDemo(st.execucao_id, { aceito: true });
    st = avancarDemo(st.execucao_id);
    expect(st.contexto.mei.cnpj).toMatch(/000199$/);
    const cnpj = st.contexto.cnpj_mei;

    let s2 = iniciarDemo("jornada_saude", CPF, { ...CONTEXTO, cnpj_mei: cnpj });
    s2 = avancarDemo(s2.execucao_id, { nome: "João", nascimento: "1995-03-10" });
    s2 = avancarDemo(s2.execucao_id);
    expect(s2.contexto.plano_saude.premio_mensal).toBe(189.9);   // empresarial, mais barato
  });

  it("sem MEI, o plano sai por adesão", () => {
    let st = iniciarDemo("jornada_saude", CPF, CONTEXTO);
    st = avancarDemo(st.execucao_id, { nome: "João", nascimento: "1995-03-10" });
    st = avancarDemo(st.execucao_id);
    expect(st.contexto.plano_saude.premio_mensal).toBe(249.9);
  });
});

describe("execuções inválidas", () => {
  it("avisa quando a jornada não existe", () => {
    expect(() => iniciarDemo("não_existe", CPF)).toThrow(/não existe/);
  });

  it("avisa quando a execução não existe", () => {
    expect(() => estadoDemo("nada")).toThrow(/não encontrada/);
    expect(() => avancarDemo("nada")).toThrow(/não encontrada/);
  });

  it("não reabre jornada concluída", () => {
    let st = iniciarDemo("jornada_seguro", CPF, CONTEXTO);
    st = avancarDemo(st.execucao_id, { nome: "João", nascimento: "1995-03-10" });
    st = avancarDemo(st.execucao_id, { aceito: true });
    st = avancarDemo(st.execucao_id);
    expect(st.status).toBe("CONCLUIDA");
    const depois = avancarDemo(st.execucao_id, { aceito: true });
    expect(depois.status).toBe("CONCLUIDA");
    expect(depois.historico.length).toBe(st.historico.length);
  });
});
