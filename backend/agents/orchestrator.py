"""
agents/orchestrator.py — Orquestrador ("CEO") da equipe de agentes BMoto.

Roteia perguntas para o agente adequado (Rita = risco, Pedro = pricing).

Endpoints:
    GET  /agents                → lista a equipe
    POST /agents/ask            → roteamento automático
    POST /agents/{nome}/ask     → agente específico

Montagem (feita em api.make_app):
    from agents.orchestrator import router as agents_router, set_service
    set_service(svc)
    app.include_router(agents_router)
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .base import BaseAgent
from .bia import build_bia
from .pedro import build_pedro
from .rita import build_rita
from . import rita as rita_mod

_TEAM: dict[str, BaseAgent] = {}


def set_service(svc) -> None:
    """Injeta o OriginadoraService real nos agentes que precisam dele."""
    rita_mod.set_service(svc)


def get_team() -> dict[str, BaseAgent]:
    if not _TEAM:
        _TEAM["rita"] = build_rita()
        _TEAM["pedro"] = build_pedro()
        _TEAM["bia"] = build_bia()
    return _TEAM


# Roteamento por palavra-chave (barato e determinístico; ambíguo → todos)
_KEYWORDS = {
    "rita": [
        "risco", "score", "scorecard", "pd", "lgd", "inadimpl", "hard cut",
        "política de crédito", "pep", "aviso prévio", "carteira", "vintage",
        "empregador", "aprovar", "recusar",
    ],
    "bia": [
        "repasse", "cobrança", "cobranca", "conciliação", "conciliacao",
        "aging", "atraso", "esocial", "fgts digital", "rubrica", "averbação",
        "averbacao", "desconto em folha", "operações", "operacoes",
    ],
    "pedro": [
        "preço", "pricing", "taxa", "cet", "spread", "roe", "funding",
        "cessão", "fidc", "margem", "tesouraria", "parcela", "juros",
    ],
}


def route(question: str) -> list[str]:
    q = question.lower()
    hits = [name for name, kws in _KEYWORDS.items() if any(k in q for k in kws)]
    return hits or list(get_team().keys())


router = APIRouter(prefix="/agents", tags=["agents"])


class AskRequest(BaseModel):
    question: str
    context: dict | None = None


@router.get("")
async def listar_equipe() -> list[dict]:
    return [
        {"name": a.name, "role": a.role, "tools": [t.name for t in a.tools]}
        for a in get_team().values()
    ]


@router.post("/ask")
async def ask_auto(req: AskRequest) -> dict:
    team = get_team()
    targets = route(req.question)
    respostas = {}
    for name in targets:
        respostas[name] = await team[name].ask(req.question, req.context)
    return {"routed_to": targets, "respostas": respostas}


@router.post("/{agent_name}/ask")
async def ask_agent(agent_name: str, req: AskRequest) -> dict:
    team = get_team()
    agent = team.get(agent_name)
    if agent is None:
        raise HTTPException(404, f"Agente '{agent_name}' não existe. Equipe: {list(team)}")
    return await agent.ask(req.question, req.context)
