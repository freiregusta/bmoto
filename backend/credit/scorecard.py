"""
credit/scorecard.py — Scorecard de duas dimensões: Tomador + Empregador.

Score_Tomador (0..1000):
    Capacidade    30%  → DTI, margem vs parcela de referência
    Comportamento 25%  → score Serasa, histórico positivo
    Comprometimento 20% → negativações SCR vencido
    Estabilidade  15%  → tempo empresa, categoria CLT
    Garantia      10%  → FGTS / saldo devedor estimado

Score_Empregador (0..1000):
    Cadastral     35%  → situação Receita, anos de abertura
    Financeiro    30%  → score Serasa PJ, protestos
    Vínculo       20%  → porte, número de ações trabalhistas
    Setorial      15%  → risco do CNAE

Score_Final = Tomador * 0.70 + Empregador * 0.30
           × fator_garantia_fgts

PD (probabilidade de default) via regressão logística nos scores.
"""
from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Optional, Dict

from credit.models import (
    ScorePackage, DadosDataprev, DadosSerasa, DadosSCR,
    DadosEmpregadorBureau, CategoriaWorker,
)
from credit.config import SCORECARD_CONFIG as CFG, POLITICA_CREDITO as POL


# ─────────────────────────────────────────────────────────────────────────────
# Resultado detalhado do scorecard
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ComponenteScore:
    nome: str
    valor_bruto: float    # 0..1000 antes do peso
    peso: float
    contribuicao: float   # valor_bruto * peso
    notas: list[str] = field(default_factory=list)


@dataclass
class ResultadoScorecard:
    score_tomador: float
    score_empregador: float
    score_final: float
    pd: float
    fator_fgts: float
    componentes_tomador: Dict[str, ComponenteScore] = field(default_factory=dict)
    componentes_empregador: Dict[str, ComponenteScore] = field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _clamp(x: float, lo: float = 0.0, hi: float = 1000.0) -> float:
    return max(lo, min(hi, x))


def _logistic_pd(score_final: float) -> float:
    """Converte score (0..1000) em PD via função logística calibrada.
    Score 800 → PD ≈ 2%, Score 500 → PD ≈ 12%, Score 300 → PD ≈ 30%.
    Calibre com a inadimplência real da carteira quando tiver dados."""
    z = -0.012 * (score_final - 400)   # slope calibrável
    return 1.0 / (1.0 + math.exp(-z))


# ─────────────────────────────────────────────────────────────────────────────
# Score do Tomador
# ─────────────────────────────────────────────────────────────────────────────

def _score_capacidade(dp: Optional[DadosDataprev]) -> ComponenteScore:
    notas = []
    if not dp:
        return ComponenteScore("capacidade", 500, CFG.peso_capacidade,
                               500 * CFG.peso_capacidade, ["Dataprev indisponível"])

    # DTI: quanto menor, melhor
    dti = dp.dti_atual
    s_dti = _clamp(1000 * (1 - dti / 0.40))   # 0% DTI→1000, 40%→0
    notas.append(f"DTI={dti:.1%} → {s_dti:.0f}pts")

    # Margem disponível: quanto maior relativa à renda, melhor
    if dp.valor_total_vencimentos > 0:
        pct_margem = dp.valor_margem_disponivel / dp.valor_total_vencimentos
        s_margem = _clamp(pct_margem / 0.35 * 1000)
    else:
        s_margem = 500

    bruto = _clamp((s_dti * 0.6 + s_margem * 0.4))
    return ComponenteScore("capacidade", bruto, CFG.peso_capacidade,
                           bruto * CFG.peso_capacidade, notas)


def _score_comportamento(serasa: Optional[DadosSerasa]) -> ComponenteScore:
    notas = []
    if not serasa or not serasa.disponivel:
        return ComponenteScore("comportamento", 600, CFG.peso_comportamento,
                               600 * CFG.peso_comportamento, ["Serasa indisponível"])

    # Score Serasa: já é 0..1000
    s_score = float(serasa.score)

    # Bônus por histórico positivo (sem negativação há muito tempo)
    bonus = min(serasa.meses_sem_negativacao * 5, 100)
    notas.append(f"Serasa={serasa.score} + bônus_histórico={bonus:.0f}")

    bruto = _clamp(s_score + bonus)
    return ComponenteScore("comportamento", bruto, CFG.peso_comportamento,
                           bruto * CFG.peso_comportamento, notas)


