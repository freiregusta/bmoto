"""
openfinance.py — identificar, no extrato, o que é repasse de app de entrega.

Esta é a peça que faz a renda do entregador virar renda comprovável. As
plataformas não abrem API de ganhos para terceiros, mas o dinheiro **cai na
conta dele**, e ali a transação vem com o pagador identificado. Com o
consentimento dele, o Open Finance entrega esse extrato.

O classificador aqui é puro: recebe transações e devolve quanto veio de cada
plataforma, por mês. Serve para as três fontes, sem mudar uma linha:

1. Open Finance direto (adapters/openfinance.py);
2. agregador contratado (Klavi, Belvo, Pluggy) pelo adapter REST genérico;
3. extrato que o próprio entregador exporta e sobe no app.

Como se identifica um repasse: pelo CNPJ do pagador quando a transação o traz,
e pelo nome do pagador quando não traz. Os dois vêm do catálogo
(`AppEntrega.cnpjs` e `AppEntrega.identificadores`), editáveis no admin — e
NÃO estão chumbados aqui, porque CNPJ errado em código vira renda atribuída à
plataforma errada.
"""

from __future__ import annotations

import datetime as dt
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable, Optional


def _normalizar(texto: str) -> str:
    """Sem acento, sem pontuação, maiúsculas: 'iFood.com Ag.' -> 'IFOOD COM AG'."""
    sem_acento = unicodedata.normalize("NFKD", str(texto or ""))
    sem_acento = "".join(c for c in sem_acento if not unicodedata.combining(c))
    return re.sub(r"[^A-Z0-9 ]+", " ", sem_acento.upper()).strip()


def _so_digitos(v: str) -> str:
    return "".join(c for c in str(v or "") if c.isdigit())


def raiz_cnpj(cnpj: str) -> str:
    """Os 8 primeiros dígitos. Plataformas pagam por filiais diferentes, e a
    raiz é o que identifica a empresa."""
    return _so_digitos(cnpj)[:8]


@dataclass
class Transacao:
    """Uma linha de extrato, no formato neutro da plataforma."""
    id: str
    data: str                       # ISO date
    valor: float                    # positivo = entrou
    descricao: str = ""
    pagador_nome: str = ""
    pagador_documento: str = ""     # CPF/CNPJ quando a fonte traz
    tipo: str = ""                  # PIX, TED, ...
    conta_id: str = ""

    @property
    def competencia(self) -> str:
        return str(self.data)[:7]


@dataclass
class RegraApp:
    """Como reconhecer o repasse de uma plataforma. Vem do catálogo."""
    slug: str
    nome: str
    cnpjs: tuple[str, ...] = ()           # raízes ou CNPJs completos
    identificadores: tuple[str, ...] = () # pedaços de nome: "IFOOD", "99 TECNOLOGIA"

    def casa(self, t: Transacao) -> bool:
        doc = raiz_cnpj(t.pagador_documento)
        if doc and any(raiz_cnpj(c) == doc for c in self.cnpjs if c):
            return True
        texto = _normalizar(f"{t.pagador_nome} {t.descricao}")
        return any(_normalizar(i) in texto for i in self.identificadores if i)


@dataclass
class RepassePorApp:
    slug: str
    nome: str
    total: float = 0.0
    lancamentos: int = 0
    competencias: dict[str, float] = field(default_factory=dict)


@dataclass
class Classificacao:
    por_app: dict[str, RepassePorApp]
    por_competencia: dict[str, float]
    nao_identificados: list[Transacao]
    total_identificado: float
    total_creditos: float

    @property
    def cobertura(self) -> float:
        """Quanto do que entrou na conta foi reconhecido como repasse. Baixa
        cobertura é sinal de regra faltando — e aparece para o operador."""
        return round(self.total_identificado / self.total_creditos, 4) if self.total_creditos else 0.0

    def renda_mensal(self) -> dict[str, float]:
        return dict(sorted(self.por_competencia.items(), reverse=True))

    def media_mensal(self, meses: Optional[int] = None) -> float:
        valores = list(self.renda_mensal().values())
        if meses:
            valores = valores[:meses]
        return round(sum(valores) / len(valores), 2) if valores else 0.0


def classificar(transacoes: Iterable[Transacao], regras: Iterable[RegraApp],
                valor_minimo: float = 0.01) -> Classificacao:
    """Separa, dos créditos da conta, o que é repasse de plataforma."""
    regras = list(regras)
    por_app: dict[str, RepassePorApp] = {}
    por_competencia: dict[str, float] = {}
    nao_identificados: list[Transacao] = []
    total_creditos = 0.0

    for t in transacoes:
        if t.valor < valor_minimo:        # débito ou poeira: não é repasse
            continue
        total_creditos += t.valor
        regra = next((r for r in regras if r.casa(t)), None)
        if regra is None:
            nao_identificados.append(t)
            continue
        acumulado = por_app.setdefault(regra.slug, RepassePorApp(regra.slug, regra.nome))
        acumulado.total = round(acumulado.total + t.valor, 2)
        acumulado.lancamentos += 1
        acumulado.competencias[t.competencia] = round(
            acumulado.competencias.get(t.competencia, 0.0) + t.valor, 2)
        por_competencia[t.competencia] = round(
            por_competencia.get(t.competencia, 0.0) + t.valor, 2)

    return Classificacao(
        por_app=por_app,
        por_competencia=por_competencia,
        nao_identificados=nao_identificados,
        total_identificado=round(sum(a.total for a in por_app.values()), 2),
        total_creditos=round(total_creditos, 2),
    )


