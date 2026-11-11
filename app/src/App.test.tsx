/**
 * Teste de integração da interface, sem servidor.
 *
 * O que ele prova é a regra que vale agora: o que o entregador lança funciona
 * offline e é dele; o que depende de fornecedor aparece como indisponível,
 * com a dependência à mostra. Em nenhum lugar o app inventa saldo, renda ou
 * aprovação.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";

const abrir = (rota: string) =>
  render(
    <MemoryRouter initialEntries={[rota]}>
      <App />
    </MemoryRouter>,
  );

function comCadastro(nome = "Carlos Souza") {
  localStorage.setItem(
    "bmoto.perfil",
    JSON.stringify({ nome, cpf: "12345678909", nascimento: "1995-03-10",
                     celular: "(11) 99999-0000", email: "", cnpjMei: null,
                     score: 640, cadastrado: true }),
  );
}

function comGanhos(meses = [["2026-09", 3000], ["2026-10", 3200], ["2026-11", 3400]] as const) {
  localStorage.setItem("bmoto.ganhos", JSON.stringify(
    meses.map(([competencia, bruto]) => ({ app: "ifood", competencia, bruto,
                                           corridas: 180, km: 1800, horas: 120 }))));
}

function comCustos() {
  localStorage.setItem("bmoto.custos", JSON.stringify({
    consumo_km_l: 35, preco_combustivel: 6.19, custo_oleo: 60, km_troca_oleo: 2000,
    valor_moto: 18000, vida_util_km: 120000, das_mei: 86.05,
  }));
}

describe("primeira vez no app", () => {
  it("quem acabou de instalar cai no cadastro", async () => {
    abrir("/app");
    expect(await screen.findByRole("button", { name: "Criar minha conta" })).toBeDefined();
    expect(screen.queryByText("O que já funciona")).toBeNull();
  });

  it("nenhuma tela abre sem cadastro", async () => {
    abrir("/app/ganhos");
    expect(await screen.findByRole("button", { name: "Criar minha conta" })).toBeDefined();
  });

  it("cadastro completo entra com o nome da pessoa", async () => {
    const usuario = userEvent.setup();
    abrir("/app");
    await usuario.click(await screen.findByRole("button", { name: "Criar minha conta" }));
    await usuario.type(screen.getByPlaceholderText("Como no documento"), "Carlos Souza");
    await usuario.type(screen.getByPlaceholderText("000.000.000-00"), "12345678909");
    await usuario.type(screen.getByPlaceholderText("(11) 90000-0000"), "11988887777");
    await usuario.type(document.querySelector('input[type="date"]')!, "1995-03-10");
    await usuario.click(screen.getByRole("checkbox"));
    await usuario.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(await screen.findByRole("heading", { name: "Carlos" })).toBeDefined();
  });
});

describe("quem ainda não lançou nada", () => {
  beforeEach(() => comCadastro());

  it("não vê número nenhum inventado na tela inicial", async () => {
    abrir("/app");
    expect(await screen.findByRole("heading", { name: "Carlos" })).toBeDefined();
    expect(screen.getByText("Lance seus ganhos")).toBeDefined();
    // nada de saldo, renda ou líquido antes de existir dado
    expect(screen.queryByText(/R\$/)).toBeNull();
  });

  it("a margem pede os ganhos antes de calcular", async () => {
    abrir("/app/margem");
    expect(await screen.findByText("Lance seus ganhos primeiro")).toBeDefined();
  });

  it("a simulação de crédito pede a renda real", async () => {
    abrir("/app/credito");
    expect(await screen.findByText("Simule com a sua renda, não com um chute")).toBeDefined();
  });
});

describe("ganhos lançados pelo entregador", () => {
  beforeEach(() => comCadastro());

  it("lança um período e passa a somar", async () => {
    const usuario = userEvent.setup();
    abrir("/app/ganhos");

    expect(await screen.findByText("Comece lançando o que você recebeu")).toBeDefined();
    await usuario.type(screen.getByPlaceholderText("0,00"), "3200");
    await usuario.click(screen.getByRole("button", { name: "Lançar" }));

    // aparece no total do período e na lista do que foi lançado
    expect((await screen.findAllByText("R$ 3.200,00")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Salvo só neste aparelho/)).toBeDefined();
  });

  it("sem custos, mostra o bruto e diz que falta o custo", async () => {
    comGanhos();
    abrir("/app/margem");
    expect(await screen.findByText("Falta quanto custa rodar")).toBeDefined();
    expect(screen.getByText("R$ 9.600,00")).toBeDefined();        // 3 meses lançados
  });

  it("com custos, calcula o líquido real", async () => {
    comGanhos();
    comCustos();
    abrir("/app/margem");
    expect(await screen.findByText("Sobrou de verdade")).toBeDefined();
    // 9.600 lançados − (5.400 km × R$ 0,3569) − 3 × DAS de R$ 86,05
    expect(screen.getByText("R$ 7.414,59")).toBeDefined();
    expect(screen.getByText("Para onde foi o dinheiro")).toBeDefined();
  });

  it("a conta da corrida usa o custo por km do próprio entregador", async () => {
    const usuario = userEvent.setup();
    comGanhos();
    comCustos();
    abrir("/app/margem");
    await usuario.click(await screen.findByRole("button", { name: "Vale a pena?" }));
    await usuario.type(screen.getByPlaceholderText("12,50"), "12,50");
    await usuario.type(screen.getByPlaceholderText("7,2"), "7");
    expect(await screen.findByText("Vale a pena")).toBeDefined();
  });
});

describe("o que depende de fornecedor", () => {
  beforeEach(() => comCadastro());

  it("a conta diz o que falta, em vez de mostrar saldo", async () => {
    abrir("/app/conta");
    expect(await screen.findByText(/Conta BMoto ainda não está no ar/)).toBeDefined();
    expect(screen.getByText(/BaaS contratado/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Me avise quando chegar" })).toBeDefined();
    expect(screen.queryByText(/Saldo/)).toBeNull();
  });

  it("a MEI diz que depende do Serpro, sem forjar DAS", async () => {
    abrir("/app/mei");
    expect(await screen.findByText(/Integra Contador \(Serpro\)/)).toBeDefined();
    expect(screen.queryByText(/código de barras/i)).toBeNull();
  });

  it("o financiamento aponta para a simulação, que é o que existe hoje", async () => {
    abrir("/app/moto");
    expect(await screen.findByText(/SCD\/emissor/)).toBeDefined();
    expect(screen.getByText(/Simule quanto caberia/)).toBeDefined();
  });

  it("aparecem na tela inicial como em construção, não como produto", async () => {
    abrir("/app");
    const secao = (await screen.findByText("Ainda não está no ar")).closest("section")!;
    expect(within(secao).getByText("Conta BMoto")).toBeDefined();
    expect(within(secao).getAllByText("em construção").length).toBeGreaterThan(3);
  });
});

describe("painel de administração", () => {
  beforeEach(() => comCadastro());

  it("sem servidor, não inventa catálogo", async () => {
    abrir("/app/admin");
    expect(await screen.findByText(/Sem conexão com o servidor/)).toBeDefined();
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeDefined();
    expect(screen.getByText("Catálogo vazio")).toBeDefined();
  });

  it("a tela de conexões não lista fornecedor que não existe", async () => {
    abrir("/app/admin/conexoes");
    expect(await screen.findByRole("heading", { name: "Conexões" })).toBeDefined();
    expect(screen.queryByText(/\(mock\)/)).toBeNull();
  });
});
