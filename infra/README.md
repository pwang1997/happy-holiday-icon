# Terraform infrastructure

This module provisions two private S3 buckets:

- `image_bucket_name` / `AWS_S3_BUCKET`: temporary ingest storage. The browser presign endpoint writes here, and current objects expire after the configured retention period. New objects under `images/` trigger the image-reshaping Lambda.
- `final_image_bucket_name` / `AWS_S3_FINAL_BUCKET`: durable final-image storage. `/api/submit` writes generated PNGs here and returns signed download URLs.

Both buckets use public-access blocking, ownership enforcement, versioning, AES-256 encryption, CORS, lifecycle cleanup for incomplete uploads, and TLS-only bucket policies.

## Initialize and apply

From the repository root:

```sh
terraform -chdir=infra init
terraform -chdir=infra validate
terraform -chdir=infra plan
terraform -chdir=infra apply
```

The HCP Terraform workspace stores the state. Set `AWS_REGION`, `AWS_S3_BUCKET`, and `AWS_S3_FINAL_BUCKET` in the Next.js runtime from the Terraform outputs. Do not put AWS credentials in Terraform variables or commit `.env` files.

## Image reshaping Lambda

The `image-reshaper` Lambda reads new objects from the temporary bucket and writes WebP derivatives to the final bucket under `images/<source-name>/<size>.webp`. It creates 32px, 48px, and 512px square outputs when both source dimensions are at least the requested size; smaller sizes are skipped. The function uses Sharp and runs on the Lambda ARM64 architecture.

Rebuild the deployment package after changing the Lambda source or dependencies:

```sh
./infra/lambda/build.sh
```

The generated `infra/lambda/image-reshaper.zip` is the artifact Terraform uploads. Run the build before `terraform plan` so the package exists and its hash reflects the current source.
