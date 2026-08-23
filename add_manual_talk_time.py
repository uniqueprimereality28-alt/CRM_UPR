"""
Adds ONE manual talk-time adjustment for an agent, directly to the database.
This writes to the same `manual_adjustments` collection the new admin
feature (in server.py) reads from — so it will show up correctly in the
leaderboard/dashboard as a clearly labeled adjustment, not a fake call.

It does NOT create any call records and does NOT change any lead's status
or tag. It only adds one auditable line: "X minutes added, by Y, because Z."

USAGE:
    MONGO_URL="..." DB_NAME="..." python add_manual_talk_time.py \
        --agent-name "Kashish Aggarwal" \
        --minutes 35 \
        --reason "System outage during duplicate-lead restore, 2026-08-23" \
        --date 2026-08-23
"""
import argparse
import os
import sys
from datetime import datetime, timezone

from pymongo import MongoClient


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--agent-name", required=True, help='Exact name as it appears in your Users list, e.g. "Kashish Aggarwal"')
    parser.add_argument("--minutes", required=True, type=float)
    parser.add_argument("--reason", required=True, help="Required, min 5 characters — shown in the audit trail")
    parser.add_argument("--date", default=None, help="YYYY-MM-DD, defaults to today (UTC)")
    parser.add_argument("--added-by", default="Admin (via script)")
    args = parser.parse_args()

    if len(args.reason.strip()) < 5:
        print("ERROR: --reason must be at least 5 characters.")
        sys.exit(1)
    if args.minutes <= 0 or args.minutes > 240:
        print("ERROR: --minutes must be between 0 and 240 for a single adjustment.")
        sys.exit(1)

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL and DB_NAME environment variables are required.")
        sys.exit(1)

    client = MongoClient(mongo_url, serverSelectionTimeoutMS=15000)
    db = client[db_name]

    agent = db.users.find_one({"name": {"$regex": f"^{args.agent_name}$", "$options": "i"}})
    if not agent:
        print(f"ERROR: No user found with name '{args.agent_name}'. Check exact spelling in your Users list.")
        sys.exit(1)

    adjustment_date = args.date or datetime.now(timezone.utc).date().isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()

    doc = {
        "agent_id": str(agent["_id"]),
        "agent_name": agent.get("name"),
        "minutes": args.minutes,
        "seconds": int(round(args.minutes * 60)),
        "reason": args.reason.strip(),
        "adjustment_date": adjustment_date,
        "added_by": args.added_by,
        "added_by_id": None,
        "created_at": now_iso,
        "reversed": False,
        "reversed_by": None,
        "reversed_at": None,
    }
    result = db.manual_adjustments.insert_one(doc)

    print(f"Added: {args.minutes} min for {agent.get('name')} on {adjustment_date}")
    print(f"Reason: {args.reason.strip()}")
    print(f"Adjustment ID: {result.inserted_id}")
    print("\nThis agent's dashboard/leaderboard talk-time will now include this "
          "adjustment as a separate, labeled figure — no calls or leads were touched.")


if __name__ == "__main__":
    main()
