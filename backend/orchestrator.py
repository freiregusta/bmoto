"""
orchestrator.py — Orquestra a esteira ponta-a-ponta.

  solicitação (leilão) -> decisão de crédito -> precificação -> oferta ->
  leilão (devolutiva) -> aceite do tomador (24h) -> emissão (KYC, CCB, averbação).
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, List

from models import (CreditRequest, CreditDecision, PricingResult, Proposal,
                    AuctionResult, AuctionStatus, DecisionStatus)
from credit_engine import CreditEngine
from pricing_engine import PricingEngine
from dataprev_client import LeilaoClient


@dataclass
class EsteiraResult:
    proposal_id: str
    decision: CreditDecision
    pricing: Optional[PricingResult] = None
    proposal: Optional[Proposal] = None
    auction: Optional[AuctionResult] = None
    aceito: Optional[bool] = None
    emissao: List[str] = field(default_factory=list)
    final_status: str = ""


# Etapas de emissão pós-aceite (modelo "sem leilão", reaproveitado):
EMISSION_STEPS = ["KYC", "Assinatura CCB", "Averbação Dataprev", "Envio do contrato"]


class Originadora:
    def __init__(self, client: LeilaoClient,
                 credit: Optional[CreditEngine] = None,
                 pricing: Optional[PricingEngine] = None,
                 entry_url: str = "https://originadora.exemplo/entrada"):
        self.client = client
        self.credit = credit or CreditEngine()
        self.pricing = pricing or PricingEngine()
        self.entry_url = entry_url

    def processar(self, req: CreditRequest) -> EsteiraResult:
        res = EsteiraResult(proposal_id=req.proposal_id,
                            decision=CreditDecision(DecisionStatus.DECLINED))

        # 1) Crédito
        decision = self.credit.decide(req)
        res.decision = decision
        if not decision.approved:
            res.final_status = "REPROVADO_CREDITO"
            return res

        # 2) Pricing
        pricing = self.pricing.price(req, decision)
        res.pricing = pricing
        decision.valor_maximo = pricing.liberado
        if not pricing.feasible:
            res.final_status = "INVIAVEL_PRICING"
            return res

        # 3) Oferta -> leilão
        proposal = self.pricing.build_proposal(req, pricing, self.entry_url)
        res.proposal = proposal
        auction = self.client.submit_proposal(proposal)
        res.auction = auction
        if auction.status != AuctionStatus.APPROVED:
            res.final_status = f"LEILAO_{auction.status.value}"
            return res

        # 4) Aceite do tomador (janela de 24h)
        aceito = self.client.poll_acceptance(req.proposal_id)
        res.aceito = aceito
        if not aceito:
            res.final_status = "TOMADOR_NAO_ACEITOU"
            return res

        # 5) Emissão
        for step in EMISSION_STEPS:
            res.emissao.append(step)
        res.final_status = "CONTRATO_EMITIDO"
        return res
