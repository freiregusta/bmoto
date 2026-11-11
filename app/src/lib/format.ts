export const brl = (v: number | null | undefined, casas = 2) =>
  (v ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });

export const pct = (v: number | null | undefined, casas = 2) =>
  `${((v ?? 0) * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}%`;

export const numero = (v: number | null | undefined, casas = 0) =>
  (v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** "2026-11-11T10:00:00Z" -> "11/11/2026 07:00" (fuso do aparelho) */
export const dataHora = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

export const data = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
};

/** Aceita "R$ 1.234,56", "1234.56" e "1.234,56" — devolve número. */
export function paraNumero(texto: string | number | null | undefined): number {
  if (typeof texto === "number") return texto;
  if (!texto) return 0;
  const limpo = String(texto).replace(/[^\d,.-]/g, "");
  // se tem vírgula, ela é o separador decimal (pt-BR)
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number.parseFloat(normalizado);
  return Number.isFinite(n) ? n : 0;
}

export const mascaraCpf = (v: string) =>
  v.replace(/\D/g, "").slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");

export const mascaraTelefone = (v: string) =>
  v.replace(/\D/g, "").slice(0, 11)
    .replace(/(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2");

/** Validação real de CPF (dígitos verificadores), não só contagem. */
export function cpfValido(bruto: string): boolean {
  const c = bruto.replace(/\D/g, "");
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (base: string, peso: number) => {
    const soma = base.split("").reduce((a, d, i) => a + Number(d) * (peso - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(c.slice(0, 9), 10) === Number(c[9]) && dv(c.slice(0, 10), 11) === Number(c[10]);
}
