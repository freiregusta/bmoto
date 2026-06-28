"""
bureau_pricing.py — Ponte do PD rico (scorecard de bureaus) para o pricing.

Roda o pipeline do módulo credit/ (consulta de bureaus + scorecard de duas
dimensões: Tomador 70% + Empregador 30% x fator FGTS) e devolve o PD para
alimentar a perda esperada do pricing risk-based.

Degradação graciosa: qualquer falha (bureau indisponível, timeout, erro)
retorna None, e o chamador mantém o PD do scorecard simples. Assim, ligar os
bureaus nunca derruba a originação.

Liga/desliga por env: USE_BUREAU_PRICING=0 desativa.
"""

from __future__ import annotations

import os
import asyncio
import logging
from typing import Optional

logger = logging.getLogger("bureau_pricing")


def habilitado() -> bool:
    return os.environ.get("USE_BUREAU_PRICING", "1") == "1"


def pd_por_cpf(cpf: str, cnpj: str = "",
               valor_solicitado: float = 5000.0) -> Optional[float]:
    """PD (0..1) do scorecard de bureaus, ou None se indisponível."""
    if not habilitado():
        return None
    try:
        from credit.orchestrator import consultar_bureaus
        from credit.scorecard import calcular_scores
        pkg = asyncio.run(consultar_bureaus(cpf, cnpj))
        res = calcular_scores(pkg, valor_solicitado)
        return res.pd
    except Exception as e:  # noqa: BLE001 — fallback gracioso para o PD simples
        logger.warning("PD de bureaus indisponível, usando PD simples. Erro: %s", e)
        return None
