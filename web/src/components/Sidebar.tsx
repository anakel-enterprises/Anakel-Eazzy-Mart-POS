import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

interface NavItem {
  to: string;
  label: string;
  letter: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", letter: "D" },
  { to: "/checkout", label: "Checkout", letter: "C" },
  { to: "/inventory", label: "Inventory", letter: "I" },
  { to: "/register", label: "Cash Register", letter: "R" },
  { to: "/reports", label: "Reports", letter: "P" },
  { to: "/employees", label: "Employees", letter: "U", adminOnly: true },
  { to: "/settings", label: "Settings", letter: "S", adminOnly: true },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === "ADMIN");

  return (
    <div className="flex w-[230px] shrink-0 flex-col gap-1.5 bg-brand-sidebar px-4 py-6">
      <div className="flex items-center gap-2.5 px-2 pb-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-accent font-display text-base font-bold text-[#0f2a1f]">
          A
        </div>
        <div>
          <div className="font-display text-[15px] font-bold leading-tight text-white">Anakel</div>
          <div className="text-[11px] tracking-wide text-brand-accent/80">EAZZY MART</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-[9px] px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-brand-accentDeep font-semibold text-white"
                  : "text-brand-accent/70 hover:bg-brand-sidebarSoft hover:text-white"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-[11px] font-bold ${
                    isActive ? "bg-brand-accent text-[#0f2a1f]" : "bg-brand-sidebarMuted text-brand-accent/80"
                  }`}
                >
                  {item.letter}
                </span>
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex items-center gap-2.5 rounded-[10px] bg-brand-sidebarSoft px-2.5 py-3">
        <div className="h-[30px] w-[30px] rounded-full bg-brand-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-white">{user?.name}</div>
          <div className="text-[10.5px] text-brand-accent/70">{user?.role === "ADMIN" ? "Admin" : "Cashier"}</div>
        </div>
        <button
          onClick={logout}
          className="rounded-md px-2 py-1 text-[11px] text-brand-accent/70 hover:bg-brand-sidebarMuted hover:text-white"
        >
          Log out
        </button>
      </div>
    </div>
  );
}
