"""Quad HTTP API: one Lambda behind API Gateway (HTTP API) with a small regex router."""
import base64
import json
import os
import re
import secrets
import time
import traceback

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

import catchup
from common import (
    COMMUNITY_TYPES, TABLE, ApiError, bump_stat, clean_attachments, clean_text, conv_access,
    get_community, get_membership, get_profile, new_id, now_ms, presign_upload,
    public_profile, push, query_all, resp, sign_attachments, strip_keys,
)

DEMO_EMAIL = os.environ.get("DEMO_EMAIL", "demo@quad.demo")
USER_POOL_ID = os.environ.get("USER_POOL_ID", "")
CLIENT_ID = os.environ.get("CLIENT_ID", "")
DEMO_SECRET_ARN = os.environ.get("DEMO_SECRET_ARN", "")

_cognito = boto3.client("cognito-idp")
_secrets = boto3.client("secretsmanager")
_demo_password = None

ROUTES = []


def route(method, pattern):
    rx = re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern) + "$")

    def deco(fn):
        ROUTES.append((method, rx, fn))
        return fn
    return deco


class Req:
    def __init__(self, event):
        claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
        self.sub = claims.get("sub")
        self.email = (claims.get("email") or "").lower()
        self.name = claims.get("name") or ""
        raw = event.get("body") or ""
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode()
        try:
            self.body = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            raise ApiError(400, "Body must be JSON")
        self.qs = event.get("queryStringParameters") or {}
        self._profile = None

    @property
    def profile(self):
        if self._profile is None:
            self._profile = ensure_profile(self)
        return self._profile


def handler(event, context):
    method = event["requestContext"]["http"]["method"]
    path = event.get("rawPath", "")
    try:
        req = Req(event)
        for m, rx, fn in ROUTES:
            match = rx.match(path)
            if m == method and match:
                if not path.startswith("/api/public/") and not req.sub:
                    raise ApiError(401, "Please log in")
                return resp(200, fn(req, **match.groupdict()))
        return resp(404, {"error": "Not found"})
    except ApiError as e:
        return resp(e.status, {"error": e.msg})
    except Exception:
        traceback.print_exc()
        return resp(500, {"error": "Something went wrong. Please try again."})


# ---------------- profile ----------------

LEVELS = {"", "Foundation", "Diploma in Programming", "Diploma in Data Science", "BSc", "BS", "Alumni"}


def batch_from_email(email):
    """IITM BS roll numbers look like 23f2001033: joined 2023, in term 2 of that year."""
    m = re.match(r"^(\d{2})[a-z](\d)\d{3,}@", email or "")
    return f"20{m.group(1)} · Term {m.group(2)}" if m else ""


def ensure_profile(req):
    p = get_profile(req.sub)
    if p:
        return p
    name = (req.name or req.email.split("@")[0] or "Student")[:60]
    p = {
        "pk": f"USER#{req.sub}", "sk": "PROFILE", "sub": req.sub, "email": req.email, "name": name,
        "level": "", "batch": batch_from_email(req.email), "city": "", "skills": [], "bio": "", "createdAt": now_ms(),
        "demo": req.email == DEMO_EMAIL, "gsi1pk": "USERS", "gsi1sk": name.lower(),
    }
    try:
        TABLE.put_item(Item=p, ConditionExpression="attribute_not_exists(pk)")
        bump_stat("users")
    except ClientError as e:
        if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        p = get_profile(req.sub)
    return p


@route("GET", "/api/me")
def me(req):
    out = public_profile(req.profile)
    out["email"] = req.profile.get("email", "")
    return out


@route("PUT", "/api/me")
def update_me(req):
    if req.profile.get("demo"):
        raise ApiError(403, "The demo profile is read-only. Sign up with your college email to make your own!")
    b = req.body
    name = clean_text(b.get("name"), 60, "Name", required=True)
    skills = [clean_text(s, 30, "Skill") for s in (b.get("skills") or [])[:15]]
    skills = [s for s in skills if s]
    level = b.get("level") or ""
    if level not in LEVELS:
        raise ApiError(400, "Unknown level")
    TABLE.update_item(
        Key={"pk": f"USER#{req.sub}", "sk": "PROFILE"},
        UpdateExpression="SET #n=:n, #l=:l, city=:c, skills=:s, bio=:bio, gsi1sk=:g",
        ExpressionAttributeNames={"#n": "name", "#l": "level"},
        ExpressionAttributeValues={
            ":n": name, ":l": level, ":c": clean_text(b.get("city"), 40, "City"),
            ":s": skills, ":bio": clean_text(b.get("bio"), 300, "Bio"), ":g": name.lower(),
        },
    )
    req._profile = None
    return me(req)


