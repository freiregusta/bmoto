"""
produtos.py — manifestos dos produtos do ecossistema.

Um produto é um módulo do super app. O manifesto diz:
- quais PORTS ele precisa e com quais CAPABILITIES;
- se está ligado por padrão (`enabled`) — tudo pode ser sobrescrito por env:
      PRODUTO_CONSIGNADO_CLT=on   liga o consignado de volta
      PRODUTO_SAUDE=off           desliga o seguro saúde
- metadados que o frontend usa para montar a navegação (id, título, ícone, rota).

O consignado CLT fica aqui DESLIGADO, não apagado: a esteira, o leilão
Dataprev e o portal RH seguem no código.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict

from .ports import Capability as C


@dataclass(frozen=True)
class Requisito:
    port: str
    capabilities: tuple[C, ...] = ()


@dataclass
class ProdutoManifest:
    id: str
    titulo: str
    descricao: str
    rota: str                                   # rota no super app (/app/...)
    icone: str                                  # nome lucide-react
    enabled: bool = True
    ordem: int = 100
    fase: str = "mvp"                           # mvp | fase2 | fase3 | legado
    requisitos: tuple[Requisito, ...] = ()
    tags: tuple[str, ...] = ()

    @property
    def env_var(self) -> str:
        return "PRODUTO_" + self.id.upper()

    def ligado(self) -> bool:
        """Default do manifesto, sobrescrito por env (on/off, 1/0, true/false)."""
        v = os.getenv(self.env_var)
        if v is None:
            return self.enabled
        return v.strip().lower() in {"1", "on", "true", "yes", "sim"}

    def to_dict(self) -> dict:
        d = asdict(self)
        d["enabled"] = self.ligado()
        d["requisitos"] = [
            {"port": r.port, "capabilities": [c.value for c in r.capabilities]}
            for r in self.requisitos
        ]
        return d


PRODUTOS: list[ProdutoManifest] = [
    ProdutoManifest(
        id="conta", titulo="Conta BMoto", rota="/app/conta", icone="Wallet", ordem=10,
        descricao="Conta individual com Pix, onde caem os repasses dos apps.",
        requisitos=(Requisito("conta", (C.CONTA_ABRIR, C.CONTA_SALDO, C.CONTA_EXTRATO, C.PIX_ENVIAR)),
                    Requisito("kyc", (C.KYC_VALIDAR,))),
        tags=("baas",),
    ),
    ProdutoManifest(
        id="ganhos", titulo="Meus ganhos", rota="/app/ganhos", icone="TrendingUp", ordem=20,
        descricao="O que você recebeu em cada app, lançado por você.",
        # SEM requisito de propósito: a renda declarada pelo entregador é real e
        # não depende de ninguém. Quando houver Open Finance ou convênio, o
        # fornecedor entra como fonte adicional, não como condição.
        requisitos=(),
        tags=("real",),
    ),
    ProdutoManifest(
        id="credito", titulo="Simulação de crédito", rota="/app/credito", icone="Banknote",
        ordem=35,
        descricao="O que cabe no seu bolso, pela renda que você lançou.",
        requisitos=(),          # a política é nossa; virar oferta é que exige emissor
        tags=("real",),
    ),
    ProdutoManifest(
        id="margem", titulo="Margem líquida real", rota="/app/margem", icone="Calculator", ordem=30,
        descricao="Custo por km (combustível, óleo, depreciação, DAS) e o líquido de verdade.",
        requisitos=(),                              # aritmética sobre dado dele
        tags=("fidelizacao", "real"),
    ),
    ProdutoManifest(
        id="mei", titulo="MEI e contabilidade", rota="/app/mei", icone="FileText", ordem=40,
        descricao="Abertura da MEI, DAS mensal, DASN anual e nota fiscal.",
        requisitos=(Requisito("contador", (C.MEI_ABRIR, C.MEI_DAS, C.MEI_DASN)),),
        tags=("contabil",),
    ),
    ProdutoManifest(
        id="moto", titulo="Financiamento de moto", rota="/app/moto", icone="Bike", ordem=50,
        fase="fase2",
        descricao="Moto nova com parcela debitada do repasse; alienação fiduciária.",
        requisitos=(Requisito("credito", (C.CREDITO_EMITIR_CCB, C.CREDITO_CEDER)),
                    Requisito("conta", (C.PIX_AUTOMATICO,))),
        tags=("credito",),
    ),
    ProdutoManifest(
        id="cartao", titulo="Cartão com garantia da moto", rota="/app/cartao", icone="CreditCard", ordem=60,
        fase="fase2",
        descricao="Crédito com limite lastreado na moto quitada ou em financiamento.",
        requisitos=(Requisito("cartao", (C.CARTAO_EMITIR, C.CARTAO_LIMITE, C.CARTAO_BLOQUEAR)),),
        tags=("credito",),
    ),
    ProdutoManifest(
        id="seguro", titulo="Seguro de vida e acidentes", rota="/app/seguro", icone="Shield", ordem=70,
        descricao="Vida + acidentes pessoais + diária por incapacidade, prêmio mensal.",
        requisitos=(Requisito("seguro", (C.SEGURO_COTAR, C.SEGURO_EMITIR, C.SEGURO_SINISTRO)),),
        tags=("seguros",),
    ),
    ProdutoManifest(
        id="saude", titulo="Seguro saúde", rota="/app/saude", icone="HeartPulse", ordem=80,
        fase="fase2",
        descricao="Plano coletivo pela MEI (empresarial) ou por adesão.",
        requisitos=(Requisito("saude", (C.SAUDE_COTAR, C.SAUDE_ADERIR)),),
        tags=("seguros",),
    ),
    # ---- legado: preservado, desligado ---------------------------------
    ProdutoManifest(
        id="consignado_clt", titulo="Consignado CLT", rota="/app/consignado", icone="Landmark",
        ordem=900, enabled=False, fase="legado",
        descricao="Crédito do Trabalhador (leilão Dataprev, portal RH). Desligado no pivô; "
                  "religa com PRODUTO_CONSIGNADO_CLT=on.",
        requisitos=(Requisito("credito", (C.CREDITO_EMITIR_CCB, C.CREDITO_CEDER)),
                    Requisito("conta", (C.PIX_ENVIAR,))),
        tags=("credito", "legado"),
    ),
    ProdutoManifest(
        id="consignado_app", titulo="Consignado do entregador (Lei 15.179)", rota="/app/consignado-app",
        icone="Landmark", ordem=910, enabled=False, fase="fase3",
        descricao="Depende de convênio com as plataformas e da regulamentação; fica pronto na gaveta.",
        requisitos=(Requisito("credito", (C.CREDITO_EMITIR_CCB,)),
                    Requisito("renda", (C.RENDA_LER,))),
        tags=("credito",),
    ),
]
