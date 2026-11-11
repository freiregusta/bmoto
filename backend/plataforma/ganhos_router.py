"""
ganhos_router.py — /me/*: o que é do entregador e é real.

Tudo aqui sai do que ele próprio lançou. Nada é inventado, e quando falta
dado a resposta diz o que falta, em vez de preencher.

    POST /me/ganhos                 lança um período (bruto, corridas, km, horas)
    GET  /me/ganhos                 o que já foi lançado
    DELETE /me/ganhos/{app}/{comp}  corrige removendo
    GET  /me/custos  · PUT /me/custos
    GET  /me/resumo                 renda, custos e margem líquida real
    POST /me/simular/{produto_id}   simulação de crédito sobre a renda real
    POST /me/interesse              lista de espera de produto indisponível
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from persistencia import JsonStore

from .catalogo import catalogo
from .ganhos import RepositorioGanhos, limite_mei

router = APIRouter(prefix="/me", tags=["entregador"])
repo = RepositorioGanhos()
_interesse = JsonStore("plat_interesse")


class LancamentoIn(BaseModel):
    cpf: str
    app: str = "outros"
    competencia: str
    bruto: float
    corridas: int = 0
    km: float = 0.0
    horas: float = 0.0
    origem: str = "declarado"
    observacao: str = ""


class CustosIn(BaseModel):
    consumo_km_l: Optional[float] = None
    preco_combustivel: Optional[float] = None
    custo_oleo: Optional[float] = None
    km_troca_oleo: Optional[float] = None
    custo_pneus: Optional[float] = None
    km_pneus: Optional[float] = None
    custo_revisao: Optional[float] = None
    km_revisao: Optional[float] = None
    valor_moto: Optional[float] = None
    vida_util_km: Optional[float] = None
    das_mei: Optional[float] = None
    parcela_moto: Optional[float] = None
    seguro: Optional[float] = None
    outros_fixos: Optional[float] = None


class SimulacaoIn(BaseModel):
    cpf: str
    solicitado: Optional[float] = None
    parcelas: Optional[int] = None
    valor_garantia: float = 0.0
    tem_mei: bool = False


class InteresseIn(BaseModel):
    cpf: str
    produto: str
    celular: str = ""
    observacao: str = ""


@router.post("/ganhos")
def lancar(body: LancamentoIn):
    try:
        return asdict(repo.lancar(body.model_dump()))
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.get("/ganhos")
def listar(cpf: str, meses: Optional[int] = None):
    return {"lancamentos": [asdict(l) for l in repo.lancamentos(cpf, meses)]}


@router.delete("/ganhos/{app}/{competencia}")
def remover(app: str, competencia: str, cpf: str):
    if not repo.remover(cpf, app, competencia):
        raise HTTPException(404, "lançamento não encontrado")
    return {"removido": f"{app}:{competencia}"}


@router.get("/custos")
def obter_custos(cpf: str):
    c = repo.custos(cpf)
    return {**asdict(c), "informados": c.informados(),
            "custo_por_km": c.custo_por_km() if c.informados() else None}


@router.put("/custos")
def salvar_custos(cpf: str, body: CustosIn):
    c = repo.salvar_custos(cpf, body.model_dump(exclude_none=True))
    return {**asdict(c), "informados": c.informados(),
            "custo_por_km": c.custo_por_km() if c.informados() else None}


@router.get("/resumo")
def resumo(cpf: str, meses: int = 3):
    r = repo.resumo(cpf, meses)
    r["limite_mei_ano"] = limite_mei()
    return r


@router.post("/simular/{produto_id}")
def simular(produto_id: str, body: SimulacaoIn):
    """Simulação — não é oferta. A política é real; o que falta para virar
    proposta é bureau de crédito e emissor contratado."""
    try:
        produto = catalogo.produto_credito(produto_id)
    except KeyError as e:
        raise HTTPException(404, str(e))

    renda = repo.renda_para_credito(body.cpf, max(produto.meses_renda_comprovada, 3))
    if renda["meses_renda"] == 0:
        raise HTTPException(422, {
            "erro": "sem_renda_lancada",
            "mensagem": "Lance seus ganhos para simular. Sem renda informada não há"
                        " como calcular o que cabe no seu bolso.",
        })

    # Não há bureau contratado, então o score não é avaliado — e sim
    # NEUTRALIZADO: a conta roda sobre o que é real (renda, prazo, garantia) e
    # a análise de crédito fica listada como pendência. Zerar o score faria a
    # simulação recusar por um dado que ninguém mediu.
    resultado = produto.avaliar(
        score=produto.score_minimo,
        renda_media=renda["renda_media"],
        idade=30,
        tem_mei=body.tem_mei,
        kyc_ok=True,
        meses_renda=renda["meses_renda"],
        valor_garantia=body.valor_garantia,
        solicitado=body.solicitado,
        parcelas=body.parcelas,
    )
    resultado["cabe_no_bolso"] = resultado["aprovado"]
    resultado["aprovado"] = False          # simulação nunca aprova
    resultado["simulacao"] = True
    resultado["score_avaliado"] = False
    resultado["renda_considerada"] = renda
    resultado["pendencias_para_virar_oferta"] = [
        "análise de crédito (bureau contratado)",
        "emissor/SCD para emitir o contrato",
        "verificação de identidade (KYC)",
    ]
    return resultado


@router.post("/interesse")
def interesse(body: InteresseIn):
    """Produto indisponível não vira promessa: vira lista de espera de verdade."""
    chave = f"{body.cpf}:{body.produto}"
    doc = {**body.model_dump(), "em": __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc).isoformat()}
    _interesse.put(chave, doc)
    return {"registrado": True, "produto": body.produto,
            "total_na_fila": sum(1 for k in _interesse.all() if k.endswith(f":{body.produto}"))}


@router.get("/interesse")
def listar_interesse(produto: Optional[str] = None):
    itens = [d for k, d in _interesse.all().items()
             if not produto or k.endswith(f":{produto}")]
    return {"total": len(itens), "itens": itens}
