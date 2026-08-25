"""
repasse_monitor.py — Monitoramento de repasses do Crédito do Trabalhador.

CONTEXTO ESTRATÉGICO (pesquisa ago/2026): ~65% da inadimplência do setor é
falha operacional (RH↔IF 30%, eSocial/Dataprev 22%, desconto em folha 13%);
só ~33% é incapacidade de pagamento (Serasa/Salaryfits). Quem monitora o
repasse por competência e cobra o EMPREGADOR ganha inadimplência
estruturalmente menor que a média do setor (8,6%).

Base legal da cobrança ao empregador:
- Portaria MTE 435/2025, art. 28 §3º: empregador responde por juros/encargos
  do atraso e deve regularizar junto à consignatária.
- Lei 15.179/2025, art. 3º: multa de 30% do valor retido e não repassado +
  Termo de Débito Salarial (título executivo extrajudicial).
- Art. 24 da Portaria 435/2025: competência da 1ª parcela definida pela data
  de averbação (janela 21 do mês anterior a 20 do corrente).

Fluxo: parcela esperada por competência → conciliação do recebido →
classificação da causa → ação de cobrança direcionada (empregador vs.
trabalhador). O histórico por CNPJ alimenta o Score Empregador.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Dict, List, Optional


class StatusRepasse(str, Enum):
    PENDENTE = "pendente"                  # dentro da competência, aguardando
    RECEBIDO = "recebido"                  # conciliado OK
    RECEBIDO_PARCIAL = "recebido_parcial"
    ATRASADO = "atrasado"                  # competência vencida sem repasse


class CausaProvavel(str, Enum):
    """Classificação alinhada à taxonomia Serasa/Salaryfits."""
    SEM_ESCRITURACAO = "sem_escrituracao_esocial"     # RH não lançou rubrica 9253
    ESCRITURADO_SEM_RECOLHIMENTO = "escriturado_sem_recolhimento"  # falta guia FGTS Digital/DAE
    FALHA_INTEGRACAO = "falha_integracao_plataformas"  # eSocial/Dataprev/FGTS Digital
    DESLIGAMENTO = "desligamento_trabalhador"          # rescisão: acionar garantia FGTS
    AFASTAMENTO = "afastamento_inss"                   # contrato suspenso
    TRABALHADOR = "incapacidade_pagamento"
    INDETERMINADA = "indeterminada"


# Causas cuja cobrança é dirigida ao EMPREGADOR (não ao trabalhador)
CAUSAS_EMPREGADOR = {
    CausaProvavel.SEM_ESCRITURACAO,
    CausaProvavel.ESCRITURADO_SEM_RECOLHIMENTO,
    CausaProvavel.FALHA_INTEGRACAO,
}


@dataclass
class ParcelaEsperada:
    proposal_id: str
    cnpj_empregador: str
    competencia: str                # "YYYY-MM"
    numero_parcela: int
    valor_esperado: float
    cpf: str = ""
    valor_recebido: float = 0.0
    status: StatusRepasse = StatusRepasse.PENDENTE
    causa: Optional[CausaProvavel] = None
    dias_atraso: int = 0


@dataclass
class MonitorRepasses:
    """Registro em memória; persistência via repositório é passo seguinte."""

    parcelas: List[ParcelaEsperada] = field(default_factory=list)

    # ------------------------------------------------------------------ setup
    def registrar_esperada(self, p: ParcelaEsperada) -> None:
        self.parcelas.append(p)

    def conciliar(self, proposal_id: str, competencia: str, valor: float) -> None:
        for p in self.parcelas:
            if p.proposal_id == proposal_id and p.competencia == competencia:
                p.valor_recebido += valor
                if p.valor_recebido >= p.valor_esperado - 0.01:
                    p.status = StatusRepasse.RECEBIDO
                    p.causa = None
                else:
                    p.status = StatusRepasse.RECEBIDO_PARCIAL
                return
        raise KeyError(f"Parcela {proposal_id}/{competencia} não encontrada")

    def marcar_atrasos(self, hoje: Optional[date] = None) -> int:
        """Marca como atrasadas as competências vencidas. Retorna quantas."""
        hoje = hoje or date.today()
        comp_atual = f"{hoje.year:04d}-{hoje.month:02d}"
        n = 0
        for p in self.parcelas:
            if p.status in (StatusRepasse.PENDENTE, StatusRepasse.RECEBIDO_PARCIAL) \
                    and p.competencia < comp_atual:
                p.status = StatusRepasse.ATRASADO
                ano, mes = map(int, p.competencia.split("-"))
                venc = date(ano + (mes // 12), (mes % 12) + 1, 20)  # ~dia 20 seguinte
                p.dias_atraso = max(0, (hoje - venc).days)
                if p.causa is None:
                    p.causa = CausaProvavel.INDETERMINADA
                n += 1
        return n

    def classificar(self, proposal_id: str, competencia: str,
                    causa: CausaProvavel) -> None:
        for p in self.parcelas:
            if p.proposal_id == proposal_id and p.competencia == competencia:
                p.causa = causa
                return
        raise KeyError(f"Parcela {proposal_id}/{competencia} não encontrada")

    # -------------------------------------------------------------- relatórios
    def aging(self) -> dict:
        """Visão executiva: atraso por causa e por empregador."""
        atrasadas = [p for p in self.parcelas if p.status == StatusRepasse.ATRASADO]
        por_causa: Dict[str, float] = {}
        por_cnpj: Dict[str, float] = {}
        for p in atrasadas:
            causa = (p.causa or CausaProvavel.INDETERMINADA).value
            por_causa[causa] = round(por_causa.get(causa, 0) + p.valor_esperado - p.valor_recebido, 2)
            por_cnpj[p.cnpj_empregador] = round(
                por_cnpj.get(p.cnpj_empregador, 0) + p.valor_esperado - p.valor_recebido, 2)
        total_esperado = sum(p.valor_esperado for p in self.parcelas) or 1.0
        total_atrasado = sum(p.valor_esperado - p.valor_recebido for p in atrasadas)
        return {
            "parcelas_total": len(self.parcelas),
            "parcelas_atrasadas": len(atrasadas),
            "valor_atrasado": round(total_atrasado, 2),
            "inadimplencia_pct": round(total_atrasado / total_esperado * 100, 2),
            "por_causa": por_causa,
            "por_empregador": por_cnpj,
        }

    def score_repasse_empregador(self, cnpj: str) -> dict:
        """
        Histórico de repasse do CNPJ → insumo para o Score Empregador.
        taxa_pontualidade em [0,1]; alimenta fator no scorecard (decisão CEO #2).
        """
        do_cnpj = [p for p in self.parcelas if p.cnpj_empregador == cnpj
                   and p.status != StatusRepasse.PENDENTE]
        if not do_cnpj:
            return {"cnpj": cnpj, "historico": "sem_dados", "taxa_pontualidade": None}
        ok = sum(1 for p in do_cnpj if p.status == StatusRepasse.RECEBIDO)
        return {
            "cnpj": cnpj,
            "parcelas_observadas": len(do_cnpj),
            "taxa_pontualidade": round(ok / len(do_cnpj), 3),
        }

    def acoes_cobranca(self) -> List[dict]:
        """
        Régua de cobrança por parcela atrasada, com destinatário correto:
        - Causa operacional → EMPREGADOR (base legal: Portaria 435/2025 art. 28
          §3º; Lei 15.179/2025 art. 3º — multa 30% + TDS)
        - Desligamento → acionar garantia FGTS (multa rescisória + saldo)
        - Trabalhador → renegociação/cobrança amigável ao CPF
        """
        acoes = []
        for p in self.parcelas:
            if p.status != StatusRepasse.ATRASADO:
                continue
            causa = p.causa or CausaProvavel.INDETERMINADA
            if causa in CAUSAS_EMPREGADOR or causa == CausaProvavel.INDETERMINADA:
                acoes.append({
                    "proposal_id": p.proposal_id,
                    "destinatario": "EMPREGADOR",
                    "cnpj": p.cnpj_empregador,
                    "acao": ("Notificar RH: verificar rubrica 9253 no eSocial e guia "
                             "FGTS Digital/DAE da competência; regularização com juros/"
                             "encargos (Port. 435/2025 art. 28 §3º). Persistindo, "
                             "formalizar: multa 30% + TDS (Lei 15.179/2025 art. 3º)."),
                    "dias_atraso": p.dias_atraso,
                    "valor": round(p.valor_esperado - p.valor_recebido, 2),
                })
            elif causa == CausaProvavel.DESLIGAMENTO:
                acoes.append({
                    "proposal_id": p.proposal_id,
                    "destinatario": "GARANTIA_FGTS",
                    "acao": "Acionar garantia: multa rescisória (10% p/ consignação) e saldo FGTS.",
                    "valor": round(p.valor_esperado - p.valor_recebido, 2),
                })
            elif causa == CausaProvavel.AFASTAMENTO:
                acoes.append({
                    "proposal_id": p.proposal_id,
                    "destinatario": "MONITORAR",
                    "acao": "Contrato suspenso (afastamento INSS): monitorar retorno do vínculo.",
                    "valor": round(p.valor_esperado - p.valor_recebido, 2),
                })
            else:
                acoes.append({
                    "proposal_id": p.proposal_id,
                    "destinatario": "TRABALHADOR",
                    "acao": "Cobrança amigável ao CPF + oferta de renegociação (Mia).",
                    "dias_atraso": p.dias_atraso,
                    "valor": round(p.valor_esperado - p.valor_recebido, 2),
                })
        return acoes


# Instância global simples (mesmo padrão do restante do backend in-memory)
MONITOR = MonitorRepasses()
