/** Ambiente dos testes de interface: localStorage limpo e sem rede real. */
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Sem backend: o app cai no modo demo, que é o que os testes exercitam.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("sem rede nos testes"))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
