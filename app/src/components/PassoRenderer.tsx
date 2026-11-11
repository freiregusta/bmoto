/**
 * PassoRenderer — desenha UM passo de jornada, qualquer que seja o tipo.
 *
 * É o coração da flexibilidade do app: a tela não sabe se está vendendo moto,
 * cartão ou plano de saúde. Recebe o passo (que o admin montou), desenha os
 * campos e devolve a resposta. Produto novo no admin = jornada nova = esta
 * tela já sabe renderizar.
 */

import { useEffect, useMemo, useState } from "react";
import { Aviso, Campo, Chip, Icone } from "./ui";
import { brl, mascaraTelefone, paraNumero, pct } from "@/lib/format";
import type { CampoFormulario, EstadoJornada, Oferta, Passo } from "@/platform/types";
import { APPS_DEMO } from "@/platform/demo";

interface Props {
  passo: Passo;
  estado: EstadoJornada;
  enviando: boolean;
  falha: Record<string, any> | null;
  onResponder: (resposta: Record<string, any>) => void;
  /** Apps disponíveis para o passo `conectar_app` (vem do backend quando há). */
  appsDisponiveis?: Array<{ slug: string; nome: string }>;
}

export function PassoRenderer({ passo, estado, enviando, falha, onResponder,
                               appsDisponiveis }: Props) {
  switch (passo.tipo) {
    case "formulario":
      return <PassoFormulario {...{ passo, enviando, falha, onResponder }} />;
    case "escolha":
      return <PassoEscolha {...{ passo, enviando, falha, onResponder }} />;
    case "consentimento":
      return <PassoConsentimento {...{ passo, enviando, falha, onResponder }} />;
    case "conectar_app":
      return <PassoConectarApp {...{ passo, enviando, falha, onResponder, appsDisponiveis }} />;
    case "assinatura":
      return <PassoAssinatura {...{ passo, estado, enviando, falha, onResponder }} />;
    case "mensagem":
      return <PassoMensagem passo={passo} estado={estado} onResponder={onResponder}
                            enviando={enviando} />;
    case "kyc":
    case "renda":
    case "oferta":
    case "provisionar":
      return <PassoAutomatico passo={passo} estado={estado} />;
    case "revisao_manual":
      return <PassoMesa passo={passo} />;
    default:
      return (
        <Aviso tom="atencao" titulo="Passo não suportado nesta versão do app">
          O tipo <code className="text-mint">{passo.tipo}</code> foi configurado no admin mas
          esta versão do aplicativo ainda não sabe desenhá-lo. Atualize o app ou troque o passo.
        </Aviso>
      );
  }
}

// ------------------------------------------------------------- formulário

function PassoFormulario({ passo, enviando, falha, onResponder }: Omit<Props, "estado">) {
  const campos = useMemo(() => passo.config.campos ?? [], [passo]);
  const [valores, setValores] = useState<Record<string, any>>({});
  useEffect(() => setValores({}), [passo.id]);

  const faltando: string[] = falha?.campos ?? [];
  const definir = (chave: string, valor: any) =>
    setValores((v) => ({ ...v, [chave]: valor }));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const saida: Record<string, any> = {};
        campos.forEach((c) => {
          const v = valores[c.chave];
          saida[c.chave] = c.tipo === "moeda" || c.tipo === "numero" ? paraNumero(v) : v;
        });
        onResponder(saida);
      }}
    >
      {campos.map((c) => (
        <Campo key={c.chave} rotulo={c.titulo} ajuda={c.ajuda} obrigatorio={c.obrigatorio}
               erro={faltando.includes(c.chave) ? "Preencha este campo" : undefined}>
          <EntradaCampo campo={c} valor={valores[c.chave] ?? ""}
                        onChange={(v) => definir(c.chave, v)} />
        </Campo>
      ))}
      <button className="btn-primary w-full" type="submit" disabled={enviando}>
        {enviando ? "Enviando…" : "Continuar"}
      </button>
    </form>
  );
}

