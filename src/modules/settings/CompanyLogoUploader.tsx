import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { trimLogoBlob } from "../../utils/logoImage";
import { Button, Modal } from "../crm/CrmComponents";

const maxLogoBytes = 1024 * 1024;
const cropPreviewWidth = 280;
const cropPreviewHeight = 158;

type ImageSize = { width: number; height: number };

export function CompanyLogoUploader({
  currentUrl,
  disabled,
  readOnly = false,
  onUpload,
  tone = "light",
}: {
  currentUrl: string;
  disabled: boolean;
  readOnly?: boolean;
  onUpload: (logo: Blob) => Promise<void>;
  tone?: "light" | "dark";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [zoom, setZoom] = useState(1);
  const [positionX, setPositionX] = useState(0);
  const [positionY, setPositionY] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(
    () => () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    },
    [sourceUrl],
  );

  function closeCropper() {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(null);
    setImageSize(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Choose a valid image file.");
      input.value = "";
      return;
    }

    if (file.size > maxLogoBytes) {
      setError("Company logo files must be 1 MB or smaller.");
      input.value = "";
      return;
    }

    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(null);
    setImageSize(null);
    setZoom(1);
    setPositionX(0);
    setPositionY(0);
    setError(null);

    try {
      setPreparing(true);
      setSourceUrl(URL.createObjectURL(await trimLogoBlob(file)));
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to prepare this logo for cropping.",
      );
      input.value = "";
    } finally {
      setPreparing(false);
    }
  }

  async function submitCrop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!imageRef.current || !imageSize) return;

    try {
      setUploading(true);
      setError(null);
      const blob = await createCroppedLogo(
        imageRef.current,
        imageSize,
        zoom,
        positionX,
        positionY,
      );
      await onUpload(blob);
      closeCropper();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Logo upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const metrics = imageSize
    ? getDrawMetrics(
        imageSize,
        zoom,
        positionX,
        positionY,
        cropPreviewWidth,
        cropPreviewHeight,
      )
    : null;
  const dark = tone === "dark";

  return (
    <div
      className={`overflow-hidden rounded-xl border shadow-sm ${
        dark
          ? "border-white/10 bg-white/[0.06]"
          : "border-stone-200 bg-white"
      }`}
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <div
          className={`flex h-28 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-[length:20px_20px] p-3 sm:w-52 ${
            dark
              ? "border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.07)_25%,rgba(255,255,255,0.03)_25%,rgba(255,255,255,0.03)_50%,rgba(255,255,255,0.07)_50%,rgba(255,255,255,0.07)_75%,rgba(255,255,255,0.03)_75%,rgba(255,255,255,0.03))]"
              : "border-stone-200 bg-[linear-gradient(135deg,#fafaf9_25%,#ffffff_25%,#ffffff_50%,#fafaf9_50%,#fafaf9_75%,#ffffff_75%,#ffffff)]"
          }`}
        >
          {currentUrl ? (
            <img className="h-full w-full object-contain" src={currentUrl} alt="Current company logo" />
          ) : (
            <span className={`text-sm ${dark ? "text-slate-300" : "text-slate-500"}`}>
              No logo uploaded
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 sm:px-1">
          <p className={`text-sm font-semibold ${dark ? "text-white" : "text-slate-950"}`}>
            {currentUrl ? "Your current logo" : "Upload your company logo"}
          </p>
          <p className={`mt-1 max-w-2xl text-xs leading-5 ${dark ? "text-slate-300" : "text-slate-600"}`}>
            Use PNG, JPG, or SVG up to 1 MB. Empty borders are trimmed automatically for a cleaner fit.
          </p>
          {!sourceUrl && error ? (
            <p className={`mt-2 text-xs ${dark ? "text-red-200" : "text-rose-700"}`} role="alert">
              {error}
            </p>
          ) : null}
        </div>
        {!readOnly ? <div className="sm:shrink-0">
          <label className={`inline-flex min-h-10 w-full items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold shadow-sm transition sm:w-auto ${
            dark
              ? "border-white/15 bg-white/10 text-white hover:border-orange-300/50 hover:bg-orange-400/15 hover:text-orange-100"
              : "border-stone-200 bg-white text-slate-700 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700"
          } ${
            disabled || preparing ? "cursor-not-allowed opacity-60" : "cursor-pointer"
          }`}>
            {preparing ? "Preparing logo..." : currentUrl ? "Replace logo" : "Choose logo"}
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/*"
              disabled={disabled || preparing}
              onChange={(event) => void selectFile(event)}
            />
          </label>
        </div> : null}
      </div>

      {sourceUrl ? (
        <Modal
          title="Crop company logo"
          onClose={closeCropper}
          onSubmit={submitCrop}
          submitLabel="Use cropped logo"
          submitting={uploading}
          maxWidthClass="sm:max-w-xl"
        >
          <div className="md:col-span-2">
            <div
              className="relative mx-auto overflow-hidden rounded-xl border border-stone-300 bg-[linear-gradient(45deg,#f5f5f4_25%,transparent_25%),linear-gradient(-45deg,#f5f5f4_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f5f5f4_75%),linear-gradient(-45deg,transparent_75%,#f5f5f4_75%)] bg-[length:20px_20px]"
              style={{ width: cropPreviewWidth, height: cropPreviewHeight }}
            >
              <img
                ref={imageRef}
                src={sourceUrl}
                alt="Logo crop preview"
                className="absolute max-w-none select-none"
                draggable={false}
                onLoad={(event) =>
                  setImageSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                style={metrics ? {
                  width: metrics.drawWidth,
                  height: metrics.drawHeight,
                  left: metrics.drawX,
                  top: metrics.drawY,
                } : undefined}
              />
            </div>
          </div>
          <RangeControl label="Zoom" min={1} max={8} step={0.01} value={zoom} onChange={setZoom} />
          <RangeControl label="Horizontal position" min={-100} max={100} step={1} value={positionX} onChange={setPositionX} />
          <RangeControl label="Vertical position" min={-100} max={100} step={1} value={positionY} onChange={setPositionY} />
          <div className="flex items-end">
            <Button onClick={() => { setZoom(1); setPositionX(0); setPositionY(0); }} variant="secondary">
              Reset crop
            </Button>
          </div>
          {error ? <p className="text-sm text-rose-700 md:col-span-2">{error}</p> : null}
        </Modal>
      ) : null}
    </div>
  );
}

function RangeControl({ label, min, max, step, value, onChange }: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input className="mt-2 w-full accent-orange-600" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function getDrawMetrics(
  size: ImageSize,
  zoom: number,
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  const scale =
    Math.min(canvasWidth / size.width, canvasHeight / size.height) * zoom;
  const drawWidth = size.width * scale;
  const drawHeight = size.height * scale;
  const overflowX = Math.max(0, (drawWidth - canvasWidth) / 2);
  const overflowY = Math.max(0, (drawHeight - canvasHeight) / 2);

  return {
    drawWidth,
    drawHeight,
    drawX: (canvasWidth - drawWidth) / 2 + (x / 100) * overflowX,
    drawY: (canvasHeight - drawHeight) / 2 + (y / 100) * overflowY,
  };
}

async function createCroppedLogo(image: HTMLImageElement, size: ImageSize, zoom: number, x: number, y: number) {
  for (const outputSize of [
    { width: 960, height: 540 },
    { width: 720, height: 405 },
    { width: 480, height: 270 },
  ]) {
    const canvas = document.createElement("canvas");
    canvas.width = outputSize.width;
    canvas.height = outputSize.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot crop the selected logo.");

    const metrics = getDrawMetrics(
      size,
      zoom,
      x,
      y,
      outputSize.width,
      outputSize.height,
    );
    context.clearRect(0, 0, outputSize.width, outputSize.height);
    context.drawImage(image, metrics.drawX, metrics.drawY, metrics.drawWidth, metrics.drawHeight);
    const blob = await canvasToPng(canvas);
    if (blob && blob.size <= maxLogoBytes) return blob;
  }

  throw new Error("The cropped logo is still larger than 1 MB. Try a simpler or smaller image.");
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}
