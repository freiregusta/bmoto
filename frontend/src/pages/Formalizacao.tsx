// Jornada do tomador: oferta → KYC → CCB → polling → conclusão
// Design: Midnight Navy + Neon Mint (consistente com o sistema BMoto)
import { useEffect, useState, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { getOperacao, aceitar, kyc, assinarCCB, brl, pct } from "@/lib/api";
import type { Operacao, Estado } from "@/lib/api";
import { ShieldCheck, Zap, ArrowRight, CheckCircle2 } from "lucide-react";

const WHATSAPP = "https://wa.me/5511999999999";

const ESPERA = new Set<Estado>(["CCB_ASSINADA","AVERBANDO","AVERBADA"]);
const PIX_   = new Set<Estado>(["DESEMBOLSANDO"]);
const SUCESSO= new Set<Estado>(["DESEMBOLSADA","CONTABILIZADA","CEDIDA_FIDC"]);
const ERROS: Partial<Record<Estado, string>> = {
  KYC_REPROVADO:    "Não conseguimos verificar sua identidade.",
  AVERBACAO_FALHA:  "Problema ao reservar sua margem.",
  PIX_FALHA:        "Pagamento não concluído.",
  EXPIRADA:         "Proposta expirada. Solicite uma nova.",
  CANCELADA:        "Operação cancelada.",
  LEILAO_PERDIDO:   "Proposta não disponível no momento.",
  REPROVADA_CREDITO:"Proposta não aprovada.",
};

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-6 py-20">
      <div className="relative h-16 w-16">
        <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
        <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-primary" />
      </div>
      <p className="text-muted-foreground text-sm">{label}</p>
    </div>
  );
}

