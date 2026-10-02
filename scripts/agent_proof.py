"""Build docs/agent-proof.md from CloudTrail: every AWS API call the coding agent made under its own IAM user.

Usage:  .venv/Scripts/python.exe scripts/agent_proof.py
"""
import collections
import pathlib
from datetime import timedelta, timezone

import boto3

AGENT_USER = "claude-code-agent"
IST = timezone(timedelta(hours=5, minutes=30))
OUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "agent-proof.md"

ct = boto3.client("cloudtrail", region_name="us-east-1")
sts = boto3.client("sts")

events = []
for page in ct.get_paginator("lookup_events").paginate(
    LookupAttributes=[{"AttributeKey": "Username", "AttributeValue": AGENT_USER}],
    PaginationConfig={"MaxItems": 5000},
):
    events.extend(page["Events"])
events.sort(key=lambda e: e["EventTime"])

ident = sts.get_caller_identity()
by_service = collections.Counter(e["EventSource"].replace(".amazonaws.com", "") for e in events)
writes = [e for e in events if not e["EventName"].startswith(("Describe", "Get", "List", "Lookup"))]
by_action = collections.Counter(f'{e["EventSource"].replace(".amazonaws.com", "")}:{e["EventName"]}' for e in writes)

lines = [
    "# Proof: coding agent connected to AWS",
    "",
    f"Quad was built and deployed by **Claude Code** working through a dedicated IAM user, `{AGENT_USER}`.",
    "Every API call the agent made is recorded by AWS CloudTrail under that identity, so this report comes from AWS's own audit log.",
    "",
    f"- Identity used by the agent: `{ident['Arn'].replace(ident['Account'], ident['Account'][:4] + '••••' + ident['Account'][-2:])}`",
    f"- CloudTrail events recorded for this identity: **{len(events)}** "
    f"({events[0]['EventTime'].astimezone(IST):%d %b %H:%M} → {events[-1]['EventTime'].astimezone(IST):%d %b %H:%M} IST)" if events else "- No events yet",
    f"- Write actions (create / update / invoke): **{len(writes)}**",
    "",
    "## Calls per AWS service",
    "",
    "| Service | Calls |",
    "|---|---|",
    *[f"| {svc} | {n} |" for svc, n in by_service.most_common()],
    "",
    "## What the agent changed (write actions)",
    "",
    "| Action | Count |",
    "|---|---|",
    *[f"| `{a}` | {n} |" for a, n in by_action.most_common(40)],
    "",
    "## First 15 write actions (timeline)",
    "",
    "| Time (IST) | Action | Resource |",
    "|---|---|---|",
    *[
        f"| {e['EventTime'].astimezone(IST):%d %b %H:%M:%S} | `{e['EventName']}` | {(e.get('Resources') or [{}])[0].get('ResourceName', '')[:60]} |"
        for e in writes[:15]
    ],
    "",
    "Regenerate with `python scripts/agent_proof.py`. Check it yourself in the AWS Console: CloudTrail → Event history → filter **User name** = `claude-code-agent`.",
]
OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Wrote {OUT} ({len(events)} events, {len(writes)} writes)")
