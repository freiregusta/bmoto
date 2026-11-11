"""
jornadas.py — jornadas configuráveis: o admin monta o passo-a-passo.

Uma jornada é uma lista ordenada de passos. Cada passo tem um TIPO, que diz
quem o executa:

- `formulario`      o app mostra campos e devolve respostas
- `consentimento`   texto + aceite (LGPD, Open Finance, averbação)
- `kyc`             chama o KycProvider ativo
- `conectar_app`    consentimento + leitura de renda de um app de entrega
- `renda`           consolida a renda dos apps conectados
- `oferta`          roda `ProdutoCredito.avaliar()` e devolve a oferta
- `escolha`         o cliente escolhe entre opções (prazo, plano, cobertura)
- `assinatura`      emite CCB/apólice e colhe aceite
- `provisionar`     cria conta / emite cartão / abre MEI / adere ao plano
- `revisao_manual`  pendura na mesa de crédito
- `mensagem`        tela informativa (sucesso, recusa, próximos passos)

Cada passo pode ter `condicao` — uma expressão simples sobre o contexto da
execução, avaliada sem `eval` (ver `_condicao_ok`). Exemplos:
    "renda_media >= 1200"      "tem_mei == true"      "oferta.aprovado == true"

A execução guarda estado (`ExecucaoJornada`) com respostas e resultados, para
o app poder retomar de onde parou — e para a mesa de crédito auditar.

O que o motor NÃO faz: regra de negócio escondida. Política de crédito vive no
ProdutoCredito; integração vive no adapter. A jornada só orquestra.
"""

from __future__ import annotations

import datetime as dt
import re
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from persistencia import JsonStore

TIPOS_PASSO = (
    "formulario", "consentimento", "kyc", "conectar_app", "renda", "oferta",
    "escolha", "assinatura", "provisionar", "revisao_manual", "mensagem",
)

# passos que o backend resolve sozinho (não esperam input do cliente)
PASSOS_AUTOMATICOS = {"kyc", "renda", "oferta", "provisionar"}


