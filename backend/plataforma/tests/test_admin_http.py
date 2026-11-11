"""API de administração e de jornadas, pela porta da frente (HTTP)."""

import pytest
from fastapi.testclient import TestClient

from api import make_app

SPEC_REST = {
    "base_url": "https://sandbox.novobaas.com",
    "auth": {"tipo": "oauth2_client_credentials", "token_url": "/oauth/token",
             "env_client_id": "NOVO_ID", "env_client_secret": "NOVO_SECRET"},
    "operacoes": {
        "abrir_conta": {"metodo": "POST", "path": "/accounts",
                        "body": {"doc": "{cpf}"}, "resposta": {"conta_id": "id"}},
        "saldo": {"metodo": "GET", "path": "/accounts/{conta_id}", "resposta": {"valor": "balance"}},
        "extrato": {"metodo": "GET", "path": "/accounts/{conta_id}/entries",
                    "lista": "items", "item": {"valor": "amount"}},
        "pix_enviar": {"metodo": "POST", "path": "/pix", "resposta": {"provider_tx_id": "id"}},
        "cobrar": {"metodo": "POST", "path": "/charges", "resposta": {"cobranca_id": "id"}},
        "creditar": {"metodo": "POST", "path": "/credits", "resposta": {"lancamento_id": "id"}},
        "pix_automatico": {"metodo": "POST", "path": "/pix/auto", "resposta": {"id": "id"}},
    },
}


@pytest.fixture(scope="module")
def client():
    c = TestClient(make_app())
    c.post("/admin/seed")
    return c


def test_token_de_admin_exigido(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "segredo")
    c = TestClient(make_app())
    assert c.get("/admin/resumo").status_code == 401
    assert c.get("/admin/resumo", headers={"X-Admin-Token": "segredo"}).status_code == 200
    # app do cliente segue aberto
    assert c.get("/platform/modules").status_code == 200


def test_tipos_alimentam_o_formulario_da_tela(client):
    d = client.get("/admin/tipos").json()
    conta = next(p for p in d["ports"] if p["port"] == "conta")
    tipos = {f["tipo"] for f in conta["fornecedores"]}
    assert {"mock", "rest", "celcoin"} <= tipos
    rest = next(f for f in conta["fornecedores"] if f["tipo"] == "rest")
    assert rest["sem_codigo"] is True
    assert {c["chave"] for c in rest["campos"]} >= {"base_url", "auth", "operacoes"}
    assert "pix_enviar" in conta["operacoes_rest"]
    assert "financiamento_moto" in d["tipos_produto_credito"]
    assert "oferta" in d["tipos_passo"]


def test_seed_cria_catalogo_inicial(client):
    assert len(client.get("/admin/conexoes").json()["conexoes"]) >= 8
    assert len(client.get("/admin/produtos-credito").json()["produtos"]) >= 5
    assert len(client.get("/admin/apps-entrega").json()["apps"]) >= 5
    assert len(client.get("/admin/jornadas").json()["jornadas"]) >= 7
    r = client.get("/admin/resumo").json()
    assert r["modulos"]["ligados"] >= 5 and r["pendencias"] == []


def test_cadastrar_baas_novo_pela_api_e_testar(client):
    r = client.post("/admin/conexoes", json={
        "id": "conta_novobaas", "port": "conta", "tipo": "rest", "titulo": "Novo BaaS",
        "escopo": "produto:conta", "config": SPEC_REST, "prioridade": 10})
    assert r.status_code == 200 and r.json()["escopo"] == "produto:conta"

    t = client.post("/admin/conexoes/conta_novobaas/testar").json()
    assert t["health"]["ok"] is False                     # sem credencial no ambiente
    assert t["segredos_faltando"] == ["NOVO_ID", "NOVO_SECRET"]
    assert "conta.abrir" in t["capabilities"]

    # o módulo "conta" passou a apontar para o novo fornecedor
    mods = {m["id"]: m for m in client.get("/platform/modules").json()["modules"]}
    assert mods["conta"]["providers"]["conta"] == "Novo BaaS"
    assert mods["moto"]["providers"]["conta"] != "Novo BaaS"      # escopo não vazou

    client.post("/admin/conexoes/conta_novobaas/desligar")
    assert client.delete("/admin/conexoes/conta_novobaas").json()["removida"] == "conta_novobaas"


def test_conexao_invalida_é_recusada_com_motivo(client):
    r = client.post("/admin/conexoes", json={"port": "conta", "tipo": "rest",
                                             "config": {"base_url": "https://x"}})
    assert r.status_code == 422 and "obrigatório" in r.json()["detail"]
    r = client.post("/admin/conexoes", json={"port": "voar", "tipo": "mock", "config": {}})
    assert r.status_code == 422 and "port inválido" in r.json()["detail"]


def test_produto_de_credito_novo_e_simulacao(client):
    r = client.post("/admin/produtos-credito", json={
        "id": "celular_parcelado", "nome": "Celular parcelado", "tipo": "financiamento_celular",
        "taxa_mensal": 0.0449, "prazo_min": 6, "prazo_max": 18, "ticket_min": 800,
        "ticket_max": 6_000, "score_minimo": 520, "renda_minima": 1_400,
        "comprometimento_max": 0.15, "garantia_tipo": "nenhuma", "modulo_id": "conta"})
    assert r.status_code == 200

    s = client.post("/admin/produtos-credito/celular_parcelado/simular",
                    json={"score": 600, "renda_media": 3_000, "idade": 30,
                          "meses_renda": 6, "parcelas": 12}).json()
    assert s["aprovado"] and s["parcela"] <= 3_000 * 0.15
    assert s["cet_anual"] > 0.0449 * 12

    s2 = client.post("/admin/produtos-credito/celular_parcelado/simular",
                     json={"score": 480, "renda_media": 3_000, "idade": 30}).json()
    assert not s2["aprovado"] and "score_abaixo_do_minimo" in s2["recusas"]

    # moto com garantia: limite preso ao LTV
    s3 = client.post("/admin/produtos-credito/moto_nova/simular",
                     json={"score": 620, "renda_media": 4_000, "idade": 32,
                           "meses_renda": 6, "valor_garantia": 15_000}).json()
    assert s3["limite"] <= 13_500.0

    client.delete("/admin/produtos-credito/celular_parcelado")


