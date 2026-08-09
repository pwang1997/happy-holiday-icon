output "image_bucket_name" {
  description = "Name of the private S3 bucket used for generated images."
  value       = aws_s3_bucket.images.bucket
}

output "image_bucket_arn" {
  description = "ARN of the private S3 bucket used for generated images."
  value       = aws_s3_bucket.images.arn
}

output "image_bucket_region" {
  description = "AWS region containing the image bucket."
  value       = var.aws_region
}

output "image_upload_policy_arn" {
  description = "Attach this policy to the identity used by the Next.js runtime."
  value       = aws_iam_policy.nextjs_s3_upload.arn
}

output "app_environment" {
  description = "Non-secret environment values required by the Next.js runtime."
  value = {
    AWS_REGION    = var.aws_region
    AWS_S3_BUCKET = aws_s3_bucket.images.bucket
  }
}