function EntradaCampo({ campo, valor, onChange }: {
  campo: CampoFormulario; valor: any; onChange: (v: any) => void;
}) {
  if (campo.tipo === "select") {
    return (
      <select className="input" value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">Selecione…</option>
        {(campo.opcoes ?? []).map((o) => (
          <option key={String(o)} value={String(o)}>{String(o)}</option>
        ))}
      </select>
    );
  }
  const comum = {
    className: "input",
    value: valor,
    placeholder: campo.placeholder,
    inputMode: campo.tipo === "moeda" || campo.tipo === "numero" ? ("decimal" as const)
             : campo.tipo === "telefone" ? ("tel" as const) : undefined,
  };
  if (campo.tipo === "data")
    return <input {...comum} type="date" onChange={(e) => onChange(e.target.value)} />;
  if (campo.tipo === "email")
    return <input {...comum} type="email" autoComplete="email"
                  onChange={(e) => onChange(e.target.value)} />;
  if (campo.tipo === "telefone")
    return <input {...comum} type="tel" autoComplete="tel"
                  onChange={(e) => onChange(mascaraTelefone(e.target.value))} />;
  if (campo.tipo === "moeda")
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-ink-faint">
          R$
        </span>
        <input {...comum} className="input pl-10" onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  return <input {...comum} type="text" onChange={(e) => onChange(e.target.value)} />;
}

// ----------------------------------------------------------------- escolha

function PassoEscolha({ passo, enviando, falha, onResponder }: Omit<Props, "estado">) {
  const chave = passo.config.chave ?? passo.id;
  const opcoes = passo.config.opcoes ?? [];
  const [sel, setSel] = useState<string | number | null>(null);
  useEffect(() => setSel(null), [passo.id]);

  return (
    <div className="space-y-4">
      {passo.config.rotulo && <p className="text-sm text-ink-muted">{passo.config.rotulo}</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        {opcoes.map((o) => {
          const ativo = String(sel) === String(o);
          return (
            <button key={String(o)} type="button" onClick={() => setSel(o)}
                    aria-pressed={ativo}
                    className={`btn ${ativo ? "btn-primary" : "btn-ghost"} w-full`}>
              {typeof o === "number" ? `${o}x` : String(o)}
            </button>
          );
        })}
      </div>
      {falha?.erro === "opcao_invalida" && (
        <Aviso tom="erro">Escolha uma das opções acima.</Aviso>
      )}
      <button className="btn-primary w-full" disabled={sel === null || enviando}
              onClick={() => onResponder({ [chave]: sel })}>
        {enviando ? "Enviando…" : "Continuar"}
      </button>
    </div>
  );
}

// ----------------------------------------------------------- consentimento

function PassoConsentimento({ passo, enviando, falha, onResponder }: Omit<Props, "estado">) {
  const [aceito, setAceito] = useState(false);
  useEffect(() => setAceito(false), [passo.id]);
  return (
    <div className="space-y-4">
      <div className="max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-navy-500/40 p-4 text-sm leading-relaxed text-ink-muted">
        {passo.config.texto}
      </div>
      {passo.config.versao && (
        <p className="text-xs text-ink-faint">Versão do termo: {passo.config.versao}</p>
      )}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[.03] p-4">
        <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)}
               className="mt-0.5 h-5 w-5 shrink-0 accent-[#2DD4A8]" />
        <span className="text-sm">Li e autorizo</span>
      </label>
      {falha?.erro === "consentimento_necessario" && (
        <Aviso tom="erro">Precisamos da sua autorização para seguir.</Aviso>
      )}
      <button className="btn-primary w-full" disabled={!aceito || enviando}
              onClick={() => onResponder({ aceito: true })}>
        {enviando ? "Registrando…" : "Autorizar e continuar"}
      </button>
    </div>
  );
}

// ------------------------------------------------------------ conectar app

