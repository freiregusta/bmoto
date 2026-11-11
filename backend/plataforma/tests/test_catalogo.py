"""Catálogo administrável: conexões, produtos de crédito, apps, módulos."""

import pytest

from plataforma.catalogo import Catalogo
from plataforma.ports import Capability as C

SPEC_REST = {
    "base_url": "https://sandbox.fornecedor.com",
    "auth": {"tipo": "oauth2_client_credentials", "token_url": "/oauth/token",
             "env_client_id": "FORN_ID", "env_client_secret": "FORN_SECRET"},
    "operacoes": {
        "abrir_conta": {"metodo": "POST", "path": "/v1/accounts",
                        "body": {"documentNumber": "{cpf}", "fullName": "{nome}"},
                        "resposta": {"conta_id": "data.id", "numero": "data.number"}},
        "saldo": {"metodo": "GET", "path": "/v1/accounts/{conta_id}/balance",
                  "resposta": {"valor": "data.available"}},
        "pix_enviar": {"metodo": "POST", "path": "/v1/pix",
                       "body": {"amount": "{valor}", "key": "{chave}"},
                       "resposta": {"provider_tx_id": "data.id", "status": "=ENVIADO"}},
    },
}


@pytest.fixture
def cat(tmp_path, monkeypatch):
    # cada teste com seu próprio conjunto de tabelas
    import uuid
    return Catalogo(prefixo=f"t{uuid.uuid4().hex[:8]}")


# --------------------------------------------------------------- conexões

def test_cadastrar_baas_rest_sem_codigo(cat):
    c = cat.salvar_conexao({"port": "conta", "tipo": "rest", "titulo": "Fornecedor X",
                            "config": SPEC_REST})
    assert c.id == "conta_fornecedor_x" and c.ativo
    prov = cat.provider("conta")
    assert prov.nome == "Fornecedor X"
    # capabilities vêm das operações declaradas
    assert prov.capabilities() == {C.CONTA_ABRIR, C.CONTA_SALDO, C.PIX_ENVIAR}


def test_valida_operacao_invalida_para_o_port(cat):
    ruim = {**SPEC_REST, "operacoes": {"emitir_cartao": {"path": "/x"}}}
    with pytest.raises(ValueError, match="não aplicáveis"):
        cat.salvar_conexao({"port": "conta", "tipo": "rest", "config": ruim})


def test_valida_campos_obrigatorios_e_tipo(cat):
    with pytest.raises(ValueError, match="obrigatório"):
        cat.salvar_conexao({"port": "conta", "tipo": "rest", "config": {"base_url": "https://x"}})
    with pytest.raises(ValueError, match="desconhecido"):
        cat.salvar_conexao({"port": "conta", "tipo": "inexistente", "config": {}})
    with pytest.raises(ValueError, match="não atende"):
        cat.salvar_conexao({"port": "seguro", "tipo": "celcoin", "config": {}})


def test_conexao_por_modulo_vence_a_global(cat):
    cat.salvar_conexao({"id": "conta_global", "port": "conta", "tipo": "mock",
                        "titulo": "Conta global"})
    cat.salvar_conexao({"id": "conta_do_cartao", "port": "conta", "tipo": "rest",
                        "titulo": "BaaS do cartão", "escopo": "produto:cartao",
                        "config": SPEC_REST})
    assert cat.conexao_ativa("conta").id == "conta_global"
    assert cat.conexao_ativa("conta", "cartao").id == "conta_do_cartao"
    assert cat.provider("conta", "cartao").nome == "BaaS do cartão"
    assert cat.provider("conta", "moto").nome == "Conta global"      # cai na global


def test_prioridade_desempata_e_desligar_libera(cat):
    cat.salvar_conexao({"id": "a", "port": "kyc", "tipo": "mock", "titulo": "A", "prioridade": 50})
    cat.salvar_conexao({"id": "b", "port": "kyc", "tipo": "mock", "titulo": "B", "prioridade": 10})
    assert cat.conexao_ativa("kyc").id == "b"
    cat.desligar_conexao("b")
    assert cat.conexao_ativa("kyc").id == "a"
    cat.remover_conexao("a")
    assert cat.conexao_ativa("kyc") is None


def test_segredo_nao_vai_para_o_banco(cat):
    c = cat.salvar_conexao({"port": "conta", "tipo": "rest", "config": SPEC_REST})
    texto = str(cat.conexao(c.id).config)
    assert "FORN_SECRET" in texto               # o NOME da variável, sim
    assert "senha" not in texto.lower()
    prov = cat.provider("conta")
    assert prov.segredos_faltando() == ["FORN_ID", "FORN_SECRET"]
    assert not prov.configurado()


def test_auditoria_registra_quem_mudou(cat):
    cat.salvar_conexao({"id": "k", "port": "kyc", "tipo": "mock"}, quem="gustavo")
    cat.desligar_conexao("k", quem="gustavo")
    regs = cat.auditoria()
    assert [r["acao"] for r in regs[:2]] == ["desligar", "criar"]
    assert all(r["quem"] == "gustavo" for r in regs[:2])


# --------------------------------------------------- produtos de crédito

