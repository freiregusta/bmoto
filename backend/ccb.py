"""
ccb.py — Emissão da Cédula de Crédito Bancário (CCB).

Fecha o gap de formalização: antes, CCB_ASSINADA era só um evento.
Agora a esteira emite o TÍTULO de verdade:

1. Numeração única (BMT-AAAA-NNNNNN) com sequencial por ano
2. Conteúdo conforme Lei 10.931/2004 (requisitos da CCB) e transparência
   da Res. CMN 4.881/2020: valor, taxa a.m./a.a., CET a.m./a.a., IOF,
   seguro, cronograma de parcelas, praça de pagamento
3. PDF gerado (fpdf2) + SHA-256 do documento para trilha de integridade
4. Registro em memória/disco com status (emitida → assinada), pronto para
   plugar a plataforma de assinatura eletrônica (Clicksign etc.) via
   AssinaturaProvider

Endpoints (montados em api.make_app):
    POST /operacoes/{id}/ccb/emitir  → gera a CCB da operação
    GET  /operacoes/{id}/ccb.pdf     → baixa o PDF
    GET  /operacoes/{id}/ccb         → metadados (número, hash, status)
"""

from __future__ import annotations

import hashlib
import os
import datetime as dt
from dataclasses import dataclass, field
from typing import Optional

from fpdf import FPDF
from fpdf.enums import XPos, YPos

import finance
from dataclasses import asdict
from persistencia import JsonStore, hidratar

EMITENTE_PADRAO = os.getenv("CCB_CREDORA", "BMoto Originadora — em constituição")
PRACA_PAGAMENTO = os.getenv("CCB_PRACA", "São Paulo/SP")
DIR_CCB = os.getenv("CCB_DIR", "/tmp/ccbs")


# ---------------------------------------------------------------------------
# Registro
# ---------------------------------------------------------------------------
@dataclass
class RegistroCCB:
    numero: str
    proposal_id: str
    sha256: str
    caminho_pdf: str
    emitida_em: str
    status: str = "EMITIDA"            # EMITIDA -> ASSINADA
    assinada_em: Optional[str] = None
    assinatura_evidencia: Optional[str] = None  # id/URL da plataforma de assinatura


@dataclass
class CartorioCCB:
    """Numeração e guarda das CCBs. Persistência SQL é o passo seguinte."""

    registros: dict[str, RegistroCCB] = field(default_factory=dict)  # por proposal_id
    _seq: int = 0

    def proximo_numero(self) -> str:
        self._seq += 1
        return f"BMT-{dt.date.today().year}-{self._seq:06d}"

    def get(self, proposal_id: str) -> Optional[RegistroCCB]:
        return self.registros.get(proposal_id)

    def registrar(self, r: RegistroCCB) -> None:
        self.registros[r.proposal_id] = r
        from persistencia import JsonStore
        JsonStore("ccbs").put(r.proposal_id, asdict(r))

    def marcar_assinada(self, proposal_id: str, evidencia: str = "") -> RegistroCCB:
        r = self.registros[proposal_id]
        r.status = "ASSINADA"
        r.assinada_em = dt.datetime.utcnow().isoformat()
        r.assinatura_evidencia = evidencia or None
        JsonStore("ccbs").put(proposal_id, asdict(r))
        return r


_STORE_CCB = JsonStore("ccbs")


def _carregar_cartorio() -> CartorioCCB:
    c = CartorioCCB()
    c.registros = hidratar(_STORE_CCB, lambda d: RegistroCCB(**d))
    seqs = [int(r.numero.split("-")[-1]) for r in c.registros.values()
            if r.numero.split("-")[1] == str(__import__("datetime").date.today().year)]
    c._seq = max(seqs) if seqs else 0
    return c


CARTORIO = _carregar_cartorio()


# ---------------------------------------------------------------------------
# Emissão
# ---------------------------------------------------------------------------
def _s(t: str) -> str:
    """Sanitiza para latin-1 (fonte core do PDF)."""
    return (t.replace("\u2014", "-").replace("\u2013", "-")
             .replace("\u2192", "->").encode("latin-1", "replace")
             .decode("latin-1"))


def _linha(pdf: FPDF, rotulo: str, valor: str) -> None:
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(62, 6, _s(rotulo), border=0)
    pdf.set_font("Helvetica", "", 9)
    pdf.multi_cell(0, 6, _s(valor), new_x=XPos.LMARGIN, new_y=YPos.NEXT)


