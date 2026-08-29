-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "title" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Notification_sentAt_idx" ON "Notification"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_wagerId_kind_key" ON "Notification"("userId", "wagerId", "kind");
