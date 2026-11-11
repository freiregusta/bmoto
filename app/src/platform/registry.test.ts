/**
 * O contrato que sustenta a flexibilidade do app: módulo com tela registrada
 * usa a tela; sem tela, roda a jornada. Nada enumera produto em código.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _limparRegistro, idsRegistrados, obterModulo, registrarModulo, registrarModulos,
  temTelaDedicada,
} from "./registry";
import { registrarTodosOsModulos } from "@/modules";
import { CATALOGO_LOCAL } from "./catalogo-local";

const Falsa = () => null;

describe("registro de módulos", () => {
  beforeEach(() => _limparRegistro());

  it("resolve a tela pelo id do manifesto", () => {
    registrarModulo({ id: "moto", Component: Falsa });
    expect(temTelaDedicada("moto")).toBe(true);
    expect(obterModulo("moto")?.Component).toBe(Falsa);
  });

  it("módulo sem tela cai no fluxo genérico de jornada", () => {
    expect(temTelaDedicada("cartao")).toBe(false);
    expect(obterModulo("cartao")).toBeUndefined();
  });

  it("permite substituir a tela de um módulo, avisando no console", () => {
    const aviso = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const Nova = () => null;
    registrarModulo({ id: "conta", Component: Falsa });
    registrarModulo({ id: "conta", Component: Nova });
    expect(obterModulo("conta")?.Component).toBe(Nova);
    expect(aviso).toHaveBeenCalledOnce();
    aviso.mockRestore();
  });

  it("registra em lote", () => {
    registrarModulos([{ id: "a", Component: Falsa }, { id: "b", Component: Falsa }]);
    expect(idsRegistrados()).toEqual(["a", "b"]);
  });
});

describe("telas do produto", () => {
  beforeEach(() => {
    _limparRegistro();
    registrarTodosOsModulos();
  });

  it("só tem tela dedicada o que é real hoje", () => {
    expect(idsRegistrados()).toEqual(["credito", "ganhos", "margem"]);
  });

  it("todo id registrado existe no catálogo", () => {
    const doCatalogo = new Set(CATALOGO_LOCAL.map((m: { id: string }) => m.id));
    idsRegistrados().forEach((id) => expect(doCatalogo.has(id)).toBe(true));
  });

  it("o que depende de fornecedor não tem tela própria", () => {
    ["conta", "mei", "moto", "cartao", "seguro", "saude"].forEach((id) =>
      expect(temTelaDedicada(id)).toBe(false));
  });

  it("e aparece no catálogo como não pronto, nunca como disponível", () => {
    const dependentes = CATALOGO_LOCAL.filter(
      (m: { requisitos: unknown[] }) => m.requisitos.length > 0);
    expect(dependentes.length).toBeGreaterThan(0);
    dependentes.forEach((m: { pronto: boolean }) => expect(m.pronto).toBe(false));
  });
});
