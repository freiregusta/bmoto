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
import { MODULOS_DEMO } from "./demo";

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

  it("tem tela dedicada para conta, ganhos, margem e MEI", () => {
    expect(idsRegistrados()).toEqual(["conta", "ganhos", "margem", "mei"]);
  });

  it("todo id registrado existe como módulo da plataforma", () => {
    const idsDaPlataforma = new Set(MODULOS_DEMO.map((m) => m.id));
    idsRegistrados().forEach((id) => expect(idsDaPlataforma.has(id)).toBe(true));
  });

  it("os módulos de crédito e seguro rodam pela jornada, de propósito", () => {
    ["moto", "cartao", "seguro", "saude"].forEach((id) =>
      expect(temTelaDedicada(id)).toBe(false));
  });
});
