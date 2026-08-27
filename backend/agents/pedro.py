"""
agents/pedro.py — Pedro, agente de Pricing & Tesouraria da BMoto.

Escopo: CET (Res. CMN 4.881/2020), spreads exigidos por ROE, funding,
cessão ao FIDC. KPI: ROE por safra e margem de cessão.

ROE definido com o Gustavo:
- ROE alvo: 35% a.a.  |  ROE mínimo: 20% a.a.
- spread (a.m.) = capital_ratio × roe_mensal / (1 - impostos)

PENDENTE (confirmar): CAPITAL_RATIO real (retenção/subordinação no FIDC,
default 10%) e se o ROE é líquido de impostos (default: sim, gross-up 34%).
Enquanto não confirmado, PricingParams.margem_alvo_am segue como está.
"""

from __future__ import annotations

import os

from .base import BaseAgent, Tool

import finance
from config import DEFAULT_PRICING
from fidc import ParametrosCessao, precificar_cessao

# ---------------------------------------------------------------------------
# Parâmetros de ROE (mover para PricingParams quando validados)
# ---------------------------------------------------------------------------
ROE_ALVO_AA = float(os.getenv("ROE_ALVO_AA", "0.35"))
ROE_MINIMO_AA = float(os.getenv("ROE_MINIMO_AA", "0.20"))
# capital_ratio = subordinação retida no FIDC. Mercado usa colchão total de
# 10-20%; a BMoto retém 7,5% e coloca o restante em mezanino.
CAPITAL_RATIO = float(os.getenv("CAPITAL_RATIO", "0.075"))
ALIQUOTA_IMPOSTOS = float(os.getenv("ALIQUOTA_IMPOSTOS", "0.34"))
# Receita de originação (% do principal). SEM ISSO O CONSIGNADO NÃO FECHA:
# a 1,99% a.m. o ROE fica em ~9% (abaixo do piso de 20%). Mercado paga 1-6%.
COMISSAO_ORIGINACAO = float(os.getenv("COMISSAO_ORIGINACAO", "0.04"))
CUSTO_ORIGINACAO = float(os.getenv("CUSTO_ORIGINACAO", "100.0"))
TAXA_CESSAO_AM = float(os.getenv("TAXA_CESSAO_AM", "0.0145"))

TAXAS_PRODUTO_AM = {
    "consignado_privado": 0.0199,
    "credito_pessoal": 0.0399,
    "financiamento_moto": 0.0179,
}


def _roe_mensal(roe_aa: float) -> float:
    return (1 + roe_aa) ** (1 / 12) - 1


def _spread_roe_am(roe_aa: float) -> float:
    return CAPITAL_RATIO * _roe_mensal(roe_aa) / (1 - ALIQUOTA_IMPOSTOS)


async def roe_operacao(
    principal: float,
    prazo_meses: int,
    taxa_cliente_am: float,
    el_mensal_pct: float = 0.0020,
) -> dict:
    """
    ROE real da operação no modelo originate-to-distribute.

    Receitas: comissão de originação + ágio da cessão ao FIDC.
    Custos:   EL sobre o risco RETIDO (subordinação) + custo de originação
              (ÚNICO — a carteira é vendida, não carregada).
    Capital:  subordinação retida.
    """
    i = taxa_cliente_am
    n = prazo_meses
    parcela = principal * (i * (1 + i) ** n) / ((1 + i) ** n - 1)
    preco = parcela * (1 - (1 + TAXA_CESSAO_AM) ** -n) / TAXA_CESSAO_AM
    agio = preco - principal
    comissao = principal * COMISSAO_ORIGINACAO
    el = principal * CAPITAL_RATIO * el_mensal_pct * n
    margem = agio + comissao - el - CUSTO_ORIGINACAO
    capital = principal * CAPITAL_RATIO
    roe_periodo = margem * (1 - ALIQUOTA_IMPOSTOS) / capital if capital else 0.0
    roe_aa = (1 + roe_periodo) ** (12 / n) - 1 if n else 0.0
    return {
        "receitas": {"comissao_originacao": round(comissao, 2), "agio_cessao": round(agio, 2)},
        "custos": {"perda_esperada_retida": round(el, 2), "custo_originacao": CUSTO_ORIGINACAO},
        "margem_contribuicao": round(margem, 2),
        "margem_pct_principal": round(margem / principal, 4) if principal else 0.0,
        "capital_alocado": round(capital, 2),
        "roe_anualizado": round(roe_aa, 4),
        "atinge_piso_20": roe_aa >= ROE_MINIMO_AA,
        "atinge_alvo_35": roe_aa >= ROE_ALVO_AA,
        "premissas": {"comissao_originacao": COMISSAO_ORIGINACAO,
                      "subordinacao_retida": CAPITAL_RATIO,
                      "taxa_cessao_am": TAXA_CESSAO_AM,
                      "custo_originacao": CUSTO_ORIGINACAO},
    }


