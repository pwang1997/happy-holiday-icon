# Happy Holiday Icon

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
    Lambda[Image reshaper Lambda and Sharp]
    Cognito[Amazon Cognito]
  end

  HCP[HCP Terraform] -. provisions .-> TemporaryS3
  HCP -. provisions .-> FinalS3
  HCP -. provisions .-> Jobs
  HCP -. provisions .-> Usage
  HCP -. provisions .-> Lambda
  HCP -. provisions .-> Cognito

  Browser -->|POST /api/jobs| Next
  Next -->|create UPLOADING job| Jobs
  Next -->|presigned PUT URL| Browser
  Browser -->|PUT uploads source image| TemporaryS3

  Browser -->|POST /api/submit| Next
  Next <-->|PKCE sign-in and access token| Cognito
  Next -->|record usage| Usage
  Next -->|read uploaded source| TemporaryS3
  Next -->|image edit request| OpenAI
  OpenAI -->|generated PNG| Next
  Next -->|PUT images generated icon| TemporaryS3
  Next -->|GENERATING then RESHAPING| Jobs

  TemporaryS3 -->|ObjectCreated under images| Lambda
  Lambda -->|read generated PNG| TemporaryS3
  Lambda -->|write 32, 48, 512 WebP| FinalS3
  Lambda -->|READY or FAILED and derivative keys| Jobs

  Browser -->|poll GET /api/jobs jobId| Next
  Next -->|read job and sign final URLs| Jobs
  Next -->|HEAD and presign GET| FinalS3
  Next -->|status and signed URLs| Browser
```

## API contract

[`openapi.yaml`](openapi.yaml) documents the seven App Router endpoints for **job creation**, **submission**, **polling**, and **Cognito auth**. It includes request schemas, response states, error cases, optional bearer or cookie authentication, and the presigned S3 upload handoff.

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