def emitir_ccb(op) -> RegistroCCB:
    """Gera o PDF da CCB a partir de uma Operation precificada."""
    ja = CARTORIO.get(op.proposal_id)
    if ja is not None:
        return ja
    if op.pricing is None:
        raise ValueError("Operação sem pricing: não é possível emitir CCB.")

    p = op.pricing
    req = op.request
    numero = CARTORIO.proximo_numero()
    hoje = dt.date.today()

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 8, _s("CÉDULA DE CRÉDITO BANCÁRIO"), ln=1, align="C")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 6, _s(f"No {numero}  -  Lei no 10.931/2004"), ln=1, align="C")
    pdf.ln(3)

    _linha(pdf, "Credora:", EMITENTE_PADRAO)
    nome = getattr(req.worker, "nome", None) or "—"
    cpf = getattr(req.worker, "cpf", None) or "—"
    _linha(pdf, "Emitente (devedor):", f"{nome} — CPF {cpf}")
    _linha(pdf, "Data de emissão:", hoje.strftime("%d/%m/%Y"))
    _linha(pdf, "Praça de pagamento:", PRACA_PAGAMENTO)
    _linha(pdf, "Modalidade:", "Crédito consignado privado — Crédito do Trabalhador "
                               "(desconto em folha via eSocial, Lei 15.179/2025)")
    pdf.ln(2)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, _s("Condições financeiras (Res. CMN 4.881/2020)"), ln=1)
    _linha(pdf, "Valor líquido liberado:", f"R$ {p.liberado:,.2f}")
    _linha(pdf, "Principal financiado:", f"R$ {p.principal_financiado:,.2f}")
    _linha(pdf, "IOF financiado:", f"R$ {p.iof:,.2f}")
    _linha(pdf, "Seguro prestamista:", f"R$ {p.seguro:,.2f}" + ("" if p.seguro else " (não contratado)"))
    _linha(pdf, "Taxa de juros:", f"{p.taxa_am*100:.2f}% a.m. / {p.taxa_aa*100:.2f}% a.a.")
    _linha(pdf, "CET:", f"{p.cet_am*100:.2f}% a.m. / {p.cet_aa*100:.2f}% a.a.")
    _linha(pdf, "Prazo / parcelas:", f"{p.prazo_meses} parcelas mensais de R$ {p.parcela:,.2f}")
    pdf.ln(2)

    # Cronograma resumido (primeiras 3 + última, cronograma completo em anexo)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, _s("Cronograma de pagamentos (resumo)"), ln=1)
    sched = finance.amortization_schedule(p.principal_financiado, p.taxa_am, p.prazo_meses)
    mostrar = list(sched[:3]) + ([sched[-1]] if len(sched) > 3 else [])
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(18, 6, "Parcela", border=1)
    pdf.cell(35, 6, "Valor", border=1)
    pdf.cell(35, 6, "Juros", border=1)
    pdf.cell(35, 6, _s("Amortização"), border=1)
    pdf.cell(0, 6, "Saldo devedor", border=1, ln=1)
    for row in mostrar:
        pdf.cell(18, 6, str(row.period), border=1)
        pdf.cell(35, 6, f"R$ {row.payment:,.2f}", border=1)
        pdf.cell(35, 6, f"R$ {row.interest:,.2f}", border=1)
        pdf.cell(35, 6, f"R$ {row.principal:,.2f}", border=1)
        pdf.cell(0, 6, f"R$ {row.closing:,.2f}", border=1, ln=1)
    pdf.ln(3)

    pdf.set_font("Helvetica", "", 8)
    pdf.multi_cell(0, 5,
        _s("Cláusulas: (i) as parcelas serão descontadas em folha de pagamento na forma da "
        "Lei nº 15.179/2025 e da Portaria MTE nº 435/2025, limitadas à margem consignável; "
        "(ii) o emitente autoriza a utilização da garantia do FGTS (saldo e multa rescisória) "
        "nos termos da legislação do Crédito do Trabalhador; (iii) liquidação antecipada "
        "assegurada com redução proporcional dos juros (Res. CMN 4.881/2020); (iv) esta "
        "cédula poderá ser cedida a fundo de investimento em direitos creditórios, "
        "independentemente de anuência do emitente, mantidas as condições pactuadas; "
        "(v) via negociável única em custódia da credora."))
    pdf.ln(6)
    pdf.cell(0, 6, "____________________________________", ln=1)
    pdf.cell(0, 5, _s(f"Emitente: {nome}"), ln=1)
    pdf.set_font("Helvetica", "I", 7)
    pdf.cell(0, 5, _s("Assinatura eletrônica nos termos da MP 2.200-2/2001 e Lei 14.063/2020 "
                   "(evidência registrada pela plataforma de assinatura)."), ln=1)

    os.makedirs(DIR_CCB, exist_ok=True)
    caminho = os.path.join(DIR_CCB, f"{numero}.pdf")
    pdf.output(caminho)

    with open(caminho, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()

    reg = RegistroCCB(numero=numero, proposal_id=op.proposal_id, sha256=sha,
                      caminho_pdf=caminho, emitida_em=dt.datetime.utcnow().isoformat())
    CARTORIO.registrar(reg)
    return reg
