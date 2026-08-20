# Happy Holiday Icon ![Happy Holiday Icon](app/happy-holiday-icon.ico)

Happy Holiday Icon turns an uploaded PNG, JPEG, or WebP image into a holiday vibed icon, then produces optimized WebP derivatives at 32px, 48px, and 512px. 

## Run

```
git clone https://github.com/pwang1997/happy-holiday-icon.git
cd happy-holiday-icon
pnpm install
pnpm run dev
```
The command starts the Web UI, served at http://127.0.0.1:3000 by default.

## Architecture

```mermaid
flowchart LR
  Browser[Browser]
  Next[Next.js App Router]
  OpenAI[OpenAI image generation]

  subgraph AWS[AWS provisioned by Terraform]
    TemporaryS3[Temporary S3 bucket]
    FinalS3[Final S3 bucket]
    Jobs[(DynamoDB image jobs)]
    Usage[(DynamoDB usage)]
    Queue[SQS image-generation queue]
    Generator[Image-generator Lambda]
    Recovery[Scheduled generation-recovery Lambda]
    Reshaper[Image-reshaper Lambda and Sharp]
    Secrets[Secrets Manager]
    Cognito[Amazon Cognito]
  end

  HCP[HCP Terraform] -. provisions .-> TemporaryS3
  HCP -. provisions .-> FinalS3
  HCP -. provisions .-> Jobs
  HCP -. provisions .-> Usage
  HCP -. provisions .-> Queue
  HCP -. provisions .-> Generator
  HCP -. provisions .-> Recovery
  HCP -. provisions .-> Reshaper
  HCP -. provisions .-> Secrets
  HCP -. provisions .-> Cognito

  Browser -->|POST /api/submit| Next
  Next <-->|PKCE sign-in and access token| Cognito
  Next -->|reserve usage| Usage
  Next -->|create UPLOADING job| Jobs
  Next -->|bounded presigned POST form| Browser
  Browser -->|POST source image| TemporaryS3

  TemporaryS3 -->|ObjectCreated under uploads| Queue
  Queue -->|source event| Generator
  Generator -->|read exact object version| TemporaryS3
  Generator -->|read API key| Secrets
  Generator -->|image edit request| OpenAI
  OpenAI -->|generated PNG| Generator
  Generator -->|write generated PNG; RESHAPING| TemporaryS3
  Jobs -->|expired GENERATING lease| Recovery
  Recovery -->|three delayed retries| Queue
  Recovery -->|FAILED after final retry| Jobs

  TemporaryS3 -->|ObjectCreated under images| Reshaper
  Reshaper -->|read generated PNG| TemporaryS3
  Reshaper -->|write 32, 48, 512 WebP| FinalS3
  Reshaper -->|READY or FAILED and derivative keys| Jobs

  Browser -->|poll GET /api/jobs jobId| Next
  Next -->|read job and sign final URLs| Jobs
  Next -->|HEAD and presign GET| FinalS3
  Next -->|status and signed URLs| Browser
```

## API contract

[`openapi.yaml`](openapi.yaml) documents the six App Router endpoints for **job admission**, **polling**, and **Cognito auth**. It includes request schemas, response states, error cases, optional bearer or cookie authentication, and the bounded presigned S3 POST upload handoff.

## Provision infrastructure

The Terraform module is in [`infra/`](infra/README.md). It is configured to use the HCP Terraform organization, project, and `dev` workspace declared in `infra/versions.tf`.

```sh
./infra/lambda/build.sh
terraform -chdir=infra init
terraform -chdir=infra validate
terraform -chdir=infra plan
terraform -chdir=infra apply
```

Configure the Next.js runtime from the `app_environment` Terraform output. Attach `image_upload_policy_arn`, `image_jobs_policy_arn`, and `anonymous_usage_policy_arn` to its runtime identity. Terraform configures the Lambda execution role, S3 notification, and Lambda access automatically.