def regras_do_catalogo(apps) -> list[RegraApp]:
    """Monta as regras a partir dos apps cadastrados no admin."""
    out = []
    for a in apps:
        cnpjs = tuple(getattr(a, "cnpjs", ()) or ())
        ids = tuple(getattr(a, "identificadores", ()) or ())
        if not cnpjs and not ids:
            # Sem identificador cadastrado não há como reconhecer: o nome da
            # plataforma é o palpite mínimo, e o admin refina.
            ids = (a.nome,)
        out.append(RegraApp(slug=a.slug, nome=a.nome, cnpjs=cnpjs, identificadores=ids))
    return out


def para_lancamentos(c: Classificacao, cpf: str, origem: str = "open_finance") -> list[dict]:
    """Converte a classificação em lançamentos de ganho, um por app e mês.

    É assim que o extrato vira a mesma coisa que o entregador digitaria — e
    daí para a frente margem e simulação não sabem (nem precisam saber) de
    onde veio o número.
    """
    saida = []
    for app in c.por_app.values():
        for competencia, bruto in app.competencias.items():
            saida.append({"cpf": cpf, "app": app.slug, "competencia": competencia,
                          "bruto": round(bruto, 2), "origem": origem})
    return sorted(saida, key=lambda d: (d["competencia"], d["app"]), reverse=True)


# ------------------------------------------------------- extrato importado

SEPARADORES = [";", ",", "\t"]
COLUNAS = {
    "data": ("data", "date", "data lancamento", "data movimento", "dt"),
    "valor": ("valor", "amount", "value", "credito", "montante"),
    "descricao": ("descricao", "description", "historico", "lancamento", "detalhe"),
    "pagador_nome": ("pagador", "favorecido", "contraparte", "nome", "remetente",
                     "origem", "payer", "counterparty"),
    "pagador_documento": ("documento", "cnpj", "cpf", "cpf cnpj", "doc", "taxid"),
}


def ler_csv(texto: str) -> list[Transacao]:
    """Lê o CSV que o entregador exportou do banco ou do app.

    Formato de extrato não é padronizado, então: detecta o separador, casa os
    cabeçalhos por aproximação e ignora linha que não tenha data e valor. O
    que não der para ler fica de fora, e a contagem aparece para o usuário —
    melhor perder uma linha do que inventar um valor.
    """
    linhas = [l for l in str(texto or "").splitlines() if l.strip()]
    if not linhas:
        return []

    sep = max(SEPARADORES, key=lambda s: linhas[0].count(s))
    cabecalho = [_normalizar(c).lower() for c in linhas[0].split(sep)]

    indice: dict[str, int] = {}
    for campo, nomes in COLUNAS.items():
        for i, titulo in enumerate(cabecalho):
            if any(n == titulo or n in titulo for n in nomes):
                indice.setdefault(campo, i)
                break

    if "data" not in indice or "valor" not in indice:
        raise ValueError("não encontrei as colunas de data e valor neste arquivo")

    out: list[Transacao] = []
    for n, linha in enumerate(linhas[1:], start=2):
        partes = linha.split(sep)
        if len(partes) <= max(indice.values()):
            continue
        data = _data_iso(partes[indice["data"]])
        valor = _valor(partes[indice["valor"]])
        if not data or valor is None:
            continue
        out.append(Transacao(
            id=f"csv-{n}", data=data, valor=valor,
            descricao=_campo(partes, indice, "descricao"),
            pagador_nome=_campo(partes, indice, "pagador_nome"),
            pagador_documento=_campo(partes, indice, "pagador_documento"),
        ))
    return out


def _campo(partes: list[str], indice: dict[str, int], campo: str) -> str:
    i = indice.get(campo)
    return partes[i].strip().strip('"') if i is not None and i < len(partes) else ""


def _data_iso(bruto: str) -> Optional[str]:
    texto = str(bruto or "").strip().strip('"')[:10]
    for formato in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return dt.datetime.strptime(texto, formato).date().isoformat()
        except ValueError:
            continue
    return None


def _valor(bruto: str) -> Optional[float]:
    texto = str(bruto or "").strip().strip('"').replace("R$", "").replace(" ", "")
    if not texto:
        return None
    negativo = texto.startswith("-") or texto.endswith("-") or texto.startswith("(")
    texto = re.sub(r"[^\d,.]", "", texto)
    if not texto:
        return None
    # pt-BR: vírgula decimal, ponto de milhar. en-US: o contrário.
    if "," in texto and "." in texto:
        texto = (texto.replace(".", "").replace(",", ".") if texto.rfind(",") > texto.rfind(".")
                 else texto.replace(",", ""))
    elif "," in texto:
        texto = texto.replace(",", ".")
    try:
        v = float(texto)
    except ValueError:
        return None
    return -v if negativo else v
