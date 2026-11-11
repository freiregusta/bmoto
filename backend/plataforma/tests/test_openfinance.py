"""
Classificação de repasses: o que, no extrato, é dinheiro de app de entrega.

É a peça mais delicada do conector — errar aqui significa atribuir renda à
plataforma errada, ou pior, contar como renda um Pix do primo. Por isso os
casos chatos estão todos aqui: acento, caixa, filial com CNPJ diferente,
débito, transferência de terceiro.
"""

import pytest
from fastapi.testclient import TestClient

from api import make_app
from plataforma.openfinance import (
    RegraApp, Transacao, classificar, ler_csv, para_lancamentos, raiz_cnpj,
    regras_do_catalogo,
)

REGRAS = [
    RegraApp(slug="ifood", nome="iFood", cnpjs=("14380200000121",),
             identificadores=("IFOOD",)),
    RegraApp(slug="99", nome="99Food", identificadores=("99 TECNOLOGIA", "99FOOD")),
    RegraApp(slug="rappi", nome="Rappi", identificadores=("RAPPI",)),
]


def t(valor, nome="", doc="", data="2026-11-05", descricao="", id_="x"):
    return Transacao(id=id_, data=data, valor=valor, descricao=descricao,
                     pagador_nome=nome, pagador_documento=doc)


# ------------------------------------------------------------ identificação

def test_reconhece_pelo_cnpj_mesmo_em_outra_filial():
    # filial muda os 4 dígitos do meio; a raiz é a empresa
    c = classificar([t(480.0, doc="14.380.200/0456-30")], REGRAS)
    assert c.por_app["ifood"].total == 480.0


def test_reconhece_pelo_nome_com_acento_e_caixa_trocada():
    c = classificar([t(300.0, nome="iFood.com Agência de Restaurantes"),
                     t(120.0, descricao="PIX RECEBIDO 99 tecnologia ltda")], REGRAS)
    assert c.por_app["ifood"].total == 300.0
    assert c.por_app["99"].total == 120.0


def test_nao_confunde_pix_de_terceiro_com_repasse():
    c = classificar([t(200.0, nome="Maria Souza"), t(450.0, nome="IFOOD")], REGRAS)
    assert c.total_identificado == 450.0
    assert [x.pagador_nome for x in c.nao_identificados] == ["Maria Souza"]
    assert c.cobertura == pytest.approx(450 / 650, abs=0.001)


def test_debito_nunca_vira_renda():
    c = classificar([t(-900.0, nome="IFOOD"), t(500.0, nome="IFOOD")], REGRAS)
    assert c.por_app["ifood"].total == 500.0
    assert c.total_creditos == 500.0


def test_agrupa_por_app_e_por_mes():
    c = classificar([
        t(300.0, nome="IFOOD", data="2026-09-10"),
        t(200.0, nome="IFOOD", data="2026-09-24"),
        t(400.0, nome="IFOOD", data="2026-10-08"),
        t(150.0, nome="RAPPI", data="2026-10-09"),
    ], REGRAS)
    assert c.por_app["ifood"].competencias == {"2026-09": 500.0, "2026-10": 400.0}
    assert c.por_app["ifood"].lancamentos == 3
    assert c.por_competencia == {"2026-09": 500.0, "2026-10": 550.0}
    assert c.media_mensal() == 525.0
    assert c.media_mensal(1) == 550.0        # só o mês mais recente


def test_raiz_cnpj():
    assert raiz_cnpj("14.380.200/0001-21") == "14380200"
    assert raiz_cnpj("") == ""


def test_sem_identificador_cadastrado_usa_o_nome_da_plataforma():
    class AppFalso:
        slug, nome = "entrega_x", "Entrega X"
        cnpjs: list = []
        identificadores: list = []

    regras = regras_do_catalogo([AppFalso()])
    assert regras[0].identificadores == ("Entrega X",)
    assert classificar([t(100.0, nome="ENTREGA X LTDA")], regras).total_identificado == 100.0


def test_vira_lancamento_de_ganho():
    c = classificar([t(300.0, nome="IFOOD", data="2026-09-10"),
                     t(400.0, nome="IFOOD", data="2026-10-08")], REGRAS)
    ls = para_lancamentos(c, "12345678909")
    assert len(ls) == 2
    assert ls[0] == {"cpf": "12345678909", "app": "ifood", "competencia": "2026-10",
                     "bruto": 400.0, "origem": "open_finance"}


# ------------------------------------------------------------------- CSV

def test_le_csv_do_banco_em_ptbr():
    csv = (
        "Data;Valor;Histórico;Pagador\n"
        "05/11/2026;1.234,56;Pix recebido;IFOOD COM AGENCIA\n"
        "06/11/2026;-80,00;Compra no posto;Posto Ipiranga\n"
        "10/11/2026;320,00;Pix recebido;99 TECNOLOGIA LTDA\n"
    )
    ts = ler_csv(csv)
    assert [x.valor for x in ts] == [1234.56, -80.0, 320.0]
    assert ts[0].data == "2026-11-05"
    c = classificar(ts, REGRAS)
    assert c.por_app["ifood"].total == 1234.56
    assert c.por_app["99"].total == 320.0
    assert c.total_creditos == 1554.56


def test_le_csv_em_formato_americano_com_virgula():
    csv = ("date,amount,description,counterparty\n"
           "2026-11-05,1234.56,Transfer,IFOOD\n")
    ts = ler_csv(csv)
    assert ts[0].valor == 1234.56 and ts[0].data == "2026-11-05"


def test_csv_sem_data_ou_valor_e_recusado():
    with pytest.raises(ValueError, match="data e valor"):
        ler_csv("nome;telefone\nJoão;11999990000\n")


