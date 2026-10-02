# Quad build log

How Quad went from zero to shipped in about 24 hours. It was built by one student working with Claude Code, a coding agent connected to the AWS account. Times are IST.

## Sep 28: reading the brief
- I gave the agent the hackathon rules. Its main takeaways:
  - The ship gate is pass/fail, so deploy something live early.
  - An AI scorer visits the URL, so the landing page has to be readable without logging in, and there must be a demo that needs no sign-up.
  - Half of the Round 1 criteria are about storytelling and communication, so keep a build log from day one.

## Oct 2, 12:35: about 24 hours left
- The agent installed the AWS CLI (`winget install Amazon.AWSCLI`) and set up the git repo, with a `.gitignore` that keeps secrets out.
- Plan for AWS access: a dedicated IAM user called `claude-code-agent`. Every resource the agent creates is then recorded in CloudTrail under that name, which proves the agent connection.

## 12:50: choosing what to build
- My idea was a community app for my college: sign-up with student email, DMs, group chat with file sharing, communities for subjects, hackathons and events, posts, and friends.
- The agent pushed back on scope: "that's roughly 5 apps; trying all of them risks a broken app at the deadline". It suggested a focused version:
  - Cut friend requests and notifications. Any verified student can message anyone.
  - Add one AI feature so it isn't just a WhatsApp clone.
- I picked the focused version, with **✨ Catch me up** (an AI summary of what you missed in a group) as the AI feature.

## 13:00: making it about IIT Madras BS
- My college is the IIT Madras BS degree. It's online, with 30–40k students across India and no physical campus. Student emails look like `23f2001033@ds.study.iitm.ac.in`: `23` is the year you joined, and `f2` is term 2 of 3.
- The agent then:
  - locked sign-up to `@ds.study.iitm.ac.in` with a Cognito pre-sign-up Lambda trigger
  - reads each student's batch from their roll number ("2023 · Term 2"), so nobody can fake it
  - replaced "branch/year" with **level** (Foundation / Diploma / BSc / BS) and **city**, which matter in an online degree
  - rewrote the landing page around "the campus our online degree doesn't have"
  - added an "unofficial, not affiliated with IIT Madras" notice

## 13:00–15:30: building the backend and infrastructure
Architecture, all defined in AWS CDK (Python):

| Layer | AWS service | Why |
|---|---|---|
| Website | S3 + CloudFront (OAC) | Fast in India, private bucket |
| Sign-up / login | Amazon Cognito + pre-sign-up Lambda | Email verification and a student-email-only gate |
| API | API Gateway HTTP API + Cognito JWT authorizer | The API never sees an unauthenticated request |
| Live chat | API Gateway WebSocket API | Real-time messages, posts and comments |
| Logic | AWS Lambda (Python 3.12, arm64) | Serverless, near-zero cost while idle |
| Data | DynamoDB (single table + 1 GSI, TTL) | Profiles, communities, posts, comments, likes, messages, sockets |
| Files | S3 presigned POST (15 MB limit enforced by S3) | Browsers upload directly; Lambda never handles file bytes |
| AI | Amazon Bedrock (Converse API) | ✨ Catch me up |
| Secrets | Secrets Manager | Demo account password stays on the server |

Design decisions the agent made, and why:
- **WebSocket auth uses one-time tickets.** The browser gets a ticket that expires in 2 minutes from the authenticated HTTP API, then opens the socket with it. That avoids bundling JWT libraries into Lambda.
- **Safe one-click demo for judges.** The server logs into a shared demo account and returns only an ID token. Visitors can't change its password or delete it, because those calls need the password or an access token, which they never get.
- **Uploads only through S3 presigned POST.** S3 itself enforces the 15 MB limit and content type. Attachments are only accepted if the key belongs to the uploader.
- **Sample data is clearly labelled.** Seeded demo content shows a "Sample" tag and isn't counted in the public usage stats, so the impact numbers are real.
- **Catch me up prompt:** Bedrock is told to use only facts in the transcript and to return strict JSON (TL;DR, highlights, deadlines, unanswered questions, files, mood). The UI shows an "AI can make mistakes" note.

