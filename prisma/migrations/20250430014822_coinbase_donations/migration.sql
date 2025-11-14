/*
  Warnings:

  - A unique constraint covering the columns `[coinbaseChargeId]` on the table `Donation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Donation" ADD COLUMN     "coinbaseChargeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Donation_coinbaseChargeId_key" ON "Donation"("coinbaseChargeId");
