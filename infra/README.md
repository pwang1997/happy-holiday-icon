# Terraform infrastructure

This module provisions two private S3 buckets:

- `image_bucket_name` / `AWS_S3_BUCKET`: temporary ingest storage. Browser source uploads use `uploads/`; generated images use `images/`, which triggers the reshaping Lambda. Both prefixes expire after the configured retention period.
- `final_image_bucket_name` / `AWS_S3_FINAL_BUCKET`: durable final-image storage. The Lambda writes the WebP derivatives here.

It also provisions `image_jobs_table_name` / `DYNAMODB_JOBS_TABLE`, an on-demand DynamoDB table for transient image job status. Store the status in a `status` attribute and the Unix epoch expiration time in `expires_at`; TTL cleanup is enabled for that attribute.

It provisions `anonymous_usage_table_name` / `DYNAMODB_USAGE_TABLE`, an on-demand DynamoDB table that records usage for anonymous sessions and authenticated Cognito users. Its conditional counter enforces five anonymous trials per session. The cookie stores only an opaque session identifier; it does not store usage counts.

It provisions a Cognito user pool and public OAuth web client for the eventual
login/wallet entitlement flow. The client uses authorization-code flow and has
no client secret; the application must use PKCE during sign-in. Configure
`cognito_callback_urls` and `cognito_logout_urls` with the exact deployed
application URLs before applying.

It also provisions an encrypted SQS source-image queue and dead-letter queue.
Object-created events under `uploads/` in the temporary bucket are delivered to
the queue. The queue policy accepts messages only from this bucket and AWS
account. Generated objects under `images/` continue to invoke the reshaping
Lambda directly; source uploads never invoke Sharp resizing.

The queue invokes the `image-generator` Lambda one message at a time. It reads
the source object and job instructions, calls the OpenAI image-edit API, and
writes the generated PNG under `images/<jobId>/generated.png`. The existing
reshape Lambda receives that generated object. The worker is limited by
`image_generation_reserved_concurrency`, uses an SQS dead-letter queue after
five unhandled delivery failures, and creates CloudWatch alarms for worker
errors, dead-letter messages, and source-message age. Configure
`image_generation_alarm_actions` with notification targets such as an SNS topic
before production use.

Terraform creates an empty Secrets Manager secret for the worker. After the
first apply, set either a raw API key or a JSON value containing
`OPENAI_API_KEY`; never put it in Terraform variables or state:

```sh
aws secretsmanager put-secret-value \
  --secret-id "$(terraform -chdir=infra output -raw image_generation_openai_secret_arn)" \
  --secret-string '{"OPENAI_API_KEY":"replace-me"}'
```

Both buckets use public-access blocking, ownership enforcement, versioning, AES-256 encryption, CORS, lifecycle cleanup for incomplete uploads, and TLS-only bucket policies.

## Initialize and apply

From the repository root:

```sh
terraform -chdir=infra init
terraform -chdir=infra validate
terraform -chdir=infra plan
terraform -chdir=infra apply
```

The HCP Terraform workspace stores the state. Set `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_S3_FINAL_BUCKET`, `IMAGE_MAX_UPLOAD_BYTES`, `DYNAMODB_JOBS_TABLE`, `DYNAMODB_USAGE_TABLE`, `COGNITO_USER_POOL_ID`, `COGNITO_WEB_CLIENT_ID`, `COGNITO_DOMAIN`, and `COGNITO_ISSUER` in the Next.js runtime from the Terraform outputs. The app uses `/api/auth/login`, `/auth/callback`, and `/api/auth/logout` for the Cognito authorization-code flow. Attach `image_jobs_policy_arn` and `anonymous_usage_policy_arn` to the Next.js runtime identity. Do not put AWS credentials in Terraform variables or commit `.env` files.

## Application contract for asynchronous generation

`POST /api/submit` authenticates and reserves usage before it creates a
DynamoDB job, then returns `202 Accepted`, the job ID, and a constrained
presigned POST upload instruction.
S3 rejects source uploads outside `max_source_image_bytes` (10 MiB by default),
and the generator independently verifies size, format, dimensions, and the
event's exact object version before it reads the object body. The job
record must persist `prompt` and `style`, and the source key must be
`uploads/<jobId>/source.<extension>`. Once the browser uploads that source,
the worker claims `UPLOADING -> GENERATING`, writes
`images/<jobId>/generated.png`, and hands it to the reshape Lambda. The polling
endpoint authorizes the job owner before returning status or signed URLs.

## Image reshaping Lambda

The `image-reshaper` Lambda reads generated objects from the temporary bucket
and writes WebP derivatives to the final bucket under
`images/<jobId>-holiday-icon/<size>.webp`. It creates 32px, 48px, and 512px
square outputs when both source dimensions are at least the requested size;
smaller sizes are skipped. The function uses Sharp and runs on the Lambda ARM64
architecture.

Rebuild the deployment packages after changing either Lambda source or dependencies:

```sh
./infra/lambda/build.sh
```

The generated `infra/lambda/image-reshaper.zip` and
`infra/lambda/image-generator.zip` artifacts are what Terraform uploads. Run
the build before `terraform plan` so the packages exist and their hashes reflect
the current source.
