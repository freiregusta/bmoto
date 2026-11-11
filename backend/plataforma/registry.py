"""
registry.py — quem atende cada port e quais produtos estão ligados.

Seleção por env, um por port (todos com default `mock`):

    BAAS_CONTA_PROVIDER=mock|celcoin
    BAAS_CARTAO_PROVIDER=mock
    KYC_PROVIDER=mock
    CREDITO_PROVIDER=mock
    SEGURO_PROVIDER=mock
    SAUDE_PROVIDER=mock
    CONTADOR_PROVIDER=mock
    RENDA_PROVIDER=mock

Para plugar um fornecedor novo:
    1. escreva a classe em adapters/<fornecedor>.py implementando o Protocol;
    2. registre: `plataforma.providers.registrar("conta", "dock", DockContaProvider)`;
    3. mude a env. Nada mais no app muda.

`verificar()` cruza os produtos ligados com as capabilities do adapter ativo e
devolve o que falta — para não ligar "cartão" com um BaaS que não emite cartão.
"""

from __future__ import annotations

import os
from typing import Callable, Optional

from .ports import PORTS, Capability, HealthStatus, Provider
from .produtos import PRODUTOS, ProdutoManifest

Factory = Callable[[], Provider]

ENV_POR_PORT: dict[str, str] = {
    "conta": "BAAS_CONTA_PROVIDER",
    "cartao": "BAAS_CARTAO_PROVIDER",
    "kyc": "KYC_PROVIDER",
    "credito": "CREDITO_PROVIDER",
    "seguro": "SEGURO_PROVIDER",
    "saude": "SAUDE_PROVIDER",
    "contador": "CONTADOR_PROVIDER",
    "renda": "RENDA_PROVIDER",
}


class ProviderRegistry:
    def __init__(self, consultar_catalogo: bool = True) -> None:
        self._factories: dict[str, dict[str, Factory]] = {p: {} for p in PORTS}
        self._cache: dict[str, Provider] = {}
        # Desligável para testes de unidade que não querem tocar o banco.
        self.consultar_catalogo = consultar_catalogo

    # -- registro ----------------------------------------------------------
    def registrar(self, port: str, nome: str, factory: Factory) -> None:
        if port not in PORTS:
            raise KeyError(f"port desconhecido: {port}")
        self._factories[port][nome] = factory
        self._cache.pop(port, None)

    def disponiveis(self, port: str) -> list[str]:
        return sorted(self._factories[port])

    # -- resolução ---------------------------------------------------------
    def nome_ativo(self, port: str) -> str:
        return os.getenv(ENV_POR_PORT[port], "mock").strip().lower()

    def resolver(self, port: str, produto_id: Optional[str] = None) -> Provider:
        """Ordem: conexão cadastrada no admin > variável de ambiente > mock."""
        if self.consultar_catalogo:
            from .catalogo import catalogo
            prov = catalogo.provider(port, produto_id)
            if prov is not None:
                return prov
        nome = self.nome_ativo(port)
        chave = f"{port}:{nome}"
        if chave in self._cache:
            return self._cache[chave]
        try:
            factory = self._factories[port][nome]
        except KeyError:
            raise LookupError(
                f"Nenhum adapter '{nome}' para o port '{port}'. "
                f"Disponíveis: {self.disponiveis(port)} (env {ENV_POR_PORT[port]})"
            )
        inst = factory()
        proto = PORTS[port]
        if not isinstance(inst, proto):
            raise TypeError(f"{type(inst).__name__} não implementa {proto.__name__}")
        self._cache[chave] = inst
        return inst

    def limpar_cache(self) -> None:
        self._cache.clear()

    def tabela(self) -> list[dict]:
        out = []
        for p in PORTS:
            linha = {"port": p, "env": ENV_POR_PORT[p], "disponiveis": self.disponiveis(p),
                     "ativo": self.nome_ativo(p), "origem": "env" if os.getenv(ENV_POR_PORT[p])
                     else "default"}
            if self.consultar_catalogo:
                from .catalogo import catalogo
                c = catalogo.conexao_ativa(p)
                if c:
                    linha.update({"ativo": c.titulo or c.tipo, "origem": "admin",
                                  "conexao_id": c.id, "tipo": c.tipo, "ambiente": c.ambiente})
            out.append(linha)
        return out

    async def health(self) -> list[HealthStatus]:
        out: list[HealthStatus] = []
        for port in PORTS:
            try:
                out.append(await self.resolver(port).health())
            except Exception as e:  # adapter ausente ou quebrado não derruba o endpoint
                out.append(HealthStatus(provider=self.nome_ativo(port), port=port,
                                        ok=False, detalhe=str(e)))
        return out


