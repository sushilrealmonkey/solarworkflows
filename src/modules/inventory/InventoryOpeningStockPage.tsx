import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Button,
  EmptyState,
  LoadingSkeleton,
  SearchInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import { hasPermission } from "../crm/crmUtils";
import {
  fetchInventoryOpeningBalanceCandidates,
  setInventoryOpeningBalances,
} from "./inventoryApi";
import { formatStock } from "./inventoryUtils";
import type {
  InventoryOpeningBalanceCandidate,
  InventoryOpeningBalanceEntry,
} from "./types";

export function InventoryOpeningStockPage() {
  const navigate = useNavigate();
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const [candidates, setCandidates] = useState<
    InventoryOpeningBalanceCandidate[]
  >([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [balanceDate, setBalanceDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canView = hasPermission(profile, permissions, "inventory", "view");
  const canCreate = hasPermission(profile, permissions, "inventory", "create");
  const canUpdate = hasPermission(profile, permissions, "inventory", "update");
  const canManage = canView && canCreate && canUpdate;

  async function loadCandidates() {
    if (!canManage) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setCandidates(await fetchInventoryOpeningBalanceCandidates());
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load products eligible for opening stock.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCandidates();
    // Permission/profile changes require a fresh server-side eligibility check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, profile?.id]);

  const filteredCandidates = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return candidates;
    }

    return candidates.filter((candidate) =>
      [
        candidate.product_code,
        candidate.product_name,
        candidate.item_code,
        candidate.unit,
      ]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalizedSearch)),
    );
  }, [candidates, search]);

  const selectedEntries = useMemo(
    () =>
      candidates.reduce<InventoryOpeningBalanceEntry[]>((entries, candidate) => {
        const rawQuantity = quantities[candidate.inventory_item_id]?.trim() ?? "";
        if (!rawQuantity) {
          return entries;
        }

        const quantity = Number(rawQuantity);
        if (Number.isFinite(quantity) && quantity > 0) {
          entries.push({
            inventory_item_id: candidate.inventory_item_id,
            quantity,
          });
        }

        return entries;
      }, []),
    [candidates, quantities],
  );

  if (!canManage) {
    return (
      <AccessDenied
        title="Opening stock setup is not available"
        description="Your role needs inventory view, create, and update access to initialize stock."
      />
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const invalidEntry = candidates.find((candidate) => {
      const rawQuantity = quantities[candidate.inventory_item_id]?.trim() ?? "";
      if (!rawQuantity) {
        return false;
      }

      const quantity = Number(rawQuantity);
      return !Number.isFinite(quantity) || quantity < 0;
    });

    if (invalidEntry) {
      showToast(
        `Enter a valid non-negative quantity for ${invalidEntry.product_name}.`,
        "error",
      );
      return;
    }

    if (selectedEntries.length === 0) {
      showToast("Enter an opening quantity greater than zero for at least one product.", "error");
      return;
    }

    if (!balanceDate) {
      showToast("Opening balance date is required.", "error");
      return;
    }

    try {
      setSaving(true);
      const result = await setInventoryOpeningBalances(
        selectedEntries,
        balanceDate,
        notes,
      );
      showToast(
        `Opening stock saved for ${result.processed_count} product${
          result.processed_count === 1 ? "" : "s"
        }.`,
        "success",
      );
      navigate("/inventory");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Opening stock could not be saved.",
        "error",
      );
      await loadCandidates();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#06173f]" to="/inventory">
        Back to inventory
      </Link>

      <PageHeader
        title="Set Opening Stock"
        description="Enter the physical quantity already on hand. Each product can receive an opening balance only before its first stock movement."
      />

      {loading ? <LoadingSkeleton /> : null}
      {error ? (
        <EmptyState title="Could not load opening stock" description={error} />
      ) : null}
      {!loading && !error && candidates.length === 0 ? (
        <EmptyState
          title="Opening stock is complete"
          description="There are no active products eligible for an opening balance. Future stock should enter through Material Received."
          action={
            <Link className="font-semibold text-[#06173f]" to="/inventory">
              Return to Inventory
            </Link>
          }
        />
      ) : null}

      {!loading && !error && candidates.length > 0 ? (
        <form className="space-y-5" onSubmit={handleSubmit}>
          <section className="grid gap-4 rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:grid-cols-2">
            <TextInput
              label="Opening Balance Date"
              type="date"
              value={balanceDate}
              onChange={setBalanceDate}
              required
            />
            <SearchInput
              className="block"
              placeholder="Search product or code"
              value={search}
              onChange={setSearch}
            />
            <TextArea
              label="Notes"
              value={notes}
              onChange={setNotes}
            />
          </section>

          <section className="space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-base font-semibold text-slate-950">
                Eligible Products
              </h2>
              <p className="text-sm text-slate-500">
                {selectedEntries.length} selected / {candidates.length} eligible
              </p>
            </div>

            {filteredCandidates.length === 0 ? (
              <EmptyState
                title="No products match this search"
                description="Clear or change the search to see eligible products."
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {filteredCandidates.map((candidate) => (
                  <article
                    className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
                    key={candidate.inventory_item_id}
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {candidate.product_code || candidate.item_code || "Product"}
                        </p>
                        <h3 className="mt-1 font-semibold text-slate-950">
                          {candidate.product_name}
                        </h3>
                      </div>
                      <span className="text-xs font-medium text-slate-500">
                        Current {formatStock(candidate.current_stock, candidate.unit)}
                      </span>
                    </div>
                    <div className="mt-4">
                      <TextInput
                        label={`Opening Quantity${candidate.unit ? ` (${candidate.unit})` : ""}`}
                        type="number"
                        value={quantities[candidate.inventory_item_id] ?? ""}
                        onChange={(quantity) =>
                          setQuantities((current) => ({
                            ...current,
                            [candidate.inventory_item_id]: quantity,
                          }))
                        }
                      />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="sticky bottom-3 flex flex-col gap-3 rounded-xl border border-stone-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              Only quantities greater than zero will be saved.
            </p>
            <Button disabled={saving || selectedEntries.length === 0} type="submit">
              {saving ? "Saving Opening Stock..." : "Save Opening Stock"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
