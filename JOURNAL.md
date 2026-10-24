# Project Journal — whatsapp_shopping_list

> **Path**: `/Users/gi/teamwork_projects/whatsapp_shopping_list`  
> **Tier**: Tier 2: Teamwork Projects & Autonomous Utilities  
> **Last Updated**: 2026-08-28 00:55:17  
> **Integrity Mode**: Production / Continuous Journaling  

## Stato Attuale
- **Sintesi del Progetto**: ## Architecture - Decoupled 3-tier architecture: Transport Adapters (WhatsApp / CLI) -> Core Business Logic (ShoppingListService, MessageParser, Broadcaster) -> Data Layer (DatabaseAdapter with MockDatabaseAdapter & FirestoreAdapter). - Express Web Server for health check pings (`/health`, preventin
- **Componenti e Moduli Attivi**: `DEPLOYMENT.md`, `Dockerfile`, `JOURNAL.md`, `ORIGINAL_REQUEST.md`, `PROJECT.md`, `TEST_INFRA.md`, `TEST_READY.md`, `auth_info_baileys`
- **Attività Storica**: 136 sessioni registrate, 11774 passi eseguiti, 393 prompt utente.

## Decisioni Chiave
- **[2026-08-23]** (`.agents/orchestrator/DISPATCH.md`): Append new user dispatch message to DISPATCH.md
- **[2026-08-23]** (`.agents/orchestrator/BRIEFING.md`): Update BRIEFING.md for WhatsApp Shopping List fix task
- **[2026-08-23]** (`.agents/orchestrator/BRIEFING.md`): Update BRIEFING.md with current session information
- **[2026-08-23]** (`.agents/orchestrator/progress.md`): Update progress.md for current mission
- **[2026-08-23]** (`.agents/orchestrator/plan.md`): Update plan.md for WhatsApp Shopping List Bot Fix task
- **[2026-08-23]** (`.agents/orchestrator/BRIEFING.md`): Update active timers in BRIEFING.md

## Profilo Utente & Metriche
- **Ore Lavorate Totali**: 4.9 ore (dal 2026-08-23 al 2026-08-27)
- **Intensità Operativa**: 393 prompt utente, 5042 invocazioni tool
- **Distribuzione Tool Principali**: `run_command` (2017), `view_file` (1258), `write_to_file` (640), `list_dir` (224)
- **Preferenze Utente Rilevate**:
  - Codice disaccoppiato in 3 livelli (Transport -> Service -> Storage)
  - Logging strutturato e gestione robusta dei selettori dinamici DOM
  - Esecuzione asincrona e gestione dei rate limit
- **Curva di Apprendimento & Focus Tematico**: Sviluppo di toolchain di automazione web/mobile (Playwright, BeautifulSoup, FastAPI, macOS LaunchDaemons) con alta resilienza ai timeout.

## Next Steps
1. Rafforzare la gestione dei fallback in caso di modifiche ai selettori UI
2. Espandere i test end-to-end con mock dei browser context
3. Ottimizzare la pipeline di scheduling dei task periodici
