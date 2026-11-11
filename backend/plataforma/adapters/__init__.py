"""
adapters — implementações dos ports + catálogo do que o admin pode cadastrar.

Três famílias:

- `mock`: tudo em memória, sem credencial. Demo e testes.
- `rest`: adapter genérico configurado por JSON (adapters/rest.py). É com ele
  que o admin cadastra um fornecedor NOVO sem passar por deploy.
- nativos (`celcoin`, ...): código dedicado, quando a API é peculiar demais
  para o genérico.

`CATALOGO` descreve cada combinação (tipo, port) e os campos que a tela de
admin precisa pedir. `construir()` instancia a partir do tipo + config.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from ..ports import PORTS, Capability
from . import mock, rest


@dataclass(frozen=True)
class CampoConfig:
    chave: str
    titulo: str
    tipo: str = "texto"              # texto | url | json | numero | segredo_env | select
    obrigatorio: bool = False
    ajuda: str = ""
    opcoes: tuple[str, ...] = ()
    default: Any = None


@dataclass(frozen=True)
class AdapterSpec:
    tipo: str                        # mock | rest | celcoin | ...
    titulo: str
    ports: tuple[str, ...]           # ports que esse tipo atende
    descricao: str = ""
    campos: tuple[CampoConfig, ...] = ()
    sem_codigo: bool = False         # True = cadastrável 100% pela tela
    simulado: bool = False           # True = INVENTA resposta; nunca em produção
    capabilities_fixas: Optional[tuple[Capability, ...]] = None

    def to_dict(self) -> dict:
        return {"tipo": self.tipo, "titulo": self.titulo, "ports": list(self.ports),
                "descricao": self.descricao, "sem_codigo": self.sem_codigo,
                "simulado": self.simulado,
                "campos": [{"chave": c.chave, "titulo": c.titulo, "tipo": c.tipo,
                            "obrigatorio": c.obrigatorio, "ajuda": c.ajuda,
                            "opcoes": list(c.opcoes), "default": c.default}
                           for c in self.campos]}


CAMPOS_REST: tuple[CampoConfig, ...] = (
    CampoConfig("base_url", "URL base da API", "url", True,
                "Ex.: https://sandbox.fornecedor.com — sem barra no fim."),
    CampoConfig("auth", "Autenticação", "json", True,
                'Ex.: {"tipo":"oauth2_client_credentials","token_url":"/oauth/token",'
                '"env_client_id":"FORN_ID","env_client_secret":"FORN_SECRET"}. '
                'Tipos: nenhum, api_key, basic, oauth2_client_credentials. '
                'Segredos entram pelo NOME da variável de ambiente, nunca pelo valor.'),
    CampoConfig("operacoes", "Operações", "json", True,
                "Mapa operação -> {metodo, path, body, query, resposta}. "
                "As operações declaradas definem o que esse fornecedor passa a oferecer."),
    CampoConfig("headers", "Headers fixos", "json", False, 'Ex.: {"x-canal":"bmoto"}'),
    CampoConfig("idempotencia", "Idempotência", "json", False,
                'Ex.: {"header":"x-idempotency-key"}'),
    CampoConfig("health", "Checagem de saúde", "json", False,
                'Ex.: {"metodo":"GET","path":"/v1/ping"}'),
    CampoConfig("timeout_s", "Timeout (s)", "numero", False, default=20),
)

CAMPOS_OPEN_FINANCE: tuple[CampoConfig, ...] = (
    CampoConfig("modo", "Como consumimos", "select", True,
                "direto = a instituição autorizada transmite; agregador = participante "
                "contratado (Klavi, Belvo, Pluggy) expõe a mesma informação.",
                opcoes=("direto", "agregador"), default="direto"),
    CampoConfig("base_url", "URL base", "url", True,
                "Do transmissor (direto) ou do agregador."),
    CampoConfig("auth", "Autenticação", "json", True,
                'Ex.: {"token_url":"/token","env_client_id":"OF_CLIENT_ID",'
                '"env_client_secret":"OF_CLIENT_SECRET","scope":"consents accounts resources"}'),
    CampoConfig("env_certificado", "Variável com o certificado mTLS", "segredo_env", False,
                "O ecossistema exige mTLS. Guarde o CAMINHO do arquivo nesta variável."),
    CampoConfig("env_chave_privada", "Variável com a chave privada", "segredo_env", False),
    CampoConfig("url_autorizacao", "Modelo da URL de autorização", "texto", False,
                "Use {consentimento_id} onde entra o id. É para onde o entregador vai "
                "autorizar no banco dele."),
    CampoConfig("permissoes", "Permissões do consentimento", "json", False,
                'Default: contas, saldos, transações e recursos.'),
    CampoConfig("validade_dias", "Validade do consentimento (dias)", "numero", False,
                "O ecossistema permite até 12 meses.", default=365),
    CampoConfig("path_consentimento", "Caminho do consentimento", "texto", False,
                default="/consents/v3/consents"),
    CampoConfig("path_contas", "Caminho das contas", "texto", False,
                default="/accounts/v2/accounts"),
    CampoConfig("path_transacoes", "Caminho das transações", "texto", False,
                default="/accounts/v2/accounts/{conta_id}/transactions"),
)

CAMPOS_CELCOIN: tuple[CampoConfig, ...] = (
    CampoConfig("env_base_url", "Variável com a URL base", "segredo_env", False,
                "Default: BAAS_BASE_URL", default="BAAS_BASE_URL"),
    CampoConfig("env_client_id", "Variável com o client id", "segredo_env", False,
                default="BAAS_CLIENT_ID"),
    CampoConfig("env_client_secret", "Variável com o secret", "segredo_env", False,
                default="BAAS_CLIENT_SECRET"),
)

CATALOGO: tuple[AdapterSpec, ...] = (
    AdapterSpec("mock", "Simulador (apenas testes)", tuple(PORTS),
                "INVENTA as respostas. Serve para testes automatizados e nada mais: "
                "nenhum número que sai daqui é real, então não vai para a mão de "
                "entregador nenhum. Em produção, um port sem fornecedor responde 503.",
                simulado=True),
    AdapterSpec("rest", "REST genérico (cadastro pela tela)", tuple(PORTS),
                "Descreva a API do fornecedor em JSON e ele passa a atender o módulo. "
                "Nenhum deploy necessário.", CAMPOS_REST, sem_codigo=True),
    AdapterSpec("open_finance", "Open Finance (renda comprovada)", ("renda",),
                "Lê, com consentimento do entregador, os repasses que as plataformas "
                "depositam na conta dele. Não depende de API do iFood ou do 99: depende "
                "do extrato, que é dele. Atende tanto a instituição transmissora quanto "
                "um agregador contratado.", CAMPOS_OPEN_FINANCE),
    AdapterSpec("celcoin", "Celcoin (BaaS)", ("conta",),
                "Adapter nativo: conta individual, Pix e cobrança.", CAMPOS_CELCOIN),
)

SPECS: dict[str, AdapterSpec] = {s.tipo: s for s in CATALOGO}


def tipos_para_port(port: str) -> list[AdapterSpec]:
    return [s for s in CATALOGO if port in s.ports]


def construir(tipo: str, port: str, config: Optional[dict] = None, nome: Optional[str] = None):
    """Instancia um provider a partir do tipo + config do catálogo."""
    config = config or {}
    nome = nome or tipo
    spec = SPECS.get(tipo)
    if not spec:
        raise KeyError(f"tipo de adapter desconhecido: '{tipo}'")
    if port not in spec.ports:
        raise KeyError(f"adapter '{tipo}' não atende o port '{port}'")
    if tipo == "mock":
        inst = mock.FACTORIES[port]()
        inst.nome = nome                 # mostra o título do cadastro, não "mock"
        return inst
    if tipo == "rest":
        return rest.construir(port, config, nome)
    if tipo == "open_finance":
        from .openfinance import OpenFinanceRendaProvider
        return OpenFinanceRendaProvider(config, nome)
    if tipo == "celcoin":
        from .celcoin import CelcoinContaProvider
        return CelcoinContaProvider()
    raise KeyError(f"tipo '{tipo}' sem construtor")


__all__ = ["AdapterSpec", "CampoConfig", "CATALOGO", "SPECS", "construir",
           "tipos_para_port", "mock", "rest"]