function PassoConectarApp({ passo, enviando, falha, onResponder, appsDisponiveis }: Omit<Props, "estado">) {
  const permitidos = passo.config.apps ?? [];
  const catalogo = (appsDisponiveis?.length ? appsDisponiveis
                    : APPS_DEMO.map((a) => ({ slug: a.slug, nome: a.nome })))
    .filter((a) => permitidos.length === 0 || permitidos.includes(a.slug));
  const [sel, setSel] = useState<string[]>([]);
  const minimo = passo.config.minimo ?? 1;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Conectar seus apps é o que permite ler sua renda real — sem holerite, sem fiador.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {catalogo.map((a) => {
          const ativo = sel.includes(a.slug);
          return (
            <button key={a.slug} type="button" aria-pressed={ativo}
                    onClick={() => setSel((s) => (ativo ? s.filter((x) => x !== a.slug)
                                                        : [...s, a.slug]))}
                    className={`flex items-center justify-between rounded-xl border p-4 text-left transition ${
                      ativo ? "border-mint/50 bg-mint/10" : "border-white/12 bg-white/[.03] hover:bg-white/[.06]"
                    }`}>
              <span className="font-semibold">{a.nome}</span>
              <Icone nome={ativo ? "CheckCircle2" : "Circle"}
                     className={`h-5 w-5 ${ativo ? "text-mint" : "text-ink-faint"}`} />
            </button>
          );
        })}
      </div>
      {falha?.erro === "conecte_ao_menos_um_app" && (
        <Aviso tom="erro">Conecte pelo menos {falha.minimo} app para continuar.</Aviso>
      )}
      <button className="btn-primary w-full" disabled={sel.length < minimo || enviando}
              onClick={() => onResponder({ apps: sel })}>
        {enviando ? "Conectando…" : `Conectar ${sel.length || ""}`.trim()}
      </button>
    </div>
  );
}

// ------------------------------------------------------------- assinatura

function PassoAssinatura({ passo, estado, enviando, falha, onResponder }: Props) {
  const oferta: Oferta | undefined = estado.contexto?.oferta;
  const [aceito, setAceito] = useState(false);
  useEffect(() => setAceito(false), [passo.id]);
  return (
    <div className="space-y-4">
      {oferta?.aprovado && <ResumoOferta oferta={oferta} />}
      <div className="rounded-xl border border-white/10 bg-navy-500/40 p-4 text-sm text-ink-muted">
        Ao assinar você concorda com o contrato
        {passo.config.documento === "ccb" ? " (CCB — Cédula de Crédito Bancário)" : ""} e com a
        forma de cobrança
        {oferta ? ` (${rotuloCobranca(oferta.cobranca)})` : ""}.
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[.03] p-4">
        <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)}
               className="mt-0.5 h-5 w-5 shrink-0 accent-[#2DD4A8]" />
        <span className="text-sm">Li e aceito as condições</span>
      </label>
      {falha?.erro === "aceite_necessario" && (
        <Aviso tom="erro">Marque o aceite para assinar.</Aviso>
      )}
      <button className="btn-primary w-full" disabled={!aceito || enviando}
              onClick={() => onResponder({ aceito: true })}>
        {enviando ? "Assinando…" : "Assinar"}
      </button>
    </div>
  );
}

export function ResumoOferta({ oferta }: { oferta: Oferta }) {
  return (
    <div className="rounded-2xl border border-mint/30 bg-mint/[.07] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label">{oferta.produto}</p>
          <p className="mt-1 font-display text-3xl font-extrabold text-mint">
            {brl(oferta.parcela)}
            <span className="ml-1 text-base font-semibold text-ink-muted">/mês</span>
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {oferta.parcelas}x · {brl(oferta.principal)} liberados
          </p>
        </div>
        <Chip tom="on">aprovado</Chip>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Linha rotulo="Taxa" valor={`${pct(oferta.taxa_mensal)} a.m.`} />
        <Linha rotulo="CET" valor={`${pct(oferta.cet_anual, 1)} a.a.`} />
        <Linha rotulo="Limite" valor={brl(oferta.limite)} />
        <Linha rotulo="Da sua renda" valor={pct(oferta.comprometimento, 1)} />
      </dl>
      {oferta.garantia?.tipo && oferta.garantia.tipo !== "nenhuma" && (
        <p className="mt-3 text-xs text-ink-faint">
          Garantia: {oferta.garantia.tipo} de {brl(oferta.garantia.valor)} · LTV máx{" "}
          {pct(oferta.garantia.ltv_max, 0)}
        </p>
      )}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="label">{rotulo}</dt>
      <dd className="mt-0.5 font-semibold">{valor}</dd>
    </div>
  );
}

