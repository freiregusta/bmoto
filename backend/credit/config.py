"""
credit/config.py — Painel de controle dos bureaus e parâmetros do scorecard.

É AQUI que você liga/desliga bureaus sem tocar no motor.
Troque USE_MOCK = False em produção para usar os adapters reais.
"""
from __future__ import annotations
import os
from dataclasses import dataclass, field
from typing import Set


# ─────────────────────────────────────────────────────────────────────────────
# Feature flags de bureaus
# ─────────────────────────────────────────────────────────────────────────────

USE_MOCK = os.environ.get("CREDIT_USE_MOCK", "true").lower() == "true"

BUREAUS_ATIVOS: Set[str] = {
    "dataprev",      # sempre obrigatório
    "scr",           # sempre obrigatório (Res. BCB 4.571/2017)
    "serasa_pf",     # core
    "empregador",    # core para consignado
    # "quod_pf",     # descomente quando contratar
    # "boa_vista",   # descomente quando contratar
    # "open_finance",# descomente quando contratar
}

# Bureaus cuja indisponibilidade bloqueia a oferta
BUREAUS_OBRIGATORIOS: Set[str] = {"dataprev", "scr"}

# Timeout individual por bureau (segundos)
BUREAU_TIMEOUT_S: float = float(os.environ.get("BUREAU_TIMEOUT_S", "4.0"))

# Latência simulada no mock (dev)
MOCK_LATENCIA_S: float = 0.05
MOCK_PROB_TIMEOUT: float = 0.0   # 0 = nunca; 0.1 = 10% das consultas


# ─────────────────────────────────────────────────────────────────────────────
# Parâmetros do scorecard
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ScorecardConfig:
    # ── Score do Tomador (0..1000) ──────────────────────────────────────────
    # Pesos das dimensões (somam 1.0)
    peso_capacidade:      float = 0.30   # DTI, margem vs parcela
    peso_comportamento:   float = 0.25   # score Serasa, histórico positivo
    peso_comprometimento: float = 0.20   # negativações, SCR vencido
    peso_estabilidade:    float = 0.15   # tempo empresa, categoria
    peso_garantia:        float = 0.10   # FGTS vs saldo devedor

    # ── Score do Empregador (0..1000) ────────────────────────────────────────
    peso_emp_cadastral:   float = 0.35   # situação Receita, tempo abertura
    peso_emp_financeiro:  float = 0.30   # score Serasa PJ, protestos
    peso_emp_vinculo:     float = 0.20   # porte, setor, estabilidade
    peso_emp_setorial:    float = 0.15   # risco do CNAE

    # ── Combinação final ─────────────────────────────────────────────────────
    peso_score_tomador:    float = 0.70
    peso_score_empregador: float = 0.30

    # Bônus por cobertura FGTS: 1.0 (sem cobertura) → 1.15 (cobertura ≥ 80%)
    fator_garantia_fgts_max: float = 1.15


@dataclass
class PoliticaCredito:
    # ── Cortes duros (qualquer um reprova imediatamente) ─────────────────────
    bloquear_pep:                bool  = True
    bloquear_inelegivel:         bool  = True    # Dataprev marcou inelegível
    bloquear_aviso_previo:       bool  = True    # risco iminente de desligamento
    bloquear_empregador_inapto:  bool  = True    # Receita: INAPTA ou BAIXADA
    bloquear_superendividado:    bool  = True    # tem consignado ativo (CT)

    # ── Limites numéricos ────────────────────────────────────────────────────
    score_minimo_tomador:    float = 400.0
    score_minimo_empregador: float = 350.0
    pd_maxima:               float = 0.18        # 18% PD → reprova

    atraso_maximo_dias_scr:  int   = 60          # SCR: maior atraso nos 12m
    negativacoes_maximas:    int   = 0           # Serasa: zero tolerância
    dti_maximo:              float = 0.40        # 40% comprometimento total

    meses_empresa_minimo:    int   = 6
    margem_minima:           float = 50.0        # R$ mínimos de margem

    # Prazo máximo por categoria
    prazo_max_clt:           int   = 96
    prazo_max_domestico:     int   = 72
    prazo_max_rural:         int   = 60
    prazo_max_mei:           int   = 48

    # CNAEs de risco elevado (peso extra de risco no score do empregador)
    cnaes_risco_alto: set = field(default_factory=lambda: {
        "5611201",  # restaurantes e similares (alta rotatividade)
        "4781400",  # vestuário (sazonalidade)
        "1811301",  # gráficas (setor em declínio)
    })


SCORECARD_CONFIG = ScorecardConfig()
POLITICA_CREDITO = PoliticaCredito()
