"""
seeds.py — carga inicial do catálogo.

Roda uma vez (idempotente) para o admin abrir com algo em tela: conexões mock
em todos os ports, os quatro produtos de crédito do plano, os apps de entrega
e as jornadas de cada módulo. Nada aqui é regra de negócio definitiva — é
exatamente o tipo de coisa que o administrador passa a editar.

    python -m plataforma.seeds           # semeia
    python -m plataforma.seeds --forcar  # sobrescreve o que já existe
"""

from __future__ import annotations

import sys

CONEXOES = [
    {"id": "conta_mock", "port": "conta", "tipo": "mock", "titulo": "Conta (mock)", "prioridade": 500},
    {"id": "cartao_mock", "port": "cartao", "tipo": "mock", "titulo": "Cartão (mock)", "prioridade": 500},
    {"id": "kyc_mock", "port": "kyc", "tipo": "mock", "titulo": "KYC (mock)", "prioridade": 500},
    {"id": "credito_mock", "port": "credito", "tipo": "mock", "titulo": "Emissor (mock)", "prioridade": 500},
    {"id": "seguro_mock", "port": "seguro", "tipo": "mock", "titulo": "Seguradora (mock)", "prioridade": 500},
    {"id": "saude_mock", "port": "saude", "tipo": "mock", "titulo": "Operadora de saúde (mock)", "prioridade": 500},
    {"id": "contador_mock", "port": "contador", "tipo": "mock", "titulo": "Contabilidade (mock)", "prioridade": 500},
    {"id": "renda_mock", "port": "renda", "tipo": "mock", "titulo": "Renda (mock)", "prioridade": 500},
]

PRODUTOS_CREDITO = [
    {"id": "moto_nova", "nome": "Financiamento de moto nova", "tipo": "financiamento_moto",
     "taxa_mensal": 0.0219, "prazo_min": 24, "prazo_max": 48, "ticket_min": 8_000,
     "ticket_max": 30_000, "garantia_tipo": "moto", "ltv_max": 0.90, "score_minimo": 550,
     "renda_minima": 1_800, "comprometimento_max": 0.30, "exige_mei": False,
     "meses_renda_comprovada": 3, "tac": 450, "cobranca": "pix_automatico",
     "modulo_id": "moto", "jornada_id": "jornada_moto"},
    {"id": "cartao_garantido_moto", "nome": "Cartão com garantia da moto", "tipo": "cartao_garantido",
     "taxa_mensal": 0.0599, "prazo_min": 1, "prazo_max": 12, "ticket_min": 500,
     "ticket_max": 8_000, "garantia_tipo": "moto", "ltv_max": 0.30, "score_minimo": 500,
     "renda_minima": 1_200, "comprometimento_max": 0.25, "cobranca": "desconto_repasse",
     "modulo_id": "cartao", "jornada_id": "jornada_cartao"},
    {"id": "credito_pessoal", "nome": "Crédito pessoal do entregador", "tipo": "credito_pessoal",
     "taxa_mensal": 0.0389, "prazo_min": 6, "prazo_max": 18, "ticket_min": 500,
     "ticket_max": 5_000, "garantia_tipo": "nenhuma", "score_minimo": 580,
     "renda_minima": 1_500, "comprometimento_max": 0.20, "cobranca": "desconto_repasse",
     "modulo_id": "conta", "jornada_id": "jornada_credito_pessoal"},
    {"id": "antecipacao", "nome": "Antecipação de repasse", "tipo": "antecipacao_recebiveis",
     "taxa_mensal": 0.0290, "prazo_min": 1, "prazo_max": 2, "ticket_min": 100,
     "ticket_max": 2_000, "garantia_tipo": "recebiveis", "ltv_max": 0.70,
     "score_minimo": 450, "renda_minima": 800, "comprometimento_max": 0.50,
     "meses_renda_comprovada": 1, "cobranca": "desconto_repasse", "modulo_id": "ganhos"},
    {"id": "consignado_clt", "nome": "Consignado CLT (legado)", "tipo": "consignado_clt",
     "taxa_mensal": 0.0179, "prazo_min": 6, "prazo_max": 36, "ticket_min": 500,
     "ticket_max": 20_000, "score_minimo": 400, "renda_minima": 1_518,
     "comprometimento_max": 0.35, "cobranca": "boleto", "modulo_id": "consignado_clt",
     "ativo": False},
]

APPS_ENTREGA = [
    {"id": "ifood", "nome": "iFood", "slug": "ifood", "tipo_integracao": "api",
     "provider_tipo": "mock", "periodicidade_repasse": "semanal", "ordem": 10},
    {"id": "rappi", "nome": "Rappi", "slug": "rappi", "tipo_integracao": "api",
     "provider_tipo": "mock", "periodicidade_repasse": "semanal", "ordem": 20},
    {"id": "99", "nome": "99Food", "slug": "99", "tipo_integracao": "api",
     "provider_tipo": "mock", "periodicidade_repasse": "semanal", "ordem": 30},
    {"id": "uber", "nome": "Uber Eats", "slug": "uber", "tipo_integracao": "open_finance",
     "provider_tipo": "mock", "periodicidade_repasse": "semanal", "ordem": 40},
    {"id": "loggi", "nome": "Loggi", "slug": "loggi", "tipo_integracao": "manual",
     "provider_tipo": "mock", "periodicidade_repasse": "quinzenal", "ordem": 50},
]

