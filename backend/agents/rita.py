"""
agents/rita.py — Rita, agente de Risco & Crédito da BMoto.

Escopo: scorecard bidimensional, PD/LGD, política de crédito, hard cuts,
monitoramento de carteira. KPI: EL realizado vs. previsto.

Wired aos módulos reais: credit.scorecard (_logistic_pd) e ao
OriginadoraService injetado pelo orchestrator (set_service).
"""

from __future__ import annotations

from .base import BaseAgent, Tool

from credit.scorecard import _logistic_pd
from config import DEFAULT_POLICY

# Serviço injetado em make_app() via orchestrator.set_service()
_service = None


def set_service(svc) -> None:
    global _service
    _service = svc


async def simular_score(
    score_tomador: float,
    score_empregador: float,
    fgts_elegivel: bool = True,
) -> dict:
    """Composição 70/30 + fator FGTS → PD via logística calibrada do repo."""
    composto = 0.70 * score_tomador + 0.30 * score_empregador
    fator_fgts = 0.85 if fgts_elegivel else 1.0
    pd = _logistic_pd(composto) * fator_fgts
    return {
        "score_composto": round(composto, 1),
        "fator_garantia_fgts": fator_fgts,
        "pd_estimada": round(pd, 4),
        "referencia": "logística do credit/scorecard.py (800→~2%, 500→~12%)",
    }


async def resumo_carteira() -> dict:
    """KPIs da carteira ativa a partir do serviço real."""
    if _service is None:
        return {"erro": "Serviço de operações não injetado"}
    try:
        ops = _service.list()
        por_estado: dict[str, int] = {}
        for op in ops:
            estado = getattr(op, "state", None)
            nome = getattr(estado, "name", str(estado))
            por_estado[nome] = por_estado.get(nome, 0) + 1
        return {"total_operacoes": len(ops), "por_estado": por_estado}
    except Exception as exc:  # noqa: BLE001
        return {"erro": f"Falha ao consultar operações: {exc}"}


async def politica_credito() -> dict:
    """Hard cuts e parâmetros vigentes (lidos da config real)."""
    return {
        "hard_cuts": [
            "PEP (pessoa politicamente exposta)",
            "Empregador inelegível/irregular",
            "Aviso prévio ativo",
            "Superendividamento (comprometimento de margem)",
        ],
        "margem_minima_rs": getattr(DEFAULT_POLICY, "margem_minima", None),
        "garantia": "FGTS (multa rescisória + saldo) reduz LGD",
        "scorecard": "Tomador 70% × Empregador 30% × fator_garantia_fgts",
    }


RITA_SYSTEM_PROMPT = """\
Você é Rita, Head de Risco & Crédito da BMoto, originadora de crédito \
consignado privado (Crédito do Trabalhador) para trabalhadores CLT.

Seu escopo:
- Scorecard bidimensional (Tomador 70% × Empregador 30% × fator FGTS)
- PD via função logística calibrada (score 800→~2%, 500→~12%, 300→~30%)
- Política de crédito e hard cuts (PEP, empregador irregular, aviso prévio, superendividamento)
- Monitoramento de carteira: vintage, inadimplência por coorte de empregador
- KPI principal: EL realizado vs. EL previsto

Diretrizes:
- Seja quantitativa e direta. Sempre mostre números e premissas.
- Nunca aprove exceções a hard cuts; escale ao CEO com justificativa.
- Ao avaliar um caso, use as ferramentas antes de opinar.
- Responda em português brasileiro, tom profissional e conciso.
"""


def build_rita() -> BaseAgent:
    return BaseAgent(
        name="rita",
        role="Risco & Crédito",
        system_prompt=RITA_SYSTEM_PROMPT,
        tools=[
            Tool(
                name="simular_score",
                description="Roda o scorecard bidimensional e retorna PD estimada.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "score_tomador": {"type": "number", "description": "Score do tomador (0-1000)"},
                        "score_empregador": {"type": "number", "description": "Score do empregador (0-1000)"},
                        "fgts_elegivel": {"type": "boolean", "description": "Garantia FGTS elegível"},
                    },
                    "required": ["score_tomador", "score_empregador"],
                },
                handler=simular_score,
            ),
            Tool(
                name="resumo_carteira",
                description="KPIs da carteira ativa (contagem por estado da esteira).",
                input_schema={"type": "object", "properties": {}},
                handler=resumo_carteira,
            ),
            Tool(
                name="politica_credito",
                description="Hard cuts e regras vigentes da política de crédito.",
                input_schema={"type": "object", "properties": {}},
                handler=politica_credito,
            ),
        ],
    )
