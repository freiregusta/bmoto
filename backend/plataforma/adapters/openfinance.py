"""
adapters/openfinance.py — renda pelo Open Finance Brasil.

O fluxo do ecossistema de dados, na ordem em que acontece:

1. **Consentimento**: pedimos as permissões de contas, saldos e transações.
   A API devolve um `consentId`.
2. **Autorização**: o entregador é levado ao banco dele, autentica e autoriza.
   É ele quem permite — nada é lido às escondidas.
3. **Leitura**: com o consentimento autorizado, listamos as contas e as
   transações, e o classificador (`plataforma/openfinance.py`) separa o que é
   repasse de plataforma de entrega.

Quem pode consumir isso mudou: a **Resolução Conjunta nº 21**, em vigor desde
26/10/2026, trata empresa não autorizada que reusa os dados no próprio produto
como *parceira* — exige consentimento nominal, contrato e certificação anual
por auditor registrado na CVM. Daí as duas portas que este adapter atende, com
a mesma interface:

- `modo="direto"`: a instituição autorizada é quem transmite (ex.: o banco
  parceiro como receptora, com a BMoto operando sob contrato).
- `modo="agregador"`: um participante contratado (Klavi, Belvo, Pluggy) expõe
  a mesma informação pela API dele.

Nada de credencial em código: tudo entra por nome de variável de ambiente,
inclusive os caminhos dos certificados mTLS que o ecossistema exige.
"""

from __future__ import annotations

import os
import time
from typing import Any, Optional

import httpx

from ..openfinance import Transacao
from ..ports import Capability as C, ConsentimentoRenda, HealthStatus, RendaMensal

PERMISSOES_PADRAO = [
    "ACCOUNTS_READ",
    "ACCOUNTS_BALANCES_READ",
    "ACCOUNTS_TRANSACTIONS_READ",
    "RESOURCES_READ",
]


