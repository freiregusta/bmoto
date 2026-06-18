"""
credit/models.py — Modelos de domínio do módulo de crédito.

Tudo que entra e sai dos adapters, scorecard e decision engine
é expresso nesses tipos. Os adapters nunca se conhecem entre si.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List
import datetime as dt


# ─────────────────────────────────────────────────────────────────────────────
# Enums
# ─────────────────────────────────────────────────────────────────────────────

class CategoriaWorker(str, Enum):
    CLT          = "CLT"
    DOMESTICO    = "DOMESTICO"
    RURAL        = "RURAL"
    MEI          = "MEI"
    DESCONHECIDO = "DESCONHECIDO"


class SituacaoEmprego(str, Enum):
    ATIVO         = "ATIVO"
    AFASTADO      = "AFASTADO"  # férias, licença, INSS
    AVISO_PREVIO  = "AVISO_PREVIO"
    DESLIGADO     = "DESLIGADO"
    DESCONHECIDO  = "DESCONHECIDO"


class DecisaoStatus(str, Enum):
    APROVADO  = "APROVADO"
    REPROVADO = "REPROVADO"
    PENDENTE  = "PENDENTE"   # bureau indisponível, aguarda retry


# ─────────────────────────────────────────────────────────────────────────────
# Dados do tomador (payload Dataprev via BaaS)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DadosEmpregador:
    cnpj: str
    nome: str
    codigo_inscricao: str = ""


@dataclass
class EmprestimoVincendo:
    """Dívida ativa com parcelas vincendas (consignado ou pessoal)."""
    modalidade: str           # "CONSIGNADO" | "PESSOAL"
    saldo_devedor: float
    parcela_mensal: float
    parcelas_restantes: int
    credor: str = ""


@dataclass
class DadosDataprev:
    """Payload completo da consulta de margem (Dataprev/eSocial via BaaS).
    Campos mapeados da documentação Celcoin/developers.celcoin.com.br."""
    cpf: str
    nome: str
    data_nascimento: dt.date
    sexo: str                                    # "M" | "F"
    categoria: CategoriaWorker
    pep: bool                                    # Pessoa Exposta Politicamente
    elegivel: bool
    motivo_inelegibilidade: str = ""

    # Vínculo
    empregador: Optional[DadosEmpregador] = None
    matricula: str = ""
    data_admissao: Optional[dt.date] = None
    data_desligamento: Optional[dt.date] = None
    situacao: SituacaoEmprego = SituacaoEmprego.ATIVO

    # Financeiro
    valor_total_vencimentos: float = 0.0         # renda bruta
    valor_base_margem: float = 0.0               # base de cálculo da margem
    valor_margem_disponivel: float = 0.0         # teto de parcela mensal
    quantidade_emprestimos_ativos: int = 0

    # Dívidas vincendas
    emprestimos: List[EmprestimoVincendo] = field(default_factory=list)

    @property
    def meses_empresa(self) -> int:
        if not self.data_admissao:
            return 0
        ref = self.data_desligamento or dt.date.today()
        delta = (ref.year - self.data_admissao.year) * 12 + \
                (ref.month - self.data_admissao.month)
        return max(delta, 0)

    @property
    def parcelas_consignado_ativas(self) -> float:
        return sum(e.parcela_mensal for e in self.emprestimos
                   if e.modalidade == "CONSIGNADO")

    @property
    def parcelas_pessoal_ativas(self) -> float:
        return sum(e.parcela_mensal for e in self.emprestimos
                   if e.modalidade == "PESSOAL")

    @property
    def dti_atual(self) -> float:
        """Comprometimento de renda atual (dívidas vincendas / renda bruta)."""
        if not self.valor_total_vencimentos:
            return 0.0
        total = self.parcelas_consignado_ativas + self.parcelas_pessoal_ativas
        return total / self.valor_total_vencimentos


# ─────────────────────────────────────────────────────────────────────────────
# Dados do Serasa (bureau comportamental)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DadosSerasa:
    cpf: str
    score: int                    # 0..1000
    negativacoes_ativas: int      # SPC, protestos, dívidas vencidas
    acoes_judiciais: int
    cheques_sem_fundo: int
    meses_sem_negativacao: int    # 0 se tem negativação ativa
    consultado_em: dt.datetime = field(default_factory=dt.datetime.utcnow)
    disponivel: bool = True       # False = bureau indisponível (timeout/erro)


# ─────────────────────────────────────────────────────────────────────────────
# Dados do SCR — Banco Central
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DadosSCR:
    cpf: str
    divida_total_ifs: float       # R$ total em dívidas com IFs reguladas
    operacoes_ativas: int
    operacoes_vencidas: int
    maior_atraso_dias: int        # pior atraso nos últimos 12 meses
    consultado_em: dt.datetime = field(default_factory=dt.datetime.utcnow)
    disponivel: bool = True


# ─────────────────────────────────────────────────────────────────────────────
# Dados do empregador (Serasa PJ + Receita Federal)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DadosEmpregadorBureau:
    cnpj: str
    razao_social: str
    situacao_receita: str         # "ATIVA" | "INAPTA" | "BAIXADA" | "SUSPENSA"
    data_abertura: Optional[dt.date]
    porte: str                    # "MEI" | "ME" | "EPP" | "DEMAIS"
    cnae_principal: str
    score_serasa_pj: int          # 0..1000
    protestos_pj: int
    acoes_trabalhistas: int
    consultado_em: dt.datetime = field(default_factory=dt.datetime.utcnow)
    disponivel: bool = True

    @property
    def anos_abertura(self) -> float:
        if not self.data_abertura:
            return 0.0
        return (dt.date.today() - self.data_abertura).days / 365.25


# ─────────────────────────────────────────────────────────────────────────────
# Pacote de score (saída do orquestrador, entrada do decision engine)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ScorePackage:
    """Agrega todos os dados de bureaus. O decision engine só enxerga isso."""
    cpf: str
    dataprev: Optional[DadosDataprev]
    serasa: Optional[DadosSerasa]
    scr: Optional[DadosSCR]
    empregador: Optional[DadosEmpregadorBureau]

    # Scores calculados pelo scorecard
    score_tomador: float = 0.0       # 0..1000
    score_empregador: float = 0.0    # 0..1000
    pd: float = 0.0                  # probabilidade de default (0..1)

    # Flags de corte duro
    pep: bool = False
    inelegivel: bool = False
    superendividado: bool = False
    aviso_previo: bool = False
    empregador_irregular: bool = False

    bureaus_indisponiveis: List[str] = field(default_factory=list)
    gerado_em: dt.datetime = field(default_factory=dt.datetime.utcnow)


# ─────────────────────────────────────────────────────────────────────────────
# Decisão de crédito
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class MotivoRecusa:
    codigo: str
    descricao: str
    bureau: str = ""   # qual bureau originou o motivo


@dataclass
class DecisaoCreditoV2:
    status: DecisaoStatus
    score_package: ScorePackage
    motivos: List[MotivoRecusa] = field(default_factory=list)
    parcela_maxima: float = 0.0
    valor_maximo: float = 0.0
    prazo_maximo: int = 0
    observacoes: List[str] = field(default_factory=list)

    @property
    def aprovado(self) -> bool:
        return self.status == DecisaoStatus.APROVADO
