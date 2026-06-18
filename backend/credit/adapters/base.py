"""
credit/adapters/base.py — Interface abstrata para todos os bureaus.

Cada adapter implementa `consultar()` e retorna o tipo de dados do seu bureau.
O orquestrador não sabe qual implementação está usando — só conhece essa interface.
"""
from __future__ import annotations
import abc
import logging
from typing import TypeVar, Generic, Optional, Type

logger = logging.getLogger(__name__)

T = TypeVar("T")


class BureauAdapter(abc.ABC, Generic[T]):
    """Interface base. T é o tipo de dados que o bureau retorna."""

    nome: str = "base"
    obrigatorio: bool = False   # se True, falha bloqueia a oferta

    @abc.abstractmethod
    async def consultar(self, cpf: str, **kwargs) -> T: ...

    async def consultar_com_fallback(self, cpf: str, **kwargs) -> Optional[T]:
        """Chama consultar(). Em caso de erro, loga e retorna None.
        Bureaus obrigatórios relançam a exceção."""
        try:
            return await self.consultar(cpf, **kwargs)
        except Exception as e:
            logger.warning("[%s] Erro na consulta CPF %s: %s",
                           self.nome, cpf[:3] + "***", e)
            if self.obrigatorio:
                raise
            return None