class ProductRegistry:
    def __init__(self, manifestos: Optional[list[ProdutoManifest]] = None) -> None:
        self._por_id: dict[str, ProdutoManifest] = {m.id: m for m in (manifestos or PRODUTOS)}

    def registrar(self, m: ProdutoManifest) -> None:
        self._por_id[m.id] = m

    def todos(self) -> list[ProdutoManifest]:
        return sorted(self._por_id.values(), key=lambda m: m.ordem)

    def ativos(self) -> list[ProdutoManifest]:
        return [m for m in self.todos() if m.ligado()]

    def get(self, produto_id: str) -> ProdutoManifest:
        return self._por_id[produto_id]

    def ligado(self, produto_id: str) -> bool:
        m = self._por_id.get(produto_id)
        return bool(m and m.ligado())


class Plataforma:
    """Fachada: `plataforma.conta()` etc. + verificação de consistência."""

    def __init__(self, com_padrao: bool = True) -> None:
        self.providers = ProviderRegistry()
        self.produtos = ProductRegistry()
        if com_padrao:
            _registrar_padrao(self)

    # atalhos tipados (o IDE completa o Protocol certo).
    # `produto_id` permite um fornecedor diferente por módulo.
    def conta(self, produto_id=None):     return self.providers.resolver("conta", produto_id)
    def cartao(self, produto_id=None):    return self.providers.resolver("cartao", produto_id)
    def kyc(self, produto_id=None):       return self.providers.resolver("kyc", produto_id)
    def credito(self, produto_id=None):   return self.providers.resolver("credito", produto_id)
    def seguro(self, produto_id=None):    return self.providers.resolver("seguro", produto_id)
    def saude(self, produto_id=None):     return self.providers.resolver("saude", produto_id)
    def contador(self, produto_id=None):  return self.providers.resolver("contador", produto_id)
    def renda(self, produto_id=None):     return self.providers.resolver("renda", produto_id)

    # -- manifestos efetivos (código + admin + env) ------------------------
    def manifestos(self) -> list[dict]:
        if not self.providers.consultar_catalogo:
            return [m.to_dict() | {"origem_flag": "codigo"} for m in self.produtos.todos()]
        from .catalogo import catalogo
        ms = [catalogo.manifesto_efetivo(m) for m in self.produtos.todos()]
        return sorted(ms, key=lambda d: d["ordem"])

    def verificar(self) -> list[dict]:
        """Para cada módulo LIGADO, o que o fornecedor ativo não entrega."""
        pendencias: list[dict] = []
        for d in self.manifestos():
            if not d["enabled"]:
                continue
            for req in self.produtos.get(d["id"]).requisitos:
                try:
                    prov = self.providers.resolver(req.port, d["id"])
                except Exception as e:
                    pendencias.append({"produto": d["id"], "port": req.port, "erro": str(e)})
                    continue
                faltam = [c.value for c in req.capabilities if c not in prov.capabilities()]
                if faltam:
                    pendencias.append({"produto": d["id"], "port": req.port,
                                       "provider": prov.nome, "faltam": faltam})
        return pendencias

    def modulos(self) -> list[dict]:
        """Payload que o super app consome para montar navegação e flags."""
        pend = {(p["produto"], p["port"]) for p in self.verificar()}
        out = []
        for d in self.manifestos():
            m = self.produtos.get(d["id"])
            d = dict(d)
            d["providers"] = {}
            for r in m.requisitos:
                try:
                    d["providers"][r.port] = self.providers.resolver(r.port, m.id).nome
                except Exception:
                    d["providers"][r.port] = None
            d["pronto"] = d["enabled"] and not any((m.id, r.port) in pend for r in m.requisitos)
            out.append(d)
        return out


def _registrar_padrao(p: Plataforma) -> None:
    # Import tardio: adapters importam ports, não o contrário.
    from .adapters import mock, celcoin
    for port in PORTS:
        p.providers.registrar(port, "mock", mock.FACTORIES[port])
    p.providers.registrar("conta", "celcoin", celcoin.CelcoinContaProvider)


plataforma = Plataforma()
_registrar_padrao(plataforma)
