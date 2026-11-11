"""
catalogo.py — o que o administrador cadastra, persistido.

Quatro cadastros, todos editáveis em runtime pelo /admin, sem deploy:

1. **Conexões (bindings)**: qual fornecedor atende qual port, e em qual escopo.
   Escopo `global` vale para tudo; escopo `produto:<id>` vale só naquele
   módulo — é assim que "cadastrar qualquer BaaS para qualquer módulo"
   funciona: o cartão pode estar na Dock enquanto a conta está na Celcoin.

2. **Produtos de crédito**: paramétricos (taxa, prazo, ticket, garantia/LTV,
   política de crédito, emissor). Cartão, financiamento de moto, crédito
   pessoal, antecipação de recebíveis e consignado saem do mesmo molde.

3. **Apps de entrega**: iFood, Rappi, 99, Uber e qualquer outro — tipo de
   integração, credenciais por variável de ambiente, mapeamento de campos e
   forma de repasse.

4. **Módulos**: liga/desliga, ordem, título e qual jornada cada um usa.

Regras que valem para tudo:
- Segredo nunca entra no banco: guardamos o NOME da variável de ambiente.
- Nada é apagado de verdade sem pedido explícito: `ativo=False` desliga.
- Toda escrita vira registro de auditoria (quem, quando, o quê).
"""

from __future__ import annotations

import datetime as dt
import os
import re
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from persistencia import JsonStore

from .adapters import SPECS, construir as construir_adapter
from .ports import PORTS, Capability
from .produtos import PRODUTOS, ProdutoManifest

TIPOS_PRODUTO_CREDITO = (
    "financiamento_moto", "cartao_garantido", "cartao_credito", "credito_pessoal",
    "antecipacao_recebiveis", "consignado_clt", "consignado_app", "financiamento_celular",
)
TIPOS_INTEGRACAO_APP = ("api", "open_finance", "webhook", "arquivo", "manual")


