"""
dataprev_client.py — Integração com o leilão do Crédito do Trabalhador.

Modela o contrato real da esteira "com leilão interno":
  - distribuição da solicitação ao originador;
  - POST da oferta  -> /banking/originator/workers-credit/proposal/{id};
  - devolutiva do leilão via webhook (WorkersCreditAuctionResult);
  - aceite do tomador (24h) -> esteira de emissão (KYC, CCB, averbação).

Dois backends:
  * MockLeilaoClient  — roda HOJE, sem credenciais. Simula concorrentes,
    apura a melhor proposta e devolve APPROVED/DENIED/ERROR.
  * DataprevHttpClient — esqueleto do cliente real (mTLS + JWT). Pluga base_url,
    certificado A1 e credenciais quando você tiver a homologação.
"""
from __future__ import annotations
import abc
import random
import uuid
import datetime as dt
from typing import Callable, List, Optional

from models import Proposal, AuctionResult, AuctionStatus, CreditRequest


# ----------------------------------------------------------------------------- 
# Interface
# -----------------------------------------------------------------------------
class LeilaoClient(abc.ABC):
    @abc.abstractmethod
    def submit_proposal(self, proposal: Proposal) -> AuctionResult: ...

    @abc.abstractmethod
    def poll_acceptance(self, proposal_id: str) -> Optional[bool]:
        """True = tomador aceitou; False = recusou/expirou; None = pendente."""
        ...


# ----------------------------------------------------------------------------- 
# Mock / sandbox — simula o leilão para teste ponta-a-ponta
# -----------------------------------------------------------------------------
class MockLeilaoClient(LeilaoClient):
    def __init__(self, n_concorrentes: int = 3, seed: Optional[int] = None,
                 prob_erro_dataprev: float = 0.03,
                 prob_aceite_tomador: float = 0.6):
        self.n = n_concorrentes
        self.rng = random.Random(seed)
        self.prob_erro = prob_erro_dataprev
        self.prob_aceite = prob_aceite_tomador
        self._submetidas: dict[str, Proposal] = {}

    def _concorrente(self, base: Proposal) -> float:
        """CET mensal de um concorrente fictício, em torno do nosso."""
        return max(0.0, base.monthly_cet * self.rng.uniform(0.90, 1.15))

    def submit_proposal(self, proposal: Proposal) -> AuctionResult:
        self._submetidas[proposal.proposal_id] = proposal
        nosso_cet = proposal.monthly_cet
        concorrentes = [self._concorrente(proposal) for _ in range(self.n)]
        venceu = all(nosso_cet <= c + 1e-12 for c in concorrentes)
        ts = dt.datetime.utcnow()
        if not venceu:
            return AuctionResult(proposal.proposal_id, AuctionStatus.DENIED, ts)
        if self.rng.random() < self.prob_erro:
            return AuctionResult(proposal.proposal_id, AuctionStatus.ERROR, ts,
                                 error_message="Dataprev: erro no envio ao tomador")
        return AuctionResult(proposal.proposal_id, AuctionStatus.APPROVED, ts)

    def poll_acceptance(self, proposal_id: str) -> Optional[bool]:
        # Simula a decisão do tomador dentro da janela de 24h.
        return self.rng.random() < self.prob_aceite


# ----------------------------------------------------------------------------- 
# Cliente HTTP real (esqueleto) — preencher na homologação
# -----------------------------------------------------------------------------
class DataprevHttpClient(LeilaoClient):
    """Esqueleto. Requer mTLS (certificado A1 do eSocial) + Bearer JWT.
    Mantido sem dependência de rede para não quebrar a execução local."""

    def __init__(self, base_url: str, client_id: str, client_secret: str,
                 cert_path: str, key_path: str, webhook_url: str = ""):
        self.base_url = base_url.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.cert = (cert_path, key_path)
        self.webhook_url = webhook_url
        self._token: Optional[str] = None

    def _auth(self) -> str:
        # TODO homologação: POST /token (client_credentials) com mTLS.
        # import requests
        # r = requests.post(f"{self.base_url}/oauth/token", cert=self.cert,
        #     data={"grant_type": "client_credentials",
        #           "client_id": self.client_id, "client_secret": self.client_secret})
        # self._token = r.json()["access_token"]
        raise NotImplementedError("Configurar credenciais de homologação Dataprev")

    def submit_proposal(self, proposal: Proposal) -> AuctionResult:
        # endpoint = f"{self.base_url}/banking/originator/workers-credit/proposal/{proposal.proposal_id}"
        # r = requests.post(endpoint, json=proposal.to_api_payload(),
        #                   headers={"Authorization": f"Bearer {self._token}"},
        #                   cert=self.cert)
        # A devolutiva real chega ASSÍNCRONA no webhook (parse_auction_webhook).
        raise NotImplementedError("Configurar endpoint de proposta")

    def poll_acceptance(self, proposal_id: str) -> Optional[bool]:
        raise NotImplementedError


def parse_auction_webhook(body: dict) -> AuctionResult:
    """Converte o payload do webhook WorkersCreditAuctionResult em AuctionResult."""
    p = body.get("payload", {})
    return AuctionResult(
        proposal_id=p.get("id", ""),
        status=AuctionStatus(p.get("status", "ERROR")),
        timestamp=dt.datetime.utcnow(),
        error_message=p.get("error_message", ""),
    )
