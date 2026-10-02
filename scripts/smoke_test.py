"""End-to-end smoke test against the live stack. Uses the demo account, then deletes everything it created.

Usage:  .venv/Scripts/python.exe scripts/smoke_test.py
"""
import json
import pathlib
import threading
import time

import boto3
import requests
import websocket
from boto3.dynamodb.conditions import Key

OUT = json.loads((pathlib.Path(__file__).resolve().parent.parent / "cdk-outputs.json").read_text())["QuadStack"]
API, WS = OUT["ApiUrl"], OUT["WsUrl"]
table = boto3.resource("dynamodb", region_name="us-east-1").Table(OUT["TableName"])
s3 = boto3.client("s3", region_name="us-east-1")

created_pks = []
results = []
me_sub = cid = upload_key = None


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def call(method, path, token=None, body=None, expect=200):
    h = {"Authorization": token} if token else {}
    r = requests.request(method, API + path, headers=h, json=body, timeout=40)
    if r.status_code != expect:
        raise AssertionError(f"{method} {path} -> {r.status_code} {r.text[:300]}")
    return r.json()


stats_before = table.get_item(Key={"pk": "STATS", "sk": "GLOBAL"}).get("Item") or {}
try:
    s = call("GET", "/api/public/stats")
    check("public stats endpoint", "users" in s)

    r = requests.get(API + "/api/me", timeout=20)
    check("API rejects requests without a token", r.status_code == 401, r.status_code)

    tok = call("POST", "/api/public/demo")["idToken"]
    check("one-click demo login returns an ID token", tok.count(".") == 2)
    me = call("GET", "/api/me", tok)
    me_sub = me["sub"]
    check("profile auto-created for demo user", me["sub"] and me["demo"], me["name"])

    r = requests.put(API + "/api/me", headers={"Authorization": tok}, json={"name": "hacker"}, timeout=20)
    check("demo profile is read-only", r.status_code == 403)

    comms = call("GET", "/api/communities", tok)["communities"]
    check("communities listed", len(comms) >= 2, f"{len(comms)} communities")

    c = call("POST", "/api/communities", tok, {"name": "zz smoke test", "type": "club", "description": "temporary"})
    cid = c["cid"]
    created_pks += [f"COMM#{cid}", f"CONV#c_{cid}"]
    check("create community (creator is owner)", c["joined"] and c["role"] == "owner")

    # --- realtime: open a socket and watch the community chat ---
    ticket = call("POST", "/api/ws-ticket", tok)["ticket"]
    got = []
    ready = threading.Event()
    sock = websocket.WebSocketApp(f"{WS}?ticket={ticket}",
                                  on_open=lambda s: (s.send(json.dumps({"action": "watch", "channels": [f"conv:c_{cid}", f"comm:{cid}"]})), ready.set()),
                                  on_message=lambda s, m: got.append(json.loads(m)))
    threading.Thread(target=sock.run_forever, daemon=True).start()
    check("websocket connects with a one-time ticket", ready.wait(10))
    time.sleep(1.5)  # let the watch subscription land
    bad = websocket.WebSocket()
    try:
        bad.connect(f"{WS}?ticket={ticket}")  # ticket already used
        check("used ticket is rejected", False)
    except Exception:
        check("used ticket is rejected", True)

    # --- files: presigned upload ---
    data = b"%PDF-1.4 smoke test file"
    up = call("POST", "/api/uploads", tok, {"filename": "notes.pdf", "contentType": "application/pdf", "size": len(data)})
    upload_key = up["key"]
    r = requests.post(up["url"], data=up["fields"], files={"file": ("notes.pdf", data, "application/pdf")}, timeout=30)
    check("browser-style upload straight to S3", r.status_code in (200, 204), r.status_code)
    att = {"key": up["key"], "name": "notes.pdf", "size": len(data), "type": "application/pdf"}
    r = requests.post(API + f"/api/conversations/c_{cid}/messages", headers={"Authorization": tok},
                      json={"text": "x", "attachments": [{"key": "u/someone-else/x/y.pdf", "name": "y.pdf"}]}, timeout=20)
    check("can't attach someone else's file", r.status_code == 400)

    m = call("POST", f"/api/conversations/c_{cid}/messages", tok, {"text": "hello from the smoke test", "attachments": [att]})
    check("send group message with attachment", m["attachments"][0]["url"].startswith("https://"))
    dl = requests.get(m["attachments"][0]["url"], timeout=20)
    check("attachment downloads via presigned link", dl.content == data)
    time.sleep(2)
    check("message pushed live over websocket", any(e.get("type") == "message" and e["message"]["mid"] == m["mid"] for e in got), f"{len(got)} events")

    msgs = call("GET", f"/api/conversations/c_{cid}/messages", tok)["messages"]
    check("chat history", any(x["mid"] == m["mid"] for x in msgs))

    # --- posts, votes, threaded comments, feed, search ---
    p = call("POST", f"/api/communities/{cid}/posts", tok, {"title": "Quiz 1 revision on Saturday", "text": "Bring your doubts about PCA!"})
    created_pks.append(f"POST#{p['pid']}")
    check("create post (author auto-upvotes)", p["score"] == 1 and p["myVote"] == 1)
    down = call("POST", f"/api/communities/{cid}/posts/{p['pid']}/vote", tok, {"value": -1})
    clear = call("POST", f"/api/communities/{cid}/posts/{p['pid']}/vote", tok, {"value": 0})
    check("down-vote then clear", down["score"] == -1 and down["myVote"] == -1 and clear["score"] == 0)
    cm = call("POST", f"/api/communities/{cid}/posts/{p['pid']}/comments", tok, {"text": "Is it recorded?"})
    rp = call("POST", f"/api/communities/{cid}/posts/{p['pid']}/comments", tok, {"text": "Yes!", "parent": cm["cmid"]})
    check("threaded reply", rp["parent"] == cm["cmid"])
    call("DELETE", f"/api/communities/{cid}/posts/{p['pid']}/comments/{cm['cmid']}", tok)
    cms = call("GET", f"/api/communities/{cid}/posts/{p['pid']}/comments", tok)["comments"]
    check("deleted comment keeps its slot as [deleted]", any(c.get("deleted") for c in cms) and len(cms) == 2)
    detail = call("GET", f"/api/communities/{cid}/posts/{p['pid']}", tok)
    check("post page shows comment count", detail["commentCount"] == 2)
    feed = call("GET", "/api/feed?scope=mine&sort=new", tok)["posts"]
    check("home feed includes the new post", any(x["pid"] == p["pid"] for x in feed))
    hot = call("GET", "/api/feed?scope=all&sort=hot", tok)["posts"]
    check("popular feed (hot sort)", len(hot) > 0)
    found = call("GET", "/api/search?q=revision", tok)
    check("search finds the post", any(x["pid"] == p["pid"] for x in found["posts"]))
    time.sleep(1.5)
    check("post pushed live over websocket", any(e.get("type") == "post" for e in got))
    call("DELETE", f"/api/conversations/c_{cid}/messages/{m['mid']}", tok)
    time.sleep(1.5)
    check("message delete pushed live", any(e.get("type") == "message_deleted" for e in got))
    check("notifications endpoint", "unread" in call("GET", "/api/notifications", tok))
    tm = call("POST", "/api/communities/sample-hack/teammates", tok, {"need": "a UI person"})
    check("✨ Find teammates (Bedrock)", isinstance(tm["matches"], list), f"{len(tm['matches'])} matches")

    # --- AI ---
    t0 = time.time()
    cu = call("POST", f"/api/communities/{cid}/catchup", tok, {"window": "24h"})
    check("✨ Catch me up (Bedrock)", not cu["empty"] and cu["summary"]["tldr"], f"{time.time() - t0:.1f}s · {cu['summary']['tldr'][:90]}")

    # --- access control ---
    r = requests.get(API + "/api/conversations/c_sample-nonexistent/messages", headers={"Authorization": tok}, timeout=20)
    check("can't read a community chat you haven't joined", r.status_code == 403)
    r = requests.get(API + "/api/conversations/d_aaa_bbb/messages", headers={"Authorization": tok}, timeout=20)
    check("can't read other people's DMs", r.status_code == 403)

    # --- DMs ---
    dms = call("GET", "/api/dms", tok)["dms"]
    check("DM list", isinstance(dms, list), f"{len(dms)} conversations")
    sock.close()
finally:
    # clean up everything this test created
    for pk in created_pks:
        for it in table.query(KeyConditionExpression=Key("pk").eq(pk))["Items"]:
            table.delete_item(Key={"pk": it["pk"], "sk": it["sk"]})
    if me_sub and cid:
        table.delete_item(Key={"pk": f"USER#{me_sub}", "sk": f"COMM#{cid}"})
    if upload_key:
        s3.delete_object(Bucket=OUT["UploadsBucket"], Key=upload_key)
    # restore usage counters so tests never inflate the public stats
    stats_now = table.get_item(Key={"pk": "STATS", "sk": "GLOBAL"}).get("Item") or {}
    for k, v in stats_now.items():
        if k in ("pk", "sk"):
            continue
        diff = int(v) - int(stats_before.get(k, 0))
        if diff:
            table.update_item(Key={"pk": "STATS", "sk": "GLOBAL"}, UpdateExpression="ADD #f :d",
                              ExpressionAttributeNames={"#f": k}, ExpressionAttributeValues={":d": -diff})

passed = sum(ok for _, ok in results)
print(f"\n{passed}/{len(results)} checks passed")
