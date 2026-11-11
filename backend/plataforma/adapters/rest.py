"""
adapters/rest.py — adapter REST genérico, configurado por JSON.

É o que torna verdadeira a promessa do admin: cadastrar um BaaS novo (ou uma
seguradora, um emissor de cartão, um contador) SEM escrever código. O
administrador descreve, na tela, a API do fornecedor:

    {
      "base_url": "https://api.fornecedor.com",
      "auth": {"tipo": "oauth2_client_credentials",
               "token_url": "/oauth/token",
               "env_client_id": "FORN_CLIENT_ID",
               "env_client_secret": "FORN_CLIENT_SECRET",
               "campo_token": "access_token"},
      "idempotencia": {"header": "x-idempotency-key"},
      "operacoes": {
        "abrir_conta": {
          "metodo": "POST", "path": "/v1/accounts",
          "body": {"documentNumber": "{cpf}", "fullName": "{nome}",
                   "birthDate": "{nascimento}"},
          "resposta": {"conta_id": "data.id", "numero": "data.number",
                       "agencia": "data.branch"}
        },
        "saldo": {"metodo": "GET", "path": "/v1/accounts/{conta_id}/balance",
                  "resposta": {"valor": "data.available"}}
      }
    }

Três mecanismos, só:

- **Template** `{campo}` em path, query, header e body — preenchido com os
  argumentos da chamada (cpf, conta_id, valor, ...). Em body/query, um valor
  que seja exatamente "{campo}" preserva o tipo (float continua float).
- **Extração** por caminho pontilhado (`data.items.0.id`) para montar o objeto
  de domínio a partir da resposta.
- **Capabilities derivadas**: só o que está declarado em `operacoes` é
  oferecido. Logo o registry já sabe o que esse fornecedor cobre, e
  `verificar()` acusa se um produto ligado pede algo que ele não faz.

Segredos NUNCA ficam no catálogo: a config guarda o NOME da variável de
ambiente (`env_client_secret`), e o valor é lido do ambiente no momento da
chamada.
"""

from __future__ import annotations

import datetime as dt
import os
import time
import uuid
from typing import Any, Optional

import httpx

from ..ports import (Apolice, Capability as C, Cartao, Cobranca, ConsentimentoRenda,
                     Conta, ContratoCredito, CotacaoSeguro, GuiaDas, HealthStatus,
                     Lancamento, Mei, Pagamento, Pessoa, RendaMensal, ResultadoKyc)

# operação declarada -> capability que ela habilita
OPERACAO_CAPABILITY: dict[str, C] = {
    "abrir_conta": C.CONTA_ABRIR,
    "saldo": C.CONTA_SALDO,
    "extrato": C.CONTA_EXTRATO,
    "pix_enviar": C.PIX_ENVIAR,
    "cobrar": C.PIX_COBRAR,
    "pix_automatico": C.PIX_AUTOMATICO,
    "boleto": C.BOLETO_EMITIR,
    "creditar": C.CONTA_EXTRATO,
    "emitir_cartao": C.CARTAO_EMITIR,
    "ajustar_limite": C.CARTAO_LIMITE,
    "bloquear_cartao": C.CARTAO_BLOQUEAR,
    "validar_kyc": C.KYC_VALIDAR,
    "facematch": C.KYC_FACEMATCH,
    "emitir_ccb": C.CREDITO_EMITIR_CCB,
    "ceder": C.CREDITO_CEDER,
    "cotar_seguro": C.SEGURO_COTAR,
    "emitir_seguro": C.SEGURO_EMITIR,
    "sinistro": C.SEGURO_SINISTRO,
    "cotar_saude": C.SAUDE_COTAR,
    "aderir_saude": C.SAUDE_ADERIR,
    "abrir_mei": C.MEI_ABRIR,
    "das": C.MEI_DAS,
    "dasn": C.MEI_DASN,
    "nfse": C.MEI_NFSE,
    "consentir_renda": C.RENDA_CONSENTIR,
    "ler_renda": C.RENDA_LER,
}

# operações que cada port precisa para ser utilizável (validação no cadastro)
OPERACOES_POR_PORT: dict[str, tuple[str, ...]] = {
    "conta": ("abrir_conta", "saldo", "extrato", "pix_enviar", "cobrar", "creditar",
              "pix_automatico", "boleto"),
    "cartao": ("emitir_cartao", "ajustar_limite", "bloquear_cartao"),
    "kyc": ("validar_kyc", "facematch"),
    "credito": ("emitir_ccb", "ceder"),
    "seguro": ("cotar_seguro", "emitir_seguro", "sinistro"),
    "saude": ("cotar_saude", "aderir_saude"),
    "contador": ("abrir_mei", "das", "dasn", "nfse"),
    "renda": ("consentir_renda", "ler_renda"),
}


