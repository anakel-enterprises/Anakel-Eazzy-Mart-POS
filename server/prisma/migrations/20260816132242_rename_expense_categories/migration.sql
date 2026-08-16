-- Rename the seeded "Utilities"/"Wages" expense categories to the clearer
-- "Electricity"/"Salaries" in place, so any expenses already logged against
-- them stay correctly attributed under the new name instead of needing a
-- separate, disconnected category. Guarded per-store against the (unlikely)
-- case a store already has a category with the target name, which would
-- otherwise violate the (storeId, name) unique constraint.
UPDATE "ExpenseCategory" AS old
SET name = 'Electricity'
WHERE old.name = 'Utilities'
  AND NOT EXISTS (
    SELECT 1 FROM "ExpenseCategory" AS existing
    WHERE existing."storeId" = old."storeId" AND existing.name = 'Electricity'
  );

UPDATE "ExpenseCategory" AS old
SET name = 'Salaries'
WHERE old.name = 'Wages'
  AND NOT EXISTS (
    SELECT 1 FROM "ExpenseCategory" AS existing
    WHERE existing."storeId" = old."storeId" AND existing.name = 'Salaries'
  );
