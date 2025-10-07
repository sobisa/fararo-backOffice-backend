/*
  Warnings:

  - You are about to drop the column `companyId` on the `Customer` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "_CompanyCustomers" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_CompanyCustomers_A_fkey" FOREIGN KEY ("A") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_CompanyCustomers_B_fkey" FOREIGN KEY ("B") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "type" TEXT,
    "position" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Customer" ("createdAt", "description", "id", "mobile", "name", "position", "type", "updatedAt") SELECT "createdAt", "description", "id", "mobile", "name", "position", "type", "updatedAt" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "_CompanyCustomers_AB_unique" ON "_CompanyCustomers"("A", "B");

-- CreateIndex
CREATE INDEX "_CompanyCustomers_B_index" ON "_CompanyCustomers"("B");
