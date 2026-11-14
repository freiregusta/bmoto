"""
teste_paridade.py — roda os MESMOS cenários no código Python original.

O backend Python é a referência: ele tem 79 testes passando e foi conferido
contra extrato de verdade. Este script imprime o JSON dos mesmos casos que
`teste.ts` imprime, para o diff mostrar qualquer divergência de centavo entre
as duas implementações.

    PERSIST_DB=/tmp/paridade.db python3 teste_paridade.py > /tmp/py.json
"""

import json
import os
import sys

sys.path.insert(0, "/home/claude/bmoto/backend")
os.environ.setdefault("PERSIST_DB", "/tmp/paridade.db")

# Zera o banco ANTES dos imports: o catálogo abre a conexão ao ser importado, e
# apagar o arquivo depois disso deixa o handle apontando para um inode morto.
if os.path.exists(os.environ["PERSIST_DB"]):
    os.remove(os.environ["PERSIST_DB"])

from plataforma.catalogo import ProdutoCredito                    # noqa: E402
from plataforma.ganhos import RepositorioGanhos                     # noqa: E402
from plataforma.openfinance import (                                # noqa: E402
    RegraApp, Transacao, classificar, ler_csv, para_lancamentos, raiz_cnpj,
)

REGRAS = [
    RegraApp(slug="ifood", nome="iFood", cnpjs=("14380200000121",),
             identificadores=("IFOOD",)),
    RegraApp(slug="99", nome="99Food", identificadores=("99 TECNOLOGIA", "99FOOD")),
    RegraApp(slug="rappi", nome="Rappi", identificadores=("RAPPI",)),
]

CPF = "70011122233"

CSV_PTBR = (
    "Data;Valor;Histórico;Pagador\n"
    "05/11/2026;1.234,56;Pix recebido;IFOOD COM AGENCIA\n"
    "06/11/2026;-80,00;Compra no posto;Posto Ipiranga\n"
    "10/11/2026;320,00;Pix recebido;99 TECNOLOGIA LTDA\n"
)

CSV_EXEMPLO = (
    "Data;Valor;Histórico;Pagador\n"
    "05/09/2026;900,00;Pix recebido;IFOOD COM AGENCIA DE RESTAURANTES\n"
    "19/09/2026;850,00;Pix recebido;IFOOD COM AGENCIA DE RESTAURANTES\n"
    "03/10/2026;1.100,00;Pix recebido;IFOOD COM AGENCIA DE RESTAURANTES\n"
    "10/10/2026;400,00;Pix recebido;99 TECNOLOGIA LTDA\n"
    "12/10/2026;-250,00;Combustível;Posto Shell\n"
    "15/10/2026;500,00;Pix recebido;Jose da Silva\n"
)

CSV_QUEBRADO = ("Data;Valor;Pagador\n05/11/2026;300,00;IFOOD\nlixo;;;\n06/11/2026;;IFOOD\n"
                "07/11/2026;200,00;IFOOD\n")

CUSTOS = {
    "consumo_km_l": 32, "preco_combustivel": 6.19,
    "custo_oleo": 90, "km_troca_oleo": 3000,
    "custo_pneus": 520, "km_pneus": 12000,
    "custo_revisao": 280, "km_revisao": 6000,
    "valor_moto": 18_900, "vida_util_km": 90_000,
    "das_mei": 86.05, "parcela_moto": 0, "seguro": 110, "outros_fixos": 40,
}

LANCAMENTOS = [
    {"app": "ifood", "competencia": "2026-09", "bruto": 2350.4, "corridas": 212,
     "km": 1480.5, "horas": 168},
    {"app": "99", "competencia": "2026-09", "bruto": 610.0, "corridas": 54,
     "km": 390.2, "horas": 42},
    {"app": "ifood", "competencia": "2026-10", "bruto": 2890.9, "corridas": 248,
     "km": 1712.8, "horas": 186.5},
    {"app": "rappi", "competencia": "2026-08", "bruto": 1180.0, "corridas": 97,
     "km": 740.0, "horas": 88},
]

PRODUTO = ProdutoCredito(
    id="credito_pessoal", nome="Crédito pessoal", tipo="pessoal",
    taxa_mensal=0.0219, prazo_min=6, prazo_max=24, ticket_min=500, ticket_max=8000,
    garantia_tipo=None, ltv_max=0, score_minimo=500, renda_minima=1200,
    comprometimento_max=0.2, idade_min=18, idade_max=70, exige_mei=False,
    exige_kyc=True, meses_renda_comprovada=3, tac=60,
)

PRODUTO_MOTO = ProdutoCredito(
    id="financiamento_moto", nome="Financiamento de moto", tipo="veiculo",
    taxa_mensal=0.0189, prazo_min=12, prazo_max=48, ticket_min=3000, ticket_max=25_000,
    garantia_tipo="moto", ltv_max=0.8, score_minimo=550, renda_minima=1500,
    comprometimento_max=0.25, idade_min=21, idade_max=65, exige_mei=False,
    exige_kyc=True, meses_renda_comprovada=6, tac=0,
)


def t(valor, nome="", doc="", data="2026-11-05", descricao=""):
    return Transacao(id="x", data=data, valor=valor, descricao=descricao,
                     pagador_nome=nome, pagador_documento=doc)


