"""
api.py — Exposição da esteira como API REST (FastAPI).

Camadas:
  * Webhooks (entrada da plataforma/Dataprev/Pix): solicitação do leilão,
    devolutiva, averbação, liquidação Pix.
  * Endpoints do bot (jornada do entry_url): aceite, KYC, assinatura da CCB.
  * Consulta (dashboard do originador): operação e listagem.

A API dirige a máquina de estados explicitamente — cada chamada externa vira um
evento. Passos internos (crédito, pricing, contabilização, cessão) rodam
sozinhos; passos externos (leilão, aceite, KYC, CCB, averbação, Pix) esperam o
webhook/endpoint correspondente. O gate averbação→Pix é o da máquina de estados.

Subir local:
    uvicorn api:app --reload
Docs/contrato (o que o Lovable consome):
    http://localhost:8000/docs   e   http://localhost:8000/openapi.json
"""
from __future__ import annotations
from typing import Optional, List
from enum import Enum

import os
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from models import (WorkerData, CreditRequest, Vinculo, AuctionStatus)
from credit_engine import CreditEngine
from pricing_engine import PricingEngine
from dataprev_client import LeilaoClient, MockLeilaoClient
from state_machine import (Repository, Operation, Event, EV, S, apply,
                           IllegalTransition)
from security import hmac_guard, ip_guard, mtls_guard


# ============================================================================
# Schemas (contrato da API — o que o front/plataforma falam)
# ============================================================================
class VinculoIn(str, Enum):
    CLT = "CLT"; DOMESTICO = "DOMESTICO"; RURAL = "RURAL"; MEI = "MEI"


class WorkerIn(BaseModel):
    cpf: str
    nome: str
    idade: int
    vinculo: VinculoIn = VinculoIn.CLT
    empregador_cnpj: str
    renda_liquida: float
    margem_disponivel: float
    meses_de_empresa: int
    fgts_saldo: float = 0.0
    multa_rescisoria_pct: float = 0.40
    possui_consignado_ativo: bool = False
    parcelas_consignado_ativas: float = 0.0
    comprometimento_renda_total: float = 0.0


class SolicitacaoIn(BaseModel):
    proposal_id: str
    worker: WorkerIn
    valor_solicitado: Optional[float] = Field(None, description="Liberado desejado; None = maximizar pela margem")
    prazo_meses: int = 24


class DevolutivaIn(BaseModel):
    status: AuctionStatus
    error_message: str = ""
    event_id: Optional[str] = None


class BoolIn(BaseModel):
    ok: bool
    event_id: Optional[str] = None


class DecisaoOut(BaseModel):
    status: str
    pd: float
    score: float
    motivos: List[str]


class PricingOut(BaseModel):
    liberado: float
    principal_financiado: float
    parcela: float
    prazo_meses: int
    taxa_am: float
    taxa_aa: float
    iof: float
    seguro: float
    cet_am: float
    cet_aa: float
    feasible: bool
    notes: List[str]


class TransicaoOut(BaseModel):
    de: str
    evento: str
    para: str


class OperacaoOut(BaseModel):
    proposal_id: str
    estado: str
    terminal: bool
    esperando_externo: bool
    decisao: Optional[DecisaoOut] = None
    pricing: Optional[PricingOut] = None
    oferta: Optional[dict] = None
    historico: List[TransicaoOut] = []


