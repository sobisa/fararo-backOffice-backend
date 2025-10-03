-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrderItemProductOption" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderItemId" INTEGER NOT NULL,
    "optionId" INTEGER,
    "productOptionId" INTEGER,
    "selection" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderItemProductOption_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItemProductOption_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "Option" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OrderItemProductOption_productOptionId_fkey" FOREIGN KEY ("productOptionId") REFERENCES "ProductOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OrderItemProductOption" ("createdAt", "id", "optionId", "orderItemId", "selection", "updatedAt") SELECT "createdAt", "id", "optionId", "orderItemId", "selection", "updatedAt" FROM "OrderItemProductOption";
DROP TABLE "OrderItemProductOption";
ALTER TABLE "new_OrderItemProductOption" RENAME TO "OrderItemProductOption";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