const rotuloCobranca = (c: string) =>
  ({ pix_automatico: "débito automático via Pix", desconto_repasse: "desconto no repasse dos apps",
     boleto: "boleto mensal" } as Record<string, string>)[c] ?? c;

// --------------------------------------------------------------- mensagem

function PassoMensagem({ passo, estado, enviando, onResponder }: {
  passo: Passo; estado: EstadoJornada; enviando: boolean;
  onResponder: (r: Record<string, any>) => void;
}) {
  const ctx = estado.contexto ?? {};
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="rounded-full bg-mint/15 p-3">
          <Icone nome="CheckCircle2" className="h-7 w-7 text-mint" />
        </div>
        <p className="max-w-sm text-sm text-ink-muted">{passo.config.texto}</p>
      </div>
      <Entregaveis ctx={ctx} />
      <button className="btn-primary w-full" disabled={enviando} onClick={() => onResponder({})}>
        {enviando ? "…" : "Concluir"}
      </button>
    </div>
  );
}

/** Mostra o que a jornada efetivamente criou — conta, cartão, CNPJ, apólice. */
export function Entregaveis({ ctx }: { ctx: Record<string, any> }) {
  const itens: Array<{ icone: string; rotulo: string; valor: string }> = [];
  if (ctx.conta?.conta_id)
    itens.push({ icone: "Wallet", rotulo: "Conta",
                 valor: `${ctx.conta.agencia}/${ctx.conta.numero}` });
  if (ctx.cartao?.cartao_id)
    itens.push({ icone: "CreditCard", rotulo: "Cartão",
                 valor: `•••• ${ctx.cartao.ultimos4} · limite ${brl(ctx.cartao.limite)}` });
  if (ctx.mei?.cnpj) itens.push({ icone: "FileText", rotulo: "CNPJ MEI", valor: ctx.mei.cnpj });
  if (ctx.contrato?.contrato_id)
    itens.push({ icone: "FileSignature", rotulo: "Contrato",
                 valor: `${ctx.contrato.parcelas}x de ${brl(ctx.contrato.parcela)}` });
  if (ctx.apolice?.apolice_id)
    itens.push({ icone: "Shield", rotulo: "Apólice",
                 valor: `${brl(ctx.apolice.premio_mensal)}/mês` });
  if (ctx.plano_saude?.apolice_id)
    itens.push({ icone: "HeartPulse", rotulo: "Plano de saúde",
                 valor: `${brl(ctx.plano_saude.premio_mensal)}/mês` });
  if (!itens.length) return null;
  return (
    <ul className="space-y-2">
      {itens.map((i) => (
        <li key={i.rotulo} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[.03] p-3">
          <Icone nome={i.icone} className="h-4 w-4 text-mint" />
          <span className="text-sm text-ink-muted">{i.rotulo}</span>
          <span className="ml-auto text-sm font-semibold">{i.valor}</span>
        </li>
      ))}
    </ul>
  );
}

// -------------------------------------------------------------- automático

function PassoAutomatico({ passo, estado }: { passo: Passo; estado: EstadoJornada }) {
  const textos: Record<string, string> = {
    kyc: "Confirmando sua identidade nas bases oficiais…",
    renda: "Lendo seus ganhos nos apps conectados…",
    oferta: "Calculando o que cabe no seu bolso…",
    provisionar: "Criando tudo para você…",
  };
  const oferta: Oferta | undefined = estado.contexto?.oferta;
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Icone nome="Loader2" className="h-8 w-8 animate-spin text-mint" />
        <p className="text-sm text-ink-muted">{textos[passo.tipo] ?? "Processando…"}</p>
      </div>
      {passo.tipo === "oferta" && oferta?.aprovado && <ResumoOferta oferta={oferta} />}
    </div>
  );
}

function PassoMesa({ passo }: { passo: Passo }) {
  return (
    <Aviso tom="atencao" titulo="Em análise">
      Seu pedido foi para a nossa mesa ({passo.config.fila ?? "crédito"}). A gente avisa no app
      assim que tiver resposta — normalmente no mesmo dia útil.
    </Aviso>
  );
}
