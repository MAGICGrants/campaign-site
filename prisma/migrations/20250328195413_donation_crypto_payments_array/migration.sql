/*
  Warnings:

  - A unique constraint covering the columns `[btcPayInvoiceId]` on the table `Donation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Donation" ADD COLUMN     "cryptoPayments" JSONB,
ALTER COLUMN "grossCryptoAmount" SET DATA TYPE TEXT,
ALTER COLUMN "netCryptoAmount" SET DATA TYPE TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Donation_btcPayInvoiceId_key" ON "Donation"("btcPayInvoiceId");