_CONSENT_LGPD = ("Autorizo a BMoto a consultar meus dados para abrir a conta e avaliar "
                 "crédito, nos termos da LGPD.")

JORNADAS = [
    {"id": "jornada_conta", "nome": "Abrir conta BMoto", "modulo_id": "conta", "passos": [
        {"id": "dados", "tipo": "formulario", "titulo": "Seus dados", "config": {"campos": [
            {"chave": "nome", "titulo": "Nome completo", "tipo": "texto", "obrigatorio": True},
            {"chave": "nascimento", "titulo": "Data de nascimento", "tipo": "data", "obrigatorio": True},
            {"chave": "celular", "titulo": "Celular", "tipo": "telefone", "obrigatorio": True},
            {"chave": "email", "titulo": "E-mail", "tipo": "email"}]}},
        {"id": "lgpd", "tipo": "consentimento", "titulo": "Autorização de dados",
         "config": {"texto": _CONSENT_LGPD, "versao": "v1"}},
        {"id": "kyc", "tipo": "kyc", "titulo": "Confirmação de identidade",
         "config": {"mesa_se_reprovar": True}},
        {"id": "abrir", "tipo": "provisionar", "titulo": "Abrindo sua conta",
         "config": {"acoes": ["abrir_conta"]}},
        {"id": "pronto", "tipo": "mensagem", "titulo": "Conta aberta",
         "config": {"texto": "Sua conta está pronta. Aponte o repasse dos apps para a sua chave Pix."}},
    ]},
    {"id": "jornada_ganhos", "nome": "Conectar apps de entrega", "modulo_id": "ganhos", "passos": [
        {"id": "escolher", "tipo": "conectar_app", "titulo": "Conecte seus apps",
         "config": {"apps": ["ifood", "rappi", "99"], "minimo": 1}},
        {"id": "renda", "tipo": "renda", "titulo": "Lendo seus ganhos", "config": {"meses": 3}},
        {"id": "resumo", "tipo": "mensagem", "titulo": "Ganhos consolidados",
         "config": {"texto": "Pronto: seus ganhos dos últimos 3 meses já aparecem no app."}},
    ]},
    {"id": "jornada_mei", "nome": "Abrir e cuidar da MEI", "modulo_id": "mei", "passos": [
        {"id": "dados", "tipo": "formulario", "titulo": "Dados para a MEI", "config": {"campos": [
            {"chave": "nome", "titulo": "Nome completo", "tipo": "texto", "obrigatorio": True},
            {"chave": "nascimento", "titulo": "Data de nascimento", "tipo": "data", "obrigatorio": True}]}},
        {"id": "procuracao", "tipo": "consentimento", "titulo": "Procuração e-CAC",
         "config": {"texto": "Autorizo a BMoto a me representar no e-CAC para abrir e manter a MEI.",
                    "versao": "v1"}},
        {"id": "abrir", "tipo": "provisionar", "titulo": "Abrindo sua MEI",
         "config": {"acoes": ["abrir_mei"], "cnae": "5320-2/02"}},
        {"id": "pronto", "tipo": "mensagem", "titulo": "MEI aberta",
         "config": {"texto": "CNPJ emitido. O DAS mensal entra no seu calendário."}},
    ]},
    {"id": "jornada_moto", "nome": "Financiar uma moto", "modulo_id": "moto",
     "produto_credito_id": "moto_nova", "passos": [
        {"id": "apps", "tipo": "conectar_app", "titulo": "Conecte seus apps",
         "config": {"apps": ["ifood", "rappi", "99"], "minimo": 1}},
        {"id": "renda", "tipo": "renda", "titulo": "Analisando seus ganhos",
         "config": {"meses": 3, "minimo": 1800}},
        {"id": "moto", "tipo": "formulario", "titulo": "A moto", "config": {"campos": [
            {"chave": "valor_garantia", "titulo": "Valor da moto", "tipo": "moeda", "obrigatorio": True},
            {"chave": "modelo", "titulo": "Modelo", "tipo": "texto"}]}},
        {"id": "prazo", "tipo": "escolha", "titulo": "Em quantas vezes?",
         "config": {"chave": "prazo", "opcoes": [24, 36, 48]}},
        {"id": "oferta", "tipo": "oferta", "titulo": "Sua oferta",
         "config": {"produto_credito_id": "moto_nova", "mesa_se_recusar": True}},
        {"id": "kyc", "tipo": "kyc", "titulo": "Confirmação de identidade"},
        {"id": "ccb", "tipo": "assinatura", "titulo": "Assinatura do contrato",
         "config": {"documento": "ccb", "exige_selfie": True}},
        {"id": "seguro", "tipo": "provisionar", "titulo": "Seguro da moto",
         "condicao": "oferta.aprovado == true",
         "config": {"acoes": ["emitir_seguro"], "produto": "moto"}},
        {"id": "pronto", "tipo": "mensagem", "titulo": "Financiamento aprovado",
         "config": {"texto": "Contrato assinado. A parcela sai do seu repasse."}},
    ]},
    {"id": "jornada_cartao", "nome": "Cartão com garantia da moto", "modulo_id": "cartao",
     "produto_credito_id": "cartao_garantido_moto", "passos": [
        {"id": "moto", "tipo": "formulario", "titulo": "Sua moto", "config": {"campos": [
            {"chave": "placa", "titulo": "Placa", "tipo": "texto", "obrigatorio": True},
            {"chave": "valor_garantia", "titulo": "Valor da moto", "tipo": "moeda", "obrigatorio": True}]}},
        {"id": "renda", "tipo": "renda", "titulo": "Conferindo seus ganhos", "config": {"meses": 3}},
        {"id": "oferta", "tipo": "oferta", "titulo": "Seu limite",
         "config": {"produto_credito_id": "cartao_garantido_moto"}},
        {"id": "aceite", "tipo": "assinatura", "titulo": "Contrato do cartão",
         "config": {"documento": "contrato_cartao"}},
        {"id": "emitir", "tipo": "provisionar", "titulo": "Emitindo o cartão",
         "config": {"acoes": ["emitir_cartao"], "modalidade": "garantido"}},
    ]},
    {"id": "jornada_credito_pessoal", "nome": "Crédito pessoal", "modulo_id": None,
     "produto_credito_id": "credito_pessoal", "passos": [
        {"id": "renda", "tipo": "renda", "titulo": "Analisando seus ganhos", "config": {"meses": 3}},
        {"id": "valor", "tipo": "formulario", "titulo": "Quanto você precisa?",
         "config": {"campos": [{"chave": "solicitado", "titulo": "Valor", "tipo": "moeda",
                                "obrigatorio": True}]}},
        {"id": "oferta", "tipo": "oferta", "titulo": "Sua oferta",
         "config": {"produto_credito_id": "credito_pessoal"}},
        {"id": "ccb", "tipo": "assinatura", "titulo": "Assinatura", "config": {"documento": "ccb"}},
    ]},
    {"id": "jornada_seguro", "nome": "Contratar seguro de vida e acidentes",
     "modulo_id": "seguro", "passos": [
        {"id": "dados", "tipo": "formulario", "titulo": "Seus dados", "config": {"campos": [
            {"chave": "nome", "titulo": "Nome completo", "tipo": "texto", "obrigatorio": True},
            {"chave": "nascimento", "titulo": "Data de nascimento", "tipo": "data", "obrigatorio": True}]}},
        {"id": "aceite", "tipo": "consentimento", "titulo": "Condições gerais",
         "config": {"texto": "Li as condições gerais e o resumo de coberturas.", "versao": "v1"}},
        {"id": "emitir", "tipo": "provisionar", "titulo": "Emitindo a apólice",
         "config": {"acoes": ["emitir_seguro"], "produto": "vida_ap"}},
    ]},
    {"id": "jornada_saude", "nome": "Aderir ao plano de saúde", "modulo_id": "saude", "passos": [
        {"id": "dados", "tipo": "formulario", "titulo": "Seus dados", "config": {"campos": [
            {"chave": "nome", "titulo": "Nome completo", "tipo": "texto", "obrigatorio": True},
            {"chave": "nascimento", "titulo": "Data de nascimento", "tipo": "data", "obrigatorio": True}]}},
        {"id": "mei", "tipo": "mensagem", "titulo": "Plano empresarial pela MEI",
         "condicao": "cnpj_mei", "config": {
             "texto": "Com a MEI ativa há 6 meses você entra no coletivo empresarial, mais barato."}},
        {"id": "aderir", "tipo": "provisionar", "titulo": "Finalizando a adesão",
         "config": {"acoes": ["aderir_saude"]}},
    ]},
]


