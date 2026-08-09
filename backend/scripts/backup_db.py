"""
Dumps every collection in the CRM's MongoDB database to JSON files.

Used by .github/workflows/db-backup.yml to take a daily snapshot of all
data (leads, users, calls, attendance, etc.) and store it safely in this
GitHub repo, separate from the live database. If the database or the
Render service is ever lost, wiped, or corrupted, the latest snapshot in
`backups/latest/` can be used to restore everything.

Run manually with:
    MONGO_URL="..." DB_NAME="..." python backend/scripts/backup_db.py
"""
import json
import os
import sys
from datetime import date, datetime

from bson import ObjectId
from pymongo import MongoClient


def _json_default(value):
    """Make Mongo-specific types (ObjectId, datetime) JSON-serializable."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def main():
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL and DB_NAME environment variables are required.")
        sys.exit(1)

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    today = date.today().isoformat()
    out_dirs = [
        os.path.join(repo_root, "backups", "latest"),
        os.path.join(repo_root, "backups", today),
    ]
    for d in out_dirs:
        os.makedirs(d, exist_ok=True)

    client = MongoClient(mongo_url, serverSelectionTimeoutMS=15000)
    db = client[db_name]

    collections = db.list_collection_names()
    print(f"Found {len(collections)} collections: {collections}")

    manifest = {"backed_up_at": datetime.utcnow().isoformat() + "Z", "collections": {}}

    for coll_name in collections:
        docs = list(db[coll_name].find({}))
        manifest["collections"][coll_name] = len(docs)
        payload = json.dumps(docs, default=_json_default, indent=2, ensure_ascii=False)
        for out_dir in out_dirs:
            with open(os.path.join(out_dir, f"{coll_name}.json"), "w", encoding="utf-8") as f:
                f.write(payload)
        print(f"  {coll_name}: {len(docs)} documents")

    for out_dir in out_dirs:
        with open(os.path.join(out_dir, "_manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)

    print("Backup complete.")


if __name__ == "__main__":
    main()

