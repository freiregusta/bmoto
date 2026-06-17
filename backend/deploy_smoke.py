"""
deploy_smoke.py — Valida a camada de deploy sem precisar de Postgres.

  * Persistência SQL (via SQLite, código idêntico ao Postgres): a operação
    sobrevive entre instâncias do repositório.
  * Fluxo completo da API rodando sobre repositório SQL -> CEDIDA_FIDC.
  * Verificação HMAC dos webhooks.

    python3 deploy_smoke.py
"""
import os
import tempfile
from fastapi.testclient import TestClient

from repository_sql import SqliteRepository
from serialization import op_to_dict, op_from_dict
from api import make_app, OriginadoraService
from dataprev_client import MockLeilaoClient
from security import verify_signature

WORKER_OK = {
    "cpf": "11111111111", "nome": "Ana Souza", "idade": 41, "vinculo": "CLT",
    "empregador_cnpj": "00000000000191", "renda_liquida": 4800,
    "margem_disponivel": 560, "meses_de_empresa": 54, "fgts_saldo": 9000,
    "comprometimento_renda_total": 0.18,
}


def linha(c="-", n=70): print(c * n)


def teste_persistencia():
    print("\n[1] Persistência SQL: operação sobrevive entre instâncias"); linha()
    path = os.path.join(tempfile.gettempdir(), "originadora_test.db")
    if os.path.exists(path):
        os.remove(path)

    svc = OriginadoraService(MockLeilaoClient(seed=6), repo=SqliteRepository(path))
    c = TestClient(make_app(svc))
    pid = "PROP-DB-1"
    c.post("/webhooks/leilao/solicitacao", json={
        "proposal_id": pid, "worker": WORKER_OK, "valor_solicitado": 8000, "prazo_meses": 24})
    c.post(f"/webhooks/leilao/devolutiva/{pid}", json={"status": "APPROVED"})
    estado_antes = c.get(f"/operacoes/{pid}").json()["estado"]
    print(f"  estado gravado: {estado_antes}")

    # Nova instância do repositório, mesmo arquivo -> deve recuperar a operação
    svc2 = OriginadoraService(MockLeilaoClient(seed=6), repo=SqliteRepository(path))
    c2 = TestClient(make_app(svc2))
    op2 = c2.get(f"/operacoes/{pid}").json()
    print(f"  estado lido por OUTRA instância: {op2['estado']}")
    print(f"  histórico preservado: {len(op2['historico'])} transições")
    assert op2["estado"] == estado_antes
    assert len(op2["historico"]) >= 2

    # E continua a esteira na 2ª instância até o fim
    for url, body in [(f"/operacoes/{pid}/aceite", {"ok": True}),
                      (f"/operacoes/{pid}/kyc", {"ok": True}),
                      (f"/operacoes/{pid}/ccb", None),
                      (f"/webhooks/dataprev/averbacao/{pid}", {"ok": True}),
                      (f"/webhooks/pix/{pid}", {"ok": True})]:
        c2.post(url, json=body) if body is not None else c2.post(url)
    final = c2.get(f"/operacoes/{pid}").json()["estado"]
    print(f"  estado final (2ª instância): {final}")
    assert final == "CEDIDA_FIDC"
    os.remove(path)
    print("  OK ✓")


def teste_roundtrip():
    print("\n[2] Round-trip de serialização (sem perda)"); linha()
    svc = OriginadoraService(MockLeilaoClient(seed=6))
    c = TestClient(make_app(svc))
    pid = "PROP-RT"
    c.post("/webhooks/leilao/solicitacao", json={
        "proposal_id": pid, "worker": WORKER_OK, "valor_solicitado": 8000, "prazo_meses": 24})
    op = svc.repo.get(pid)
    d = op_to_dict(op)
    op2 = op_from_dict(d)
    print(f"  estado: {op.state.value} == {op2.state.value}")
    print(f"  taxa preservada: {op2.pricing.taxa_am*100:.3f}% a.m.")
    assert op.state == op2.state
    assert abs(op.pricing.taxa_am - op2.pricing.taxa_am) < 1e-12
    assert op.eventos_aplicados == op2.eventos_aplicados
    print("  OK ✓")


def teste_hmac():
    print("\n[3] HMAC: assinatura válida passa, inválida é barrada"); linha()
    secret = "segredo-da-infra"
    body = b'{"status":"APPROVED"}'
    import hmac, hashlib
    boa = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    print(f"  assinatura correta -> {verify_signature(secret, body, boa)}")
    print(f"  assinatura forjada -> {verify_signature(secret, body, 'sha256=deadbeef')}")
    assert verify_signature(secret, body, boa) is True
    assert verify_signature(secret, body, "sha256=deadbeef") is False

    # Guard no endpoint: com WEBHOOK_HMAC_SECRET setado, POST sem assinatura -> 401
    os.environ["WEBHOOK_HMAC_SECRET"] = secret
    try:
        c = TestClient(make_app(OriginadoraService(MockLeilaoClient(seed=6))))
        r = c.post("/webhooks/leilao/solicitacao", json={
            "proposal_id": "X", "worker": WORKER_OK, "valor_solicitado": 8000, "prazo_meses": 24})
        print(f"  POST sem assinatura -> HTTP {r.status_code} (esperado 401)")
        assert r.status_code == 401
    finally:
        del os.environ["WEBHOOK_HMAC_SECRET"]
    print("  OK ✓")


if __name__ == "__main__":
    print("=== SMOKE TEST — CAMADA DE DEPLOY (SQL + segurança) ===")
    teste_persistencia()
    teste_roundtrip()
    teste_hmac()
    linha("=")
    print("Persistência portátil (SQLite=dev / Postgres=prod) e webhooks protegidos.")
