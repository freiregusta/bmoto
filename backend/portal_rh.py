"""
portal_rh.py — Portal RH BMoto: a IF mais fácil de repassar do mercado.

Racional: 65% da inadimplência do setor é falha operacional do empregador
(Salaryfits/Serasa, dez/2025). Este módulo entrega ao RH tudo pronto:

1. Arquivo de folha por competência, já no formato de importação
   (rubrica 9253, CPF com zeros à esquerda, código da IF, valores)
2. Checklist da competência com o passo a passo DET → eSocial → FGTS Digital
3. Calendário de prazos (janela de averbação 21→20, Port. MTE 435/2025 art. 24)
4. Painel de pendências integrado ao monitor de repasses (Bia)

Endpoints (montados em api.make_app):
    GET /portal-rh/{cnpj}/competencias/{comp}/arquivo   → CSV p/ folha
    GET /portal-rh/{cnpj}/pendencias                    → pendências + aging
    GET /portal-rh/{cnpj}/checklist                     → passo a passo
    GET /portal-rh/calendario                           → prazos da competência
"""

from __future__ import annotations

import io
import csv
from datetime import date

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from repasse_monitor import MONITOR, StatusRepasse

import os

RUBRICA_CONSIGNADO = "9253"
# Código da instituição consignatária no arquivo da folha. Genérico até a
# licença de operação definir como a IF aparece no Portal do Empregador
# (COMPE, CNPJ ou ISPB). Configurável sem deploy via env CODIGO_IF.
CODIGO_IF = os.getenv("CODIGO_IF", "A_DEFINIR")


def _so_digitos(s: str) -> str:
    return "".join(c for c in s if c.isdigit())


def _cpf_formatado(cpf: str) -> str:
    """CPF com 11 dígitos, zeros à esquerda — erro clássico dos arquivos de RH."""
    return _so_digitos(cpf).zfill(11)


router = APIRouter(prefix="/portal-rh", tags=["portal-rh"])


@router.get("/calendario")
def calendario(competencia: str | None = None) -> dict:
    """Prazos da competência (janela de averbação 21→20, desconto no mês seguinte)."""
    hoje = date.today()
    comp = competencia or f"{hoje.year:04d}-{hoje.month:02d}"
    ano, mes = map(int, comp.split("-"))
    return {
        "competencia": comp,
        "janela_averbacao": {
            "inicio": f"{ano:04d}-{mes-1:02d}-21" if mes > 1 else f"{ano-1:04d}-12-21",
            "fim": f"{ano:04d}-{mes:02d}-20",
            "base_legal": "Portaria MTE 435/2025, art. 24",
        },
        "passos": [
            "Verificar notificações no DET (Domicílio Eletrônico Trabalhista)",
            "Baixar o arquivo de parcelas no Portal RH BMoto (ou Portal do Empregador)",
            f"Lançar rubrica {RUBRICA_CONSIGNADO} no eSocial (evento S-1200)",
            "Conferir o S-5003 e gerar a guia no FGTS Digital",
            "Pagar a guia até o vencimento — o repasse à IF é automático",
        ],
        "alerta": ("Empresa que retém e não repassa: regularização com juros/encargos "
                   "(Port. 435/2025 art. 28 §3º); multa de 30% + TDS (Lei 15.179/2025 art. 3º)."),
    }


@router.get("/{cnpj}/competencias/{comp}/arquivo", response_class=PlainTextResponse)
def arquivo_folha(cnpj: str, comp: str) -> str:
    """
    CSV pronto para importação na folha: uma linha por parcela da competência.
    Colunas escolhidas para minimizar retrabalho do RH (rubrica, CPF ok, IF ok).
    """
    cnpj_d = _so_digitos(cnpj)
    parcelas = [p for p in MONITOR.parcelas
                if _so_digitos(p.cnpj_empregador) == cnpj_d and p.competencia == comp]
    if not parcelas:
        raise HTTPException(404, f"Sem parcelas para CNPJ {cnpj} na competência {comp}")

    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["cpf", "rubrica_esocial", "codigo_if", "valor_parcela",
                "numero_parcela", "competencia", "id_operacao"])
    for p in parcelas:
        cpf = getattr(p, "cpf", "")  # campo opcional; vazio se não populado
        w.writerow([
            _cpf_formatado(cpf) if cpf else "PREENCHER",
            RUBRICA_CONSIGNADO,
            CODIGO_IF,
            f"{p.valor_esperado:.2f}".replace(".", ","),
            p.numero_parcela,
            p.competencia,
            p.proposal_id,
        ])
    return buf.getvalue()


@router.get("/{cnpj}/pendencias")
def pendencias(cnpj: str) -> dict:
    """Painel do RH: o que falta escriturar/recolher, com aging."""
    MONITOR.marcar_atrasos()
    cnpj_d = _so_digitos(cnpj)
    do_cnpj = [p for p in MONITOR.parcelas if _so_digitos(p.cnpj_empregador) == cnpj_d]
    if not do_cnpj:
        return {"cnpj": cnpj, "mensagem": "Nenhuma operação BMoto neste CNPJ."}

    abertas = [p for p in do_cnpj if p.status in
               (StatusRepasse.PENDENTE, StatusRepasse.RECEBIDO_PARCIAL, StatusRepasse.ATRASADO)]
    atrasadas = [p for p in abertas if p.status == StatusRepasse.ATRASADO]
    score = MONITOR.score_repasse_empregador(do_cnpj[0].cnpj_empregador)
    return {
        "cnpj": cnpj,
        "parcelas_abertas": [
            {
                "proposal_id": p.proposal_id,
                "competencia": p.competencia,
                "valor": round(p.valor_esperado - p.valor_recebido, 2),
                "status": p.status.value,
                "dias_atraso": p.dias_atraso,
            }
            for p in abertas
        ],
        "total_em_atraso": round(sum(p.valor_esperado - p.valor_recebido for p in atrasadas), 2),
        "pontualidade": score.get("taxa_pontualidade"),
        "orientacao": ("Em caso de atraso: confira a rubrica 9253 no eSocial e a guia "
                       "FGTS Digital/DAE. Dúvidas? Fale com a Mia no chat — ela atende RH."),
    }


@router.get("/{cnpj}/checklist")
def checklist(cnpj: str) -> dict:
    """Checklist mensal do RH para nunca atrasar um repasse BMoto."""
    return {
        "cnpj": cnpj,
        "checklist": [
            {"passo": 1, "acao": "Conferir DET e baixar arquivo BMoto da competência",
             "prazo": "até o dia do corte da folha"},
            {"passo": 2, "acao": f"Importar/lançar rubrica {RUBRICA_CONSIGNADO} no S-1200",
             "prazo": "no fechamento da folha"},
            {"passo": 3, "acao": "Validar S-5003 (valores por trabalhador)",
             "prazo": "após processar a folha"},
            {"passo": 4, "acao": "Gerar e pagar a guia no FGTS Digital",
             "prazo": "até o vencimento da guia"},
            {"passo": 5, "acao": "Guardar comprovante; divergências → Mia/BMoto",
             "prazo": "mesmo dia"},
        ],
        "erros_comuns": [
            "CPF sem zeros à esquerda no arquivo da folha",
            "Código da IF errado (usar o da liquidante)",
            "Perder a janela 21→20 e escriturar na competência errada",
            "Escriturar no eSocial e esquecer a guia do FGTS Digital",
        ],
    }
