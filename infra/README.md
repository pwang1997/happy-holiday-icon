# Terraform infrastructure

This module provisions two private S3 buckets:

- `image_bucket_name` / `AWS_S3_BUCKET`: temporary ingest storage. The browser presign endpoint writes here, and current objects expire after the configured retention period. This is the future source bucket for an image-reshaping Lambda trigger.
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

The Lambda event notification and its dedicated execution policy should be added when the reshaping function exists. This module intentionally does not point an S3 notification at a nonexistent function.