Bugs the agent caught along the way:
- A scripted edit on Windows saved `·` in the cp1252 encoding, which broke UTF-8 parsing. It was found by a syntax check and fixed byte-for-byte.
- The CDK `logRetention` API is deprecated, so it was replaced with explicit LogGroups.
- `pyflakes` found unused imports. `node --check` validated the frontend.

## 14:30: live on AWS
- `cdk deploy` created the whole stack in about 6 minutes: https://d3sky2k7b1uv30.cloudfront.net
- Picking a model: the agent listed the Bedrock inference profiles available to the account and ran a live test of Nova 2 Lite and Nova Pro. It chose **Amazon Nova 2 Lite** (first-party, so covered by credits, and about 2 s per call).
- Before writing UI around Catch me up, the agent tested the prompt on a realistic transcript. The output was clean JSON, with no invented facts, in 3.4 s.
- A smoke test ([scripts/smoke_test.py](scripts/smoke_test.py)) passed **23/23** checks against the live stack. It cleans up after itself and never changes the public stats.
- Problem: on my laptop, `cdk synth` hit a Windows `MemoryError` because RAM was nearly full. The agent wrote [scripts/quick_deploy.py](scripts/quick_deploy.py), which pushes code-only changes straight to Lambda and S3 and refreshes CloudFront in about 20 s.

## 14:40: first real user test failed, and we fixed it
- I signed up with my real student email. **The verification code never arrived**, even after resending.
- The agent's diagnosis: Cognito *had* created the account (`UNCONFIRMED`), but the code came from Cognito's shared sender `no-reply@verificationemail.com`, and university Google Workspace domains often quarantine that address. With 30k students this would break sign-up for everyone.
- Fix: **"Continue with Google"**. IITM BS student addresses are Google Workspace accounts, so Google can prove a student owns their address with one click. This is a better user experience *and* stronger verification than an email code.
  - It uses a Cognito hosted login domain with Google as the identity provider, and the authorization code + PKCE flow in the browser, with no SDK.
  - The same pre-sign-up Lambda still rejects any Google account outside `@ds.study.iitm.ac.in`.
  - Email and password stays available as a fallback.

## 15:50–16:15: redesign, and Quad becomes "Reddit for IITM BS"
I asked for a cleaner look and a Reddit-style structure. In about 25 minutes the agent shipped:
- **Design system:** the Inter font; light and dark themes from one set of CSS tokens, with a toggle that defaults to the system setting and applies before first paint so there's no flash; Lucide-style SVG icons instead of emoji; a top bar with search, a left nav, and a right rail.
- **Reddit-style posts:** posts now have titles; there are **upvotes and downvotes**, **Hot / New / Top** sorting (Hot uses Reddit's score-decays-with-age idea), a home feed from *your* communities and a *Popular* feed from all of them, and post pages with **threaded replies**. Deleting a comment leaves a `[deleted]` placeholder so the thread still makes sense.
- **Live chat docked beside the feed** on desktop, and a tab on mobile.
- **The features cut earlier:** 🔔 real-time **notifications** (replies and new members), 🔎 **search** across posts, communities and people, and delete for your own posts, comments and messages (community owners can remove posts).
- **✨ Find teammates / study partners**, a second Bedrock feature: describe what you need, and Nova ranks the community's members using only their profiles.
- The smoke test grew to **31/31 passing checks**.

**Visual QA by the agent:** I can't look over its shoulder, so it drove my installed Chrome headlessly (`puppeteer-core`) to log into the demo and screenshot 9 screens: desktop and mobile, light and dark. Looking at the screenshots, it found and fixed:
- two **CSS class-name collisions**: the landing page's `.chat` and `.block` classes were also matching app components, which made a preview card 604 px tall and pushed the docked chat's input off-screen
- the DM pane height not matching the list
- the floating "+" button covering the chat input on mobile
- "1 comments" grammar
