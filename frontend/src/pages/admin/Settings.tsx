export default function AdminSettings() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Perfil, equipe, webhooks e tokens.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="surface p-6">
          <h2 className="font-display text-lg font-semibold">Perfil</h2>
          <div className="mt-4 space-y-3 text-sm">
            <Field label="Nome" value="Demo Admin" />
            <Field label="E-mail" value="demo@bmoto.com.br" />
            <Field label="Empresa" value="BMoto S.A." />
          </div>
        </div>
        <div className="surface p-6">
          <h2 className="font-display text-lg font-semibold">Webhooks</h2>
          <p className="mt-1 text-sm text-muted-foreground">URLs notificadas em eventos de proposta.</p>
          <div className="mt-4 space-y-2">
            {["proposta.criada","proposta.aprovada","proposta.recusada","contrato.assinado"].map((e) => (
              <div key={e} className="flex items-center justify-between rounded-lg border border-border px-4 py-2 text-sm">
                <span className="font-mono text-xs">{e}</span>
                <span className="text-xs text-success">ativo</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <input defaultValue={value} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
    </div>
  );
}
