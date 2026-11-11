"""
router.py — /platform/*: o que o super app e o painel de operação consomem.

GET  /platform/modules      módulos (produtos) com enabled/pronto/providers
GET  /platform/providers    port -> adapter ativo + disponíveis
GET  /platform/health       health de cada adapter ativo
GET  /platform/verificar    pendências (produto ligado sem capability)

Endpoints funcionais dos produtos (demo, roda com mock):
POST /platform/conta/abrir, GET /platform/conta/{id}/saldo|extrato,
POST /platform/conta/{id}/pix, POST /platform/conta/{id}/credito
POST /platform/kyc, POST /platform/seguro/cotar, POST /platform/mei/abrir,
GET  /platform/mei/{cnpj}/das/{competencia}, POST /platform/renda/consentir,
GET  /platform/renda/{consentimento_id}
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .ports import Pessoa
from .registry import plataforma

router = APIRouter(prefix="/platform", tags=["plataforma"])


class PessoaIn(BaseModel):
    cpf: str
    nome: str
    nascimento: str
    email: Optional[str] = None
    celular: Optional[str] = None
    cnpj_mei: Optional[str] = None
    endereco: dict = {}

    def to_port(self) -> Pessoa:
        return Pessoa(**self.model_dump())


class PixIn(BaseModel):
    valor: float
    chave: str
    idempotency_key: str


class CreditoIn(BaseModel):
    valor: float
    descricao: str
    origem: Optional[str] = None
    idempotency_key: Optional[str] = None


class CotacaoIn(BaseModel):
    pessoa: PessoaIn
    produto: str = "vida_ap"
    params: dict = {}


class MeiIn(BaseModel):
    pessoa: PessoaIn
    cnae: str = "5320-2/02"


class ConsentIn(BaseModel):
    cpf: str
    fonte: str


def _exige_produto(produto_id: str) -> None:
    if not plataforma.produtos.ligado(produto_id):
        raise HTTPException(404, f"produto '{produto_id}' desligado")


def _guard(coro):
    async def run():
        try:
            return await coro
        except KeyError as e:
            raise HTTPException(404, str(e))
        except (ValueError, NotImplementedError) as e:
            raise HTTPException(422, str(e))
        except LookupError as e:
            raise HTTPException(503, str(e))
    return run()


# -- introspecção -----------------------------------------------------------

@router.get("/modules")
def modules():
    return {"modules": plataforma.modulos()}


@router.get("/providers")
def providers():
    return {"providers": plataforma.providers.tabela()}


@router.get("/health")
async def health():
    hs = await plataforma.providers.health()
    return {"ok": all(h.ok for h in hs), "providers": [asdict(h) for h in hs]}


@router.get("/verificar")
def verificar():
    pend = plataforma.verificar()
    return {"ok": not pend, "pendencias": pend}


# -- conta ------------------------------------------------------------------

@router.post("/conta/abrir")
async def conta_abrir(p: PessoaIn):
    _exige_produto("conta")
    kyc = await _guard(plataforma.kyc().validar(p.to_port()))
    if not kyc.aprovado:
        raise HTTPException(422, {"kyc": asdict(kyc)})
    conta = await _guard(plataforma.conta().abrir_conta(p.to_port()))
    return {"conta": asdict(conta), "kyc": asdict(kyc)}


@router.get("/conta/{conta_id}/saldo")
async def conta_saldo(conta_id: str):
    _exige_produto("conta")
    return {"conta_id": conta_id, "saldo": await _guard(plataforma.conta().saldo(conta_id))}


@router.get("/conta/{conta_id}/extrato")
async def conta_extrato(conta_id: str, desde: Optional[str] = None):
    _exige_produto("conta")
    ls = await _guard(plataforma.conta().extrato(conta_id, desde))
    return {"conta_id": conta_id, "lancamentos": [asdict(l) for l in ls]}


@router.post("/conta/{conta_id}/pix")
async def conta_pix(conta_id: str, body: PixIn):
    _exige_produto("conta")
    pg = await _guard(plataforma.conta().pix_enviar(conta_id, body.valor, body.chave, body.idempotency_key))
    return asdict(pg)


@router.post("/conta/{conta_id}/credito")
async def conta_credito(conta_id: str, body: CreditoIn):
    """Simula repasse do app (iFood/Rappi/99) caindo na conta. No real: webhook Pix."""
    _exige_produto("conta")
    l = await _guard(plataforma.conta().creditar(conta_id, body.valor, body.descricao,
                                                  body.origem, body.idempotency_key))
    return asdict(l)


# -- kyc / seguro / mei / renda --------------------------------------------

@router.post("/kyc")
async def kyc(p: PessoaIn):
    return asdict(await _guard(plataforma.kyc().validar(p.to_port())))


@router.post("/seguro/cotar")
async def seguro_cotar(body: CotacaoIn):
    _exige_produto("seguro")
    return asdict(await _guard(plataforma.seguro().cotar(body.pessoa.to_port(), body.produto, body.params)))


@router.post("/seguro/{cotacao_id}/emitir")
async def seguro_emitir(cotacao_id: str, cpf: str):
    _exige_produto("seguro")
    return asdict(await _guard(plataforma.seguro().emitir(cotacao_id, cpf)))


@router.post("/mei/abrir")
async def mei_abrir(body: MeiIn):
    _exige_produto("mei")
    return asdict(await _guard(plataforma.contador().abrir_mei(body.pessoa.to_port(), body.cnae)))


@router.get("/mei/{cnpj}/das/{competencia}")
async def mei_das(cnpj: str, competencia: str):
    _exige_produto("mei")
    return asdict(await _guard(plataforma.contador().das(cnpj, competencia)))


@router.post("/renda/consentir")
async def renda_consentir(body: ConsentIn):
    _exige_produto("ganhos")
    return asdict(await _guard(plataforma.renda().consentir(body.cpf, body.fonte)))


@router.get("/renda/{consentimento_id}")
async def renda_ler(consentimento_id: str, meses: int = 3):
    _exige_produto("ganhos")
    rs = await _guard(plataforma.renda().renda(consentimento_id, meses))
    return {"meses": [asdict(r) for r in rs], "media": round(sum(r.bruto for r in rs) / max(len(rs), 1), 2)}
