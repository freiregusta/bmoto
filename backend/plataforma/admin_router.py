"""
admin_router.py — /admin/*: o ambiente de administração.

O que a tela de admin consegue fazer por aqui, sem deploy:

- **Conexões**: cadastrar qualquer fornecedor (BaaS, seguradora, emissor,
  contabilidade, bureau de renda) para qualquer port, global ou só num módulo.
  `GET /admin/tipos` devolve o catálogo de tipos e os CAMPOS de cada um, para
  a tela montar o formulário sozinha. `POST /admin/conexoes/{id}/testar`
  bate no fornecedor antes de ligar.
- **Produtos de crédito**: criar/editar cartão, financiamento de moto, crédito
  pessoal, antecipação, consignado — todos paramétricos.
  `POST /admin/produtos-credito/{id}/simular` roda a política na hora.
- **Apps de entrega**: cadastrar plataforma, integração e forma de repasse.
- **Módulos**: ligar/desligar, reordenar, renomear, apontar a jornada.
- **Jornadas**: montar o passo-a-passo; `GET /admin/jornadas/tipos-passo`
  descreve os tipos disponíveis.
- **Auditoria**: quem mudou o quê.

Proteção: header `X-Admin-Token` comparado a `ADMIN_TOKEN`. Se a env não
estiver definida, o acesso é liberado apenas quando `AMBIENTE != producao`
(para não travar o desenvolvimento, e não deixar aberto em produção).
"""

from __future__ import annotations

import os
from dataclasses import asdict
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from .adapters import CATALOGO as CATALOGO_ADAPTERS, tipos_para_port
from .adapters.rest import OPERACOES_POR_PORT
from .catalogo import TIPOS_INTEGRACAO_APP, TIPOS_PRODUTO_CREDITO, catalogo
from .jornadas import TIPOS_PASSO, MotorJornadas, RepositorioJornadas
from .ports import PORTS
from .registry import ENV_POR_PORT, ProvedorNaoConfigurado, plataforma

repo_jornadas = RepositorioJornadas()
motor = MotorJornadas(repo_jornadas, catalogo, plataforma)


def admin_guard(x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")) -> str:
    esperado = os.environ.get("ADMIN_TOKEN", "")
    if esperado:
        if x_admin_token != esperado:
            raise HTTPException(401, "token de administrador inválido")
        return "admin"
    if os.environ.get("AMBIENTE", "dev").lower() == "producao":
        raise HTTPException(503, "ADMIN_TOKEN não configurado em produção")
    return "dev"


router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(admin_guard)])


# --------------------------------------------------------------- schemas

class ConexaoIn(BaseModel):
    id: Optional[str] = None
    port: str
    tipo: str
    titulo: Optional[str] = None
    escopo: str = "global"
    config: dict = {}
    ativo: bool = True
    prioridade: int = 100
    ambiente: str = "sandbox"
    observacao: str = ""


class ProdutoCreditoIn(BaseModel):
    id: Optional[str] = None
    nome: str
    tipo: str
    taxa_mensal: Optional[float] = None
    prazo_min: Optional[int] = None
    prazo_max: Optional[int] = None
    ticket_min: Optional[float] = None
    ticket_max: Optional[float] = None
    garantia_tipo: Optional[str] = None
    ltv_max: Optional[float] = None
    score_minimo: Optional[int] = None
    renda_minima: Optional[float] = None
    comprometimento_max: Optional[float] = None
    idade_min: Optional[int] = None
    idade_max: Optional[int] = None
    exige_mei: Optional[bool] = None
    exige_kyc: Optional[bool] = None
    meses_renda_comprovada: Optional[int] = None
    tac: Optional[float] = None
    seguro_embutido: Optional[str] = None
    emissor_conexao_id: Optional[str] = None
    cobranca: Optional[str] = None
    jornada_id: Optional[str] = None
    modulo_id: Optional[str] = None
    ativo: Optional[bool] = None


class SimulacaoIn(BaseModel):
    score: int = 600
    renda_media: float = 2500.0
    idade: int = 32
    tem_mei: bool = False
    kyc_ok: bool = True
    meses_renda: int = 6
    valor_garantia: float = 0.0
    solicitado: Optional[float] = None
    parcelas: Optional[int] = None


class AppEntregaIn(BaseModel):
    id: Optional[str] = None
    nome: str
    slug: Optional[str] = None
    tipo_integracao: str = "api"
    provider_tipo: str = "mock"
    config: dict = {}
    repasse_direto: bool = False
    periodicidade_repasse: str = "semanal"
    taxa_plataforma: float = 0.0
    mapeamento: dict = {}
    cnpjs: list[str] = []
    identificadores: list[str] = []
    logo_url: str = ""
    ativo: bool = True
    ordem: int = 100


class ModuloIn(BaseModel):
    id: str
    enabled: Optional[bool] = None
    ordem: Optional[int] = None
    titulo: Optional[str] = None
    descricao: Optional[str] = None
    icone: Optional[str] = None
    jornada_id: Optional[str] = None


