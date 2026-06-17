type PageHeaderProps = {
  title: string;
  description: string;
};

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <header className="space-y-2">
      <p className="text-sm font-medium text-brand-600">SolarFlow CRM</p>
      <h1 className="text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
        {title}
      </h1>
      <p className="max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
        {description}
      </p>
    </header>
  );
}
