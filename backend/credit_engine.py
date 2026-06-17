"""
credit_engine.py — Motor de crédito.

Sequência:
  1) Cortes duros (política): vínculo, idade, tempo de empresa, margem, SCR.
  2) Score -> PD (scorecard logístico configurável).
  3) Corte por PD.
  4) Cálculo de teto de parcela (margem) e valor máximo aprovado.
"""
from __future__ import annotations
import math
from typing import List

from models import WorkerData, CreditRequest, CreditDecision, DecisionStatus, Vinculo
from config import CreditPolicy, Scorecard, DEFAULT_POLICY, DEFAULT_SCORECARD
import finance


class CreditEngine:
    def __init__(self, policy: CreditPolicy = DEFAULT_POLICY,
                 scorecard: Scorecard = DEFAULT_SCORECARD):
        self.policy = policy
        self.scorecard = scorecard

    # ---------------------------------------------------------------- scoring
    def _features(self, w: WorkerData, parcela_ref: float) -> dict:
        ead = max(w.renda_liquida, 1.0)  # proxy de exposição p/ cobertura FGTS
        cobertura = min(w.fgts_garantia / max(ead * 6, 1.0), 1.0)
        return {
            "dti": min(w.comprometimento_renda_total, 1.0),
            "ltv_margem": min(parcela_ref / max(w.margem_disponivel, 1.0), 1.0),
            "tempo_empresa_inv": 1.0 / (w.meses_de_empresa + 1),
            "idade_norm": (w.idade - 18) / 57.0,
            "vinculo_nao_clt": 0.0 if w.vinculo == Vinculo.CLT else 1.0,
            "fgts_cobertura_inv": 1.0 - cobertura,
        }

    def probability_of_default(self, w: WorkerData, parcela_ref: float) -> tuple[float, float]:
        x = self._features(w, parcela_ref)
        z = self.scorecard.intercept + sum(
            self.scorecard.coef.get(k, 0.0) * v for k, v in x.items()
        )
        pd = 1.0 / (1.0 + math.exp(-z))
        score = 1000 * (1 - pd)  # score "estilo bureau" 0..1000
        return pd, score

    # -------------------------------------------------------------- decisão
    def decide(self, req: CreditRequest) -> CreditDecision:
        w = req.worker
        p = self.policy
        reasons: List[str] = []

        # 1) Cortes duros
        if w.vinculo not in (Vinculo.CLT, Vinculo.DOMESTICO, Vinculo.RURAL, Vinculo.MEI):
            reasons.append("Vínculo não elegível ao Crédito do Trabalhador")
        if w.idade < p.idade_min or w.idade > p.idade_max:
            reasons.append(f"Idade fora da faixa ({p.idade_min}-{p.idade_max})")
        if w.idade + math.ceil(req.prazo_meses / 12) > p.idade_mais_prazo_max:
            reasons.append("Idade + prazo excede o limite")
        if w.meses_de_empresa < p.meses_empresa_min:
            reasons.append(f"Tempo de empresa < {p.meses_empresa_min} meses")
        if w.margem_disponivel < p.margem_minima:
            reasons.append("Margem insuficiente")
        if w.comprometimento_renda_total > p.dti_maximo:
            reasons.append(f"DTI {w.comprometimento_renda_total:.0%} > {p.dti_maximo:.0%}")
        if p.bloquear_se_consignado_ativo and w.possui_consignado_ativo:
            reasons.append("Consignado ativo no SCR — bloqueio anti-superendividamento")
        if not (p.prazo_min <= req.prazo_meses <= p.prazo_max):
            reasons.append("Prazo fora do permitido")

        if reasons:
            return CreditDecision(status=DecisionStatus.DECLINED, reasons=reasons)

        # 2) PD (referência de parcela = margem cheia para estressar o LTV)
        pd, score = self.probability_of_default(w, w.margem_disponivel)

        # 3) Corte por PD
        if pd > p.pd_maxima:
            return CreditDecision(
                status=DecisionStatus.DECLINED, pd=pd, score=score,
                reasons=[f"PD {pd:.1%} > corte {p.pd_maxima:.1%}"],
            )

        # 4) Teto de parcela e valor máximo
        parcela_max = w.margem_disponivel
        return CreditDecision(
            status=DecisionStatus.APPROVED, pd=pd, score=score,
            parcela_maxima=parcela_max, valor_maximo=0.0,  # preenchido no pricing
            reasons=["Aprovado"],
        )
