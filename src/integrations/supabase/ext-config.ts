// External (self-owned) Supabase project configuration.
// These two values are public by design (they ship in the browser bundle).
export const EXT_SUPABASE_URL = "https://iggnmbkylikybpespgsr.supabase.co";
export const EXT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_n-zh8KYYCDXNyYod1o_xNw_n7POvAF3";

export function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

export function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // New-format Supabase API keys are opaque strings, not bearer JWTs.
    if (isNewSupabaseApiKey(supabaseKey) && headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}
