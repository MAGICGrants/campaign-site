-- CreateEnum
CREATE TYPE "DonationSource" AS ENUM ('btcpayserver', 'coinbase', 'stripe');

-- CreateTable
CREATE TABLE "DonationAccounting" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "source" "DonationSource" NOT NULL,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "paymentReceivedAt" TIMESTAMP(3) NOT NULL,
    "cryptoCode" TEXT NOT NULL,
    "cryptoAmount" TEXT NOT NULL,
    "rate" TEXT NOT NULL,
    "fiatAmount" DOUBLE PRECISION NOT NULL,
    "krakenDeposits" JSONB NOT NULL,
    "krakenOrders" JSONB NOT NULL,
    "totalRealizedUsd" DOUBLE PRECISION NOT NULL,
    "projectSlug" TEXT,
    "projectName" TEXT,
    "fundSlug" "FundSlug",

    CONSTRAINT "DonationAccounting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DonationAccounting_paymentId_key" ON "DonationAccounting"("paymentId");

-- CreateIndex
CREATE INDEX "DonationAccounting_projectSlug_idx" ON "DonationAccounting"("projectSlug");

-- CreateIndex
CREATE INDEX "DonationAccounting_fundSlug_idx" ON "DonationAccounting"("fundSlug");
