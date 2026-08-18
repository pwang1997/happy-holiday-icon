output "image_bucket_name" {
  description = "Name of the temporary private S3 bucket used for image ingest."
  value       = aws_s3_bucket.images.bucket
}

output "image_bucket_arn" {
  description = "ARN of the temporary private S3 bucket used for image ingest."
  value       = aws_s3_bucket.images.arn
}

output "final_image_bucket_name" {
  description = "Name of the private S3 bucket used for final images."
  value       = aws_s3_bucket.final_images.bucket
}

output "final_image_bucket_arn" {
  description = "ARN of the private S3 bucket used for final images."
  value       = aws_s3_bucket.final_images.arn
}

output "image_bucket_region" {
  description = "AWS region containing the image bucket."
  value       = var.aws_region
}

output "image_upload_policy_arn" {
  description = "Attach this policy to the identity used by the Next.js runtime."
  value       = aws_iam_policy.nextjs_s3_upload.arn
}

output "image_jobs_table_name" {
  description = "Name of the DynamoDB table used for transient image job status."
  value       = aws_dynamodb_table.image_jobs.name
}

output "image_jobs_table_arn" {
  description = "ARN of the DynamoDB table used for transient image job status."
  value       = aws_dynamodb_table.image_jobs.arn
}

output "image_jobs_policy_arn" {
  description = "Attach this policy to the identity used by the Next.js runtime."
  value       = aws_iam_policy.nextjs_image_jobs.arn
}

output "anonymous_usage_table_name" {
  description = "Name of the DynamoDB table used for anonymous usage limits."
  value       = aws_dynamodb_table.anonymous_usage.name
}

output "anonymous_usage_policy_arn" {
  description = "Attach this policy to the identity used by the Next.js runtime."
  value       = aws_iam_policy.nextjs_anonymous_usage.arn
}

output "image_reshaper_function_name" {
  description = "Name of the Lambda function that reshapes temporary images."
  value       = aws_lambda_function.image_reshaper.function_name
}

output "image_reshaper_function_arn" {
  description = "ARN of the Lambda function that reshapes temporary images."
  value       = aws_lambda_function.image_reshaper.arn
}

output "image_generation_queue_url" {
  description = "URL of the SQS queue receiving temporary source-image upload events."
  value       = aws_sqs_queue.image_generation.url
}

output "image_generation_queue_arn" {
  description = "ARN of the SQS queue receiving temporary source-image upload events."
  value       = aws_sqs_queue.image_generation.arn
}

output "image_generation_dlq_arn" {
  description = "ARN of the dead-letter queue for failed source-image generation events."
  value       = aws_sqs_queue.image_generation_dlq.arn
}

output "image_generator_function_name" {
  description = "Name of the Lambda function that generates an intermediate holiday icon."
  value       = aws_lambda_function.image_generator.function_name
}

output "image_generator_function_arn" {
  description = "ARN of the Lambda function that generates an intermediate holiday icon."
  value       = aws_lambda_function.image_generator.arn
}

output "image_generation_openai_secret_arn" {
  description = "Secrets Manager ARN where the image-generation worker reads OPENAI_API_KEY."
  value       = aws_secretsmanager_secret.openai_api_key.arn
}

output "cognito_user_pool_id" {
  description = "ID of the Cognito user pool used for registered users."
  value       = aws_cognito_user_pool.users.id
}

output "cognito_user_pool_arn" {
  description = "ARN of the Cognito user pool used for registered users."
  value       = aws_cognito_user_pool.users.arn
}

output "cognito_web_client_id" {
  description = "Public OAuth client ID for the browser application."
  value       = aws_cognito_user_pool_client.web.id
}

output "cognito_domain" {
  description = "Cognito managed-login domain."
  value       = "https://${aws_cognito_user_pool_domain.web.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "cognito_issuer" {
  description = "OIDC issuer used to validate Cognito JWTs."
  value       = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.users.id}"
}

output "app_environment" {
  description = "Non-secret environment values required by the Next.js runtime."
  value = {
    AWS_REGION            = var.aws_region
    AWS_S3_BUCKET         = aws_s3_bucket.images.bucket
    AWS_S3_FINAL_BUCKET   = aws_s3_bucket.final_images.bucket
    DYNAMODB_JOBS_TABLE   = aws_dynamodb_table.image_jobs.name
    DYNAMODB_USAGE_TABLE  = aws_dynamodb_table.anonymous_usage.name
    COGNITO_USER_POOL_ID  = aws_cognito_user_pool.users.id
    COGNITO_WEB_CLIENT_ID = aws_cognito_user_pool_client.web.id
    COGNITO_DOMAIN        = "https://${aws_cognito_user_pool_domain.web.domain}.auth.${var.aws_region}.amazoncognito.com"
    COGNITO_ISSUER        = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.users.id}"
  }
}
