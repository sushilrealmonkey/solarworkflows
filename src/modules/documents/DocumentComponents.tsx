import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import {
  Button,
  Modal,
  SelectInput,
  TextInput,
} from "../crm/CrmComponents";
import { formatDate, labelize } from "../crm/crmUtils";
import { RecordLifecyclePanel } from "../lifecycle/RecordLifecyclePanel";
import type { LifecycleAction } from "../lifecycle/types";
import { useAuth } from "../../app/AuthProvider";
import {
  createNewDocumentTypeValue,
  documentTypeOptions,
  documentTypeSlug,
  fileSizeLabel,
} from "./documentUtils";
import type {
  DocumentUploadValues,
  OrganizationDocumentWithRelations,
} from "./types";

export function DocumentUploadModal({
  title,
  values,
  setValues,
  file,
  setFile,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: DocumentUploadValues;
  setValues: (values: DocumentUploadValues) => void;
  file: File | null;
  setFile: (file: File | null) => void;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [customDocumentType, setCustomDocumentType] = useState<string | null>(null);

  function updateDocumentType(value: string) {
    setValues({
      ...values,
      document_type: value,
    });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    setFile(event.dataTransfer.files.item(0));
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Upload Document"
      submitting={saving}
    >
      <div className="space-y-2">
        <SelectInput
          label="Document Type"
          value={customDocumentType !== null ? createNewDocumentTypeValue : values.document_type}
          onChange={(value) => {
            if (value === createNewDocumentTypeValue) {
              setCustomDocumentType("");
              updateDocumentType("");
              return;
            }

            setCustomDocumentType(null);
            updateDocumentType(value);
          }}
          options={[
            ...documentTypeOptions.map((value) => ({
              value,
              label: labelize(value),
            })),
            {
              value: createNewDocumentTypeValue,
              label: "Create new document type",
            },
          ]}
        />
        {customDocumentType !== null ? (
          <TextInput
            label="New Document Type"
            value={customDocumentType}
            onChange={(value) => {
              setCustomDocumentType(value);
              updateDocumentType(documentTypeSlug(value));
            }}
            error={errors.document_type}
            required
          />
        ) : errors.document_type ? (
          <p className="text-xs text-rose-700">{errors.document_type}</p>
        ) : null}
      </div>
      <div>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          onChange={(event) => setFile(event.target.files?.item(0) ?? null)}
        />
        <div
          className={`rounded-lg border border-dashed p-3 text-center transition-colors ${
            dragging
              ? "border-orange-600 bg-orange-50"
              : errors.file
                ? "border-rose-300 bg-rose-50"
                : "border-stone-300 bg-stone-50"
          }`}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDrop={handleDrop}
        >
          <p className="text-sm font-semibold text-slate-900">
            {file ? file.name : "Drop file here"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {file ? fileSizeLabel(file.size) : "or choose a file from your device"}
          </p>
          <div className="mt-3">
            <Button
              onClick={() => inputRef.current?.click()}
              type="button"
              variant="secondary"
            >
              Choose File
            </Button>
          </div>
        </div>
        {errors.file ? <p className="mt-1 text-xs text-rose-700">{errors.file}</p> : null}
      </div>
    </Modal>
  );
}

export function DocumentsCollection({
  documents,
  canUpdate,
  canDelete,
  compact = false,
  onLifecycleChanged,
}: {
  documents: OrganizationDocumentWithRelations[];
  canUpdate: boolean;
  canDelete: boolean;
  compact?: boolean;
  onLifecycleChanged: (
    document: OrganizationDocumentWithRelations,
    action: LifecycleAction,
  ) => void | Promise<void>;
}) {
  const documentPagination = useTablePagination(documents);
  const paginatedDocuments = documentPagination.pageItems;

  if (documents.length === 0) {
    return null;
  }

  return (
    <>
      <div className={compact ? "grid grid-cols-2 gap-3 sm:grid-cols-4" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"}>
        {paginatedDocuments.map((document) => (
          <article
            key={document.id}
            className={`flex h-full min-w-0 flex-col overflow-hidden border border-stone-200 bg-white shadow-sm ${compact ? "rounded-lg" : "rounded-xl"}`}
          >
            <DocumentThumbnail document={document} />
            <div className={`flex min-h-0 flex-1 flex-col ${compact ? "p-3" : "p-4"}`}>
              <div className="min-w-0">
                <h2 className={`mt-1 break-words font-semibold text-slate-950 ${compact ? "text-sm" : "text-base"}`}>
                  {document.document_name}
                </h2>
              </div>
              <dl className={`grid grid-cols-2 text-sm ${compact ? "mt-3 gap-2 text-xs" : "mt-4 gap-3"}`}>
                <DocumentCardItem label="Created" value={formatShortDate(document.created_at)} />
              </dl>
            </div>
            <div className={`mt-auto border-t border-stone-100 ${compact ? "px-3 py-2" : "px-4 py-3"}`}>
              <DocumentActions
                compact={compact}
                document={document}
                canUpdate={canUpdate}
                canDelete={canDelete}
                onLifecycleChanged={onLifecycleChanged}
              />
            </div>
          </article>
        ))}
      </div>
      <TablePagination label="documents" pagination={documentPagination} />
    </>
  );
}

function DocumentActions({
  compact = false,
  document,
  canUpdate,
  canDelete,
  onLifecycleChanged,
}: {
  compact?: boolean;
  document: OrganizationDocumentWithRelations;
  canUpdate: boolean;
  canDelete: boolean;
  onLifecycleChanged: (
    document: OrganizationDocumentWithRelations,
    action: LifecycleAction,
  ) => void | Promise<void>;
}) {
  const { subscription } = useAuth();
  const isProSource = Boolean(
    document.invoice_id ||
    document.proforma_invoice_id ||
    document.purchase_order_id,
  );
  const proSourceWriteAllowed =
    !isProSource ||
    !subscription ||
    subscription.capability_access?.["documents.pro_sources"] === "full";
  const downloadUrl = proSourceWriteAllowed
    ? document.preview_url ?? document.file_url
    : null;

  return (
    <div className={`flex items-center justify-end ${compact ? "gap-1" : "gap-2"}`}>
      {downloadUrl ? (
        <a
          aria-label={`Download ${document.document_name}`}
          className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-orange-600 bg-orange-600 text-white shadow-sm transition-colors hover:bg-orange-700 ${compact ? "size-8" : "size-9"}`}
          download
          href={downloadUrl}
          rel="noreferrer"
          target="_blank"
          title="Download"
        >
          <DownloadIcon />
        </a>
      ) : (
        <button
          aria-label="Download unavailable"
          className={`inline-flex shrink-0 cursor-not-allowed items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-slate-400 ${compact ? "size-8" : "size-9"}`}
          disabled
          title={isProSource && !proSourceWriteAllowed ? "Upgrade to Pro to download" : "Download unavailable"}
          type="button"
        >
          <DownloadIcon />
        </button>
      )}
      <RecordLifecyclePanel
        archiveReason={document.archive_reason}
        archivedAt={document.archived_at}
        canDelete={canDelete && proSourceWriteAllowed}
        canUpdate={canUpdate && proSourceWriteAllowed}
        compact
        iconOnlyActions
        moduleKey="documents"
        onChanged={(action) => onLifecycleChanged(document, action)}
        recordId={document.id}
        recordLabel={document.document_name}
      />
    </div>
  );
}

function DocumentThumbnail({
  document,
}: {
  document: OrganizationDocumentWithRelations;
}) {
  const fileName = document.file_path.split("/").pop() ?? document.document_name;
  const extension = fileName.includes(".")
    ? fileName.split(".").pop()?.toLowerCase()
    : "";
  const mimeType = document.mime_type?.toLowerCase() ?? "";
  const isImage =
    mimeType.startsWith("image/") ||
    ["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(extension ?? "");
  const isPdf = mimeType === "application/pdf" || extension === "pdf";

  return (
    <div className="relative aspect-[16/10] overflow-hidden bg-stone-100">
      {document.preview_url && isImage ? (
        <img
          alt={`${document.document_name} preview`}
          className="h-full w-full object-cover"
          loading="lazy"
          src={document.preview_url}
        />
      ) : document.preview_url && isPdf ? (
        <iframe
          className="pointer-events-none h-[175%] w-full origin-top-left scale-[0.58]"
          loading="lazy"
          src={`${document.preview_url}#toolbar=0&navpanes=0&scrollbar=0`}
          title={`${document.document_name} preview`}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
          <FileIcon />
          <span className="text-xs font-semibold uppercase tracking-[0.18em]">
            {extension || "File"}
          </span>
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded-md bg-slate-950/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
        {isImage ? "Image" : isPdf ? "PDF" : extension || "File"}
      </span>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path d="M12 4v10m0 0 3.5-3.5M12 14 8.5 10.5M5 19.5h14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden="true" className="size-10" fill="none" viewBox="0 0 24 24">
      <path d="M7 3.75h6.25L18 8.5v11.75a.75.75 0 0 1-.75.75h-10.5a.75.75 0 0 1-.75-.75V4.5A.75.75 0 0 1 7 3.75Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M13 3.75V8.5h4.75M9 12h6M9 15h6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}

function DocumentCardItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function formatShortDate(value: string | null) {
  const [day, month, year] = formatDate(value).split("/");
  return day && month && year ? `${day}/${month}/${year.slice(-2)}` : "-";
}
