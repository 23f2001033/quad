"""Shared helpers for every Quad Lambda: DynamoDB access, ids, responses, S3 links, WebSocket push."""
import json
import os
import re
import secrets
import time
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "us-east-1")
TABLE = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
UPLOADS_BUCKET = os.environ.get("UPLOADS_BUCKET", "")
MAX_UPLOAD_BYTES = 15 * 1024 * 1024

_s3 = boto3.client(
    "s3",
    region_name=REGION,
    config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
)
_ws = None

COMMUNITY_TYPES = {"subject", "hackathon", "event", "club", "other"}


class ApiError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status
        self.msg = msg


class _Enc(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return int(o) if o == o.to_integral_value() else float(o)
        if isinstance(o, set):
            return list(o)
        return super().default(o)


def dumps(obj):
    return json.dumps(obj, cls=_Enc)


def resp(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": dumps(body),
    }


def now_ms():
    return int(time.time() * 1000)


def new_id():
    """Time-sortable id: 13-digit epoch millis + random suffix."""
    return f"{now_ms():013d}{secrets.token_hex(4)}"


def id_ms(item_id):
    return int(item_id[:13])


def clean_text(value, limit, field="text", required=False):
    value = (value or "").strip() if isinstance(value, str) else ""
    if required and not value:
        raise ApiError(400, f"{field} is required")
    if len(value) > limit:
        raise ApiError(400, f"{field} is too long (max {limit} characters)")
    return value


def strip_keys(item):
    return {k: v for k, v in item.items() if k not in ("pk", "sk", "gsi1pk", "gsi1sk", "ttl")}


def bump_stat(name, n=1):
    try:
        TABLE.update_item(
            Key={"pk": "STATS", "sk": "GLOBAL"},
            UpdateExpression="ADD #f :n",
            ExpressionAttributeNames={"#f": name},
            ExpressionAttributeValues={":n": n},
        )
    except ClientError as e:  # stats must never break a request
        print("stat failed", name, e)


def query_all(**kwargs):
    return TABLE.query(**kwargs).get("Items", [])


# ---------- users & membership ----------

def get_profile(sub):
    return TABLE.get_item(Key={"pk": f"USER#{sub}", "sk": "PROFILE"}).get("Item")


def public_profile(p):
    if not p:
        return None
    return {
        "sub": p["sub"],
        "name": p.get("name", ""),
        "level": p.get("level", ""),
        "batch": p.get("batch", ""),
        "city": p.get("city", ""),
        "skills": p.get("skills", []),
        "bio": p.get("bio", ""),
        "sample": bool(p.get("sample")),
        "demo": bool(p.get("demo")),
        "createdAt": p.get("createdAt"),
    }


def get_membership(sub, cid):
    return TABLE.get_item(Key={"pk": f"COMM#{cid}", "sk": f"MEMBER#{sub}"}).get("Item")


def get_community(cid):
    return TABLE.get_item(Key={"pk": f"COMM#{cid}", "sk": "META"}).get("Item")


def dm_conv(a, b):
    x, y = sorted([a, b])
    return f"d_{x}_{y}"


def conv_access(sub, conv):
    """Return (kind, target) if sub may read/write conversation conv, else raise."""
    if not re.fullmatch(r"[cd]_[A-Za-z0-9_\-]+", conv or ""):
        raise ApiError(400, "Bad conversation id")
    if conv.startswith("c_"):
        cid = conv[2:]
        if not get_membership(sub, cid):
            raise ApiError(403, "Join this community to see its chat")
        return "community", cid
    parts = conv[2:].split("_")
    if len(parts) != 2 or sub not in parts:
        raise ApiError(403, "Not your conversation")
    other = parts[1] if parts[0] == sub else parts[0]
    return "dm", other


# ---------- files ----------

def safe_filename(name):
    name = re.sub(r"[^\w.\- ()]+", "_", (name or "file").strip())[:120]
    return name or "file"


def presign_upload(sub, filename, content_type):
    key = f"u/{sub}/{new_id()}/{safe_filename(filename)}"
    content_type = (content_type or "application/octet-stream")[:100]
    post = _s3.generate_presigned_post(
        Bucket=UPLOADS_BUCKET,
        Key=key,
        Fields={"Content-Type": content_type},
        Conditions=[{"Content-Type": content_type}, ["content-length-range", 1, MAX_UPLOAD_BYTES]],
        ExpiresIn=600,
    )
    return {"url": post["url"], "fields": post["fields"], "key": key}


def clean_attachments(sub, atts):
    """Accept only files this user uploaded through /api/uploads."""
    out = []
    for a in (atts or [])[:5]:
        key = str(a.get("key", ""))
        if not key.startswith(f"u/{sub}/") or ".." in key:
            raise ApiError(400, "Invalid attachment")
        out.append({
            "key": key,
            "name": safe_filename(a.get("name") or key.rsplit("/", 1)[-1]),
            "size": int(a.get("size") or 0),
            "type": str(a.get("type") or "application/octet-stream")[:100],
        })
    return out


def sign_attachments(item):
    for a in item.get("attachments") or []:
        a["url"] = _s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": UPLOADS_BUCKET, "Key": a["key"]},
            ExpiresIn=6 * 3600,
        )
    return item


# ---------- realtime push ----------

def _ws_client():
    global _ws
    if _ws is None and os.environ.get("WS_CALLBACK_URL"):
        _ws = boto3.client("apigatewaymanagementapi", endpoint_url=os.environ["WS_CALLBACK_URL"])
    return _ws


def push(channel, payload):
    """Send payload to every socket subscribed to channel; prune sockets that are gone."""
    client = _ws_client()
    if not client:
        return
    data = dumps(payload).encode()
    for it in query_all(KeyConditionExpression=Key("pk").eq(f"SUB#{channel}")):
        conn = it["connId"]
        try:
            client.post_to_connection(ConnectionId=conn, Data=data)
        except client.exceptions.GoneException:
            TABLE.delete_item(Key={"pk": it["pk"], "sk": it["sk"]})
        except Exception as e:  # one bad socket must not fail the request
            print("push failed", conn, e)
