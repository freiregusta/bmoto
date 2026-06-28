"""
state_machine.py — Máquina de estados da esteira da originadora.

Princípios:
  * Cada passo é um ESTADO persistido (observabilidade ponta-a-ponta).
  * Transições legais ficam numa TABELA. Tudo fora dela é IllegalTransition —
    é assim que o gate "Pix só depois da averbação" é garantido por construção.
  * Idempotência: reentrega do mesmo evento (webhook duplicado da Dataprev) é
    no-op. Não duplica operação.
  * Estados de ESPERA externa (leilão, aceite do tomador, averbação) pausam a
    esteira até o evento chegar.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Dict, Tuple, List, Set
import datetime as dt

from models import (CreditRequest, CreditDecision, PricingResult, Proposal,
                    AuctionStatus, DecisionStatus)
from credit_engine import CreditEngine
from pricing_engine import PricingEngine
from dataprev_client import LeilaoClient
from contabilidade import Razao, lancamento_desembolso
from fidc import ParametrosCessao, ceder_operacao, ResultadoCessao


# ----------------------------------------------------------------------------- 
# Estados
# -----------------------------------------------------------------------------
class S(str, Enum):
    RECEBIDA = "RECEBIDA"
    PRECIFICANDO = "PRECIFICANDO"
    OFERTA_ENVIADA = "OFERTA_ENVIADA"          # espera devolutiva do leilão
    OFERTA_VENCEDORA = "OFERTA_VENCEDORA"      # espera aceite do tomador (24h)
    ACEITA = "ACEITA"
    EM_FORMALIZACAO = "EM_FORMALIZACAO"        # KYC ok, pronto p/ assinar
    CCB_ASSINADA = "CCB_ASSINADA"
    AVERBANDO = "AVERBANDO"                     # espera Dataprev reservar margem
    AVERBADA = "AVERBADA"                       # margem reservada — gate liberado
    DESEMBOLSANDO = "DESEMBOLSANDO"            # Pix em curso
    DESEMBOLSADA = "DESEMBOLSADA"
    CONTABILIZADA = "CONTABILIZADA"
    # terminais
    CEDIDA_FIDC = "CEDIDA_FIDC"                 # sucesso (originate-to-distribute)
    REPROVADA_CREDITO = "REPROVADA_CREDITO"
    INVIAVEL_PRICING = "INVIAVEL_PRICING"
    LEILAO_PERDIDO = "LEILAO_PERDIDO"
    LEILAO_ERRO = "LEILAO_ERRO"
    EXPIRADA = "EXPIRADA"
    KYC_REPROVADO = "KYC_REPROVADO"
    AVERBACAO_FALHA = "AVERBACAO_FALHA"
    PIX_FALHA = "PIX_FALHA"
    CANCELADA = "CANCELADA"


TERMINAIS: Set[S] = {
    S.CEDIDA_FIDC, S.REPROVADA_CREDITO, S.INVIAVEL_PRICING, S.LEILAO_PERDIDO,
    S.EXPIRADA, S.KYC_REPROVADO, S.AVERBACAO_FALHA, S.CANCELADA,
}
# Estados onde a esteira espera um evento externo (webhook / app do tomador):
ESPERA_EXTERNA: Set[S] = {S.OFERTA_ENVIADA, S.OFERTA_VENCEDORA, S.AVERBANDO}


# ----------------------------------------------------------------------------- 
# Eventos
# -----------------------------------------------------------------------------
class EV(str, Enum):
    CREDITO_APROVADO = "CREDITO_APROVADO"
    CREDITO_REPROVADO = "CREDITO_REPROVADO"
    PRICING_OK = "PRICING_OK"
    PRICING_INVIAVEL = "PRICING_INVIAVEL"
    OFERTA_SUBMETIDA = "OFERTA_SUBMETIDA"
    LEILAO_APPROVED = "LEILAO_APPROVED"        # webhook devolutiva
    LEILAO_DENIED = "LEILAO_DENIED"
    LEILAO_ERROR = "LEILAO_ERROR"
    TOMADOR_ACEITOU = "TOMADOR_ACEITOU"
    TOMADOR_EXPIROU = "TOMADOR_EXPIROU"
    KYC_APROVADO = "KYC_APROVADO"
    KYC_REPROVADO = "KYC_REPROVADO"
    CCB_ASSINADA = "CCB_ASSINADA"
    SOLICITA_AVERBACAO = "SOLICITA_AVERBACAO"
    AVERBACAO_OK = "AVERBACAO_OK"
    AVERBACAO_FALHA = "AVERBACAO_FALHA"
    PIX_ENVIADO = "PIX_ENVIADO"
    PIX_OK = "PIX_OK"
    PIX_FALHA = "PIX_FALHA"
    CONTABILIZADA = "CONTABILIZADA"
    CEDIDA_FIDC = "CEDIDA_FIDC"
    CANCELAR = "CANCELAR"


# (estado_atual, evento) -> próximo_estado. Fora daqui = transição ilegal.
TRANSICOES: Dict[Tuple[S, EV], S] = {
    (S.RECEBIDA, EV.CREDITO_APROVADO): S.PRECIFICANDO,
    (S.RECEBIDA, EV.CREDITO_REPROVADO): S.REPROVADA_CREDITO,

    (S.PRECIFICANDO, EV.PRICING_OK): S.OFERTA_ENVIADA,
    (S.PRECIFICANDO, EV.PRICING_INVIAVEL): S.INVIAVEL_PRICING,

    (S.OFERTA_ENVIADA, EV.LEILAO_APPROVED): S.OFERTA_VENCEDORA,
    (S.OFERTA_ENVIADA, EV.LEILAO_DENIED): S.LEILAO_PERDIDO,
    (S.OFERTA_ENVIADA, EV.LEILAO_ERROR): S.LEILAO_ERRO,

    (S.OFERTA_VENCEDORA, EV.TOMADOR_ACEITOU): S.ACEITA,
    (S.OFERTA_VENCEDORA, EV.TOMADOR_EXPIROU): S.EXPIRADA,

    (S.ACEITA, EV.KYC_APROVADO): S.EM_FORMALIZACAO,
    (S.ACEITA, EV.KYC_REPROVADO): S.KYC_REPROVADO,

    (S.EM_FORMALIZACAO, EV.CCB_ASSINADA): S.CCB_ASSINADA,

    (S.CCB_ASSINADA, EV.SOLICITA_AVERBACAO): S.AVERBANDO,
    (S.AVERBANDO, EV.AVERBACAO_OK): S.AVERBADA,
    (S.AVERBANDO, EV.AVERBACAO_FALHA): S.AVERBACAO_FALHA,

    # GATE CRÍTICO: PIX_ENVIADO só é legal a partir de AVERBADA.
    (S.AVERBADA, EV.PIX_ENVIADO): S.DESEMBOLSANDO,
    (S.DESEMBOLSANDO, EV.PIX_OK): S.DESEMBOLSADA,
    (S.DESEMBOLSANDO, EV.PIX_FALHA): S.PIX_FALHA,
    # retry de Pix volta para o gate (continua averbada):
    (S.PIX_FALHA, EV.PIX_ENVIADO): S.DESEMBOLSANDO,

    (S.DESEMBOLSADA, EV.CONTABILIZADA): S.CONTABILIZADA,
    (S.CONTABILIZADA, EV.CEDIDA_FIDC): S.CEDIDA_FIDC,
}

# Cancelamento é legal de qualquer estado não-terminal.
for _s in S:
    if _s not in TERMINAIS:
        TRANSICOES.setdefault((_s, EV.CANCELAR), S.CANCELADA)


class IllegalTransition(Exception):
    pass


# ----------------------------------------------------------------------------- 
# Evento e Operação (agregado persistido)
# -----------------------------------------------------------------------------
@dataclass
class Event:
    type: EV
    event_id: str                              # chave de idempotência
    payload: dict = field(default_factory=dict)
    at: dt.datetime = field(default_factory=dt.datetime.utcnow)


@dataclass
class Transition:
    de: S
    evento: EV
    para: S
    at: dt.datetime


@dataclass
class Operation:
    proposal_id: str
    state: S
    request: CreditRequest
    decision: Optional[CreditDecision] = None
    pricing: Optional[PricingResult] = None
    proposal: Optional[Proposal] = None
    historico: List[Transition] = field(default_factory=list)
    eventos_aplicados: Set[str] = field(default_factory=set)
    updated_at: dt.datetime = field(default_factory=dt.datetime.utcnow)

    @property
    def terminal(self) -> bool:
        return self.state in TERMINAIS

    @property
    def esperando_externo(self) -> bool:
        return self.state in ESPERA_EXTERNA


# ----------------------------------------------------------------------------- 
# Repositório (persistência) — troque por banco/event store em produção
# -----------------------------------------------------------------------------
class Repository:
    def __init__(self):
        self._db: Dict[str, Operation] = {}

    def get(self, proposal_id: str) -> Optional[Operation]:
        return self._db.get(proposal_id)

    def save(self, op: Operation) -> None:
        op.updated_at = dt.datetime.utcnow()
        self._db[op.proposal_id] = op

    def all(self) -> List[Operation]:
        return list(self._db.values())


# ----------------------------------------------------------------------------- 
# Núcleo: aplica um evento (idempotente + guardado)
# -----------------------------------------------------------------------------
def apply(op: Operation, ev: Event) -> Operation:
    # 1) Idempotência por id de evento (webhook reentregue).
    if ev.event_id in op.eventos_aplicados:
        return op
    chave = (op.state, ev.type)
    if chave in TRANSICOES:
        destino = TRANSICOES[chave]
        op.historico.append(Transition(op.state, ev.type, destino, ev.at))
        op.state = destino
        op.eventos_aplicados.add(ev.event_id)
        return op
    # 2) Idempotência por destino: se o evento levaria a um estado em que já
    #    estamos (reentrega após avanço), trata como no-op.
    if any(d == op.state for (s, e), d in TRANSICOES.items() if e == ev.type):
        op.eventos_aplicados.add(ev.event_id)
        return op
    raise IllegalTransition(
        f"Evento {ev.type.value} ilegal no estado {op.state.value} "
        f"(proposta {op.proposal_id})"
    )


# ----------------------------------------------------------------------------- 
# Driver / reator: executa efeitos e alimenta a máquina com eventos
# -----------------------------------------------------------------------------
class Esteira:
    def __init__(self, client: LeilaoClient, repo: Optional[Repository] = None,
                 credit: Optional[CreditEngine] = None,
                 pricing: Optional[PricingEngine] = None,
                 entry_url: str = "https://originadora.exemplo/entrada",
                 razao: Optional[Razao] = None,
                 params_cessao: Optional[ParametrosCessao] = None):
        self.client = client
        self.repo = repo or Repository()
        self.credit = credit or CreditEngine()
        self.pricing = pricing or PricingEngine()
        self.entry_url = entry_url
        self.razao = razao or Razao()
        self.params_cessao = params_cessao or ParametrosCessao()
        self.cessoes: Dict[str, ResultadoCessao] = {}
        self._seq = 0

    def _eid(self, prefix: str) -> str:
        self._seq += 1
        return f"{prefix}-{self._seq}"

    # ---- Contabilização -------------------------------------------------
    def _contabiliza_desembolso(self, op: Operation) -> None:
        """Reconhece a carteira a receber contra caixa, IOF e seguro."""
        pr = op.pricing
        if pr is None:
            return
        lanc = lancamento_desembolso(
            op.proposal_id, liberado=pr.liberado,
            principal_financiado=pr.principal_financiado,
            iof=pr.iof, seguro=pr.seguro)
        self.razao.registrar(lanc)

    def _cede_ao_fidc(self, op: Operation) -> None:
        """Cede o recebível ao FIDC: baixa a carteira e apura o resultado."""
        pr = op.pricing
        if pr is None:
            return
        res, _ = ceder_operacao(
            parcela=pr.parcela, prazo_meses=pr.prazo_meses,
            principal_financiado=pr.principal_financiado, taxa_op_am=pr.taxa_am,
            proposal_id=op.proposal_id, razao=self.razao,
            params=self.params_cessao)
        self.cessoes[op.proposal_id] = res

    # ---- Ingestão (webhook de distribuição do leilão) -------------------
    def ingerir(self, req: CreditRequest) -> Operation:
        op = self.repo.get(req.proposal_id)
        if op is not None:           # idempotência na ingestão
            return op
        op = Operation(proposal_id=req.proposal_id, state=S.RECEBIDA, request=req)
        self.repo.save(op)
        return op

    # ---- Webhook genérico (devolutiva do leilão etc.) -------------------
    def handle_event(self, proposal_id: str, ev: Event) -> Operation:
        op = self.repo.get(proposal_id)
        if op is None:
            raise IllegalTransition(f"Operação {proposal_id} inexistente")
        apply(op, ev)
        self.repo.save(op)
        return op

    # ---- Avança a parte síncrona (efeitos internos) até uma espera ------
    def avancar(self, op: Operation,
                sim_kyc: bool = True, sim_averbacao: bool = True,
                sim_pix: bool = True) -> Operation:
        """Executa os efeitos determinísticos. Pausa em estados de espera
        externa (leilão / aceite) — esses são resolvidos por handle_event."""
        guard = 0
        while not op.terminal and not op.esperando_externo and guard < 50:
            guard += 1
            st = op.state

            if st == S.RECEBIDA:
                dec = self.credit.decide(op.request)
                op.decision = dec
                if dec.approved:
                    apply(op, Event(EV.CREDITO_APROVADO, self._eid("cred")))
                else:
                    apply(op, Event(EV.CREDITO_REPROVADO, self._eid("cred"),
                                    {"motivos": dec.reasons}))

            elif st == S.PRECIFICANDO:
                pr = self.pricing.price(op.request, op.decision)
                op.pricing = pr
                if pr.feasible:
                    op.proposal = self.pricing.build_proposal(
                        op.request, pr, self.entry_url)
                    apply(op, Event(EV.PRICING_OK, self._eid("price")))
                    # efeito: submete ao leilão -> entra em espera externa
                    res = self.client.submit_proposal(op.proposal)
                    self._injeta_devolutiva(op, res)
                else:
                    apply(op, Event(EV.PRICING_INVIAVEL, self._eid("price"),
                                    {"notas": pr.notes}))

            elif st == S.ACEITA:
                ok = sim_kyc
                apply(op, Event(EV.KYC_APROVADO if ok else EV.KYC_REPROVADO,
                                self._eid("kyc")))

            elif st == S.EM_FORMALIZACAO:
                apply(op, Event(EV.CCB_ASSINADA, self._eid("ccb")))

            elif st == S.CCB_ASSINADA:
                apply(op, Event(EV.SOLICITA_AVERBACAO, self._eid("avb")))
                # efeito: pede averbação à Dataprev -> espera externa (AVERBANDO)
                self._injeta_averbacao(op, sucesso=sim_averbacao)

            elif st == S.AVERBADA:
                # GATE liberado: agora sim, Pix.
                apply(op, Event(EV.PIX_ENVIADO, self._eid("pix")))
                apply(op, Event(EV.PIX_OK if sim_pix else EV.PIX_FALHA,
                                self._eid("pix")))

            elif st == S.DESEMBOLSADA:
                self._contabiliza_desembolso(op)
                apply(op, Event(EV.CONTABILIZADA, self._eid("book")))

            elif st == S.CONTABILIZADA:
                self._cede_ao_fidc(op)
                apply(op, Event(EV.CEDIDA_FIDC, self._eid("fidc")))

            else:
                break

            self.repo.save(op)
        return op

    # ---- Resolve esperas externas (no demo, via mock) ------------------
    def _injeta_devolutiva(self, op: Operation, res) -> None:
        mapa = {AuctionStatus.APPROVED: EV.LEILAO_APPROVED,
                AuctionStatus.DENIED: EV.LEILAO_DENIED,
                AuctionStatus.ERROR: EV.LEILAO_ERROR}
        apply(op, Event(mapa[res.status], self._eid("auc"),
                        {"error": res.error_message}))
        self.repo.save(op)
        if op.state == S.OFERTA_VENCEDORA:
            aceitou = self.client.poll_acceptance(op.proposal_id)
            apply(op, Event(EV.TOMADOR_ACEITOU if aceitou else EV.TOMADOR_EXPIROU,
                            self._eid("acc")))
            self.repo.save(op)

    def _injeta_averbacao(self, op: Operation, sucesso: bool) -> None:
        apply(op, Event(EV.AVERBACAO_OK if sucesso else EV.AVERBACAO_FALHA,
                        self._eid("avb")))
        self.repo.save(op)

    # ---- Conveniência: roda a esteira inteira de ponta a ponta ---------
    def processar(self, req: CreditRequest, **sim) -> Operation:
        op = self.ingerir(req)
        # laço: avança, e quando uma espera externa é resolvida inline,
        # continua avançando até terminal.
        while not op.terminal:
            antes = op.state
            self.avancar(op, **sim)
            if op.state == antes:        # nada mudou -> trava (sem evento externo)
                break
        return op
