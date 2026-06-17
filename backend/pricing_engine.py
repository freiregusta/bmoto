"""
pricing_engine.py — Motor de precificação (risk-based, cost-plus).

Constrói a taxa nominal mensal somando componentes configuráveis:
    taxa_am = funding + opex + EL_mensal + tax + margem_alvo
onde EL_mensal é a perda esperada (PD×LGD, líquida de garantia FGTS) amortizada
no prazo. Em seguida:
  - dimensiona principal financiado, parcela, IOF e seguro;
  - calcula o CET (IRR do fluxo do tomador);
  - aplica o TETO REGULATÓRIO: CET mensal ≤ taxa mensal + 1 p.p.
    (Resolução do Comitê Gestor das Operações de Crédito Consignado, abr/2026).
"""
from __future__ import annotations
from typing import Optional

from models import (WorkerData, CreditRequest, CreditDecision, PricingResult,
                    Proposal)
from config import PricingParams, DEFAULT_PRICING
import finance


class PricingEngine:
    def __init__(self, params: PricingParams = DEFAULT_PRICING):
        self.p = params

    # ----------------------------------------------------- taxa risk-based
    def _expected_loss_monthly(self, pd: float, w: WorkerData,
                               ead: float, n: int) -> float:
        """Add-on mensal de perda esperada.
        Se PricingParams.el_lifetime_pct estiver definido, usa-o como EL de vida
        (% do principal) e espalha no prazo. Caso contrário, deriva de PD×LGD
        líquido da garantia FGTS."""
        if self.p.el_lifetime_pct is not None:
            return self.p.el_lifetime_pct / n
        garantia = min(w.fgts_garantia, ead)
        ead_liq = max(ead - garantia, 0.0)
        lgd_efetivo = self.p.lgd * (ead_liq / ead if ead > 0 else 1.0)
        el_pct = pd * lgd_efetivo                       # % do principal (vida)
        return el_pct / n                               # espalha no prazo

    def rate(self, decision: CreditDecision, w: WorkerData, ead: float,
             n: int) -> tuple[float, dict]:
        el_m = self._expected_loss_monthly(decision.pd, w, ead, n)
        comp = {
            "funding": self.p.funding_am,
            "opex": self.p.opex_am,
            "perda_esperada": el_m,
            "impostos": self.p.tax_am,
            "margem_alvo": self.p.margem_alvo_am,
        }
        taxa = sum(comp.values())
        taxa = max(self.p.taxa_min_am, min(taxa, self.p.taxa_max_am))
        comp["taxa_am_final"] = taxa
        return taxa, comp

    # ----------------------------------------------------- dimensionamento
    def price(self, req: CreditRequest, decision: CreditDecision) -> PricingResult:
        w = req.worker
        n = req.prazo_meses
        ead_base = max(w.renda_liquida, 1.0)
        taxa, comp = self.rate(decision, w, ead_base, n)

        # Modo do valor: solicitado (limitado por margem) ou máximo pela margem.
        parcela_cap = decision.parcela_maxima  # = margem disponível
        if req.valor_solicitado is None:
            # Maximiza o liberado sob a parcela = margem (iteração p/ IOF/seguro).
            principal_fin = finance.principal_from_pmt(parcela_cap, taxa, n)
            for _ in range(25):
                iof = finance.iof_credito_pf(principal_fin, taxa, n, self.p.dias_por_periodo)
                seguro = self.p.seguro_pct * principal_fin
                liberado = principal_fin - iof - seguro
                # reprojeta principal para manter parcela = cap
                principal_fin = finance.principal_from_pmt(parcela_cap, taxa, n)
                if liberado <= 0:
                    break
            parcela = finance.pmt(principal_fin, taxa, n)
        else:
            liberado = req.valor_solicitado
            # principal financiado = liberado + IOF + seguro (financiados) -> itera
            principal_fin = liberado
            for _ in range(25):
                iof = finance.iof_credito_pf(principal_fin, taxa, n, self.p.dias_por_periodo)
                seguro = self.p.seguro_pct * principal_fin
                novo = liberado + iof + seguro
                if abs(novo - principal_fin) < 0.01:
                    principal_fin = novo
                    break
                principal_fin = novo
            parcela = finance.pmt(principal_fin, taxa, n)

        iof = finance.iof_credito_pf(principal_fin, taxa, n, self.p.dias_por_periodo)
        seguro = self.p.seguro_pct * principal_fin
        liberado = principal_fin - iof - seguro
        parcela = finance.pmt(principal_fin, taxa, n)

        cet_m = finance.cet_mensal(liberado, parcela, n)
        cet_a = finance.cet_anual(cet_m)

        notes = []
        feasible = True
        # Restrição de margem
        if parcela > parcela_cap + 1e-6:
            feasible = False
            notes.append("Parcela acima da margem disponível")
        # TETO REGULATÓRIO: CET mensal ≤ taxa mensal + 1 p.p.
        if cet_m > taxa + self.p.cet_spread_max_pp + 1e-9:
            feasible = False
            notes.append(
                f"CET {cet_m:.3%} a.m. excede teto (taxa {taxa:.3%} + "
                f"{self.p.cet_spread_max_pp:.0%} p.p.) — reduza IOF/seguro embutidos"
            )

        return PricingResult(
            liberado=liberado, principal_financiado=principal_fin, parcela=parcela,
            prazo_meses=n, taxa_am=taxa, taxa_aa=finance.aa_from_am(taxa),
            iof=iof, seguro=seguro, cet_am=cet_m, cet_aa=cet_a,
            componentes=comp, feasible=feasible, notes=notes,
        )

    # ----------------------------------------------------- monta a oferta
    def build_proposal(self, req: CreditRequest, pricing: PricingResult,
                       entry_url: str = "") -> Proposal:
        return Proposal(
            proposal_id=req.proposal_id,
            installment_quantity=pricing.prazo_meses,
            installment_amount=pricing.parcela,
            available_balance=req.worker.margem_disponivel,
            amount=pricing.liberado,
            iof=pricing.iof,
            annual_tax=pricing.taxa_aa,
            cet=pricing.cet_aa,
            interest_tax=pricing.taxa_am,
            monthly_cet=pricing.cet_am,
            insurance_amount=pricing.seguro,
            entry_url=entry_url,
        )
