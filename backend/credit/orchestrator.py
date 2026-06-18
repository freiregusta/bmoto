"""
credit/orchestrator.py — Orquestrador de bureaus.

Responsabilidades:
  1. Chamar todos os bureaus ATIVOS em paralelo (asyncio.gather).
  2. Aplicar timeout individual por bureau.
  3. Degradação graciosa: bureau opcional indisponível → segue sem ele;
     bureau obrigatório indisponível → lança BureauObrigatorioIndisponivel.
  4. Montar o ScorePackage com tudo que chegou.
"""
from __future__ import annotations
import asyncio
import logging
from typing import Optional

from credit.models import (
    DadosDataprev, DadosSerasa, DadosSCR, DadosEmpregadorBureau, ScorePackage,
)
from credit.config import (
    USE_MOCK, BUREAUS_ATIVOS, BUREAUS_OBRIGATORIOS, BUREAU_TIMEOUT_S,
    MOCK_LATENCIA_S, MOCK_PROB_TIMEOUT,
)

logger = logging.getLogger(__name__)


class BureauObrigatorioIndisponivel(Exception):
    pass


def _build_adapters():
    """Instancia os adapters conforme USE_MOCK e BUREAUS_ATIVOS."""
    if USE_MOCK:
        from credit.adapters.mock import (
            MockDataprevAdapter, MockSerasaAdapter,
            MockSCRAdapter, MockEmpregadorAdapter,
        )
        return {
            "dataprev":  MockDataprevAdapter(MOCK_LATENCIA_S, MOCK_PROB_TIMEOUT),
            "scr":       MockSCRAdapter(MOCK_LATENCIA_S, MOCK_PROB_TIMEOUT),
            "serasa_pf": MockSerasaAdapter(MOCK_LATENCIA_S, MOCK_PROB_TIMEOUT),
            "empregador":MockEmpregadorAdapter(MOCK_LATENCIA_S, MOCK_PROB_TIMEOUT),
        }
    else:
        from credit.adapters.real import (
            DataprevBaaSAdapter, SerasaAdapter, SCRAdapter, EmpregadorAdapter,
        )
        return {
            "dataprev":  DataprevBaaSAdapter(),
            "scr":       SCRAdapter(),
            "serasa_pf": SerasaAdapter(),
            "empregador":EmpregadorAdapter(),
        }


async def _call_with_timeout(adapter, cpf: str, timeout: float, **kwargs):
    """Chama o adapter com timeout. Retorna (nome, resultado|None)."""
    try:
        resultado = await asyncio.wait_for(
            adapter.consultar_com_fallback(cpf, **kwargs),
            timeout=timeout,
        )
        return adapter.nome, resultado
    except asyncio.TimeoutError:
        logger.warning("[%s] Timeout após %.1fs", adapter.nome, timeout)
        if adapter.nome.split("_")[0] in BUREAUS_OBRIGATORIOS:
            raise BureauObrigatorioIndisponivel(
                f"Bureau obrigatório {adapter.nome} não respondeu em {timeout}s"
            )
        return adapter.nome, None
    except BureauObrigatorioIndisponivel:
        raise
    except Exception as e:
        logger.error("[%s] Erro inesperado: %s", adapter.nome, e)
        return adapter.nome, None


async def consultar_bureaus(cpf: str, cnpj: str = "") -> ScorePackage:
    """
    Ponto de entrada do orquestrador.
    Chama todos os bureaus ativos em paralelo e monta o ScorePackage.
    """
    adapters = _build_adapters()
    ativos = {k: v for k, v in adapters.items() if k in BUREAUS_ATIVOS}

    kwargs_por_bureau = {
        "empregador": {"cnpj": cnpj},
    }

    tarefas = [
        (nome, _call_with_timeout(adapter, cpf, BUREAU_TIMEOUT_S,
                           **kwargs_por_bureau.get(nome, {})))
        for nome, adapter in ativos.items()
    ]

    resultados = await asyncio.gather(
        *[t for _, t in tarefas], return_exceptions=True
    )

    # Separa resultados por chave do dict (não pelo adapter.nome)
    dados: dict = {}
    indisponiveis: list[str] = []
    for (chave, _), r in zip(tarefas, resultados):
        if isinstance(r, BureauObrigatorioIndisponivel):
            raise r
        if isinstance(r, Exception):
            logger.error("Erro inesperado no gather [%s]: %s", chave, r)
            indisponiveis.append(chave)
            continue
        _, valor = r   # r = (adapter.nome, resultado)
        if valor is None:
            indisponiveis.append(chave)
        else:
            dados[chave] = valor

    dataprev: Optional[DadosDataprev] = dados.get("dataprev")
    scr: Optional[DadosSCR] = dados.get("scr")
    serasa: Optional[DadosSerasa] = dados.get("serasa_pf")
    empregador: Optional[DadosEmpregadorBureau] = dados.get("empregador")

    # Flags de corte duro (preenchidas antes do scorecard)
    pep = bool(dataprev and dataprev.pep)
    inelegivel = bool(dataprev and not dataprev.elegivel)
    superendividado = bool(dataprev and dataprev.quantidade_emprestimos_ativos > 0
                           and dataprev.valor_margem_disponivel <= 0)
    aviso_previo = bool(dataprev and
                        dataprev.situacao.value == "AVISO_PREVIO")
    emp_irregular = bool(empregador and
                         empregador.situacao_receita not in ("ATIVA",))

    return ScorePackage(
        cpf=cpf,
        dataprev=dataprev,
        serasa=serasa,
        scr=scr,
        empregador=empregador,
        pep=pep,
        inelegivel=inelegivel,
        superendividado=superendividado,
        aviso_previo=aviso_previo,
        empregador_irregular=emp_irregular,
        bureaus_indisponiveis=indisponiveis,
    )
