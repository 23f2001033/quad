# Builder Center submission: copy each field below

## Title  (≤255)
Quad: the campus our online IIT degree doesn't have

## Description  (≤512)
A verified-students-only community for the 30,000+ IIT Madras BS students who study online across India. It has Reddit-style course communities, real-time group chat, DMs, and Amazon Bedrock AI that catches you up on what you missed and finds you teammates. Built solo and shipped on serverless AWS in about 24 hours with Claude Code.

## Cover image
docs/images/cover.png  (1200×675, about 460 KB)

## Tags  (5 max: one category + one lane + three topic tags)
daily-life-enhancement · community · amazon-bedrock · serverless · aws-cdk

## GitHub repository
https://github.com/23f2001033/quad   ← once it's published

## Endpoint / live demo
https://d3sky2k7b1uv30.cloudfront.net

---

## Body (Markdown): paste everything below this line

![Quad: communities, live chat and AI catch-ups for IITM BS students](https://d3sky2k7b1uv30.cloudfront.net/press/cover.png)

**Live app:** https://d3sky2k7b1uv30.cloudfront.net (click **Try the live demo**, no sign-up needed)
**Category:** Daily life enhancement · **Lane:** Community · **Built with:** Claude Code connected to my AWS account

## Why I built this

I'm Aman, a student in the **IIT Madras BS degree** (batch of 2023). It's a fully online degree with over **30,000 active students** spread across India, and we almost never meet. There's no campus, no corridor, no canteen. Our "campus" is hundreds of WhatsApp and Discord groups. Important messages like a quiz date, a notes link or the answer to a graded-assignment doubt get buried under hundreds of messages. Anyone with an invite link can join, including spammers selling "paid help". And unless someone adds you, there's no way to *find* the people taking your course, at your level, or in your city.

**Quad is the campus our online degree doesn't have.** It's a community app that only verified IITM BS students can join.

## What Quad does

| | |
|---|---|
| **Verified students only** | Sign in with your IITM student Google account. A Cognito trigger rejects any address that isn't `@ds.study.iitm.ac.in`. Your batch is read from your roll number (`23f2…` → "2023 · Term 2"), so nobody can fake it. |
| **Reddit-style communities** | Courses, OPPE and end-term prep, hackathons, fests, clubs and city meetups. Posts have titles, **upvotes and downvotes**, **Hot / New / Top** sorting and **threaded replies**, so useful posts rise to the top and stay there. |
| **Live group chat in every community** | A real-time chat sits beside the post feed, for quick questions. Share PDFs, images and notes up to 15 MB. |
| **Direct messages** | Message any verified student without sharing your phone number. |
| **✨ Catch me up** (Amazon Bedrock) | Missed 200 messages? One click gives you the TL;DR, highlights, deadlines, **unanswered questions you could help with**, and the files worth opening. |
| **✨ Find teammates / study partners** (Amazon Bedrock) | Describe what you need ("a UI person and an ML person for a hackathon", "a study partner in Pune") and AI suggests members whose profiles fit, with a reason for each. |
| **Notifications, search, dark mode** | Real-time notifications for replies, search across posts, communities and people, and light and dark themes. It works on phones too. |

![A community: posts with votes on the left, live group chat docked on the right](https://d3sky2k7b1uv30.cloudfront.net/press/screen-community.png)

![Catch me up: AI summary of three days of activity in a study circle](https://d3sky2k7b1uv30.cloudfront.net/press/screen-catchup.png)

![Find teammates: AI suggests members whose skills complement yours](https://d3sky2k7b1uv30.cloudfront.net/press/screen-teammates.png)

![Threaded replies on a post](https://d3sky2k7b1uv30.cloudfront.net/press/screen-thread.png)

## Try it in 60 seconds

1. Open https://d3sky2k7b1uv30.cloudfront.net and click **Try the live demo**.
2. Open **MLT study circle (sample)** and press **✨ Catch me up**, then pick *7 days*.
3. Open **Hackathon teammates (sample)** and press **✨ Find teammates**.
4. Upvote a post, reply to a comment, and send a message in the live chat. Open the site in a second window to watch it arrive in real time.
5. Switch to dark mode with the moon icon in the top bar.

The two sample communities exist so judges can see Quad working. Everything in them is clearly tagged **Sample**, and sample or demo activity is **never counted** in the public usage numbers. The other communities are real ones, created for actual students.

## Architecture: fully serverless on AWS

![Quad architecture on AWS](https://d3sky2k7b1uv30.cloudfront.net/press/architecture.png)

| Layer | Service | Why |
|---|---|---|
| Web app | **Amazon CloudFront + S3** (Origin Access Control) | Fast HTTPS from edge locations in India; the bucket stays private |
| Sign-in | **Amazon Cognito** with Google federation (OAuth 2.0 code flow + PKCE) and a **pre-sign-up Lambda** | Proves the student owns the address; only IITM BS accounts can join |
| API | **API Gateway HTTP API** + Cognito JWT authorizer, throttling | No unauthenticated request reaches the code |
| Real-time | **API Gateway WebSocket API** | Live chat, new posts, replies and notifications |
| Logic | **AWS Lambda** (Python 3.12, arm64/Graviton) | Pay-per-request, nothing to patch |
| Data | **Amazon DynamoDB**: single-table design, one GSI, TTL | Profiles, communities, posts, votes, threaded comments, messages and socket subscriptions |
| Files | **Amazon S3** presigned POST/GET | Browsers upload directly; S3 enforces the 15 MB limit |
| AI | **Amazon Bedrock**: Amazon Nova 2 Lite via the Converse API | Catch me up (~3 s) and Find teammates (~3 s) |
| Secrets | **AWS Secrets Manager** | The demo account's password never leaves the server |
| Infrastructure as code | **AWS CDK (Python)** | The whole stack is one `cdk deploy` |

**Design decisions:**
- **WebSocket auth with one-time tickets.** The browser gets a ticket that expires in 2 minutes from the authenticated HTTP API and opens the socket with it. The ticket can't be reused. This avoids shipping JWT libraries in Lambda.
- **Safe one-click demo.** The server signs the demo account in and returns only an ID token. Visitors can't change the account's password or delete it.
- **Uploads you can't abuse.** S3 enforces the size and content type, and an attachment is accepted only if the uploader owns its key.
- **Responsible AI.** Both prompts must use *only* the given transcript or profiles, return strict JSON, refer to people by name and never assume gender. The UI says "AI can make mistakes".
- **Cost.** Every part is pay-per-request, so idle cost is close to zero. A catch-up uses about 1–2k tokens on Nova 2 Lite, a fraction of a cent. API throttling and size limits keep surprise bills away.

## How a coding agent helped me ship in ~24 hours

**The connection.** I created an IAM user, **`claude-code-agent`**, configured it in the AWS CLI on my laptop, and installed the AWS skills and AWS MCP server for Claude Code. Claude Code then did the AWS work itself: bootstrapping CDK, deploying the stack, testing Bedrock models, configuring Cognito, and pushing updates. Because it used its own identity, **AWS CloudTrail recorded every call it made: 322 API calls, including 116 write actions** across IAM, CloudFormation, Lambda, S3, Cognito and Bedrock. You can check it under CloudTrail → Event history → User name = `claude-code-agent`.

![CloudTrail event history filtered to the agent's IAM user](CLOUDTRAIL_SCREENSHOT)

**What the agent did that a code generator wouldn't:**
- **It pushed back on scope.** My first idea was about five apps in one. The agent argued for a focused version plus one AI feature, and that's why it shipped.
- **It tested before building.** It listed the Bedrock models available to my account, ran live calls against two of them, and chose **Nova 2 Lite**: first-party, covered by credits, about 2 s per call. It also tested the Catch me up prompt on a realistic transcript *before* writing any UI.
- **It debugged a real failure.** In my first real sign-up, the verification email never arrived. The agent checked Cognito, found the account created but `UNCONFIRMED`, and worked out why: university Google Workspace domains often quarantine Cognito's shared sender. It moved Quad to **"Continue with Google"**, which is both a better user experience and stronger verification, within the hour.
- **It checked its own UI.** It drove a headless Chrome to log into the demo and screenshot 9 screens (desktop, mobile, light and dark). From those it found and fixed two CSS class collisions, including one that pushed the chat input off-screen.
- **It caught bias in the AI output.** It noticed the model guessing people's gender from their names ("makes him a great fit") and fixed the prompts.
- **It tests its own work.** A 31-check end-to-end smoke test runs against the live stack after every change and cleans up after itself.

**My part.** I picked the problem and the people it's for, made the product calls (focused scope, Catch me up, a Reddit-style structure, Google sign-in), tested with my real student account, and reviewed every change. The full build log, with timestamps, is in the repo's DEVLOG.md.

## Impact

- **Who it's for:** the 30,000+ active students of an online degree with no physical campus. Peer support is the thing online learners miss most.
- **Measured live:** the landing page shows public counters of students joined, communities created, posts, chat messages, files shared and AI catch-ups. They count real students only; demo and sample activity are excluded.
- **So far:** IMPACT_NUMBERS
- **Next metrics:** time until a doubt gets its first answer, and the share of catch-up "unanswered questions" that get answered afterwards.

## What's next

1. **Ask the files:** answers grounded in the notes and past papers students share, using Amazon Bedrock Knowledge Bases.
2. **Moderation:** report and remove tools, plus Bedrock Guardrails to filter spam and "paid help" sellers.
3. **Email on a custom domain with Amazon SES**, and push notifications for phones.
4. **Open it to the Electronic Systems BS** (`@es.study.iitm.ac.in`) and other online degrees. The domain gate is just configuration.

*Quad is an unofficial student project. It is not affiliated with or endorsed by IIT Madras.*
