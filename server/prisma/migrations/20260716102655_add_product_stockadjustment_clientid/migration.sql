-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "StockAdjustment" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Product_clientId_key" ON "Product"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_clientId_key" ON "StockAdjustment"("clientId");
