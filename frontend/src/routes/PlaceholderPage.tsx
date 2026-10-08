interface PlaceholderPageProps {
  title: string;
}

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <section aria-labelledby="page-title" className="placeholder-page">
      <p className="eyebrow">Retail operations</p>
      <h1 id="page-title">{title}</h1>
      <p>This workspace is ready for its product workflow.</p>
      <div className="placeholder-card" aria-hidden="true" />
    </section>
  );
}