def _agora() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _slug(texto: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", str(texto).strip().lower()).strip("_")
    return s or uuid.uuid4().hex[:8]


@dataclass
class Passo:
    id: str
    tipo: str
    titulo: str
    descricao: str = ""
    obrigatorio: bool = True
    condicao: Optional[str] = None      # ex.: "renda_media >= 1200"
    config: dict = field(default_factory=dict)
    # config por tipo (exemplos):
    #   formulario   {"campos":[{"chave":"placa","titulo":"Placa","tipo":"texto","obrigatorio":true}]}
    #   consentimento{"texto":"...","versao":"v2","obrigatorio_aceitar":true}
    #   conectar_app {"apps":["ifood","99"],"minimo":1}
    #   oferta       {"produto_credito_id":"moto_nova","permite_simular":true}
    #   escolha      {"chave":"prazo","opcoes":[24,36,48],"rotulo":"Em quantas vezes?"}
    #   provisionar  {"acoes":["abrir_conta","emitir_cartao"]}
    #   assinatura   {"documento":"ccb","exige_selfie":true}


@dataclass
class Jornada:
    id: str
    nome: str
    modulo_id: Optional[str] = None          # módulo do app que a usa
    produto_credito_id: Optional[str] = None
    versao: int = 1
    ativo: bool = True
    passos: list[Passo] = field(default_factory=list)
    criado_em: str = field(default_factory=_agora)
    atualizado_em: str = field(default_factory=_agora)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["passos"] = [asdict(p) if not isinstance(p, dict) else p for p in self.passos]
        return d


@dataclass
class ExecucaoJornada:
    id: str
    jornada_id: str
    versao: int
    cpf: str
    status: str = "EM_ANDAMENTO"             # EM_ANDAMENTO | CONCLUIDA | RECUSADA | PENDENTE_MESA | ABANDONADA
    passo_atual: Optional[str] = None
    contexto: dict = field(default_factory=dict)      # respostas + resultados
    historico: list[dict] = field(default_factory=list)
    criada_em: str = field(default_factory=_agora)
    atualizada_em: str = field(default_factory=_agora)


# --------------------------------------------------------------- condições

_OPS = ("==", "!=", ">=", "<=", ">", "<")


def _valor_ctx(ctx: dict, caminho: str) -> Any:
    atual: Any = ctx
    for parte in caminho.split("."):
        if isinstance(atual, dict):
            atual = atual.get(parte)
        else:
            return None
    return atual


def _converter(bruto: str) -> Any:
    b = bruto.strip().strip("'\"")
    if b.lower() in ("true", "sim"):
        return True
    if b.lower() in ("false", "nao", "não"):
        return False
    if b.lower() in ("null", "none", ""):
        return None
    try:
        return float(b) if "." in b else int(b)
    except ValueError:
        return b


def _condicao_ok(condicao: Optional[str], ctx: dict) -> bool:
    """Avalia condições simples sem eval. Suporta `e`/`and` entre comparações."""
    if not condicao or not str(condicao).strip():
        return True
    partes = re.split(r"\s+(?:e|and|&&)\s+", str(condicao).strip(), flags=re.I)
    for parte in partes:
        for op in _OPS:
            if op in parte:
                esq, dir_ = parte.split(op, 1)
                a = _valor_ctx(ctx, esq.strip())
                b = _converter(dir_)
                if isinstance(a, bool) or isinstance(b, bool):
                    a, b = bool(a), bool(b)
                elif isinstance(b, (int, float)):
                    try:
                        a = float(a) if a is not None else None
                    except (TypeError, ValueError):
                        a = None
                try:
                    ok = {"==": a == b, "!=": a != b,
                          ">=": a is not None and a >= b, "<=": a is not None and a <= b,
                          ">": a is not None and a > b, "<": a is not None and a < b}[op]
                except TypeError:
                    ok = False
                if not ok:
                    return False
                break
        else:
            # sem operador: verdade se o campo existir e for "verdadeiro"
            if not _valor_ctx(ctx, parte.strip()):
                return False
    return True


# --------------------------------------------------------------- repositório

class RepositorioJornadas:
    def __init__(self, prefixo: str = "plat") -> None:
        self._s_jor = JsonStore(f"{prefixo}_jornadas")
        self._s_exe = JsonStore(f"{prefixo}_execucoes")

    # -- jornadas ---------------------------------------------------------
    def todas(self, incluir_inativas: bool = True) -> list[Jornada]:
        out = []
        for doc in self._s_jor.all().values():
            j = self._hidratar(doc)
            if j and (incluir_inativas or j.ativo):
                out.append(j)
        return sorted(out, key=lambda j: j.nome)

    @staticmethod
    def _hidratar(doc: dict) -> Optional[Jornada]:
        try:
            passos = [Passo(**p) for p in doc.get("passos", [])]
            return Jornada(**{**doc, "passos": passos})
        except TypeError:
            return None

    def get(self, jornada_id: str) -> Jornada:
        doc = self._s_jor.get(jornada_id)
        j = self._hidratar(doc) if doc else None
        if not j:
            raise KeyError(f"jornada '{jornada_id}' não existe")
        return j

    def por_modulo(self, modulo_id: str) -> Optional[Jornada]:
        cands = [j for j in self.todas(False) if j.modulo_id == modulo_id]
        return sorted(cands, key=lambda j: -j.versao)[0] if cands else None

    def salvar(self, dados: dict, quem: str = "admin") -> Jornada:
        jid = dados.get("id") or _slug(dados.get("nome") or "jornada")
        antes = self._s_jor.get(jid)
        passos_in = dados.get("passos") or []
        passos: list[Passo] = []
        vistos: set[str] = set()
        for i, p in enumerate(passos_in):
            tipo = p.get("tipo")
            if tipo not in TIPOS_PASSO:
                raise ValueError(f"passo {i + 1}: tipo '{tipo}' inválido. Válidos: {list(TIPOS_PASSO)}")
            pid = p.get("id") or f"{tipo}_{i + 1}"
            if pid in vistos:
                raise ValueError(f"id de passo repetido: '{pid}'")
            vistos.add(pid)
            if p.get("condicao"):
                _condicao_ok(p["condicao"], {})      # sintaxe exercitada no cadastro
            passos.append(Passo(id=pid, tipo=tipo, titulo=p.get("titulo") or pid,
                                descricao=p.get("descricao", ""),
                                obrigatorio=bool(p.get("obrigatorio", True)),
                                condicao=p.get("condicao"), config=p.get("config") or {}))
        if not passos:
            raise ValueError("a jornada precisa de ao menos um passo")
        versao = int(dados.get("versao") or ((antes or {}).get("versao", 0) + 1))
        j = Jornada(id=jid, nome=dados.get("nome") or jid,
                    modulo_id=dados.get("modulo_id"),
                    produto_credito_id=dados.get("produto_credito_id"),
                    versao=versao, ativo=bool(dados.get("ativo", True)), passos=passos,
                    criado_em=(antes or {}).get("criado_em") or _agora())
        self._s_jor.put(jid, j.to_dict())
        return j

    def remover(self, jornada_id: str) -> bool:
        return self._s_jor.delete(jornada_id)

    # -- execuções --------------------------------------------------------
    def salvar_execucao(self, e: ExecucaoJornada) -> None:
        e.atualizada_em = _agora()
        self._s_exe.put(e.id, asdict(e))

    def execucao(self, execucao_id: str) -> ExecucaoJornada:
        doc = self._s_exe.get(execucao_id)
        if not doc:
            raise KeyError(f"execução '{execucao_id}' não existe")
        return ExecucaoJornada(**doc)

    def execucoes(self, cpf: Optional[str] = None, status: Optional[str] = None,
                  limite: int = 200) -> list[ExecucaoJornada]:
        out = []
        for doc in self._s_exe.all().values():
            try:
                e = ExecucaoJornada(**doc)
            except TypeError:
                continue
            if cpf and e.cpf != cpf:
                continue
            if status and e.status != status:
                continue
            out.append(e)
        return sorted(out, key=lambda e: e.atualizada_em, reverse=True)[:limite]


# --------------------------------------------------------------- motor

class MotorJornadas:
    """Executa jornadas usando os providers e produtos do catálogo."""

    def __init__(self, repo: RepositorioJornadas, catalogo, plataforma) -> None:
        self.repo = repo
        self.catalogo = catalogo
        self.plataforma = plataforma

    # -- ciclo de vida ----------------------------------------------------
    def iniciar(self, jornada_id: str, cpf: str, contexto: Optional[dict] = None) -> ExecucaoJornada:
        j = self.repo.get(jornada_id)
        if not j.ativo:
            raise ValueError(f"jornada '{jornada_id}' está inativa")
        e = ExecucaoJornada(id=uuid.uuid4().hex, jornada_id=j.id, versao=j.versao, cpf=cpf,
                            contexto={"cpf": cpf, **(contexto or {})})
        e.passo_atual = self._proximo_id(j, e)
        self.repo.salvar_execucao(e)
        return e

    def _passos_elegiveis(self, j: Jornada, e: ExecucaoJornada) -> list[Passo]:
        return [p for p in j.passos if _condicao_ok(p.condicao, e.contexto)]

    def _concluidos(self, e: ExecucaoJornada) -> set[str]:
        return {h["passo"] for h in e.historico if h.get("ok")}

    def _proximo_id(self, j: Jornada, e: ExecucaoJornada) -> Optional[str]:
        feitos = self._concluidos(e)
        for p in self._passos_elegiveis(j, e):
            if p.id not in feitos:
                return p.id
        return None

    def estado(self, execucao_id: str) -> dict:
        e = self.repo.execucao(execucao_id)
        j = self.repo.get(e.jornada_id)
        elegiveis = self._passos_elegiveis(j, e)
        feitos = self._concluidos(e)
        atual = next((p for p in elegiveis if p.id == e.passo_atual), None)
        return {
            "execucao_id": e.id, "jornada": {"id": j.id, "nome": j.nome, "versao": j.versao},
            "status": e.status, "cpf": e.cpf,
            "passo_atual": asdict(atual) if atual else None,
            "automatico": bool(atual and atual.tipo in PASSOS_AUTOMATICOS),
            "progresso": {"total": len(elegiveis), "concluidos": len(feitos & {p.id for p in elegiveis})},
            "passos": [{**asdict(p), "concluido": p.id in feitos,
                        "atual": p.id == e.passo_atual} for p in elegiveis],
            "contexto": e.contexto, "historico": e.historico,
        }

    # -- avanço -----------------------------------------------------------
    async def avancar(self, execucao_id: str, resposta: Optional[dict] = None) -> dict:
        e = self.repo.execucao(execucao_id)
        if e.status not in ("EM_ANDAMENTO", "PENDENTE_MESA"):
            return self.estado(execucao_id)
        j = self.repo.get(e.jornada_id)
        passo = next((p for p in j.passos if p.id == e.passo_atual), None)
        if not passo:
            e.status = "CONCLUIDA"
            self.repo.salvar_execucao(e)
            return self.estado(execucao_id)

        resultado = await self._executar(passo, e, resposta or {})
        e.historico.append({"passo": passo.id, "tipo": passo.tipo, "em": _agora(),
                            "ok": resultado.get("ok", True),
                            "resultado": {k: v for k, v in resultado.items() if k != "ok"}})
        if not resultado.get("ok", True):
            if resultado.get("recusar"):
                e.status = "RECUSADA"
            elif resultado.get("mesa"):
                e.status = "PENDENTE_MESA"
            self.repo.salvar_execucao(e)
            return self.estado(execucao_id)

        e.passo_atual = self._proximo_id(j, e)
        if e.passo_atual is None:
            e.status = "CONCLUIDA"
        self.repo.salvar_execucao(e)
        return self.estado(execucao_id)

    async def _executar(self, passo: Passo, e: ExecucaoJornada, resposta: dict) -> dict:
        ctx = e.contexto
        tipo = passo.tipo
        cfg = passo.config

        if tipo in ("formulario", "escolha"):
            if tipo == "formulario":
                faltam = [c["chave"] for c in cfg.get("campos", [])
                          if c.get("obrigatorio") and resposta.get(c["chave"]) in (None, "")]
                if faltam and passo.obrigatorio:
                    return {"ok": False, "erro": "campos_obrigatorios", "campos": faltam}
                ctx.update(resposta)
            else:
                chave = cfg.get("chave", passo.id)
                opcoes = cfg.get("opcoes", [])
                escolha = resposta.get(chave, resposta.get("valor"))
                if opcoes and escolha not in opcoes and str(escolha) not in [str(o) for o in opcoes]:
                    return {"ok": False, "erro": "opcao_invalida", "opcoes": opcoes}
                ctx[chave] = escolha
            return {"ok": True, "respostas": resposta}

        if tipo == "consentimento":
            if not resposta.get("aceito") and cfg.get("obrigatorio_aceitar", True):
                return {"ok": False, "erro": "consentimento_necessario"}
            ctx.setdefault("consentimentos", []).append(
                {"passo": passo.id, "versao": cfg.get("versao", "v1"), "em": _agora(),
                 "ip": resposta.get("ip")})
            return {"ok": True}

        if tipo == "kyc":
            from .ports import Pessoa
            pessoa = Pessoa(cpf=ctx.get("cpf", e.cpf), nome=ctx.get("nome", ""),
                            nascimento=ctx.get("nascimento", "1990-01-01"),
                            email=ctx.get("email"), celular=ctx.get("celular"),
                            cnpj_mei=ctx.get("cnpj_mei"))
            prov = self.catalogo.provider("kyc", cfg.get("modulo_id")) or self.plataforma.kyc()
            res = await prov.validar(pessoa, resposta.get("selfie"), resposta.get("documento"))
            ctx["kyc"] = asdict(res)
            ctx["kyc_ok"] = res.aprovado
            if not res.aprovado:
                return {"ok": False, "recusar": not cfg.get("mesa_se_reprovar"),
                        "mesa": bool(cfg.get("mesa_se_reprovar")), "kyc": asdict(res)}
            return {"ok": True, "kyc": asdict(res)}

        if tipo == "conectar_app":
            slugs = resposta.get("apps") or cfg.get("apps") or []
            minimo = int(cfg.get("minimo", 1))
            conectados = ctx.setdefault("apps_conectados", [])
            for slug in slugs:
                try:
                    app = next(a for a in self.catalogo.apps_entrega(False) if a.slug == slug)
                except StopIteration:
                    continue
                prov = self.catalogo.provider_app_entrega(app.id)
                cns = await prov.consentir(ctx.get("cpf", e.cpf), app.slug)
                conectados.append({"app": app.slug, "nome": app.nome,
                                   "consentimento_id": cns.consentimento_id})
            if len(conectados) < minimo:
                return {"ok": False, "erro": "conecte_ao_menos_um_app",
                        "minimo": minimo, "conectados": len(conectados)}
            return {"ok": True, "apps": conectados}

        if tipo == "renda":
            meses = int(cfg.get("meses", 3))
            total, detalhe = 0.0, []
            for c in ctx.get("apps_conectados", []):
                app = next((a for a in self.catalogo.apps_entrega() if a.slug == c["app"]), None)
                if not app:
                    continue
                prov = self.catalogo.provider_app_entrega(app.id)
                rs = await prov.renda(c["consentimento_id"], meses)
                media = sum(r.bruto for r in rs) / max(len(rs), 1)
                total += media
                detalhe.append({"app": c["app"], "media": round(media, 2),
                                "meses": [asdict(r) for r in rs]})
            ctx["renda_media"] = round(total, 2)
            ctx["renda_detalhe"] = detalhe
            ctx["meses_renda"] = meses
            minimo = float(cfg.get("minimo", 0))
            if minimo and ctx["renda_media"] < minimo:
                return {"ok": False, "recusar": True, "erro": "renda_insuficiente",
                        "renda_media": ctx["renda_media"], "minimo": minimo}
            return {"ok": True, "renda_media": ctx["renda_media"]}

        if tipo == "oferta":
            pid = cfg.get("produto_credito_id") or ctx.get("produto_credito_id")
            if not pid:
                return {"ok": False, "erro": "produto_credito_nao_configurado"}
            produto = self.catalogo.produto_credito(pid)
            idade = _idade(ctx.get("nascimento"))
            oferta = produto.avaliar(
                score=int(ctx.get("score", cfg.get("score_default", 600))),
                renda_media=float(ctx.get("renda_media", 0.0)),
                idade=idade, tem_mei=bool(ctx.get("cnpj_mei") or ctx.get("tem_mei")),
                kyc_ok=bool(ctx.get("kyc_ok", True)),
                meses_renda=int(ctx.get("meses_renda", 12)),
                valor_garantia=float(ctx.get("valor_garantia", 0.0)),
                solicitado=ctx.get("solicitado"),
                parcelas=int(ctx["prazo"]) if str(ctx.get("prazo", "")).isdigit() else None)
            ctx["oferta"] = oferta
            if not oferta["aprovado"]:
                return {"ok": False, "recusar": not cfg.get("mesa_se_recusar"),
                        "mesa": bool(cfg.get("mesa_se_recusar")), "oferta": oferta}
            return {"ok": True, "oferta": oferta}

        if tipo == "assinatura":
            if not resposta.get("aceito"):
                return {"ok": False, "erro": "aceite_necessario"}
            oferta = ctx.get("oferta") or {}
            doc = cfg.get("documento", "ccb")
            if doc == "ccb" and oferta.get("aprovado"):
                produto = self.catalogo.produto_credito(oferta["produto_id"])
                prov = (self.catalogo.provider("credito", produto.modulo_id)
                        or self.plataforma.credito())
                ct = await prov.emitir_ccb(ctx.get("cpf", e.cpf), produto.tipo,
                                           oferta["principal"], produto.taxa_mensal,
                                           oferta["parcelas"], f"{e.id}:{passo.id}")
                ctx["contrato"] = asdict(ct)
                return {"ok": True, "contrato": asdict(ct)}
            ctx.setdefault("assinaturas", []).append({"documento": doc, "em": _agora()})
            return {"ok": True, "documento": doc}

        if tipo == "provisionar":
            from .ports import Pessoa
            pessoa = Pessoa(cpf=ctx.get("cpf", e.cpf), nome=ctx.get("nome", ""),
                            nascimento=ctx.get("nascimento", "1990-01-01"),
                            email=ctx.get("email"), celular=ctx.get("celular"),
                            cnpj_mei=ctx.get("cnpj_mei"), endereco=ctx.get("endereco", {}))
            feitos = {}
            for acao in cfg.get("acoes", []):
                if acao == "abrir_conta":
                    prov = self.catalogo.provider("conta", cfg.get("modulo_id")) or self.plataforma.conta()
                    conta = await prov.abrir_conta(pessoa)
                    ctx["conta"] = asdict(conta)
                    feitos[acao] = conta.conta_id
                elif acao == "emitir_cartao":
                    prov = self.catalogo.provider("cartao", cfg.get("modulo_id")) or self.plataforma.cartao()
                    oferta = ctx.get("oferta") or {}
                    cartao = await prov.emitir(
                        (ctx.get("conta") or {}).get("conta_id", ""),
                        cfg.get("modalidade", "garantido"),
                        float(oferta.get("limite", cfg.get("limite", 0.0))),
                        {"tipo": "moto", "valor": float(ctx.get("valor_garantia", 0.0)),
                         "placa": ctx.get("placa")} if ctx.get("valor_garantia") else None)
                    ctx["cartao"] = asdict(cartao)
                    feitos[acao] = cartao.cartao_id
                elif acao == "abrir_mei":
                    prov = self.catalogo.provider("contador", cfg.get("modulo_id")) or self.plataforma.contador()
                    mei = await prov.abrir_mei(pessoa, cfg.get("cnae", "5320-2/02"))
                    ctx["mei"] = asdict(mei)
                    ctx["cnpj_mei"] = mei.cnpj
                    feitos[acao] = mei.cnpj
                elif acao == "emitir_seguro":
                    prov = self.catalogo.provider("seguro", cfg.get("modulo_id")) or self.plataforma.seguro()
                    cot = await prov.cotar(pessoa, cfg.get("produto", "vida_ap"), cfg.get("params", {}))
                    ap = await prov.emitir(cot.cotacao_id, pessoa.cpf)
                    ctx["apolice"] = asdict(ap)
                    feitos[acao] = ap.apolice_id
                elif acao == "aderir_saude":
                    prov = self.catalogo.provider("saude", cfg.get("modulo_id")) or self.plataforma.saude()
                    cot = await prov.cotar(pessoa, cfg.get("params", {}))
                    ap = await prov.aderir(cot.cotacao_id, pessoa)
                    ctx["plano_saude"] = asdict(ap)
                    feitos[acao] = ap.apolice_id
                else:
                    return {"ok": False, "erro": f"acao_desconhecida:{acao}"}
            return {"ok": True, "provisionado": feitos}

        if tipo == "revisao_manual":
            return {"ok": False, "mesa": True, "erro": "aguardando_mesa",
                    "fila": cfg.get("fila", "credito")}

        if tipo == "mensagem":
            return {"ok": True, "mensagem": cfg.get("texto", "")}

        return {"ok": False, "erro": f"tipo_de_passo_nao_suportado:{tipo}"}


def _idade(nascimento: Optional[str]) -> int:
    try:
        n = dt.date.fromisoformat(str(nascimento))
    except (TypeError, ValueError):
        return 30
    return (dt.date.today() - n).days // 365
