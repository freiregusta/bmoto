"""
contabilidade.py — Razão contábil de partidas dobradas para o BMoto.

Cada evento financeiro da operação gera um Lançamento balanceado (Σdébitos =
Σcréditos). Dois eventos cobrem o ciclo originate-to-distribute:

  1. Desembolso (estado CONTABILIZADA): reconhece a carteira a receber, a
     saída de caixa do Pix, o IOF a recolher e o seguro a repassar.
  2. Cessão ao FIDC (estado CEDIDA_FIDC): baixa a carteira, reconhece o caixa
     recebido do fundo e o resultado (ganho/deságio) da cessão.

Sem dependência externa — Python puro, testável local.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Dict, List

# --------------------------------------------------------------------------- #
# Plano de contas                                                             #
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class Conta:
    codigo: str
    nome: str
    natureza: str  # "D" = devedora (ativo/despesa) | "C" = credora (passivo/receita)


PDC: Dict[str, Conta] = {
    "BANCOS":            Conta("1.1.1", "Bancos / Caixa", "D"),
    "CARTEIRA":          Conta("1.2.1", "Operações de crédito a receber", "D"),
    "IOF_A_RECOLHER":    Conta("2.1.1", "IOF a recolher", "C"),
    "SEGURO_A_REPASSAR": Conta("2.1.2", "Seguro prestamista a repassar", "C"),
    "RECEITA_CESSAO":    Conta("3.1.1", "Receita de cessão de crédito", "C"),
    "DESPESA_CESSAO":    Conta("4.1.1", "Deságio / despesa de cessão", "D"),
}


def _round(v: float) -> float:
    return round(float(v), 2)


# --------------------------------------------------------------------------- #
# Lançamento (partidas dobradas)                                              #
# --------------------------------------------------------------------------- #

@dataclass
class Partida:
    conta: str           # chave no PDC
    debito: float = 0.0
    credito: float = 0.0

    def __post_init__(self):
        if self.conta not in PDC:
            raise ValueError(f"Conta desconhecida no plano: {self.conta}")
        self.debito = _round(self.debito)
        self.credito = _round(self.credito)
        if self.debito < 0 or self.credito < 0:
            raise ValueError("Débito/crédito não podem ser negativos")
        if self.debito > 0 and self.credito > 0:
            raise ValueError("Uma partida é débito OU crédito, não ambos")


@dataclass
class Lancamento:
    historico: str
    proposal_id: str
    evento: str
    partidas: List[Partida]
    data: dt.datetime = field(default_factory=dt.datetime.utcnow)

    @property
    def total_debito(self) -> float:
        return _round(sum(p.debito for p in self.partidas))

    @property
    def total_credito(self) -> float:
        return _round(sum(p.credito for p in self.partidas))

    @property
    def balanceado(self) -> bool:
        return abs(self.total_debito - self.total_credito) < 0.01

    def validar(self) -> "Lancamento":
        if not self.partidas:
            raise ValueError("Lançamento sem partidas")
        if not self.balanceado:
            raise ValueError(
                f"Lançamento desbalanceado: D={self.total_debito} C={self.total_credito}")
        return self


# --------------------------------------------------------------------------- #
# Razão (ledger)                                                              #
# --------------------------------------------------------------------------- #

class Razao:
    def __init__(self):
        self.lancamentos: List[Lancamento] = []
        self._saldos: Dict[str, float] = {k: 0.0 for k in PDC}

    def registrar(self, lanc: Lancamento) -> Lancamento:
        lanc.validar()
        for p in lanc.partidas:
            # saldo em convenção devedor-positivo (débito soma, crédito subtrai)
            self._saldos[p.conta] = _round(self._saldos[p.conta] + p.debito - p.credito)
        self.lancamentos.append(lanc)
        return lanc

    def saldo(self, conta: str) -> float:
        return self._saldos[conta]

    def balancete(self) -> Dict[str, dict]:
        """Saldo por conta, já orientado pela natureza (sempre >= 0 no lado normal)."""
        out = {}
        for k, c in PDC.items():
            bruto = self._saldos[k]
            valor = bruto if c.natureza == "D" else -bruto
            out[k] = {"codigo": c.codigo, "nome": c.nome,
                      "natureza": c.natureza, "saldo": _round(valor)}
        return out

    def conferencia(self) -> bool:
        """Partida dobrada global: soma dos saldos devedor-positivo deve ser ~0."""
        return abs(sum(self._saldos.values())) < 0.01


# --------------------------------------------------------------------------- #
# Geradores de lançamento a partir da operação                                #
# --------------------------------------------------------------------------- #

def lancamento_desembolso(proposal_id: str, *, liberado: float,
                          principal_financiado: float, iof: float,
                          seguro: float) -> Lancamento:
    """Originação: carteira a receber contra caixa + IOF + seguro."""
    partidas = [
        Partida("CARTEIRA", debito=principal_financiado),
        Partida("BANCOS", credito=liberado),
        Partida("IOF_A_RECOLHER", credito=iof),
        Partida("SEGURO_A_REPASSAR", credito=seguro),
    ]
    # remove partidas zeradas (ex.: sem seguro) mantendo o balanço
    partidas = [p for p in partidas if p.debito or p.credito]
    return Lancamento(
        historico=f"Desembolso/originação op {proposal_id}",
        proposal_id=proposal_id, evento="DESEMBOLSO", partidas=partidas).validar()


def lancamento_cessao(proposal_id: str, *, valor_face: float,
                      preco_cessao: float) -> Lancamento:
    """Cessão ao FIDC: baixa a carteira, entra caixa, apura resultado."""
    resultado = _round(preco_cessao - valor_face)
    partidas = [
        Partida("BANCOS", debito=preco_cessao),
        Partida("CARTEIRA", credito=valor_face),
    ]
    if resultado > 0:
        partidas.append(Partida("RECEITA_CESSAO", credito=resultado))
    elif resultado < 0:
        partidas.append(Partida("DESPESA_CESSAO", debito=-resultado))
    return Lancamento(
        historico=f"Cessão ao FIDC op {proposal_id} (resultado {resultado:+.2f})",
        proposal_id=proposal_id, evento="CESSAO_FIDC", partidas=partidas).validar()
