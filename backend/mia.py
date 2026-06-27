"""
mia.py — Cérebro da Mia, a assistente conversacional do BMoto.

Estratégia:
  1. Se ANTHROPIC_API_KEY estiver presente, responde com Claude Haiku,
     ancorada no contexto real da oferta do tomador.
  2. Se a key faltar, a API der erro ou estourar o timeout, cai
     graciosamente para o FAQ local — o usuário nunca vê uma falha.

Async + httpx (sem SDK extra, casando com o resto do api.py).
"""

from __future__ import annotations

import os
import logging
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Optional

import httpx

logger = logging.getLogger("mia")

# --- Configuração (sobrescrevível por env var) ------------------------------
MIA_MODEL = os.getenv("MIA_MODEL", "claude-haiku-4-5-20251001")
MIA_MAX_TOKENS = int(os.getenv("MIA_MAX_TOKENS", "300"))
MIA_TIMEOUT_S = float(os.getenv("MIA_TIMEOUT_S", "15"))

PRODUTOS = {
    "consignado": ("Consignado Privado", "1,99% a.m."),
    "pessoal": ("Crédito Pessoal", "3,99% a.m."),
    "moto": ("Financiamento de Moto", "1,79% a.m."),
}


# --- Contexto da oferta -----------------------------------------------------
@dataclass
class MiaContext:
    produto: Optional[str] = None
    nome: Optional[str] = None
    renda: Optional[float] = None
    margem: Optional[float] = None
    valor_solicitado: Optional[float] = None
    prazo_meses: Optional[int] = None
    parcela: Optional[float] = None
    taxa_am: Optional[float] = None
    cet_am: Optional[float] = None
    seguro_incluso: Optional[bool] = None
    historico: list[dict] = field(default_factory=list)

    def resumo(self) -> str:
        l = []
        if self.nome:
            l.append(f"- Nome do cliente: {self.nome}")
        if self.produto in PRODUTOS:
            nome_prod, taxa = PRODUTOS[self.produto]
            l.append(f"- Produto em análise: {nome_prod} (taxa balcão {taxa})")
        if self.renda is not None:
            l.append(f"- Renda líquida informada: R$ {self.renda:.2f}")
        if self.margem is not None:
            l.append(f"- Margem consignável disponível: R$ {self.margem:.2f}")
        if self.valor_solicitado is not None:
            l.append(f"- Valor solicitado: R$ {self.valor_solicitado:.2f}")
        if self.prazo_meses is not None:
            l.append(f"- Prazo: {self.prazo_meses} meses")
        if self.parcela is not None:
            l.append(f"- Parcela: R$ {self.parcela:.2f}")
        if self.taxa_am is not None:
            l.append(f"- Taxa efetiva desta oferta: {self.taxa_am:.2f}% a.m.")
        if self.cet_am is not None:
            l.append(f"- CET desta oferta: {self.cet_am:.2f}% a.m.")
        if self.seguro_incluso is not None:
            l.append(f"- Seguro prestamista: {'incluído' if self.seguro_incluso else 'não incluído'}")
        return "\n".join(l) if l else "(Ainda não há dados de oferta para este cliente.)"


# --- System prompt ----------------------------------------------------------
SYSTEM_BASE = """\
Você é a Mia, assistente virtual do BMoto, uma originadora de crédito para \
trabalhadores CLT. Fala português brasileiro, em tom acolhedor e direto. \
Respostas curtas: no máximo 3 frases.

Produtos e taxas balcão (ao mês):
- Consignado Privado (Crédito do Trabalhador): 1,99% a.m.
- Crédito Pessoal: 3,99% a.m.
- Financiamento de Moto: 1,79% a.m.

Fatos do produto:
- No consignado privado a parcela é descontada direto na folha de pagamento. \
Por ter menos risco, a taxa é menor. O crédito é liberado via Pix somente APÓS \
a averbação ser confirmada pelo empregador.
- Prazos de 12 a 96 meses. A parcela é descontada automaticamente da folha; o \
comprometimento é limitado a 40% da renda líquida. Não compromete o FGTS.
- CET (Custo Efetivo Total) = juros + IOF, calculado pela Resolução CMN 4.881/2020.
- Seguro prestamista (opcional): quita o saldo devedor em caso de demissão sem \
justa causa, morte ou invalidez permanente. Prêmio de 5% do valor financiado, \
limitado a R$ 299. Pode ser removido na proposta.
- Documentos: RG ou CNH (frente e verso) e uma selfie. Tudo pelo chat.

REGRAS INEGOCIÁVEIS:
- Nunca prometa aprovação; depende de análise de crédito e da margem.
- Nunca invente valores. Se um número não estiver no contexto abaixo, diga que \
os valores exatos aparecem na proposta e na CCB, que são a fonte oficial.
- Nunca dê recomendação de investimento; você não é consultora financeira.
- Não recalcule CET nem parcela de cabeça — eles vêm da esteira de cálculo.
- Não peça nem registre senhas, dados de cartão ou números de conta no chat.
- Só mencione WhatsApp/atendimento humano se o cliente pedir explicitamente.
- Fora do escopo de crédito/BMoto, redirecione gentilmente.

Use os dados do cliente abaixo para personalizar quando fizer sentido.
"""


