"""
ports.py — contratos da plataforma (o que o BMoto PEDE a um provedor).

Regras de desenho:
- Só tipos neutros aqui (dataclasses + Protocols). Nada de httpx, nada de
  nome de fornecedor. Quem conhece a Celcoin é o adapter dela.
- Toda operação que move dinheiro recebe `idempotency_key` (nunca pagar/
  cobrar duas vezes).
- Métodos async: os provedores reais são HTTP.
- Um adapter pode não implementar tudo: `capabilities()` declara o que ele
  entrega e o registry recusa ligar um produto cujo port não cobre o
  necessário (ver registry.verificar()).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Protocol, runtime_checkable


# ---------------------------------------------------------------- tipos base

def _agora() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


class Capability(str, Enum):
    """O que um adapter sabe fazer. O registry cruza isso com os produtos."""
    # conta
    CONTA_ABRIR = "conta.abrir"
    CONTA_SALDO = "conta.saldo"
    CONTA_EXTRATO = "conta.extrato"
    PIX_ENVIAR = "pix.enviar"
    PIX_COBRAR = "pix.cobrar"
    PIX_AUTOMATICO = "pix.automatico"        # débito recorrente (Pix Automático)
    BOLETO_EMITIR = "boleto.emitir"
    # cartão
    CARTAO_EMITIR = "cartao.emitir"
    CARTAO_LIMITE = "cartao.limite"
    CARTAO_BLOQUEAR = "cartao.bloquear"
    # kyc
    KYC_VALIDAR = "kyc.validar"
    KYC_FACEMATCH = "kyc.facematch"
    # crédito (emissor/cessão)
    CREDITO_EMITIR_CCB = "credito.ccb"
    CREDITO_CEDER = "credito.cessao"
    # seguros / saúde
    SEGURO_COTAR = "seguro.cotar"
    SEGURO_EMITIR = "seguro.emitir"
    SEGURO_SINISTRO = "seguro.sinistro"
    SAUDE_COTAR = "saude.cotar"
    SAUDE_ADERIR = "saude.aderir"
    # contador (MEI)
    MEI_ABRIR = "mei.abrir"
    MEI_DAS = "mei.das"
    MEI_DASN = "mei.dasn"
    MEI_NFSE = "mei.nfse"
    # renda / open finance
    RENDA_CONSENTIR = "renda.consentir"
    RENDA_LER = "renda.ler"


@dataclass
class Pessoa:
    cpf: str
    nome: str
    nascimento: str                      # ISO date
    email: Optional[str] = None
    celular: Optional[str] = None
    cnpj_mei: Optional[str] = None
    endereco: dict = field(default_factory=dict)


@dataclass
class Conta:
    conta_id: str
    titular_cpf: str
    provider: str
    agencia: str = ""
    numero: str = ""
    chave_pix: Optional[str] = None
    status: str = "ATIVA"                # ATIVA | BLOQUEADA | ENCERRADA
    criada_em: str = field(default_factory=_agora)


@dataclass
class Lancamento:
    lancamento_id: str
    conta_id: str
    valor: float                         # + crédito / - débito
    descricao: str
    categoria: str = "outros"            # repasse_app | pix | boleto | tarifa | cartao
    ocorrido_em: str = field(default_factory=_agora)
    origem: Optional[str] = None         # ifood | rappi | 99 | ...


@dataclass
class Pagamento:
    pagamento_id: str
    conta_id: str
    valor: float
    destino: str                         # chave pix / linha digitável
    idempotency_key: str
    tipo: str = "pix"                    # pix | boleto
    status: str = "ENVIADO"              # ENVIADO | CONFIRMADO | FALHOU
    provider_tx_id: Optional[str] = None
    erro: Optional[str] = None
    criado_em: str = field(default_factory=_agora)


@dataclass
class Cobranca:
    cobranca_id: str
    conta_id: str
    valor: float
    vencimento: str
    tipo: str = "pix"                    # pix | boleto | pix_automatico
    payload: Optional[str] = None        # QR copia-e-cola / linha digitável
    status: str = "ABERTA"               # ABERTA | PAGA | VENCIDA | CANCELADA


@dataclass
class Cartao:
    cartao_id: str
    conta_id: str
    provider: str
    modalidade: str = "garantido"        # garantido (moto) | pre_pago | credito
    limite: float = 0.0
    garantia: Optional[dict] = None      # {"tipo": "moto", "placa": ..., "valor": ...}
    status: str = "ATIVO"
    ultimos4: str = "0000"


@dataclass
class ResultadoKyc:
    cpf: str
    aprovado: bool
    score: float                         # 0..1
    motivos: list[str] = field(default_factory=list)
    provider: str = ""
    consultado_em: str = field(default_factory=_agora)


@dataclass
class ContratoCredito:
    contrato_id: str
    cpf: str
    produto: str                         # financiamento_moto | consignado_clt | ...
    principal: float
    taxa_mensal: float
    parcelas: int
    parcela: float
    cet_anual: float
    ccb_url: Optional[str] = None
    status: str = "EMITIDO"              # EMITIDO | CEDIDO | LIQUIDADO | ATRASO
    cessionario: Optional[str] = None    # FIDC / fundo


@dataclass
class CotacaoSeguro:
    cotacao_id: str
    produto: str                         # vida_ap | moto | saude
    premio_mensal: float
    cobertura: dict
    seguradora: str
    valida_ate: str


@dataclass
class Apolice:
    apolice_id: str
    cotacao_id: str
    cpf: str
    produto: str
    premio_mensal: float
    seguradora: str
    vigencia_inicio: str
    vigencia_fim: str
    status: str = "ATIVA"


@dataclass
class GuiaDas:
    competencia: str                     # "2026-11"
    valor: float
    vencimento: str
    codigo_barras: str
    status: str = "ABERTA"               # ABERTA | PAGA | VENCIDA


@dataclass
class Mei:
    cnpj: str
    cpf: str
    razao_social: str
    cnae: str
    aberto_em: str
    status: str = "ATIVO"


@dataclass
class ConsentimentoRenda:
    consentimento_id: str
    cpf: str
    fonte: str                           # open_finance | ifood | rappi | 99 | uber
    status: str = "AUTORIZADO"
    expira_em: Optional[str] = None


@dataclass
class RendaMensal:
    competencia: str
    fonte: str
    bruto: float
    corridas: int = 0
    km: float = 0.0


@dataclass
class HealthStatus:
    provider: str
    port: str
    ok: bool
    latencia_ms: float = 0.0
    detalhe: str = ""


# ---------------------------------------------------------------- base comum

@runtime_checkable
class Provider(Protocol):
    """Todo adapter expõe isto. `nome` é o que aparece em /platform/providers."""
    nome: str
    port: str

    def capabilities(self) -> set[Capability]: ...
    async def health(self) -> HealthStatus: ...


# ---------------------------------------------------------------- ports

@runtime_checkable
class ContaProvider(Provider, Protocol):
    """BaaS de conta: abrir conta individual, saldo, extrato, Pix, boleto."""

    async def abrir_conta(self, pessoa: Pessoa) -> Conta: ...
    async def saldo(self, conta_id: str) -> float: ...
    async def extrato(self, conta_id: str, desde: Optional[str] = None) -> list[Lancamento]: ...
    async def pix_enviar(self, conta_id: str, valor: float, chave: str,
                         idempotency_key: str) -> Pagamento: ...
    async def cobrar(self, conta_id: str, valor: float, vencimento: str,
                     tipo: str = "pix") -> Cobranca: ...
    async def creditar(self, conta_id: str, valor: float, descricao: str,
                       origem: Optional[str] = None,
                       idempotency_key: Optional[str] = None) -> Lancamento:
        """Entrada de repasse (app de entrega, cashback). No real é webhook."""
        ...


@runtime_checkable
class CartaoProvider(Provider, Protocol):
    async def emitir(self, conta_id: str, modalidade: str, limite: float,
                     garantia: Optional[dict] = None) -> Cartao: ...
    async def ajustar_limite(self, cartao_id: str, limite: float) -> Cartao: ...
    async def bloquear(self, cartao_id: str, motivo: str) -> Cartao: ...


@runtime_checkable
class KycProvider(Provider, Protocol):
    async def validar(self, pessoa: Pessoa, selfie_b64: Optional[str] = None,
                      documento_b64: Optional[str] = None) -> ResultadoKyc: ...


@runtime_checkable
class CreditoProvider(Provider, Protocol):
    """Emissor (SCD/parceiro) e cessão para FIDC."""

    async def emitir_ccb(self, cpf: str, produto: str, principal: float,
                         taxa_mensal: float, parcelas: int,
                         idempotency_key: str) -> ContratoCredito: ...
    async def ceder(self, contrato_id: str, cessionario: str) -> ContratoCredito: ...


@runtime_checkable
class SeguroProvider(Provider, Protocol):
    async def cotar(self, pessoa: Pessoa, produto: str, params: dict) -> CotacaoSeguro: ...
    async def emitir(self, cotacao_id: str, cpf: str) -> Apolice: ...
    async def sinistro(self, apolice_id: str, descricao: str) -> dict: ...


@runtime_checkable
class SaudeProvider(Provider, Protocol):
    """Plano coletivo por adesão / empresarial via MEI. Mesma forma do seguro,
    separado porque regulador (ANS) e parceiro são outros."""

    async def cotar(self, pessoa: Pessoa, params: dict) -> CotacaoSeguro: ...
    async def aderir(self, cotacao_id: str, pessoa: Pessoa) -> Apolice: ...


@runtime_checkable
class ContadorProvider(Provider, Protocol):
    """Abertura e rotina da MEI (Integra Contador/Serpro ou contabilidade parceira)."""

    async def abrir_mei(self, pessoa: Pessoa, cnae: str) -> Mei: ...
    async def das(self, cnpj: str, competencia: str) -> GuiaDas: ...
    async def dasn(self, cnpj: str, ano: int, receita_bruta: float) -> dict: ...
    async def emitir_nfse(self, cnpj: str, tomador: dict, valor: float,
                          descricao: str) -> dict: ...


@runtime_checkable
class RendaProvider(Provider, Protocol):
    """Leitura de renda: Open Finance (via participante) ou integração com app."""

    async def consentir(self, cpf: str, fonte: str) -> ConsentimentoRenda: ...
    async def renda(self, consentimento_id: str, meses: int = 3) -> list[RendaMensal]: ...


# Nome do port -> Protocol. É o que o registry usa para validar um adapter.
PORTS: dict[str, type] = {
    "conta": ContaProvider,
    "cartao": CartaoProvider,
    "kyc": KycProvider,
    "credito": CreditoProvider,
    "seguro": SeguroProvider,
    "saude": SaudeProvider,
    "contador": ContadorProvider,
    "renda": RendaProvider,
}
