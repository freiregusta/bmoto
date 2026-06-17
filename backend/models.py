"""
models.py — Modelos de domínio da esteira do Crédito do Trabalhador.

Espelham os dados que chegam da Dataprev (margem, vínculo, FGTS, SCR) e os
artefatos produzidos pelos motores (decisão de crédito, precificação, proposta).
"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List
import datetime as dt


class Vinculo(str, Enum):
    CLT = "CLT"
    DOMESTICO = "DOMESTICO"
    RURAL = "RURAL"
    MEI = "MEI"


class DecisionStatus(str, Enum):
    APPROVED = "APPROVED"
    DECLINED = "DECLINED"


class AuctionStatus(str, Enum):
    APPROVED = "APPROVED"   # venceu o leilão e foi ao tomador
    DENIED = "DENIED"       # não selecionada
    ERROR = "ERROR"         # venceu, mas Dataprev falhou no envio


@dataclass
class WorkerData:
    """Pacote de dados do tomador exposto pela plataforma (via Dataprev/eSocial/
    FGTS Digital) após o consentimento na CTPS Digital."""
    cpf: str
    nome: str
    idade: int
    vinculo: Vinculo
    empregador_cnpj: str
    renda_liquida: float
    margem_disponivel: float          # R$/mês livres para consignação
    meses_de_empresa: int
    fgts_saldo: float                 # saldo total do FGTS
    multa_rescisoria_pct: float = 0.40  # 40% sobre saldo (garantia adicional)
    # Anti-superendividamento (consulta SCR obrigatória antes de ofertar):
    possui_consignado_ativo: bool = False
    parcelas_consignado_ativas: float = 0.0
    comprometimento_renda_total: float = 0.0  # 0..1 (DTI já existente)

    @property
    def fgts_garantia(self) -> float:
        """Garantia mobilizável no CT: parcela do saldo + multa rescisória.
        Configurável; default conservador de 10% do saldo + multa."""
        return 0.10 * self.fgts_saldo + self.multa_rescisoria_pct * self.fgts_saldo


@dataclass
class CreditRequest:
    """Solicitação distribuída ao originador no leilão."""
    proposal_id: str
    worker: WorkerData
    valor_solicitado: Optional[float] = None   # liberado desejado (None = maximizar)
    prazo_meses: int = 24
    received_at: dt.datetime = field(default_factory=dt.datetime.utcnow)


@dataclass
class CreditDecision:
    status: DecisionStatus
    pd: float = 0.0                  # probabilidade de default (0..1)
    score: float = 0.0
    parcela_maxima: float = 0.0      # teto de parcela pela margem/política
    valor_maximo: float = 0.0        # liberado máximo aprovado
    reasons: List[str] = field(default_factory=list)

    @property
    def approved(self) -> bool:
        return self.status == DecisionStatus.APPROVED


@dataclass
class PricingResult:
    liberado: float
    principal_financiado: float
    parcela: float
    prazo_meses: int
    taxa_am: float                   # juros nominal mensal (decimal)
    taxa_aa: float
    iof: float
    seguro: float
    cet_am: float
    cet_aa: float
    # decomposição do preço (cost-plus), em % a.m.
    componentes: dict = field(default_factory=dict)
    feasible: bool = True
    notes: List[str] = field(default_factory=list)


@dataclass
class Proposal:
    """Payload da oferta enviada ao leilão (espelha o contrato da API)."""
    proposal_id: str
    installment_quantity: int
    installment_amount: float
    available_balance: float
    amount: float
    iof: float
    annual_tax: float
    cet: float
    interest_tax: float
    monthly_cet: float
    insurance_amount: float
    entry_url: str = ""

    def to_api_payload(self) -> dict:
        return {
            "installment_quantity": self.installment_quantity,
            "installment_amount": round(self.installment_amount, 2),
            "available_balance": round(self.available_balance, 2),
            "amount": round(self.amount, 2),
            "iof": round(self.iof, 2),
            "annual_tax": round(self.annual_tax * 100, 4),
            "cet": round(self.cet * 100, 4),
            "interest_tax": round(self.interest_tax * 100, 4),
            "monthly_cet": round(self.monthly_cet * 100, 4),
            "insurance_amount": round(self.insurance_amount, 2),
            "entry_url": self.entry_url,
        }


@dataclass
class AuctionResult:
    proposal_id: str
    status: AuctionStatus
    timestamp: dt.datetime = field(default_factory=dt.datetime.utcnow)
    error_message: str = ""
