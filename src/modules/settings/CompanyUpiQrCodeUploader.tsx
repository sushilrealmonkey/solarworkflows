import { useRef, useState, type ChangeEvent } from "react";

const maxQrCodeBytes = 1024 * 1024;
const supportedTypes = ["image/png", "image/jpeg"];

export function CompanyUpiQrCodeUploader({
  currentUrl,
  disabled,
  readOnly = false,
  onUpload,
}: {
  currentUrl: string;
  disabled: boolean;
  readOnly?: boolean;
  onUpload: (file: File) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    if (!supportedTypes.includes(file.type)) {
      setError("Choose a PNG or JPEG UPI QR code.");
      input.value = "";
      return;
    }

    if (file.size > maxQrCodeBytes) {
      setError("The UPI QR code must be 1 MB or smaller.");
      input.value = "";
      return;
    }

    try {
      setUploading(true);
      setError(null);
      await onUpload(file);
      input.value = "";
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "UPI QR code upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-white p-3 sm:h-32 sm:w-32">
          {currentUrl ? (
            <img
              alt="Company UPI payment QR code"
              className="h-full w-full object-contain"
              src={currentUrl}
            />
          ) : (
            <span className="px-3 text-center text-sm text-slate-500">
              No UPI QR code uploaded
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 sm:px-1">
          <p className="text-sm font-semibold text-slate-950">
            {currentUrl ? "Your current UPI payment QR code" : "Upload your UPI payment QR code"}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">
            This code will be printed on newly generated quotations so customers can scan to pay. Use a clear PNG or JPEG up to 1 MB; it is kept unaltered to remain scannable.
          </p>
          {error ? (
            <p className="mt-2 text-xs text-rose-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        {!readOnly ? (
          <label
            className={`inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition sm:w-auto ${
              disabled || uploading
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700"
            }`}
          >
            {uploading ? "Uploading..." : currentUrl ? "Replace QR code" : "Choose QR code"}
            <input
              ref={inputRef}
              accept="image/png,image/jpeg"
              className="sr-only"
              disabled={disabled || uploading}
              onChange={(event) => void selectFile(event)}
              type="file"
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}
