"""
fidc.py — Cessão de recebíveis ao FIDC (originate-to-distribute).

Precifica a cessão como valor presente das parcelas descontadas à taxa de
aquisição do fundo (taxa_cessao_am). Como a carteira foi originada a uma taxa
maior que a de cessão, o originador captura o spread de forma antecipada
(receita de cessão). Gera o lançamento contábil correspondente.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

import finance
from contabilidade import Razao, Lancamento, lancamento_cessao


@dataclass(frozen=True)
class ParametrosCessao:
    # Taxa de aquisição do FIDC (a.m., decimal). Deve ficar entre o custo de
    # funding (1,27%) e a taxa da operação para o originador ter ganho positivo.
    taxa_cessao_am: float = 0.0150


@dataclass
class ResultadoCessao:
    proposal_id: str
    valor_face: float          # carteira baixada (principal financiado)
    preco_cessao: float        # VP das parcelas à taxa de cessão
    resultado: float           # preco_cessao - valor_face (ganho se > 0)
    taxa_op_am: float          # taxa original da operação
    taxa_cessao_am: float      # taxa de aquisição do fundo
    parcela: float
    prazo_meses: int

    @property
    def ganho(self) -> bool:
        return self.resultado >= 0


def precificar_cessao(*, parcela: float, prazo_meses: int,
                      principal_financiado: float, taxa_op_am: float,
                      proposal_id: str,
                      params: Optional[ParametrosCessao] = None) -> ResultadoCessao:
    p = params or ParametrosCessao()
    preco = round(finance.principal_from_pmt(parcela, p.taxa_cessao_am, prazo_meses), 2)
    face = round(principal_financiado, 2)
    return ResultadoCessao(
        proposal_id=proposal_id, valor_face=face, preco_cessao=preco,
        resultado=round(preco - face, 2), taxa_op_am=taxa_op_am,
        taxa_cessao_am=p.taxa_cessao_am, parcela=parcela, prazo_meses=prazo_meses)


def ceder_operacao(*, parcela: float, prazo_meses: int,
                   principal_financiado: float, taxa_op_am: float,
                   proposal_id: str, razao: Razao,
                   params: Optional[ParametrosCessao] = None
                   ) -> tuple[ResultadoCessao, Lancamento]:
    res = precificar_cessao(
        parcela=parcela, prazo_meses=prazo_meses,
        principal_financiado=principal_financiado, taxa_op_am=taxa_op_am,
        proposal_id=proposal_id, params=params)
    lanc = lancamento_cessao(proposal_id, valor_face=res.valor_face,
                             preco_cessao=res.preco_cessao)
    razao.registrar(lanc)
    return res, lanc


# --------------------------------------------------------------------------- #
# Lote de cessão (agrega várias operações cedidas num batch para o fundo)      #
# --------------------------------------------------------------------------- #

@dataclass
class LoteCessao:
    params: ParametrosCessao = field(default_factory=ParametrosCessao)
    itens: List[ResultadoCessao] = field(default_factory=list)

    def adicionar(self, res: ResultadoCessao) -> None:
        self.itens.append(res)

    @property
    def total_face(self) -> float:
        return round(sum(i.valor_face for i in self.itens), 2)

    @property
    def total_preco(self) -> float:
        return round(sum(i.preco_cessao for i in self.itens), 2)

    @property
    def total_resultado(self) -> float:
        return round(sum(i.resultado for i in self.itens), 2)

    def resumo(self) -> dict:
        return {
            "qtd_operacoes": len(self.itens),
            "taxa_cessao_am": self.params.taxa_cessao_am,
            "valor_face_total": self.total_face,
            "preco_cessao_total": self.total_preco,
            "resultado_total": self.total_resultado,
        }
