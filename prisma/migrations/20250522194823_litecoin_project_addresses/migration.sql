-- AlterTable
ALTER TABLE "ProjectAddresses" ADD COLUMN     "litecoinAddress" TEXT,
ALTER COLUMN "bitcoinAddress" DROP NOT NULL,
ALTER COLUMN "moneroAddress" DROP NOT NULL;
