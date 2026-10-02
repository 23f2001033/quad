# Proof: coding agent connected to AWS

Quad was built and deployed by **Claude Code** working through a dedicated IAM user, `claude-code-agent`.
Every API call the agent made is recorded by AWS CloudTrail under that identity, so this report comes from AWS's own audit log.

- Identity used by the agent: `arn:aws:iam::2301••••30:user/claude-code-agent`
- CloudTrail events recorded for this identity: **322** (02 Oct 14:18 → 02 Oct 16:58 IST)
- Write actions (create / update / invoke): **116**

## Calls per AWS service

| Service | Calls |
|---|---|
| iam | 62 |
| cloudformation | 56 |
| s3 | 48 |
| kms | 47 |
| lambda | 44 |
| sts | 24 |
| ecr | 13 |
| cognito-idp | 7 |
| ssm | 6 |
| cloudtrail | 6 |
| cloudfront | 5 |
| bedrock | 4 |

## What the agent changed (write actions)

| Action | Count |
|---|---|
| `kms:Decrypt` | 47 |
| `sts:AssumeRole` | 18 |
| `lambda:UpdateFunctionCode20150331v2` | 15 |
| `iam:CreateRole` | 5 |
| `cloudfront:CreateInvalidation` | 5 |
| `iam:PutRolePolicy` | 4 |
| `bedrock:Converse` | 3 |
| `iam:AttachRolePolicy` | 3 |
| `cloudformation:CreateChangeSet` | 1 |
| `cloudformation:ExecuteChangeSet` | 1 |
| `ssm:PutParameter` | 1 |
| `ecr:PutLifecyclePolicy` | 1 |
| `ecr:SetRepositoryPolicy` | 1 |
| `ecr:CreateRepository` | 1 |
| `s3:CreateBucket` | 1 |
| `s3:PutBucketVersioning` | 1 |
| `s3:PutBucketLifecycle` | 1 |
| `s3:PutBucketEncryption` | 1 |
| `s3:PutBucketPublicAccessBlock` | 1 |
| `s3:PutBucketPolicy` | 1 |
| `cognito-idp:AdminConfirmSignUp` | 1 |
| `cognito-idp:AdminUpdateUserAttributes` | 1 |
| `cognito-idp:AdminGetUser` | 1 |
| `cognito-idp:CreateUserPoolDomain` | 1 |

## First 15 write actions (timeline)

| Time (IST) | Action | Resource |
|---|---|---|
| 02 Oct 14:18:17 | `Converse` |  |
| 02 Oct 14:18:19 | `Converse` |  |
| 02 Oct 14:19:27 | `CreateChangeSet` | CDKToolkit |
| 02 Oct 14:19:35 | `ExecuteChangeSet` | CDKToolkit |
| 02 Oct 14:19:38 | `PutParameter` |  |
| 02 Oct 14:19:38 | `PutLifecyclePolicy` | cdk-hnb659fds-container-assets-230148048430-us-east-1 |
| 02 Oct 14:19:38 | `SetRepositoryPolicy` | cdk-hnb659fds-container-assets-230148048430-us-east-1 |
| 02 Oct 14:19:38 | `CreateRepository` | cdk-hnb659fds-container-assets-230148048430-us-east-1 |
| 02 Oct 14:19:39 | `AttachRolePolicy` | arn:aws:iam::aws:policy/ReadOnlyAccess |
| 02 Oct 14:19:39 | `CreateRole` | AROATLFPEQYXGHQDU6KWA |
| 02 Oct 14:19:39 | `PutRolePolicy` | LookupRolePolicy |
| 02 Oct 14:19:40 | `CreateBucket` | cdk-hnb659fds-assets-230148048430-us-east-1 |
| 02 Oct 14:19:40 | `PutBucketVersioning` | cdk-hnb659fds-assets-230148048430-us-east-1 |
| 02 Oct 14:19:40 | `CreateRole` | arn:aws:iam::230148048430:role/cdk-hnb659fds-image-publishin |
| 02 Oct 14:19:40 | `PutBucketLifecycle` | cdk-hnb659fds-assets-230148048430-us-east-1 |

Regenerate with `python scripts/agent_proof.py`. Check it yourself in the AWS Console: CloudTrail → Event history → filter **User name** = `claude-code-agent`.
