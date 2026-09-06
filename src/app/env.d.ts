/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DREAMDEX_OPERATOR_ID?: string;
  readonly VITE_DREAMDEX_VENUE_ID?: string;
  readonly VITE_DREAMDEX_INDEXER_URL?: string;
  readonly VITE_SOMNIA_HTTP_RPC_URL?: string;
  readonly VITE_SOMNIA_WS_RPC_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}
