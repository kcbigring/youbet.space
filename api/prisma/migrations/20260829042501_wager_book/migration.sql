-- DropIndex
DROP INDEX "Wager_address_key";

-- AlterTable
ALTER TABLE "Wager" DROP COLUMN "address",
ADD COLUMN     "onchainId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Wager_onchainId_key" ON "Wager"("onchainId");
