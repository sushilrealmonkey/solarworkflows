import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Product } from "../product-master/types";

type QuotationProductSelectProps = {
  value: string;
  products: Product[];
  categoryName: string;
  onChange: (productId: string) => void;
  onAddProduct?: () => void;
  canCreateProduct: boolean;
  label?: string;
  ariaLabel?: string;
  showLabel?: boolean;
  disabled?: boolean;
  placeholder?: string;
};

export function QuotationProductSelect({
  value,
  products,
  categoryName,
  onChange,
  onAddProduct,
  canCreateProduct,
  label = "Product",
  ariaLabel,
  showLabel = true,
  disabled = false,
  placeholder = "Select product",
}: QuotationProductSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [desktopLayout, setDesktopLayout] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const eligibleProducts = useMemo(() => dedupeProducts(products), [products]);
  const selectedProduct = eligibleProducts.find((product) => product.id === value) ?? null;
  const filteredProducts = useMemo(
    () => filterQuotationProducts(eligibleProducts, search),
    [eligibleProducts, search],
  );
  const displayCategoryName = categoryName.trim() || "this category";
  const selectedProductLabels = selectedProduct
    ? productDisplayLabels(selectedProduct)
    : null;
  const showPersistentAddAction =
    canCreateProduct &&
    Boolean(onAddProduct) &&
    eligibleProducts.length > 0 &&
    filteredProducts.length > 0;

  useEffect(() => {
    if (!open) {
      return;
    }

    function updateLayout() {
      const isDesktop = window.innerWidth >= 768;
      setDesktopLayout(isDesktop);

      if (!isDesktop || !triggerRef.current) {
        setPopoverStyle({});
        return;
      }

      const rect = triggerRef.current.getBoundingClientRect();
      const gutter = 12;
      const width = Math.min(
        Math.max(rect.width, 520),
        Math.min(640, window.innerWidth - gutter * 2),
      );
      const left = Math.min(
        Math.max(rect.left, gutter),
        window.innerWidth - width - gutter,
      );
      const estimatedHeight = 430;
      const roomBelow = window.innerHeight - rect.bottom;
      const top =
        roomBelow >= 280 || roomBelow >= rect.top
          ? Math.min(rect.bottom + 8, window.innerHeight - gutter)
          : Math.max(gutter, rect.top - estimatedHeight - 8);

      setPopoverStyle({ left, top, width });
    }

    updateLayout();
    window.addEventListener("resize", updateLayout);
    window.addEventListener("scroll", updateLayout, true);
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("scroll", updateLayout, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const selectedIndex = filteredProducts.findIndex((product) => product.id === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : filteredProducts.length > 0 ? 0 : -1);
  }, [filteredProducts, open, value]);

  function openSelector() {
    if (disabled) {
      return;
    }

    setSearch("");
    setOpen(true);
  }

  function closeSelector({ restoreFocus = true } = {}) {
    setOpen(false);
    setSearch("");
    if (restoreFocus) {
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
  }

  function selectProduct(productId: string) {
    onChange(productId);
    closeSelector();
  }

  function addProduct() {
    closeSelector({ restoreFocus: false });
    onAddProduct?.();
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        filteredProducts.length === 0 ? -1 : (current + 1) % filteredProducts.length,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        filteredProducts.length === 0
          ? -1
          : (current - 1 + filteredProducts.length) % filteredProducts.length,
      );
      return;
    }

    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectProduct(filteredProducts[activeIndex].id);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSelector();
    }
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSelector();
      return;
    }

    if (event.key !== "Tab" || !panelRef.current) {
      return;
    }

    const focusableElements = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement?.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement?.focus();
    }
  }

  const trigger = (
    <button
      ref={triggerRef}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={ariaLabel ?? label}
      className="mt-1 flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-left text-sm text-slate-950 outline-none transition hover:border-stone-300 focus:border-orange-600 focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-slate-500"
      disabled={disabled}
      onClick={openSelector}
      type="button"
    >
      <span className="min-w-0">
        <span
          className={`block truncate ${selectedProduct ? "font-semibold" : "text-slate-500"}`}
          title={selectedProduct?.product_name}
        >
          {selectedProductLabels?.primary ?? placeholder}
        </span>
        {selectedProductLabels?.secondary ? (
          <span className="mt-0.5 block truncate text-xs font-normal text-slate-500">
            {selectedProductLabels.secondary}
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="shrink-0 text-slate-400">
        ⌄
      </span>
    </button>
  );

  return (
    <>
      {showLabel ? (
        <label className="block">
          <span className="text-sm font-medium text-slate-700">{label}</span>
          {trigger}
        </label>
      ) : (
        trigger
      )}

      {open
        ? createPortal(
            <div
              className={`fixed inset-0 z-50 flex bg-slate-950/40 p-0 ${
                desktopLayout ? "items-start bg-transparent" : "items-end"
              }`}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  closeSelector();
                }
              }}
            >
              <section
                ref={panelRef}
                aria-label={`${displayCategoryName} product selection`}
                className={`flex max-h-[88vh] w-full flex-col border border-stone-200 bg-white shadow-2xl ${
                  desktopLayout
                    ? "fixed max-h-[430px] rounded-xl"
                    : "rounded-t-2xl"
                }`}
                onKeyDown={handlePanelKeyDown}
                role="dialog"
                style={desktopLayout ? popoverStyle : undefined}
              >
                <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
                  <h2 className="truncate font-semibold text-slate-950">
                    Select {displayCategoryName}
                  </h2>
                  <button
                    aria-label="Close product selector"
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-xl leading-none text-slate-500 transition hover:bg-stone-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-orange-200"
                    onClick={() => closeSelector()}
                    type="button"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>

                {eligibleProducts.length > 0 ? (
                  <div className="px-3 py-3">
                    <label className="block">
                      <span className="sr-only">Search products</span>
                      <input
                        ref={searchRef}
                        aria-activedescendant={
                          activeIndex >= 0
                            ? `${listboxId}-option-${filteredProducts[activeIndex]?.id}`
                            : undefined
                        }
                        aria-autocomplete="list"
                        aria-controls={listboxId}
                        aria-expanded="true"
                        className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-100"
                        onChange={(event) => setSearch(event.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        placeholder="Search products..."
                        role="combobox"
                        type="search"
                        value={search}
                      />
                    </label>
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                  {eligibleProducts.length === 0 ? (
                    <ProductEmptyState
                      actionLabel={`Add ${displayCategoryName}`}
                      canCreateProduct={canCreateProduct && Boolean(onAddProduct)}
                      description={
                        canCreateProduct
                          ? undefined
                          : `Ask an administrator to add a ${displayCategoryName} to Product Master.`
                      }
                      message={
                        canCreateProduct
                          ? `No ${displayCategoryName} products have been added yet.`
                          : `No ${displayCategoryName} products available`
                      }
                      onAddProduct={addProduct}
                    />
                  ) : filteredProducts.length === 0 ? (
                    <ProductEmptyState
                      actionLabel={`Add new ${displayCategoryName}`}
                      canCreateProduct={canCreateProduct && Boolean(onAddProduct)}
                      message={`No products found for "${search.trim()}"`}
                      onAddProduct={addProduct}
                    />
                  ) : (
                    <div aria-label="Products" id={listboxId} role="listbox">
                      {filteredProducts.map((product, index) => {
                        const labels = productDisplayLabels(product);
                        const isSelected = product.id === value;
                        const isActive = index === activeIndex;

                        return (
                          <button
                            aria-selected={isSelected}
                            className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition focus:outline-none focus-visible:border-orange-400 focus-visible:ring-2 focus-visible:ring-orange-200 ${
                              isSelected
                                ? `border-orange-300 bg-orange-50 ${
                                    isActive ? "ring-2 ring-orange-200" : ""
                                  }`
                                : isActive
                                  ? "border-slate-300 bg-slate-100 ring-1 ring-slate-200"
                                  : "border-transparent hover:border-stone-200 hover:bg-stone-50"
                            }`}
                            id={`${listboxId}-option-${product.id}`}
                            key={product.id}
                            onClick={() => selectProduct(product.id)}
                            onFocus={() => setActiveIndex(index)}
                            onMouseEnter={() => setActiveIndex(index)}
                            role="option"
                            title={product.product_name}
                            type="button"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-slate-950">
                                {labels.primary}
                              </span>
                              {labels.secondary ? (
                                <span className="mt-0.5 block truncate text-xs leading-4 text-slate-500">
                                  {labels.secondary}
                                </span>
                              ) : null}
                            </span>
                            {isSelected ? (
                              <span className="shrink-0 text-xs font-semibold text-orange-700">
                                Selected
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {showPersistentAddAction ? (
                    <div className="sticky bottom-0 mt-1 border-t border-stone-200 bg-white px-1 pt-2">
                      <button
                        className="flex min-h-10 w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold text-orange-700 transition hover:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-orange-200"
                        onClick={addProduct}
                        type="button"
                      >
                        + Add new {displayCategoryName}
                      </button>
                    </div>
                  ) : null}
                </div>

                {value ? (
                  <div className="border-t border-stone-200 p-3 text-right">
                    <button
                      className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-200"
                      onClick={() => selectProduct("")}
                      type="button"
                    >
                      Clear selection
                    </button>
                  </div>
                ) : null}
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ProductEmptyState({
  message,
  description,
  actionLabel,
  canCreateProduct,
  onAddProduct,
}: {
  message: string;
  description?: string;
  actionLabel: string;
  canCreateProduct: boolean;
  onAddProduct: () => void;
}) {
  return (
    <div className="m-2 rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-center">
      <p className="text-sm font-semibold text-slate-900">{message}</p>
      {description ? (
        <p className="mt-1 text-sm leading-5 text-slate-600">{description}</p>
      ) : null}
      {canCreateProduct ? (
        <button
          className="mt-3 inline-flex min-h-10 items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-200"
          onClick={onAddProduct}
          type="button"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function dedupeProducts(products: Product[]) {
  const seen = new Set<string>();
  return products.filter((product) => {
    if (seen.has(product.id)) {
      return false;
    }
    seen.add(product.id);
    return true;
  });
}

function filterQuotationProducts(products: Product[], search: string) {
  const term = normalizeSearchValue(search);
  if (!term) {
    return products;
  }

  return products.filter((product) =>
    [
      product.product_name,
      product.product_code,
      product.brand,
      product.model_number,
      product.hsn_code,
      product.specifications,
    ].some((value) => normalizeSearchValue(value).includes(term)),
  );
}

function productDisplayLabels(product: Product) {
  const brand = product.brand?.trim() ?? "";
  const model = product.model_number?.trim() ?? "";
  const specification = product.specifications?.trim() ?? "";
  const keySpecification = extractKeySpecification(specification);
  const primaryParts = uniqueDisplayParts([brand, model, keySpecification]);
  const primary =
    primaryParts.join(" · ") ||
    product.product_name.trim() ||
    product.product_code.trim() ||
    "Unnamed product";
  const remainingSpecification = keySpecification
    ? specification
        .replace(keySpecification, "")
        .replace(/^[\s·,;|/()-]+|[\s·,;|/()-]+$/g, "")
    : specification;
  const secondary = uniqueDisplayParts([
    remainingSpecification,
    product.hsn_code?.trim() ? `HSN: ${product.hsn_code.trim()}` : "",
  ]).join(" · ");

  return { primary, secondary };
}

function extractKeySpecification(specification: string) {
  if (!specification) {
    return "";
  }

  const capacity = specification.match(
    /\b\d+(?:\.\d+)?\s*(?:kwh|kwp|kw|wp|w|ah|mah|v|a|mm²|mm2|sq\.?\s*mm)\b/i,
  )?.[0];

  if (capacity) {
    return capacity;
  }

  const firstSpecification = specification.split(/[|;,]/, 1)[0]?.trim() ?? "";
  return firstSpecification.length <= 36 ? firstSpecification : "";
}

function uniqueDisplayParts(parts: Array<string | null | undefined>) {
  const normalizedParts = new Set<string>();

  return parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => {
      if (!part) {
        return false;
      }

      const normalizedPart = normalizeSearchValue(part);
      if (normalizedParts.has(normalizedPart)) {
        return false;
      }

      normalizedParts.add(normalizedPart);
      return true;
    });
}

function normalizeSearchValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}
