import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSidebar } from "../context/SidebarContext";
import type { PermissionKey } from "../lib/permissions";

type Role = "ADMIN" | "MANAGER" | "CASHIER" | "STOREKEEPER" | "ACCOUNTANT";

interface NavItem {
  to: string;
  label: string;
  letter: string;
  // Gated by a specific permission (ADMIN always bypasses), or by
  // adminOnly for the couple of screens that stay hard-locked to ADMIN
  // regardless of any permission toggle (employee & store management).
  permission?: PermissionKey;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", letter: "D" },
  { to: "/checkout", label: "Checkout", letter: "C", permission: "MAKE_SALES" },
  { to: "/inventory", label: "Inventory", letter: "I", permission: "MANAGE_PRODUCTS" },
  { to: "/register", label: "Cash Register", letter: "R", permission: "MAKE_SALES" },
  { to: "/suppliers", label: "Suppliers", letter: "SU", permission: "MANAGE_SUPPLIERS" },
  { to: "/credit-sales", label: "Credit Sales", letter: "CR", permission: "MANAGE_CUSTOMERS" },
  { to: "/expenses", label: "Expenses & Income", letter: "E", permission: "MANAGE_EXPENSES" },
  { to: "/promotions", label: "Promotions", letter: "PR", permission: "MANAGE_PROMOTIONS" },
  { to: "/reports", label: "Reports", letter: "RP", permission: "VIEW_REPORTS" },
  { to: "/employees", label: "Employees", letter: "U", adminOnly: true },
  { to: "/settings", label: "Settings", letter: "S", adminOnly: true },
];

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  STOREKEEPER: "Storekeeper",
  ACCOUNTANT: "Accountant",
};

export function Sidebar() {
  const { user, logout } = useAuth();
  const { isOpen, close } = useSidebar();
  const isAdmin = user?.role === "ADMIN";
  const items = NAV_ITEMS.filter((item) => {
    if (item.adminOnly) return isAdmin;
    if (item.permission) return isAdmin || !!user?.permissions?.[item.permission];
    return true;
  });

  return (
    <>
      {/* Backdrop — mobile/tablet only, dismisses the drawer on tap */}
      {isOpen && <div onClick={close} className="fixed inset-0 z-30 bg-black/50 lg:hidden" />}

      <div
        className={`fixed inset-y-0 left-0 z-40 flex w-[250px] shrink-0 -translate-x-full flex-col gap-1.5 overflow-y-auto bg-brand-sidebar px-4 py-6 transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-[230px] lg:translate-x-0 ${
          isOpen ? "translate-x-0" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-2.5 px-2 pb-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-accent font-display text-base font-bold text-[#0f2a1f]">
              A
            </div>
            <div>
              <div className="font-display text-[15px] font-bold leading-tight text-white">Anakel</div>
              <div className="text-[11px] tracking-wide text-brand-accent/80">EAZZY MART</div>
            </div>
          </div>
          <button
            onClick={close}
            aria-label="Close menu"
            className="rounded-md p-1.5 text-brand-accent/70 hover:bg-brand-sidebarMuted hover:text-white lg:hidden"
          >
            ✕
          </button>
        </div>

        <nav className="flex flex-col gap-1.5">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={close}
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
                    className={`flex h-[26px] min-w-[26px] items-center justify-center rounded-[7px] px-1 text-[10px] font-bold ${
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
          <div className="h-[30px] w-[30px] shrink-0 rounded-full bg-brand-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-white">{user?.name}</div>
            <div className="text-[10.5px] text-brand-accent/70">{user ? ROLE_LABELS[user.role as Role] : ""}</div>
          </div>
          <button
            onClick={logout}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] text-brand-accent/70 hover:bg-brand-sidebarMuted hover:text-white"
          >
            Log out
          </button>
        </div>
      </div>
    </>
  );
}
