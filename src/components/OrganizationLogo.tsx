import { useEffect, useState, type ReactNode } from "react";
import { createTrimmedLogoUrl } from "../utils/logoImage";

type OrganizationLogoProps = {
  className?: string;
  fallback?: ReactNode;
  organizationName: string;
  src: string | null;
};

export function OrganizationLogo({
  className,
  fallback = null,
  organizationName,
  src,
}: OrganizationLogoProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [preparedSource, setPreparedSource] = useState<{
    original: string;
    prepared: string;
  } | null>(null);
  const displaySource =
    src && preparedSource?.original === src ? preparedSource.prepared : src;

  useEffect(() => {
    let cancelled = false;
    let generatedUrl: string | null = null;

    setFailedSource(null);
    setPreparedSource(null);

    if (src) {
      void createTrimmedLogoUrl(src)
        .then((nextUrl) => {
          if (cancelled) {
            URL.revokeObjectURL(nextUrl);
            return;
          }

          generatedUrl = nextUrl;
          setFailedSource(null);
          setPreparedSource({ original: src, prepared: nextUrl });
        })
        .catch(() => {
          // Keep the original public URL when browser-side normalization fails.
        });
    }

    return () => {
      cancelled = true;
      if (generatedUrl) URL.revokeObjectURL(generatedUrl);
    };
  }, [src]);

  if (!displaySource || failedSource === displaySource) {
    return fallback;
  }

  return (
    <img
      alt={`${organizationName} logo`}
      className={className}
      onError={() => setFailedSource(displaySource)}
      src={displaySource}
    />
  );
}
