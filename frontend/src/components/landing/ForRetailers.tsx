import { ArrowRight, Check } from "lucide-react";
import img from "@/assets/retailers.jpg";

const bullets = [
  "Integração API em até 7 dias",
  "Webhook de eventos em tempo real",
  "Painel de origem, conciliação e repasse",
  "Co-marketing e materiais de PDV",
];

export function ForRetailers() {
  return (
    <section id="parceiros" className="py-24">
      <div className="container-bm grid gap-12 lg:grid-cols-2 lg:items-center">
        <div className="relative order-2 lg:order-1">
          <div className="absolute -inset-6 rounded-3xl bg-primary/10 blur-3xl" />
          <img src={img} alt="Tablet BMoto no PDV de um lojista" width={1280} height={960}
               loading="lazy" className="relative w-full rounded-2xl border border-border shadow-card" />
        </div>
        <div className="order-1 lg:order-2">
          <span className="text-xs uppercase tracking-[0.2em] text-primary">Para lojistas</span>
          <h2 className="mt-3 font-display text-4xl font-bold md:text-5xl">
            Aumente sua conversão <span className="glow-text">oferecendo crédito próprio</span>.
          </h2>
          <p className="mt-5 text-lg text-muted-foreground">
            Conecte o BMoto ao seu checkout, ERP ou ao tablet do PDV. Originação,
            risco e cobrança ficam com a gente — você foca em vender.
          </p>
          <ul className="mt-8 space-y-3">
            {bullets.map((b) => (
              <li key={b} className="flex items-center gap-3 text-sm">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-primary">
                  <Check className="h-3.5 w-3.5" />
                </span>
                {b}
              </li>
            ))}
          </ul>
          <a href="mailto:parceiros@bmoto.com.br" className="btn-primary mt-8">
            Falar com vendas <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
