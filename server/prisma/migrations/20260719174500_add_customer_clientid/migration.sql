-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_clientId_key" ON "Customer"("clientId");