def test_app_de_entrega_novo(client):
    r = client.post("/admin/apps-entrega", json={
        "nome": "Entrega Regional", "tipo_integracao": "api", "provider_tipo": "mock",
        "periodicidade_repasse": "diario", "repasse_direto": True, "ordem": 60})
    assert r.status_code == 200 and r.json()["slug"] == "entrega_regional"
    assert client.post("/admin/apps-entrega/entrega_regional/testar").json()["health"]["ok"]
    client.delete("/admin/apps-entrega/entrega_regional")


def test_ligar_e_desligar_modulo_pelo_admin(client):
    r = client.put("/admin/modulos/saude", json={"id": "saude", "enabled": False,
                                                 "titulo": "Saúde (em breve)"})
    assert r.json()["efetivo"]["enabled"] is False
    assert r.json()["efetivo"]["origem_flag"] == "admin"
    mods = {m["id"]: m for m in client.get("/platform/modules").json()["modules"]}
    assert mods["saude"]["titulo"] == "Saúde (em breve)"
    assert client.post("/platform/seguro/cotar", json={
        "pessoa": {"cpf": "12345678909", "nome": "x", "nascimento": "1990-01-01"}}).status_code == 200
    client.put("/admin/modulos/saude", json={"id": "saude", "enabled": True, "titulo": "Seguro saúde"})

    # consignado religado pelo admin volta a aparecer ligado
    client.put("/admin/modulos/consignado_clt", json={"id": "consignado_clt", "enabled": True})
    mods = {m["id"]: m for m in client.get("/platform/modules").json()["modules"]}
    assert mods["consignado_clt"]["enabled"] is True
    client.put("/admin/modulos/consignado_clt", json={"id": "consignado_clt", "enabled": False})


def test_montar_jornada_pela_api_e_rodar_no_app(client):
    r = client.post("/admin/jornadas", json={
        "id": "jornada_teste", "nome": "Jornada de teste", "modulo_id": "margem", "passos": [
            {"id": "dados", "tipo": "formulario", "titulo": "Dados",
             "config": {"campos": [{"chave": "nome", "titulo": "Nome", "obrigatorio": True}]}},
            {"id": "ok", "tipo": "mensagem", "titulo": "Fim", "config": {"texto": "pronto"}}]})
    assert r.status_code == 200 and len(r.json()["passos"]) == 2

    assert client.get("/jornadas/modulo/margem").json()["id"] == "jornada_teste"
    st = client.post("/jornadas/jornada_teste/iniciar",
                     json={"cpf": "12345678909", "contexto": {}}).json()
    eid = st["execucao_id"]
    assert st["passo_atual"]["id"] == "dados"
    st = client.post(f"/jornadas/execucao/{eid}/avancar", json={"resposta": {}}).json()
    assert st["passo_atual"]["id"] == "dados"            # campo obrigatório vazio
    st = client.post(f"/jornadas/execucao/{eid}/avancar",
                     json={"resposta": {"nome": "João"}}).json()
    st = client.post(f"/jornadas/execucao/{eid}/avancar", json={"resposta": {}}).json()
    assert st["status"] == "CONCLUIDA"
    assert client.get(f"/jornadas/execucao/{eid}").json()["status"] == "CONCLUIDA"
    assert any(e["id"] == eid for e in client.get("/admin/execucoes").json()["execucoes"])
    client.delete("/admin/jornadas/jornada_teste")


def test_jornada_de_moto_do_seed_roda_ponta_a_ponta(client):
    st = client.post("/jornadas/jornada_moto/iniciar", json={
        "cpf": "12345678909",
        "contexto": {"nome": "João Entregador", "nascimento": "1995-03-10", "score": 640}}).json()
    eid = st["execucao_id"]
    # o app responde conforme o passo que recebeu — é assim que ele dirige a jornada
    por_passo = {"apps": {"apps": ["ifood", "99"]}, "moto": {"valor_garantia": 22_000},
                 "prazo": {"prazo": 48}, "ccb": {"aceito": True}}
    for _ in range(12):
        if st["status"] != "EM_ANDAMENTO" or not st["passo_atual"]:
            break
        resposta = por_passo.get(st["passo_atual"]["id"], {})
        st = client.post(f"/jornadas/execucao/{eid}/avancar", json={"resposta": resposta}).json()
    assert st["status"] == "CONCLUIDA", st["historico"][-1]
    ctx = st["contexto"]
    assert ctx["oferta"]["aprovado"] and ctx["contrato"]["parcela"] > 0
    assert ctx["apolice"]["produto"] == "moto"           # seguro da moto no fim da jornada


def test_auditoria_registra_as_mudancas(client):
    client.put("/admin/modulos/margem", json={"id": "margem", "ordem": 31})
    regs = client.get("/admin/auditoria?limite=5").json()["registros"]
    assert any(r["entidade"] == "modulo" and r["entidade_id"] == "margem" for r in regs)
