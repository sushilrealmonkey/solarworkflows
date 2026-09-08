import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthThemeCard, AuthThemeShell } from "../auth/AuthTheme";
import { Button } from "../crm/CrmComponents";
import {
  fetchProductBankProducts,
  importProductBankProducts,
} from "../product-bank/productBankApi";
import type { ProductBankProduct } from "../product-bank/types";
import { advanceCurrentCompanyOnboarding } from "./onboardingApi";
import { useOnboarding } from "./OnboardingGate";

type Action = "add" | "continue" | "back" | null;

export function OnboardingProductBankPage() {
  const navigate = useNavigate();
  const { setProgress } = useOnboarding();
  const [products, setProducts] = useState<ProductBankProduct[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function loadProducts() {
    try {
      setLoading(true);
      setError(null);
      setProducts(await fetchProductBankProducts());
    } catch (nextError) {
      setError(messageOf(nextError, "Product Bank could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProducts();
  }, []);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter((product) => [
      product.product_name,
      product.category.name,
      product.brand,
      product.model_number,
      product.specifications,
    ].some((value) => value?.toLowerCase().includes(term)));
  }, [products, search]);

  function toggle(product: ProductBankProduct) {
    if (product.workspace_product && !product.workspace_product.archived_at) return;
    setSelectedIds((current) => current.includes(product.id)
      ? current.filter((id) => id !== product.id)
      : [...current, product.id]);
  }

  async function addSelected() {
    if (action || selectedIds.length === 0) return;
    try {
      setAction("add");
      setError(null);
      await importProductBankProducts(selectedIds);
      setSelectedIds([]);
      await loadProducts();
    } catch (nextError) {
      setError(messageOf(nextError, "Selected products could not be added."));
    } finally {
      setAction(null);
    }
  }

  async function move(next: "products" | "team", nextAction: "back" | "continue") {
    if (action) return;
    try {
      setAction(nextAction);
      const progress = await advanceCurrentCompanyOnboarding(next);
      setProgress(progress);
      navigate(next === "team" ? "/onboarding/team" : "/onboarding/products", { replace: true });
    } catch (nextError) {
      setError(messageOf(nextError, "Your onboarding progress could not be saved."));
      setAction(null);
    }
  }

  const busy = action !== null;

  return (
    <AuthThemeShell
      badge="Step 3 of 5"
      contentMaxWidthClass="max-w-5xl"
      desktopDescription="Select published templates now. Your workspace receives its own editable Product Master records."
      mobileDescription="Select shared product templates for your workspace."
      title="Choose from Product Bank"
      workspaceLayout
    >
      <AuthThemeCard>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold text-orange-200">Step 3 of 5</p>
          <span className="text-xs font-medium text-slate-400">Products · Product Bank</span>
        </div>
        <div aria-label="Onboarding progress" className="mt-3 flex gap-2">
          {Array.from({ length: 5 }).map((_, index) => <span className={`h-1.5 flex-1 rounded-full ${index < 3 ? "bg-orange-400" : "bg-white/15"}`} key={index} />)}
        </div>

        <input
          className="mt-6 min-h-11 w-full rounded-xl border border-white/15 bg-[#132750] px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-orange-300 focus:ring-2 focus:ring-orange-300/20"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search products, brands, models, or specifications"
          value={search}
        />

        {loading ? <p className="mt-6 text-sm text-slate-300">Loading Product Bank…</p> : null}
        {!loading && !error && visibleProducts.length === 0 ? <p className="mt-6 text-sm text-slate-300">No published products match your search.</p> : null}
        {!loading && visibleProducts.length > 0 ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {visibleProducts.map((product) => {
              const added = Boolean(product.workspace_product && !product.workspace_product.archived_at);
              const selected = selectedIds.includes(product.id);
              return (
                <button
                  className={`rounded-xl border p-4 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-orange-300 ${selected ? "border-orange-300 bg-orange-300/[0.12]" : "border-white/15 bg-white/[0.05] hover:border-white/30"} ${added ? "cursor-default opacity-70" : ""}`}
                  disabled={added || busy}
                  key={product.id}
                  onClick={() => toggle(product)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{product.category.name}</p>
                      <p className="mt-1 font-semibold text-white">{product.product_name}</p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${added ? "bg-emerald-300/15 text-emerald-100" : selected ? "bg-orange-300 text-[#06173f]" : "bg-white/10 text-slate-200"}`}>{added ? "Added" : selected ? "Selected" : "Select"}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{[product.brand, product.model_number, product.specifications].filter(Boolean).join(" · ") || "Ready for your workspace"}</p>
                </button>
              );
            })}
          </div>
        ) : null}

        {error ? <p className="mt-5 rounded-xl border border-red-300/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100" role="alert">{error}</p> : null}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between [&>button]:w-full sm:[&>button]:w-auto">
          <Button disabled={busy} onClick={() => void move("products", "back")} variant="ghost">{action === "back" ? "Going back..." : "Back"}</Button>
          <div className="flex flex-col gap-2 sm:flex-row [&>button]:w-full sm:[&>button]:w-auto">
            {selectedIds.length > 0 ? <Button disabled={busy} onClick={() => void addSelected()} variant="secondary">{action === "add" ? "Adding..." : `Add ${selectedIds.length} selected`}</Button> : null}
            <Button disabled={busy} onClick={() => void move("team", "continue")}>{action === "continue" ? "Continuing..." : "Continue to team"}</Button>
          </div>
        </div>
      </AuthThemeCard>
    </AuthThemeShell>
  );
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