class OperacaoNaoConfigurada(NotImplementedError):
    pass


def _render(valor: Any, ctx: dict) -> Any:
    """Substitui {campo} preservando o tipo quando o valor é só o placeholder."""
    if isinstance(valor, str):
        if valor.startswith("{") and valor.endswith("}") and valor.count("{") == 1:
            chave = valor[1:-1]
            return ctx.get(chave)
        out = valor
        for k, v in ctx.items():
            out = out.replace("{" + k + "}", "" if v is None else str(v))
        return out
    if isinstance(valor, dict):
        return {k: _render(v, ctx) for k, v in valor.items()}
    if isinstance(valor, list):
        return [_render(v, ctx) for v in valor]
    return valor


def _extrair(doc: Any, caminho: str, default: Any = None) -> Any:
    """`data.items.0.id` -> doc["data"]["items"][0]["id"]."""
    atual = doc
    for parte in str(caminho).split("."):
        if atual is None:
            return default
        if isinstance(atual, list):
            try:
                atual = atual[int(parte)]
            except (ValueError, IndexError):
                return default
        elif isinstance(atual, dict):
            atual = atual.get(parte)
        else:
            return default
    return default if atual is None else atual


def _mapear(doc: Any, mapa: dict, ctx: Optional[dict] = None) -> dict:
    """Aplica o bloco `resposta`: destino -> caminho na resposta (ou literal)."""
    out: dict[str, Any] = {}
    for destino, origem in (mapa or {}).items():
        if isinstance(origem, str) and origem.startswith("="):      # literal/template
            out[destino] = _render(origem[1:], ctx or {})
        else:
            out[destino] = _extrair(doc, origem)
    return out


