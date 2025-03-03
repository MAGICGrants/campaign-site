-- CreateEnum
CREATE TYPE "MembershipTerm" AS ENUM ('monthly', 'annually');

-- AlterTable
ALTER TABLE "Donation" ADD COLUMN     "membershipTerm" "MembershipTerm";