@route("GET", "/api/users")
def list_users(req):
    q = (req.qs.get("q") or "").strip().lower()
    items = query_all(IndexName="gsi1", KeyConditionExpression=Key("gsi1pk").eq("USERS"), Limit=500)
    out = []
    for p in items:
        hay = " ".join([p.get("name", ""), p.get("level", ""), p.get("city", ""), " ".join(p.get("skills", []))]).lower()
        if not q or q in hay:
            out.append(public_profile(p))
    return {"users": out[:100]}


@route("GET", "/api/users/{sub}")
def get_user(req, sub):
    p = get_profile(sub)
    if not p:
        raise ApiError(404, "User not found")
    comms = query_all(KeyConditionExpression=Key("pk").eq(f"USER#{sub}") & Key("sk").begins_with("COMM#"))
    return {"user": public_profile(p), "communities": [{"cid": c["cid"], "name": c["name"], "type": c["type"]} for c in comms]}


# ---------------- communities ----------------

def community_out(meta, joined=False, role=None):
    out = strip_keys(meta)
    out["joined"] = joined
    out["role"] = role
    return out


def join_community(req, meta, role="member"):
    cid = meta["cid"]
    try:
        TABLE.put_item(
            Item={
                "pk": f"COMM#{cid}", "sk": f"MEMBER#{req.sub}", "sub": req.sub, "name": req.profile["name"],
                "role": role, "joinedAt": now_ms(), "lastSeen": now_ms(), "prevSeen": now_ms(),
            },
            ConditionExpression="attribute_not_exists(pk)",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return
        raise
    TABLE.put_item(Item={"pk": f"USER#{req.sub}", "sk": f"COMM#{cid}", "cid": cid, "name": meta["name"], "type": meta["type"], "joinedAt": now_ms()})
    TABLE.update_item(Key={"pk": f"COMM#{cid}", "sk": "META"}, UpdateExpression="ADD memberCount :one", ExpressionAttributeValues={":one": 1})


@route("GET", "/api/communities")
def list_communities(req):
    items = query_all(IndexName="gsi1", KeyConditionExpression=Key("gsi1pk").eq("COMMS"), ScanIndexForward=False, Limit=200)
    mine = {c["cid"] for c in query_all(KeyConditionExpression=Key("pk").eq(f"USER#{req.sub}") & Key("sk").begins_with("COMM#"))}
    return {"communities": [community_out(c, c["cid"] in mine) for c in items]}


@route("GET", "/api/my/communities")
def my_communities(req):
    items = query_all(KeyConditionExpression=Key("pk").eq(f"USER#{req.sub}") & Key("sk").begins_with("COMM#"))
    return {"communities": [{"cid": c["cid"], "name": c["name"], "type": c["type"]} for c in items]}


@route("POST", "/api/communities")
def create_community(req):
    b = req.body
    ctype = b.get("type") if b.get("type") in COMMUNITY_TYPES else "other"
    cid = new_id()
    meta = {
        "pk": f"COMM#{cid}", "sk": "META", "cid": cid,
        "name": clean_text(b.get("name"), 80, "Name", required=True),
        "description": clean_text(b.get("description"), 500, "Description"),
        "type": ctype, "createdBy": req.sub, "createdByName": req.profile["name"],
        "createdAt": now_ms(), "memberCount": 0,
        "gsi1pk": "COMMS", "gsi1sk": f"{now_ms():013d}",
    }
    TABLE.put_item(Item=meta)
    join_community(req, meta, role="owner")
    bump_stat("communities")
    meta["memberCount"] = 1
    return community_out(meta, True, "owner")


@route("GET", "/api/communities/{cid}")
def get_community_detail(req, cid):
    meta = get_community(cid)
    if not meta:
        raise ApiError(404, "Community not found")
    me_member = get_membership(req.sub, cid)
    if me_member and now_ms() - int(me_member.get("lastSeen", 0)) > 30 * 60 * 1000:
        # a new visit: remember when the previous one was, for "since my last visit"
        TABLE.update_item(
            Key={"pk": f"COMM#{cid}", "sk": f"MEMBER#{req.sub}"},
            UpdateExpression="SET prevSeen=lastSeen, lastSeen=:now",
            ExpressionAttributeValues={":now": now_ms()},
        )
    members = query_all(KeyConditionExpression=Key("pk").eq(f"COMM#{cid}") & Key("sk").begins_with("MEMBER#"), Limit=100)
    profiles = {}
    if members:
        keys = [{"pk": f"USER#{m['sub']}", "sk": "PROFILE"} for m in members]
        res = TABLE.meta.client.batch_get_item(RequestItems={TABLE.name: {"Keys": keys}})
        for p in res["Responses"].get(TABLE.name, []):
            profiles[p["sub"]] = public_profile(p)
    out = community_out(meta, bool(me_member), me_member.get("role") if me_member else None)
    out["members"] = [dict(profiles.get(m["sub"]) or {"sub": m["sub"], "name": m.get("name", "")}, role=m.get("role")) for m in members]
    return out


@route("POST", "/api/communities/{cid}/join")
def join(req, cid):
    meta = get_community(cid)
    if not meta:
        raise ApiError(404, "Community not found")
    join_community(req, meta)
    return {"ok": True}


@route("POST", "/api/communities/{cid}/leave")
def leave(req, cid):
    m = get_membership(req.sub, cid)
    if not m:
        return {"ok": True}
    if m.get("role") == "owner":
        raise ApiError(400, "Owners can't leave their own community")
    TABLE.delete_item(Key={"pk": f"COMM#{cid}", "sk": f"MEMBER#{req.sub}"})
    TABLE.delete_item(Key={"pk": f"USER#{req.sub}", "sk": f"COMM#{cid}"})
    TABLE.update_item(Key={"pk": f"COMM#{cid}", "sk": "META"}, UpdateExpression="ADD memberCount :m", ExpressionAttributeValues={":m": -1})
    return {"ok": True}


def require_member(req, cid):
    if not get_membership(req.sub, cid):
        raise ApiError(403, "Join this community first")


# ---------------- posts, likes, comments ----------------

@route("GET", "/api/communities/{cid}/posts")
def list_posts(req, cid):
    before = req.qs.get("before")
    upper = f"POST#{before}" if before else "POST#~"
    items = query_all(
        KeyConditionExpression=Key("pk").eq(f"COMM#{cid}") & Key("sk").between("POST#0", upper),
        ScanIndexForward=False, Limit=26,
    )
    items = [p for p in items if p["pid"] != before][:25]
    liked = set()
    if items:
        keys = [{"pk": f"POST#{p['pid']}", "sk": f"LIKE#{req.sub}"} for p in items]
        res = TABLE.meta.client.batch_get_item(RequestItems={TABLE.name: {"Keys": keys}})
        liked = {r["pk"][5:] for r in res["Responses"].get(TABLE.name, [])}
    out = []
    for p in items:
        p = sign_attachments(strip_keys(p))
        p["liked"] = p["pid"] in liked
        out.append(p)
    return {"posts": out}


@route("POST", "/api/communities/{cid}/posts")
def create_post(req, cid):
    require_member(req, cid)
    text = clean_text(req.body.get("text"), 4000, "Post")
    atts = clean_attachments(req.sub, req.body.get("attachments"))
    if not text and not atts:
        raise ApiError(400, "Write something or attach a file")
    pid = new_id()
    p = {
        "pk": f"COMM#{cid}", "sk": f"POST#{pid}", "pid": pid, "cid": cid, "author": req.sub,
        "authorName": req.profile["name"], "authorLevel": req.profile.get("level", ""),
        "text": text, "attachments": atts, "likeCount": 0, "commentCount": 0, "createdAt": now_ms(),
    }
    TABLE.put_item(Item=p)
    bump_stat("posts")
    if atts:
        bump_stat("files", len(atts))
    out = sign_attachments(strip_keys(p))
    out["liked"] = False
    push(f"comm:{cid}", {"type": "post", "post": out})
    return out


@route("POST", "/api/communities/{cid}/posts/{pid}/like")
def toggle_like(req, cid, pid):
    require_member(req, cid)
    post_key = {"pk": f"COMM#{cid}", "sk": f"POST#{pid}"}
    like_key = {"pk": f"POST#{pid}", "sk": f"LIKE#{req.sub}"}
    try:
        TABLE.put_item(Item={**like_key, "at": now_ms()}, ConditionExpression="attribute_not_exists(pk)")
        delta, liked = 1, True
    except ClientError as e:
        if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        TABLE.delete_item(Key=like_key)
        delta, liked = -1, False
    res = TABLE.update_item(
        Key=post_key, UpdateExpression="ADD likeCount :d", ExpressionAttributeValues={":d": delta},
        ConditionExpression="attribute_exists(pk)", ReturnValues="UPDATED_NEW",
    )
    return {"liked": liked, "likeCount": res["Attributes"]["likeCount"]}


@route("GET", "/api/communities/{cid}/posts/{pid}/comments")
def list_comments(req, cid, pid):
    items = query_all(KeyConditionExpression=Key("pk").eq(f"POST#{pid}") & Key("sk").begins_with("C#"), Limit=200)
    return {"comments": [strip_keys(c) for c in items]}


@route("POST", "/api/communities/{cid}/posts/{pid}/comments")
def add_comment(req, cid, pid):
    require_member(req, cid)
    text = clean_text(req.body.get("text"), 1000, "Comment", required=True)
    cmid = new_id()
    c = {"pk": f"POST#{pid}", "sk": f"C#{cmid}", "cmid": cmid, "pid": pid, "author": req.sub,
         "authorName": req.profile["name"], "text": text, "createdAt": now_ms()}
    TABLE.update_item(
        Key={"pk": f"COMM#{cid}", "sk": f"POST#{pid}"}, UpdateExpression="ADD commentCount :one",
        ExpressionAttributeValues={":one": 1}, ConditionExpression="attribute_exists(pk)",
    )
    TABLE.put_item(Item=c)
    bump_stat("comments")
    out = strip_keys(c)
    push(f"comm:{cid}", {"type": "comment", "pid": pid, "comment": out})
    return out


# ---------------- chat (community groups + DMs) ----------------

@route("GET", "/api/conversations/{conv}/messages")
def list_messages(req, conv):
    kind, target = conv_access(req.sub, conv)
    before = req.qs.get("before")
    upper = f"MSG#{before}" if before else "MSG#~"
    items = query_all(
        KeyConditionExpression=Key("pk").eq(f"CONV#{conv}") & Key("sk").between("MSG#0", upper),
        ScanIndexForward=False, Limit=61,
    )
    items = [m for m in items if m["mid"] != before][:60]
    items.reverse()
    if kind == "dm":
        try:
            TABLE.update_item(
                Key={"pk": f"USER#{req.sub}", "sk": f"DM#{target}"}, UpdateExpression="SET unread=:z",
                ExpressionAttributeValues={":z": 0}, ConditionExpression="attribute_exists(pk)",
            )
        except ClientError:
            pass
    return {"messages": [sign_attachments(strip_keys(m)) for m in items]}


@route("POST", "/api/conversations/{conv}/messages")
def send_message(req, conv):
    kind, target = conv_access(req.sub, conv)
    text = clean_text(req.body.get("text"), 2000, "Message")
    atts = clean_attachments(req.sub, req.body.get("attachments"))
    if not text and not atts:
        raise ApiError(400, "Empty message")
    other = None
    if kind == "dm":
        other = get_profile(target)
        if not other:
            raise ApiError(404, "That student doesn't exist")
        if target == req.sub:
            raise ApiError(400, "You can't message yourself")
    mid = new_id()
    m = {"pk": f"CONV#{conv}", "sk": f"MSG#{mid}", "mid": mid, "conv": conv, "sender": req.sub,
         "senderName": req.profile["name"], "text": text, "attachments": atts, "createdAt": now_ms()}
    TABLE.put_item(Item=m)
    bump_stat("messages")
    if atts:
        bump_stat("files", len(atts))
    out = sign_attachments(strip_keys(m))
    preview = text[:120] or f"📎 {atts[0]['name']}"
    if kind == "dm":
        TABLE.put_item(Item={"pk": f"USER#{req.sub}", "sk": f"DM#{target}", "other": target, "otherName": other["name"],
                             "lastText": preview, "lastAt": now_ms(), "unread": 0})
        TABLE.update_item(
            Key={"pk": f"USER#{target}", "sk": f"DM#{req.sub}"},
            UpdateExpression="SET other=:o, otherName=:n, lastText=:t, lastAt=:a ADD unread :one",
            ExpressionAttributeValues={":o": req.sub, ":n": req.profile["name"], ":t": preview, ":a": now_ms(), ":one": 1},
        )
        push(f"user:{target}", {"type": "dm", "from": req.sub, "fromName": req.profile["name"], "message": out})
    push(f"conv:{conv}", {"type": "message", "message": out})
    return out


@route("GET", "/api/dms")
def list_dms(req):
    items = query_all(KeyConditionExpression=Key("pk").eq(f"USER#{req.sub}") & Key("sk").begins_with("DM#"))
    items.sort(key=lambda d: d.get("lastAt", 0), reverse=True)
    return {"dms": [strip_keys(d) for d in items]}


# ---------------- uploads & realtime ticket ----------------

@route("POST", "/api/uploads")
def create_upload(req):
    size = int(req.body.get("size") or 0)
    if size <= 0 or size > 15 * 1024 * 1024:
        raise ApiError(400, "Files must be under 15 MB")
    return presign_upload(req.sub, req.body.get("filename"), req.body.get("contentType"))


@route("POST", "/api/ws-ticket")
def ws_ticket(req):
    ticket = secrets.token_urlsafe(24)
    TABLE.put_item(Item={"pk": f"TICKET#{ticket}", "sk": "META", "sub": req.sub, "ttl": int(time.time()) + 120})
    return {"ticket": ticket}


# ---------------- AI: catch me up ----------------

WINDOWS = {"24h": 24 * 3600 * 1000, "7d": 7 * 24 * 3600 * 1000, "30d": 30 * 24 * 3600 * 1000}


@route("POST", "/api/communities/{cid}/catchup")
def catch_me_up(req, cid):
    meta = get_community(cid)
    if not meta:
        raise ApiError(404, "Community not found")
    member = get_membership(req.sub, cid)
    if not member:
        raise ApiError(403, "Join this community to catch up on it")
    window = req.body.get("window", "last_visit")
    if window in WINDOWS:
        since = now_ms() - WINDOWS[window]
    else:
        window = "last_visit"
        since = int(member.get("prevSeen") or member.get("joinedAt") or now_ms() - WINDOWS["7d"])
    result = catchup.summarise(meta, since)
    result["since"] = since
    result["window"] = window
    if not result["empty"]:
        bump_stat("catchups")
    return result


# ---------------- public (no login) ----------------

@route("GET", "/api/public/stats")
def stats(req):
    s = TABLE.get_item(Key={"pk": "STATS", "sk": "GLOBAL"}).get("Item") or {}
    return {k: s.get(k, 0) for k in ("users", "communities", "posts", "messages", "comments", "files", "catchups")}


def demo_password():
    global _demo_password
    if _demo_password is None:
        _demo_password = _secrets.get_secret_value(SecretId=DEMO_SECRET_ARN)["SecretString"]
    return _demo_password


def ensure_demo_user():
    try:
        _cognito.admin_create_user(
            UserPoolId=USER_POOL_ID, Username=DEMO_EMAIL, MessageAction="SUPPRESS",
            UserAttributes=[{"Name": "email", "Value": DEMO_EMAIL}, {"Name": "email_verified", "Value": "true"},
                            {"Name": "name", "Value": "Demo Visitor"}],
        )
    except _cognito.exceptions.UsernameExistsException:
        pass
    _cognito.admin_set_user_password(UserPoolId=USER_POOL_ID, Username=DEMO_EMAIL, Password=demo_password(), Permanent=True)


@route("POST", "/api/public/demo")
def demo_login(req):
    """One-click demo for judges. Returns only an ID token, so the shared account can't be changed or deleted."""
    params = {"USERNAME": DEMO_EMAIL, "PASSWORD": demo_password()}
    try:
        res = _cognito.admin_initiate_auth(UserPoolId=USER_POOL_ID, ClientId=CLIENT_ID, AuthFlow="ADMIN_USER_PASSWORD_AUTH", AuthParameters=params)
    except (_cognito.exceptions.NotAuthorizedException, _cognito.exceptions.UserNotFoundException):
        ensure_demo_user()
        res = _cognito.admin_initiate_auth(UserPoolId=USER_POOL_ID, ClientId=CLIENT_ID, AuthFlow="ADMIN_USER_PASSWORD_AUTH", AuthParameters=params)
    auth = res["AuthenticationResult"]
    return {"idToken": auth["IdToken"], "expiresIn": auth["ExpiresIn"]}
