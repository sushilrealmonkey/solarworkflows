const maxPreparedDimension = 2048;

type ImageSize = { width: number; height: number };
type ImageBounds = ImageSize & { x: number; y: number };
type Pixel = [number, number, number, number];

export async function trimLogoBlob(source: Blob) {
  const inputUrl = URL.createObjectURL(source);

  try {
    const image = await loadImage(inputUrl);
    const bounds = findVisibleLogoBounds(image);
    const outputScale = Math.min(
      1,
      maxPreparedDimension / Math.max(bounds.width, bounds.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bounds.width * outputScale));
    canvas.height = Math.max(1, Math.round(bounds.height * outputScale));
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("This browser cannot prepare the selected logo.");
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      image,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const preparedBlob = await canvasToPng(canvas);

    if (!preparedBlob) {
      throw new Error("This browser could not prepare the selected logo.");
    }

    return preparedBlob;
  } finally {
    URL.revokeObjectURL(inputUrl);
  }
}

export async function createTrimmedLogoUrl(src: string) {
  const response = await fetch(src);

  if (!response.ok) {
    throw new Error("The company logo could not be loaded.");
  }

  return URL.createObjectURL(await trimLogoBlob(await response.blob()));
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected logo could not be read."));
    image.src = src;
  });
}

function findVisibleLogoBounds(image: HTMLImageElement): ImageBounds {
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;

  if (!naturalWidth || !naturalHeight) {
    throw new Error("The selected logo has invalid dimensions.");
  }

  const analysisScale = Math.min(
    1,
    1024 / Math.max(naturalWidth, naturalHeight),
  );
  const analysisWidth = Math.max(1, Math.round(naturalWidth * analysisScale));
  const analysisHeight = Math.max(1, Math.round(naturalHeight * analysisScale));
  const canvas = document.createElement("canvas");
  canvas.width = analysisWidth;
  canvas.height = analysisHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return { x: 0, y: 0, width: naturalWidth, height: naturalHeight };
  }

  context.drawImage(image, 0, 0, analysisWidth, analysisHeight);
  const pixels = context.getImageData(0, 0, analysisWidth, analysisHeight).data;
  const corners = [
    readPixel(pixels, analysisWidth, 0, 0),
    readPixel(pixels, analysisWidth, analysisWidth - 1, 0),
    readPixel(pixels, analysisWidth, 0, analysisHeight - 1),
    readPixel(pixels, analysisWidth, analysisWidth - 1, analysisHeight - 1),
  ];
  const transparentBackground =
    corners.filter((corner) => corner[3] <= 24).length >= 3;
  const solidBackground = transparentBackground
    ? null
    : findSolidBackground(corners);

  if (!transparentBackground && !solidBackground) {
    return { x: 0, y: 0, width: naturalWidth, height: naturalHeight };
  }

  const rowCounts = new Uint32Array(analysisHeight);
  const columnCounts = new Uint32Array(analysisWidth);

  for (let y = 0; y < analysisHeight; y += 1) {
    for (let x = 0; x < analysisWidth; x += 1) {
      const pixel = readPixel(pixels, analysisWidth, x, y);
      const isVisible = transparentBackground
        ? pixel[3] > 24
        : pixel[3] > 24 && !colorsMatch(pixel, solidBackground!, 30);

      if (isVisible) {
        rowCounts[y] += 1;
        columnCounts[x] += 1;
      }
    }
  }

  const lineThreshold = Math.max(
    1,
    Math.floor(Math.min(analysisWidth, analysisHeight) / 300),
  );
  const top = findFirstContentLine(rowCounts, lineThreshold);
  const bottom = findLastContentLine(rowCounts, lineThreshold);
  const left = findFirstContentLine(columnCounts, lineThreshold);
  const right = findLastContentLine(columnCounts, lineThreshold);

  if (top < 0 || bottom < top || left < 0 || right < left) {
    return { x: 0, y: 0, width: naturalWidth, height: naturalHeight };
  }

  const contentWidth = right - left + 1;
  const contentHeight = bottom - top + 1;
  const padding = Math.max(
    2,
    Math.round(Math.max(contentWidth, contentHeight) * 0.04),
  );
  const paddedLeft = Math.max(0, left - padding);
  const paddedTop = Math.max(0, top - padding);
  const paddedRight = Math.min(analysisWidth - 1, right + padding);
  const paddedBottom = Math.min(analysisHeight - 1, bottom + padding);
  const inverseScale = 1 / analysisScale;
  const sourceX = Math.floor(paddedLeft * inverseScale);
  const sourceY = Math.floor(paddedTop * inverseScale);
  const sourceRight = Math.min(
    naturalWidth,
    Math.ceil((paddedRight + 1) * inverseScale),
  );
  const sourceBottom = Math.min(
    naturalHeight,
    Math.ceil((paddedBottom + 1) * inverseScale),
  );

  return {
    x: sourceX,
    y: sourceY,
    width: Math.max(1, sourceRight - sourceX),
    height: Math.max(1, sourceBottom - sourceY),
  };
}

function readPixel(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): Pixel {
  const offset = (y * width + x) * 4;
  return [
    pixels[offset],
    pixels[offset + 1],
    pixels[offset + 2],
    pixels[offset + 3],
  ];
}

function findSolidBackground(corners: Pixel[]): Pixel | null {
  let bestCluster: Pixel[] = [];

  corners.forEach((candidate) => {
    const cluster = corners.filter((corner) =>
      colorsMatch(candidate, corner, 32),
    );
    if (cluster.length > bestCluster.length) bestCluster = cluster;
  });

  if (bestCluster.length < 3) return null;

  return bestCluster.reduce<Pixel>(
    (average, pixel) => [
      average[0] + pixel[0] / bestCluster.length,
      average[1] + pixel[1] / bestCluster.length,
      average[2] + pixel[2] / bestCluster.length,
      average[3] + pixel[3] / bestCluster.length,
    ],
    [0, 0, 0, 0],
  );
}

function colorsMatch(first: Pixel, second: Pixel, tolerance: number) {
  return (
    Math.abs(first[0] - second[0]) <= tolerance &&
    Math.abs(first[1] - second[1]) <= tolerance &&
    Math.abs(first[2] - second[2]) <= tolerance &&
    Math.abs(first[3] - second[3]) <= tolerance
  );
}

function findFirstContentLine(lines: Uint32Array, threshold: number) {
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] >= threshold) return index;
  }
  return -1;
}

function findLastContentLine(lines: Uint32Array, threshold: number) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index] >= threshold) return index;
  }
  return -1;
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
}