# ============================================================================
# Serviço (orquestra máquina de estados + motores + clientes)
# ============================================================================
class OriginadoraService:
    def __init__(self, client: LeilaoClient, repo: Optional[Repository] = None,
                 entry_url: str = "https://originadora.exemplo/entrada"):
        self.client = client
        self.repo = repo or Repository()
        self.credit = CreditEngine()
        self.pricing = PricingEngine()
        self.entry_url = entry_url

    # ---- helpers --------------------------------------------------------
    def _to_domain(self, s: SolicitacaoIn) -> CreditRequest:
        w = s.worker
        worker = WorkerData(
            cpf=w.cpf, nome=w.nome, idade=w.idade, vinculo=Vinculo(w.vinculo.value),
            empregador_cnpj=w.empregador_cnpj, renda_liquida=w.renda_liquida,
            margem_disponivel=w.margem_disponivel, meses_de_empresa=w.meses_de_empresa,
            fgts_saldo=w.fgts_saldo, multa_rescisoria_pct=w.multa_rescisoria_pct,
            possui_consignado_ativo=w.possui_consignado_ativo,
            parcelas_consignado_ativas=w.parcelas_consignado_ativas,
            comprometimento_renda_total=w.comprometimento_renda_total)
        return CreditRequest(proposal_id=s.proposal_id, worker=worker,
                             valor_solicitado=s.valor_solicitado,
                             prazo_meses=s.prazo_meses)

    def _ev(self, op: Operation, t: EV, eid: Optional[str], **payload) -> None:
        eid = eid or f"{op.proposal_id}:{t.value}:{len(op.historico)}"
        apply(op, Event(t, eid, payload))

    # ---- 1) Ingestão do leilão (síncrono: crédito+pricing+submete) ------
    def ingerir(self, s: SolicitacaoIn) -> Operation:
        existente = self.repo.get(s.proposal_id)
        if existente is not None:
            return existente  # idempotência por proposal_id
        req = self._to_domain(s)
        op = Operation(proposal_id=s.proposal_id, state=S.RECEBIDA, request=req)

        dec = self.credit.decide(req)
        op.decision = dec
        if not dec.approved:
            self._ev(op, EV.CREDITO_REPROVADO, None, motivos=dec.reasons)
            self.repo.save(op); return op
        self._ev(op, EV.CREDITO_APROVADO, None)

        pr = self.pricing.price(req, dec)
        op.pricing = pr
        if not pr.feasible:
            self._ev(op, EV.PRICING_INVIAVEL, None, notas=pr.notes)
            self.repo.save(op); return op
        op.proposal = self.pricing.build_proposal(req, pr, self.entry_url)
        self._ev(op, EV.PRICING_OK, None)           # -> OFERTA_ENVIADA

        # efeito: submete a oferta ao leilão (a devolutiva chega via webhook)
        self.client.submit_proposal(op.proposal)
        self.repo.save(op)
        return op

    # ---- 2) Devolutiva do leilão (webhook) -----------------------------
    def devolutiva(self, proposal_id: str, d: DevolutivaIn) -> Operation:
        op = self._get(proposal_id)
        mapa = {AuctionStatus.APPROVED: EV.LEILAO_APPROVED,
                AuctionStatus.DENIED: EV.LEILAO_DENIED,
                AuctionStatus.ERROR: EV.LEILAO_ERROR}
        self._ev(op, mapa[d.status], d.event_id, error=d.error_message)
        self.repo.save(op); return op

    # ---- 3) Aceite do tomador (redirect/CTPS) --------------------------
    def aceite(self, proposal_id: str, b: BoolIn) -> Operation:
        op = self._get(proposal_id)
        self._ev(op, EV.TOMADOR_ACEITOU if b.ok else EV.TOMADOR_EXPIROU, b.event_id)
        self.repo.save(op); return op

    # ---- 4) KYC (bot) ---------------------------------------------------
    def kyc(self, proposal_id: str, b: BoolIn) -> Operation:
        op = self._get(proposal_id)
        self._ev(op, EV.KYC_APROVADO if b.ok else EV.KYC_REPROVADO, b.event_id)
        self.repo.save(op); return op

    # ---- 5) Assinatura da CCB (bot) -> dispara averbação ---------------
    def assinar_ccb(self, proposal_id: str, eid: Optional[str] = None) -> Operation:
        op = self._get(proposal_id)
        self._ev(op, EV.CCB_ASSINADA, eid)
        self._ev(op, EV.SOLICITA_AVERBACAO, None)   # efeito: pede averbação Dataprev
        self.repo.save(op); return op

    # ---- 6) Averbação (webhook Dataprev) -> abre gate e dispara Pix ----
    def averbacao(self, proposal_id: str, b: BoolIn) -> Operation:
        op = self._get(proposal_id)
        if not b.ok:
            self._ev(op, EV.AVERBACAO_FALHA, b.event_id)
            self.repo.save(op); return op
        self._ev(op, EV.AVERBACAO_OK, b.event_id)   # -> AVERBADA (gate liberado)
        # efeito: inicia o Pix (BaaS); confirmação chega no webhook de Pix
        self._ev(op, EV.PIX_ENVIADO, None)          # -> DESEMBOLSANDO
        self.repo.save(op); return op

    # ---- 7) Liquidação Pix (webhook) -> contabiliza e cede -------------
    def pix(self, proposal_id: str, b: BoolIn) -> Operation:
        op = self._get(proposal_id)
        if not b.ok:
            self._ev(op, EV.PIX_FALHA, b.event_id)
            self.repo.save(op); return op
        self._ev(op, EV.PIX_OK, b.event_id)         # -> DESEMBOLSADA
        self._ev(op, EV.CONTABILIZADA, None)        # booking na IF emissora
        self._ev(op, EV.CEDIDA_FIDC, None)          # cessão ao FIDC (O2D)
        self.repo.save(op); return op

    # ---- consultas ------------------------------------------------------
    def _get(self, proposal_id: str) -> Operation:
        op = self.repo.get(proposal_id)
        if op is None:
            raise KeyError(proposal_id)
        return op

    def get(self, proposal_id: str) -> Operation:
        return self._get(proposal_id)

    def list(self) -> List[Operation]:
        return self.repo.all()


