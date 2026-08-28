-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "linkToken" TEXT,
ALTER COLUMN "phone" DROP NOT NULL,
ALTER COLUMN "codeHash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "firebaseUid" TEXT,
ADD COLUMN     "phoneVerified" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Invite_linkToken_key" ON "Invite"("linkToken");

-- CreateIndex
CREATE INDEX "Invite_linkToken_idx" ON "Invite"("linkToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_firebaseUid_key" ON "User"("firebaseUid");

