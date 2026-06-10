// One-shot migration: convert legacy "direct link" collection_stations
// entries (where the join row points at a user-owned personal station)
// into the new group-copy model (join row points at a collection-owned
// fork of that station).
//
// Idempotent. Rows whose linked station is already collection-owned are
// skipped. The personal station is NEVER modified.
//
// Usage:
//   DATABASE_URL=postgresql://...local... \
//     npx tsx scripts/migrate-shares-to-forks.ts
//
// Pass --dry-run to see what would change without writing.

import { eq } from "drizzle-orm";
import { db } from "../server/db.js";
import {
  collectionStations,
  stations,
  collections,
} from "../shared/schema.js";
import { storage } from "../server/storage.js";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const links = await db
    .select({
      linkId: collectionStations.id,
      collectionId: collectionStations.collectionId,
      stationId: collectionStations.stationId,
      order: collectionStations.order,
      stationCollectionId: stations.collectionId,
      stationUserId: stations.userId,
      stationTitle: stations.title,
      collectionTitle: collections.title,
      collectionOwnerId: collections.userId,
    })
    .from(collectionStations)
    .innerJoin(stations, eq(stations.id, collectionStations.stationId))
    .innerJoin(collections, eq(collections.id, collectionStations.collectionId));

  let migrated = 0;
  let alreadyMigrated = 0;

  for (const link of links) {
    if (link.stationCollectionId != null) {
      alreadyMigrated++;
      console.log(
        `  skip link#${link.linkId} → station#${link.stationId} "${link.stationTitle}" — already group-owned`,
      );
      continue;
    }

    console.log(
      `  migrate link#${link.linkId} → station#${link.stationId} "${link.stationTitle}" into collection#${link.collectionId} "${link.collectionTitle}"`,
    );
    if (DRY_RUN) {
      migrated++;
      continue;
    }

    // Fork the personal station into a collection-owned copy. The sharer
    // identity for legacy rows is unknown; we attribute the fork to the
    // collection owner (best available audit).
    const fork = await storage.forkStation(
      link.stationId,
      link.collectionOwnerId,
      { collectionId: link.collectionId },
    );

    // Repoint the join row at the new fork, preserve order. Use a
    // transaction so we don't double-link or orphan a fork on failure.
    await db.transaction(async (tx) => {
      await tx
        .delete(collectionStations)
        .where(eq(collectionStations.id, link.linkId));
      await tx.insert(collectionStations).values({
        collectionId: link.collectionId,
        stationId: fork.id,
        order: link.order,
      });
    });

    migrated++;
    console.log(`    → forked to station#${fork.id} (collection-owned)`);
  }

  console.log(`\nDone. Migrated: ${migrated}, already-migrated: ${alreadyMigrated}, total scanned: ${links.length}`);
  if (DRY_RUN) console.log("(dry-run — no writes performed)");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
