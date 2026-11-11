"""
adapters/celcoin.py — ContaProvider real (esqueleto) na Celcoin.

Mesmas envs do psp.py (BAAS_BASE_URL / BAAS_CLIENT_ID / BAAS_CLIENT_SECRET),
mesmo contrato de idempotência. Endpoints marcados com `# homolog` são os
que ajustamos quando a credencial de sandbox chegar — o resto do app não
percebe, porque só conversa com o Protocol `ContaProvider`.

Capabilities declaradas = só o que está implementado. O registry recusa
ligar um produto que precise do que não está aqui (ex.: PIX_AUTOMATICO
para o financiamento de moto) até a gente implementar.
"""

from __future__ import annotations

import os
import time
import uuid
from typing import Optional

import httpx

from ..ports import (Capability as C, Cobranca, Conta, HealthStatus, Lancamento,
                     Pagamento, Pessoa)


class CelcoinContaProvider:
    nome = "celcoin"
    port = "conta"

    def __init__(self) -> None:
        self.base = os.environ.get("BAAS_BASE_URL", "").rstrip("/")
        self.cid = os.environ.get("BAAS_CLIENT_ID", "")
        self.secret = os.environ.get("BAAS_CLIENT_SECRET", "")
        self._tok: Optional[str] = None
        self._tok_exp = 0.0

    # -- infra -------------------------------------------------------------
    def configurado(self) -> bool:
        return bool(self.base and self.cid and self.secret)

    def capabilities(self) -> set[C]:
        return {C.CONTA_ABRIR, C.CONTA_SALDO, C.CONTA_EXTRATO, C.PIX_ENVIAR, C.PIX_COBRAR}

    async def health(self) -> HealthStatus:
        if not self.configurado():
            return HealthStatus(provider=self.nome, port=self.port, ok=False,
                                detalhe="BAAS_* não configuradas")
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                await self._token(c)
            return HealthStatus(provider=self.nome, port=self.port, ok=True,
                                latencia_ms=round((time.perf_counter() - t0) * 1000, 1))
        except Exception as e:
            return HealthStatus(provider=self.nome, port=self.port, ok=False, detalhe=str(e))

    async def _token(self, c: httpx.AsyncClient) -> str:
        if self._tok and time.time() < self._tok_exp - 30:
            return self._tok
        r = await c.post(f"{self.base}/v5/token", data={
            "grant_type": "client_credentials",
            "client_id": self.cid, "client_secret": self.secret})
        r.raise_for_status()
        data = r.json()
        self._tok = data["access_token"]
        self._tok_exp = time.time() + float(data.get("expires_in", 2400))
        return self._tok

    async def _call(self, method: str, path: str, idem: Optional[str] = None, **kw) -> dict:
        if not self.configurado():
            raise RuntimeError("Credenciais BAAS_* não configuradas")
        async with httpx.AsyncClient(timeout=20) as c:
            tok = await self._token(c)
            headers = {"Authorization": f"Bearer {tok}"}
            if idem:
                headers["x-idempotency-key"] = idem
            r = await c.request(method, f"{self.base}{path}", headers=headers, **kw)
            r.raise_for_status()
            return r.json() if r.content else {}

    # -- ContaProvider -----------------------------------------------------
    async def abrir_conta(self, pessoa: Pessoa) -> Conta:
        data = await self._call("POST", "/baas-onboarding/v1/account/natural-person", json={   # homolog
            "documentNumber": pessoa.cpf, "fullName": pessoa.nome,
            "birthDate": pessoa.nascimento, "email": pessoa.email,
            "phoneNumber": pessoa.celular, "address": pessoa.endereco,
            "clientCode": f"bmoto-{pessoa.cpf}",
        })
        return Conta(conta_id=str(data.get("account") or data.get("id")), titular_cpf=pessoa.cpf,
                     provider=self.nome, agencia=str(data.get("branch", "")),
                     numero=str(data.get("account", "")), status="ATIVA")

    async def saldo(self, conta_id: str) -> float:
        data = await self._call("GET", f"/baas-walletreports/v1/wallet/balance",          # homolog
                                params={"Account": conta_id})
        return float(data.get("body", data).get("amount", 0.0))

    async def extrato(self, conta_id: str, desde: Optional[str] = None) -> list[Lancamento]:
        data = await self._call("GET", "/baas-walletreports/v1/wallet/movement",           # homolog
                                params={"Account": conta_id, "DateFrom": desde})
        out = []
        for m in data.get("body", {}).get("movements", []):
            valor = float(m.get("amount", 0))
            if str(m.get("balanceType", "")).upper().startswith("DEB"):
                valor = -valor
            out.append(Lancamento(lancamento_id=str(m.get("id")), conta_id=conta_id, valor=valor,
                                  descricao=m.get("description", ""), categoria="pix",
                                  ocorrido_em=m.get("createDate", "")))
        return out

    async def pix_enviar(self, conta_id: str, valor: float, chave: str,
                         idempotency_key: str) -> Pagamento:
        pg = Pagamento(pagamento_id=f"pix_{uuid.uuid4().hex[:10]}", conta_id=conta_id, valor=valor,
                       destino=chave, idempotency_key=idempotency_key)
        try:
            data = await self._call("POST", "/pix/v1/payment", idem=idempotency_key, json={
                "amount": round(valor, 2), "key": chave, "debitParty": {"account": conta_id},
                "clientRequestId": idempotency_key})
            pg.provider_tx_id = str(data.get("id") or data.get("transactionId"))
            pg.status = "ENVIADO"      # confirmação vem pelo webhook /webhooks/pix
        except Exception as e:
            pg.status, pg.erro = "FALHOU", str(e)
        return pg

    async def cobrar(self, conta_id: str, valor: float, vencimento: str, tipo: str = "pix") -> Cobranca:
        data = await self._call("POST", "/pix/v1/collection/duedate", json={                 # homolog
            "amount": round(valor, 2), "expiration": vencimento,
            "receiver": {"account": conta_id}, "clientRequestId": uuid.uuid4().hex})
        return Cobranca(cobranca_id=str(data.get("transactionId")), conta_id=conta_id, valor=valor,
                        vencimento=vencimento, tipo=tipo, payload=data.get("emvqrcps"))

    async def creditar(self, conta_id: str, valor: float, descricao: str,
                       origem: Optional[str] = None,
                       idempotency_key: Optional[str] = None) -> Lancamento:
        # No BaaS real o crédito acontece quando o app de entrega paga a chave Pix
        # da conta; aqui só registramos a expectativa (conciliação via webhook).
        raise NotImplementedError("crédito entra por Pix recebido (webhook), não por API")
