/** Peças de interface comuns ao app e ao admin. Sem biblioteca externa. */

import type { ReactNode } from "react";
import { ICONES, PADRAO } from "./icones";
import logoBMoto from "@/assets/bmoto-logo.svg";
import iconeBMoto from "@/assets/bmoto-icon.svg";

export function Icone({ nome, className = "h-5 w-5" }: { nome?: string; className?: string }) {
  const Comp = (nome && ICONES[nome]) || PADRAO;
  return <Comp className={className} aria-hidden="true" />;
}

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string }
  & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function SecaoTitulo({ titulo, subtitulo, acao }: {
  titulo: string; subtitulo?: string; acao?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold">{titulo}</h2>
        {subtitulo && <p className="mt-1 text-sm text-ink-muted">{subtitulo}</p>}
      </div>
      {acao}
    </div>
  );
}

export function Chip({ children, tom = "neutro" }: {
  children: ReactNode;
  tom?: "neutro" | "on" | "off" | "warn" | "danger";
}) {
  const classes = { neutro: "chip", on: "chip chip-on", off: "chip chip-off",
                    warn: "chip chip-warn", danger: "chip chip-danger" }[tom];
  return <span className={classes}>{children}</span>;
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-ink-muted" role="status" aria-live="polite">
      <Icone nome="Loader2" className="h-4 w-4 animate-spin text-mint" />
      {texto}
    </div>
  );
}

export function Aviso({ tom = "info", titulo, className = "", children }: {
  tom?: "info" | "erro" | "atencao" | "ok";
  titulo?: string;
  className?: string;
  children: ReactNode;
}) {
  const cfg = {
    info: { cls: "border-white/12 bg-white/[.04] text-ink-muted", icone: "Info" },
    erro: { cls: "border-danger/35 bg-danger/10 text-ink", icone: "AlertCircle" },
    atencao: { cls: "border-warn/35 bg-warn/10 text-ink", icone: "AlertTriangle" },
    ok: { cls: "border-mint/35 bg-mint/10 text-ink", icone: "CheckCircle2" },
  }[tom];
  return (
    <div className={`flex gap-3 rounded-xl border p-4 text-sm ${cfg.cls} ${className}`}
         role={tom === "erro" ? "alert" : undefined}>
      <Icone nome={cfg.icone} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        {titulo && <p className="font-semibold text-ink">{titulo}</p>}
        <div className="leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

export function Vazio({ icone = "Inbox", titulo, children, acao }: {
  icone?: string; titulo: string; children?: ReactNode; acao?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/12 px-6 py-12 text-center">
      <Icone nome={icone} className="h-8 w-8 text-ink-faint" />
      <p className="font-semibold">{titulo}</p>
      {children && <p className="max-w-md text-sm text-ink-muted">{children}</p>}
      {acao}
    </div>
  );
}

export function Campo({ rotulo, ajuda, erro, children, obrigatorio }: {
  rotulo: string; ajuda?: string; erro?: string; children: ReactNode; obrigatorio?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="label">
        {rotulo}
        {obrigatorio && <span className="ml-1 text-mint">*</span>}
      </span>
      {children}
      {ajuda && !erro && <span className="block text-xs text-ink-faint">{ajuda}</span>}
      {erro && <span className="block text-xs text-danger">{erro}</span>}
    </label>
  );
}

export function Metrica({ rotulo, valor, detalhe, tom = "normal" }: {
  rotulo: string; valor: string; detalhe?: string; tom?: "normal" | "mint" | "danger";
}) {
  const cor = { normal: "text-ink", mint: "text-mint", danger: "text-danger" }[tom];
  return (
    <div className="card-tight">
      <p className="label">{rotulo}</p>
      <p className={`mt-1 font-display text-xl font-bold ${cor}`}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-ink-faint">{detalhe}</p>}
    </div>
  );
}

export function Progresso({ atual, total }: { atual: number; total: number }) {
  const pct = total > 0 ? Math.round((atual / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-ink-faint">
        <span>
          Passo {Math.min(atual + 1, total)} de {total}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10"
           role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-mint transition-all duration-300"
             style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** A marca oficial, do arquivo — nada de redesenhar o logo em código. */
export function Logo({ className = "h-7" }: { className?: string }) {
  return <img src={logoBMoto} alt="BMoto" className={`w-auto ${className}`} />;
}

export function LogoIcone({ className = "h-10" }: { className?: string }) {
  return <img src={iconeBMoto} alt="" aria-hidden="true" className={`w-auto ${className}`} />;
}
