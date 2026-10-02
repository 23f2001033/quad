"""Enable "Continue with Google" for IITM BS student accounts (idempotent).

Reads the OAuth client downloaded from Google Cloud (google-oauth.json, gitignored), then:
  1. creates/updates the Google identity provider in the Cognito user pool
  2. turns on the OAuth code flow (PKCE) for the web app client, keeping all existing settings
  3. adds the login domain to the site's config.json
The pre-sign-up Lambda still rejects any Google account outside @ds.study.iitm.ac.in.

Usage:  .venv/Scripts/python.exe scripts/setup_google_login.py
"""
import json
import time
import pathlib

import boto3

ROOT = pathlib.Path(__file__).resolve().parent.parent
REGION = "us-east-1"
DOMAIN_PREFIX = "quad-iitmbs"
AUTH_DOMAIN = f"https://{DOMAIN_PREFIX}.auth.{REGION}.amazoncognito.com"

out = json.loads((ROOT / "cdk-outputs.json").read_text())["QuadStack"]
pool_id, app_url = out["UserPoolId"], out["AppUrl"]
google = json.loads((ROOT / "google-oauth.json").read_text())["web"]
cog = boto3.client("cognito-idp", region_name=REGION)

# 1. Google as an identity provider
details = {
    "client_id": google["client_id"],
    "client_secret": google["client_secret"],
    "authorize_scopes": "openid email profile",
}
mapping = {"email": "email", "name": "name", "email_verified": "email_verified", "username": "sub"}
try:
    cog.create_identity_provider(UserPoolId=pool_id, ProviderName="Google", ProviderType="Google",
                                 ProviderDetails=details, AttributeMapping=mapping)
    print("created Google identity provider")
except cog.exceptions.DuplicateProviderException:
    cog.update_identity_provider(UserPoolId=pool_id, ProviderName="Google", ProviderDetails=details, AttributeMapping=mapping)
    print("updated Google identity provider")

# 2. OAuth settings on the existing app client (update_user_pool_client resets anything omitted, so start from the current config)
client_id = next(c["ClientId"] for c in cog.list_user_pool_clients(UserPoolId=pool_id)["UserPoolClients"])
cur = cog.describe_user_pool_client(UserPoolId=pool_id, ClientId=client_id)["UserPoolClient"]
keep = ["ClientName", "RefreshTokenValidity", "AccessTokenValidity", "IdTokenValidity", "TokenValidityUnits",
        "ReadAttributes", "WriteAttributes", "ExplicitAuthFlows", "PreventUserExistenceErrors",
        "EnableTokenRevocation", "EnablePropagateAdditionalUserContextData", "AuthSessionValidity"]
upd = {k: cur[k] for k in keep if k in cur}
upd.update(
    UserPoolId=pool_id, ClientId=client_id,
    SupportedIdentityProviders=["COGNITO", "Google"],
    CallbackURLs=[f"{app_url}/"],
    LogoutURLs=[f"{app_url}/"],
    AllowedOAuthFlows=["code"],
    AllowedOAuthScopes=["openid", "email", "profile"],
    AllowedOAuthFlowsUserPoolClient=True,
)
cog.update_user_pool_client(**upd)
print("app client: OAuth code flow enabled, callback", f"{app_url}/")

# 3. tell the frontend where to send people
s3 = boto3.client("s3", region_name=REGION)
cf = boto3.client("cloudformation", region_name=REGION)
res = {r["LogicalResourceId"]: r["PhysicalResourceId"] for r in cf.describe_stack_resources(StackName="QuadStack")["StackResources"]}
bucket = next(v for k, v in res.items() if k.startswith("SiteE53D"))
cfg = json.loads(s3.get_object(Bucket=bucket, Key="config.json")["Body"].read())
cfg["authDomain"] = AUTH_DOMAIN
s3.put_object(Bucket=bucket, Key="config.json", Body=json.dumps(cfg).encode(), ContentType="application/json")
print("config.json now has authDomain", AUTH_DOMAIN)
cdn = next(v for k, v in res.items() if k.startswith("Cdn"))
boto3.client("cloudfront").create_invalidation(
    DistributionId=cdn,
    InvalidationBatch={"Paths": {"Quantity": 1, "Items": ["/config.json"]}, "CallerReference": f"google-{pool_id}-{len(cfg)}-{time.time()}"},
)
print("CloudFront: config.json refreshed")
