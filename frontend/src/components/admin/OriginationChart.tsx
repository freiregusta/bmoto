import { originationSeries } from "@/data/mock";

export function OriginationChart() {
  const w = 700, h = 220, p = 24;
  const max = Math.max(...originationSeries.map((d) => d.v));
  const step = (w - p * 2) / (originationSeries.length - 1);
  const points = originationSeries.map((d, i) => {
    const x = p + i * step;
    const y = h - p - ((d.v / max) * (h - p * 2));
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  const area = `${path} L${points[points.length - 1][0]},${h - p} L${p},${h - p} Z`;

  return (
    <div className="surface p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-muted-foreground">Originação mensal</div>
          <div className="font-display text-2xl font-bold">R$ 48,3M <span className="text-sm font-normal text-success">+12% vs mês ant.</span></div>
        </div>
        <div className="flex gap-2 text-xs">
          {["7d","30d","12m"].map((p,i) => (
            <button key={p} className={`rounded-full px-3 py-1 ${i===2 ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>{p}</button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 w-full">
        <defs>
          <linearGradient id="g1" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--color-primary))" stopOpacity="0.4" />
            <stop offset="100%" stopColor="hsl(var(--color-primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#g1)" />
        <path d={path} fill="none" stroke="hsl(var(--color-primary))" strokeWidth="2.5" />
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3" fill="hsl(var(--color-primary-glow))" />
        ))}
        {originationSeries.map((d, i) => (
          <text key={d.m} x={p + i * step} y={h - 4} fontSize="10" textAnchor="middle" fill="hsl(var(--color-muted-foreground))">
            {d.m}
          </text>
        ))}
      </svg>
    </div>
  );
}
