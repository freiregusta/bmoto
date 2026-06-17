"""
serialization.py — Converte a Operation (agregado) em dict serializável e volta.

Explícito de propósito: enums viram .value, datetimes viram ISO, sets viram
listas — round-trip seguro para persistir em Postgres (coluna JSON/JSONB).
"""
from __future__ import annotations
import datetime as dt
from typing import Optional

from models import (WorkerData, CreditRequest, CreditDecision, PricingResult,
                    Proposal, Vinculo, DecisionStatus)
from state_machine import Operation, Transition, S, EV


def _iso(x: Optional[dt.datetime]) -> Optional[str]:
    return x.isoformat() if x else None


def _piso(s: Optional[str]) -> Optional[dt.datetime]:
    return dt.datetime.fromisoformat(s) if s else None


# ---- WorkerData -------------------------------------------------------------
def _worker_to(w: WorkerData) -> dict:
    return {
        "cpf": w.cpf, "nome": w.nome, "idade": w.idade, "vinculo": w.vinculo.value,
        "empregador_cnpj": w.empregador_cnpj, "renda_liquida": w.renda_liquida,
        "margem_disponivel": w.margem_disponivel, "meses_de_empresa": w.meses_de_empresa,
        "fgts_saldo": w.fgts_saldo, "multa_rescisoria_pct": w.multa_rescisoria_pct,
        "possui_consignado_ativo": w.possui_consignado_ativo,
        "parcelas_consignado_ativas": w.parcelas_consignado_ativas,
        "comprometimento_renda_total": w.comprometimento_renda_total,
    }


def _worker_from(d: dict) -> WorkerData:
    return WorkerData(vinculo=Vinculo(d["vinculo"]),
                      **{k: v for k, v in d.items() if k != "vinculo"})


# ---- CreditRequest ----------------------------------------------------------
def _req_to(r: CreditRequest) -> dict:
    return {"proposal_id": r.proposal_id, "worker": _worker_to(r.worker),
            "valor_solicitado": r.valor_solicitado, "prazo_meses": r.prazo_meses,
            "received_at": _iso(r.received_at)}


def _req_from(d: dict) -> CreditRequest:
    return CreditRequest(proposal_id=d["proposal_id"], worker=_worker_from(d["worker"]),
                         valor_solicitado=d["valor_solicitado"],
                         prazo_meses=d["prazo_meses"],
                         received_at=_piso(d["received_at"]))


# ---- CreditDecision ---------------------------------------------------------
def _dec_to(x: CreditDecision) -> dict:
    return {"status": x.status.value, "pd": x.pd, "score": x.score,
            "parcela_maxima": x.parcela_maxima, "valor_maximo": x.valor_maximo,
            "reasons": x.reasons}


def _dec_from(d: dict) -> CreditDecision:
    return CreditDecision(status=DecisionStatus(d["status"]), pd=d["pd"],
                          score=d["score"], parcela_maxima=d["parcela_maxima"],
                          valor_maximo=d["valor_maximo"], reasons=d["reasons"])


# ---- PricingResult ----------------------------------------------------------
def _price_to(p: PricingResult) -> dict:
    return {"liberado": p.liberado, "principal_financiado": p.principal_financiado,
            "parcela": p.parcela, "prazo_meses": p.prazo_meses, "taxa_am": p.taxa_am,
            "taxa_aa": p.taxa_aa, "iof": p.iof, "seguro": p.seguro, "cet_am": p.cet_am,
            "cet_aa": p.cet_aa, "componentes": p.componentes, "feasible": p.feasible,
            "notes": p.notes}


def _price_from(d: dict) -> PricingResult:
    return PricingResult(**d)


# ---- Proposal ---------------------------------------------------------------
def _prop_to(p: Proposal) -> dict:
    return {"proposal_id": p.proposal_id, "installment_quantity": p.installment_quantity,
            "installment_amount": p.installment_amount, "available_balance": p.available_balance,
            "amount": p.amount, "iof": p.iof, "annual_tax": p.annual_tax, "cet": p.cet,
            "interest_tax": p.interest_tax, "monthly_cet": p.monthly_cet,
            "insurance_amount": p.insurance_amount, "entry_url": p.entry_url}


def _prop_from(d: dict) -> Proposal:
    return Proposal(**d)


# ---- Operation --------------------------------------------------------------
def op_to_dict(op: Operation) -> dict:
    return {
        "proposal_id": op.proposal_id,
        "state": op.state.value,
        "request": _req_to(op.request),
        "decision": _dec_to(op.decision) if op.decision else None,
        "pricing": _price_to(op.pricing) if op.pricing else None,
        "proposal": _prop_to(op.proposal) if op.proposal else None,
        "historico": [{"de": t.de.value, "evento": t.evento.value,
                       "para": t.para.value, "at": _iso(t.at)} for t in op.historico],
        "eventos_aplicados": sorted(op.eventos_aplicados),
        "updated_at": _iso(op.updated_at),
    }


def op_from_dict(d: dict) -> Operation:
    op = Operation(proposal_id=d["proposal_id"], state=S(d["state"]),
                   request=_req_from(d["request"]))
    op.decision = _dec_from(d["decision"]) if d["decision"] else None
    op.pricing = _price_from(d["pricing"]) if d["pricing"] else None
    op.proposal = _prop_from(d["proposal"]) if d["proposal"] else None
    op.historico = [Transition(S(t["de"]), EV(t["evento"]), S(t["para"]), _piso(t["at"]))
                    for t in d["historico"]]
    op.eventos_aplicados = set(d["eventos_aplicados"])
    op.updated_at = _piso(d["updated_at"])
    return op
