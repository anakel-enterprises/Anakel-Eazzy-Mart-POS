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
