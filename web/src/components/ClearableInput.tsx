import { forwardRef, useImperativeHandle, useRef, type InputHTMLAttributes } from "react";

interface ClearableInputProps extends InputHTMLAttributes<HTMLInputElement> {
  // Required, not optional — a value with no way to actually clear it
  // defeats the point of this component; every call site owns its own
  // controlled state and knows how to reset it (usually `() => setX("")`).
  onClear: () => void;
  wrapperClassName?: string;
}

// A plain text-like <input> with a small "×" that appears once it has a
// value, clearing it in one tap instead of select-all-and-delete — used for
// every search box and most free-text data-entry field in the app (not
// type="number"/"date"/"select", which already have their own established
// clear affordances). Forwards its ref to the underlying <input> so a call
// site can imperatively focus/select it (e.g. Checkout returning focus to
// the product search box after adding an item).
export const ClearableInput = forwardRef<HTMLInputElement, ClearableInputProps>(function ClearableInput(
  { value, onClear, className, wrapperClassName, ...rest },
  forwardedRef
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement, []);
  const hasValue = typeof value === "string" ? value.length > 0 : value != null;

  return (
    <div className={`relative ${wrapperClassName ?? ""}`}>
      <input ref={inputRef} value={value} className={`${className ?? ""} ${hasValue ? "pr-8" : ""}`} {...rest} />
      {hasValue && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Clear"
          onClick={() => {
            onClear();
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-brand-inkMuted hover:text-brand-ink"
        >
          ✕
        </button>
      )}
    </div>
  );
});