export default function Formalizacao() {
  const [params] = useSearchParams();
  const pid = params.get("proposal_id") ?? "";
  const [op, setOp] = useState<Operacao | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [aceitou, setAceitou] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!pid) { setErro("proposal_id não informado"); setLoading(false); return; }
    try { setOp(await getOperacao(pid)); }
    catch { setErro("Não foi possível carregar sua proposta."); }
    finally { setLoading(false); }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!op) return;
    const st = op.estado as Estado;
    if (!ESPERA.has(st) && !PIX_.has(st)) return;
    const iv = setInterval(async () => {
      try { setOp(await getOperacao(pid)); } catch { /**/ }
    }, 4000);
    return () => clearInterval(iv);
  }, [op?.estado, pid]);

  const handle = async (fn: () => Promise<Operacao>) => {
    setBusy(true);
    try { setOp(await fn()); }
    catch { setErro("Ocorreu um erro. Tente novamente."); }
    finally { setBusy(false); }
  };

  if (loading) return <Page><Spinner label="Carregando sua proposta..." /></Page>;
  if (erro) return <Page><p className="text-destructive text-center py-10">{erro}</p></Page>;
  if (!op) return null;

  const st = op.estado as Estado;
  const p = op.pricing;

  if (ERROS[st]) return (
    <Page>
      <div className="text-center py-16 space-y-4">
        <div className="text-5xl">⚠️</div>
        <p className="text-muted-foreground">{ERROS[st]}</p>
        <a href={WHATSAPP} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-2 btn-primary">
          Falar no WhatsApp <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </Page>
  );

  if (SUCESSO.has(st)) return (
    <Page>
      <div className="text-center py-16 space-y-4">
        <CheckCircle2 className="mx-auto h-16 w-16 text-primary" />
        <h2 className="font-display text-2xl font-bold">Empréstimo concluído!</h2>
        <p className="text-muted-foreground">O valor já está na sua conta.</p>
      </div>
    </Page>
  );

  if (PIX_.has(st)) return <Page><Spinner label="Transferindo o valor para sua conta..." /></Page>;
  if (ESPERA.has(st)) return <Page><Spinner label="Reservando sua margem junto ao empregador..." /></Page>;

  // Tela 1 — Oferta
  if (st === "OFERTA_VENCEDORA" && p) return (
    <Page>
      <div className="space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-white/5 px-3 py-1 text-xs text-muted-foreground mb-4">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Proposta disponível por 24h
          </div>
          <h1 className="font-display text-3xl font-bold">Sua proposta</h1>
        </div>

        <div className="surface p-6 space-y-4">
          <div className="text-center pb-4 border-b border-border">
            <p className="text-xs text-muted-foreground mb-1">Você recebe</p>
            <p className="font-display text-4xl font-bold glow-text">{brl(p.liberado)}</p>
          </div>
          <Row label="Parcela" value={`${brl(p.parcela)} × ${p.prazo_meses}x`} />
          <Row label="Taxa nominal" value={`${pct(p.taxa_am)} a.m.`} />
          <Row label="CET" value={`${pct(p.cet_am)} a.m.`} />
          <Row label="IOF" value={brl(p.iof)} muted />
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> Regulada BACEN</span>
          <span className="inline-flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-primary" /> Desconto automático em folha</span>
        </div>

        <button onClick={() => handle(() => aceitar(pid))} disabled={busy}
          className="btn-primary w-full justify-center text-base py-4">
          {busy ? "Aguarde..." : "Aceitar oferta"}
          {!busy && <ArrowRight className="h-5 w-5" />}
        </button>
      </div>
    </Page>
  );

  // Tela 2 — KYC
  if (st === "ACEITA") return (
    <Page>
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-bold">Verificação de identidade</h1>
        <div className="surface p-5 space-y-3 text-sm text-muted-foreground">
          <p>📄 Tenha em mãos seu <strong className="text-foreground">RG ou CNH</strong>.</p>
          <p>🤳 Vamos tirar uma <strong className="text-foreground">selfie</strong> para confirmar que é você.</p>
          <p>🔒 Seus dados são protegidos por criptografia.</p>
        </div>
        <button onClick={() => handle(() => kyc(pid, true))} disabled={busy}
          className="btn-primary w-full justify-center py-4">
          {busy ? "Verificando..." : "Confirmar identidade"}
        </button>
      </div>
    </Page>
  );

  // Tela 3 — CCB
  if (st === "EM_FORMALIZACAO" && p) return (
    <Page>
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-bold">Assinar contrato</h1>
        <div className="surface p-5 space-y-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Resumo da operação</p>
          <Row label="Liberado" value={brl(p.liberado)} />
          <Row label="Parcela" value={`${brl(p.parcela)} × ${p.prazo_meses}x`} />
          <Row label="Taxa" value={`${pct(p.taxa_am)} a.m.`} />
          <Row label="CET" value={`${pct(p.cet_am)} a.m.`} />
        </div>
        <label className="flex items-start gap-3 cursor-pointer surface p-4">
          <input type="checkbox" checked={aceitou} onChange={e => setAceitou(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-primary" />
          <span className="text-sm text-muted-foreground leading-relaxed">
            Li e aceito os termos do contrato (CCB) e autorizo o desconto das parcelas em folha de pagamento.
          </span>
        </label>
        <button onClick={() => handle(() => assinarCCB(pid))} disabled={!aceitou || busy}
          className="btn-primary w-full justify-center py-4">
          {busy ? "Assinando..." : "Assinar contrato"}
        </button>
      </div>
    </Page>
  );

  return (
    <Page>
      <p className="text-center text-muted-foreground py-8 font-mono text-sm">{st}</p>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="container-bm flex h-16 items-center">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-mint text-primary-foreground font-display font-bold">B</span>
            <span className="font-display text-lg font-bold tracking-tight">BMoto</span>
          </Link>
        </div>
      </header>
      <main className="container-bm max-w-md py-10">{children}</main>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={muted ? "text-sm text-muted-foreground" : "font-semibold"}>{value}</span>
    </div>
  );
}