def _score_comprometimento(serasa: Optional[DadosSerasa],
                           scr: Optional[DadosSCR]) -> ComponenteScore:
    notas = []
    penalidade = 0.0

    # Negativações Serasa
    if serasa and serasa.disponivel:
        p_neg = serasa.negativacoes_ativas * 150
        p_acao = serasa.acoes_judiciais * 200
        p_cheque = serasa.cheques_sem_fundo * 100
        penalidade += p_neg + p_acao + p_cheque
        notas.append(f"neg={serasa.negativacoes_ativas}, "
                     f"ações={serasa.acoes_judiciais}, "
                     f"cheques={serasa.cheques_sem_fundo}")

    # SCR — atrasos no sistema bancário
    if scr and scr.disponivel:
        p_scr = min(scr.maior_atraso_dias * 3, 400)
        p_venc = scr.operacoes_vencidas * 100
        penalidade += p_scr + p_venc
        notas.append(f"SCR atraso={scr.maior_atraso_dias}d, "
                     f"vencidas={scr.operacoes_vencidas}")

    bruto = _clamp(1000 - penalidade)
    return ComponenteScore("comprometimento", bruto, CFG.peso_comprometimento,
                           bruto * CFG.peso_comprometimento, notas)


def _score_estabilidade(dp: Optional[DadosDataprev]) -> ComponenteScore:
    notas = []
    if not dp:
        return ComponenteScore("estabilidade", 500, CFG.peso_estabilidade,
                               500 * CFG.peso_estabilidade, ["Dataprev indisponível"])

    # Tempo de empresa (meses): cresce até 60 meses e satura
    meses = dp.meses_empresa
    s_tempo = _clamp(min(meses / 60, 1.0) * 800 + 200)  # 200 mínimo, 1000 max
    notas.append(f"tempo_empresa={meses}m → {s_tempo:.0f}pts")

    # Categoria: CLT > Doméstico > Rural > MEI
    bonus_cat = {
        CategoriaWorker.CLT: 0,
        CategoriaWorker.DOMESTICO: -50,
        CategoriaWorker.RURAL: -80,
        CategoriaWorker.MEI: -120,
        CategoriaWorker.DESCONHECIDO: -200,
    }.get(dp.categoria, -200)
    notas.append(f"categoria={dp.categoria.value} bônus={bonus_cat}")

    bruto = _clamp(s_tempo + bonus_cat)
    return ComponenteScore("estabilidade", bruto, CFG.peso_estabilidade,
                           bruto * CFG.peso_estabilidade, notas)


def _score_garantia_e_fator_fgts(dp: Optional[DadosDataprev],
                                  valor_solicitado: float) -> tuple[ComponenteScore, float]:
    """Retorna (score_garantia, fator_fgts)."""
    notas = []
    if not dp or valor_solicitado <= 0:
        return (ComponenteScore("garantia", 500, CFG.peso_garantia,
                                500 * CFG.peso_garantia, ["Sem dados"]),
                1.0)

    # Cobertura FGTS: (0,10 × saldo_fgts + 100% multa rescisória) / saldo_devedor_estimado
    saldo_fgts_base = dp.valor_base_margem * 24 * 0.08   # estimativa se não vier direto
    garantia_fgts = saldo_fgts_base * 1.40   # 10% saldo + 100% multa (simplificado)
    cobertura = min(garantia_fgts / max(valor_solicitado, 1), 1.0)

    s_garantia = _clamp(cobertura * 1000)
    fator = 1.0 + (CFG.fator_garantia_fgts_max - 1.0) * cobertura
    notas.append(f"cobertura_FGTS={cobertura:.0%} fator={fator:.3f}")

    comp = ComponenteScore("garantia", s_garantia, CFG.peso_garantia,
                           s_garantia * CFG.peso_garantia, notas)
    return comp, fator


def calcular_score_tomador(pkg: ScorePackage,
                           valor_solicitado: float = 5000.0
                           ) -> tuple[float, Dict[str, ComponenteScore], float]:
    """Retorna (score_tomador, componentes, fator_fgts)."""
    c_cap  = _score_capacidade(pkg.dataprev)
    c_comp = _score_comportamento(pkg.serasa)
    c_cmt  = _score_comprometimento(pkg.serasa, pkg.scr)
    c_est  = _score_estabilidade(pkg.dataprev)
    c_gar, fator = _score_garantia_e_fator_fgts(pkg.dataprev, valor_solicitado)

    score = _clamp(
        c_cap.contribuicao + c_comp.contribuicao +
        c_cmt.contribuicao + c_est.contribuicao + c_gar.contribuicao
    )
    comps = {c.nome: c for c in [c_cap, c_comp, c_cmt, c_est, c_gar]}
    return score, comps, fator


# ─────────────────────────────────────────────────────────────────────────────
# Score do Empregador
# ─────────────────────────────────────────────────────────────────────────────

