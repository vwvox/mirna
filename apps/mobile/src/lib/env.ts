import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

const read = (key: string, fallback = ""): string => {
  const value = extra[key];
  return typeof value === "string" && value ? value : fallback;
};

// Mirna sends nothing to hosted services: no account backend, hosted models,
// analytics or crash reporting. Recordings go only to the user's own Mac, and
// transcripts or summaries only to a provider the user sets up with their own key.
export const env = {
  appVariant: read("appVariant", __DEV__ ? "dev" : "stable"),
  appScheme: read("appScheme", "mirna"),
  supabaseUrl: "",
  supabaseAnonKey: "",
  apiUrl: "",
  appUrl: "",
};

export const hasSupabaseEnv: boolean = false;
