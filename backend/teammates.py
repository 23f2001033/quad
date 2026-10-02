"""'Find teammates / study partners': rank a community's members for what a student needs, using Amazon Bedrock."""
import json

from catchup import MODEL_ID, _bedrock

SYSTEM_PROMPT = """You help students in Quad, the community app for the IIT Madras BS online degree, find teammates or study partners inside one community.
You get the requester's profile, what they are looking for, and a list of candidate members.

Rules:
- Pick up to 5 candidates who best fit the need. Use ONLY the candidates given and only facts in their profiles. Never invent skills.
- Project / hackathon needs: prefer complementary skills to the requester's.
- Study partner needs: prefer a similar level, and the same city if they want to meet in person.
- If nobody fits well, return fewer matches (or none) rather than weak ones.

Reply with ONLY a JSON object, no markdown:
{"matches": [{"id": "candidate id", "why": "one specific sentence on why they fit"}], "tip": "one short, practical suggestion for the requester"}"""


def _profile_line(p):
    bits = [p.get("level"), p.get("batch") and f"batch {p['batch']}", p.get("city") and f"in {p['city']}"]
    skills = ", ".join(p.get("skills") or []) or "no skills listed"
    bio = (p.get("bio") or "").replace("\n", " ")[:160]
    return f"{', '.join(b for b in bits if b) or 'IITM BS student'}; skills: {skills}; bio: {bio or '-'}"


def find(requester, need, candidates, community):
    lines = [
        f'Community: {community["name"]} ({community["type"]})',
        f"Requester: {requester['name']}: {_profile_line(requester)}",
        f"Looking for: {need}",
        "",
        "Candidates:",
    ]
    lines += [f"- id={c['sub']} | {c['name']}: {_profile_line(c)}" for c in candidates]
    res = _bedrock.converse(
        modelId=MODEL_ID,
        system=[{"text": SYSTEM_PROMPT}],
        messages=[{"role": "user", "content": [{"text": "\n".join(lines)}]}],
        inferenceConfig={"maxTokens": 700, "temperature": 0.2},
    )
    text = "".join(b.get("text", "") for b in res["output"]["message"]["content"])
    start, end = text.find("{"), text.rfind("}")
    try:
        data = json.loads(text[start:end + 1])
    except (ValueError, json.JSONDecodeError):
        return {"matches": [], "tip": text.strip()[:300]}
    by_id = {c["sub"]: c for c in candidates}
    matches = [{"user": by_id[m["id"]], "why": str(m.get("why", ""))[:300]}
               for m in data.get("matches", []) if isinstance(m, dict) and m.get("id") in by_id][:5]
    return {"matches": matches, "tip": str(data.get("tip", ""))[:300]}
