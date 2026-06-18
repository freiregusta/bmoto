"""
credit/decision_engine.py — Motor de decisão de crédito.

Sequência:
  1. Cortes duros (política): PEP, inelegível, aviso prévio,
     empregador irregular, superendividamento.
  2. Thresholds de score e PD.
  3. Cálculo do envelope de crédito (parcela máxima, valor, prazo).
"""
from __future__ import annotations

from credit.models import (
    ScorePackage, DecisaoCreditoV2, DecisaoStatus, MotivoRecusa,
    CategoriaWorker,
)
from credit.scorecard import ResultadoScorecard
from credit.config import POLITICA_CREDITO as POL


def decidir(pkg: ScorePackage, resultado: ResultadoScorecard,
            valor_solicitado: float = 5000.0,
            prazo_solicitado: int = 24) -> DecisaoCreditoV2:
    motivos: list[MotivoRecusa] = []

    # ── 1. Cortes duros ──────────────────────────────────────────────────────
    if pkg.pep and POL.bloquear_pep:
        motivos.append(MotivoRecusa("PEP001", "Pessoa Exposta Politicamente", "dataprev"))

    if pkg.inelegivel and POL.bloquear_inelegivel:
        motivos.append(MotivoRecusa(
            "ELEG001",
            pkg.dataprev.motivo_inelegibilidade or "Tomador inelegível na plataforma",
            "dataprev",
        ))

    if pkg.aviso_previo and POL.bloquear_aviso_previo:
        motivos.append(MotivoRecusa("EMP001", "Tomador em aviso prévio", "dataprev"))

    if pkg.empregador_irregular and POL.bloquear_empregador_inapto:
        sit = pkg.empregador.situacao_receita if pkg.empregador else "DESCONHECIDA"
        motivos.append(MotivoRecusa(
            "PJ001", f"Empregador com situação irregular na Receita ({sit})", "empregador"
        ))

    if pkg.superendividado and POL.bloquear_superendividado:
        motivos.append(MotivoRecusa(
            "SUPER001",
            "Tomador com consignado ativo e sem margem disponível",
            "dataprev",
        ))

    # Bureaus obrigatórios indisponíveis
    for bureau in pkg.bureaus_indisponiveis:
        if bureau in ("dataprev", "scr"):
            motivos.append(MotivoRecusa(
                "BUREAU001", f"Bureau obrigatório {bureau} indisponível", bureau
            ))

    # Margem mínima
    if pkg.dataprev and pkg.dataprev.valor_margem_disponivel < POL.margem_minima:
        motivos.append(MotivoRecusa(
            "MARG001",
            f"Margem disponível R$ {pkg.dataprev.valor_margem_disponivel:.0f} "
            f"abaixo do mínimo R$ {POL.margem_minima:.0f}",
            "dataprev",
        ))

    # Tempo de empresa
    meses = pkg.dataprev.meses_empresa if pkg.dataprev else 0
    if meses < POL.meses_empresa_minimo:
        motivos.append(MotivoRecusa(
            "EST001",
            f"Tempo de empresa {meses} meses (mínimo {POL.meses_empresa_minimo})",
            "dataprev",
        ))

    # SCR — maior atraso
    if pkg.scr and pkg.scr.disponivel:
        if pkg.scr.maior_atraso_dias > POL.atraso_maximo_dias_scr:
            motivos.append(MotivoRecusa(
                "SCR001",
                f"Histórico de atraso {pkg.scr.maior_atraso_dias} dias (máx {POL.atraso_maximo_dias_scr})",
                "scr",
            ))

    # Negativações
    if pkg.serasa and pkg.serasa.disponivel:
        if pkg.serasa.negativacoes_ativas > POL.negativacoes_maximas:
            motivos.append(MotivoRecusa(
                "NEG001",
                f"{pkg.serasa.negativacoes_ativas} negativação(ões) ativa(s)",
                "serasa",
            ))

    if motivos:
        return DecisaoCreditoV2(
            status=DecisaoStatus.REPROVADO,
            score_package=pkg,
            motivos=motivos,
        )

    # ── 2. Thresholds de score e PD ──────────────────────────────────────────
    if resultado.score_tomador < POL.score_minimo_tomador:
        return DecisaoCreditoV2(
            status=DecisaoStatus.REPROVADO, score_package=pkg,
            motivos=[MotivoRecusa(
                "SCORE001",
                f"Score tomador {resultado.score_tomador:.0f} < mínimo {POL.score_minimo_tomador:.0f}"
            )],
        )

    if resultado.score_empregador < POL.score_minimo_empregador:
        return DecisaoCreditoV2(
            status=DecisaoStatus.REPROVADO, score_package=pkg,
            motivos=[MotivoRecusa(
                "SCORE002",
                f"Score empregador {resultado.score_empregador:.0f} < mínimo {POL.score_minimo_empregador:.0f}"
            )],
        )

    if resultado.pd > POL.pd_maxima:
        return DecisaoCreditoV2(
            status=DecisaoStatus.REPROVADO, score_package=pkg,
            motivos=[MotivoRecusa(
                "PD001",
                f"PD {resultado.pd:.1%} acima do limite {POL.pd_maxima:.1%}"
            )],
        )

    # ── 3. Envelope de crédito ───────────────────────────────────────────────
    dp = pkg.dataprev
    parcela_max = dp.valor_margem_disponivel if dp else 0.0

    # Prazo máximo por categoria
    prazo_max_map = {
        CategoriaWorker.CLT:       POL.prazo_max_clt,
        CategoriaWorker.DOMESTICO: POL.prazo_max_domestico,
        CategoriaWorker.RURAL:     POL.prazo_max_rural,
        CategoriaWorker.MEI:       POL.prazo_max_mei,
    }
    cat = dp.categoria if dp else CategoriaWorker.CLT
    prazo_max = prazo_max_map.get(cat, POL.prazo_max_clt)
    prazo_aprovado = min(prazo_solicitado, prazo_max)

    obs = []
    if prazo_solicitado > prazo_max:
        obs.append(f"Prazo reduzido para {prazo_max}x (máximo para {cat.value})")

    if pkg.bureaus_indisponiveis:
        obs.append(f"Bureaus opcionais indisponíveis: {', '.join(pkg.bureaus_indisponiveis)}")

    return DecisaoCreditoV2(
        status=DecisaoStatus.APROVADO,
        score_package=pkg,
        parcela_maxima=parcela_max,
        valor_maximo=0.0,     # preenchido pelo pricing após calcular a taxa
        prazo_maximo=prazo_aprovado,
        observacoes=obs,
    )
