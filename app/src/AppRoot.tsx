/**
 * AppRoot — o app inteiro em um componente: provedores, registro de módulos
 * e rotas relativas.
 *
 * É este o ponto de entrada quando o app é embutido em outro projeto (no
 * Lovable ele é montado em `/v2/*`, ao lado do protótipo antigo). Precisa
 * estar dentro de um Router — quem embute já tem o seu.
 */

import { AppRoutes } from "./AppRoutes";
import { PerfilProvider } from "./platform/PerfilProvider";
import { PlatformProvider } from "./platform/PlatformProvider";
import { registrarTodosOsModulos } from "./modules";

registrarTodosOsModulos();

export default function AppRoot() {
  // `bmoto-app` é o escopo visual do app. Sozinho ele é inócuo (o estilo vem
  // do body); embutido em outro projeto, é o que prende o tema a esta subárvore
  // e impede que os estilos do hospedeiro e os daqui se atropelem.
  return (
    <div className="bmoto-app">
      <PlatformProvider>
        <PerfilProvider>
          <AppRoutes />
        </PerfilProvider>
      </PlatformProvider>
    </div>
  );
}
