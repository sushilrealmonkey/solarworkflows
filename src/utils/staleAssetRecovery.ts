const staleAssetReloadKey = "solarworkflows:stale-asset-reload-at";
const staleAssetReloadCooldownMs = 10_000;

export function registerStaleAssetRecovery() {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnceForUpdatedAssets();
  });
}

export function isStaleDynamicImportError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error ?? "");

  return /dynamically imported module|failed to fetch dynamically imported module|importing a module script failed|loading chunk/i.test(
    message,
  );
}

export function reloadOnceForUpdatedAssets() {
  const now = Date.now();

  try {
    const previousReload = Number(
      window.sessionStorage.getItem(staleAssetReloadKey) ?? "0",
    );

    if (Number.isFinite(previousReload) && now - previousReload < staleAssetReloadCooldownMs) {
      return false;
    }

    window.sessionStorage.setItem(staleAssetReloadKey, String(now));
  } catch {
    // Storage can be unavailable in private browsing or restricted contexts.
  }

  window.setTimeout(() => {
    window.location.reload();
  }, 50);

  return true;
}