def build_system_prompt(ctx: MiaContext) -> str:
    return f"{SYSTEM_BASE}\n\n=== DADOS DO CLIENTE NESTA SESSÃO ===\n{ctx.resumo()}"


# --- FAQ local (fallback) ---------------------------------------------------
FAQ: list[tuple[list[str], str]] = [
    (["consignado", "crédito do trabalhador", "credito do trabalhador", "folha", "clt"],
     "O Consignado Privado (Crédito do Trabalhador) é descontado direto na sua "
     "folha de pagamento. Por ter menos risco, a taxa parte de 1,99% a.m. O prazo "
     "pode chegar a 96 meses e não compromete seu FGTS."),
    (["taxa", "juros", "cet", "quanto de juros"],
     "As taxas ao mês: Consignado Privado 1,99%, Crédito Pessoal 3,99% e Moto "
     "1,79%. O CET (juros + IOF) é calculado pela Resolução CMN 4.881/2020 e "
     "aparece na sua proposta."),
    (["seguro", "prestamista", "demissão", "demissao", "invalidez"],
     "O seguro prestamista quita o saldo devedor em caso de demissão sem justa "
     "causa, morte ou invalidez permanente. O prêmio é 5% do valor financiado, "
     "limitado a R$ 299. É opcional — você pode remover na proposta."),
    (["prazo", "parcela", "meses", "anos", "vezes"],
     "Os prazos vão de 12 a 96 meses, com a parcela descontada automaticamente da "
     "folha. O comprometimento é limitado a 40% da sua renda líquida."),
    (["documento", "doc", "rg", "cnh", "comprovante", "selfie"],
     "Precisamos de RG ou CNH (frente e verso) e uma selfie para verificação de "
     "identidade. Todo o processo é feito aqui no chat — rápido e seguro."),
    (["averbação", "averbacao", "desconto na folha"],
     "Averbação é a confirmação, pelo seu empregador, do desconto da parcela na "
     "folha. O Pix só é liberado depois que a averbação é confirmada."),
    (["quando cai", "quando recebo", "pix", "liberação", "liberacao", "dinheiro"],
     "O valor cai por Pix logo após a averbação ser confirmada pelo empregador. "
     "Antes disso, o crédito ainda não é liberado."),
    (["quitar", "antecipar", "pagar antes", "quitação"],
     "Você pode quitar antecipadamente com desconto proporcional dos juros "
     "futuros, conforme as regras do Banco Central."),
    (["margem", "quanto posso pegar", "limite"],
     "O valor máximo depende da sua margem consignável disponível. A consulta é "
     "automática e o limite aparece na sua simulação."),
]


def _similaridade(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def match_faq(pergunta: str, limiar: float = 0.6) -> Optional[str]:
    p = (pergunta or "").lower().strip()
    melhor_score, melhor_resp = 0.0, None
    for gatilhos, resposta in FAQ:
        for g in gatilhos:
            if g in p:
                return resposta
            s = _similaridade(g, p)
            if s > melhor_score:
                melhor_score, melhor_resp = s, resposta
    return melhor_resp if melhor_score >= limiar else None


_FALLBACK = ("Boa pergunta! Para te dar uma resposta precisa, posso explicar "
             "taxas, prazos, seguro prestamista ou como funciona a liberação. "
             "O que você quer saber? 😊")


# --- Núcleo -----------------------------------------------------------------
async def responder_duvida(pergunta: str, ctx: Optional[MiaContext] = None) -> dict:
    """Retorna {"resposta": str, "fonte": "ia" | "faq" | "fallback"}. Nunca levanta."""
    ctx = ctx or MiaContext()
    pergunta = (pergunta or "").strip()
    if not pergunta:
        return {"resposta": _FALLBACK, "fonte": "fallback"}

    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if key:
        try:
            texto = await _responder_com_ia(pergunta, ctx, key)
            if texto:
                return {"resposta": texto, "fonte": "ia"}
        except Exception as e:  # noqa: BLE001
            logger.warning("Mia IA falhou, usando FAQ. Erro: %s", e)

    faq = match_faq(pergunta)
    if faq:
        return {"resposta": faq, "fonte": "faq"}
    return {"resposta": _FALLBACK, "fonte": "fallback"}


async def _responder_com_ia(pergunta: str, ctx: MiaContext, key: str) -> str:
    msgs = list(ctx.historico) + [{"role": "user", "content": pergunta}]
    async with httpx.AsyncClient(timeout=MIA_TIMEOUT_S) as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            json={"model": MIA_MODEL, "max_tokens": MIA_MAX_TOKENS,
                  "system": build_system_prompt(ctx), "messages": msgs},
        )
    r.raise_for_status()
    data = r.json()
    partes = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    return "\n".join(partes).strip()
