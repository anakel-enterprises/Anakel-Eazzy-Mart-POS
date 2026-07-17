// Shared between Checkout (choosing a method) and Employees (filtering a
// sales history by method) so the two never drift — in particular the two
// M-Pesa variants, whose plain enum values (MPESA_MANUAL, MPESA) read badly
// without a label.
export const PAYMENT_METHODS = ["CASH", "MPESA_MANUAL", "MPESA", "CARD", "BANK", "SPLIT", "CREDIT"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "CASH",
  MPESA_MANUAL: "M-PESA SALE",
  MPESA: "M-PESA PROMPT",
  CARD: "CARD",
  BANK: "BANK",
  SPLIT: "SPLIT",
  CREDIT: "CREDIT",
};
