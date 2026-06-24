import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Button, Modal } from "../crm/CrmComponents";

const maxLogoBytes = 1024 * 1024;
const cropPreviewSize = 280;

type ImageSize = { width: number; height: number };

export function CompanyLogoUploader({
  currentUrl,
  disabled,
  onUpload,
}: {
  currentUrl: string;
  disabled: boolean;
  onUpload: (logo: Blob) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [zoom, setZoom] = useState(1);
  const [positionX, setPositionX] = useState(0);
  const [positionY, setPositionY] = useState(0);
  const [error, setError] = useState<string | null>(null);
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

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Choose a valid image file.");
      event.target.value = "";
      return;
    }

    if (file.size > maxLogoBytes) {
      setError("Company logo files must be 1 MB or smaller.");
      event.target.value = "";
      return;
    }

    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(URL.createObjectURL(file));
    setImageSize(null);
    setZoom(1);
    setPositionX(0);
    setPositionY(0);
    setError(null);
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
    ? getDrawMetrics(imageSize, zoom, positionX, positionY, cropPreviewSize)
    : null;

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 md:col-span-2">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex h-24 w-full items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-white sm:w-40">
          {currentUrl ? (
            <img className="h-full w-full object-contain p-2" src={currentUrl} alt="Current company logo" />
          ) : (
            <span className="text-sm text-slate-500">No logo uploaded</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Upload company logo</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            PNG, JPG, SVG, and other image formats are supported. Maximum file size: 1 MB.
          </p>
          <label className="mt-3 inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-stone-50">
            {currentUrl ? "Replace logo" : "Choose logo"}
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/*"
              disabled={disabled}
              onChange={selectFile}
            />
          </label>
          {!sourceUrl && error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
        </div>
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
              style={{ width: cropPreviewSize, height: cropPreviewSize }}
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
          <RangeControl label="Zoom" min={1} max={3} step={0.01} value={zoom} onChange={setZoom} />
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

function getDrawMetrics(size: ImageSize, zoom: number, x: number, y: number, canvasSize: number) {
  const scale = Math.max(canvasSize / size.width, canvasSize / size.height) * zoom;
  const drawWidth = size.width * scale;
  const drawHeight = size.height * scale;
  const overflowX = Math.max(0, (drawWidth - canvasSize) / 2);
  const overflowY = Math.max(0, (drawHeight - canvasSize) / 2);

  return {
    drawWidth,
    drawHeight,
    drawX: (canvasSize - drawWidth) / 2 + (x / 100) * overflowX,
    drawY: (canvasSize - drawHeight) / 2 + (y / 100) * overflowY,
  };
}

async function createCroppedLogo(image: HTMLImageElement, size: ImageSize, zoom: number, x: number, y: number) {
  for (const outputSize of [512, 384, 256]) {
    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot crop the selected logo.");

    const metrics = getDrawMetrics(size, zoom, x, y, outputSize);
    context.clearRect(0, 0, outputSize, outputSize);
    context.drawImage(image, metrics.drawX, metrics.drawY, metrics.drawWidth, metrics.drawHeight);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob && blob.size <= maxLogoBytes) return blob;
  }

  throw new Error("The cropped logo is still larger than 1 MB. Try a simpler or smaller image.");
}