class RestProvider:
    """Base do adapter configurável. Um instância por (port, binding)."""

    def __init__(self, port: str, config: dict, nome: str = "rest") -> None:
        self.port = port
        self.nome = nome
        self.config = config or {}
        self.base = str(self.config.get("base_url", "")).rstrip("/")
        self.ops: dict[str, dict] = self.config.get("operacoes", {}) or {}
        self.auth: dict = self.config.get("auth", {}) or {}
        self.timeout = float(self.config.get("timeout_s", 20))
        self._tok: Optional[str] = None
        self._tok_exp = 0.0

    # -- introspecção ------------------------------------------------------
    def capabilities(self) -> set[C]:
        return {OPERACAO_CAPABILITY[o] for o in self.ops if o in OPERACAO_CAPABILITY}

    def operacoes_declaradas(self) -> list[str]:
        return sorted(self.ops)

    def segredos_faltando(self) -> list[str]:
        faltam = []
        for chave, valor in self.auth.items():
            if chave.startswith("env_") and valor and not os.environ.get(str(valor)):
                faltam.append(str(valor))
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
        hc = self.config.get("health", {})
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as c:
                if self.auth.get("tipo", "nenhum") != "nenhum":
                    await self._token(c)
                if hc.get("path"):
                    r = await c.request(hc.get("metodo", "GET"), f"{self.base}{hc['path']}",
                                        headers=await self._headers(c))
                    r.raise_for_status()
            return HealthStatus(self.nome, self.port, True,
                                round((time.perf_counter() - t0) * 1000, 1))
        except Exception as e:
            return HealthStatus(self.nome, self.port, False, detalhe=str(e))

    # -- HTTP --------------------------------------------------------------
    async def _token(self, c: httpx.AsyncClient) -> Optional[str]:
        tipo = self.auth.get("tipo", "nenhum")
        if tipo in ("nenhum", "", None):
            return None
        if tipo == "api_key":
            return os.environ.get(str(self.auth.get("env_api_key", "")), "")
        if tipo == "basic":
            return None                                   # tratado em _headers
        if tipo != "oauth2_client_credentials":
            raise ValueError(f"auth.tipo '{tipo}' não suportado")
        if self._tok and time.time() < self._tok_exp - 30:
            return self._tok
        cid = os.environ.get(str(self.auth.get("env_client_id", "")), "")
        secret = os.environ.get(str(self.auth.get("env_client_secret", "")), "")
        if not (cid and secret):
            raise RuntimeError("credenciais do fornecedor não configuradas no ambiente")
        url = str(self.auth.get("token_url", "/oauth/token"))
        if not url.startswith("http"):
            url = f"{self.base}{url}"
        payload = {"grant_type": self.auth.get("grant_type", "client_credentials"),
                   "client_id": cid, "client_secret": secret}
        if self.auth.get("scope"):
            payload["scope"] = self.auth["scope"]
        r = await c.post(url, data=payload)
        r.raise_for_status()
        data = r.json()
        self._tok = _extrair(data, self.auth.get("campo_token", "access_token"))
        self._tok_exp = time.time() + float(data.get("expires_in", 1800))
        return self._tok

    async def _headers(self, c: httpx.AsyncClient, idem: Optional[str] = None) -> dict:
        headers = dict(self.config.get("headers", {}) or {})
        tipo = self.auth.get("tipo", "nenhum")
        if tipo == "api_key":
            headers[str(self.auth.get("header", "x-api-key"))] = await self._token(c) or ""
        elif tipo == "basic":
            import base64
            u = os.environ.get(str(self.auth.get("env_usuario", "")), "")
            p = os.environ.get(str(self.auth.get("env_senha", "")), "")
            headers["Authorization"] = "Basic " + base64.b64encode(f"{u}:{p}".encode()).decode()
        elif tipo == "oauth2_client_credentials":
            headers["Authorization"] = f"Bearer {await self._token(c)}"
        if idem:
            headers[str(self.config.get("idempotencia", {}).get("header", "x-idempotency-key"))] = idem
        return headers

    async def chamar(self, operacao: str, ctx: dict, idem: Optional[str] = None) -> tuple[Any, dict]:
        """Executa a operação declarada. Devolve (json bruto, campos mapeados)."""
        op = self.ops.get(operacao)
        if not op:
            raise OperacaoNaoConfigurada(
                f"operação '{operacao}' não configurada para o fornecedor '{self.nome}' ({self.port})")
        if not self.base:
            raise RuntimeError(f"base_url não configurada para '{self.nome}'")
        metodo = str(op.get("metodo", "POST")).upper()
        path = _render(str(op.get("path", "/")), ctx)
        kwargs: dict[str, Any] = {}
        if op.get("query"):
            kwargs["params"] = {k: v for k, v in _render(op["query"], ctx).items() if v is not None}
        if op.get("body") and metodo in ("POST", "PUT", "PATCH"):
            kwargs["json"] = _render(op["body"], ctx)
        async with httpx.AsyncClient(timeout=self.timeout) as c:
            headers = await self._headers(c, idem)
            headers.update(_render(op.get("headers", {}) or {}, ctx))
            r = await c.request(metodo, f"{self.base}{path}", headers=headers, **kwargs)
            r.raise_for_status()
            doc = r.json() if r.content else {}
        return doc, _mapear(doc, op.get("resposta", {}), ctx)


# --------------------------------------------------------------- por port

def _agora_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


