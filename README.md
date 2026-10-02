# Quad: the campus our online degree doesn't have

Quad is a community app only for verified students of the **IIT Madras BS degree**, an online program with 30,000+ students spread across India.
Students sign up with their `@ds.study.iitm.ac.in` email. Then they can join or create communities for courses, exam prep, hackathons, fests and city meetups. Each community has:

- a **post feed** with likes and comments, for things that shouldn't get buried in chat
- a **real-time group chat** with file sharing (PDFs, images, up to 15 MB)
- **direct messages** between any two verified students
- **✨ Catch me up**: one click, and Amazon Bedrock lists the highlights, deadlines, unanswered questions and files you missed

Batch is read from the roll number (`23f2…` → "2023 · Term 2"). Profiles show level (Foundation → BS) and city, so students can find study partners and teammates in an online degree with no physical campus.

> Unofficial student project, not affiliated with IIT Madras. Built for the AWS Builder Center *Zero to Shipped* hackathon.

## Architecture

```
Browser ──► CloudFront ──► S3 (static site, private, OAC)
   │
   ├──► Cognito user pool ◄── pre-sign-up Lambda (student-email gate)
   │
   ├──► API Gateway HTTP API ──(Cognito JWT authorizer)──► Lambda "api" ──► DynamoDB (single table)
   │                                                         │   ├──► S3 uploads (presigned POST/GET)
   │                                                         │   ├──► Amazon Bedrock (Nova 2 Lite) — Catch me up
   │                                                         │   ├──► Secrets Manager (demo account)
   │                                                         │   └──► WebSocket management API (push)
   └──► API Gateway WebSocket API ──► Lambda "ws" ──► DynamoDB (connections, channel subscriptions)
```

Everything is in [infra/quad_stack.py](infra/quad_stack.py) (AWS CDK, Python). Every part is serverless and pay-per-request, so it costs close to nothing while idle.

| Path | What |
|---|---|
| [backend/api.py](backend/api.py) | HTTP API: profiles, communities, posts, comments, likes, chat, DMs, uploads, demo login |
| [backend/ws.py](backend/ws.py) | WebSocket connect/disconnect/watch, with one-time ticket auth |
| [backend/catchup.py](backend/catchup.py) | ✨ Catch me up: gathers activity and summarises it with Bedrock as strict JSON |
| [backend/auth_trigger.py](backend/auth_trigger.py) | Cognito pre-sign-up trigger: student emails only |
| [frontend/](frontend/) | Dependency-free SPA (HTML/CSS/JS) |
| [scripts/seed.py](scripts/seed.py) | Starter communities, plus clearly-labelled sample content for the demo |
| [DEVLOG.md](DEVLOG.md) | How it was built with a coding agent connected to AWS |

## Deploy

```bash
python -m venv .venv && .venv/Scripts/pip install aws-cdk-lib constructs boto3 pymupdf
cd infra
npx aws-cdk@latest bootstrap        # once per account/region
npx aws-cdk@latest deploy QuadStack --outputs-file ../cdk-outputs.json
cd .. && .venv/Scripts/python scripts/seed.py
```

Set `allowedDomains` and `modelId` in [infra/cdk.json](infra/cdk.json).
