import { NavLink } from "react-router-dom";
import { SgdsIcon } from "@govtechsg/sgds-web-component/react";

const NAV_ITEMS = [
  { to: "/", label: "Home", icon: "house", end: true },
  { to: "/train", label: "Train", icon: "train" },
  { to: "/journey-planner", label: "Planner", icon: "compass" },
  { to: "/saved", label: "Saved", icon: "bookmark" },
];

// SGDS has no bottom-tab-bar component (sgds-tab is for in-page content tabs), so this is
// NavLinks styled with sgds: utilities, using sgds-icon for the glyphs.
export default function BottomNav() {
  return (
    <nav className="sgds:sticky sgds:bottom-0 sgds:z-20 sgds:flex sgds:border-t sgds:border-default sgds:bg-surface-default">
      {NAV_ITEMS.map(({ to, label, icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `sgds:flex sgds:flex-1 sgds:flex-col sgds:items-center sgds:gap-1 sgds:px-1 sgds:pb-3 sgds:pt-2.5 sgds:text-label-xs sgds:font-medium sgds:no-underline ${
              isActive ? "sgds:text-primary-default" : "sgds:text-subtle"
            }`
          }
        >
          <SgdsIcon name={icon} size="md" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