class RestContaProvider(RestProvider):
    def __init__(self, config: dict, nome: str = "rest") -> None:
        super().__init__("conta", config, nome)

    async def abrir_conta(self, pessoa: Pessoa) -> Conta:
        ctx = {**pessoa.__dict__, "cliente_ref": f"bmoto-{pessoa.cpf}"}
        _, m = await self.chamar("abrir_conta", ctx)
        return Conta(conta_id=str(m.get("conta_id") or ""), titular_cpf=pessoa.cpf,
                     provider=self.nome, agencia=str(m.get("agencia") or ""),
                     numero=str(m.get("numero") or ""), chave_pix=m.get("chave_pix"),
                     status=str(m.get("status") or "ATIVA"))

    async def saldo(self, conta_id: str) -> float:
        _, m = await self.chamar("saldo", {"conta_id": conta_id})
        return float(m.get("valor") or 0.0)

    async def extrato(self, conta_id: str, desde: Optional[str] = None) -> list[Lancamento]:
        doc, _ = await self.chamar("extrato", {"conta_id": conta_id, "desde": desde})
        op = self.ops["extrato"]
        itens = _extrair(doc, op.get("lista", "items"), []) or []
        mapa = op.get("item", {})
        out: list[Lancamento] = []
        for it in itens:
            m = _mapear(it, mapa)
            valor = float(m.get("valor") or 0.0)
            if str(m.get("tipo", "")).upper().startswith("DEB") and valor > 0:
                valor = -valor
            out.append(Lancamento(lancamento_id=str(m.get("lancamento_id") or uuid.uuid4().hex[:10]),
                                  conta_id=conta_id, valor=valor,
                                  descricao=str(m.get("descricao") or ""),
                                  categoria=str(m.get("categoria") or "outros"),
                                  ocorrido_em=str(m.get("ocorrido_em") or _agora_iso()),
                                  origem=m.get("origem")))
        return out

    async def pix_enviar(self, conta_id: str, valor: float, chave: str,
                         idempotency_key: str) -> Pagamento:
        pg = Pagamento(pagamento_id=f"pix_{uuid.uuid4().hex[:10]}", conta_id=conta_id,
                       valor=valor, destino=chave, idempotency_key=idempotency_key)
        try:
            _, m = await self.chamar("pix_enviar",
                                     {"conta_id": conta_id, "valor": valor, "chave": chave,
                                      "idempotency_key": idempotency_key},
                                     idem=idempotency_key)
            pg.provider_tx_id = str(m.get("provider_tx_id") or "")
            pg.status = str(m.get("status") or "ENVIADO").upper()
        except Exception as e:
            pg.status, pg.erro = "FALHOU", str(e)
        return pg

    async def cobrar(self, conta_id: str, valor: float, vencimento: str,
                     tipo: str = "pix") -> Cobranca:
        op = "boleto" if tipo == "boleto" and "boleto" in self.ops else "cobrar"
        _, m = await self.chamar(op, {"conta_id": conta_id, "valor": valor,
                                      "vencimento": vencimento, "tipo": tipo})
        return Cobranca(cobranca_id=str(m.get("cobranca_id") or ""), conta_id=conta_id,
                        valor=valor, vencimento=vencimento, tipo=tipo,
                        payload=m.get("payload"), status=str(m.get("status") or "ABERTA"))

    async def creditar(self, conta_id: str, valor: float, descricao: str,
                       origem: Optional[str] = None,
                       idempotency_key: Optional[str] = None) -> Lancamento:
        _, m = await self.chamar("creditar", {"conta_id": conta_id, "valor": valor,
                                              "descricao": descricao, "origem": origem,
                                              "idempotency_key": idempotency_key},
                                 idem=idempotency_key)
        return Lancamento(lancamento_id=str(m.get("lancamento_id") or uuid.uuid4().hex[:10]),
                          conta_id=conta_id, valor=abs(valor), descricao=descricao,
                          categoria="repasse_app" if origem else "pix", origem=origem)


class RestCartaoProvider(RestProvider):
    def __init__(self, config: dict, nome: str = "rest") -> None:
        super().__init__("cartao", config, nome)

    async def emitir(self, conta_id: str, modalidade: str, limite: float,
                     garantia: Optional[dict] = None) -> Cartao:
        _, m = await self.chamar("emitir_cartao",
                                 {"conta_id": conta_id, "modalidade": modalidade,
                                  "limite": limite, "garantia": garantia})
        return Cartao(cartao_id=str(m.get("cartao_id") or ""), conta_id=conta_id,
                      provider=self.nome, modalidade=modalidade,
                      limite=float(m.get("limite") or limite), garantia=garantia,
                      status=str(m.get("status") or "ATIVO"),
                      ultimos4=str(m.get("ultimos4") or "0000"))

    async def ajustar_limite(self, cartao_id: str, limite: float) -> Cartao:
        _, m = await self.chamar("ajustar_limite", {"cartao_id": cartao_id, "limite": limite})
        return Cartao(cartao_id=cartao_id, conta_id=str(m.get("conta_id") or ""),
                      provider=self.nome, limite=float(m.get("limite") or limite))

    async def bloquear(self, cartao_id: str, motivo: str) -> Cartao:
        _, m = await self.chamar("bloquear_cartao", {"cartao_id": cartao_id, "motivo": motivo})
        return Cartao(cartao_id=cartao_id, conta_id=str(m.get("conta_id") or ""),
                      provider=self.nome, status="BLOQUEADO")


