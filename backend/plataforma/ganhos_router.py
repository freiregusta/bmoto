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

    POST /me/extrato/conferir       lê um extrato e MOSTRA o que reconheceu
    POST /me/extrato/importar       confirma e vira lançamento de ganho
    POST /me/openfinance/consentir  inicia o consentimento (quando contratado)
    POST /me/openfinance/importar   lê os repasses pelo consentimento autorizado
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


class ExtratoIn(BaseModel):
    cpf: str
    conteudo: str                       # CSV exportado do banco ou do app
    substituir: bool = False            # relançar por cima do que já existe


class ConsentimentoIn(BaseModel):
    cpf: str


class ImportarOpenFinanceIn(BaseModel):
    cpf: str
    consentimento_id: str
    meses: int = 3


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


# ------------------------------------------------------------ extrato

def _classificar_texto(conteudo: str):
    """Lê o CSV e separa o que é repasse de plataforma. Mesmo classificador
    que o Open Finance usa — a fonte muda, a conta não."""
    from .openfinance import classificar, ler_csv, regras_do_catalogo
    try:
        transacoes = ler_csv(conteudo)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if not transacoes:
        raise HTTPException(422, "não consegui ler nenhuma linha com data e valor")
    return transacoes, classificar(transacoes, regras_do_catalogo(catalogo.apps_entrega(False)))


def _resposta_classificacao(transacoes, c) -> dict:
    return {
        "linhas_lidas": len(transacoes),
        "creditos_total": c.total_creditos,
        "identificado_total": c.total_identificado,
        "cobertura": c.cobertura,
        "por_app": {slug: {"nome": a.nome, "total": a.total, "lancamentos": a.lancamentos,
                           "competencias": a.competencias}
                    for slug, a in c.por_app.items()},
        "por_competencia": c.renda_mensal(),
        "nao_identificados": [
            {"data": t.data, "valor": t.valor, "descricao": t.descricao,
             "pagador": t.pagador_nome}
            for t in c.nao_identificados[:20]
        ],
        "nao_identificados_total": len(c.nao_identificados),
    }


@router.post("/extrato/conferir")
def conferir_extrato(body: ExtratoIn):
    """Mostra o que foi reconhecido ANTES de gravar. O entregador confere o
    que a gente entendeu do extrato dele — nada entra pelas costas."""
    transacoes, c = _classificar_texto(body.conteudo)
    return _resposta_classificacao(transacoes, c)


@router.post("/extrato/importar")
def importar_extrato(body: ExtratoIn):
    from .openfinance import para_lancamentos
    transacoes, c = _classificar_texto(body.conteudo)
    if not c.por_app:
        raise HTTPException(422, {
            "erro": "nenhum_repasse_reconhecido",
            "mensagem": "Li o extrato mas não reconheci repasse de plataforma nenhuma. "
                        "Confira os identificadores em Admin → Apps de entrega.",
            **_resposta_classificacao(transacoes, c)})
    gravados = [repo.lancar(l) for l in para_lancamentos(c, body.cpf, origem="extrato")]
    return {"lancamentos": len(gravados), **_resposta_classificacao(transacoes, c)}


# -------------------------------------------------------- open finance

def _provider_open_finance():
    from .registry import ProvedorNaoConfigurado, plataforma
    try:
        return plataforma.renda()
    except ProvedorNaoConfigurado as e:
        raise HTTPException(503, {"erro": "fornecedor_nao_configurado", "port": e.port,
                                  "dependencia": e.dependencia, "mensagem": str(e)})


@router.post("/openfinance/consentir")
async def openfinance_consentir(body: ConsentimentoIn):
    """Inicia o consentimento. Devolve a URL onde o entregador autoriza no
    banco dele — é ele quem libera, e pode revogar quando quiser."""
    prov = _provider_open_finance()
    try:
        c = await prov.consentir(body.cpf, "open_finance")
    except Exception as e:
        raise HTTPException(502, f"o transmissor não respondeu: {e}")
    return {**asdict(c), "url_autorizacao": getattr(c, "url_autorizacao", "")}


@router.post("/openfinance/importar")
async def openfinance_importar(body: ImportarOpenFinanceIn):
    """Com o consentimento autorizado, lê os repasses e grava como ganho."""
    prov = _provider_open_finance()
    try:
        meses = await prov.renda(body.consentimento_id, body.meses)
    except Exception as e:
        raise HTTPException(502, f"não deu para ler as transações: {e}")
    gravados = [repo.lancar({"cpf": body.cpf, "app": m.fonte, "competencia": m.competencia,
                             "bruto": m.bruto, "origem": "open_finance"})
                for m in meses]
    return {"lancamentos": len(gravados),
            "por_competencia": {m.competencia: m.bruto for m in meses}}


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