class PassoIn(BaseModel):
    id: Optional[str] = None
    tipo: str
    titulo: Optional[str] = None
    descricao: str = ""
    obrigatorio: bool = True
    condicao: Optional[str] = None
    config: dict = {}


class JornadaIn(BaseModel):
    id: Optional[str] = None
    nome: str
    modulo_id: Optional[str] = None
    produto_credito_id: Optional[str] = None
    ativo: bool = True
    versao: Optional[int] = None
    passos: list[PassoIn] = []


def _erro(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except ProvedorNaoConfigurado as e:
        # Sem fornecedor não há teste a fazer: dizemos qual é a dependência.
        raise HTTPException(503, {"erro": "fornecedor_nao_configurado", "port": e.port,
                                  "dependencia": e.dependencia, "mensagem": str(e)})
    except KeyError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))


# --------------------------------------------------------------- metadados

ROTULO_PORT = {
    "conta": "Conta e Pix (BaaS)",
    "cartao": "Cartão",
    "kyc": "Identidade (KYC)",
    "credito": "Emissor de crédito",
    "seguro": "Seguradora",
    "saude": "Operadora de saúde",
    "contador": "Contabilidade (MEI)",
    "renda": "Leitura de renda",
}


@router.get("/tipos")
def tipos():
    """Catálogo para a tela montar formulários: ports, fornecedores e campos."""
    return {
        "ports": [{"port": p, "titulo": ROTULO_PORT.get(p, p), "env": ENV_POR_PORT[p],
                   "operacoes_rest": list(OPERACOES_POR_PORT.get(p, ())),
                   "fornecedores": [s.to_dict() for s in tipos_para_port(p)]}
                  for p in PORTS],
        "adapters": [s.to_dict() for s in CATALOGO_ADAPTERS],
        "tipos_produto_credito": list(TIPOS_PRODUTO_CREDITO),
        "tipos_integracao_app": list(TIPOS_INTEGRACAO_APP),
        "tipos_passo": list(TIPOS_PASSO),
    }


@router.get("/resumo")
def resumo():
    mods = plataforma.modulos()
    return {
        "modulos": {"total": len(mods), "ligados": sum(1 for m in mods if m["enabled"]),
                    "prontos": sum(1 for m in mods if m["pronto"])},
        "conexoes": {"total": len(catalogo.conexoes()),
                     "ativas": sum(1 for c in catalogo.conexoes() if c.ativo)},
        "produtos_credito": {"total": len(catalogo.produtos_credito()),
                             "ativos": sum(1 for p in catalogo.produtos_credito() if p.ativo)},
        "apps_entrega": {"total": len(catalogo.apps_entrega()),
                         "ativos": sum(1 for a in catalogo.apps_entrega() if a.ativo)},
        "jornadas": len(repo_jornadas.todas()),
        "pendencias": plataforma.verificar(),
    }


# --------------------------------------------------------------- conexões

@router.get("/conexoes")
def listar_conexoes(port: Optional[str] = None):
    return {"conexoes": [asdict(c) for c in catalogo.conexoes(port)]}


@router.post("/conexoes")
def criar_conexao(body: ConexaoIn):
    return asdict(_erro(catalogo.salvar_conexao, body.model_dump(exclude_none=False)))


@router.put("/conexoes/{conexao_id}")
def atualizar_conexao(conexao_id: str, body: ConexaoIn):
    dados = body.model_dump()
    dados["id"] = conexao_id
    return asdict(_erro(catalogo.salvar_conexao, dados))


@router.post("/conexoes/{conexao_id}/desligar")
def desligar_conexao(conexao_id: str):
    return asdict(_erro(catalogo.desligar_conexao, conexao_id))


@router.delete("/conexoes/{conexao_id}")
def remover_conexao(conexao_id: str):
    if not catalogo.remover_conexao(conexao_id):
        raise HTTPException(404, "conexão não encontrada")
    return {"removida": conexao_id}


@router.post("/conexoes/{conexao_id}/testar")
async def testar_conexao(conexao_id: str):
    c = _erro(catalogo.conexao, conexao_id)
    from .adapters import construir
    prov = _erro(construir, c.tipo, c.port, c.config, c.titulo or c.tipo)
    h = await prov.health()
    caps = sorted(x.value for x in prov.capabilities())
    faltando = getattr(prov, "segredos_faltando", lambda: [])()
    return {"conexao": c.id, "health": asdict(h), "capabilities": caps,
            "segredos_faltando": faltando}


# --------------------------------------------------------- produtos de crédito

@router.get("/produtos-credito")
def listar_produtos_credito():
    return {"produtos": [asdict(p) for p in catalogo.produtos_credito()]}


@router.post("/produtos-credito")
def criar_produto_credito(body: ProdutoCreditoIn):
    return asdict(_erro(catalogo.salvar_produto_credito, body.model_dump(exclude_none=True)))


@router.put("/produtos-credito/{produto_id}")
def atualizar_produto_credito(produto_id: str, body: ProdutoCreditoIn):
    dados = body.model_dump(exclude_none=True)
    dados["id"] = produto_id
    return asdict(_erro(catalogo.salvar_produto_credito, dados))


