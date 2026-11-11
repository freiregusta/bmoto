"""Motor de jornadas: condições, passos automáticos, recusa e mesa."""

import uuid

import pytest

from plataforma.catalogo import Catalogo
from plataforma.jornadas import MotorJornadas, RepositorioJornadas, _condicao_ok
from plataforma.registry import Plataforma


@pytest.fixture
def ambiente():
    pref = f"j{uuid.uuid4().hex[:8]}"
    cat = Catalogo(prefixo=pref)
    repo = RepositorioJornadas(prefixo=pref)
    plat = Plataforma()
    plat.providers.consultar_catalogo = False     # usa os mocks do registry
    cat.salvar_app_entrega({"id": "ifood", "nome": "iFood", "slug": "ifood"})
    cat.salvar_app_entrega({"id": "99", "nome": "99Food", "slug": "99"})
    cat.salvar_produto_credito({"id": "moto_nova", "nome": "Moto nova",
                                "tipo": "financiamento_moto", "taxa_mensal": 0.0219,
                                "prazo_min": 24, "prazo_max": 48, "ticket_min": 8_000,
                                "ticket_max": 30_000, "garantia_tipo": "moto",
                                "ltv_max": 0.90, "score_minimo": 550, "renda_minima": 1_800,
                                "meses_renda_comprovada": 3, "modulo_id": "moto"})
    return cat, repo, MotorJornadas(repo, cat, plat)


# --------------------------------------------------------------- condições

def test_condicoes_sem_eval():
    ctx = {"renda_media": 2500, "tem_mei": True, "oferta": {"aprovado": True}, "nome": ""}
    assert _condicao_ok(None, ctx) and _condicao_ok("", ctx)
    assert _condicao_ok("renda_media >= 1800", ctx)
    assert not _condicao_ok("renda_media >= 3000", ctx)
    assert _condicao_ok("tem_mei == true", ctx)
    assert _condicao_ok("oferta.aprovado == true", ctx)
    assert _condicao_ok("renda_media >= 1800 e tem_mei == true", ctx)
    assert not _condicao_ok("renda_media >= 1800 e oferta.aprovado == false", ctx)
    assert not _condicao_ok("nome", ctx)                     # campo vazio = falso
    assert not _condicao_ok("inexistente.coisa == 1", ctx)


# --------------------------------------------------------------- cadastro

def test_validacao_da_jornada(ambiente):
    _, repo, _ = ambiente
    with pytest.raises(ValueError, match="ao menos um passo"):
        repo.salvar({"nome": "vazia", "passos": []})
    with pytest.raises(ValueError, match="inválido"):
        repo.salvar({"nome": "x", "passos": [{"tipo": "dancar", "titulo": "?"}]})
    with pytest.raises(ValueError, match="repetido"):
        repo.salvar({"nome": "x", "passos": [{"id": "a", "tipo": "mensagem"},
                                             {"id": "a", "tipo": "mensagem"}]})
    j1 = repo.salvar({"id": "j", "nome": "J", "modulo_id": "conta",
                      "passos": [{"tipo": "mensagem", "titulo": "oi"}]})
    j2 = repo.salvar({"id": "j", "nome": "J", "modulo_id": "conta",
                      "passos": [{"tipo": "mensagem", "titulo": "oi"}]})
    assert j2.versao == j1.versao + 1                         # versiona a cada salvar
    assert repo.por_modulo("conta").id == "j"


# --------------------------------------------------------------- execução

