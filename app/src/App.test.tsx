/**
 * Teste de integração da interface: sem backend, no modo demo.
 *
 * O que ele prova é a tese da arquitetura — a navegação e as telas saem dos
 * manifestos, e um módulo sem tela dedicada é vendido pela jornada.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "./App";

const abrir = (rota: string) =>
  render(
    <MemoryRouter initialEntries={[rota]}>
      <App />
    </MemoryRouter>,
  );

describe("super app", () => {
  it("monta a tela inicial a partir dos módulos ligados", async () => {
    abrir("/app");
    expect(await screen.findByRole("heading", { name: "João" })).toBeDefined();
    // módulos com resumo próprio
    expect(await screen.findByText("Líquido real no mês")).toBeDefined();
    expect(screen.getByText("Abra sua conta BMoto")).toBeDefined();
    // atalhos dos módulos sem tela dedicada
    expect(screen.getByText("Financiamento de moto")).toBeDefined();
    expect(screen.getByText("Cartão com garantia da moto")).toBeDefined();
    // o consignado está desligado: aparece como "em breve", não como produto
    const emBreve = screen.getByText("Em breve").closest("section")!;
    expect(within(emBreve).queryByText(/Consignado CLT/)).toBeNull();
  });

  it("avisa que está em modo demonstração quando não há backend", async () => {
    abrir("/app");
    expect(await screen.findByTitle(/Backend não encontrado/)).toBeDefined();
  });

  it("um módulo sem tela dedicada é vendido pela jornada configurada", async () => {
    const usuario = userEvent.setup();
    abrir("/app/moto");

    expect(await screen.findByRole("heading", { name: "Financiamento de moto" })).toBeDefined();
    // primeiro passo da jornada do seed: conectar apps
    expect(await screen.findByText("Conecte seus apps")).toBeDefined();
    // 9 passos no total, mas o do seguro é condicional e ainda não é elegível
    expect(screen.getByText(/Passo 1 de 8/)).toBeDefined();

    await usuario.click(screen.getByRole("button", { name: /iFood/ }));
    await usuario.click(screen.getByRole("button", { name: /^Conectar/ }));

    // renda é passo automático: avança sozinho e chega no formulário da moto
    expect(await screen.findByText("A moto", {}, { timeout: 3000 })).toBeDefined();
    expect(screen.getByText("Valor da moto")).toBeDefined();
  });

  it("módulo desligado explica em vez de dar erro", async () => {
    abrir("/app/consignado_clt");
    expect(await screen.findByText(/ainda não está no ar/)).toBeDefined();
  });

  it("módulo inexistente não quebra a navegação", async () => {
    abrir("/app/cripto");
    expect(await screen.findByText("Produto não encontrado")).toBeDefined();
  });

  it("a tela da margem calcula a corrida na hora", async () => {
    const usuario = userEvent.setup();
    abrir("/app/margem");

    await usuario.click(await screen.findByRole("button", { name: "Vale a pena?" }));
    await usuario.type(screen.getByPlaceholderText("12,50"), "12,50");
    await usuario.type(screen.getByPlaceholderText("7,2"), "7");

    expect(await screen.findByText("Vale a pena")).toBeDefined();
    expect(screen.getByText("Seu custo")).toBeDefined();
  });
});

describe("painel de administração", () => {
  it("mostra o estado da plataforma", async () => {
    abrir("/app/admin");
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeDefined();
    expect(await screen.findByText("Módulos ligados")).toBeDefined();
    expect(screen.getByText(/Nenhuma. Todo módulo ligado tem fornecedor capaz./)).toBeDefined();
  });

  it("lista as conexões por capacidade e oferece o cadastro sem código", async () => {
    const usuario = userEvent.setup();
    abrir("/app/admin/conexoes");

    expect(await screen.findByRole("heading", { name: "Conexões" })).toBeDefined();
    expect(await screen.findByText(/Port "conta"/)).toBeDefined();

    await usuario.click(screen.getByRole("button", { name: /Nova conexão/ }));
    expect(await screen.findByRole("heading", { name: "Nova conexão" })).toBeDefined();

    // o formulário vem dos campos que o backend declara para o tipo REST
    await usuario.selectOptions(screen.getByLabelText(/Fornecedor/),
                                "rest");
    expect(await screen.findByText("URL base da API")).toBeDefined();
    expect(screen.getByText("Operações")).toBeDefined();
    // escopo por módulo é o que permite um BaaS diferente por produto
    const escopo = screen.getByLabelText(/Onde vale/) as HTMLSelectElement;
    const opcoes = [...escopo.options].map((o) => o.value);
    expect(opcoes).toContain("produto:cartao");
    expect(opcoes).toContain("produto:moto");
  });

  it("deixa montar uma jornada passo a passo", async () => {
    const usuario = userEvent.setup();
    abrir("/app/admin/jornadas");

    expect(await screen.findByRole("heading", { name: "Jornadas" })).toBeDefined();
    await usuario.click(screen.getByRole("button", { name: /Nova jornada/ }));
    await usuario.click(screen.getByRole("button", { name: /Ler renda/ }));
    await usuario.click(screen.getByRole("button", { name: /Oferta/ }));

    expect(screen.getByDisplayValue("Analisando seus ganhos")).toBeDefined();
    expect(screen.getByDisplayValue("Sua oferta")).toBeDefined();
    // o editor do passo de oferta lista os produtos de crédito cadastrados
    expect(screen.getAllByText("Financiamento de moto nova").length)
      .toBeGreaterThan(0);
  });
});