def semear(forcar: bool = False) -> dict:
    from .catalogo import catalogo
    from .jornadas import RepositorioJornadas

    repo = RepositorioJornadas()
    feito = {"conexoes": 0, "produtos_credito": 0, "apps_entrega": 0, "jornadas": 0}

    existentes = {c.id for c in catalogo.conexoes()}
    for c in CONEXOES:
        if forcar or c["id"] not in existentes:
            catalogo.salvar_conexao(c, quem="seed")
            feito["conexoes"] += 1

    existentes = {p.id for p in catalogo.produtos_credito()}
    for p in PRODUTOS_CREDITO:
        if forcar or p["id"] not in existentes:
            catalogo.salvar_produto_credito(p, quem="seed")
            feito["produtos_credito"] += 1

    existentes = {a.id for a in catalogo.apps_entrega()}
    for a in APPS_ENTREGA:
        if forcar or a["id"] not in existentes:
            catalogo.salvar_app_entrega(a, quem="seed")
            feito["apps_entrega"] += 1

    existentes = {j.id for j in repo.todas()}
    for j in JORNADAS:
        if forcar or j["id"] not in existentes:
            repo.salvar(j, quem="seed")
            feito["jornadas"] += 1

    return feito


if __name__ == "__main__":
    print(semear("--forcar" in sys.argv))
