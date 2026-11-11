"""
adapters/mock.py — implementações em memória de TODOS os ports.

Servem para: demo, testes, e rodar o super app inteiro sem credencial.
Regras de negócio simples mas reais (idempotência, saldo não negativo,
prazo de carência da MEI para saúde) para que trocar pelo real não mude
o comportamento visível.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import uuid
from typing import Optional

from ..ports import (
    Apolice, Capability as C, Cartao, Cobranca, Conta, ConsentimentoRenda,
    ContratoCredito, CotacaoSeguro, GuiaDas, HealthStatus, Lancamento, Mei,
    Pagamento, Pessoa, RendaMensal, ResultadoKyc,
)


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _hoje() -> dt.date:
    return dt.date.today()


class _Base:
    nome = "mock"
    port = "base"
    _caps: set[C] = set()

    def capabilities(self) -> set[C]:
        return set(self._caps)

    async def health(self) -> HealthStatus:
        return HealthStatus(provider=self.nome, port=self.port, ok=True, latencia_ms=0.1)


# ------------------------------------------------------------------ conta

class MockContaProvider(_Base):
    port = "conta"
    _caps = {C.CONTA_ABRIR, C.CONTA_SALDO, C.CONTA_EXTRATO, C.PIX_ENVIAR,
             C.PIX_COBRAR, C.PIX_AUTOMATICO, C.BOLETO_EMITIR}

    def __init__(self) -> None:
        self.contas: dict[str, Conta] = {}
        self.lancamentos: dict[str, list[Lancamento]] = {}
        self.pagamentos: dict[str, Pagamento] = {}      # por idempotency_key
        self.cobrancas: dict[str, Cobranca] = {}

    async def abrir_conta(self, pessoa: Pessoa) -> Conta:
        for c in self.contas.values():                  # uma conta por CPF
            if c.titular_cpf == pessoa.cpf:
                return c
        n = str(len(self.contas) + 1).zfill(6)
        conta = Conta(conta_id=_id("cta"), titular_cpf=pessoa.cpf, provider=self.nome,
                      agencia="0001", numero=f"{n}-0", chave_pix=pessoa.cpf)
        self.contas[conta.conta_id] = conta
        self.lancamentos[conta.conta_id] = []
        return conta

    async def saldo(self, conta_id: str) -> float:
        self._exige(conta_id)
        return round(sum(l.valor for l in self.lancamentos[conta_id]), 2)

    async def extrato(self, conta_id: str, desde: Optional[str] = None) -> list[Lancamento]:
        self._exige(conta_id)
        ls = self.lancamentos[conta_id]
        if desde:
            ls = [l for l in ls if l.ocorrido_em >= desde]
        return sorted(ls, key=lambda l: l.ocorrido_em, reverse=True)

    async def creditar(self, conta_id: str, valor: float, descricao: str,
                       origem: Optional[str] = None,
                       idempotency_key: Optional[str] = None) -> Lancamento:
        self._exige(conta_id)
        if idempotency_key:
            for l in self.lancamentos[conta_id]:
                if l.lancamento_id == idempotency_key:
                    return l
        l = Lancamento(lancamento_id=idempotency_key or _id("lan"), conta_id=conta_id,
                       valor=abs(valor), descricao=descricao,
                       categoria="repasse_app" if origem else "pix", origem=origem)
        self.lancamentos[conta_id].append(l)
        return l

    async def pix_enviar(self, conta_id: str, valor: float, chave: str,
                         idempotency_key: str) -> Pagamento:
        self._exige(conta_id)
        if idempotency_key in self.pagamentos:
            return self.pagamentos[idempotency_key]
        pg = Pagamento(pagamento_id=_id("pix"), conta_id=conta_id, valor=valor,
                       destino=chave, idempotency_key=idempotency_key)
        if valor <= 0:
            pg.status, pg.erro = "FALHOU", "valor inválido"
        elif await self.saldo(conta_id) < valor:
            pg.status, pg.erro = "FALHOU", "saldo insuficiente"
        else:
            pg.status, pg.provider_tx_id = "CONFIRMADO", f"mock-{uuid.uuid4().hex[:12]}"
            self.lancamentos[conta_id].append(Lancamento(
                lancamento_id=_id("lan"), conta_id=conta_id, valor=-valor,
                descricao=f"Pix para {chave}", categoria="pix"))
        self.pagamentos[idempotency_key] = pg
        return pg

    async def cobrar(self, conta_id: str, valor: float, vencimento: str,
                     tipo: str = "pix") -> Cobranca:
        self._exige(conta_id)
        cb = Cobranca(cobranca_id=_id("cob"), conta_id=conta_id, valor=valor,
                      vencimento=vencimento, tipo=tipo,
                      payload=f"00020126{hashlib.sha1(conta_id.encode()).hexdigest()[:24]}")
        self.cobrancas[cb.cobranca_id] = cb
        return cb

    def _exige(self, conta_id: str) -> None:
        if conta_id not in self.contas:
            raise KeyError(f"conta {conta_id} não existe")


# ------------------------------------------------------------------ cartão

class MockCartaoProvider(_Base):
    port = "cartao"
    _caps = {C.CARTAO_EMITIR, C.CARTAO_LIMITE, C.CARTAO_BLOQUEAR}
    LTV_MOTO = 0.30            # limite = 30% do valor da moto dada em garantia

    def __init__(self) -> None:
        self.cartoes: dict[str, Cartao] = {}

    async def emitir(self, conta_id: str, modalidade: str, limite: float,
                     garantia: Optional[dict] = None) -> Cartao:
        if modalidade == "garantido":
            if not garantia or garantia.get("tipo") != "moto":
                raise ValueError("cartão garantido exige garantia do tipo moto")
            limite = min(limite, round(float(garantia["valor"]) * self.LTV_MOTO, 2))
        c = Cartao(cartao_id=_id("card"), conta_id=conta_id, provider=self.nome,
                   modalidade=modalidade, limite=limite, garantia=garantia,
                   ultimos4=uuid.uuid4().hex[:4].upper())
        self.cartoes[c.cartao_id] = c
        return c

    async def ajustar_limite(self, cartao_id: str, limite: float) -> Cartao:
        c = self.cartoes[cartao_id]
        c.limite = limite
        return c

    async def bloquear(self, cartao_id: str, motivo: str) -> Cartao:
        c = self.cartoes[cartao_id]
        c.status = "BLOQUEADO"
        return c


# ------------------------------------------------------------------ kyc

class MockKycProvider(_Base):
    port = "kyc"
    _caps = {C.KYC_VALIDAR, C.KYC_FACEMATCH}

    async def validar(self, pessoa: Pessoa, selfie_b64: Optional[str] = None,
                      documento_b64: Optional[str] = None) -> ResultadoKyc:
        motivos: list[str] = []
        cpf = "".join(ch for ch in pessoa.cpf if ch.isdigit())
        if len(cpf) != 11 or cpf == cpf[0] * 11:
            motivos.append("cpf_invalido")
        try:
            idade = (_hoje() - dt.date.fromisoformat(pessoa.nascimento)).days // 365
            if idade < 18:
                motivos.append("menor_de_idade")
        except ValueError:
            motivos.append("nascimento_invalido")
        if cpf.endswith("00"):                              # gatilho de teste
            motivos.append("lista_restritiva")
        score = 0.95 if not motivos else 0.2
        return ResultadoKyc(cpf=pessoa.cpf, aprovado=not motivos, score=score,
                            motivos=motivos, provider=self.nome)


# ------------------------------------------------------------------ crédito

class MockCreditoProvider(_Base):
    port = "credito"
    _caps = {C.CREDITO_EMITIR_CCB, C.CREDITO_CEDER}

    def __init__(self) -> None:
        self.contratos: dict[str, ContratoCredito] = {}
        self._idem: dict[str, str] = {}

    async def emitir_ccb(self, cpf: str, produto: str, principal: float,
                         taxa_mensal: float, parcelas: int,
                         idempotency_key: str) -> ContratoCredito:
        if idempotency_key in self._idem:
            return self.contratos[self._idem[idempotency_key]]
        i = taxa_mensal
        pmt = principal * i / (1 - (1 + i) ** -parcelas) if i > 0 else principal / parcelas
        ct = ContratoCredito(contrato_id=_id("ccb"), cpf=cpf, produto=produto,
                             principal=principal, taxa_mensal=i, parcelas=parcelas,
                             parcela=round(pmt, 2), cet_anual=round((1 + i) ** 12 - 1, 4),
                             ccb_url=f"https://ccb.mock/{idempotency_key}.pdf")
        self.contratos[ct.contrato_id] = ct
        self._idem[idempotency_key] = ct.contrato_id
        return ct

    async def ceder(self, contrato_id: str, cessionario: str) -> ContratoCredito:
        ct = self.contratos[contrato_id]
        ct.status, ct.cessionario = "CEDIDO", cessionario
        return ct


# ------------------------------------------------------------------ seguro

class MockSeguroProvider(_Base):
    port = "seguro"
    _caps = {C.SEGURO_COTAR, C.SEGURO_EMITIR, C.SEGURO_SINISTRO}
    TABELA = {   # produto -> (prêmio base, cobertura)
        "vida_ap": (19.90, {"morte": 30000, "invalidez": 30000, "diaria_incapacidade": 60}),
        "moto": (89.00, {"roubo_furto": "100% FIPE", "terceiros": 20000}),
    }

    def __init__(self) -> None:
        self.cotacoes: dict[str, CotacaoSeguro] = {}
        self.apolices: dict[str, Apolice] = {}

    async def cotar(self, pessoa: Pessoa, produto: str, params: dict) -> CotacaoSeguro:
        base, cob = self.TABELA[produto]
        idade = (_hoje() - dt.date.fromisoformat(pessoa.nascimento)).days // 365
        premio = round(base * (1.25 if idade > 50 else 1.0), 2)
        ct = CotacaoSeguro(cotacao_id=_id("cot"), produto=produto, premio_mensal=premio,
                           cobertura=cob, seguradora="Seguradora Mock S.A.",
                           valida_ate=(_hoje() + dt.timedelta(days=7)).isoformat())
        self.cotacoes[ct.cotacao_id] = ct
        return ct

    async def emitir(self, cotacao_id: str, cpf: str) -> Apolice:
        ct = self.cotacoes[cotacao_id]
        ap = Apolice(apolice_id=_id("apl"), cotacao_id=cotacao_id, cpf=cpf, produto=ct.produto,
                     premio_mensal=ct.premio_mensal, seguradora=ct.seguradora,
                     vigencia_inicio=_hoje().isoformat(),
                     vigencia_fim=(_hoje() + dt.timedelta(days=365)).isoformat())
        self.apolices[ap.apolice_id] = ap
        return ap

    async def sinistro(self, apolice_id: str, descricao: str) -> dict:
        ap = self.apolices[apolice_id]
        return {"protocolo": _id("sin"), "apolice_id": ap.apolice_id, "status": "EM_ANALISE",
                "prazo_regulacao_dias": 30}


# ------------------------------------------------------------------ saúde

class MockSaudeProvider(_Base):
    port = "saude"
    _caps = {C.SAUDE_COTAR, C.SAUDE_ADERIR}
    CARENCIA_MEI_MESES = 6         # ANS: coletivo empresarial exige MEI há 6 meses

    def __init__(self) -> None:
        self.cotacoes: dict[str, CotacaoSeguro] = {}
        self.apolices: dict[str, Apolice] = {}

    async def cotar(self, pessoa: Pessoa, params: dict) -> CotacaoSeguro:
        modalidade = "empresarial" if pessoa.cnpj_mei else "adesao"
        premio = 189.90 if modalidade == "empresarial" else 249.90
        ct = CotacaoSeguro(cotacao_id=_id("cot"), produto="saude", premio_mensal=premio,
                           cobertura={"modalidade": modalidade, "abrangencia": params.get("abrangencia", "regional"),
                                      "acomodacao": "enfermaria"},
                           seguradora="Operadora Mock", valida_ate=(_hoje() + dt.timedelta(days=7)).isoformat())
        self.cotacoes[ct.cotacao_id] = ct
        return ct

    async def aderir(self, cotacao_id: str, pessoa: Pessoa) -> Apolice:
        ct = self.cotacoes[cotacao_id]
        if ct.cobertura["modalidade"] == "empresarial":
            meses = int(pessoa.endereco.get("mei_meses", 0))   # quem chama passa a idade da MEI
            if meses < self.CARENCIA_MEI_MESES:
                raise ValueError(f"MEI precisa ter {self.CARENCIA_MEI_MESES} meses para plano empresarial")
        ap = Apolice(apolice_id=_id("apl"), cotacao_id=cotacao_id, cpf=pessoa.cpf, produto="saude",
                     premio_mensal=ct.premio_mensal, seguradora=ct.seguradora,
                     vigencia_inicio=_hoje().isoformat(),
                     vigencia_fim=(_hoje() + dt.timedelta(days=365)).isoformat())
        self.apolices[ap.apolice_id] = ap
        return ap


# ------------------------------------------------------------------ contador

class MockContadorProvider(_Base):
    port = "contador"
    _caps = {C.MEI_ABRIR, C.MEI_DAS, C.MEI_DASN, C.MEI_NFSE}
    DAS_MOTOBOY = 86.05            # INSS 5% SM + ISS R$5 (2026)

    def __init__(self) -> None:
        self.meis: dict[str, Mei] = {}

    async def abrir_mei(self, pessoa: Pessoa, cnae: str = "5320-2/02") -> Mei:
        base = "".join(ch for ch in pessoa.cpf if ch.isdigit())[:8]
        cnpj = f"{base}000199"
        m = Mei(cnpj=cnpj, cpf=pessoa.cpf, razao_social=f"{pessoa.nome} {base}",
                cnae=cnae, aberto_em=_hoje().isoformat())
        self.meis[cnpj] = m
        return m

    async def das(self, cnpj: str, competencia: str) -> GuiaDas:
        ano, mes = map(int, competencia.split("-"))
        venc = dt.date(ano + (mes // 12), (mes % 12) + 1, 20)
        return GuiaDas(competencia=competencia, valor=self.DAS_MOTOBOY, vencimento=venc.isoformat(),
                       codigo_barras="858" + hashlib.sha1(f"{cnpj}{competencia}".encode()).hexdigest()[:41])

    async def dasn(self, cnpj: str, ano: int, receita_bruta: float) -> dict:
        limite = 110_000 if ano >= 2027 else 81_000
        return {"cnpj": cnpj, "ano": ano, "receita_bruta": receita_bruta,
                "dentro_do_limite": receita_bruta <= limite, "limite": limite,
                "recibo": _id("dasn")}

    async def emitir_nfse(self, cnpj: str, tomador: dict, valor: float, descricao: str) -> dict:
        return {"numero": _id("nfse"), "cnpj": cnpj, "tomador": tomador.get("cnpj"),
                "valor": valor, "descricao": descricao, "emitida_em": _hoje().isoformat()}


# ------------------------------------------------------------------ renda

class MockRendaProvider(_Base):
    port = "renda"
    _caps = {C.RENDA_CONSENTIR, C.RENDA_LER}
    PERFIL = {"ifood": (2480.0, 186, 1900.0), "rappi": (640.0, 44, 420.0),
              "99": (910.0, 61, 700.0), "uber": (0.0, 0, 0.0), "open_finance": (4030.0, 0, 0.0)}

    def __init__(self) -> None:
        self.consentimentos: dict[str, ConsentimentoRenda] = {}

    async def consentir(self, cpf: str, fonte: str) -> ConsentimentoRenda:
        c = ConsentimentoRenda(consentimento_id=_id("cns"), cpf=cpf, fonte=fonte,
                               expira_em=(_hoje() + dt.timedelta(days=365)).isoformat())
        self.consentimentos[c.consentimento_id] = c
        return c

    async def renda(self, consentimento_id: str, meses: int = 3) -> list[RendaMensal]:
        c = self.consentimentos[consentimento_id]
        bruto, corridas, km = self.PERFIL.get(c.fonte, (0.0, 0, 0.0))
        out = []
        d = _hoje().replace(day=1)
        for i in range(meses):
            fator = 1 - 0.04 * i
            out.append(RendaMensal(competencia=d.strftime("%Y-%m"), fonte=c.fonte,
                                   bruto=round(bruto * fator, 2), corridas=int(corridas * fator),
                                   km=round(km * fator, 1)))
            d = (d - dt.timedelta(days=1)).replace(day=1)
        return out


FACTORIES = {
    "conta": MockContaProvider,
    "cartao": MockCartaoProvider,
    "kyc": MockKycProvider,
    "credito": MockCreditoProvider,
    "seguro": MockSeguroProvider,
    "saude": MockSaudeProvider,
    "contador": MockContadorProvider,
    "renda": MockRendaProvider,
}
