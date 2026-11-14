/**
 * AppRoutes — as rotas do app, sempre RELATIVAS à base onde ele foi montado.
 *
 * Relativas de propósito: assim o mesmo componente funciona montado em `/app`
 * (projeto sozinho) ou em `/v2/*` (dentro do projeto do Lovable, ao lado do
 * protótipo antigo). Quem monta decide o prefixo; `rotas.ts` dá os links.
 *
 * Só existe uma rota de produto — `:moduloId`. Resolver qual tela usar é
 * trabalho do ModuloPage, a partir do manifesto. Produto novo não precisa de
 * rota nova.
 */

import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { Carregando } from "./components/ui";
import { AdminShell } from "./admin/AdminShell";
import Inicio from "./pages/Inicio";
import Mais from "./pages/Mais";
import ModuloPage from "./pages/ModuloPage";
import Perfil from "./pages/Perfil";
import Entrada from "./pages/Entrada";
import { usePerfil } from "./platform/PerfilProvider";
import { rotaEntrada, rotaInicio } from "./rotas";
import VisaoGeral from "./admin/VisaoGeral";
import Conexoes from "./admin/Conexoes";
import ProdutosCredito from "./admin/ProdutosCredito";
import AppsEntrega from "./admin/AppsEntrega";
import Modulos from "./admin/Modulos";
import Jornadas from "./admin/Jornadas";
import Auditoria from "./admin/Auditoria";

/** Sem cadastro não há app: quem chega primeiro cria a conta. */
/**
 * Enquanto a sessão está sendo verificada, ESPERA. Mandar para a entrada antes
 * disso perde o destino: quem abre um link direto (ou volta pelo link do
 * e-mail) acabava jogado no início, porque a entrada redireciona quem já está
 * logado.
 */
function ExigeCadastro({ children }: { children: JSX.Element }) {
  const { autenticado, carregando } = usePerfil();
  if (carregando) return <Carregando texto="Abrindo o seu BMoto…" />;
  return autenticado ? children : <Navigate to={rotaEntrada()} replace />;
}

export function AppRoutes() {
  const { autenticado, carregando } = usePerfil();
  return (
    <Routes>
      <Route path="entrar"
             element={!carregando && autenticado
               ? <Navigate to={rotaInicio()} replace /> : <Entrada />} />

      {/* estático vence dinâmico no React Router: /admin não cai em :moduloId */}
      <Route path="admin" element={<ExigeCadastro><AdminShell /></ExigeCadastro>}>
        <Route index element={<VisaoGeral />} />
        <Route path="conexoes" element={<Conexoes />} />
        <Route path="produtos" element={<ProdutosCredito />} />
        <Route path="apps" element={<AppsEntrega />} />
        <Route path="modulos" element={<Modulos />} />
        <Route path="jornadas" element={<Jornadas />} />
        <Route path="auditoria" element={<Auditoria />} />
      </Route>

      <Route element={<ExigeCadastro><Shell /></ExigeCadastro>}>
        <Route index element={<Inicio />} />
        <Route path="mais" element={<Mais />} />
        <Route path="perfil" element={<Perfil />} />
        <Route path=":moduloId" element={<ModuloPage />} />
        <Route path="*" element={<Inicio />} />
      </Route>
    </Routes>
  );
}
