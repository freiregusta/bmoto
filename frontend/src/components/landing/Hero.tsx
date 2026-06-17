import { ArrowRight, ShieldCheck, Zap } from "lucide-react";
import heroImg from "@/assets/hero-product.jpg";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-hero" />
      <div className="absolute inset-0 grid-bg opacity-50" />
      <div className="container-bm relative grid gap-12 py-20 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-32">
        <div className="animate-fade-up">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-white/5 px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Originadora de crédito autorizada
          </div>
          <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
            Crédito do varejo,<br />
            <span className="glow-text">na hora certa.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Simulação, aprovação e contratação em minutos no PDV ou no e-commerce.
            Motor de crédito próprio, integração via API e payout no mesmo dia.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#simular" className="btn-primary">Simular meu crédito <ArrowRight className="h-4 w-4" /></a>
            <a href="#parceiros" className="btn-ghost">Sou lojista</a>
          </div>
          <div className="mt-10 flex flex-wrap gap-6 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Regulada BACEN</span>
            <span className="inline-flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> Aprovação em 90s</span>
          </div>
        </div>

        <div className="relative animate-fade-up [animation-delay:120ms]">
          <div className="absolute -inset-10 rounded-full bg-primary/20 blur-3xl" />
          <img
            src={heroImg}
            alt="App BMoto mostrando aprovação de crédito"
            width={1280}
            height={1280}
            className="relative mx-auto w-full max-w-md rounded-3xl shadow-glow"
          />
        </div>
      </div>
    </section>
  );
}
