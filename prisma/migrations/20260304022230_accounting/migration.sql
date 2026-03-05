-- CreateTable
CREATE TABLE "DonationAccounting" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "paymentReceivedAt" TIMESTAMP(3) NOT NULL,
    "cryptoCode" TEXT NOT NULL,
    "cryptoAmount" TEXT NOT NULL,
    "rate" TEXT NOT NULL,
    "fiatAmount" DOUBLE PRECISION NOT NULL,
    "krakenDeposits" JSONB NOT NULL,
    "krakenOrders" JSONB NOT NULL,
    "totalRealizedUsd" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "DonationAccounting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DonationAccounting_paymentId_key" ON "DonationAccounting"("paymentId");
