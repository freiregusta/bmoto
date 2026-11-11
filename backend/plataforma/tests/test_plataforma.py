"""Testes da camada plugável. Rodar: cd backend && python -m pytest plataforma -q"""

import os
import sys
import pathlib

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from plataforma import plataforma                                 # noqa: E402
from plataforma.ports import (Capability as C, ContaProvider, HealthStatus,  # noqa: E402
                              PORTS, Pessoa)
from plataforma.registry import Plataforma                        # noqa: E402
from plataforma.produtos import ProdutoManifest, Requisito        # noqa: E402

PESSOA = Pessoa(cpf="12345678909", nome="João Entregador", nascimento="1995-03-10",
                email="joao@x.com", celular="11999990000")


@pytest.fixture(autouse=True)
def _env_limpo(monkeypatch):
    """Este arquivo testa a camada de registry em si: o catálogo do admin
    (testado em test_catalogo/test_admin_http) fica fora do caminho."""
    for v in ["BAAS_CONTA_PROVIDER", "PRODUTO_CONSIGNADO_CLT", "PRODUTO_CARTAO"]:
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setattr(plataforma.providers, "consultar_catalogo", False)
    plataforma.providers.limpar_cache()
    yield
    plataforma.providers.limpar_cache()


# ---------------------------------------------------------------- registry

def test_todos_os_ports_tem_mock():
    for port in PORTS:
        prov = plataforma.providers.resolver(port)
        assert prov.nome == "mock" and prov.port == port
        assert isinstance(prov, PORTS[port])


def test_troca_de_baas_por_env(monkeypatch):
    assert plataforma.conta().nome == "mock"
    monkeypatch.setenv("BAAS_CONTA_PROVIDER", "celcoin")
    plataforma.providers.limpar_cache()
    assert plataforma.conta().nome == "celcoin"
    assert isinstance(plataforma.conta(), ContaProvider)


def test_adapter_inexistente_da_erro_claro(monkeypatch):
    monkeypatch.setenv("BAAS_CONTA_PROVIDER", "dock")
    plataforma.providers.limpar_cache()
    with pytest.raises(LookupError, match="dock"):
        plataforma.conta()


def test_registrar_adapter_novo_sem_mexer_no_app(monkeypatch):
    class DockConta:
        nome, port = "dock", "conta"
        def capabilities(self): return {C.CONTA_ABRIR, C.CONTA_SALDO}
        async def health(self): return HealthStatus("dock", "conta", True)
        async def abrir_conta(self, p): ...
        async def saldo(self, c): return 1.0
        async def extrato(self, c, desde=None): return []
        async def pix_enviar(self, c, v, k, i): ...
        async def cobrar(self, c, v, venc, tipo="pix"): ...
        async def creditar(self, c, v, d, origem=None, idempotency_key=None): ...

    p = Plataforma()
    p.providers.consultar_catalogo = False
    p.providers.registrar("conta", "dock", DockConta)
    monkeypatch.setenv("BAAS_CONTA_PROVIDER", "dock")
    assert p.conta().nome == "dock"
    assert "dock" in p.providers.disponiveis("conta")


def test_rejeita_classe_que_nao_implementa_o_port(monkeypatch):
    class Quebrado:
        nome, port = "x", "conta"
    p = Plataforma()
    p.providers.consultar_catalogo = False
    p.providers.registrar("conta", "x", Quebrado)
    monkeypatch.setenv("BAAS_CONTA_PROVIDER", "x")
    with pytest.raises(TypeError):
        p.conta()


# ---------------------------------------------------------------- produtos

def test_consignado_preservado_mas_desligado():
    ids_ativos = {m.id for m in plataforma.produtos.ativos()}
    assert "consignado_clt" not in ids_ativos
    assert plataforma.produtos.get("consignado_clt").fase == "legado"


def test_flag_por_env_religa_consignado(monkeypatch):
    monkeypatch.setenv("PRODUTO_CONSIGNADO_CLT", "on")
    assert plataforma.produtos.ligado("consignado_clt")
    monkeypatch.setenv("PRODUTO_CARTAO", "off")
    assert not plataforma.produtos.ligado("cartao")


def test_verificar_sem_pendencias_com_mock():
    assert plataforma.verificar() == []


def test_verificar_acusa_capability_faltando(monkeypatch):
    # Celcoin (esqueleto) não tem PIX_AUTOMATICO -> financiamento de moto fica "não pronto"
    monkeypatch.setenv("BAAS_CONTA_PROVIDER", "celcoin")
    plataforma.providers.limpar_cache()
    pend = plataforma.verificar()
    assert any(p["produto"] == "moto" and "pix.automatico" in p.get("faltam", []) for p in pend)
    mods = {m["id"]: m for m in plataforma.modulos()}
    assert mods["moto"]["pronto"] is False
    assert mods["conta"]["pronto"] is True


def test_modulos_payload_para_o_frontend():
    mods = plataforma.modulos()
    assert [m["id"] for m in mods][:3] == ["conta", "ganhos", "margem"]
    conta = next(m for m in mods if m["id"] == "conta")
    assert conta["rota"] == "/app/conta" and conta["providers"] == {"conta": "mock", "kyc": "mock"}


def test_registrar_produto_novo():
    p = Plataforma()
    p.produtos.registrar(ProdutoManifest(id="celular", titulo="Celular parcelado", descricao="",
                                         rota="/app/celular", icone="Smartphone", ordem=65,
                                         requisitos=(Requisito("credito", (C.CREDITO_EMITIR_CCB,)),)))
    assert p.produtos.ligado("celular") and p.verificar() == []


# ---------------------------------------------------------------- mocks: regras

