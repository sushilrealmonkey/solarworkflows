import type { FormEvent } from "react";
import { PortalLogo } from "../../components/PortalBrand";

const featureItems = [
  { label: "Customers", value: "Organized" },
  { label: "Projects", value: "On track" },
  { label: "Operations", value: "Connected" },
];

const accessModes = ["Admin", "Sales", "Survey"];

export function LoginDesignsPage() {
  return (
    <main className="min-h-screen bg-[#f7f2ed] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#f7f2ed]/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <PortalLogo className="h-9 w-32 object-contain object-left sm:h-10 sm:w-36" />
            <span className="hidden rounded-full border border-orange-200 bg-white px-3 py-1 text-xs font-semibold text-orange-700 sm:inline-flex">
              Login concepts
            </span>
          </div>
          <nav
            aria-label="Login design concepts"
            className="flex shrink-0 items-center gap-1 rounded-full border border-stone-200 bg-white p-1 shadow-sm"
          >
            <ConceptLink href="#workspace-shell" label="Shell" />
            <ConceptLink href="#command-center" label="Command" />
            <ConceptLink href="#premium-minimal" label="Minimal" />
          </nav>
        </div>
      </header>

      <div className="grid gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <WorkspaceShellConcept />
        <CommandCenterConcept />
        <PremiumMinimalConcept />
      </div>
    </main>
  );
}

function WorkspaceShellConcept() {
  return (
    <section
      aria-labelledby="workspace-shell-title"
      className="mx-auto min-h-screen w-full max-w-7xl overflow-hidden rounded-lg border border-orange-100 bg-[#fff7f0] shadow-sm"
      id="workspace-shell"
    >
      <div className="grid min-h-screen lg:grid-cols-[0.9fr_1.1fr]">
        <div className="relative flex min-h-[16rem] flex-col justify-between overflow-hidden px-5 py-5 sm:px-8 lg:min-h-full lg:px-10 lg:py-9">
          <WavePattern className="absolute -right-28 top-16 h-72 w-[38rem] text-orange-200/80 lg:-right-32 lg:top-24 lg:h-[30rem] lg:w-[52rem]" />
          <div className="relative z-10 flex items-center justify-between gap-4">
            <PortalLogo className="h-12 w-44 object-contain object-left sm:h-14 sm:w-52" />
            <span className="rounded-full border border-orange-200 bg-white/80 px-3 py-1 text-xs font-semibold text-orange-700 shadow-sm">
              Mobile first
            </span>
          </div>

          <div className="relative z-10 mt-8 max-w-xl lg:mt-auto">
            <p className="text-sm font-semibold text-orange-700">
              Bizlee Workspace
            </p>
            <h2
              className="mt-3 text-3xl font-semibold leading-tight tracking-normal text-slate-950 sm:text-4xl lg:text-5xl"
              id="workspace-shell-title"
            >
              India's Mobile first Business Management System for growing teams
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-600 sm:text-base">
              Smart access for growing businesses.
            </p>
          </div>
        </div>

        <div className="flex items-start justify-center bg-white px-4 pb-6 pt-0 sm:px-8 lg:items-center lg:bg-[#fffdfb] lg:py-10">
          <div className="-mt-8 w-full max-w-md rounded-t-[1.75rem] border border-stone-200 bg-white p-5 shadow-xl shadow-slate-950/10 sm:rounded-[1.75rem] sm:p-6 lg:mt-0">
            <LoginCardHeader
              eyebrowClassName="bg-orange-50 text-orange-700"
              titleClassName="text-slate-950"
            />
            <div className="mt-5 grid grid-cols-3 gap-2">
              {accessModes.map((mode) => (
                <button
                  className="h-10 rounded-full border border-stone-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-orange-200 hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
                  key={mode}
                  type="button"
                >
                  {mode}
                </button>
              ))}
            </div>
            <DemoLoginForm variant="warm" />
            <FeatureGrid className="mt-5" itemClassName="bg-[#fff7f0]" />
          </div>
        </div>
      </div>
    </section>
  );
}

