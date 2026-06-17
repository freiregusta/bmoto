"""
api_smoke.py — Testa a API ponta-a-ponta com o TestClient (sem subir servidor).

    python3 api_smoke.py
"""
from fastapi.testclient import TestClient
from api import make_app, OriginadoraService
from dataprev_client import MockLeilaoClient


def novo_client():
    svc = OriginadoraService(MockLeilaoClient(seed=6))
    return TestClient(make_app(svc))


WORKER_OK = {
    "cpf": "11111111111", "nome": "Ana Souza", "idade": 41, "vinculo": "CLT",
    "empregador_cnpj": "00000000000191", "renda_liquida": 4800,
    "margem_disponivel": 560, "meses_de_empresa": 54, "fgts_saldo": 9000,
    "comprometimento_renda_total": 0.18,
}


def linha(c="-", n=70): print(c * n)


def caminho_feliz():
    print("\n[1] Caminho feliz via HTTP (até CEDIDA_FIDC)"); linha()
    c = novo_client()
    pid = "PROP-API-1"
    r = c.post("/webhooks/leilao/solicitacao", json={
        "proposal_id": pid, "worker": WORKER_OK,
        "valor_solicitado": 8000, "prazo_meses": 24})
    j = r.json()
    print(f"  POST solicitacao -> {r.status_code} | estado={j['estado']}")
    print(f"    taxa={j['pricing']['taxa_am']*100:.3f}% a.m.  CET={j['pricing']['cet_am']*100:.3f}% a.m.")
    print(f"    oferta enviada: parcela R$ {j['oferta']['installment_amount']:.2f} x {j['oferta']['installment_quantity']}")

    steps = [
        ("devolutiva", f"/webhooks/leilao/devolutiva/{pid}", {"status": "APPROVED"}),
        ("aceite", f"/operacoes/{pid}/aceite", {"ok": True}),
        ("kyc", f"/operacoes/{pid}/kyc", {"ok": True}),
        ("ccb", f"/operacoes/{pid}/ccb", None),
        ("averbacao", f"/webhooks/dataprev/averbacao/{pid}", {"ok": True}),
        ("pix", f"/webhooks/pix/{pid}", {"ok": True}),
    ]
    for nome, url, body in steps:
        r = c.post(url, json=body) if body is not None else c.post(url)
        print(f"  POST {nome:10s} -> {r.status_code} | estado={r.json()['estado']}")
    final = c.get(f"/operacoes/{pid}").json()
    print(f"  estado final: {final['estado']}")
    assert final["estado"] == "CEDIDA_FIDC", final["estado"]
    print("  OK ✓")


def gate_pix():
    print("\n[2] Gate: averbação confirma e SÓ então o Pix é aceito"); linha()
    c = novo_client()
    pid = "PROP-API-2"
    c.post("/webhooks/leilao/solicitacao", json={
        "proposal_id": pid, "worker": WORKER_OK, "valor_solicitado": 8000, "prazo_meses": 24})
    c.post(f"/webhooks/leilao/devolutiva/{pid}", json={"status": "APPROVED"})
    c.post(f"/operacoes/{pid}/aceite", json={"ok": True})
    c.post(f"/operacoes/{pid}/kyc", json={"ok": True})
    c.post(f"/operacoes/{pid}/ccb")
    # tomador assinou, mas a averbação AINDA não saiu -> webhook de Pix deve falhar
    r = c.post(f"/webhooks/pix/{pid}", json={"ok": True})
    print(f"  Pix antes da averbação -> HTTP {r.status_code} (esperado 409)")
    print(f"    detalhe: {r.json().get('detail')}")
    assert r.status_code == 409
    # agora averba e o Pix passa
    c.post(f"/webhooks/dataprev/averbacao/{pid}", json={"ok": True})
    r2 = c.post(f"/webhooks/pix/{pid}", json={"ok": True})
    print(f"  Pix após averbação    -> HTTP {r2.status_code} | estado={r2.json()['estado']}")
    assert r2.status_code == 200 and r2.json()["estado"] == "CEDIDA_FIDC"
    print("  OK ✓")


def idempotencia():
    print("\n[3] Idempotência: devolutiva reentregue (mesmo event_id)"); linha()
    c = novo_client()
    pid = "PROP-API-3"
    c.post("/webhooks/leilao/solicitacao", json={
        "proposal_id": pid, "worker": WORKER_OK, "valor_solicitado": 8000, "prazo_meses": 24})
    body = {"status": "APPROVED", "event_id": "wh-xyz-1"}
    c.post(f"/webhooks/leilao/devolutiva/{pid}", json=body)
    c.post(f"/webhooks/leilao/devolutiva/{pid}", json=body)  # duplicado
    op = c.get(f"/operacoes/{pid}").json()
    n_aprov = sum(1 for t in op["historico"] if t["evento"] == "LEILAO_APPROVED")
    print(f"  estado={op['estado']} | transições LEILAO_APPROVED no histórico: {n_aprov}")
    assert op["estado"] == "OFERTA_VENCEDORA" and n_aprov == 1
    print("  OK ✓")


def reprovado():
    print("\n[4] SCR: consignado ativo -> reprovado já na ingestão"); linha()
    c = novo_client()
    w = dict(WORKER_OK, cpf="33333333333", possui_consignado_ativo=True)
    r = c.post("/webhooks/leilao/solicitacao", json={
        "proposal_id": "PROP-API-4", "worker": w, "valor_solicitado": 6000, "prazo_meses": 24})
    j = r.json()
    print(f"  estado={j['estado']} | motivos={j['decisao']['motivos']}")
    assert j["estado"] == "REPROVADA_CREDITO"
    print("  OK ✓")


if __name__ == "__main__":
    print("=== SMOKE TEST — API DA ESTEIRA ===")
    caminho_feliz()
    gate_pix()
    idempotencia()
    reprovado()
    linha("=")
    print("Todos os cenários passaram. Contrato em /openapi.json, docs em /docs.")
