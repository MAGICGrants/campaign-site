/*
  Warnings:

  - Added the required column `litecoinAddress` to the `ProjectAddresses` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ProjectAddresses" ADD COLUMN     "litecoinAddress" TEXT NOT NULL;
