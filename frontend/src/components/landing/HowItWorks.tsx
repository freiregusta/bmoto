const steps = [
  { n: "01", t: "Simule", d: "Informe valor e prazo. Veja a parcela exata na hora." },
  { n: "02", t: "Aprove", d: "Análise automática com bureau, score e política BMoto em segundos." },
  { n: "03", t: "Assine", d: "Contrato 100% digital com validade jurídica e LGPD." },
  { n: "04", t: "Receba", d: "Recursos liberados no mesmo dia para você ou para o lojista." },
];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="py-24">
      <div className="container-bm">
        <div className="max-w-2xl">
          <span className="text-xs uppercase tracking-[0.2em] text-primary">Como funciona</span>
          <h2 className="mt-3 font-display text-4xl font-bold md:text-5xl">
            Do simulador ao pix em <span className="glow-text">menos de um dia</span>.
          </h2>
        </div>
        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-4">
          {steps.map((s) => (
            <div key={s.n} className="bg-card p-8 transition-colors hover:bg-surface-2">
              <div className="font-display text-sm text-primary">{s.n}</div>
              <div className="mt-4 font-display text-2xl font-semibold">{s.t}</div>
              <p className="mt-3 text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
