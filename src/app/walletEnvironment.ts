export interface WalletConnectionEnvironment {
  reownProjectId?: string;
  error?: string;
}

const REOWN_PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function readWalletConnectionEnvironment(
  env: Record<string, string | boolean | undefined>,
): WalletConnectionEnvironment {
  const projectId = typeof env.VITE_REOWN_PROJECT_ID === "string"
    ? env.VITE_REOWN_PROJECT_ID.trim()
    : "";

  if (!projectId) return {};
  if (!REOWN_PROJECT_ID_PATTERN.test(projectId)) {
    return {
      error: "Mobile wallet connection is disabled because VITE_REOWN_PROJECT_ID is invalid.",
    };
  }
  return { reownProjectId: projectId };
}

export const walletConnectionEnvironment = readWalletConnectionEnvironment(import.meta.env);
