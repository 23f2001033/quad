"""'Catch me up': summarise what a student missed in a community using Amazon Bedrock."""
import json
import os
from datetime import datetime, timedelta, timezone

import boto3
from boto3.dynamodb.conditions import Key

from common import query_all, id_ms

MODEL_ID = os.environ.get("MODEL_ID", "us.amazon.nova-2-lite-v1:0")
IST = timezone(timedelta(hours=5, minutes=30))
MAX_TRANSCRIPT_CHARS = 60_000

_bedrock = boto3.client("bedrock-runtime")

SYSTEM_PROMPT = """You are the "Catch me up" assistant inside Quad, a community app for college students.
You get a transcript of posts, comments and group-chat messages from one community.
Write a catch-up for a student who missed it.

Rules:
- Use ONLY facts in the transcript. Never invent names, dates, links or files.
- Be concise and friendly, like a helpful classmate. Plain English; keep Hinglish words if the students used them.
- Prioritise: announcements, deadlines, decisions, things that need action, unanswered questions, useful files.
- Skip greetings, jokes and small talk unless that's all there is.

Reply with ONLY a JSON object, no markdown, in exactly this shape:
{
  "tldr": "1-2 sentence summary",
  "highlights": [{"title": "short title", "detail": "one or two sentences", "who": "names involved"}],
  "deadlines": [{"what": "what is due / happening", "when": "date or time as written in the transcript"}],
  "openQuestions": [{"question": "a question nobody answered yet", "askedBy": "name"}],
  "files": [{"name": "file name", "sharedBy": "name", "why": "why it matters"}],
  "mood": "a 2-5 word vibe of the group"
}
Max 5 highlights. Use empty lists when there is nothing for a section."""


def _fmt_time(ms):
    return datetime.fromtimestamp(ms / 1000, IST).strftime("%a %d %b, %I:%M %p")


def _who(item):
    name = item.get("authorName") or item.get("senderName") or "Someone"
    return name


def _files(item):
    names = [a.get("name", "file") for a in item.get("attachments") or []]
    return f"  [shared files: {', '.join(names)}]" if names else ""


def gather(cid, since_ms):
    since = f"{since_ms:013d}"
    posts = query_all(
        KeyConditionExpression=Key("pk").eq(f"COMM#{cid}") & Key("sk").between(f"POST#{since}", "POST#~"),
        ScanIndexForward=False,
        Limit=40,
    )
    posts.reverse()
    msgs = query_all(
        KeyConditionExpression=Key("pk").eq(f"CONV#c_{cid}") & Key("sk").between(f"MSG#{since}", "MSG#~"),
        ScanIndexForward=False,
        Limit=250,
    )
    msgs.reverse()
    comments = {}
    for p in posts:
        if p.get("commentCount"):
            comments[p["pid"]] = query_all(
                KeyConditionExpression=Key("pk").eq(f"POST#{p['pid']}") & Key("sk").begins_with("C#"),
                Limit=15,
            )
    return posts, msgs, comments


def build_transcript(meta, posts, msgs, comments):
    lines = [f'Community: {meta.get("name")} ({meta.get("type")}). {meta.get("description", "")}', ""]
    if posts:
        lines.append("=== POSTS ===")
        for p in posts:
            lines.append(f"[{_fmt_time(id_ms(p['pid']))}] {_who(p)}: {p.get('text', '')}{_files(p)}  (likes: {p.get('likeCount', 0)})")
            for c in comments.get(p["pid"], []):
                lines.append(f"    reply from {_who(c)}: {c.get('text', '')}")
        lines.append("")
    if msgs:
        lines.append("=== GROUP CHAT ===")
        for m in msgs:
            lines.append(f"[{_fmt_time(id_ms(m['mid']))}] {_who(m)}: {m.get('text', '')}{_files(m)}")
    text = "\n".join(lines)
    if len(text) > MAX_TRANSCRIPT_CHARS:  # keep the most recent part
        text = text[:2000] + "\n...(older items trimmed)...\n" + text[-(MAX_TRANSCRIPT_CHARS - 2000):]
    return text


def _parse_json(text):
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return {"tldr": text.strip(), "highlights": [], "deadlines": [], "openQuestions": [], "files": [], "mood": ""}
    data = json.loads(text[start:end + 1])
    for k in ("highlights", "deadlines", "openQuestions", "files"):
        if not isinstance(data.get(k), list):
            data[k] = []
    data.setdefault("tldr", "")
    data.setdefault("mood", "")
    return data


def summarise(meta, since_ms):
    cid = meta["cid"]
    posts, msgs, comments = gather(cid, since_ms)
    files = sum(len(i.get("attachments") or []) for i in posts + msgs)
    counts = {"posts": len(posts), "messages": len(msgs), "files": files}
    if not posts and not msgs:
        return {"empty": True, "counts": counts}

    transcript = build_transcript(meta, posts, msgs, comments)
    res = _bedrock.converse(
        modelId=MODEL_ID,
        system=[{"text": SYSTEM_PROMPT}],
        messages=[{"role": "user", "content": [{"text": transcript}]}],
        inferenceConfig={"maxTokens": 1200, "temperature": 0.2},
    )
    out = "".join(b.get("text", "") for b in res["output"]["message"]["content"])
    try:
        summary = _parse_json(out)
    except json.JSONDecodeError:
        summary = {"tldr": out.strip(), "highlights": [], "deadlines": [], "openQuestions": [], "files": [], "mood": ""}
    usage = res.get("usage", {})
    return {
        "empty": False,
        "counts": counts,
        "summary": summary,
        "model": MODEL_ID,
        "tokens": usage.get("inputTokens", 0) + usage.get("outputTokens", 0),
    }
