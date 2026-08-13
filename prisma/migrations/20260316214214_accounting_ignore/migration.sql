-- CreateTable
CREATE TABLE "AccountingIgnore" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AccountingIgnore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountingIgnore_type_idx" ON "AccountingIgnore"("type");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingIgnore_type_value_key" ON "AccountingIgnore"("type", "value");
