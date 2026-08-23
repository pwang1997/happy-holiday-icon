# Happy Holiday Icon ![Happy Holiday Icon](app/favicon.ico)

<p>
  <a href="https://nextjs.org/"><img alt="Next.js" src="https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&amp;logoColor=white" /></a>
  <a href="https://www.langchain.com/"><img alt="LangChain" src="https://img.shields.io/badge/LangChain-1C3C3C?logo=langchain&amp;logoColor=white" /></a>
  <a href="https://www.terraform.io/"><img alt="Terraform" src="https://img.shields.io/badge/Terraform-7B42BC?logo=terraform&amp;logoColor=white" /></a>
  <a href="https://aws.amazon.com/"><img alt="AWS" src="https://img.shields.io/badge/AWS-232F3E?logo=amazonwebservices&amp;logoColor=FF9900" /></a>
  <a href="https://github.com/pwang1997/happy-holiday-icon/actions/workflows/ci.yml"><img alt="CI test coverage status" src="https://github.com/pwang1997/happy-holiday-icon/actions/workflows/ci.yml/badge.svg?branch=main" /></a>
</p>

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
  Next -->|record usage| Usage
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

[`openapi.yaml`](openapi.yaml) documents the six App Router endpoints for **job admission**, **polling**, and **Cognito auth**. Before OpenAI prompt validation, `POST /api/submit` validates the request, authenticates the caller, and atomically enforces per-caller rate and concurrency limits. It then rejects attempts to override the image-generation instructions, creates the job, records usage, and returns the bounded presigned S3 POST upload handoff.

## Provision infrastructure

The Terraform module is in [`infra/`](infra/README.md). It is configured to use the HCP Terraform organization, project, and `dev` workspace declared in `infra/versions.tf`.

```sh
./infra/lambda/build.sh
terraform -chdir=infra init
terraform -chdir=infra validate
terraform -chdir=infra plan
terraform -chdir=infra apply
```

Configure the Next.js runtime from the `app_environment` Terraform output. Attach `image_upload_policy_arn`, `image_jobs_policy_arn`, `anonymous_usage_policy_arn`, and `submission_guard_policy_arn` to its runtime identity. Set the private `SUBMISSION_GUARD_SECRET` separately. Anonymous submissions require the trusted proxy to remove any client-supplied `X-Submission-Proxy-Token`, inject the configured secret, and supply a sanitized `X-Forwarded-For` header. Terraform configures the Lambda execution role, S3 notification, and Lambda access automatically.

## Test coverage

`pnpm test:coverage` prints Node's line, branch, and function coverage summary. GitHub Actions saves the raw V8 profiles in `coverage/` and uploads them as the `test-coverage` artifact.
