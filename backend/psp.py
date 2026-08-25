"""
psp.py — Desembolso Pix plugável (PSP).

Fecha o gap: antes PIX_ENVIADO era só uma transição de estado. Agora a
averbação dispara uma ORDEM DE PAGAMENTO real no provider, com:

- Idempotency-Key por operação (nunca pagar duas vezes o mesmo contrato)
- Registro da ordem (auditoria/conciliação)
- Mock funcional hoje; CelcoinPixProvider pluga por env na homologação:
      PSP_PROVIDER=mock (default) | celcoin
      BAAS_BASE_URL / BAAS_CLIENT_ID / BAAS_CLIENT_SECRET (Celcoin)

A CONFIRMAÇÃO continua chegando pelo webhook /webhooks/pix/{id} — no mock,
o "banco" confirma na hora; no real, a Celcoin chama o webhook.
"""

from __future__ import annotations

import os
import uuid
import datetime as dt
from dataclasses import dataclass, field
from typing import Optional

import httpx
from dataclasses import asdict
from persistencia import JsonStore, hidratar


@dataclass
class OrdemPix:
    proposal_id: str
    idempotency_key: str
    valor: float
    chave_destino: str
    provider: str
    status: str = "ENVIADA"            # ENVIADA -> CONFIRMADA | FALHOU
    provider_tx_id: Optional[str] = None
    criada_em: str = field(default_factory=lambda: dt.datetime.utcnow().isoformat())
    erro: Optional[str] = None


class PixProvider:
    nome = "base"

    async def enviar(self, ordem: OrdemPix) -> OrdemPix:
        raise NotImplementedError


class MockPixProvider(PixProvider):
    """Aceita a ordem e devolve tx id — a confirmação vem pelo webhook."""

    nome = "mock"

    async def enviar(self, ordem: OrdemPix) -> OrdemPix:
        ordem.provider_tx_id = f"mock-{uuid.uuid4().hex[:12]}"
        ordem.provider = self.nome
        return ordem


class CelcoinPixProvider(PixProvider):
    """
    Esqueleto do cash-out Pix via Celcoin (BaaS). Endpoints exatos ajustados
    na homologação; contrato de idempotência preservado.
    """

    nome = "celcoin"

    def __init__(self):
        self.base = os.environ.get("BAAS_BASE_URL", "").rstrip("/")
        self.cid = os.environ.get("BAAS_CLIENT_ID", "")
        self.secret = os.environ.get("BAAS_CLIENT_SECRET", "")

    async def _token(self, c: httpx.AsyncClient) -> str:
        r = await c.post(f"{self.base}/v5/token", data={
            "grant_type": "client_credentials",
            "client_id": self.cid, "client_secret": self.secret})
        r.raise_for_status()
        return r.json()["access_token"]

    async def enviar(self, ordem: OrdemPix) -> OrdemPix:
        if not (self.base and self.cid and self.secret):
            ordem.status = "FALHOU"
            ordem.erro = "Credenciais BAAS_* não configuradas"
            return ordem
        async with httpx.AsyncClient(timeout=20) as c:
            tok = await self._token(c)
            r = await c.post(
                f"{self.base}/pix/v1/payment",
                headers={"Authorization": f"Bearer {tok}",
                         "x-idempotency-key": ordem.idempotency_key},
                json={"amount": round(ordem.valor, 2),
                      "key": ordem.chave_destino,
                      "clientRequestId": ordem.proposal_id},
            )
            r.raise_for_status()
            data = r.json()
        ordem.provider = self.nome
        ordem.provider_tx_id = str(data.get("id") or data.get("transactionId"))
        return ordem


def get_provider() -> PixProvider:
    if os.getenv("PSP_PROVIDER", "mock").lower() == "celcoin":
        return CelcoinPixProvider()
    return MockPixProvider()


# Registro de ordens por operação (idempotência + conciliação) — persistente
_STORE_PIX = JsonStore("ordens_pix")
ORDENS: dict[str, OrdemPix] = hidratar(_STORE_PIX, lambda d: OrdemPix(**d))


async def desembolsar(proposal_id: str, valor: float,
                      chave_destino: str = "") -> OrdemPix:
    """Envia o Pix do desembolso. Idempotente por proposal_id."""
    ja = ORDENS.get(proposal_id)
    if ja is not None and ja.status != "FALHOU":
        return ja  # nunca paga duas vezes
    ordem = OrdemPix(
        proposal_id=proposal_id,
        idempotency_key=f"pix-{proposal_id}",
        valor=valor,
        chave_destino=chave_destino or "chave-nao-informada",
        provider=os.getenv("PSP_PROVIDER", "mock"),
    )
    ordem = await get_provider().enviar(ordem)
    ORDENS[proposal_id] = ordem
    _STORE_PIX.put(proposal_id, asdict(ordem))
    return ordem


def confirmar(proposal_id: str, ok: bool, erro: str = "") -> Optional[OrdemPix]:
    """Chamado pelo webhook de Pix para fechar o ciclo da ordem."""
    ordem = ORDENS.get(proposal_id)
    if ordem is None:
        return None
    ordem.status = "CONFIRMADA" if ok else "FALHOU"
    if erro:
        ordem.erro = erro
    _STORE_PIX.put(proposal_id, asdict(ordem))
    return ordem
