import solarOsLogoUrl from "../assets/solaros-main-logo.png";
import solarOsLogoOnDarkUrl from "../assets/solaros-main-logo-on-dark.png";

type PortalLogoProps = {
  className?: string;
  tone?: "light" | "dark";
};

export function PortalLogo({ className, tone = "light" }: PortalLogoProps) {
  return (
    <img
      alt="Bizlee"
      className={className}
      src={tone === "dark" ? solarOsLogoOnDarkUrl : solarOsLogoUrl}
    />
  );
}

export function PortalLogoIcon({ className, tone = "light" }: PortalLogoProps) {
  return (
    <span
      aria-label="Bizlee"
      className={`inline-flex shrink-0 overflow-hidden ${className ?? ""}`}
      role="img"
    >
      <img
        alt=""
        className="h-full max-w-none object-contain object-left"
        src={tone === "dark" ? solarOsLogoOnDarkUrl : solarOsLogoUrl}
      />
    </span>
  );
}