function CommandCenterConcept() {
  return (
    <section
      aria-labelledby="command-center-title"
      className="mx-auto min-h-screen w-full max-w-7xl overflow-hidden rounded-lg border border-slate-200 bg-slate-950 shadow-sm"
      id="command-center"
    >
      <div className="grid min-h-screen lg:grid-cols-[1fr_0.95fr]">
        <div className="order-2 relative bg-slate-950 px-5 py-5 text-white sm:px-8 lg:order-1 lg:px-10 lg:py-9">
          <div className="absolute inset-x-0 top-0 h-1 bg-orange-500" />
          <div className="flex items-center justify-between gap-4">
            <PortalLogo className="h-11 w-40 object-contain object-left sm:h-12 sm:w-44" tone="dark" />
            <span className="h-3 w-3 rounded-full bg-orange-500 shadow-[0_0_0_7px_rgba(249,115,22,0.18)]" />
          </div>

          <div className="mt-8 max-w-xl">
            <p className="text-sm font-semibold text-orange-300">
              Bizlee Workspace
            </p>
            <h2
              className="mt-3 text-3xl font-semibold leading-tight tracking-normal sm:text-4xl lg:text-5xl"
              id="command-center-title"
            >
              India's Mobile first Business Management System for growing teams
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-300 sm:text-base">
              Sign in, see your workspace, and keep every team connected.
            </p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:mt-12">
            {featureItems.map((item) => (
              <div
                className="rounded-lg border border-white/10 bg-white/[0.06] p-4"
                key={item.label}
              >
                <p className="text-xs font-medium text-slate-400">
                  {item.label}
                </p>
                <p className="mt-2 text-sm font-semibold text-white">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="order-1 flex items-start justify-center bg-[#f8fafc] px-4 py-6 sm:px-8 lg:order-2 lg:items-center lg:py-10">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-950/20 sm:p-6">
            <LoginCardHeader
              eyebrowClassName="bg-slate-100 text-slate-700"
              titleClassName="text-slate-950"
            />
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Workspace status
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                  <span className="h-2 w-2 rounded-full bg-orange-500" />
                  Ready
                </span>
              </div>
            </div>
            <DemoLoginForm variant="cool" />
          </div>
        </div>
      </div>
    </section>
  );
}

function PremiumMinimalConcept() {
  return (
    <section
      aria-labelledby="premium-minimal-title"
      className="mx-auto min-h-screen w-full max-w-7xl overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm"
      id="premium-minimal"
    >
      <div className="flex min-h-screen items-start justify-center px-4 py-6 sm:px-8 lg:items-center lg:py-10">
        <div className="grid w-full max-w-5xl gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div className="order-2 lg:order-1">
            <div className="relative overflow-hidden rounded-lg border border-stone-200 bg-[#fff7f0] p-5 sm:p-6">
              <WavePattern className="absolute -right-24 -top-8 h-56 w-[32rem] text-orange-200/75" />
              <div className="relative z-10">
                <PortalLogo className="h-12 w-44 object-contain object-left" />
                <h2
                  className="mt-8 max-w-md text-3xl font-semibold leading-tight tracking-normal text-slate-950 sm:text-4xl"
                  id="premium-minimal-title"
                >
                  India's Mobile first Business Management System for growing
                  teams
                </h2>
                <div className="mt-6 grid gap-2">
                  {featureItems.map((item) => (
                    <div
                      className="flex items-center justify-between rounded-lg bg-white/75 px-3 py-3 text-sm"
                      key={item.label}
                    >
                      <span className="text-slate-600">{item.label}</span>
                      <span className="font-semibold text-slate-950">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <div className="mx-auto w-full max-w-md">
              <div className="mb-6 flex items-center justify-between gap-4">
                <PortalLogo className="h-11 w-40 object-contain object-left lg:hidden" />
                <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
                  Secure access
                </span>
              </div>
              <div className="border-t-2 border-orange-500 pt-6">
                <LoginCardHeader
                  eyebrowClassName="bg-white text-orange-700 ring-1 ring-orange-100"
                  titleClassName="text-slate-950"
                />
                <DemoLoginForm variant="minimal" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LoginCardHeader({
  eyebrowClassName,
  titleClassName,
}: {
  eyebrowClassName: string;
  titleClassName: string;
}) {
  return (
    <div>
      <p
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${eyebrowClassName}`}
      >
        <span className="h-2 w-2 rounded-full bg-orange-500" />
        Workspace login
      </p>
      <h3
        className={`mt-4 text-3xl font-semibold tracking-normal ${titleClassName}`}
      >
        Welcome back
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Sign in to access your Bizlee workspace.
      </p>
    </div>
  );
}

function DemoLoginForm({ variant }: { variant: "warm" | "cool" | "minimal" }) {
  const inputClassName =
    variant === "minimal"
      ? "mt-2 w-full rounded-none border-0 border-b border-slate-300 bg-white px-0 py-3 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-orange-500 focus:ring-0"
      : "mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-100";

  const buttonClassName =
    variant === "cool"
      ? "group relative mt-5 h-12 w-full overflow-hidden rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-900 active:bg-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
      : "group relative mt-5 h-12 w-full overflow-hidden rounded-lg bg-[#020617] px-4 text-sm font-semibold text-white transition hover:bg-slate-900 active:bg-[#020617] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500";

  return (
    <form className="mt-6" onSubmit={handlePreviewSubmit}>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">
          Email address
        </span>
        <input
          autoComplete="off"
          className={inputClassName}
          inputMode="email"
          placeholder="name@workspace.com"
          type="email"
        />
      </label>

      <label className="mt-4 block">
        <span className="text-sm font-medium text-slate-700">Password</span>
        <input
          autoComplete="off"
          className={inputClassName}
          placeholder="Password"
          type="password"
        />
      </label>

      <button className={buttonClassName} type="button">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1 bg-orange-500 transition-transform group-hover:scale-y-75 group-active:scale-y-50"
        />
        <span className="relative">Sign in</span>
      </button>

      <p className="mt-5 text-center text-sm leading-6 text-slate-600">
        New to Bizlee? Use your invite email to set up your workspace access.
      </p>
    </form>
  );
}

function FeatureGrid({
  className,
  itemClassName,
}: {
  className?: string;
  itemClassName: string;
}) {
  return (
    <div className={`grid gap-2 ${className ?? ""}`}>
      {featureItems.map((item) => (
        <div
          className={`flex items-center justify-between rounded-lg px-3 py-3 text-sm ${itemClassName}`}
          key={item.label}
        >
          <span className="text-slate-600">{item.label}</span>
          <span className="font-semibold text-slate-950">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function ConceptLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-orange-50 hover:text-orange-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 sm:text-sm"
      href={href}
    >
      {label}
    </a>
  );
}

function WavePattern({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 720 360"
    >
      <path
        d="M10 235C96 147 184 126 269 173C377 233 444 271 553 196C617 152 653 111 706 96"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="30"
      />
      <path
        d="M22 294C120 196 219 181 320 228C425 277 499 281 609 189"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="12"
      />
      <path
        d="M188 63C278 20 349 26 422 74C488 117 556 114 650 48"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="18"
      />
    </svg>
  );
}

function handlePreviewSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}