def test_produto_credito_calculos():
    from plataforma.catalogo import ProdutoCredito
    p = ProdutoCredito(id="moto", nome="Moto nova", tipo="financiamento_moto",
                       taxa_mensal=0.0219, prazo_min=24, prazo_max=48, ticket_min=8000,
                       ticket_max=30000, garantia_tipo="moto", ltv_max=0.90, tac=450,
                       renda_minima=1800, score_minimo=550)
    assert p.parcela(18_000, 48) == pytest.approx(609.8, abs=1)
    assert p.cet_anual(18_000, 48) > (1.0219 ** 12 - 1)          # TAC/IOF encarecem
    assert p.limite_por_garantia(20_000) == 18_000.0

    ok = p.avaliar(score=620, renda_media=3_000, idade=30, meses_renda=6, valor_garantia=20_000)
    assert ok["aprovado"] and ok["comprometimento"] <= 0.30
    assert ok["principal"] <= ok["limite"]

    sem_renda = p.avaliar(score=620, renda_media=1_000, idade=30, meses_renda=6,
                          valor_garantia=20_000)
    assert not sem_renda["aprovado"] and "renda_abaixo_do_minimo" in sem_renda["recusas"]

    sem_garantia = p.avaliar(score=620, renda_media=3_000, idade=30, meses_renda=6)
    assert "garantia_obrigatoria" in sem_garantia["recusas"]


def test_cartao_garantido_limita_por_ltv():
    from plataforma.catalogo import ProdutoCredito
    p = ProdutoCredito(id="card", nome="Cartão", tipo="cartao_garantido", ltv_max=0.30,
                       garantia_tipo="moto", ticket_min=500, ticket_max=8000,
                       score_minimo=500, renda_minima=1200, comprometimento_max=0.25)
    r = p.avaliar(score=600, renda_media=4_000, idade=30, meses_renda=12, valor_garantia=18_000)
    assert r["aprovado"] and r["limite"] == 5_400.0


def test_salvar_produto_valida_e_atualiza_parcial(cat):
    cat.salvar_produto_credito({"id": "pessoal", "nome": "Pessoal", "tipo": "credito_pessoal",
                                "taxa_mensal": 0.039, "prazo_max": 18})
    cat.salvar_produto_credito({"id": "pessoal", "nome": "Pessoal", "tipo": "credito_pessoal",
                                "taxa_mensal": 0.035})
    p = cat.produto_credito("pessoal")
    assert p.taxa_mensal == 0.035 and p.prazo_max == 18          # campo não enviado é preservado
    with pytest.raises(ValueError, match="tipo inválido"):
        cat.salvar_produto_credito({"nome": "x", "tipo": "cripto"})
    with pytest.raises(ValueError, match="prazo_min"):
        cat.salvar_produto_credito({"nome": "y", "tipo": "credito_pessoal",
                                    "prazo_min": 48, "prazo_max": 12})


def test_emissor_precisa_ser_conexao_de_credito(cat):
    cat.salvar_conexao({"id": "conta_x", "port": "conta", "tipo": "mock"})
    with pytest.raises(ValueError, match="port 'credito'"):
        cat.salvar_produto_credito({"nome": "z", "tipo": "credito_pessoal",
                                    "emissor_conexao_id": "conta_x"})


# ------------------------------------------------------- apps de entrega

def test_app_sem_integracao_nao_inventa_renda(cat):
    """Sem contrato de integração, não existe provider: a renda vem do que o
    entregador lança. Melhor não ter resposta do que ter uma inventada."""
    from plataforma.registry import ProvedorNaoConfigurado
    a = cat.salvar_app_entrega({"nome": "iFood", "tipo_integracao": "declarado", "ordem": 10})
    assert a.slug == "ifood" and a.provider_tipo == "nenhum"
    with pytest.raises(ProvedorNaoConfigurado, match="iFood"):
        cat.provider_app_entrega(a.id)
    with pytest.raises(ValueError, match="tipo_integracao"):
        cat.salvar_app_entrega({"nome": "X", "tipo_integracao": "telepatia"})
    with pytest.raises(ValueError, match="ler_renda"):
        cat.salvar_app_entrega({"nome": "Y", "provider_tipo": "rest",
                                "config": {"base_url": "https://y", "operacoes": {}}})


def test_app_entrega_rest_declara_leitura_de_renda(cat):
    spec = {"base_url": "https://api.app.com", "auth": {"tipo": "nenhum"},
            "operacoes": {"ler_renda": {"metodo": "GET", "path": "/ganhos",
                                        "lista": "data", "item": {"bruto": "amount"}},
                          "consentir_renda": {"metodo": "POST", "path": "/consent",
                                              "resposta": {"consentimento_id": "id"}}}}
    a = cat.salvar_app_entrega({"nome": "App Regional", "provider_tipo": "rest", "config": spec})
    prov = cat.provider_app_entrega(a.id)
    assert prov.capabilities() == {C.RENDA_LER, C.RENDA_CONSENTIR}


# --------------------------------------------------------------- módulos

def test_modulo_override_do_admin(cat):
    cat.salvar_modulo({"id": "cartao", "enabled": False, "titulo": "Cartão BMoto", "ordem": 15})
    from plataforma.produtos import PRODUTOS
    m = next(p for p in PRODUTOS if p.id == "cartao")
    d = cat.manifesto_efetivo(m)
    assert d["enabled"] is False and d["titulo"] == "Cartão BMoto"
    assert d["ordem"] == 15 and d["origem_flag"] == "admin"
    with pytest.raises(ValueError, match="não existe"):
        cat.salvar_modulo({"id": "inexistente", "enabled": True})


def test_env_vence_o_admin(cat, monkeypatch):
    cat.salvar_modulo({"id": "saude", "enabled": True})
    monkeypatch.setenv("PRODUTO_SAUDE", "off")
    from plataforma.produtos import PRODUTOS
    m = next(p for p in PRODUTOS if p.id == "saude")
    d = cat.manifesto_efetivo(m)
    assert d["enabled"] is False and d["origem_flag"] == "env"
