import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[14px] border border-brand-border bg-white p-5 shadow-card ${className}`}>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  delta,
  deltaTone = "positive",
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "positive" | "warning";
}) {
  return (
    <Card className="flex flex-col gap-2">
      <span className="text-[12.5px] font-semibold text-brand-inkMuted">{label}</span>
      <span className="font-display text-[26px] font-bold text-brand-ink">{value}</span>
      {delta && (
        <span
          className={`text-xs font-semibold ${
            deltaTone === "warning" ? "text-brand-warn" : "text-brand-accentText"
          }`}
        >
          {delta}
        </span>
      )}
    </Card>
  );
}

export function Switch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-brand-accentDeep" : "bg-brand-border"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = "rounded-[10px] px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50";
  const variants = {
    primary: "bg-brand-accentDeep text-white hover:opacity-90",
    secondary: "bg-brand-bg text-brand-ink hover:bg-brand-border",
    danger: "bg-brand-warn text-white hover:opacity-90",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
