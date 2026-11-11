"""
plataforma — camada plugável do BMoto.

Três ideias, só:

1. **Ports** (`ports.py`): contratos (Protocols) que a aplicação enxerga —
   ContaProvider, CartaoProvider, KycProvider, CreditoProvider, SeguroProvider,
   SaudeProvider, ContadorProvider, RendaProvider. O resto do código fala só
   com esses contratos, nunca com Celcoin/Dock/Qi Tech/etc. diretamente.

2. **Adapters** (`adapters/`): implementações dos ports. `mock` roda hoje,
   sem credencial; `celcoin` é o esqueleto real. Trocar de BaaS é trocar
   uma env (`BAAS_CONTA_PROVIDER=celcoin`) — zero mudança no app.

3. **Registry** (`registry.py`): quem resolve qual adapter atende cada port
   (por env) e quais produtos estão ligados (manifestos + feature flags).
   O consignado CLT continua aqui, `enabled=False`, preservado.

Uso:
    from plataforma import plataforma
    conta = plataforma.conta()             # ContaProvider ativo
    mods  = plataforma.produtos.ativos()   # módulos ligados (vai para o app)

Nome `plataforma` (e não `platform`) para não sombrear o módulo da stdlib.
"""

from .registry import plataforma, Plataforma, ProductRegistry, ProviderRegistry

__all__ = ["plataforma", "Plataforma", "ProductRegistry", "ProviderRegistry"]
