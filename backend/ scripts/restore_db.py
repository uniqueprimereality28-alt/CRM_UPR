"""
Restores a JSON backup (produced by backup_db.py) back into MongoDB.

DANGER: this REPLACES the contents of each collection with what's in the
backup files. Only run this against an empty/new database, or one you
intend to overwrite, e.g. after a crash where you've provisioned a fresh
MongoDB instance.

Usage:
    MONGO_URL="..." DB_NAME="..." python backend/scripts/restore_db.py backups/latest
"""
import json
import os
import sys
from datetime import datetime

from pymongo import MongoClient


def _restore_dates(doc):
    """Best-effort: leave ISO datetime strings as strings; Mongo/the app
    already treat most timestamps as ISO strings elsewhere in this codebase,
    so no conversion is needed for round-tripping."""
    return doc


def main():
    if len(sys.argv) != 2:
        print("Usage: python restore_db.py <path-to-backup-folder>")
        sys.exit(1)

    backup_dir = sys.argv[1]
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL and DB_NAME environment variables are required.")
        sys.exit(1)

    confirm = input(
        f"This will OVERWRITE collections in database '{db_name}' with the "
        f"contents of '{backup_dir}'. Type YES to continue: "
    )
    if confirm != "YES":
        print("Aborted.")
        sys.exit(0)

    client = MongoClient(mongo_url, serverSelectionTimeoutMS=15000)
    db = client[db_name]

    for fname in sorted(os.listdir(backup_dir)):
        if not fname.endswith(".json") or fname == "_manifest.json":
            continue
        coll_name = fname[: -len(".json")]
        with open(os.path.join(backup_dir, fname), "r", encoding="utf-8") as f:
            docs = json.load(f)
        if not docs:
            print(f"  {coll_name}: 0 documents, skipping")
            continue
        db[coll_name].delete_many({})
        db[coll_name].insert_many(docs)
        print(f"  {coll_name}: restored {len(docs)} documents")

    print("Restore complete.")


if __name__ == "__main__":
    main()
