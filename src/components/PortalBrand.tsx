import solarflowLogoUrl from "../assets/solarflow-main-logo.png";
import solarflowLogoOnDarkUrl from "../assets/solarflow-main-logo-on-dark.png";

type PortalLogoProps = {
  className?: string;
  tone?: "light" | "dark";
};

export function PortalLogo({ className, tone = "light" }: PortalLogoProps) {
  return (
    <img
      alt="SolarFlow CRM"
      className={className}
      src={tone === "dark" ? solarflowLogoOnDarkUrl : solarflowLogoUrl}
    />
  );
}
