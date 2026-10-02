"""Seed Quad with starter communities and clearly-labelled sample content for the demo account.

Usage:  .venv/Scripts/python.exe scripts/seed.py
Safe to re-run: items are keyed deterministically, so re-running overwrites instead of duplicating.
Sample content never touches the public usage stats.
"""
import json
import time
import urllib.request

import boto3
import pymupdf

REGION = "us-east-1"
STACK = "QuadStack"
NOW = int(time.time() * 1000)
H = 3600 * 1000

cf = boto3.client("cloudformation", region_name=REGION)
outputs = {o["OutputKey"]: o["OutputValue"] for o in cf.describe_stacks(StackName=STACK)["Stacks"][0]["Outputs"]}
table = boto3.resource("dynamodb", region_name=REGION).Table(outputs["TableName"])
s3 = boto3.client("s3", region_name=REGION)
BUCKET = outputs["UploadsBucket"]
API = outputs["ApiUrl"]


def sid(ms, n):
    """Deterministic time-sortable id so re-seeding overwrites."""
    return f"{ms:013d}{n:08x}"


def http(method, path, token=None, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", token)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


PEOPLE = {
    "sample-ananya": ("Ananya R", "Diploma in Data Science", "2024 · Term 1", "Bengaluru", ["Python", "Pandas", "ML"]),
    "sample-rohit": ("Rohit K", "Diploma in Programming", "2023 · Term 3", "Patna", ["Flask", "SQL", "Vue"]),
    "sample-meera": ("Meera S", "BSc", "2022 · Term 2", "Chennai", ["ML", "Statistics", "PyTorch"]),
    "sample-arjun": ("Arjun M", "Foundation", "2025 · Term 3", "Pune", ["Python", "Excel"]),
    "sample-zoya": ("Zoya F", "Diploma in Data Science", "2024 · Term 2", "Lucknow", ["Data viz", "SQL", "Tableau"]),
    "sample-vikram": ("Vikram P", "BS", "2021 · Term 1", "Hyderabad", ["AWS", "Docker", "React"]),
}


def seed_people():
    for sub, (name, level, batch, city, skills) in PEOPLE.items():
        table.put_item(Item={
            "pk": f"USER#{sub}", "sk": "PROFILE", "sub": sub, "email": f"{sub}@example.invalid", "name": name,
            "level": level, "batch": batch, "city": city, "skills": skills, "sample": True,
            "bio": "Sample profile used to demo Quad.", "createdAt": NOW - 96 * H,
            "gsi1pk": "USERS", "gsi1sk": name.lower(),
        })


def make_pdf(title, lines):
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((56, 72), title, fontsize=18)
    y = 110
    for line in lines:
        page.insert_text((56, y), line, fontsize=11)
        y += 20
    data = doc.tobytes()
    doc.close()
    return data


def upload_sample_file(sub, name, data, ctype="application/pdf"):
    key = f"u/{sub}/seed/{name}"
    s3.put_object(Bucket=BUCKET, Key=key, Body=data, ContentType=ctype)
    return {"key": key, "name": name, "size": len(data), "type": ctype}


def community(cid, name, ctype, desc, owner=None, members=(), sample=False, created=NOW - 120 * H):
    owner_name = PEOPLE[owner][0] if owner else "Quad team"
    table.put_item(Item={
        "pk": f"COMM#{cid}", "sk": "META", "cid": cid, "name": name, "description": desc, "type": ctype,
        "createdBy": owner or "quad", "createdByName": owner_name, "createdAt": created,
        "memberCount": len(members), "sample": sample, "gsi1pk": "COMMS", "gsi1sk": f"{created:013d}",
    })
    for sub in members:
        table.put_item(Item={
            "pk": f"COMM#{cid}", "sk": f"MEMBER#{sub}", "sub": sub, "name": PEOPLE[sub][0],
            "role": "owner" if sub == owner else "member", "joinedAt": created, "lastSeen": NOW, "prevSeen": NOW,
        })
        table.put_item(Item={"pk": f"USER#{sub}", "sk": f"COMM#{cid}", "cid": cid, "name": name, "type": ctype, "joinedAt": created})


def post(cid, n, hours_ago, author, text, attachments=(), likes=0, comments=()):
    ms = NOW - int(hours_ago * H)
    pid = sid(ms, n)
    table.put_item(Item={
        "pk": f"COMM#{cid}", "sk": f"POST#{pid}", "pid": pid, "cid": cid, "author": author,
        "authorName": PEOPLE[author][0], "authorLevel": PEOPLE[author][1], "text": text,
        "attachments": list(attachments), "likeCount": likes, "commentCount": len(comments),
        "createdAt": ms, "sample": True,
    })
    for i, (c_author, c_text) in enumerate(comments):
        cms = ms + (i + 1) * 20 * 60 * 1000
        cmid = sid(cms, n * 100 + i)
        table.put_item(Item={
            "pk": f"POST#{pid}", "sk": f"C#{cmid}", "cmid": cmid, "pid": pid, "author": c_author,
            "authorName": PEOPLE[c_author][0], "text": c_text, "createdAt": cms, "sample": True,
        })


def chat(conv, start_hours_ago, lines, base_n):
    """lines: (minutes_after_start, author, text[, attachment])"""
    start = NOW - int(start_hours_ago * H)
    for i, line in enumerate(lines):
        minutes, author, text = line[:3]
        ms = start + int(minutes * 60 * 1000)
        mid = sid(ms, base_n + i)
        table.put_item(Item={
            "pk": f"CONV#{conv}", "sk": f"MSG#{mid}", "mid": mid, "conv": conv, "sender": author,
            "senderName": PEOPLE[author][0], "text": text, "attachments": [line[3]] if len(line) > 3 else [],
            "createdAt": ms, "sample": True,
        })


def seed_mlt():
    cid = "sample-mlt"
    members = ["sample-meera", "sample-ananya", "sample-rohit", "sample-arjun", "sample-zoya"]
    community(cid, "MLT study circle (sample)", "subject",
              "Sample community showing how Quad works: a study circle for Machine Learning Techniques. "
              "Revision sessions, doubts, notes. Everything here is demo content.",
              owner="sample-meera", members=members, sample=True)
    cheat = upload_sample_file("sample-ananya", "PCA_kernelPCA_cheatsheet.pdf", make_pdf("PCA & Kernel PCA: cheat sheet (sample)", [
        "1. Centre the data: subtract the mean of each feature.",
        "2. Covariance C = (1/n) X^T X ; PCs are eigenvectors of C.",
        "3. Variance explained by PC k = lambda_k / sum(lambda).",
        "4. Kernel PCA: replace X X^T with kernel matrix K, centre K.",
        "5. Polynomial kernel: k(x, y) = (1 + x.y)^d ; RBF: exp(-||x-y||^2 / 2s^2)",
        "6. Pick k components to keep ~95% variance.",
        "Sample file created for the Quad demo.",
    ]))
    pyq = upload_sample_file("sample-meera", "Quiz1_practice_questions.pdf", make_pdf("Quiz 1 practice set (sample)", [
        "Q1. Show that the first principal component maximises projected variance.",
        "Q2. Run two iterations of K-means on the given 6 points.",
        "Q3. When does kernel PCA with a linear kernel equal PCA?",
        "Q4. MLE of the mean of a Gaussian from n samples.",
        "Sample file created for the Quad demo.",
    ]))
    post(cid, 1, 70, "sample-meera",
         "📌 Quiz 1 revision session this Saturday, 8 PM on Google Meet (link will be posted in the group chat an hour before).\n"
         "We'll cover weeks 1–4: PCA, kernel PCA, K-means and estimation. Comment the topics you're stuck on 👇",
         likes=14, comments=[
             ("sample-ananya", "Kernel centring please! The K~ = K - 1K - K1 + 1K1 step confuses me every time."),
             ("sample-arjun", "Can a Foundation student join just to listen? 😅"),
             ("sample-meera", "@Arjun of course, everyone's welcome."),
             ("sample-rohit", "K-means++ initialisation and why it helps."),
         ])
    post(cid, 46, 46, "sample-ananya",
         "Made a 2-page PCA + kernel PCA cheat sheet from the lectures. All formulas in one place. Hope it helps for Quiz 1!",
         attachments=[cheat], likes=22, comments=[
             ("sample-zoya", "This is gold, thank you!!"),
             ("sample-meera", "Pinning this in the revision session 🙌"),
         ])
    post(cid, 20, 20, "sample-arjun",
         "Foundation student here, planning to take MLT in a later term. Which courses should I finish first so it isn't too hard?",
         likes=3, comments=[
             ("sample-meera", "MLF first, definitely. Brush up on Maths 2 linear algebra (eigenvalues!) too."),
         ])
    post(cid, 5, 5, "sample-meera", "Practice questions for Saturday. Try them before the session so we can discuss.",
         attachments=[pyq], likes=9)

    conv = f"c_{cid}"
    chat(conv, 50, [
        (0, "sample-rohit", "anyone done GA week 5? Q7 answer isn't matching for me"),
        (4, "sample-zoya", "which one, the variance explained one?"),
        (5, "sample-rohit", "yes, I'm getting 0.82 but the options are 0.78 / 0.86 / 0.91"),
        (9, "sample-ananya", "you have to centre the data first. I made the same mistake, it comes to 0.86"),
        (10, "sample-rohit", "omg yes. thanks Ananya 🙏"),
        (60, "sample-arjun", "hi all, Foundation student lurking here. Hope that's ok"),
        (62, "sample-meera", "welcome Arjun! 👋"),
        (300, "sample-zoya", "GA week 5 deadline is this Sunday 11:59 PM right? not Friday?"),
        (304, "sample-ananya", "Sunday, but submit early, the portal was super slow last week"),
        (900, "sample-meera", "reminder: revision session Saturday 8 PM. I'll share the Meet link here an hour before"),
        (902, "sample-rohit", "will it be recorded? I have office till 8:30"),
        (1300, "sample-ananya", "sharing my cheat sheet here too", cheat),
        (1302, "sample-zoya", "🔥🔥"),
        (1500, "sample-arjun", "Does kernel PCA always need the full n×n kernel matrix? Seems really expensive for big datasets"),
        (2100, "sample-rohit", "Is the bonus GA counted in the 'best 5 of 7' for the final score, or added separately?"),
        (2400, "sample-zoya", "also does anyone have a study partner for weekly mock tests? I'm in Lucknow, happy to do it online"),
        (2405, "sample-ananya", "I'm in! Let's do Sunday mornings?"),
        (2406, "sample-zoya", "deal 🤝"),
        (2700, "sample-meera", "Practice questions are up in the posts tab. Please try Q2 (K-means by hand) before Saturday"),
        (2850, "sample-rohit", "Q3 is tricky. Linear kernel kernel-PCA = PCA only if you centre K, right?"),
        (2856, "sample-meera", "exactly, centre K and it's identical. Good catch"),
    ], base_n=1000)
    return cid


def seed_hackathon():
    cid = "sample-hack"
    members = ["sample-vikram", "sample-zoya", "sample-rohit", "sample-ananya", "sample-meera"]
    community(cid, "Hackathon teammates (sample)", "hackathon",
              "Sample community showing how Quad works: find teammates across levels and cities for hackathons. Everything here is demo content.",
              owner="sample-vikram", members=members, sample=True)
    post(cid, 3, 60, "sample-vikram",
         "🏆 Looking for 2 teammates for an AWS hackathon (deadline in ~10 days).\n"
         "I can do AWS + backend (Lambda, DynamoDB). Looking for one UI person and one ML person.\n"
         "Idea: an AI planner that makes a personal OPPE prep schedule. DM me!",
         likes=11, comments=[
             ("sample-zoya", "I can do UI + data viz. DMing you."),
             ("sample-ananya", "ML person here, interested! What model are you thinking?"),
         ])
    post(cid, 4, 30, "sample-rohit",
         "Is anyone forming a team for the college fest coding contest? I'm a Flask + Vue person (MAD 1 & 2 done).",
         likes=4)
    chat(f"c_{cid}", 30, [
        (0, "sample-vikram", "team so far: me (backend), Zoya (UI), Ananya (ML). Need a name 😄"),
        (3, "sample-zoya", "'Prep Pilot'?"),
        (5, "sample-ananya", "Prep Pilot it is"),
        (90, "sample-vikram", "plan: Fri = architecture, Sat = build, Sun = demo video + writeup"),
        (95, "sample-ananya", "I'll prototype the scheduling prompt on Bedrock tonight"),
        (400, "sample-zoya", "first Figma draft is ready. Do we want dark mode? 🌚"),
        (402, "sample-vikram", "yes, if it doesn't eat time"),
        (700, "sample-rohit", "do you need a 4th member for testing? happy to help"),
        (705, "sample-vikram", "max team size is 3 for this one sorry Rohit 🙏 but join us for the fest contest!"),
        (1500, "sample-ananya", "Which region are we deploying in? us-east-1 has more Bedrock models"),
    ], base_n=2000)
    return cid


STARTERS = [
    ("mlt", "MLT: Machine Learning Techniques", "subject", "Doubts, notes, GA discussions and quiz/end-term prep for MLT."),
    ("mad1", "MAD 1: project help", "subject", "Flask, Jinja, SQLite. Stuck on your MAD 1 project? Ask here and share what worked."),
    ("pdsa", "PDSA: Python DSA", "subject", "Programming, Data Structures and Algorithms using Python: problems, OPPE practice, tips."),
    ("oppe", "OPPE prep circle", "subject", "Practise for OPPEs together: timed mock sessions, previous patterns, last-minute doubts."),
    ("foundation", "Foundation level help desk", "subject", "New to the BS degree? Maths, Stats, CT, English and Python, asked and answered by seniors."),
    ("hack", "Hackathon team finder", "hackathon", "Post your idea and the skills you need, and find teammates from every level and city."),
    ("blr", "Bengaluru meetups", "other", "IITM BS students in Bengaluru: study meetups, exam-centre carpools, coffee."),
    ("del", "Delhi NCR meetups", "other", "IITM BS students in Delhi NCR: study meetups and exam-day plans."),
    ("chn", "Chennai meetups", "other", "IITM BS students in Chennai: campus visits, study meetups, exam-centre help."),
]


def seed_starters():
    for i, (slug, name, ctype, desc) in enumerate(STARTERS):
        cid = f"starter-{slug}"
        existing = table.get_item(Key={"pk": f"COMM#{cid}", "sk": "META"}).get("Item")
        if existing:
            continue  # don't reset member counts of real communities
        community(cid, name, ctype, desc, created=NOW - (10 + i) * 60 * 1000)


def seed_demo_user(sample_cids):
    token = http("POST", "/api/public/demo")["idToken"]
    me = http("GET", "/api/me", token)
    demo = me["sub"]
    for cid in sample_cids:
        http("POST", f"/api/communities/{cid}/join", token)
        # pretend the demo visitor last visited 3 days ago so "since my last visit" has something to summarise
        table.update_item(Key={"pk": f"COMM#{cid}", "sk": f"MEMBER#{demo}"},
                          UpdateExpression="SET prevSeen=:p", ExpressionAttributeValues={":p": NOW - 72 * H})
    other = "sample-meera"
    conv = "d_" + "_".join(sorted([demo, other]))
    ms = NOW - 2 * H
    mid = sid(ms, 9000)
    text = "Hey! Saw you joined the MLT circle 👋 Are you coming to Saturday's revision session? (This is a sample DM for the demo.)"
    table.put_item(Item={"pk": f"CONV#{conv}", "sk": f"MSG#{mid}", "mid": mid, "conv": conv, "sender": other,
                         "senderName": PEOPLE[other][0], "text": text, "attachments": [], "createdAt": ms, "sample": True})
    table.put_item(Item={"pk": f"USER#{demo}", "sk": f"DM#{other}", "other": other, "otherName": PEOPLE[other][0],
                         "lastText": text[:120], "lastAt": ms, "unread": 1})
    table.put_item(Item={"pk": f"USER#{other}", "sk": f"DM#{demo}", "other": demo, "otherName": "Demo Visitor",
                         "lastText": text[:120], "lastAt": ms, "unread": 0})
    return demo


if __name__ == "__main__":
    seed_people()
    sample = [seed_mlt(), seed_hackathon()]
    seed_starters()
    demo = seed_demo_user(sample)
    print(f"Seeded {len(PEOPLE)} sample people, {len(sample)} sample communities, {len(STARTERS)} starter communities. Demo user: {demo}")
    print("App:", outputs["AppUrl"])