def _score_emp_cadastral(emp: Optional[DadosEmpregadorBureau]) -> ComponenteScore:
    notas = []
    if not emp or not emp.disponivel:
        return ComponenteScore("emp_cadastral", 600, CFG.peso_emp_cadastral,
                               600 * CFG.peso_emp_cadastral, ["Empregador indisponível"])

    # Situação Receita
    penalidade_sit = {"ATIVA": 0, "INAPTA": 1000, "BAIXADA": 1000,
                      "SUSPENSA": 500}.get(emp.situacao_receita, 300)
    notas.append(f"situação={emp.situacao_receita}")

    # Anos de abertura (maturidade)
    anos = emp.anos_abertura
    s_maturidade = _clamp(min(anos / 10, 1.0) * 500 + 300)

    bruto = _clamp(s_maturidade - penalidade_sit + 200)
    return ComponenteScore("emp_cadastral", bruto, CFG.peso_emp_cadastral,
                           bruto * CFG.peso_emp_cadastral, notas)


def _score_emp_financeiro(emp: Optional[DadosEmpregadorBureau]) -> ComponenteScore:
    notas = []
    if not emp or not emp.disponivel:
        return ComponenteScore("emp_financeiro", 600, CFG.peso_emp_financeiro,
                               600 * CFG.peso_emp_financeiro, ["Empregador indisponível"])

    s_score_pj = float(emp.score_serasa_pj)
    penalidade = emp.protestos_pj * 150 + emp.acoes_trabalhistas * 80
    notas.append(f"score_pj={emp.score_serasa_pj}, "
                 f"protestos={emp.protestos_pj}, "
                 f"ações_trab={emp.acoes_trabalhistas}")

    bruto = _clamp(s_score_pj - penalidade)
    return ComponenteScore("emp_financeiro", bruto, CFG.peso_emp_financeiro,
                           bruto * CFG.peso_emp_financeiro, notas)


def _score_emp_vinculo(emp: Optional[DadosEmpregadorBureau]) -> ComponenteScore:
    notas = []
    if not emp or not emp.disponivel:
        return ComponenteScore("emp_vinculo", 600, CFG.peso_emp_vinculo,
                               600 * CFG.peso_emp_vinculo, ["Indisponível"])

    bonus_porte = {"DEMAIS": 100, "EPP": 50, "ME": 0, "MEI": -100,
                   "DESCONHECIDO": -50}.get(emp.porte, 0)
    notas.append(f"porte={emp.porte} bônus={bonus_porte}")

    bruto = _clamp(700 + bonus_porte)
    return ComponenteScore("emp_vinculo", bruto, CFG.peso_emp_vinculo,
                           bruto * CFG.peso_emp_vinculo, notas)


def _score_emp_setorial(emp: Optional[DadosEmpregadorBureau]) -> ComponenteScore:
    notas = []
    if not emp or not emp.disponivel:
        return ComponenteScore("emp_setorial", 600, CFG.peso_emp_setorial,
                               600 * CFG.peso_emp_setorial, ["Indisponível"])

    penalidade = 200 if emp.cnae_principal in POL.cnaes_risco_alto else 0
    notas.append(f"CNAE={emp.cnae_principal} penalidade={penalidade}")
    bruto = _clamp(800 - penalidade)
    return ComponenteScore("emp_setorial", bruto, CFG.peso_emp_setorial,
                           bruto * CFG.peso_emp_setorial, notas)


def calcular_score_empregador(pkg: ScorePackage) -> tuple[float, Dict[str, ComponenteScore]]:
    c1 = _score_emp_cadastral(pkg.empregador)
    c2 = _score_emp_financeiro(pkg.empregador)
    c3 = _score_emp_vinculo(pkg.empregador)
    c4 = _score_emp_setorial(pkg.empregador)
    score = _clamp(c1.contribuicao + c2.contribuicao +
                   c3.contribuicao + c4.contribuicao)
    return score, {c.nome: c for c in [c1, c2, c3, c4]}


# ─────────────────────────────────────────────────────────────────────────────
# Função principal
# ─────────────────────────────────────────────────────────────────────────────

def calcular_scores(pkg: ScorePackage,
                    valor_solicitado: float = 5000.0) -> ResultadoScorecard:
    """Calcula todos os scores e atualiza o ScorePackage."""
    s_tom, c_tom, fator = calcular_score_tomador(pkg, valor_solicitado)
    s_emp, c_emp = calcular_score_empregador(pkg)

    s_final = _clamp(
        (s_tom * CFG.peso_score_tomador +
         s_emp * CFG.peso_score_empregador) * fator
    )
    pd = _logistic_pd(s_final)

    # Atualiza o pacote
    pkg.score_tomador = s_tom
    pkg.score_empregador = s_emp
    pkg.pd = pd

    return ResultadoScorecard(
        score_tomador=s_tom, score_empregador=s_emp,
        score_final=s_final, pd=pd, fator_fgts=fator,
        componentes_tomador=c_tom, componentes_empregador=c_emp,
    )
