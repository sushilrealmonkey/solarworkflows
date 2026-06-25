import type { ReactNode } from "react";
import { PortalLogo } from "../../components/PortalBrand";

type AuthThemeShellProps = {
  badge: string;
  title: string;
  mobileDescription: string;
  children: ReactNode;
};

export function AuthThemeShell({
  badge,
  title,
  mobileDescription,
  children,
}: AuthThemeShellProps) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#06173f] px-4 py-5 text-white sm:px-6 lg:px-8">
      <AuthDarkBackground />
      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-2.5rem)] w-full max-w-6xl items-center gap-6 lg:grid-cols-[0.9fr_1fr] lg:gap-12">
        <section className="relative hidden px-1 py-4 text-white lg:flex lg:min-h-[34rem] lg:flex-col lg:justify-center lg:px-0">
          <div className="relative z-10">
            <PortalLogo
              className="h-20 w-full max-w-[18rem] object-contain object-left"
              tone="dark"
            />
            <span className="mt-6 inline-flex rounded-full border border-amber-200/55 bg-amber-200/15 px-4 py-1.5 text-sm font-semibold text-amber-100">
              {badge}
            </span>
            <h1 className="mt-8 max-w-lg text-4xl font-semibold leading-tight tracking-normal text-white">
              {title}
            </h1>
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-8 sm:px-10 lg:py-10">
          <div className="w-full max-w-md">
            <div className="lg:hidden">
              <PortalLogo
                className="h-14 w-full max-w-[12rem] object-contain object-left sm:h-16"
                tone="dark"
              />
              <span className="mt-5 inline-flex rounded-full border border-amber-200/55 bg-amber-200/15 px-3 py-1 text-sm font-semibold text-amber-100">
                {badge}
              </span>
              <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-normal text-white">
                {title}
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {mobileDescription}
              </p>
            </div>

            {children}
          </div>
        </section>
      </div>
    </main>
  );
}

export function AuthThemeCard({ children }: { children: ReactNode }) {
  return (
    <div className="mt-8 rounded-[1.75rem] border border-white/15 bg-gradient-to-br from-white/[0.12] via-white/[0.08] to-white/[0.04] p-5 text-white shadow-2xl shadow-black/35 backdrop-blur-2xl sm:p-7 lg:mt-0 lg:p-8">
      {children}
    </div>
  );
}

function AuthDarkBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-orange-300/30" />
      <AuthTopWaveLines className="absolute left-0 top-0 h-80 w-full text-orange-300/20 lg:h-[28rem]" />
      <AuthWaveLines className="absolute -bottom-20 -left-44 h-80 w-[46rem] rotate-180 text-orange-300/20 lg:h-[28rem] lg:w-[58rem]" />
    </div>
  );
}

function AuthTopWaveLines({ className }: { className: string }) {
  return (
    <svg
      className={className}
      fill="none"
      preserveAspectRatio="none"
      viewBox="0 0 1440 360"
    >
      {Array.from({ length: 10 }).map((_, index) => (
        <path
          d={`M-40 ${112 + index * 10}C176 ${18 + index * 9} 350 ${
            20 + index * 7
          } 558 ${105 + index * 5}C780 ${196 + index * 3} 980 ${
            178 - index * 2
          } 1480 ${48 + index * 8}`}
          key={index}
          stroke="currentColor"
          strokeWidth="1.2"
        />
      ))}
      <path
        d="M1090 0C1196 86 1295 117 1378 92C1404 84 1424 72 1440 58V0H1090Z"
        fill="currentColor"
        opacity="0.16"
      />
    </svg>
  );
}

function AuthWaveLines({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 900 420">
      {Array.from({ length: 10 }).map((_, index) => (
        <path
          d={`M0 ${92 + index * 9}C144 ${22 + index * 8} 248 ${
            18 + index * 6
          } 378 ${96 + index * 4}C521 ${183 + index * 3} 634 ${
            184 - index * 2
          } 900 ${20 + index * 10}`}
          key={index}
          stroke="currentColor"
          strokeWidth="1.2"
        />
      ))}
      <path
        d="M520 0C612 94 697 130 775 108C827 93 868 52 900 0V420H520C591 336 617 244 581 145C565 100 545 52 520 0Z"
        fill="currentColor"
        opacity="0.18"
      />
    </svg>
  );
}
