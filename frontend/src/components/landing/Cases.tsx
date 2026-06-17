const logos = ["MotoCenter", "BikePoint", "Garagem N.", "Velocity", "RodaLivre", "Auto+", "Pista 7", "MaxBike"];

const cases = [
  { nome: "MotoCenter SP", metric: "+38%", desc: "de conversão no carrinho após integrar o BNPL BMoto no checkout." },
  { nome: "BikePoint RJ",  metric: "R$ 8,1M", desc: "originados em 6 meses com cartão private label da rede." },
  { nome: "Garagem Norte", metric: "−42%",   desc: "no tempo de aprovação após migração do motor antigo para BMoto." },
];

export function Cases() {
  return (
    <section className="border-y border-border bg-surface/30 py-24">
      <div className="container-bm">
        <span className="text-xs uppercase tracking-[0.2em] text-primary">Quem já confia</span>
        <h2 className="mt-3 max-w-3xl font-display text-4xl font-bold md:text-5xl">
          Varejistas crescendo com a BMoto.
        </h2>

        <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-4">
          {logos.map((l) => (
            <div key={l} className="grid h-20 place-items-center bg-card font-display text-muted-foreground">
              {l}
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {cases.map((c) => (
            <div key={c.nome} className="surface p-8">
              <div className="font-display text-4xl font-bold glow-text">{c.metric}</div>
              <div className="mt-4 text-sm font-semibold">{c.nome}</div>
              <p className="mt-2 text-sm text-muted-foreground">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
