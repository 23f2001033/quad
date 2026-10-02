"""Cognito pre-sign-up trigger: only students with a college email address can register."""
import os

ALLOWED = [d.strip().lower().lstrip("@") for d in os.environ.get("ALLOWED_DOMAINS", "").split(",") if d.strip()]


def handler(event, context):
    if event["triggerSource"] == "PreSignUp_AdminCreateUser":
        return event  # admin-created accounts (the demo user) are trusted
    email = event["request"]["userAttributes"].get("email", "").lower()
    domain = email.rsplit("@", 1)[-1]
    if ALLOWED and not any(domain == d or domain.endswith("." + d) for d in ALLOWED):
        allowed = " or ".join("@" + d for d in ALLOWED)
        raise Exception(f"Quad is only for IITM BS students. Please sign up with your {allowed} email")
    return event