@router.delete("/produtos-credito/{produto_id}")
def remover_produto_credito(produto_id: str):
    if not catalogo.remover_produto_credito(produto_id):
        raise HTTPException(404, "produto não encontrado")
    return {"removido": produto_id}


@router.post("/produtos-credito/{produto_id}/simular")
def simular_produto_credito(produto_id: str, body: SimulacaoIn):
    p = _erro(catalogo.produto_credito, produto_id)
    return p.avaliar(**body.model_dump())


# --------------------------------------------------------- apps de entrega

@router.get("/apps-entrega")
def listar_apps():
    return {"apps": [asdict(a) for a in catalogo.apps_entrega()]}


@router.post("/apps-entrega")
def criar_app(body: AppEntregaIn):
    return asdict(_erro(catalogo.salvar_app_entrega, body.model_dump()))


@router.put("/apps-entrega/{app_id}")
def atualizar_app(app_id: str, body: AppEntregaIn):
    dados = body.model_dump()
    dados["id"] = app_id
    return asdict(_erro(catalogo.salvar_app_entrega, dados))


@router.delete("/apps-entrega/{app_id}")
def remover_app(app_id: str):
    if not catalogo.remover_app_entrega(app_id):
        raise HTTPException(404, "app não encontrado")
    return {"removido": app_id}


@router.post("/apps-entrega/{app_id}/testar")
async def testar_app(app_id: str):
    prov = _erro(catalogo.provider_app_entrega, app_id)
    h = await prov.health()
    return {"app": app_id, "health": asdict(h),
            "capabilities": sorted(x.value for x in prov.capabilities())}


# --------------------------------------------------------------- módulos

@router.get("/modulos")
def listar_modulos():
    return {"modulos": plataforma.modulos(),
            "jornadas": [{"id": j.id, "nome": j.nome, "modulo_id": j.modulo_id}
                         for j in repo_jornadas.todas()]}


@router.put("/modulos/{modulo_id}")
def atualizar_modulo(modulo_id: str, body: ModuloIn):
    dados = body.model_dump(exclude_none=True)
    dados["id"] = modulo_id
    m = _erro(catalogo.salvar_modulo, dados)
    return {"modulo": asdict(m),
            "efetivo": next((d for d in plataforma.modulos() if d["id"] == modulo_id), None)}


# --------------------------------------------------------------- jornadas

@router.get("/jornadas/tipos-passo")
def tipos_passo():
    desc = {
        "formulario": "Campos que o cliente preenche.",
        "consentimento": "Texto + aceite registrado (LGPD, procuração, condições).",
        "kyc": "Valida identidade no fornecedor de KYC ativo.",
        "conectar_app": "Consentimento e conexão dos apps de entrega.",
        "renda": "Consolida a renda dos apps conectados.",
        "oferta": "Roda a política do produto de crédito e devolve a oferta.",
        "escolha": "Cliente escolhe entre opções (prazo, plano, cobertura).",
        "assinatura": "Emite o documento (CCB/contrato) e colhe o aceite.",
        "provisionar": "Executa: abrir conta, emitir cartão, abrir MEI, emitir seguro, aderir saúde.",
        "revisao_manual": "Envia para a mesa de crédito.",
        "mensagem": "Tela informativa.",
    }
    return {"tipos": [{"tipo": t, "descricao": desc.get(t, ""),
                       "automatico": t in ("kyc", "renda", "oferta", "provisionar")}
                      for t in TIPOS_PASSO]}


@router.get("/jornadas")
def listar_jornadas():
    return {"jornadas": [j.to_dict() for j in repo_jornadas.todas()]}


@router.get("/jornadas/{jornada_id}")
def obter_jornada(jornada_id: str):
    return _erro(repo_jornadas.get, jornada_id).to_dict()


@router.post("/jornadas")
def criar_jornada(body: JornadaIn):
    dados = body.model_dump(exclude_none=True)
    dados["passos"] = [p.model_dump() for p in body.passos]
    return _erro(repo_jornadas.salvar, dados).to_dict()


@router.put("/jornadas/{jornada_id}")
def atualizar_jornada(jornada_id: str, body: JornadaIn):
    dados = body.model_dump(exclude_none=True)
    dados["id"] = jornada_id
    dados["passos"] = [p.model_dump() for p in body.passos]
    return _erro(repo_jornadas.salvar, dados).to_dict()


@router.delete("/jornadas/{jornada_id}")
def remover_jornada(jornada_id: str):
    if not repo_jornadas.remover(jornada_id):
        raise HTTPException(404, "jornada não encontrada")
    return {"removida": jornada_id}


@router.get("/execucoes")
def listar_execucoes(cpf: Optional[str] = None, status: Optional[str] = None):
    return {"execucoes": [asdict(e) for e in repo_jornadas.execucoes(cpf, status)]}


# --------------------------------------------------------------- auditoria

@router.get("/auditoria")
def auditoria(limite: int = 100):
    return {"registros": catalogo.auditoria(limite)}


@router.post("/seed")
def seed(forcar: bool = False):
    from .seeds import semear
    return semear(forcar)
