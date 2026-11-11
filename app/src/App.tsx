/**
 * App — rotas.
 *
 * Só `/app/:moduloId` existe para produtos: resolver qual tela usar é trabalho
 * do `ModuloPage`, a partir do manifesto. Produto novo não precisa de rota
 * nova.
 */

import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { AdminShell } from "./admin/AdminShell";
import { PerfilProvider } from "./platform/PerfilProvider";
import { PlatformProvider } from "./platform/PlatformProvider";
import { registrarTodosOsModulos } from "./modules";
import Inicio from "./pages/Inicio";
import Mais from "./pages/Mais";
import ModuloPage from "./pages/ModuloPage";
import Perfil from "./pages/Perfil";
import VisaoGeral from "./admin/VisaoGeral";
import Conexoes from "./admin/Conexoes";
import ProdutosCredito from "./admin/ProdutosCredito";
import AppsEntrega from "./admin/AppsEntrega";
import Modulos from "./admin/Modulos";
import Jornadas from "./admin/Jornadas";
import Auditoria from "./admin/Auditoria";

registrarTodosOsModulos();

export default function App() {
  return (
    <PlatformProvider>
      <PerfilProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />

          <Route path="/app" element={<Shell />}>
            <Route index element={<Inicio />} />
            <Route path="mais" element={<Mais />} />
            <Route path="perfil" element={<Perfil />} />
            <Route path=":moduloId" element={<ModuloPage />} />
          </Route>

          <Route path="/admin" element={<AdminShell />}>
            <Route index element={<VisaoGeral />} />
            <Route path="conexoes" element={<Conexoes />} />
            <Route path="produtos" element={<ProdutosCredito />} />
            <Route path="apps" element={<AppsEntrega />} />
            <Route path="modulos" element={<Modulos />} />
            <Route path="jornadas" element={<Jornadas />} />
            <Route path="auditoria" element={<Auditoria />} />
          </Route>

          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </PerfilProvider>
    </PlatformProvider>
  );
}