def _agora() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _slug(texto: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", str(texto).strip().lower()).strip("_")
    return s or uuid.uuid4().hex[:8]


# --------------------------------------------------------------- registros

@dataclass
class Conexao:
    """Fornecedor ligado a um port, globalmente ou num módulo específico."""
    id: str
    port: str
    tipo: str                               # mock | rest | celcoin | ...
    titulo: str = ""
    escopo: str = "global"                  # global | produto:<id>
    config: dict = field(default_factory=dict)
    ativo: bool = True
    prioridade: int = 100                   # menor vence quando há empate
    ambiente: str = "sandbox"               # sandbox | producao
    criado_em: str = field(default_factory=_agora)
    atualizado_em: str = field(default_factory=_agora)
    observacao: str = ""

    def produto_alvo(self) -> Optional[str]:
        return self.escopo.split(":", 1)[1] if self.escopo.startswith("produto:") else None


@dataclass
class ProdutoCredito:
    """Produto de crédito paramétrico. O motor de oferta lê daqui."""
    id: str
    nome: str
    tipo: str                               # ver TIPOS_PRODUTO_CREDITO
    taxa_mensal: float = 0.0199
    prazo_min: int = 6
    prazo_max: int = 48
    ticket_min: float = 500.0
    ticket_max: float = 30_000.0
    # garantia
    garantia_tipo: Optional[str] = None     # moto | recebiveis | nenhuma
    ltv_max: float = 0.0                    # limite = ltv * valor da garantia
    # política de crédito
    score_minimo: int = 500
    renda_minima: float = 1_200.0
    comprometimento_max: float = 0.30       # parcela / renda média
    idade_min: int = 18
    idade_max: int = 70
    exige_mei: bool = False
    exige_kyc: bool = True
    meses_renda_comprovada: int = 3
    # custos e receita
    tac: float = 0.0
    seguro_embutido: Optional[str] = None   # id do produto de seguro
    iof_diario: float = 0.000082
    iof_fixo: float = 0.0038
    # operação
    emissor_conexao_id: Optional[str] = None    # conexão do port "credito"
    cobranca: str = "pix_automatico"        # pix_automatico | boleto | desconto_repasse
    jornada_id: Optional[str] = None
    modulo_id: Optional[str] = None         # em qual módulo do app aparece
    ativo: bool = True
    criado_em: str = field(default_factory=_agora)
    atualizado_em: str = field(default_factory=_agora)

    # -- motor de cálculo ------------------------------------------------
    def parcela(self, principal: float, parcelas: int) -> float:
        i = self.taxa_mensal
        if i <= 0:
            return round(principal / parcelas, 2)
        return round(principal * i / (1 - (1 + i) ** -parcelas), 2)

    def cet_anual(self, principal: float, parcelas: int) -> float:
        """CET aproximado: taxa que zera o fluxo com TAC e IOF embutidos."""
        liberado = principal - self.tac - principal * self.iof_fixo
        pmt = self.parcela(principal, parcelas)
        if liberado <= 0 or pmt <= 0:
            return 0.0
        lo, hi = 0.0, 1.0
        for _ in range(80):                     # bissecção na taxa mensal
            m = (lo + hi) / 2
            vp = sum(pmt / (1 + m) ** k for k in range(1, parcelas + 1))
            if vp > liberado:
                lo = m
            else:
                hi = m
        return round((1 + (lo + hi) / 2) ** 12 - 1, 4)

    def limite_por_garantia(self, valor_garantia: float) -> float:
        return round(valor_garantia * self.ltv_max, 2) if self.ltv_max else 0.0

    def limite_por_renda(self, renda_media: float, parcelas: Optional[int] = None) -> float:
        """Maior principal cujo parcelamento caiba no comprometimento máximo."""
        n = parcelas or self.prazo_max
        cap = renda_media * self.comprometimento_max
        i = self.taxa_mensal
        if cap <= 0:
            return 0.0
        principal = cap * n if i <= 0 else cap * (1 - (1 + i) ** -n) / i
        return round(min(principal, self.ticket_max), 2)

    def avaliar(self, *, score: int, renda_media: float, idade: int,
                tem_mei: bool = False, kyc_ok: bool = True,
                meses_renda: int = 12, valor_garantia: float = 0.0,
                solicitado: Optional[float] = None,
                parcelas: Optional[int] = None) -> dict:
        """Decisão + oferta. É o que a jornada chama no passo de oferta."""
        recusas: list[str] = []
        if not self.ativo:
            recusas.append("produto_inativo")
        if score < self.score_minimo:
            recusas.append("score_abaixo_do_minimo")
        if renda_media < self.renda_minima:
            recusas.append("renda_abaixo_do_minimo")
        if not (self.idade_min <= idade <= self.idade_max):
            recusas.append("idade_fora_da_politica")
        if self.exige_mei and not tem_mei:
            recusas.append("exige_mei_ativa")
        if self.exige_kyc and not kyc_ok:
            recusas.append("kyc_reprovado")
        if meses_renda < self.meses_renda_comprovada:
            recusas.append("historico_de_renda_insuficiente")
        if self.garantia_tipo and self.garantia_tipo != "nenhuma" and valor_garantia <= 0:
            recusas.append("garantia_obrigatoria")

        n = max(self.prazo_min, min(parcelas or self.prazo_max, self.prazo_max))
        limites = [self.limite_por_renda(renda_media, n), self.ticket_max]
        if self.ltv_max and valor_garantia > 0:
            limites.append(self.limite_por_garantia(valor_garantia))
        limite = round(min(limites), 2)
        principal = round(min(solicitado or limite, limite), 2)
        if principal < self.ticket_min:
            recusas.append("abaixo_do_ticket_minimo")

        aprovado = not recusas
        pmt = self.parcela(principal, n) if aprovado and principal > 0 else 0.0
        return {
            "produto_id": self.id, "produto": self.nome, "tipo": self.tipo,
            "aprovado": aprovado, "recusas": recusas,
            "limite": limite, "principal": principal, "parcelas": n,
            "parcela": pmt, "taxa_mensal": self.taxa_mensal,
            "cet_anual": self.cet_anual(principal, n) if aprovado and principal > 0 else 0.0,
            "comprometimento": round(pmt / renda_media, 4) if renda_media > 0 else 0.0,
            "garantia": {"tipo": self.garantia_tipo, "valor": valor_garantia,
                         "ltv_max": self.ltv_max} if self.garantia_tipo else None,
            "cobranca": self.cobranca, "jornada_id": self.jornada_id,
        }


@dataclass
class AppEntrega:
    """Plataforma de entrega integrada (iFood, Rappi, 99, Uber, regional...)."""
    id: str
    nome: str
    slug: str
    tipo_integracao: str = "api"            # ver TIPOS_INTEGRACAO_APP
    provider_tipo: str = "mock"             # mock | rest
    config: dict = field(default_factory=dict)      # spec REST quando provider_tipo=rest
    # repasse
    repasse_direto: bool = False            # paga na chave Pix da conta BMoto?
    periodicidade_repasse: str = "semanal"  # diario | semanal | quinzenal
    taxa_plataforma: float = 0.0            # % que a plataforma retém, se informado
    # mapeamento de campos do payload do app -> RendaMensal
    mapeamento: dict = field(default_factory=dict)
    logo_url: str = ""
    ativo: bool = True
    ordem: int = 100
    criado_em: str = field(default_factory=_agora)
    atualizado_em: str = field(default_factory=_agora)


@dataclass
class ModuloConfig:
    """Override do manifesto de produto: liga/desliga, ordem, título, jornada."""
    id: str                                 # = id do produto/módulo
    enabled: Optional[bool] = None
    ordem: Optional[int] = None
    titulo: Optional[str] = None
    descricao: Optional[str] = None
    icone: Optional[str] = None
    jornada_id: Optional[str] = None
    atualizado_em: str = field(default_factory=_agora)


@dataclass
class Auditoria:
    id: str
    quem: str
    acao: str                               # criar | atualizar | desligar | remover | testar
    entidade: str                           # conexao | produto_credito | app_entrega | modulo | jornada
    entidade_id: str
    antes: Optional[dict] = None
    depois: Optional[dict] = None
    em: str = field(default_factory=_agora)


# --------------------------------------------------------------- catálogo

class Catalogo:
    """Repositório dos cadastros + resolução de qual fornecedor atende o quê."""

    def __init__(self, prefixo: str = "plat") -> None:
        self._s_con = JsonStore(f"{prefixo}_conexoes")
        self._s_prod = JsonStore(f"{prefixo}_produtos_credito")
        self._s_app = JsonStore(f"{prefixo}_apps_entrega")
        self._s_mod = JsonStore(f"{prefixo}_modulos")
        self._s_aud = JsonStore(f"{prefixo}_auditoria")
        self._cache_provider: dict[str, Any] = {}

    # -- auditoria --------------------------------------------------------
    def registrar(self, quem: str, acao: str, entidade: str, entidade_id: str,
                  antes: Optional[dict] = None, depois: Optional[dict] = None) -> None:
        a = Auditoria(id=uuid.uuid4().hex, quem=quem or "sistema", acao=acao,
                      entidade=entidade, entidade_id=entidade_id, antes=antes, depois=depois)
        self._s_aud.put(f"{a.em}_{a.id}", asdict(a))

    def auditoria(self, limite: int = 100) -> list[dict]:
        docs = sorted(self._s_aud.all().items(), key=lambda kv: kv[0], reverse=True)
        return [d for _, d in docs[:limite]]

    # -- conexões ---------------------------------------------------------
    def conexoes(self, port: Optional[str] = None, incluir_inativas: bool = True) -> list[Conexao]:
        out = []
        for doc in self._s_con.all().values():
            try:
                c = Conexao(**doc)
            except TypeError:
                continue
            if port and c.port != port:
                continue
            if not incluir_inativas and not c.ativo:
                continue
            out.append(c)
        return sorted(out, key=lambda c: (c.port, c.prioridade, c.criado_em))

    def conexao(self, conexao_id: str) -> Conexao:
        doc = self._s_con.get(conexao_id)
        if not doc:
            raise KeyError(f"conexão '{conexao_id}' não existe")
        return Conexao(**doc)

    def salvar_conexao(self, dados: dict, quem: str = "admin") -> Conexao:
        port = dados.get("port")
        if port not in PORTS:
            raise ValueError(f"port inválido: '{port}'. Válidos: {sorted(PORTS)}")
        tipo = dados.get("tipo")
        spec = SPECS.get(str(tipo))
        if not spec:
            raise ValueError(f"tipo de fornecedor desconhecido: '{tipo}'")
        if port not in spec.ports:
            raise ValueError(f"o fornecedor '{tipo}' não atende o port '{port}'")
        escopo = dados.get("escopo", "global")
        alvo = escopo.split(":", 1)[1] if escopo.startswith("produto:") else None
        if escopo != "global" and not alvo:
            raise ValueError("escopo deve ser 'global' ou 'produto:<id>'")

        cid = dados.get("id") or f"{port}_{_slug(dados.get('titulo') or tipo)}"
        antes = self._s_con.get(cid)
        base = Conexao(**antes) if antes else None
        c = Conexao(
            id=cid, port=port, tipo=str(tipo),
            titulo=dados.get("titulo") or spec.titulo,
            escopo=escopo, config=dados.get("config") or {},
            ativo=bool(dados.get("ativo", True)),
            prioridade=int(dados.get("prioridade", 100)),
            ambiente=dados.get("ambiente", "sandbox"),
            observacao=dados.get("observacao", ""),
            criado_em=base.criado_em if base else _agora(),
        )
        self._validar_config(c)
        self._s_con.put(cid, asdict(c))
        self._cache_provider.clear()
        self.registrar(quem, "atualizar" if antes else "criar", "conexao", cid, antes, asdict(c))
        return c

    def _validar_config(self, c: Conexao) -> None:
        spec = SPECS[c.tipo]
        for campo in spec.campos:
            if campo.obrigatorio and not c.config.get(campo.chave):
                raise ValueError(f"campo obrigatório ausente na configuração: '{campo.chave}'")
        if c.tipo == "rest":
            ops = c.config.get("operacoes") or {}
            if not isinstance(ops, dict) or not ops:
                raise ValueError("declare ao menos uma operação em 'operacoes'")
            from .adapters.rest import OPERACOES_POR_PORT
            validas = set(OPERACOES_POR_PORT.get(c.port, ()))
            invalidas = sorted(set(ops) - validas)
            if invalidas:
                raise ValueError(f"operações não aplicáveis ao port '{c.port}': {invalidas}. "
                                 f"Válidas: {sorted(validas)}")
            for nome, op in ops.items():
                if not isinstance(op, dict) or not op.get("path"):
                    raise ValueError(f"operação '{nome}' precisa de 'path'")

    def desligar_conexao(self, conexao_id: str, quem: str = "admin") -> Conexao:
        c = self.conexao(conexao_id)
        antes = asdict(c)
        c.ativo, c.atualizado_em = False, _agora()
        self._s_con.put(conexao_id, asdict(c))
        self._cache_provider.clear()
        self.registrar(quem, "desligar", "conexao", conexao_id, antes, asdict(c))
        return c

    def remover_conexao(self, conexao_id: str, quem: str = "admin") -> bool:
        antes = self._s_con.get(conexao_id)
        ok = self._s_con.delete(conexao_id)
        self._cache_provider.clear()
        if ok:
            self.registrar(quem, "remover", "conexao", conexao_id, antes, None)
        return ok

    # -- resolução de fornecedor -----------------------------------------
    def conexao_ativa(self, port: str, produto_id: Optional[str] = None) -> Optional[Conexao]:
        """Específica do módulo vence a global; entre iguais, menor prioridade."""
        cands = [c for c in self.conexoes(port) if c.ativo]
        if produto_id:
            do_modulo = [c for c in cands if c.produto_alvo() == produto_id]
            if do_modulo:
                return sorted(do_modulo, key=lambda c: c.prioridade)[0]
        globais = [c for c in cands if c.escopo == "global"]
        return sorted(globais, key=lambda c: c.prioridade)[0] if globais else None

    def provider(self, port: str, produto_id: Optional[str] = None):
        """Instância do provider para o port (com cache por conexão)."""
        c = self.conexao_ativa(port, produto_id)
        if not c:
            return None
        chave = f"{c.id}:{c.atualizado_em}"
        if chave not in self._cache_provider:
            self._cache_provider[chave] = construir_adapter(c.tipo, port, c.config, c.titulo or c.tipo)
        return self._cache_provider[chave]

    def limpar_cache(self) -> None:
        self._cache_provider.clear()

    # -- produtos de crédito ---------------------------------------------
    def produtos_credito(self, incluir_inativos: bool = True) -> list[ProdutoCredito]:
        out = []
        for doc in self._s_prod.all().values():
            try:
                p = ProdutoCredito(**doc)
            except TypeError:
                continue
            if incluir_inativos or p.ativo:
                out.append(p)
        return sorted(out, key=lambda p: (p.tipo, p.nome))

    def produto_credito(self, produto_id: str) -> ProdutoCredito:
        doc = self._s_prod.get(produto_id)
        if not doc:
            raise KeyError(f"produto de crédito '{produto_id}' não existe")
        return ProdutoCredito(**doc)

    def salvar_produto_credito(self, dados: dict, quem: str = "admin") -> ProdutoCredito:
        tipo = dados.get("tipo")
        if tipo not in TIPOS_PRODUTO_CREDITO:
            raise ValueError(f"tipo inválido: '{tipo}'. Válidos: {list(TIPOS_PRODUTO_CREDITO)}")
        pid = dados.get("id") or _slug(dados.get("nome") or tipo)
        antes = self._s_prod.get(pid)
        campos = {k: v for k, v in dados.items()
                  if k in ProdutoCredito.__dataclass_fields__ and k not in ("id", "criado_em")}
        base = ProdutoCredito(**antes) if antes else None
        # construção explícita (evita herdar campos removidos de versões antigas)
        inicial = asdict(base) if base else {}
        inicial.pop("id", None)
        inicial.update(campos)
        inicial.setdefault("nome", dados.get("nome") or pid)
        inicial.setdefault("tipo", tipo)
        inicial["atualizado_em"] = _agora()
        inicial["criado_em"] = base.criado_em if base else _agora()
        p = ProdutoCredito(id=pid, **inicial)
        if p.prazo_min > p.prazo_max:
            raise ValueError("prazo_min maior que prazo_max")
        if p.ticket_min > p.ticket_max:
            raise ValueError("ticket_min maior que ticket_max")
        if p.emissor_conexao_id:
            c = self.conexao(p.emissor_conexao_id)
            if c.port != "credito":
                raise ValueError("emissor_conexao_id precisa apontar para uma conexão do port 'credito'")
        self._s_prod.put(pid, asdict(p))
        self.registrar(quem, "atualizar" if antes else "criar", "produto_credito", pid, antes, asdict(p))
        return p

    def remover_produto_credito(self, produto_id: str, quem: str = "admin") -> bool:
        antes = self._s_prod.get(produto_id)
        ok = self._s_prod.delete(produto_id)
        if ok:
            self.registrar(quem, "remover", "produto_credito", produto_id, antes, None)
        return ok

    # -- apps de entrega --------------------------------------------------
    def apps_entrega(self, incluir_inativos: bool = True) -> list[AppEntrega]:
        out = []
        for doc in self._s_app.all().values():
            try:
                a = AppEntrega(**doc)
            except TypeError:
                continue
            if incluir_inativos or a.ativo:
                out.append(a)
        return sorted(out, key=lambda a: (a.ordem, a.nome))

    def app_entrega(self, app_id: str) -> AppEntrega:
        doc = self._s_app.get(app_id)
        if not doc:
            raise KeyError(f"app de entrega '{app_id}' não existe")
        return AppEntrega(**doc)

    def salvar_app_entrega(self, dados: dict, quem: str = "admin") -> AppEntrega:
        if dados.get("tipo_integracao", "api") not in TIPOS_INTEGRACAO_APP:
            raise ValueError(f"tipo_integracao inválido. Válidos: {list(TIPOS_INTEGRACAO_APP)}")
        if dados.get("provider_tipo", "mock") not in ("mock", "rest"):
            raise ValueError("provider_tipo deve ser 'mock' ou 'rest'")
        slug = _slug(dados.get("slug") or dados.get("nome") or "")
        aid = dados.get("id") or slug
        antes = self._s_app.get(aid)
        base = asdict(AppEntrega(**antes)) if antes else {}
        base.pop("id", None)
        base.update({k: v for k, v in dados.items()
                     if k in AppEntrega.__dataclass_fields__ and k not in ("id", "criado_em")})
        base["slug"] = slug
        base.setdefault("nome", dados.get("nome") or slug)
        base["atualizado_em"] = _agora()
        base["criado_em"] = antes["criado_em"] if antes else _agora()
        a = AppEntrega(id=aid, **base)
        if a.provider_tipo == "rest" and not (a.config.get("operacoes") or {}).get("ler_renda"):
            raise ValueError("integração REST precisa declarar a operação 'ler_renda'")
        self._s_app.put(aid, asdict(a))
        self._cache_provider.clear()
        self.registrar(quem, "atualizar" if antes else "criar", "app_entrega", aid, antes, asdict(a))
        return a

    def remover_app_entrega(self, app_id: str, quem: str = "admin") -> bool:
        antes = self._s_app.get(app_id)
        ok = self._s_app.delete(app_id)
        self._cache_provider.clear()
        if ok:
            self.registrar(quem, "remover", "app_entrega", app_id, antes, None)
        return ok

    def provider_app_entrega(self, app_id: str):
        """RendaProvider do app: cada plataforma pode ter integração própria."""
        a = self.app_entrega(app_id)
        chave = f"app:{a.id}:{a.atualizado_em}"
        if chave not in self._cache_provider:
            self._cache_provider[chave] = construir_adapter(a.provider_tipo, "renda",
                                                            a.config, a.nome)
        return self._cache_provider[chave]

    # -- módulos ----------------------------------------------------------
    def modulos_config(self) -> dict[str, ModuloConfig]:
        out = {}
        for k, doc in self._s_mod.all().items():
            try:
                out[k] = ModuloConfig(**doc)
            except TypeError:
                continue
        return out

    def salvar_modulo(self, dados: dict, quem: str = "admin") -> ModuloConfig:
        mid = dados.get("id")
        if not mid:
            raise ValueError("id do módulo é obrigatório")
        conhecidos = {m.id for m in PRODUTOS} | set(self.modulos_config())
        if mid not in conhecidos:
            raise ValueError(f"módulo '{mid}' não existe. Conhecidos: {sorted(conhecidos)}")
        antes = self._s_mod.get(mid)
        base = antes or {}
        base.update({k: v for k, v in dados.items() if k in ModuloConfig.__dataclass_fields__})
        base["id"] = mid
        base["atualizado_em"] = _agora()
        m = ModuloConfig(**base)
        self._s_mod.put(mid, asdict(m))
        self.registrar(quem, "atualizar" if antes else "criar", "modulo", mid, antes, asdict(m))
        return m

    def manifesto_efetivo(self, m: ProdutoManifest) -> dict:
        """Manifesto do código + override do admin + override de env."""
        cfg = self.modulos_config().get(m.id)
        d = m.to_dict()
        origem_flag = "codigo"
        if os.getenv(m.env_var) is not None:
            origem_flag = "env"
        elif cfg and cfg.enabled is not None:
            d["enabled"] = cfg.enabled
            origem_flag = "admin"
        if cfg:
            for campo in ("ordem", "titulo", "descricao", "icone"):
                v = getattr(cfg, campo)
                if v is not None:
                    d[campo] = v
            if cfg.jornada_id:
                d["jornada_id"] = cfg.jornada_id
        d["origem_flag"] = origem_flag
        return d


catalogo = Catalogo()
