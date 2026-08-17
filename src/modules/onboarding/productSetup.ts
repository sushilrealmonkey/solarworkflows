import type { CompanyOnboardingProgress, OnboardingStep } from "./types";

export type ProductSetupChoice = "add" | "import" | "skip";
export type ProductSetupAction = ProductSetupChoice | "back";

export type ProductSetupOption = {
  choice: ProductSetupChoice;
  title: string;
  description: string;
  cta: string;
  nextStep: OnboardingStep;
  route: string;
  recommended?: boolean;
};

export const productSetupOptions: readonly ProductSetupOption[] = [
  {
    choice: "add",
    title: "Add Products",
    description:
      "Add the panels, inverters, cables and other products you normally use.",
    cta: "Add Products",
    nextStep: "product_entry",
    route: "/onboarding/products/add",
    recommended: true,
  },
  {
    choice: "import",
    title: "Import Products",
    description:
      "Already have a product list? Upload it and bring your products into Bizlee.",
    cta: "Import Products",
    nextStep: "products",
    route: "/onboarding/products/import",
  },
  {
    choice: "skip",
    title: "Do It Later",
    description:
      "Start using Bizlee now. You can add products directly while creating quotations.",
    cta: "Skip for Now",
    nextStep: "team",
    route: "/onboarding/team",
  },
] as const;

export const productSetupBackAction = {
  nextStep: "company",
  route: "/onboarding/company",
} as const;

type ProductSetupTransition = {
  nextStep: OnboardingStep;
  route: string;
};

type ProductSetupTransitionDependencies = {
  persist: (nextStep: OnboardingStep) => Promise<CompanyOnboardingProgress>;
  commit: (progress: CompanyOnboardingProgress) => void;
  navigate: (route: string) => void;
};

export function transitionForProductSetupAction(
  action: ProductSetupAction,
): ProductSetupTransition {
  if (action === "back") return productSetupBackAction;

  const option = productSetupOptions.find(
    (candidate) => candidate.choice === action,
  );

  if (!option) throw new Error("Unsupported product setup choice.");
  return option;
}

export async function runProductSetupTransition(
  action: ProductSetupAction,
  { persist, commit, navigate }: ProductSetupTransitionDependencies,
) {
  const transition = transitionForProductSetupAction(action);
  const progress = await persist(transition.nextStep);
  commit(progress);
  navigate(transition.route);
  return progress;
}
