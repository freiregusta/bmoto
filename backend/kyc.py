"""
kyc.py — Verificação de identidade (KYC) plugável.

Fecha o gap: antes o /kyc recebia apenas um booleano. Agora existe um
provider com contrato claro (liveness + doc OCR + face match + screening
PEP/sanções), no mesmo padrão dos bureaus: mock funcional hoje, adapter
real plugando por env quando o provedor (unico/CAF/idwall) for contratado.

    KYC_PROVIDER=mock (default) | caf
    CAF_BASE_URL / CAF_API_KEY  (quando provider=caf)

Uso na esteira: POST /operacoes/{id}/kyc/executar roda o provider e
dispara o evento KYC_APROVADO/KYC_REPROVADO automaticamente.
"""

from __future__ import annotations

import os
import datetime as dt
from dataclasses import dataclass, field
from typing import Optional

import httpx
from dataclasses import asdict
from persistencia import JsonStore, hidratar


@dataclass
class ResultadoKYC:
    aprovado: bool
    provider: str
    checks: dict = field(default_factory=dict)   # liveness, ocr, face_match, pep, sancoes
    motivo: Optional[str] = None
    executado_em: str = field(default_factory=lambda: dt.datetime.utcnow().isoformat())


class KYCProvider:
    nome = "base"

    async def verificar(self, *, cpf: str, nome: str,
                        selfie_b64: Optional[str] = None,
                        doc_frente_b64: Optional[str] = None,
                        doc_verso_b64: Optional[str] = None) -> ResultadoKYC:
        raise NotImplementedError


class MockKYCProvider(KYCProvider):
    """Aprova salvo CPFs de teste terminados em '00' (para testar reprovação)."""

    nome = "mock"

    async def verificar(self, *, cpf: str, nome: str, selfie_b64=None,
                        doc_frente_b64=None, doc_verso_b64=None) -> ResultadoKYC:
        reprovar = cpf.replace(".", "").replace("-", "").endswith("00")
        checks = {
            "liveness": not reprovar,
            "ocr_documento": True,
            "face_match": not reprovar,
            "pep": False,
            "sancoes": False,
        }
        return ResultadoKYC(
            aprovado=not reprovar,
            provider=self.nome,
            checks=checks,
            motivo="face_match reprovado (CPF de teste)" if reprovar else None,
        )


class CAFProvider(KYCProvider):
    """
    Esqueleto do provedor real (CAF/unico/idwall seguem o mesmo shape).
    Plugado por env; endpoints exatos ajustados na contratação.
    """

    nome = "caf"

    def __init__(self):
        self.base = os.environ.get("CAF_BASE_URL", "").rstrip("/")
        self.key = os.environ.get("CAF_API_KEY", "")

    async def verificar(self, *, cpf: str, nome: str, selfie_b64=None,
                        doc_frente_b64=None, doc_verso_b64=None) -> ResultadoKYC:
        if not self.base or not self.key:
            return ResultadoKYC(aprovado=False, provider=self.nome,
                                motivo="CAF_BASE_URL/CAF_API_KEY não configurados")
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                f"{self.base}/v1/verifications",
                headers={"Authorization": f"Bearer {self.key}"},
                json={
                    "cpf": cpf, "name": nome,
                    "selfie": selfie_b64,
                    "document_front": doc_frente_b64,
                    "document_back": doc_verso_b64,
                    "checks": ["liveness", "ocr", "facematch", "pep", "sanctions"],
                },
            )
            r.raise_for_status()
            data = r.json()
        aprovado = data.get("status") == "approved"
        return ResultadoKYC(aprovado=aprovado, provider=self.nome,
                            checks=data.get("checks", {}),
                            motivo=data.get("reason"))


def get_provider() -> KYCProvider:
    nome = os.getenv("KYC_PROVIDER", "mock").lower()
    if nome == "caf":
        return CAFProvider()
    return MockKYCProvider()


# Último resultado por operação (auditoria) — persistente
_STORE_KYC = JsonStore("kyc_resultados")
RESULTADOS: dict[str, ResultadoKYC] = hidratar(_STORE_KYC, lambda d: ResultadoKYC(**d))


async def executar_kyc(proposal_id: str, *, cpf: str, nome: str,
                       selfie_b64=None, doc_frente_b64=None,
                       doc_verso_b64=None) -> ResultadoKYC:
    res = await get_provider().verificar(
        cpf=cpf, nome=nome, selfie_b64=selfie_b64,
        doc_frente_b64=doc_frente_b64, doc_verso_b64=doc_verso_b64)
    RESULTADOS[proposal_id] = res
    _STORE_KYC.put(proposal_id, asdict(res))
    return res
