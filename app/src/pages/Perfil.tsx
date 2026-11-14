/** Perfil — dados do entregador e o que as jornadas já criaram. */

import { useState } from "react";
import { Aviso, Campo, Card, Chip, Icone, SecaoTitulo } from "@/components/ui";
import { brl, cpfValido, mascaraCpf, mascaraTelefone } from "@/lib/format";
import { ErroServidor, funcao } from "@/lib/supabase";
import { usePerfil } from "@/platform/PerfilProvider";

export default function Perfil() {
  const { perfil, carteira, atualizar, sair } = usePerfil();
  const [form, setForm] = useState(perfil);
  const [salvo, setSalvo] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [erroApagar, setErroApagar] = useState("");
  const cpfRuim = form.cpf.replace(/\D/g, "").length === 11 && !cpfValido(form.cpf);

  const apagarTudo = async () => {
    // Duas confirmações porque é irreversível e leva o login junto.
    if (!window.confirm(
      "Apagar sua conta e TODOS os seus dados (ganhos, custos, cadastro e login), "
      + "aqui e no servidor? Não tem como desfazer.")) return;
    setApagando(true);
    setErroApagar("");
    try {
      await funcao("apagar-conta", { confirmacao: "APAGAR" });
      await sair();
    } catch (e: any) {
      setErroApagar(e instanceof ErroServidor
        ? e.message
        : "Não deu para apagar agora. Sem servidor, nada é apagado de verdade — "
          + "tente de novo em instantes.");
    } finally {
      setApagando(false);
    }
  };

  const salvar = () => {
    void atualizar({ nome: form.nome, celular: form.celular, nascimento: form.nascimento });
    setSalvo(true);
    window.setTimeout(() => setSalvo(false), 2200);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Seu perfil</h1>

      <Card className="space-y-3">
        <SecaoTitulo titulo="Dados pessoais"
                     subtitulo="Usados nas jornadas de conta, crédito e seguro" />
        <Campo rotulo="Nome completo" obrigatorio>
          <input className="input" value={form.nome}
                 onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        </Campo>
        <Campo rotulo="CPF" obrigatorio erro={cpfRuim ? "CPF inválido" : undefined}>
          <input className="input" inputMode="numeric" value={mascaraCpf(form.cpf)}
                 onChange={(e) => setForm({ ...form, cpf: e.target.value })} />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Nascimento" obrigatorio>
            <input className="input" type="date" value={form.nascimento}
                   onChange={(e) => setForm({ ...form, nascimento: e.target.value })} />
          </Campo>
          <Campo rotulo="Celular">
            <input className="input" inputMode="tel" value={form.celular}
                   onChange={(e) => setForm({ ...form, celular: mascaraTelefone(e.target.value) })} />
          </Campo>
        </div>
        <Campo rotulo="E-mail">
          <input className="input" type="email" value={form.email}
                 onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Campo>
        {salvo && <Aviso tom="ok">Dados salvos.</Aviso>}
        <button className="btn-primary w-full" onClick={salvar} disabled={cpfRuim || !form.nome}>
          Salvar
        </button>
      </Card>

      <Card>
        <SecaoTitulo titulo="O que você já tem" subtitulo="Criado pelas jornadas" />
        {Object.keys(carteira).length === 0 ? (
          <p className="text-sm text-ink-faint">Nada ainda. Comece abrindo sua conta.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {carteira.conta && (
              <Item icone="Wallet" rotulo="Conta BMoto"
                    valor={`Ag. ${carteira.conta.agencia} · ${carteira.conta.numero}`} />
            )}
            {carteira.mei && <Item icone="FileText" rotulo="MEI" valor={carteira.mei.cnpj} />}
            {carteira.cartao && (
              <Item icone="CreditCard" rotulo="Cartão"
                    valor={`•••• ${carteira.cartao.ultimos4} · ${brl(carteira.cartao.limite)}`} />
            )}
            {carteira.contrato && (
              <Item icone="FileSignature" rotulo="Financiamento"
                    valor={`${carteira.contrato.parcelas}x de ${brl(carteira.contrato.parcela)}`} />
            )}
            {carteira.apolice && (
              <Item icone="Shield" rotulo="Seguro"
                    valor={`${brl(carteira.apolice.premio_mensal)}/mês`} />
            )}
            {carteira.plano_saude && (
              <Item icone="HeartPulse" rotulo="Plano de saúde"
                    valor={`${brl(carteira.plano_saude.premio_mensal)}/mês`} />
            )}
            {carteira.apps_conectados?.length ? (
              <Item icone="Smartphone" rotulo="Apps conectados"
                    valor={carteira.apps_conectados.map((a) => a.nome).join(", ")} />
            ) : null}
          </ul>
        )}
      </Card>

      <Card>
        <SecaoTitulo titulo="Este aparelho"
                     subtitulo="Enquanto não há login, tudo fica salvo só aqui" />
        <div className="flex items-center gap-2">
          <Chip tom="on">conta criada</Chip>
        </div>
        <button className="btn-ghost mt-4 w-full" onClick={sair}>
          <Icone nome="Power" className="h-4 w-4" />
          Sair desta conta
        </button>
        <button className="btn-ghost mt-2 w-full text-danger" disabled={apagando}
                onClick={() => void apagarTudo()}>
          <Icone nome="Trash2" className="h-4 w-4" />
          {apagando ? "Apagando…" : "Apagar minha conta e meus dados"}
        </button>
        {erroApagar && <Aviso tom="erro" className="mt-2">{erroApagar}</Aviso>}
        <p className="mt-2 text-xs leading-relaxed text-ink-faint">
          Apaga de verdade: ganhos, custos, cadastro e o login, aqui e no servidor. Não tem
          como desfazer.
        </p>
      </Card>
    </div>
  );
}

function Item({ icone, rotulo, valor }: { icone: string; rotulo: string; valor: string }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[.03] p-3">
      <Icone nome={icone} className="h-4 w-4 text-mint" />
      <span className="text-ink-muted">{rotulo}</span>
      <span className="ml-auto truncate font-semibold">{valor}</span>
    </li>
  );
}
