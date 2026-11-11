/** Ambiente dos testes de interface: localStorage limpo e sem rede real. */
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Sem backend: os testes exercitam exatamente o caminho local — o que o
  // entregador lança continua funcionando, o resto aparece como indisponível.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("sem rede nos testes"))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