# ============================================================================
# Serialização
# ============================================================================
def to_out(op: Operation) -> OperacaoOut:
    dec = None
    if op.decision:
        dec = DecisaoOut(status=op.decision.status.value, pd=op.decision.pd,
                         score=op.decision.score, motivos=op.decision.reasons)
    pr = None
    if op.pricing:
        p = op.pricing
        pr = PricingOut(liberado=p.liberado, principal_financiado=p.principal_financiado,
                        parcela=p.parcela, prazo_meses=p.prazo_meses, taxa_am=p.taxa_am,
                        taxa_aa=p.taxa_aa, iof=p.iof, seguro=p.seguro, cet_am=p.cet_am,
                        cet_aa=p.cet_aa, feasible=p.feasible, notes=p.notes)
    oferta = op.proposal.to_api_payload() if op.proposal else None
    hist = [TransicaoOut(de=t.de.value, evento=t.evento.value, para=t.para.value)
            for t in op.historico]
    return OperacaoOut(proposal_id=op.proposal_id, estado=op.state.value,
                       terminal=op.terminal, esperando_externo=op.esperando_externo,
                       decisao=dec, pricing=pr, oferta=oferta, historico=hist)


# ============================================================================
# App factory + rotas
# ============================================================================
def build_service() -> OriginadoraService:
    """Monta o serviço a partir do ambiente.
    DATABASE_URL válida -> Postgres. Senão (ou se falhar) -> in-memory."""
    dsn = os.environ.get("DATABASE_URL", "").strip()
    repo: Repository
    if dsn and dsn.startswith("postgresql"):
        try:
            from repository_sql import PostgresRepository
            repo = PostgresRepository(dsn)
            print("INFO: Repositório Postgres conectado.")
        except Exception as e:
            print(f"WARN: Postgres indisponível ({e}). Usando repositório in-memory.")
            repo = Repository()
    else:
        print("INFO: DATABASE_URL não configurada. Usando repositório in-memory.")
        repo = Repository()
    entry = os.environ.get("ENTRY_URL", "https://originadora.exemplo/entrada")
    # TODO produção: trocar MockLeilaoClient por DataprevHttpClient.
    return OriginadoraService(MockLeilaoClient(seed=6), repo=repo, entry_url=entry)


def make_app(service: Optional[OriginadoraService] = None) -> FastAPI:
    svc = service or build_service()
    app = FastAPI(title="Originadora — Crédito do Trabalhador",
                  version="0.1.0",
                  description="Esteira de consignado privado (leilão Dataprev).")

    origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=origins,
                           allow_methods=["*"], allow_headers=["*"])

    # Guards aplicados só aos webhooks (server-to-server). Bot/consulta ficam fora.
    WEBHOOK_GUARDS = [Depends(mtls_guard), Depends(hmac_guard), Depends(ip_guard)]

    def _guard(fn, *a, **kw):
        try:
            return to_out(fn(*a, **kw))
        except KeyError as e:
            raise HTTPException(404, f"Operação {e} não encontrada")
        except IllegalTransition as e:
            raise HTTPException(409, str(e))

    @app.get("/health")
    def health():
        return {"status": "ok", "operacoes": len(svc.list())}

    # --- Webhooks da plataforma (protegidos: HMAC + allowlist + mTLS) ---
    @app.post("/webhooks/leilao/solicitacao", response_model=OperacaoOut,
              tags=["webhooks"], dependencies=WEBHOOK_GUARDS)
    def solicitacao(body: SolicitacaoIn):
        return _guard(svc.ingerir, body)

    @app.post("/webhooks/leilao/devolutiva/{proposal_id}", response_model=OperacaoOut,
              tags=["webhooks"], dependencies=WEBHOOK_GUARDS)
    def devolutiva(proposal_id: str, body: DevolutivaIn):
        return _guard(svc.devolutiva, proposal_id, body)

    @app.post("/webhooks/dataprev/averbacao/{proposal_id}", response_model=OperacaoOut,
              tags=["webhooks"], dependencies=WEBHOOK_GUARDS)
    def averbacao(proposal_id: str, body: BoolIn):
        return _guard(svc.averbacao, proposal_id, body)

    @app.post("/webhooks/pix/{proposal_id}", response_model=OperacaoOut,
              tags=["webhooks"], dependencies=WEBHOOK_GUARDS)
    def pix(proposal_id: str, body: BoolIn):
        return _guard(svc.pix, proposal_id, body)

    # --- Endpoints do bot (jornada do entry_url) ---
    @app.post("/operacoes/{proposal_id}/aceite", response_model=OperacaoOut,
              tags=["bot"])
    def aceite(proposal_id: str, body: BoolIn):
        return _guard(svc.aceite, proposal_id, body)

    @app.post("/operacoes/{proposal_id}/kyc", response_model=OperacaoOut,
              tags=["bot"])
    def kyc(proposal_id: str, body: BoolIn):
        return _guard(svc.kyc, proposal_id, body)

    @app.post("/operacoes/{proposal_id}/ccb", response_model=OperacaoOut,
              tags=["bot"])
    def ccb(proposal_id: str, idempotency_key: Optional[str] = Header(None)):
        return _guard(svc.assinar_ccb, proposal_id, idempotency_key)

    # --- Consulta (dashboard) ---
    @app.get("/operacoes/{proposal_id}", response_model=OperacaoOut, tags=["consulta"])
    def get_op(proposal_id: str):
        return _guard(svc.get, proposal_id)

    @app.get("/operacoes", response_model=List[OperacaoOut], tags=["consulta"])
    def list_ops():
        return [to_out(o) for o in svc.list()]

    return app


app = make_app()
