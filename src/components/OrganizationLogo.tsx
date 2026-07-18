import { useState, type ReactNode } from "react";

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

  if (!src || failedSource === src) {
    return fallback;
  }

  return (
    <img
      alt={`${organizationName} logo`}
      className={className}
      onError={() => setFailedSource(src)}
      src={src}
    />
  );
}