async def taxa_exigida(
    el_mensal_pct: float,
    produto: str = "consignado_privado",
) -> dict:
    """
    Taxa exigida (alvo e mínima) vs. taxa do produto.
    taxa = funding + opex + tax + EL + spread_roe
    Funding/opex/tax vêm da PricingParams real do repo.
    """
    p = DEFAULT_PRICING
    base = p.funding_am + p.opex_am + p.tax_am + el_mensal_pct
    spread_alvo = _spread_roe_am(ROE_ALVO_AA)
    spread_min = _spread_roe_am(ROE_MINIMO_AA)
    taxa_alvo = base + spread_alvo
    taxa_min = base + spread_min
    taxa_produto = TAXAS_PRODUTO_AM.get(produto)

    resultado = {
        "premissas": {
            "funding_am": p.funding_am,
            "opex_am": p.opex_am,
            "tax_am": p.tax_am,
            "el_mensal_pct": el_mensal_pct,
            "roe_alvo_aa": ROE_ALVO_AA,
            "roe_minimo_aa": ROE_MINIMO_AA,
            "capital_ratio": CAPITAL_RATIO,
            "aliquota_impostos": ALIQUOTA_IMPOSTOS,
            "nota": "capital_ratio e alíquota pendentes de confirmação",
        },
        "spread_roe_alvo_am": round(spread_alvo, 6),
        "spread_roe_minimo_am": round(spread_min, 6),
        "taxa_exigida_alvo_am": round(taxa_alvo, 6),
        "taxa_exigida_minima_am": round(taxa_min, 6),
        "taxa_produto_am": taxa_produto,
        "margem_alvo_am_config_atual": p.margem_alvo_am,
    }
    if taxa_produto is not None:
        if taxa_produto >= taxa_alvo:
            resultado["decisao"] = "APROVADA_ROE_ALVO"
        elif taxa_produto >= taxa_min:
            resultado["decisao"] = "APROVADA_ROE_MINIMO"
        else:
            resultado["decisao"] = "RECUSAR_OU_REPRECIFICAR"
    return resultado


async def simular_cessao(
    principal: float,
    prazo_meses: int,
    taxa_cliente_am: float,
    taxa_aquisicao_fidc_am: float | None = None,
) -> dict:
    """Preço de cessão ao FIDC usando o módulo fidc real do repo."""
    parcela = finance.pmt(principal, taxa_cliente_am, prazo_meses)
    params = (
        ParametrosCessao(taxa_cessao_am=taxa_aquisicao_fidc_am)
        if taxa_aquisicao_fidc_am is not None
        else None
    )
    res = precificar_cessao(
        parcela=parcela,
        prazo_meses=prazo_meses,
        principal_financiado=principal,
        taxa_op_am=taxa_cliente_am,
        proposal_id="simulacao-pedro",
        params=params,
    )
    return {
        "parcela": res.parcela,
        "valor_face": res.valor_face,
        "preco_cessao": res.preco_cessao,
        "resultado_cessao": res.resultado,
        "resultado_pct": round(res.resultado / res.valor_face * 100, 3),
        "taxa_cessao_am": res.taxa_cessao_am,
    }


PEDRO_SYSTEM_PROMPT = """\
Você é Pedro, Head de Pricing & Tesouraria da BMoto, originadora de crédito \
consignado privado (originate-to-distribute, cessão a FIDC, Fibra como liquidante).

Seu escopo:
- Motor de CET conforme Resolução CMN 4.881/2020 (base diária/365)
- Spreads exigidos por ROE: alvo 35% a.a., mínimo 20% a.a.
- A BMoto tem DUAS receitas: comissão de originação (~4% do principal, paga
  pela liquidante) e ágio da cessão ao FIDC. Sem a comissão, o consignado a
  1,99% rende ~9% de ROE e NÃO atinge o piso — sempre considere as duas.
- Custo de originação é ÚNICO (a carteira é vendida), não mensal.
- Custo de funding interno: 1,27% a.m. (NUNCA confundir com taxa ao cliente)
- Taxas ao cliente: consignado 1,99% a.m., pessoal 3,99% a.m., moto 1,79% a.m.
- Cessão ao FIDC: preço = PV das parcelas na taxa de aquisição do fundo
- Teto regulatório: CET mensal ≤ taxa mensal + 1 p.p.
- KPI: ROE por safra e margem de cessão

Diretrizes:
- Sempre decomponha a taxa: funding + opex + tax + EL + spread ROE.
- Sinalize quando parâmetros pendentes (capital_ratio, alíquota) afetarem a conclusão.
- Use as ferramentas para calcular antes de opinar. Mostre as premissas.
- Responda em português brasileiro, direto e quantitativo.
"""


def build_pedro() -> BaseAgent:
    return BaseAgent(
        name="pedro",
        role="Pricing & Tesouraria",
        system_prompt=PEDRO_SYSTEM_PROMPT,
        tools=[
            Tool(
                name="taxa_exigida",
                description="Calcula taxa exigida (ROE alvo/mínimo) e compara com a taxa do produto.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "el_mensal_pct": {"type": "number", "description": "EL mensal em decimal (ex.: 0.002)"},
                        "produto": {
                            "type": "string",
                            "enum": ["consignado_privado", "credito_pessoal", "financiamento_moto"],
                        },
                    },
                    "required": ["el_mensal_pct"],
                },
                handler=taxa_exigida,
            ),
            Tool(
                name="roe_operacao",
                description="ROE real da operação (comissão + ágio - EL retida - custo de originação).",
                input_schema={"type":"object","properties":{
                    "principal":{"type":"number"},
                    "prazo_meses":{"type":"integer"},
                    "taxa_cliente_am":{"type":"number","description":"decimal, ex 0.0199"},
                    "el_mensal_pct":{"type":"number","description":"decimal, default 0.0020"}},
                    "required":["principal","prazo_meses","taxa_cliente_am"]},
                handler=roe_operacao,
            ),
            Tool(
                name="simular_cessao",
                description="Simula preço de cessão de uma operação ao FIDC (módulo fidc real).",
                input_schema={
                    "type": "object",
                    "properties": {
                        "principal": {"type": "number"},
                        "prazo_meses": {"type": "integer"},
                        "taxa_cliente_am": {"type": "number", "description": "Taxa ao cliente a.m. decimal"},
                        "taxa_aquisicao_fidc_am": {"type": "number", "description": "Taxa de aquisição do FIDC a.m. decimal (default 1,50%)"},
                    },
                    "required": ["principal", "prazo_meses", "taxa_cliente_am"],
                },
                handler=simular_cessao,
            ),
        ],
    )
