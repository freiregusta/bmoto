"""
Ganhos reais: o que o entregador lança, e a margem em cima disso.

É o único dado de renda que existe sem contrato com plataforma ou Open
Finance — e por isso é o que sustenta a simulação de crédito hoje.
"""

import pytest
from fastapi.testclient import TestClient

from api import make_app
from plataforma.ganhos import RepositorioGanhos

CPF = "12345678909"
OUTRO = "11144477735"


@pytest.fixture
def repo():
    import uuid
    return RepositorioGanhos(prefixo=f"g{uuid.uuid4().hex[:8]}")


@pytest.fixture(scope="module")
def client():
    return TestClient(make_app())


# ------------------------------------------------------------- lançamentos

def test_lancamento_exige_dado_de_verdade(repo):
    with pytest.raises(ValueError, match="CPF"):
        repo.lancar({"cpf": "123", "competencia": "2026-11", "bruto": 100})
    with pytest.raises(ValueError, match="recebeu"):
        repo.lancar({"cpf": CPF, "competencia": "2026-11", "bruto": 0})
    with pytest.raises(ValueError, match="competência"):
        repo.lancar({"cpf": CPF, "competencia": "", "bruto": 100})


def test_relancar_corrige_em_vez_de_duplicar(repo):
    repo.lancar({"cpf": CPF, "app": "ifood", "competencia": "2026-11", "bruto": 3000})
    repo.lancar({"cpf": CPF, "app": "ifood", "competencia": "2026-11", "bruto": 3200})
    lancs = repo.lancamentos(CPF)
    assert len(lancs) == 1 and lancs[0].bruto == 3200.0


def test_cada_pessoa_ve_so_o_que_lancou(repo):
    repo.lancar({"cpf": CPF, "app": "ifood", "competencia": "2026-11", "bruto": 3000})
    repo.lancar({"cpf": OUTRO, "app": "ifood", "competencia": "2026-11", "bruto": 9000})
    assert [l.bruto for l in repo.lancamentos(CPF)] == [3000.0]
    assert [l.bruto for l in repo.lancamentos(OUTRO)] == [9000.0]


# ------------------------------------------------------------------ resumo

def test_sem_lancamento_nao_ha_renda_inventada(repo):
    r = repo.resumo(CPF)
    assert r["tem_dados"] is False and r["meses_lancados"] == 0
    assert repo.renda_para_credito(CPF) == {"renda_media": 0.0, "meses_renda": 0,
                                            "fonte": "nenhuma"}


def test_resumo_sem_custos_nao_calcula_margem(repo):
    repo.lancar({"cpf": CPF, "app": "ifood", "competencia": "2026-11",
                 "bruto": 3000, "km": 1800, "corridas": 180, "horas": 120})
    r = repo.resumo(CPF)
    assert r["tem_dados"] and r["margem"] is None       # custo por km é dele, não nosso
    assert r["custos_informados"] is False
    assert repo.renda_para_credito(CPF)["fonte"] == "bruto_declarado"


def test_margem_sobre_os_custos_do_entregador(repo):
    for comp, bruto in [("2026-09", 3000), ("2026-10", 3200), ("2026-11", 3400)]:
        repo.lancar({"cpf": CPF, "app": "ifood", "competencia": comp, "bruto": bruto,
                     "km": 1800, "corridas": 180, "horas": 120})
    repo.salvar_custos(CPF, {"consumo_km_l": 35, "preco_combustivel": 6.19,
                             "custo_oleo": 60, "km_troca_oleo": 2000,
                             "valor_moto": 18000, "vida_util_km": 120000,
                             "das_mei": 86.05})
    r = repo.resumo(CPF, 3)
    ck = r["margem"]["custo_por_km"]
    assert ck["combustivel"] == pytest.approx(0.1769, abs=0.001)
    assert ck["depreciacao"] == pytest.approx(0.15, abs=0.001)
    # 3 meses, 5400 km, fixo de 3 x 86,05
    assert r["margem"]["custo_fixo"] == pytest.approx(258.15, abs=0.1)
    assert r["margem"]["liquido_total"] == pytest.approx(
        9600 - r["margem"]["custo_total"], abs=0.01)
    assert 0 < r["margem"]["margem"] < 1
    # para crédito, a renda considerada é o LÍQUIDO: conservador e verdadeiro
    rc = repo.renda_para_credito(CPF, 3)
    assert rc["fonte"] == "liquido_declarado"
    assert rc["renda_media"] == pytest.approx(r["margem"]["liquido_medio_mensal"], abs=0.01)
    assert rc["renda_media"] < r["bruto_medio_mensal"]


# -------------------------------------------------------------------- HTTP

def test_fluxo_pelo_http(client):
    cpf = "52998224725"
    assert client.get(f"/me/resumo?cpf={cpf}").json()["tem_dados"] is False

    r = client.post("/me/ganhos", json={"cpf": cpf, "app": "ifood", "competencia": "2026-11",
                                        "bruto": 3300, "km": 1900, "corridas": 186, "horas": 124})
    assert r.status_code == 200
    assert client.post("/me/ganhos", json={"cpf": cpf, "competencia": "2026-11",
                                           "bruto": 0}).status_code == 422

    client.put(f"/me/custos?cpf={cpf}", json={"consumo_km_l": 35, "preco_combustivel": 6.19,
                                              "das_mei": 86.05})
    resumo = client.get(f"/me/resumo?cpf={cpf}").json()
    assert resumo["tem_dados"] and resumo["margem"]["liquido_total"] < 3300
    assert resumo["limite_mei_ano"] > 0

    assert client.delete(f"/me/ganhos/ifood/2026-11?cpf={cpf}").status_code == 200
    assert client.get(f"/me/resumo?cpf={cpf}").json()["tem_dados"] is False


def test_simulacao_nao_e_oferta(client):
    cpf = "39053344705"
    client.post("/admin/seed")
    # sem renda lançada, não simula
    r = client.post("/me/simular/moto_nova", json={"cpf": cpf, "valor_garantia": 20_000})
    assert r.status_code == 422 and r.json()["detail"]["erro"] == "sem_renda_lancada"

    for comp in ("2026-09", "2026-10", "2026-11"):
        client.post("/me/ganhos", json={"cpf": cpf, "app": "ifood", "competencia": comp,
                                        "bruto": 3400, "km": 1900, "corridas": 180, "horas": 120})
    s = client.post("/me/simular/moto_nova",
                    json={"cpf": cpf, "valor_garantia": 20_000, "parcelas": 48}).json()
    assert s["simulacao"] is True
    assert s["aprovado"] is False                      # nunca "aprovado" sem bureau e emissor
    assert s["cabe_no_bolso"] is True
    assert s["parcela"] > 0 and s["limite"] <= 18_000  # 90% do valor da moto
    assert "score_abaixo_do_minimo" not in s["recusas"]
    assert s["renda_considerada"]["fonte"].endswith("declarado")
    assert len(s["pendencias_para_virar_oferta"]) == 3


def test_interesse_vira_lista_de_espera(client):
    cpf = "16899535009"
    r = client.post("/me/interesse", json={"cpf": cpf, "produto": "conta",
                                           "celular": "(11) 99999-0000"}).json()
    assert r["registrado"] and r["total_na_fila"] >= 1
    assert any(i["cpf"] == cpf for i in client.get("/me/interesse?produto=conta").json()["itens"])