class OpenFinanceRendaProvider:
    """RendaProvider sobre o Open Finance (direto ou via agregador)."""

    port = "renda"

    def __init__(self, config: Optional[dict] = None, nome: str = "open_finance") -> None:
        self.nome = nome
        self.config = config or {}
        self.modo = str(self.config.get("modo", "direto"))
        self.base = str(self.config.get("base_url", "")).rstrip("/")
        self.auth = self.config.get("auth", {}) or {}
        self.timeout = float(self.config.get("timeout_s", 30))
        self.permissoes = list(self.config.get("permissoes") or PERMISSOES_PADRAO)
        # Validade do consentimento em dias (o ecossistema permite até 12 meses).
        self.validade_dias = int(self.config.get("validade_dias", 365))
        self._tok: Optional[str] = None
        self._tok_exp = 0.0

    # -- introspecção ------------------------------------------------------
    def capabilities(self) -> set[C]:
        return {C.RENDA_CONSENTIR, C.RENDA_LER}

    def segredos_faltando(self) -> list[str]:
        faltam = []
        for chave, valor in self.auth.items():
            if chave.startswith("env_") and valor and not os.environ.get(str(valor)):
                faltam.append(str(valor))
        for chave in ("env_certificado", "env_chave_privada"):
            nome = self.config.get(chave)
            if nome and not os.environ.get(str(nome)):
                faltam.append(str(nome))
        return faltam

    def configurado(self) -> bool:
        return bool(self.base) and not self.segredos_faltando()

    async def health(self) -> HealthStatus:
        if not self.base:
            return HealthStatus(self.nome, self.port, False, detalhe="base_url não configurada")
        faltam = self.segredos_faltando()
        if faltam:
            return HealthStatus(self.nome, self.port, False,
                                detalhe=f"variáveis de ambiente ausentes: {', '.join(faltam)}")
        t0 = time.perf_counter()
        try:
            async with self._cliente() as c:
                await self._token(c)
            return HealthStatus(self.nome, self.port, True,
                                round((time.perf_counter() - t0) * 1000, 1))
        except Exception as e:
            return HealthStatus(self.nome, self.port, False, detalhe=str(e))

    # -- HTTP --------------------------------------------------------------
    def _cliente(self) -> httpx.AsyncClient:
        """O ecossistema exige mTLS: certificado e chave vêm do ambiente."""
        cert_path = os.environ.get(str(self.config.get("env_certificado", "")), "")
        chave_path = os.environ.get(str(self.config.get("env_chave_privada", "")), "")
        cert: Any = (cert_path, chave_path) if cert_path and chave_path else None
        return httpx.AsyncClient(timeout=self.timeout, cert=cert)

    async def _token(self, c: httpx.AsyncClient) -> str:
        if self._tok and time.time() < self._tok_exp - 30:
            return self._tok
        cid = os.environ.get(str(self.auth.get("env_client_id", "")), "")
        secret = os.environ.get(str(self.auth.get("env_client_secret", "")), "")
        if not cid:
            raise RuntimeError("credenciais do Open Finance não configuradas no ambiente")
        url = str(self.auth.get("token_url", "/token"))
        if not url.startswith("http"):
            url = f"{self.base}{url}"
        dados = {"grant_type": "client_credentials",
                 "scope": self.auth.get("scope", "consents accounts resources"),
                 "client_id": cid}
        if secret:
            dados["client_secret"] = secret
        r = await c.post(url, data=dados)
        r.raise_for_status()
        corpo = r.json()
        self._tok = corpo["access_token"]
        self._tok_exp = time.time() + float(corpo.get("expires_in", 900))
        return self._tok

    async def _get(self, c: httpx.AsyncClient, caminho: str, **kw) -> dict:
        r = await c.get(f"{self.base}{caminho}",
                        headers={"Authorization": f"Bearer {await self._token(c)}",
                                 "Accept": "application/json"}, **kw)
        r.raise_for_status()
        return r.json()

    # -- RendaProvider -----------------------------------------------------
    async def consentir(self, cpf: str, fonte: str = "open_finance") -> ConsentimentoRenda:
        """Cria o consentimento.

        O entregador ainda precisa AUTORIZAR no banco dele: a URL para isso vai
        no atributo `url_autorizacao`, que o app usa para redirecionar."""
        import datetime as dt

        expira = (dt.datetime.now(dt.timezone.utc)
                  + dt.timedelta(days=self.validade_dias)).isoformat()
        caminho = str(self.config.get("path_consentimento", "/consents/v3/consents"))
        corpo = {
            "data": {
                "loggedUser": {"document": {"identification": "".join(filter(str.isdigit, cpf)),
                                            "rel": "CPF"}},
                "permissions": self.permissoes,
                "expirationDateTime": expira,
            }
        }
        async with self._cliente() as c:
            r = await c.post(f"{self.base}{caminho}", json=corpo,
                             headers={"Authorization": f"Bearer {await self._token(c)}",
                                      "Content-Type": "application/json"})
            r.raise_for_status()
            dados = r.json().get("data", {})

        consentimento = ConsentimentoRenda(
            consentimento_id=str(dados.get("consentId") or dados.get("consent_id") or ""),
            cpf=cpf, fonte=fonte,
            status=str(dados.get("status") or "AWAITING_AUTHORISATION"),
            expira_em=str(dados.get("expirationDateTime") or expira),
        )
        # O app precisa disto para mandar a pessoa autorizar no banco dela.
        setattr(consentimento, "url_autorizacao",
                dados.get("authorisationUrl") or self._url_autorizacao(consentimento.consentimento_id))
        return consentimento

    def _url_autorizacao(self, consent_id: str) -> str:
        modelo = str(self.config.get("url_autorizacao", ""))
        return modelo.replace("{consentimento_id}", consent_id) if modelo else ""

    async def renda(self, consentimento_id: str, meses: int = 3) -> list[RendaMensal]:
        """Lê as transações e devolve a renda mensal JÁ CLASSIFICADA.

        Precisa das regras de identificação, que vivem no catálogo — por isso
        consulta o catálogo aqui: é ele quem sabe quais CNPJs e nomes são de
        plataforma de entrega.
        """
        from ..catalogo import catalogo
        from ..openfinance import classificar, regras_do_catalogo

        transacoes = await self.transacoes(consentimento_id, meses)
        c = classificar(transacoes, regras_do_catalogo(catalogo.apps_entrega(False)))

        saida: list[RendaMensal] = []
        for app in c.por_app.values():
            for competencia, bruto in app.competencias.items():
                saida.append(RendaMensal(competencia=competencia, fonte=app.slug, bruto=bruto))
        return sorted(saida, key=lambda r: r.competencia, reverse=True)

    async def transacoes(self, consentimento_id: str, meses: int = 3) -> list[Transacao]:
        """Contas do consentimento + transações de cada uma, em formato neutro."""
        import datetime as dt

        desde = (dt.date.today() - dt.timedelta(days=31 * meses)).isoformat()
        p_contas = str(self.config.get("path_contas", "/accounts/v2/accounts"))
        p_trans = str(self.config.get("path_transacoes",
                                      "/accounts/v2/accounts/{conta_id}/transactions"))

        out: list[Transacao] = []
        async with self._cliente() as c:
            contas = (await self._get(c, p_contas)).get("data", [])
            for conta in contas:
                conta_id = str(conta.get("accountId") or conta.get("account_id") or "")
                if not conta_id:
                    continue
                pagina = 1
                while True:
                    doc = await self._get(
                        c, p_trans.replace("{conta_id}", conta_id),
                        params={"fromBookingDate": desde, "page": pagina,
                                "page-size": 200})
                    for t in doc.get("data", []):
                        transacao = _para_transacao(t, conta_id)
                        if transacao:
                            out.append(transacao)
                    links = doc.get("links", {}) or {}
                    if not links.get("next") or pagina >= int(self.config.get("max_paginas", 10)):
                        break
                    pagina += 1
        return out


def _para_transacao(t: dict, conta_id: str) -> Optional[Transacao]:
    """Traduz a transação do padrão OFB para o formato neutro do classificador."""
    valor = t.get("transactionAmount", t.get("amount"))
    if isinstance(valor, dict):
        valor = valor.get("amount")
    try:
        v = float(str(valor).replace(",", "."))
    except (TypeError, ValueError):
        return None
    # No padrão, CREDITO entra e DEBITO sai.
    if str(t.get("creditDebitType", "")).upper().startswith("DEB"):
        v = -abs(v)

    contraparte = t.get("partieCnpjCpf") or t.get("payerCnpjCpf") or ""
    nome = (t.get("partiePersonType") and t.get("partieName")) or t.get("payerName") or ""
    return Transacao(
        id=str(t.get("transactionId") or t.get("transaction_id") or ""),
        data=str(t.get("transactionDateTime") or t.get("bookingDate")
                 or t.get("transactionDate") or "")[:10],
        valor=round(v, 2),
        descricao=str(t.get("transactionName") or t.get("remittanceInformation") or ""),
        pagador_nome=str(nome or ""),
        pagador_documento=str(contraparte or ""),
        tipo=str(t.get("type") or ""),
        conta_id=conta_id,
    )
