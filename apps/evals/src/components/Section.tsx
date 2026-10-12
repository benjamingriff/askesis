import type { ReactNode } from 'react';

export function Section({
  id,
  title,
  description,
  aside,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="chart-section" id={id} aria-label={title}>
      <div className="chart-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {aside && <div className="chart-controls muted">{aside}</div>}
      </div>
      {children}
    </section>
  );
}
