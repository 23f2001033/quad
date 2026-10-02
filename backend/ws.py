"""WebSocket API: authenticate sockets with a one-time ticket and manage channel subscriptions."""
import json
import time

from common import TABLE, ApiError, conv_access, get_membership

CONN_TTL = 3 * 3600
MAX_CHANNELS = 10


def _sub_item(channel, conn, sub):
    return {"pk": f"SUB#{channel}", "sk": f"CONN#{conn}", "connId": conn, "sub": sub, "ttl": int(time.time()) + CONN_TTL}


def _allowed(sub, channel):
    kind, _, target = channel.partition(":")
    try:
        if kind == "conv":
            conv_access(sub, target)
            return True
        if kind == "comm":
            return bool(get_membership(sub, target))
    except ApiError:
        return False
    return False


def handler(event, context):
    rc = event["requestContext"]
    route, conn = rc["routeKey"], rc["connectionId"]

    if route == "$connect":
        ticket = (event.get("queryStringParameters") or {}).get("ticket", "")
        item = TABLE.get_item(Key={"pk": f"TICKET#{ticket}", "sk": "META"}).get("Item") if ticket else None
        if not item or int(item["ttl"]) < time.time():
            return {"statusCode": 401}
        TABLE.delete_item(Key={"pk": f"TICKET#{ticket}", "sk": "META"})
        sub = item["sub"]
        own = f"user:{sub}"
        TABLE.put_item(Item={"pk": f"CONN#{conn}", "sk": "META", "sub": sub, "channels": [own], "ttl": int(time.time()) + CONN_TTL})
        TABLE.put_item(Item=_sub_item(own, conn, sub))
        return {"statusCode": 200}

    meta = TABLE.get_item(Key={"pk": f"CONN#{conn}", "sk": "META"}).get("Item")

    if route == "$disconnect":
        if meta:
            for ch in meta.get("channels", []):
                TABLE.delete_item(Key={"pk": f"SUB#{ch}", "sk": f"CONN#{conn}"})
            TABLE.delete_item(Key={"pk": f"CONN#{conn}", "sk": "META"})
        return {"statusCode": 200}

    # $default: {"action": "watch", "channels": [...]} replaces this socket's channel set
    if not meta:
        return {"statusCode": 401}
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return {"statusCode": 400}
    if body.get("action") != "watch":
        return {"statusCode": 200}  # pings and unknown actions are no-ops

    sub = meta["sub"]
    own = f"user:{sub}"
    wanted = [c for c in body.get("channels", [])[:MAX_CHANNELS] if isinstance(c, str) and _allowed(sub, c)]
    new_set = [own] + [c for c in dict.fromkeys(wanted) if c != own]
    for ch in set(meta.get("channels", [])) - set(new_set):
        TABLE.delete_item(Key={"pk": f"SUB#{ch}", "sk": f"CONN#{conn}"})
    for ch in new_set:
        TABLE.put_item(Item=_sub_item(ch, conn, sub))
    TABLE.update_item(
        Key={"pk": f"CONN#{conn}", "sk": "META"}, UpdateExpression="SET channels=:c, #t=:t",
        ExpressionAttributeNames={"#t": "ttl"}, ExpressionAttributeValues={":c": new_set, ":t": int(time.time()) + CONN_TTL},
    )
    return {"statusCode": 200}
