import { useRef, useState, type DragEvent, type FormEvent } from "react";
import {
  Badge,
  Button,
  Modal,
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import { formatDate, formatDateTime, labelize } from "../crm/crmUtils";
import {
  documentRelatedLabel,
  documentStatusTone,
  documentTypeOptions,
  fileSizeLabel,
} from "./documentUtils";
import type {
  DocumentUploadValues,
  OrganizationDocumentWithRelations,
} from "./types";

export function DocumentStatusBadge({
  value,
}: {
  value: string | null | undefined;
}) {
  return <Badge tone={documentStatusTone(value)}>{labelize(value)}</Badge>;
}

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
  const update = (key: keyof DocumentUploadValues, value: string) =>
    setValues({ ...values, [key]: value });

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
      <SelectInput
        label="Document Type"
        value={values.document_type}
        onChange={(value) => update("document_type", value)}
        options={documentTypeOptions.map((value) => ({
          value,
          label: labelize(value),
        }))}
      />
      {errors.document_type ? (
        <p className="-mt-3 text-xs text-rose-700">{errors.document_type}</p>
      ) : null}
      <TextInput
        label="Document Name"
        value={values.document_name}
        onChange={(value) => update("document_name", value)}
        error={errors.document_name}
        required
      />
      <div className="md:col-span-2">
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          onChange={(event) => setFile(event.target.files?.item(0) ?? null)}
        />
        <div
          className={`rounded-xl border border-dashed p-5 text-center transition-colors ${
            dragging
              ? "border-brand-600 bg-brand-50"
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
          <div className="mt-4">
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
      <TextArea
        label="Notes"
        value={values.notes}
        onChange={(value) => update("notes", value)}
      />
    </Modal>
  );
}

export function DocumentsCollection({
  documents,
  canUpdate,
  canDelete,
  compact = false,
  onVerify,
  onReject,
  onDelete,
}: {
  documents: OrganizationDocumentWithRelations[];
  canUpdate: boolean;
  canDelete: boolean;
  compact?: boolean;
  onVerify: (document: OrganizationDocumentWithRelations) => void;
  onReject: (document: OrganizationDocumentWithRelations) => void;
  onDelete: (document: OrganizationDocumentWithRelations) => void;
}) {
  if (documents.length === 0) {
    return null;
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm 2xl:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Document</th>
              <th className="px-4 py-3">Type</th>
              {!compact ? <th className="px-4 py-3">Related</th> : null}
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Uploaded By</th>
              <th className="px-4 py-3">Verified By</th>
              <th className="px-4 py-3">Verified At</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {documents.map((document) => (
              <tr key={document.id}>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-950">
                    {document.document_name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {fileSizeLabel(document.file_size)}
                  </div>
                </td>
                <td className="px-4 py-3">{labelize(document.document_type)}</td>
                {!compact ? (
                  <td className="px-4 py-3">{documentRelatedLabel(document)}</td>
                ) : null}
                <td className="px-4 py-3">
                  <DocumentStatusBadge value={document.status} />
                </td>
                <td className="px-4 py-3">{profileName(document.uploaded_by_profile)}</td>
                <td className="px-4 py-3">{profileName(document.verified_by_profile)}</td>
                <td className="px-4 py-3">{formatDateTime(document.verified_at)}</td>
                <td className="px-4 py-3">{formatDate(document.created_at)}</td>
                <td className="px-4 py-3">
                  <DocumentActions
                    document={document}
                    canUpdate={canUpdate}
                    canDelete={canDelete}
                    onVerify={onVerify}
                    onReject={onReject}
                    onDelete={onDelete}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 2xl:hidden">
        {documents.map((document) => (
          <article
            key={document.id}
            className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {labelize(document.document_type)}
                </p>
                <h2 className="mt-1 text-base font-semibold text-slate-950">
                  {document.document_name}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {documentRelatedLabel(document)}
                </p>
              </div>
              <DocumentStatusBadge value={document.status} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <DocumentCardItem
                label="Uploaded By"
                value={profileName(document.uploaded_by_profile)}
              />
              <DocumentCardItem
                label="Verified By"
                value={profileName(document.verified_by_profile)}
              />
              <DocumentCardItem
                label="Verified At"
                value={formatDateTime(document.verified_at)}
              />
              <DocumentCardItem
                label="Created"
                value={formatDate(document.created_at)}
              />
            </dl>
            <div className="mt-4">
              <DocumentActions
                document={document}
                canUpdate={canUpdate}
                canDelete={canDelete}
                onVerify={onVerify}
                onReject={onReject}
                onDelete={onDelete}
              />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

export function RejectDocumentDialog({
  document,
  note,
  setNote,
  confirming,
  onCancel,
  onConfirm,
}: {
  document: OrganizationDocumentWithRelations;
  note: string;
  setNote: (note: string) => void;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <section className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-950">Reject document?</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Add the rejection note for {document.document_name}.
        </p>
        <label className="mt-4 block">
          <span className="text-sm font-medium text-slate-700">Rejection Note</span>
          <textarea
            className="mt-1 min-h-28 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button onClick={onCancel} variant="secondary" disabled={confirming}>
            Cancel
          </Button>
          <Button onClick={onConfirm} variant="danger" disabled={confirming}>
            {confirming ? "Rejecting..." : "Reject Document"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function DocumentActions({
  document,
  canUpdate,
  canDelete,
  onVerify,
  onReject,
  onDelete,
}: {
  document: OrganizationDocumentWithRelations;
  canUpdate: boolean;
  canDelete: boolean;
  onVerify: (document: OrganizationDocumentWithRelations) => void;
  onReject: (document: OrganizationDocumentWithRelations) => void;
  onDelete: (document: OrganizationDocumentWithRelations) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {document.preview_url ? (
        <a
          className="inline-flex min-h-9 items-center rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-stone-50"
          href={document.preview_url}
          rel="noreferrer"
          target="_blank"
        >
          Preview File
        </a>
      ) : null}
      {canUpdate ? (
        <>
          <Button onClick={() => onVerify(document)} variant="secondary">
            Verify
          </Button>
          <Button onClick={() => onReject(document)} variant="danger">
            Reject
          </Button>
        </>
      ) : null}
      {canDelete ? (
        <Button onClick={() => onDelete(document)} variant="danger">
          Delete
        </Button>
      ) : null}
    </div>
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

function profileName(
  profile:
    | {
        full_name: string | null;
        phone: string | null;
        email: string | null;
      }
    | null
    | undefined,
) {
  return profile?.full_name ?? profile?.email ?? profile?.phone ?? "-";
}
