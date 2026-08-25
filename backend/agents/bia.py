"""
agents/bia.py — Bia, agente de Operações & Cobrança da BMoto.

Escopo: conciliação de repasses (eSocial/FGTS Digital), régua de cobrança
com destinatário correto (empregador vs. trabalhador vs. garantia FGTS),
aging da carteira. KPI: inadimplência operacional < 3% (vs. 8,6% do setor)
e zero quebras de conciliação.

Racional estratégico: ~65% da inadimplência do setor é falha operacional
do lado do empregador/plataformas — não do trabalhador. A Bia existe para
capturar essa vantagem.
"""

from __future__ import annotations

from .base import BaseAgent, Tool

from repasse_monitor import MONITOR, CausaProvavel


async def aging_repasses() -> dict:
    """Aging executivo: atraso por causa e por empregador."""
    MONITOR.marcar_atrasos()
    return MONITOR.aging()


async def plano_cobranca() -> dict:
    """Régua de cobrança com destinatário e base legal por parcela atrasada."""
    MONITOR.marcar_atrasos()
    acoes = MONITOR.acoes_cobranca()
    return {"total_acoes": len(acoes), "acoes": acoes}


async def score_repasse_empregador(cnpj: str) -> dict:
    """Histórico de pontualidade de repasse do CNPJ (insumo p/ Score Empregador)."""
    return MONITOR.score_repasse_empregador(cnpj)


async def classificar_atraso(proposal_id: str, competencia: str, causa: str) -> dict:
    """Classifica a causa de um atraso (taxonomia Serasa/Salaryfits)."""
    try:
        MONITOR.classificar(proposal_id, competencia, CausaProvavel(causa))
        return {"ok": True, "proposal_id": proposal_id, "causa": causa}
    except (KeyError, ValueError) as exc:
        return {"erro": str(exc), "causas_validas": [c.value for c in CausaProvavel]}


BIA_SYSTEM_PROMPT = """\
Você é Bia, Head de Operações & Cobrança da BMoto, originadora de crédito \
consignado privado (Crédito do Trabalhador).

Contexto estratégico que você domina:
- ~65% da inadimplência do setor é falha OPERACIONAL: atraso RH↔IF (~30%), \
falha de integração eSocial/Dataprev (~22%), problema no desconto em folha (~13%). \
Só ~33% é incapacidade de pagamento do trabalhador.
- Inadimplência média do setor: ~8,6%. Sua meta: < 3% via excelência operacional.
- Base legal contra empregador inadimplente no repasse: Portaria MTE 435/2025 \
(art. 28 §3º: regularização com juros/encargos; art. 24: competência pela data \
de averbação, janela 21→20) e Lei 15.179/2025 art. 3º (multa de 30% do valor \
retido + Termo de Débito Salarial, título executivo extrajudicial).
- Fluxo do repasse: rubrica 9253 no eSocial → guia FGTS Digital/DAE → repasse à IF.

Diretrizes:
- SEMPRE identifique a causa antes de cobrar: cobrança ao trabalhador por falha \
do empregador é erro grave (reputacional e regulatório).
- Escale ao CEO empregadores reincidentes (pontualidade < 80%) para bloqueio \
de novas originações naquele CNPJ.
- Use as ferramentas antes de opinar. Responda em português, direta e organizada.
"""


def build_bia() -> BaseAgent:
    return BaseAgent(
        name="bia",
        role="Operações & Cobrança",
        system_prompt=BIA_SYSTEM_PROMPT,
        tools=[
            Tool(
                name="aging_repasses",
                description="Aging da carteira: atrasos por causa e por empregador.",
                input_schema={"type": "object", "properties": {}},
                handler=aging_repasses,
            ),
            Tool(
                name="plano_cobranca",
                description="Régua de cobrança com destinatário correto e base legal.",
                input_schema={"type": "object", "properties": {}},
                handler=plano_cobranca,
            ),
            Tool(
                name="score_repasse_empregador",
                description="Pontualidade de repasse de um CNPJ (insumo do Score Empregador).",
                input_schema={
                    "type": "object",
                    "properties": {"cnpj": {"type": "string"}},
                    "required": ["cnpj"],
                },
                handler=score_repasse_empregador,
            ),
            Tool(
                name="classificar_atraso",
                description="Classifica a causa de um atraso de repasse.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "proposal_id": {"type": "string"},
                        "competencia": {"type": "string", "description": "YYYY-MM"},
                        "causa": {"type": "string", "description": "ver causas_validas no retorno em caso de erro"},
                    },
                    "required": ["proposal_id", "competencia", "causa"],
                },
                handler=classificar_atraso,
            ),
        ],
    )