@pytest.mark.asyncio
async def test_jornada_de_conta_ponta_a_ponta(ambiente):
    _, repo, motor = ambiente
    repo.salvar({"id": "jc", "nome": "Abrir conta", "modulo_id": "conta", "passos": [
        {"id": "dados", "tipo": "formulario", "titulo": "Seus dados", "config": {"campos": [
            {"chave": "nome", "titulo": "Nome", "obrigatorio": True},
            {"chave": "nascimento", "titulo": "Nascimento", "obrigatorio": True}]}},
        {"id": "lgpd", "tipo": "consentimento", "titulo": "LGPD", "config": {"texto": "..."}},
        {"id": "kyc", "tipo": "kyc", "titulo": "Identidade"},
        {"id": "abrir", "tipo": "provisionar", "titulo": "Abrindo",
         "config": {"acoes": ["abrir_conta"]}},
        {"id": "fim", "tipo": "mensagem", "titulo": "Pronto", "config": {"texto": "ok"}},
    ]})
    e = motor.iniciar("jc", "12345678909")
    st = motor.estado(e.id)
    assert st["passo_atual"]["id"] == "dados" and st["progresso"]["total"] == 5

    st = await motor.avancar(e.id, {"nome": "João"})          # falta nascimento
    assert st["passo_atual"]["id"] == "dados"
    assert st["historico"][-1]["resultado"]["campos"] == ["nascimento"]

    st = await motor.avancar(e.id, {"nome": "João", "nascimento": "1995-03-10"})
    assert st["passo_atual"]["id"] == "lgpd"
    st = await motor.avancar(e.id, {"aceito": False})         # consentimento negado trava
    assert st["passo_atual"]["id"] == "lgpd"
    st = await motor.avancar(e.id, {"aceito": True})
    assert st["passo_atual"]["id"] == "kyc" and st["automatico"] is True
    st = await motor.avancar(e.id)                            # automático: sem corpo
    assert st["contexto"]["kyc_ok"] is True
    st = await motor.avancar(e.id)                            # provisionar
    assert st["contexto"]["conta"]["conta_id"].startswith("cta_")
    st = await motor.avancar(e.id)
    assert st["status"] == "CONCLUIDA" and st["passo_atual"] is None


@pytest.mark.asyncio
async def test_jornada_de_moto_com_renda_oferta_e_ccb(ambiente):
    _, repo, motor = ambiente
    repo.salvar({"id": "jm", "nome": "Moto", "modulo_id": "moto",
                 "produto_credito_id": "moto_nova", "passos": [
        {"id": "apps", "tipo": "conectar_app", "titulo": "Apps",
         "config": {"apps": ["ifood", "99"], "minimo": 1}},
        {"id": "renda", "tipo": "renda", "titulo": "Renda", "config": {"meses": 3, "minimo": 1800}},
        {"id": "moto", "tipo": "formulario", "titulo": "A moto", "config": {"campos": [
            {"chave": "valor_garantia", "titulo": "Valor", "obrigatorio": True}]}},
        {"id": "prazo", "tipo": "escolha", "titulo": "Prazo",
         "config": {"chave": "prazo", "opcoes": [24, 36, 48]}},
        {"id": "oferta", "tipo": "oferta", "titulo": "Oferta",
         "config": {"produto_credito_id": "moto_nova"}},
        {"id": "ccb", "tipo": "assinatura", "titulo": "Contrato", "config": {"documento": "ccb"}},
        {"id": "extra", "tipo": "mensagem", "titulo": "Só para MEI",
         "condicao": "tem_mei == true", "config": {"texto": "benefício MEI"}},
    ]})
    e = motor.iniciar("jm", "12345678909", {"nome": "João", "nascimento": "1995-03-10",
                                            "score": 620})
    st = await motor.avancar(e.id, {"apps": ["ifood", "99"]})
    assert len(st["contexto"]["apps_conectados"]) == 2
    st = await motor.avancar(e.id)                            # renda: 2480 + 910
    assert st["contexto"]["renda_media"] == pytest.approx(3_267, abs=60)
    st = await motor.avancar(e.id, {"valor_garantia": 20_000})
    st = await motor.avancar(e.id, {"prazo": 48})
    assert st["contexto"]["prazo"] == 48
    st = await motor.avancar(e.id)                            # oferta
    oferta = st["contexto"]["oferta"]
    assert oferta["aprovado"] and oferta["parcelas"] == 48
    assert oferta["limite"] <= 18_000                          # 90% de 20 mil
    st = await motor.avancar(e.id, {"aceito": True})           # CCB
    assert st["contexto"]["contrato"]["contrato_id"].startswith("ccb_")
    # passo condicional de MEI não é elegível: jornada encerra
    assert st["status"] == "CONCLUIDA"
    assert all(p["id"] != "extra" for p in st["passos"])


