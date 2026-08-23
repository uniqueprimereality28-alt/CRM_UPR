"""
SAFE, ADDITIVE restore — use this instead of restore_db.py for this situation.

What it does:
  - Reads a backup folder (e.g. backups/2026-08-22)
  - For each collection (leads, calls, activities), finds records whose _id
    exists in the backup but is MISSING from your live database right now
  - Re-inserts ONLY those missing records
  - NEVER deletes, NEVER overwrites, NEVER touches records that already
    exist in your live DB

This is the right tool when some records were wrongly deleted (e.g. by
"Clear Duplicate Leads") but you also have new data since the backup that
you do NOT want to lose.

USAGE (dry run first — makes no changes, just shows counts):
    MONGO_URL="..." DB_NAME="..." python restore_missing_only.py backups/2026-08-22 --dry-run

Then, once the numbers look right, actually apply it:
    MONGO_URL="..." DB_NAME="..." python restore_missing_only.py backups/2026-08-22 --apply
"""
import argparse
import json
import os
import sys

from bson import ObjectId
from pymongo import MongoClient

COLLECTIONS_TO_RESTORE = ["leads", "calls", "activities"]


def load_backup(backup_dir, coll_name):
    path = os.path.join(backup_dir, f"{coll_name}.json")
    with open(path, "r", encoding="utf-8") as f:
        docs = json.load(f)
    for d in docs:
        if isinstance(d.get("_id"), str):
            d["_id"] = ObjectId(d["_id"])
    return docs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("backup_dir", help="e.g. backups/2026-08-22")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="Preview only, no writes")
    group.add_argument("--apply", action="store_true", help="Actually insert the missing records")
    args = parser.parse_args()

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL and DB_NAME environment variables are required.")
        sys.exit(1)

    client = MongoClient(mongo_url, serverSelectionTimeoutMS=15000)
    db = client[db_name]

    grand_total_restored = 0
    restored_lead_ids = set()

    for coll_name in COLLECTIONS_TO_RESTORE:
        backup_docs = load_backup(args.backup_dir, coll_name)
        backup_ids = [d["_id"] for d in backup_docs]

        existing_ids = set(
            doc["_id"] for doc in db[coll_name].find({"_id": {"$in": backup_ids}}, {"_id": 1})
        )

        missing_docs = [d for d in backup_docs if d["_id"] not in existing_ids]

        print(f"\n{coll_name}: {len(backup_docs)} in backup, "
              f"{len(backup_docs) - len(missing_docs)} already present, "
              f"{len(missing_docs)} MISSING (will be restored)")

        if coll_name == "leads":
            restored_lead_ids = {d["_id"] for d in missing_docs}

        if missing_docs:
            # Show a small preview of what would be restored
            for d in missing_docs[:5]:
                label = d.get("name") or d.get("lead_name") or d.get("title") or ""
                print(f"    - {d['_id']}  {label}")
            if len(missing_docs) > 5:
                print(f"    ... and {len(missing_docs) - 5} more")

        if args.apply and missing_docs:
            db[coll_name].insert_many(missing_docs)
            print(f"    -> inserted {len(missing_docs)} into {coll_name}")

        grand_total_restored += len(missing_docs)

    # Kashish-specific check
    kashish_calls_backup = [
        d for d in load_backup(args.backup_dir, "calls")
        if "kashish" in (d.get("agent_name") or "").lower()
    ]
    kashish_talktime_backup = sum(c.get("duration") or 0 for c in kashish_calls_backup)
    print(f"\nKashish's calls in backup: {len(kashish_calls_backup)} "
          f"(total duration in backup: {kashish_talktime_backup} sec)")

    live_kashish_calls = list(db.calls.find(
        {"agent_name": {"$regex": "kashish", "$options": "i"}}
    ))
    live_talktime = sum(c.get("duration") or 0 for c in live_kashish_calls)
    print(f"Kashish's calls currently live: {len(live_kashish_calls)} "
          f"(total duration live: {live_talktime} sec)")

    mode = "DRY RUN (no changes made)" if args.dry_run else "APPLIED"
    print(f"\n=== {mode} === Total records restored across all collections: "
          f"{grand_total_restored if args.apply else 'see above, none inserted yet'}")


if __name__ == "__main__":
    main()
