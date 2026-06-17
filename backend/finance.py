"""
finance.py — Núcleo de matemática financeira (sem dependências externas).

Convenções:
- Taxas mensais em forma decimal (0.018 = 1,80% a.m.), salvo indicação.
- "principal financiado" = valor que de fato rende juros (líquido + IOF + seguro
  quando financiados na operação).
- "liberado" = valor que cai na conta do tomador.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List


# ----------------------------------------------------------------------------- 
# Price (Tabela Price) — parcela e cronograma
# -----------------------------------------------------------------------------
def pmt(principal: float, i_monthly: float, n: int) -> float:
    """Parcela fixa (Tabela Price). i_monthly em decimal."""
    if n <= 0:
        raise ValueError("n deve ser > 0")
    if abs(i_monthly) < 1e-12:
        return principal / n
    f = (1 + i_monthly) ** n
    return principal * i_monthly * f / (f - 1)


def principal_from_pmt(parcela: float, i_monthly: float, n: int) -> float:
    """Principal que gera a parcela dada (inverso do PMT). Usado p/ maximizar
    o valor sob restrição de margem."""
    if abs(i_monthly) < 1e-12:
        return parcela * n
    f = (1 + i_monthly) ** n
    return parcela * (f - 1) / (i_monthly * f)


@dataclass
class AmortRow:
    period: int
    days: int            # dias corridos desde a liberação até o vencimento
    opening: float
    interest: float
    principal: float
    payment: float
    closing: float


def amortization_schedule(principal: float, i_monthly: float, n: int,
                          days_per_period: int = 30) -> List[AmortRow]:
    """Cronograma Price. days acumula para o cálculo de IOF diário."""
    parcela = pmt(principal, i_monthly, n)
    rows: List[AmortRow] = []
    bal = principal
    for k in range(1, n + 1):
        juros = bal * i_monthly
        amort = parcela - juros
        closing = bal - amort
        rows.append(AmortRow(
            period=k, days=k * days_per_period, opening=bal,
            interest=juros, principal=amort, payment=parcela,
            closing=max(closing, 0.0),
        ))
        bal = closing
    return rows


# ----------------------------------------------------------------------------- 
# IOF — pessoa física, crédito (regra vigente)
#   IOF diário: 0,0082% a.d. sobre a parcela de principal, limitado a 365 dias
#   IOF adicional: 0,38% sobre o valor total da operação (principal)
# -----------------------------------------------------------------------------
IOF_DIARIO = 0.000082      # 0,0082% ao dia
IOF_ADICIONAL = 0.0038     # 0,38% fixo
IOF_DIAS_MAX = 365


def iof_credito_pf(principal: float, i_monthly: float, n: int,
                   days_per_period: int = 30) -> float:
    """IOF total da operação, somando a parcela diária (limitada a 365 dias por
    fração de principal) e o adicional fixo."""
    sched = amortization_schedule(principal, i_monthly, n, days_per_period)
    iof_diario = sum(
        row.principal * IOF_DIARIO * min(row.days, IOF_DIAS_MAX)
        for row in sched
    )
    iof_adicional = principal * IOF_ADICIONAL
    return iof_diario + iof_adicional


# ----------------------------------------------------------------------------- 
# CET — taxa interna de retorno do fluxo do tomador
# -----------------------------------------------------------------------------
def _npv(rate: float, cashflows: List[float]) -> float:
    return sum(cf / (1 + rate) ** t for t, cf in enumerate(cashflows))


def irr(cashflows: List[float], lo: float = -0.9999, hi: float = 5.0,
        tol: float = 1e-10, max_iter: int = 200) -> float:
    """IRR por bisseção. cashflows[0] tipicamente positivo (entrada de caixa
    do tomador), seguido de saídas negativas (parcelas)."""
    f_lo, f_hi = _npv(lo, cashflows), _npv(hi, cashflows)
    if f_lo * f_hi > 0:
        # tenta expandir o teto
        hi2 = hi
        for _ in range(60):
            hi2 *= 1.5
            if _npv(lo, cashflows) * _npv(hi2, cashflows) <= 0:
                hi = hi2
                break
        else:
            raise ValueError("IRR não convergiu (sem mudança de sinal)")
    for _ in range(max_iter):
        mid = (lo + hi) / 2
        f_mid = _npv(mid, cashflows)
        if abs(f_mid) < tol:
            return mid
        if _npv(lo, cashflows) * f_mid < 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def cet_anual_res4881(liberado: float, parcela: float, n: int,
                       dias_por_periodo: int = 30) -> float:
    """CET anual pela fórmula exata da Resolução CMN 4.881/2020.

    FC0 = Σ FCj / (1 + CET)^(dj/365)
    onde dj = j × dias_por_periodo (dias corridos até o j-ésimo vencimento).
    CET expresso em taxa anual (ex: 0.3178 = 31,78% a.a.).
    """
    def npv(cet: float) -> float:
        return liberado - sum(
            parcela / (1 + cet) ** ((j * dias_por_periodo) / 365)
            for j in range(1, n + 1)
        )
    # NPV(0) < 0 sempre (tomador paga mais do que recebe); busca onde fica = 0
    lo, hi = 0.0, 50.0  # 0% a 5000% a.a. — cobre qualquer operação real
    f_lo, f_hi = npv(lo), npv(hi)
    if f_lo * f_hi > 0:
        # Fallback: expande o intervalo
        hi = 500.0
        f_hi = npv(hi)
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv(mid)
        if abs(f_mid) < 1e-8:
            return mid
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2


def cet_mensal(liberado: float, parcela: float, n: int,
               dias_por_periodo: int = 30) -> float:
    """CET mensal equivalente ao CET anual da Res. CMN 4.881/2020."""
    cet_aa = cet_anual_res4881(liberado, parcela, n, dias_por_periodo)
    return (1 + cet_aa) ** (1 / 12) - 1


def cet_anual(cet_m: float) -> float:
    return (1 + cet_m) ** 12 - 1


def aa_from_am(i_monthly: float) -> float:
    return (1 + i_monthly) ** 12 - 1
