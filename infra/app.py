#!/usr/bin/env python3
import os

import aws_cdk as cdk

from quad_stack import QuadStack

app = cdk.App()
QuadStack(
    app, "QuadStack",
    env=cdk.Environment(account=os.environ.get("CDK_DEFAULT_ACCOUNT"), region=os.environ.get("CDK_DEFAULT_REGION", "us-east-1")),
    description="Quad - a verified community app for college students (Zero to Shipped hackathon)",
)
cdk.Tags.of(app).add("project", "quad")
app.synth()
