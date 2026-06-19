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