class RestKycProvider(RestProvider):
    def __init__(self, config: dict, nome: str = "rest") -> None:
        super().__init__("kyc", config, nome)

    async def validar(self, pessoa: Pessoa, selfie_b64: Optional[str] = None,
                      documento_b64: Optional[str] = None) -> ResultadoKyc:
        _, m = await self.chamar("validar_kyc", {**pessoa.__dict__, "selfie": selfie_b64,
                                                 "documento": documento_b64})
        aprovado = m.get("aprovado")
        if isinstance(aprovado, str):
            aprovado = aprovado.lower() in ("true", "aprovado", "approved", "ok", "1")
        return ResultadoKyc(cpf=pessoa.cpf, aprovado=bool(aprovado),
                            score=float(m.get("score") or 0.0),
                            motivos=list(m.get("motivos") or []), provider=self.nome)


class RestCreditoProvider(RestProvider):
    def __init__(self, config: dict, nome: str = "rest") -> None:
        super().__init__("credito", config, nome)

    async def emitir_ccb(self, cpf: str, produto: str, principal: float, taxa_mensal: float,
                         parcelas: int, idempotency_key: str) -> ContratoCredito:
        ctx = {"cpf": cpf, "produto": produto, "principal": principal,
               "taxa_mensal": taxa_mensal, "parcelas": parcelas,
               "idempotency_key": idempotency_key}
        _, m = await self.chamar("emitir_ccb", ctx, idem=idempotency_key)
        i = taxa_mensal
        pmt = m.get("parcela") or (principal * i / (1 - (1 + i) ** -parcelas) if i > 0
                                   else principal / parcelas)
        return ContratoCredito(contrato_id=str(m.get("contrato_id") or ""), cpf=cpf,
                               produto=produto, principal=principal, taxa_mensal=i,
                               parcelas=parcelas, parcela=round(float(pmt), 2),
                               cet_anual=float(m.get("cet_anual") or round((1 + i) ** 12 - 1, 4)),
                               ccb_url=m.get("ccb_url"),
                               status=str(m.get("status") or "EMITIDO"))

    async def ceder(self, contrato_id: str, cessionario: str) -> ContratoCredito:
        _, m = await self.chamar("ceder", {"contrato_id": contrato_id, "cessionario": cessionario})
        return ContratoCredito(contrato_id=contrato_id, cpf=str(m.get("cpf") or ""),
                               produto=str(m.get("produto") or ""), principal=0.0,
                               taxa_mensal=0.0, parcelas=0, parcela=0.0, cet_anual=0.0,
                               status="CEDIDO", cessionario=cessionario)


class RestSeguroProvider(RestProvider):
    def __init__(self, config: dict, nome: str = "rest") -> None:
        super().__init__("seguro", config, nome)

    async def cotar(self, pessoa: Pessoa, produto: str, params: dict) -> CotacaoSeguro:
        _, m = await self.chamar("cotar_seguro", {**pessoa.__dict__, "produto": produto, **params})
        return CotacaoSeguro(cotacao_id=str(m.get("cotacao_id") or ""), produto=produto,
                             premio_mensal=float(m.get("premio_mensal") or 0.0),
                             cobertura=dict(m.get("cobertura") or {}),
                             seguradora=str(m.get("seguradora") or self.nome),
                             valida_ate=str(m.get("valida_ate") or ""))

    async def emitir(self, cotacao_id: str, cpf: str) -> Apolice:
        _, m = await self.chamar("emitir_seguro", {"cotacao_id": cotacao_id, "cpf": cpf})
        return Apolice(apolice_id=str(m.get("apolice_id") or ""), cotacao_id=cotacao_id, cpf=cpf,
                       produto=str(m.get("produto") or ""),
                       premio_mensal=float(m.get("premio_mensal") or 0.0),
                       seguradora=str(m.get("seguradora") or self.nome),
                       vigencia_inicio=str(m.get("vigencia_inicio") or ""),
                       vigencia_fim=str(m.get("vigencia_fim") or ""))

    async def sinistro(self, apolice_id: str, descricao: str) -> dict:
        doc, m = await self.chamar("sinistro", {"apolice_id": apolice_id, "descricao": descricao})
        return m or doc


