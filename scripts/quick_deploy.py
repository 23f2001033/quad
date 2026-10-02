"""Fast code-only deploy (no CDK synth): push backend/ to the Lambdas and frontend/ to S3, then refresh CloudFront.

Infrastructure changes still need `cdk deploy`. Usage:  .venv/Scripts/python.exe scripts/quick_deploy.py [backend|frontend]
"""
import io
import mimetypes
import pathlib
import sys
import time
import zipfile

import boto3

ROOT = pathlib.Path(__file__).resolve().parent.parent
REGION = "us-east-1"
cf = boto3.client("cloudformation", region_name=REGION)
res = {r["LogicalResourceId"]: r["PhysicalResourceId"]
       for r in cf.describe_stack_resources(StackName="QuadStack")["StackResources"]}


def find(prefix):
    return next(v for k, v in res.items() if k.startswith(prefix))


def deploy_backend():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in (ROOT / "backend").glob("*.py"):
            z.write(f, f.name)
    lam = boto3.client("lambda", region_name=REGION)
    for prefix in ("ApiFn", "WsFn", "PreSignUpFn"):
        name = find(prefix)
        lam.update_function_code(FunctionName=name, ZipFile=buf.getvalue())
        lam.get_waiter("function_updated_v2").wait(FunctionName=name)
        print("updated", name)


def deploy_frontend():
    s3 = boto3.client("s3", region_name=REGION)
    bucket = find("SiteE53D")
    for f in (ROOT / "frontend").rglob("*"):
        if f.is_file():
            key = f.relative_to(ROOT / "frontend").as_posix()
            ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
            if f.suffix == ".js":
                ctype = "text/javascript"
            s3.put_object(Bucket=bucket, Key=key, Body=f.read_bytes(), ContentType=ctype)
            print("uploaded", key)
    boto3.client("cloudfront").create_invalidation(
        DistributionId=find("Cdn"),
        InvalidationBatch={"Paths": {"Quantity": 1, "Items": ["/*"]}, "CallerReference": str(time.time())},
    )
    print("CloudFront cache invalidated")


what = sys.argv[1] if len(sys.argv) > 1 else "all"
if what in ("all", "backend"):
    deploy_backend()
if what in ("all", "frontend"):
    deploy_frontend()
