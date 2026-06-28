"""
config.py — Parâmetros de política e de precificação.

É AQUI que você pluga seus inputs. Tudo abaixo tem default plausível para o
Crédito do Trabalhador em 2026; substitua pelos números do Fibra / da sua asset.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Optional


# ----------------------------------------------------------------------------- 
# Política de crédito
# -----------------------------------------------------------------------------
@dataclass
class CreditPolicy:
    idade_min: int = 18
    idade_max: int = 75                  # idade + prazo não pode estourar
    idade_mais_prazo_max: int = 80
    meses_empresa_min: int = 6           # tempo mínimo de vínculo
    margem_minima: float = 30.0          # R$ mínimos de margem p/ ofertar
    dti_maximo: float = 0.45             # comprometimento de renda total máx.
    pd_maxima: float = 0.18              # corte de PD para aprovação
    # Bloqueio anti-superendividamento: não ofertar se já há consignado ativo
    bloquear_se_consignado_ativo: bool = True
    prazo_min: int = 1
    prazo_max: int = 96


# ----------------------------------------------------------------------------- 
# Scorecard (logístico) — PD = 1 / (1 + e^-(b0 + Σ bi·xi))
#   Substitua pelos coeficientes do seu modelo. Features normalizadas abaixo.
# -----------------------------------------------------------------------------
@dataclass
class Scorecard:
    intercept: float = -3.60
    coef: Dict[str, float] = field(default_factory=lambda: {
        "dti": 2.50,                 # comprometimento de renda (0..1)
        "ltv_margem": 0.40,          # parcela/margem (0..1)
        "tempo_empresa_inv": 2.00,   # 1/(meses+1), proxy de instabilidade
        "idade_norm": -0.70,         # (idade-18)/57, mais velho -> menor PD
        "vinculo_nao_clt": 0.50,     # 1 se não-CLT
        "fgts_cobertura_inv": 0.60,  # 1 - min(garantia/EAD,1): menos garantia -> maior PD
    })


# ----------------------------------------------------------------------------- 
# Precificação (cost-plus) — todas as componentes em % ao mês (decimal)
# -----------------------------------------------------------------------------
@dataclass
class PricingParams:
    # Custo de funding mensal (ex.: CDI/compromissada/cota sênior do FIDC).
    funding_am: float = 0.0127           # 1,27% a.m.
    # Spread operacional/opex amortizado.
    opex_am: float = 0.0020              # 0,20% a.m.
    # Margem-alvo (retorno da subordinada / lucro do originador).
    margem_alvo_am: float = 0.0035       # 0,35% a.m.
    # Impostos sobre o spread (PIS/COFINS/ISS aprox., como add-on simplificado).
    tax_am: float = 0.0010
    # Perda esperada: se definida, entra DIRETO como premissa (vida do contrato,
    # % do principal) e é espalhada no prazo. Se None, é derivada de PD×LGD.
    el_lifetime_pct: Optional[float] = None   # None = perda derivada de PD x LGD (risk-based)
    # Perda esperada (EL = PD×LGD) é convertida em add-on mensal pelo motor.
    lgd: float = 0.55                    # severidade após garantia FGTS (path derivado)
    # Piso e teto de taxa nominal mensal ofertável.
    taxa_min_am: float = 0.012
    taxa_max_am: float = 0.035
    # Seguro prestamista financiado (% sobre o principal). 0 desliga.
    seguro_pct: float = 0.05             # 5% sobre o principal financiado
    # Teto absoluto do prêmio de seguro prestamista (R$).
    seguro_cap: float = 299.0
    # Teto regulatório (Resolução do Comitê Gestor, abr/2026):
    #   CET mensal não pode exceder a taxa de juros mensal em mais de 1 p.p.
    cet_spread_max_pp: float = 0.01      # 1 ponto percentual
    dias_por_periodo: int = 30


DEFAULT_POLICY = CreditPolicy()
DEFAULT_SCORECARD = Scorecard()
DEFAULT_PRICING = PricingParams()