class RestSaudeProvider(RestProvider):
    def __init__(self, config: dict, nome: str = "rest") -> None:
        super().__init__("saude", config, nome)

    async def cotar(self, pessoa: Pessoa, params: dict) -> CotacaoSeguro:
        _, m = await self.chamar("cotar_saude", {**pessoa.__dict__, **params})
        return CotacaoSeguro(cotacao_id=str(m.get("cotacao_id") or ""), produto="saude",
                             premio_mensal=float(m.get("premio_mensal") or 0.0),
                             cobertura=dict(m.get("cobertura") or {}),
                             seguradora=str(m.get("seguradora") or self.nome),
                             valida_ate=str(m.get("valida_ate") or ""))

    async def aderir(self, cotacao_id: str, pessoa: Pessoa) -> Apolice:
        _, m = await self.chamar("aderir_saude", {"cotacao_id": cotacao_id, **pessoa.__dict__})
        return Apolice(apolice_id=str(m.get("apolice_id") or ""), cotacao_id=cotacao_id,
                       cpf=pessoa.cpf, produto="saude",
                       premio_mensal=float(m.get("premio_mensal") or 0.0),
                       seguradora=str(m.get("seguradora") or self.nome),
                       vigencia_inicio=str(m.get("vigencia_inicio") or ""),
                       vigencia_fim=str(m.get("vigencia_fim") or ""))


class RestContadorProvider(RestProvider):
    def __init__(self, config: dict, nome: str = "rest") -> None:
        super().__init__("contador", config, nome)

    async def abrir_mei(self, pessoa: Pessoa, cnae: str) -> Mei:
        _, m = await self.chamar("abrir_mei", {**pessoa.__dict__, "cnae": cnae})
        return Mei(cnpj=str(m.get("cnpj") or ""), cpf=pessoa.cpf,
                   razao_social=str(m.get("razao_social") or pessoa.nome), cnae=cnae,
                   aberto_em=str(m.get("aberto_em") or ""),
                   status=str(m.get("status") or "ATIVO"))

    async def das(self, cnpj: str, competencia: str) -> GuiaDas:
        _, m = await self.chamar("das", {"cnpj": cnpj, "competencia": competencia})
        return GuiaDas(competencia=competencia, valor=float(m.get("valor") or 0.0),
                       vencimento=str(m.get("vencimento") or ""),
                       codigo_barras=str(m.get("codigo_barras") or ""),
                       status=str(m.get("status") or "ABERTA"))

    async def dasn(self, cnpj: str, ano: int, receita_bruta: float) -> dict:
        doc, m = await self.chamar("dasn", {"cnpj": cnpj, "ano": ano, "receita_bruta": receita_bruta})
        return m or doc

    async def emitir_nfse(self, cnpj: str, tomador: dict, valor: float, descricao: str) -> dict:
        doc, m = await self.chamar("nfse", {"cnpj": cnpj, "tomador": tomador,
                                            "valor": valor, "descricao": descricao})
        return m or doc


class RestRendaProvider(RestProvider):
    def __init__(self, config: dict, nome: str = "rest") -> None:
        super().__init__("renda", config, nome)

    async def consentir(self, cpf: str, fonte: str) -> ConsentimentoRenda:
        _, m = await self.chamar("consentir_renda", {"cpf": cpf, "fonte": fonte})
        return ConsentimentoRenda(consentimento_id=str(m.get("consentimento_id") or ""),
                                  cpf=cpf, fonte=fonte,
                                  status=str(m.get("status") or "AUTORIZADO"),
                                  expira_em=m.get("expira_em"))

    async def renda(self, consentimento_id: str, meses: int = 3) -> list[RendaMensal]:
        doc, _ = await self.chamar("ler_renda", {"consentimento_id": consentimento_id,
                                                 "meses": meses})
        op = self.ops["ler_renda"]
        itens = _extrair(doc, op.get("lista", "items"), []) or []
        out = []
        for it in itens:
            m = _mapear(it, op.get("item", {}))
            out.append(RendaMensal(competencia=str(m.get("competencia") or ""),
                                   fonte=str(m.get("fonte") or ""),
                                   bruto=float(m.get("bruto") or 0.0),
                                   corridas=int(m.get("corridas") or 0),
                                   km=float(m.get("km") or 0.0)))
        return out


CLASSES_POR_PORT: dict[str, type[RestProvider]] = {
    "conta": RestContaProvider,
    "cartao": RestCartaoProvider,
    "kyc": RestKycProvider,
    "credito": RestCreditoProvider,
    "seguro": RestSeguroProvider,
    "saude": RestSaudeProvider,
    "contador": RestContadorProvider,
    "renda": RestRendaProvider,
}


def construir(port: str, config: dict, nome: str = "rest") -> RestProvider:
    try:
        classe = CLASSES_POR_PORT[port]
    except KeyError:
        raise KeyError(f"port '{port}' não tem adapter REST genérico")
    return classe(config, nome)
