const stats = [
  { v: "R$ 2,4 bi", l: "Volume originado" },
  { v: "67%", l: "Taxa de aprovação" },
  { v: "+ 1.200", l: "Lojas parceiras" },
  { v: "90 s", l: "Tempo médio de resposta" },
];

export function StatsBar() {
  return (
    <section className="border-y border-border bg-surface/40">
      <div className="container-bm grid grid-cols-2 gap-8 py-12 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.l}>
            <div className="font-display text-3xl font-bold md:text-5xl glow-text">{s.v}</div>
            <div className="mt-2 text-sm text-muted-foreground">{s.l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
