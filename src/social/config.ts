export interface SocialConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

function jwtRole(value: string): string | null {
  const payload = value.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const normalized = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(normalized)) as { role?: unknown };
    return typeof decoded.role === "string" ? decoded.role : null;
  } catch {
    return null;
  }
}

export function readSocialConfig(env: ImportMetaEnv): SocialConfig | null {
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
  const supabasePublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl && !supabasePublishableKey) return null;
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Both public Supabase settings are required to enable the social league.");
  }
  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    throw new Error("Supabase URL is invalid.");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("Supabase URL must use HTTPS outside localhost.");
  }
  const role = jwtRole(supabasePublishableKey);
  if (supabasePublishableKey.startsWith("sb_secret_") || role === "service_role") {
    throw new Error("A Supabase service-role or secret key must never be exposed to Vite.");
  }
  if (!supabasePublishableKey.startsWith("sb_publishable_") && role !== "anon") {
    throw new Error("Vite requires a Supabase publishable key or legacy anon key.");
  }
  return { supabaseUrl: parsed.toString().replace(/\/$/, ""), supabasePublishableKey };
}
