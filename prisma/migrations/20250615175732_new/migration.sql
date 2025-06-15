-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "content" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "filePath" TEXT NOT NULL DEFAULT '';
