import { SgdsIconButton } from "@govtechsg/sgds-web-component/react";

// Sticky page title bar: optional back button, optional purple line dot, title.
export default function PageHeader({ title, onBack, showLineDot = false, children }) {
  return (
    <header className="sgds:sticky sgds:top-0 sgds:z-10 sgds:flex sgds:items-center sgds:gap-component-sm sgds:border-b sgds:border-default sgds:bg-surface-default sgds:px-layout-md sgds:py-component-md">
      {onBack && <SgdsIconButton name="arrow-left" variant="ghost" tone="neutral" ariaLabel="Back" onClick={onBack} />}
      {showLineDot && <span className="sgds:size-2.5 sgds:shrink-0 sgds:rounded-full sgds:bg-primary-default" />}
      <h1 className="sgds:m-0 sgds:flex-1 sgds:text-heading-sm sgds:font-semibold sgds:text-heading-default">{title}</h1>
      {children}
    </header>
  );
}