async def _conta_com_saldo(valor=100.0):
    conta = await plataforma.conta().abrir_conta(PESSOA)
    await plataforma.conta().creditar(conta.conta_id, valor, "Repasse iFood", origem="ifood", idempotency_key="rep-1")
    return conta


@pytest.mark.asyncio
async def test_conta_fluxo_repasse_e_pix():
    conta = await _conta_com_saldo(100.0)
    assert await plataforma.conta().saldo(conta.conta_id) == 100.0
    # idempotência do repasse
    await plataforma.conta().creditar(conta.conta_id, 100.0, "Repasse iFood", origem="ifood", idempotency_key="rep-1")
    assert await plataforma.conta().saldo(conta.conta_id) == 100.0
    pg = await plataforma.conta().pix_enviar(conta.conta_id, 40.0, "chave@x", "pix-1")
    assert pg.status == "CONFIRMADO"
    pg2 = await plataforma.conta().pix_enviar(conta.conta_id, 40.0, "chave@x", "pix-1")
    assert pg2.pagamento_id == pg.pagamento_id          # não paga duas vezes
    assert await plataforma.conta().saldo(conta.conta_id) == 60.0
    falha = await plataforma.conta().pix_enviar(conta.conta_id, 500.0, "chave@x", "pix-2")
    assert falha.status == "FALHOU" and "saldo" in falha.erro


@pytest.mark.asyncio
async def test_kyc_regras():
    ok = await plataforma.kyc().validar(PESSOA)
    assert ok.aprovado
    menor = await plataforma.kyc().validar(Pessoa(cpf="12345678909", nome="x", nascimento="2012-01-01"))
    assert not menor.aprovado and "menor_de_idade" in menor.motivos


@pytest.mark.asyncio
async def test_cartao_garantido_limite_por_ltv():
    c = await plataforma.cartao().emitir("cta_1", "garantido", 10_000, {"tipo": "moto", "valor": 18_000})
    assert c.limite == 5_400.0
    with pytest.raises(ValueError):
        await plataforma.cartao().emitir("cta_1", "garantido", 1000)


@pytest.mark.asyncio
async def test_credito_ccb_pmt_e_cessao():
    ct = await plataforma.credito().emitir_ccb(PESSOA.cpf, "financiamento_moto", 18_000, 0.0199, 48, "ccb-1")
    assert 560 < ct.parcela < 600
    ct2 = await plataforma.credito().emitir_ccb(PESSOA.cpf, "financiamento_moto", 18_000, 0.0199, 48, "ccb-1")
    assert ct2.contrato_id == ct.contrato_id
    ced = await plataforma.credito().ceder(ct.contrato_id, "FIDC BMoto I")
    assert ced.status == "CEDIDO"


@pytest.mark.asyncio
async def test_seguro_saude_mei_contador_renda():
    cot = await plataforma.seguro().cotar(PESSOA, "vida_ap", {})
    ap = await plataforma.seguro().emitir(cot.cotacao_id, PESSOA.cpf)
    assert ap.premio_mensal == 19.90 and ap.status == "ATIVA"

    mei = await plataforma.contador().abrir_mei(PESSOA, "5320-2/02")
    das = await plataforma.contador().das(mei.cnpj, "2026-11")
    assert das.valor == 86.05 and das.vencimento == "2026-12-20"

    pessoa_mei = Pessoa(**{**PESSOA.__dict__, "cnpj_mei": mei.cnpj, "endereco": {"mei_meses": 2}})
    cot_s = await plataforma.saude().cotar(pessoa_mei, {})
    assert cot_s.cobertura["modalidade"] == "empresarial"
    with pytest.raises(ValueError, match="6 meses"):
        await plataforma.saude().aderir(cot_s.cotacao_id, pessoa_mei)

    cns = await plataforma.renda().consentir(PESSOA.cpf, "ifood")
    meses = await plataforma.renda().renda(cns.consentimento_id, 3)
    assert len(meses) == 3 and meses[0].bruto == 2480.0


# ---------------------------------------------------------------- HTTP

def test_endpoints_platform():
    from fastapi.testclient import TestClient
    from api import make_app
    client = TestClient(make_app())

    r = client.get("/platform/modules"); assert r.status_code == 200
    assert any(m["id"] == "consignado_clt" and m["enabled"] is False for m in r.json()["modules"])
    assert client.get("/platform/providers").json()["providers"][0]["port"] == "conta"
    assert client.get("/platform/health").json()["ok"] is True
    assert client.get("/platform/verificar").json()["ok"] is True

    r = client.post("/platform/conta/abrir", json={"cpf": "98765432100", "nome": "x", "nascimento": "1990-01-01"})
    assert r.status_code == 422                                   # cpf termina em 00 -> lista restritiva
    r = client.post("/platform/conta/abrir", json={"cpf": "11144477735", "nome": "João", "nascimento": "1990-01-01"})
    assert r.status_code == 200
    cid = r.json()["conta"]["conta_id"]
    antes = client.get(f"/platform/conta/{cid}/saldo").json()["saldo"]
    client.post(f"/platform/conta/{cid}/credito", json={"valor": 250, "descricao": "Repasse 99", "origem": "99"})
    assert client.get(f"/platform/conta/{cid}/saldo").json()["saldo"] == antes + 250
    r = client.post(f"/platform/conta/{cid}/pix", json={"valor": 50, "chave": "k", "idempotency_key": "a"})
    assert r.json()["status"] == "CONFIRMADO"
    assert client.get("/platform/conta/nada/saldo").status_code == 404
    assert client.post("/platform/renda/consentir", json={"cpf": "1", "fonte": "ifood"}).status_code == 200
