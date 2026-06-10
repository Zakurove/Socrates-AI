# Group-copy feature — production deployment runbook

What this rollout introduces (recap):
- Sharing a station to a collection now forks it into a **collection-owned copy** rather than wiring the personal station directly into the collection. The owner's personal station stays untouched; group editors can modify the copy freely; the owner can later **pull** the group's version back into their personal one.
- New examiner-question fields (`description`, `explanation`) plus a new `examiner_question_media` table with per-image `phase` (`question` / `explanation`) and `visibility` (`exam` / `study` / `both`).
- Historical examiner results are now preserved across station edits (FK changed to SET NULL).

There is **already a live group with shared stations** on prod, so the deploy must convert those existing `collection_stations` rows into the new fork model in the same window.

## Deploy sequence (do these in order)

1. **Push the code.** Railway rebuilds + restarts the web service. The new code is backwards-compatible — it reads stations that haven't been forked yet just fine, so step 1 alone won't break anything.

2. **Run the SQL migrations** against the prod DB. All three are idempotent.
   ```bash
   PROD_DB="$(railway variables --service Postgres -k | awk -F= '/^DATABASE_PUBLIC_URL=/{print $2}')"
   /opt/homebrew/opt/postgresql@18/bin/psql "$PROD_DB" -v ON_ERROR_STOP=1 \
     -f migrations/0017_group_owned_stations.sql
   /opt/homebrew/opt/postgresql@18/bin/psql "$PROD_DB" -v ON_ERROR_STOP=1 \
     -f migrations/0018_examiner_questions_upgrade.sql
   /opt/homebrew/opt/postgresql@18/bin/psql "$PROD_DB" -v ON_ERROR_STOP=1 \
     -f migrations/0019_preserve_examiner_results.sql
   ```

3. **Run the one-shot data migration** that converts existing
   `collection_stations` rows into forks. Use `--dry-run` first to
   preview, then run for real.
   ```bash
   # Dry-run: prints what would change without writing.
   DATABASE_URL="$PROD_DB" npx tsx scripts/migrate-shares-to-forks.ts --dry-run
   # If the preview looks correct:
   DATABASE_URL="$PROD_DB" npx tsx scripts/migrate-shares-to-forks.ts
   ```
   The script is idempotent — re-running reports `Migrated: 0` for any
   already-converted rows. It never modifies personal stations.

4. **Verify the post-migration counts** match expectations.
   ```bash
   /opt/homebrew/opt/postgresql@18/bin/psql "$PROD_DB" -c "
     SELECT
       (SELECT count(*) FROM stations WHERE collection_id IS NULL) AS personal,
       (SELECT count(*) FROM stations WHERE collection_id IS NOT NULL) AS group_copies,
       (SELECT count(*) FROM examiner_question_results) AS exam_results,
       (SELECT count(*) FROM sessions) AS sessions;
   "
   ```
   - `personal` should equal the pre-deploy `stations` count.
   - `group_copies` should equal the pre-deploy `collection_stations` count.
   - `exam_results` and `sessions` should be unchanged.

## What can go wrong + recovery

- **Migration script errors mid-run.** Each fork is its own transaction, so partial progress is durable. Re-running the script picks up where it left off (the already-migrated rows are skipped).
- **An owner edits a station between deploy and step 3.** Safe — the owner is editing their personal station; the not-yet-migrated `collection_stations` row still points at it and will be migrated in step 3.
- **An owner tries to share a NEW station between deploy and step 3.** The new code forks on share, so the new row appears already-migrated. The migration script sees it as such and skips. No conflict.
- **You need to roll back.** Personal stations are never modified by the migration; the forks live in their own rows. To revert, you'd delete the forks (`DELETE FROM stations WHERE collection_id IS NOT NULL`) and reinsert the original `collection_stations` join rows pointing at the personal stations. A snapshot taken just before step 3 is the safest insurance.

## Pre-deploy data snapshot

Take a snapshot before running step 3 so you can rewind if needed:
```bash
/opt/homebrew/opt/postgresql@18/bin/pg_dump --no-owner --no-acl \
  "$PROD_DB" > db-backups/prod-pre-group-copy-$(date +%Y%m%d-%H%M%S).sql
```
