"""
jornada_router.py — /jornadas/*: o app roda a jornada que o admin montou.

O cliente nunca "sabe" o produto: pede a jornada do módulo, recebe o passo
atual (com os campos a exibir) e devolve a resposta. Quando o passo é
automático (kyc, renda, oferta, provisionar) o app só chama /avancar sem
corpo e mostra o resultado.

    GET  /jornadas/modulo/{modulo_id}      qual jornada vale para esse módulo
    POST /jornadas/{jornada_id}/iniciar    {cpf, contexto} -> execução
    GET  /jornadas/execucao/{id}           estado atual
    POST /jornadas/execucao/{id}/avancar   {resposta} -> novo estado
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .admin_router import motor, repo_jornadas

router = APIRouter(prefix="/jornadas", tags=["jornadas"])


class IniciarIn(BaseModel):
    cpf: str
    contexto: dict = {}


class AvancarIn(BaseModel):
    resposta: dict = {}


@router.get("/modulo/{modulo_id}")
def jornada_do_modulo(modulo_id: str):
    j = repo_jornadas.por_modulo(modulo_id)
    if not j:
        raise HTTPException(404, f"nenhuma jornada ativa para o módulo '{modulo_id}'")
    return j.to_dict()


@router.post("/{jornada_id}/iniciar")
def iniciar(jornada_id: str, body: IniciarIn):
    try:
        e = motor.iniciar(jornada_id, body.cpf, body.contexto)
    except KeyError as err:
        raise HTTPException(404, str(err))
    except ValueError as err:
        raise HTTPException(422, str(err))
    return motor.estado(e.id)


@router.get("/execucao/{execucao_id}")
def estado(execucao_id: str):
    try:
        return motor.estado(execucao_id)
    except KeyError as err:
        raise HTTPException(404, str(err))


@router.post("/execucao/{execucao_id}/avancar")
async def avancar(execucao_id: str, body: Optional[AvancarIn] = None):
    try:
        return await motor.avancar(execucao_id, (body.resposta if body else {}))
    except KeyError as err:
        raise HTTPException(404, str(err))
    except ValueError as err:
        raise HTTPException(422, str(err))
