locals {
  image_generator_function_name = "${var.project_name}-${var.environment}-image-generator"
  image_generator_package_path  = "${path.module}/lambda/image-generator.zip"
  openai_api_key_secret_name    = "${var.project_name}/${var.environment}/openai-api-key"
}

resource "aws_secretsmanager_secret" "openai_api_key" {
  name        = local.openai_api_key_secret_name
  description = "OpenAI API key for the asynchronous image-generation worker."
}

data "aws_iam_policy_document" "image_generator_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "image_generator" {
  name               = local.image_generator_function_name
  assume_role_policy = data.aws_iam_policy_document.image_generator_assume_role.json
}

resource "aws_iam_role_policy" "image_generator" {
  name = "${local.image_generator_function_name}-runtime"
  role = aws_iam_role.image_generator.id

  policy = jsonencode({
    Version = "2012-10-17"

    Statement = [
      {
        Sid    = "ConsumeAndRetrySourceImageEvents"
        Effect = "Allow"
        Action = [
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ReceiveMessage",
          "sqs:SendMessage",
        ]
        Resource = aws_sqs_queue.image_generation.arn
      },
      {
        Sid      = "ReadUploadedSources"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = "${aws_s3_bucket.images.arn}/uploads/*"
      },
      {
        Sid      = "WriteGeneratedImages"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.images.arn}/images/*"
      },
      {
        Sid    = "ReadAndUpdateImageJobs"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
        ]
        Resource = aws_dynamodb_table.image_jobs.arn
      },
      {
        Sid      = "ReadImageGenerationCredential"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.openai_api_key.arn
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "image_generator_logs" {
  role       = aws_iam_role.image_generator.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "image_generator" {
  name              = "/aws/lambda/${local.image_generator_function_name}"
  retention_in_days = var.image_generation_log_retention_days
}

resource "aws_lambda_function" "image_generator" {
  function_name = local.image_generator_function_name
  role          = aws_iam_role.image_generator.arn
  runtime       = "nodejs22.x"
  handler       = "index.handler"

  architectures = ["arm64"]
  filename      = local.image_generator_package_path

  source_code_hash = filebase64sha256(local.image_generator_package_path)

  memory_size = 1024
  timeout     = var.image_generation_timeout_seconds

  environment {
    variables = {
      DYNAMODB_JOBS_TABLE         = aws_dynamodb_table.image_jobs.name
      IMAGE_GENERATION_BACKGROUND = var.image_generation_background
      IMAGE_GENERATION_MODEL      = var.image_generation_model
      GENERATION_LEASE_SECONDS    = var.image_generation_timeout_seconds + var.image_generation_lease_grace_seconds
      GENERATION_MAX_RETRIES      = var.image_generation_max_retries
      MAX_SOURCE_IMAGE_BYTES      = var.max_source_image_bytes
      MAX_SOURCE_IMAGE_DIMENSION  = var.max_source_image_dimension
      MAX_SOURCE_IMAGE_PIXELS     = var.max_source_image_pixels
      OPENAI_API_KEY_SECRET_ARN   = aws_secretsmanager_secret.openai_api_key.arn
      RESHAPING_LEASE_SECONDS     = var.image_reshaping_timeout_seconds + var.image_reshaping_lease_grace_seconds
      SOURCE_BUCKET               = aws_s3_bucket.images.bucket
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.image_generator,
    aws_iam_role_policy_attachment.image_generator_logs,
  ]
}

resource "aws_lambda_event_source_mapping" "image_generator" {
  event_source_arn = aws_sqs_queue.image_generation.arn
  function_name    = aws_lambda_function.image_generator.arn
  batch_size       = 1

  function_response_types = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = var.image_generation_reserved_concurrency
  }
}

resource "aws_cloudwatch_metric_alarm" "image_generation_dlq_messages" {
  alarm_name          = "${local.image_generator_function_name}-dlq-messages"
  alarm_description   = "Image-generation source events have reached the dead-letter queue."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.image_generation_alarm_actions

  dimensions = {
    QueueName = aws_sqs_queue.image_generation_dlq.name
  }
}

resource "aws_cloudwatch_metric_alarm" "image_generator_errors" {
  alarm_name          = "${local.image_generator_function_name}-errors"
  alarm_description   = "The image-generation worker returned an unhandled error."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.image_generation_alarm_actions

  dimensions = {
    FunctionName = aws_lambda_function.image_generator.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "image_generation_queue_age" {
  alarm_name          = "${local.image_generator_function_name}-queue-age"
  alarm_description   = "A source-image event has waited over five minutes for generation."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 300
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.image_generation_alarm_actions

  dimensions = {
    QueueName = aws_sqs_queue.image_generation.name
  }
}
