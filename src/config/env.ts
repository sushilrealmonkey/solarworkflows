export type TestLoginAccount = {
  label: string;
  email: string;
};

export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
  qaTestPassword: import.meta.env.DEV
    ? (import.meta.env.VITE_QA_TEST_PASSWORD ?? "")
    : "",
  qaTestAccounts: import.meta.env.DEV
    ? parseTestLoginAccounts(import.meta.env.VITE_QA_TEST_ACCOUNTS ?? "")
    : [],
};

function parseTestLoginAccounts(value: string): TestLoginAccount[] {
  return value
    .split(";")
    .map((entry) => {
      const [label, email] = entry.split("=").map((part) => part.trim());

      if (!label || !email) {
        return null;
      }

      return { label, email };
    })
    .filter((account): account is TestLoginAccount => Boolean(account));
}
