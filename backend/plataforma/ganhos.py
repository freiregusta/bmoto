"""
ganhos.py — a renda REAL do entregador, lançada por ele.

Por que isto existe: não há API pública de ganhos no iFood, Rappi ou 99 para
terceiros. Open Finance resolve, mas exige participante certificado. Até lá, o
dado verdadeiro é o que o próprio entregador informa — do extrato semanal que
a plataforma já manda para ele.

Então aqui não há nada simulado:
- ele lança bruto, corridas, km e horas por período e por app;
- os custos são os dele (consumo da moto, preço do combustível, manutenção,
  depreciação, DAS, parcela);
- a margem líquida é aritmética sobre isso, calculada no servidor para o app
  e o backend nunca divergirem.

O que NÃO está aqui, de propósito: saldo, extrato bancário e qualquer número
que dependa de fornecedor. Sem fornecedor, o app diz que não existe.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import asdict, dataclass, field
from typing import Optional

from persistencia import JsonStore

# Valores públicos, não inventados.
DAS_MEI_2026 = 86.05                 # INSS 5% do salário mínimo + ISS R$ 5
LIMITE_MEI = {2026: 81_000.0, 2027: 110_000.0, 2028: 140_000.0}   # LC 238/2026


def _agora() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _so_digitos(v: str) -> str:
    return "".join(c for c in str(v) if c.isdigit())


@dataclass
class Lancamento:
    """Um período de trabalho, como o entregador recebeu."""
    id: str
    cpf: str
    app: str                          # slug do app de entrega (ou "outros")
    competencia: str                  # "2026-11" ou "2026-W45"
    bruto: float
    corridas: int = 0
    km: float = 0.0
    horas: float = 0.0
    origem: str = "declarado"         # declarado | extrato | open_finance | api
    observacao: str = ""
    criado_em: str = field(default_factory=_agora)


@dataclass
class Custos:
    """Os custos do entregador. Começam em branco: ele informa os dele."""
    cpf: str
    consumo_km_l: float = 0.0
    preco_combustivel: float = 0.0
    custo_oleo: float = 0.0
    km_troca_oleo: float = 0.0
    custo_pneus: float = 0.0
    km_pneus: float = 0.0
    custo_revisao: float = 0.0
    km_revisao: float = 0.0
    valor_moto: float = 0.0
    vida_util_km: float = 0.0
    das_mei: float = 0.0
    parcela_moto: float = 0.0
    seguro: float = 0.0
    outros_fixos: float = 0.0
    atualizado_em: str = field(default_factory=_agora)

    def informados(self) -> bool:
        """Sem consumo e preço do combustível não dá para calcular custo por km."""
        return self.consumo_km_l > 0 and self.preco_combustivel > 0

    def custo_por_km(self) -> dict:
        comb = self.preco_combustivel / self.consumo_km_l if self.consumo_km_l > 0 else 0.0
        oleo = self.custo_oleo / self.km_troca_oleo if self.km_troca_oleo > 0 else 0.0
        pneus = self.custo_pneus / self.km_pneus if self.km_pneus > 0 else 0.0
        revisao = self.custo_revisao / self.km_revisao if self.km_revisao > 0 else 0.0
        deprec = self.valor_moto / self.vida_util_km if self.vida_util_km > 0 else 0.0
        return {
            "combustivel": round(comb, 4),
            "manutencao": round(oleo + pneus + revisao, 4),
            "depreciacao": round(deprec, 4),
            "total": round(comb + oleo + pneus + revisao + deprec, 4),
        }

    def fixo_mensal(self) -> float:
        return round(self.das_mei + self.parcela_moto + self.seguro + self.outros_fixos, 2)


class RepositorioGanhos:
    def __init__(self, prefixo: str = "plat") -> None:
        self._s_lanc = JsonStore(f"{prefixo}_ganhos")
        self._s_custos = JsonStore(f"{prefixo}_custos")

    # -- lançamentos ------------------------------------------------------
    def lancar(self, dados: dict) -> Lancamento:
        cpf = _so_digitos(dados.get("cpf", ""))
        if len(cpf) != 11:
            raise ValueError("CPF inválido")
        bruto = float(dados.get("bruto") or 0)
        if bruto <= 0:
            raise ValueError("informe quanto você recebeu no período")
        competencia = str(dados.get("competencia") or "").strip()
        if not competencia:
            raise ValueError("informe a competência (ex.: 2026-11)")
        app = str(dados.get("app") or "outros").strip().lower()

        # Um lançamento por (cpf, app, competência): relançar corrige o anterior.
        chave = f"{cpf}:{app}:{competencia}"
        anterior = self._s_lanc.get(chave)
        l = Lancamento(
            id=(anterior or {}).get("id") or uuid.uuid4().hex,
            cpf=cpf, app=app, competencia=competencia, bruto=round(bruto, 2),
            corridas=int(dados.get("corridas") or 0),
            km=round(float(dados.get("km") or 0), 1),
            horas=round(float(dados.get("horas") or 0), 1),
            origem=str(dados.get("origem") or "declarado"),
            observacao=str(dados.get("observacao") or ""),
            criado_em=(anterior or {}).get("criado_em") or _agora(),
        )
        self._s_lanc.put(chave, asdict(l))
        return l

    def remover(self, cpf: str, app: str, competencia: str) -> bool:
        return self._s_lanc.delete(f"{_so_digitos(cpf)}:{app}:{competencia}")

    def lancamentos(self, cpf: str, meses: Optional[int] = None) -> list[Lancamento]:
        cpf = _so_digitos(cpf)
        out = []
        for chave, doc in self._s_lanc.all().items():
            if not chave.startswith(f"{cpf}:"):
                continue
            try:
                out.append(Lancamento(**doc))
            except TypeError:
                continue
        out.sort(key=lambda l: (l.competencia, l.app), reverse=True)
        if meses:
            competencias = sorted({l.competencia for l in out}, reverse=True)[:meses]
            out = [l for l in out if l.competencia in competencias]
        return out

    # -- custos -----------------------------------------------------------
    def custos(self, cpf: str) -> Custos:
        doc = self._s_custos.get(_so_digitos(cpf))
        if not doc:
            return Custos(cpf=_so_digitos(cpf))
        try:
            return Custos(**doc)
        except TypeError:
            return Custos(cpf=_so_digitos(cpf))

    def salvar_custos(self, cpf: str, dados: dict) -> Custos:
        atual = asdict(self.custos(cpf))
        for campo, valor in dados.items():
            if campo in Custos.__dataclass_fields__ and campo not in ("cpf", "atualizado_em"):
                atual[campo] = float(valor or 0)
        atual["cpf"] = _so_digitos(cpf)
        atual["atualizado_em"] = _agora()
        c = Custos(**atual)
        self._s_custos.put(c.cpf, asdict(c))
        return c

    # -- consolidação -----------------------------------------------------
    def resumo(self, cpf: str, meses: int = 3) -> dict:
        """Tudo que o app mostra sobre renda e margem, a partir do que foi lançado."""
        lancs = self.lancamentos(cpf, meses)
        custos = self.custos(cpf)

        if not lancs:
            return {
                "tem_dados": False,
                "meses_lancados": 0,
                "motivo": "nenhum ganho lançado ainda",
                "custos_informados": custos.informados(),
            }

        competencias = sorted({l.competencia for l in lancs}, reverse=True)
        bruto = round(sum(l.bruto for l in lancs), 2)
        km = round(sum(l.km for l in lancs), 1)
        corridas = sum(l.corridas for l in lancs)
        horas = round(sum(l.horas for l in lancs), 1)
        n = len(competencias)

        por_app: dict[str, dict] = {}
        for l in lancs:
            d = por_app.setdefault(l.app, {"bruto": 0.0, "corridas": 0, "km": 0.0})
            d["bruto"] = round(d["bruto"] + l.bruto, 2)
            d["corridas"] += l.corridas
            d["km"] = round(d["km"] + l.km, 1)

        por_competencia = []
        for c in competencias:
            do_mes = [l for l in lancs if l.competencia == c]
            por_competencia.append({
                "competencia": c,
                "bruto": round(sum(x.bruto for x in do_mes), 2),
                "km": round(sum(x.km for x in do_mes), 1),
                "corridas": sum(x.corridas for x in do_mes),
                "horas": round(sum(x.horas for x in do_mes), 1),
                "apps": sorted({x.app for x in do_mes}),
            })

        resumo = {
            "tem_dados": True,
            "meses_lancados": n,
            "competencias": competencias,
            "bruto_total": bruto,
            "bruto_medio_mensal": round(bruto / n, 2),
            "km_total": km,
            "corridas_total": corridas,
            "horas_total": horas,
            "por_app": por_app,
            "por_competencia": por_competencia,
            "custos_informados": custos.informados(),
        }

        if custos.informados():
            ck = custos.custo_por_km()
            custo_variavel = round(ck["total"] * km, 2)
            custo_fixo = round(custos.fixo_mensal() * n, 2)
            custo_total = round(custo_variavel + custo_fixo, 2)
            liquido = round(bruto - custo_total, 2)
            resumo["margem"] = {
                "custo_por_km": ck,
                "custo_variavel": custo_variavel,
                "custo_fixo": custo_fixo,
                "custo_total": custo_total,
                "liquido_total": liquido,
                "liquido_medio_mensal": round(liquido / n, 2),
                "liquido_por_km": round(liquido / km, 2) if km > 0 else None,
                "liquido_por_hora": round(liquido / horas, 2) if horas > 0 else None,
                "liquido_por_corrida": round(liquido / corridas, 2) if corridas > 0 else None,
                "margem": round(liquido / bruto, 4) if bruto > 0 else 0.0,
                "ponto_equilibrio_mensal": round(custo_total / n, 2),
            }
        else:
            resumo["margem"] = None

        return resumo

    def renda_para_credito(self, cpf: str, meses: int = 3) -> dict:
        """O que a política de crédito usa. Sem lançamento não há renda — e sem
        renda não há oferta, em vez de uma oferta sobre número inventado."""
        r = self.resumo(cpf, meses)
        if not r["tem_dados"]:
            return {"renda_media": 0.0, "meses_renda": 0, "fonte": "nenhuma"}
        # Conservador: usa o líquido quando os custos são conhecidos.
        base = (r["margem"]["liquido_medio_mensal"] if r.get("margem")
                else r["bruto_medio_mensal"])
        return {
            "renda_media": max(base, 0.0),
            "meses_renda": r["meses_lancados"],
            "fonte": "liquido_declarado" if r.get("margem") else "bruto_declarado",
            "bruto_medio_mensal": r["bruto_medio_mensal"],
        }


def limite_mei(ano: Optional[int] = None) -> float:
    ano = ano or dt.date.today().year
    return LIMITE_MEI.get(ano, LIMITE_MEI[max(LIMITE_MEI)])
