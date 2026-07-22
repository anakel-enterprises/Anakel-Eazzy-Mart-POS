-- Rename the pre-existing, never-used `syncedAt` column to `enteredAt` and
-- repurpose it: always the real server-side moment a sale row was created,
-- distinct from `createdAt` (the sale's effective/business date) once a
-- permitted user starts deliberately backdating sales.
ALTER TABLE "Sale" RENAME COLUMN "syncedAt" TO "enteredAt";

-- Backfill existing rows so enteredAt reflects their actual (pre-feature)
-- entry time rather than the moment this migration happens to run — every
-- sale before this feature existed was, by definition, not backdated.
UPDATE "Sale" SET "enteredAt" = "createdAt";

ALTER TABLE "Sale" ADD COLUMN "isBackdated" BOOLEAN NOT NULL DEFAULT false;
