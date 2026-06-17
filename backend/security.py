"""
security.py — Verificação dos chamadores de webhook.

Os webhooks são públicos: qualquer um pode dar POST. Por isso, valide o chamador.
  * HMAC-SHA256 sobre o corpo cru (parceiros que assinam o payload).
  * Allowlist de IP (defesa em profundidade).
  * mTLS: terminado no ingress/proxy; aqui só conferimos o header que o proxy
    injeta após validar o certificado do cliente.

Tudo é gated por variável de ambiente: sem a env setada, o guard é no-op
(facilita dev/teste). Em produção, defina as envs e a verificação passa a valer.
"""
from __future__ import annotations
import hmac
import hashlib
import os
from fastapi import Request, HTTPException


def verify_signature(secret: str, body: bytes, signature: str) -> bool:
    """HMAC-SHA256 do corpo cru, comparação em tempo constante.
    Aceita assinatura no formato 'sha256=<hex>' ou '<hex>'."""
    esperado = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    recebido = (signature or "").split("=", 1)[-1].strip()
    return hmac.compare_digest(esperado, recebido)


async def hmac_guard(request: Request) -> None:
    secret = os.environ.get("WEBHOOK_HMAC_SECRET")
    if not secret:
        return  # dev: sem segredo, não exige assinatura
    body = await request.body()  # Starlette cacheia; a rota ainda lê o JSON
    sig = request.headers.get("X-Signature", "")
    if not verify_signature(secret, body, sig):
        raise HTTPException(status_code=401, detail="Assinatura HMAC inválida")


async def ip_guard(request: Request) -> None:
    allow = os.environ.get("WEBHOOK_IP_ALLOWLIST", "")
    if not allow:
        return
    permitidos = {x.strip() for x in allow.split(",") if x.strip()}
    cliente = request.client.host if request.client else ""
    if cliente not in permitidos:
        raise HTTPException(status_code=403, detail=f"IP não autorizado: {cliente}")


async def mtls_guard(request: Request) -> None:
    """mTLS é validado no ingress (LB/NGINX/Render). O proxy injeta um header
    após verificar o certificado do cliente; aqui só conferimos o resultado.
    Ative definindo MTLS_REQUIRED_HEADER (ex.: 'X-Client-Verified=SUCCESS')."""
    req = os.environ.get("MTLS_REQUIRED_HEADER")
    if not req:
        return
    nome, _, valor = req.partition("=")
    if request.headers.get(nome) != valor:
        raise HTTPException(status_code=401, detail="mTLS não verificado pelo ingress")
