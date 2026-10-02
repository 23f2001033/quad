"""Quad on AWS: CloudFront + S3 site, Cognito, HTTP & WebSocket APIs, Lambda, DynamoDB, S3 uploads, Bedrock."""
from pathlib import Path

from aws_cdk import (
    CfnOutput, Duration, RemovalPolicy, Stack,
    aws_apigatewayv2 as apigw,
    aws_apigatewayv2_authorizers as authz,
    aws_apigatewayv2_integrations as integ,
    aws_cloudfront as cf,
    aws_cloudfront_origins as origins,
    aws_cognito as cognito,
    aws_dynamodb as ddb,
    aws_iam as iam,
    aws_lambda as _lambda,
    aws_logs as logs,
    aws_s3 as s3,
    aws_s3_deployment as s3deploy,
    aws_secretsmanager as sm,
)
from constructs import Construct

ROOT = Path(__file__).resolve().parent.parent


class QuadStack(Stack):
    def __init__(self, scope: Construct, cid: str, **kwargs) -> None:
        super().__init__(scope, cid, **kwargs)

        allowed_domains = self.node.try_get_context("allowedDomains") or ""
        model_id = self.node.try_get_context("modelId") or "us.amazon.nova-2-lite-v1:0"
        demo_email = "demo@quad.demo"

        # ---------- data ----------
        table = ddb.Table(
            self, "Table",
            partition_key=ddb.Attribute(name="pk", type=ddb.AttributeType.STRING),
            sort_key=ddb.Attribute(name="sk", type=ddb.AttributeType.STRING),
            billing_mode=ddb.BillingMode.PAY_PER_REQUEST,
            time_to_live_attribute="ttl",
            removal_policy=RemovalPolicy.DESTROY,
        )
        table.add_global_secondary_index(
            index_name="gsi1",
            partition_key=ddb.Attribute(name="gsi1pk", type=ddb.AttributeType.STRING),
            sort_key=ddb.Attribute(name="gsi1sk", type=ddb.AttributeType.STRING),
        )

        uploads = s3.Bucket(
            self, "Uploads",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            cors=[s3.CorsRule(
                allowed_methods=[s3.HttpMethods.POST, s3.HttpMethods.GET],
                allowed_origins=["*"], allowed_headers=["*"], max_age=3000,
            )],
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )

        demo_secret = sm.Secret(
            self, "DemoPassword",
            description="Password of the shared Quad demo account (never sent to browsers)",
            generate_secret_string=sm.SecretStringGenerator(exclude_punctuation=True, password_length=24),
        )

        code = _lambda.Code.from_asset(str(ROOT / "backend"), exclude=["__pycache__", "*.pyc"])

        def fn(name, handler, timeout=10, memory=512, env=None):
            return _lambda.Function(
                self, name,
                runtime=_lambda.Runtime.PYTHON_3_12,
                architecture=_lambda.Architecture.ARM_64,
                handler=handler, code=code,
                timeout=Duration.seconds(timeout), memory_size=memory,
                environment=env or {},
                log_group=logs.LogGroup(self, f"{name}Logs", retention=logs.RetentionDays.TWO_WEEKS,
                                        removal_policy=RemovalPolicy.DESTROY),
            )

        # ---------- auth: college email only ----------
        presignup = fn("PreSignUpFn", "auth_trigger.handler", env={"ALLOWED_DOMAINS": allowed_domains})
        pool = cognito.UserPool(
            self, "Users",
            self_sign_up_enabled=True,
            sign_in_aliases=cognito.SignInAliases(email=True),
            auto_verify=cognito.AutoVerifiedAttrs(email=True),
            standard_attributes=cognito.StandardAttributes(fullname=cognito.StandardAttribute(required=True, mutable=True)),
            password_policy=cognito.PasswordPolicy(min_length=8, require_digits=True, require_lowercase=True,
                                                   require_uppercase=False, require_symbols=False),
            account_recovery=cognito.AccountRecovery.EMAIL_ONLY,
            user_verification=cognito.UserVerificationConfig(
                email_subject="Your Quad verification code",
                email_body="Welcome to Quad! Your verification code is {####}",
                email_style=cognito.VerificationEmailStyle.CODE,
            ),
            lambda_triggers=cognito.UserPoolTriggers(pre_sign_up=presignup),
            removal_policy=RemovalPolicy.DESTROY,
        )
        # "Continue with Google": the Google IdP and the quad-iitmbs login domain are created by
        # scripts/setup_google_login.py (it needs the OAuth secret, which never goes into code)
        app_url = self.node.try_get_context("appUrl") or ""
        auth_domain = self.node.try_get_context("authDomain") or ""
        oauth = cognito.OAuthSettings(
            flows=cognito.OAuthFlows(authorization_code_grant=True),
            scopes=[cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
            callback_urls=[f"{app_url}/"], logout_urls=[f"{app_url}/"],
        ) if app_url and auth_domain else None
        client = pool.add_client(
            "WebClient",
            auth_flows=cognito.AuthFlow(user_password=True, admin_user_password=True),
            o_auth=oauth,
            supported_identity_providers=[cognito.UserPoolClientIdentityProvider.COGNITO, cognito.UserPoolClientIdentityProvider.GOOGLE] if oauth else None,
            generate_secret=False,
            prevent_user_existence_errors=True,
            id_token_validity=Duration.hours(8),
            access_token_validity=Duration.hours(8),
            refresh_token_validity=Duration.days(30),
        )

        # ---------- realtime: WebSocket API ----------
        ws_fn = fn("WsFn", "ws.handler", env={"TABLE_NAME": table.table_name})
        table.grant_read_write_data(ws_fn)
        ws_api = apigw.WebSocketApi(
            self, "Ws",
            connect_route_options=apigw.WebSocketRouteOptions(integration=integ.WebSocketLambdaIntegration("WsConnect", ws_fn)),
            disconnect_route_options=apigw.WebSocketRouteOptions(integration=integ.WebSocketLambdaIntegration("WsDisconnect", ws_fn)),
            default_route_options=apigw.WebSocketRouteOptions(integration=integ.WebSocketLambdaIntegration("WsDefault", ws_fn)),
        )
        ws_stage = apigw.WebSocketStage(
            self, "WsStage", web_socket_api=ws_api, stage_name="live", auto_deploy=True,
            throttle=apigw.ThrottleSettings(rate_limit=50, burst_limit=100),
        )

        # ---------- HTTP API ----------
        api_fn = fn("ApiFn", "api.handler", timeout=29, memory=1024, env={
            "TABLE_NAME": table.table_name,
            "UPLOADS_BUCKET": uploads.bucket_name,
            "WS_CALLBACK_URL": ws_stage.callback_url,
            "MODEL_ID": model_id,
            "USER_POOL_ID": pool.user_pool_id,
            "CLIENT_ID": client.user_pool_client_id,
            "DEMO_EMAIL": demo_email,
            "DEMO_SECRET_ARN": demo_secret.secret_arn,
        })
        table.grant_read_write_data(api_fn)
        uploads.grant_read_write(api_fn)
        demo_secret.grant_read(api_fn)
        ws_api.grant_manage_connections(api_fn)
        api_fn.add_to_role_policy(iam.PolicyStatement(
            actions=["cognito-idp:AdminInitiateAuth", "cognito-idp:AdminCreateUser", "cognito-idp:AdminSetUserPassword"],
            resources=[pool.user_pool_arn],
        ))
        api_fn.add_to_role_policy(iam.PolicyStatement(
            actions=["bedrock:InvokeModel", "bedrock:Converse"],
            resources=[
                "arn:aws:bedrock:*::foundation-model/*",
                f"arn:aws:bedrock:*:{self.account}:inference-profile/*",
            ],
        ))

        http = apigw.HttpApi(
            self, "Http",
            create_default_stage=False,
            cors_preflight=apigw.CorsPreflightOptions(
                allow_origins=["*"],
                allow_methods=[apigw.CorsHttpMethod.ANY],
                allow_headers=["Authorization", "Content-Type"],
                max_age=Duration.hours(1),
            ),
        )
        apigw.HttpStage(
            self, "HttpStage", http_api=http, stage_name="$default", auto_deploy=True,
            throttle=apigw.ThrottleSettings(rate_limit=100, burst_limit=200),
        )
        api_integration = integ.HttpLambdaIntegration("ApiIntegration", api_fn)
        user_auth = authz.HttpUserPoolAuthorizer("CollegeAuth", pool, user_pool_clients=[client])
        http.add_routes(
            path="/api/{proxy+}",
            methods=[apigw.HttpMethod.GET, apigw.HttpMethod.POST, apigw.HttpMethod.PUT, apigw.HttpMethod.DELETE],
            integration=api_integration, authorizer=user_auth,
        )
        http.add_routes(path="/api/public/stats", methods=[apigw.HttpMethod.GET], integration=api_integration)
        http.add_routes(path="/api/public/demo", methods=[apigw.HttpMethod.POST], integration=api_integration)

        # ---------- website: S3 + CloudFront ----------
        site = s3.Bucket(
            self, "Site",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )
        dist = cf.Distribution(
            self, "Cdn",
            default_root_object="index.html",
            default_behavior=cf.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_control(site),
                viewer_protocol_policy=cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=cf.CachePolicy.CACHING_OPTIMIZED,
                response_headers_policy=cf.ResponseHeadersPolicy.SECURITY_HEADERS,
                compress=True,
            ),
            price_class=cf.PriceClass.PRICE_CLASS_200,  # includes edge locations in India
        )
        s3deploy.BucketDeployment(
            self, "DeploySite",
            sources=[
                s3deploy.Source.asset(str(ROOT / "frontend")),
                s3deploy.Source.json_data("config.json", {
                    "apiUrl": http.api_endpoint,
                    "wsUrl": ws_stage.url,
                    "region": self.region,
                    "userPoolId": pool.user_pool_id,
                    "clientId": client.user_pool_client_id,
                    "allowedDomains": [d.strip() for d in allowed_domains.split(",") if d.strip()],
                    "authDomain": auth_domain,
                }),
            ],
            destination_bucket=site,
            distribution=dist,
            distribution_paths=["/*"],
            memory_limit=256,
        )

        CfnOutput(self, "AppUrl", value=f"https://{dist.distribution_domain_name}")
        CfnOutput(self, "ApiUrl", value=http.api_endpoint)
        CfnOutput(self, "WsUrl", value=ws_stage.url)
        CfnOutput(self, "TableName", value=table.table_name)
        CfnOutput(self, "UploadsBucket", value=uploads.bucket_name)
        CfnOutput(self, "UserPoolId", value=pool.user_pool_id)