def test_linha_quebrada_e_ignorada_sem_derrubar_o_resto():
    csv = ("Data;Valor;Pagador\n"
           "05/11/2026;300,00;IFOOD\n"
           "lixo;;;\n"
           "06/11/2026;;IFOOD\n"
           "07/11/2026;200,00;IFOOD\n")
    ts = ler_csv(csv)
    assert [x.valor for x in ts] == [300.0, 200.0]


# ------------------------------------------------------------------ HTTP

@pytest.fixture(scope="module")
def client():
    c = TestClient(make_app())
    c.post("/admin/seed")
    return c


CSV_EXEMPLO = (
    "Data;Valor;Histórico;Pagador\n"
    "05/09/2026;900,00;Pix recebido;IFOOD COM AGENCIA DE RESTAURANTES\n"
    "19/09/2026;850,00;Pix recebido;IFOOD COM AGENCIA DE RESTAURANTES\n"
    "03/10/2026;1.100,00;Pix recebido;IFOOD COM AGENCIA DE RESTAURANTES\n"
    "10/10/2026;400,00;Pix recebido;99 TECNOLOGIA LTDA\n"
    "12/10/2026;-250,00;Combustível;Posto Shell\n"
    "15/10/2026;500,00;Pix recebido;Jose da Silva\n"
)


# CPFs próprios deste arquivo: o banco de teste é compartilhado entre os
# arquivos, e reaproveitar CPF faz um teste enxergar o lançamento do outro.
CPF_CONFERIR = "70011122233"
CPF_IMPORTAR = "70044455566"


def test_conferir_antes_de_importar(client):
    r = client.post("/me/extrato/conferir",
                    json={"cpf": CPF_CONFERIR, "conteudo": CSV_EXEMPLO}).json()
    assert r["linhas_lidas"] == 6
    assert r["identificado_total"] == 3250.0
    assert r["creditos_total"] == 3750.0          # inclui o Pix do José
    assert r["cobertura"] == pytest.approx(0.8667, abs=0.001)
    assert r["por_app"]["ifood"]["total"] == 2850.0
    assert r["nao_identificados"][0]["pagador"] == "Jose da Silva"
    # conferir NÃO grava
    assert client.get(f"/me/resumo?cpf={CPF_CONFERIR}").json()["tem_dados"] is False


def test_importar_vira_renda_e_alimenta_a_simulacao(client):
    cpf = CPF_IMPORTAR
    r = client.post("/me/extrato/importar", json={"cpf": cpf, "conteudo": CSV_EXEMPLO}).json()
    assert r["lancamentos"] == 3                   # ifood set/out + 99 out

    resumo = client.get(f"/me/resumo?cpf={cpf}").json()
    assert resumo["tem_dados"] and resumo["bruto_total"] == 3250.0
    assert resumo["por_app"]["ifood"]["bruto"] == 2850.0

    s = client.post("/me/simular/credito_pessoal", json={"cpf": cpf, "parcelas": 12}).json()
    assert s["simulacao"] is True
    assert s["renda_considerada"]["renda_media"] == pytest.approx(1625.0, abs=1)


def test_extrato_sem_repasse_reconhecido_explica(client):
    r = client.post("/me/extrato/importar", json={
        "cpf": "52998224725",
        "conteudo": "Data;Valor;Pagador\n05/11/2026;500,00;Tia Cleide\n"})
    assert r.status_code == 422
    assert r.json()["detail"]["erro"] == "nenhum_repasse_reconhecido"
    assert r.json()["detail"]["nao_identificados"][0]["pagador"] == "Tia Cleide"


def test_open_finance_sem_fornecedor_diz_a_dependencia(client, monkeypatch):
    """Em produção não existe simulador: sem conexão cadastrada, a rota diz
    qual é a dependência em vez de devolver um consentimento de mentira."""
    from plataforma.registry import plataforma
    monkeypatch.delenv("PROVEDORES_MOCK", raising=False)
    plataforma.providers.limpar_cache()

    r = client.post("/me/openfinance/consentir", json={"cpf": "12345678909"})
    assert r.status_code == 503
    assert "Open Finance" in r.json()["detail"]["dependencia"]
    plataforma.providers.limpar_cache()


def test_adapter_open_finance_aparece_para_cadastro(client):
    tipos = client.get("/admin/tipos").json()
    renda = next(p for p in tipos["ports"] if p["port"] == "renda")
    of = next(f for f in renda["fornecedores"] if f["tipo"] == "open_finance")
    assert of["simulado"] is False
    campos = {c["chave"] for c in of["campos"]}
    assert {"modo", "base_url", "auth", "env_certificado", "url_autorizacao"} <= campos


def test_open_finance_exige_credencial_antes_de_prometer(client):
    r = client.post("/admin/conexoes", json={
        "id": "renda_of", "port": "renda", "tipo": "open_finance", "titulo": "Open Finance",
        "config": {"modo": "direto", "base_url": "https://transmissor.example.com",
                   "auth": {"token_url": "/token", "env_client_id": "OF_ID",
                            "env_client_secret": "OF_SECRET"},
                   "url_autorizacao": "https://banco.example.com/auth?consent={consentimento_id}"}})
    assert r.status_code == 200

    teste = client.post("/admin/conexoes/renda_of/testar").json()
    assert teste["health"]["ok"] is False
    assert teste["segredos_faltando"] == ["OF_ID", "OF_SECRET"]
    assert sorted(teste["capabilities"]) == ["renda.consentir", "renda.ler"]
    client.delete("/admin/conexoes/renda_of")