def c_json(c):
    """A classificação no mesmo formato que o TS imprime."""
    return {
        "por_app": {s: {"slug": s, "nome": a.nome, "total": a.total,
                        "lancamentos": a.lancamentos, "competencias": a.competencias}
                    for s, a in c.por_app.items()},
        "por_competencia": c.renda_mensal(),
        "nao_identificados": [
            {"id": x.id, "data": x.data, "valor": x.valor, "descricao": x.descricao,
             "pagador_nome": x.pagador_nome, "pagador_documento": x.pagador_documento}
            for x in c.nao_identificados],
        "total_identificado": c.total_identificado,
        "total_creditos": c.total_creditos,
        "cobertura": c.cobertura,
    }


def sem_score(produto, renda, meses, **extra):
    r = produto.avaliar(score=produto.score_minimo, renda_media=renda, idade=30,
                        kyc_ok=True, meses_renda=meses, **extra)
    r["cabe_no_bolso"] = r["aprovado"]
    r["aprovado"] = False
    return r


def main():
    repo = RepositorioGanhos(prefixo="paridade")
    for l in LANCAMENTOS:
        repo.lancar({**l, "cpf": CPF})
    repo.salvar_custos(CPF, CUSTOS)

    # Um CPF separado para o cenário sem custos informados.
    cpf_sc = "70044455566"
    repo_sc = RepositorioGanhos(prefixo="paridade_sc")
    for l in LANCAMENTOS:
        repo_sc.lancar({**l, "cpf": cpf_sc})

    custos = repo.custos(CPF)
    renda3 = repo.renda_para_credito(CPF, 3)

    ptbr = ler_csv(CSV_PTBR)
    exemplo = classificar(ler_csv(CSV_EXEMPLO), REGRAS)
    enus = ler_csv("date,amount,description,counterparty\n2026-11-05,1234.56,Transfer,IFOOD\n")[0]

    saida = {
        "classificacao": {
            "filial_por_cnpj": classificar([t(480, doc="14.380.200/0456-30")],
                                           REGRAS).por_app["ifood"].total,
            "acento_e_caixa": c_json(classificar(
                [t(300, "iFood.com Agência de Restaurantes"),
                 t(120, descricao="PIX RECEBIDO 99 tecnologia ltda")], REGRAS)),
            "pix_de_terceiro": c_json(classificar(
                [t(200, "Maria Souza"), t(450, "IFOOD")], REGRAS)),
            "debito_nao_vira_renda": c_json(classificar(
                [t(-900, "IFOOD"), t(500, "IFOOD")], REGRAS)),
            "agrupamento": c_json(classificar([
                t(300, "IFOOD", data="2026-09-10"), t(200, "IFOOD", data="2026-09-24"),
                t(400, "IFOOD", data="2026-10-08"), t(150, "RAPPI", data="2026-10-09"),
            ], REGRAS)),
            "raiz_cnpj": [raiz_cnpj("14.380.200/0001-21"), raiz_cnpj("")],
        },
        "csv": {
            "ptbr_valores": [x.valor for x in ptbr],
            "ptbr_primeira_data": ptbr[0].data,
            "ptbr_classificado": c_json(classificar(ptbr, REGRAS)),
            "enus": {"id": enus.id, "data": enus.data, "valor": enus.valor,
                     "descricao": enus.descricao, "pagador_nome": enus.pagador_nome,
                     "pagador_documento": enus.pagador_documento},
            "quebrado_valores": [x.valor for x in ler_csv(CSV_QUEBRADO)],
            "exemplo_classificado": c_json(exemplo),
            # No Python a ordem entre apps do mesmo mês segue a ordem em que
            # apareceram no extrato; no TS ela é alfabética de propósito. Ordem
            # não faz parte do contrato (a gravação é upsert por app+mês), então
            # a comparação ordena os dois lados igual.
            "exemplo_lancamentos": sorted(
                sorted(({"app": x["app"], "competencia": x["competencia"],
                         "bruto": x["bruto"], "origem": "extrato"}
                        for x in para_lancamentos(exemplo, CPF, origem="extrato")),
                       key=lambda x: x["app"]),
                key=lambda x: x["competencia"], reverse=True),
        },
        "margem": {
            "custo_por_km": custos.custo_por_km(),
            "fixo_mensal": custos.fixo_mensal(),
            "resumo_3_meses": repo.resumo(CPF, 3),
            "resumo_sem_custos": repo_sc.resumo(cpf_sc, 3),
            "resumo_vazio": repo.resumo("52998224725", 3),
            "renda_para_credito_3": renda3,
            "renda_para_credito_sem_custos": repo_sc.renda_para_credito(cpf_sc, 3),
        },
        "credito": {
            "parcela_5000_12": PRODUTO.parcela(5000, 12),
            "cet_5000_12": PRODUTO.cet_anual(5000, 12),
            "limite_por_renda": PRODUTO.limite_por_renda(renda3["renda_media"], 12),
            "simulacao_pessoal_12": sem_score(PRODUTO, renda3["renda_media"],
                                              renda3["meses_renda"], parcelas=12),
            "simulacao_moto_sem_garantia": sem_score(PRODUTO_MOTO, renda3["renda_media"],
                                                     renda3["meses_renda"], parcelas=48),
            "simulacao_moto_com_garantia": sem_score(PRODUTO_MOTO, renda3["renda_media"], 6,
                                                     parcelas=48, valor_garantia=16_000),
            "renda_baixa_recusa": sem_score(PRODUTO, 900, 3, parcelas=12),
        },
    }
    print(json.dumps(saida, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