@pytest.mark.asyncio
async def test_renda_insuficiente_recusa_a_jornada(ambiente):
    cat, repo, motor = ambiente
    cat.salvar_app_entrega({"id": "pequeno", "nome": "App pequeno", "slug": "uber"})  # renda 0
    repo.salvar({"id": "jr", "nome": "Recusa", "passos": [
        {"id": "apps", "tipo": "conectar_app", "titulo": "Apps", "config": {"apps": ["uber"]}},
        {"id": "renda", "tipo": "renda", "titulo": "Renda", "config": {"minimo": 1800}},
    ]})
    e = motor.iniciar("jr", "12345678909")
    await motor.avancar(e.id, {"apps": ["uber"]})
    st = await motor.avancar(e.id)
    assert st["status"] == "RECUSADA"
    assert st["historico"][-1]["resultado"]["erro"] == "renda_insuficiente"


@pytest.mark.asyncio
async def test_kyc_reprovado_vai_para_a_mesa(ambiente):
    _, repo, motor = ambiente
    repo.salvar({"id": "jk", "nome": "Mesa", "passos": [
        {"id": "kyc", "tipo": "kyc", "titulo": "KYC", "config": {"mesa_se_reprovar": True}},
    ]})
    e = motor.iniciar("jk", "98765432100", {"nome": "X", "nascimento": "1990-01-01"})
    st = await motor.avancar(e.id)
    assert st["status"] == "PENDENTE_MESA"
    assert "lista_restritiva" in st["contexto"]["kyc"]["motivos"]
    assert repo.execucoes(status="PENDENTE_MESA")[0].id == e.id


@pytest.mark.asyncio
async def test_revisao_manual_e_escolha_invalida(ambiente):
    _, repo, motor = ambiente
    repo.salvar({"id": "jv", "nome": "Manual", "passos": [
        {"id": "plano", "tipo": "escolha", "titulo": "Plano",
         "config": {"chave": "plano", "opcoes": ["basico", "pleno"]}},
        {"id": "mesa", "tipo": "revisao_manual", "titulo": "Mesa", "config": {"fila": "credito"}},
    ]})
    e = motor.iniciar("jv", "12345678909")
    st = await motor.avancar(e.id, {"plano": "ouro"})
    assert st["passo_atual"]["id"] == "plano"
    st = await motor.avancar(e.id, {"plano": "pleno"})
    st = await motor.avancar(e.id)
    assert st["status"] == "PENDENTE_MESA"


@pytest.mark.asyncio
async def test_provisionar_mei_e_saude_em_sequencia(ambiente):
    _, repo, motor = ambiente
    repo.salvar({"id": "jms", "nome": "MEI + saúde", "passos": [
        {"id": "mei", "tipo": "provisionar", "titulo": "Abrir MEI",
         "config": {"acoes": ["abrir_mei"], "cnae": "5320-2/02"}},
        {"id": "seguro", "tipo": "provisionar", "titulo": "Seguro",
         "config": {"acoes": ["emitir_seguro"], "produto": "vida_ap"}},
    ]})
    e = motor.iniciar("jms", "12345678909", {"nome": "João", "nascimento": "1995-03-10"})
    st = await motor.avancar(e.id)
    assert st["contexto"]["cnpj_mei"]
    st = await motor.avancar(e.id)
    assert st["contexto"]["apolice"]["premio_mensal"] == 19.90
    assert st["status"] == "CONCLUIDA"
