ALTER TABLE "CreditPayment" ADD COLUMN "method" "PaymentMethod" NOT NULL DEFAULT 'CASH';
ALTER TABLE "CreditPayment" ALTER COLUMN "method" DROP DEFAULT;

CREATE TABLE "CreditPaymentSplit" (
    "id" TEXT NOT NULL,
    "creditPaymentId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "CreditPaymentSplit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CreditPaymentSplit_creditPaymentId_idx" ON "CreditPaymentSplit"("creditPaymentId");

ALTER TABLE "CreditPaymentSplit" ADD CONSTRAINT "CreditPaymentSplit_creditPaymentId_fkey" FOREIGN KEY ("creditPaymentId") REFERENCES "CreditPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
