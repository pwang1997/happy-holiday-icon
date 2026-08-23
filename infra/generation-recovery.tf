locals {
  image_generation_recovery_function_name = "${var.project_name}-${var.environment}-image-generation-recovery"
  image_generation_recovery_package_path  = "${path.module}/lambda/image-generation-recovery.zip"
}

data "aws_iam_policy_document" "image_generation_recovery_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "image_generation_recovery" {
  name               = local.image_generation_recovery_function_name
  assume_role_policy = data.aws_iam_policy_document.image_generation_recovery_assume_role.json
}

resource "aws_iam_role_policy" "image_generation_recovery" {
  name = "${local.image_generation_recovery_function_name}-runtime"
  role = aws_iam_role.image_generation_recovery.id

  policy = jsonencode({
    Version = "2012-10-17"

    Statement = [
      {
        Sid    = "RecoverExpiredGenerationLeases"
        Effect = "Allow"
        Action = [
          "dynamodb:Query",
          "dynamodb:UpdateItem",
        ]
        Resource = [
          aws_dynamodb_table.image_jobs.arn,
          "${aws_dynamodb_table.image_jobs.arn}/index/generation-recovery",
        ]
      },
      {
        Sid      = "ScheduleGenerationRetries"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.image_generation.arn
      },
      {
        Sid      = "ReplayExpiredReshapingLeases"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.image_reshaper.arn
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "image_generation_recovery_logs" {
  role       = aws_iam_role.image_generation_recovery.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "image_generation_recovery" {
  name              = "/aws/lambda/${local.image_generation_recovery_function_name}"
  retention_in_days = var.image_generation_log_retention_days
}

resource "aws_lambda_function" "image_generation_recovery" {
  function_name = local.image_generation_recovery_function_name
  role          = aws_iam_role.image_generation_recovery.arn
  runtime       = "nodejs22.x"
  handler       = "index.handler"

  architectures = ["arm64"]
  filename      = local.image_generation_recovery_package_path

  source_code_hash = filebase64sha256(local.image_generation_recovery_package_path)

  memory_size = 256
  timeout     = 30

  environment {
    variables = {
      DYNAMODB_JOBS_TABLE                 = aws_dynamodb_table.image_jobs.name
      GENERATION_LEASE_SECONDS            = var.image_generation_timeout_seconds + var.image_generation_lease_grace_seconds
      GENERATION_MAX_RETRIES              = var.image_generation_max_retries
      GENERATION_RECOVERY_INDEX           = "generation-recovery"
      GENERATION_RETRY_BASE_DELAY_SECONDS = var.image_generation_retry_base_delay_seconds
      IMAGE_GENERATION_QUEUE_URL          = aws_sqs_queue.image_generation.url
      IMAGE_RESHAPER_FUNCTION_NAME        = aws_lambda_function.image_reshaper.function_name
      RESHAPING_LEASE_SECONDS             = var.image_reshaping_timeout_seconds + var.image_reshaping_lease_grace_seconds
      RESHAPING_MAX_RETRIES               = var.image_reshaping_max_retries
      RESHAPING_RETRY_BASE_DELAY_SECONDS  = var.image_reshaping_retry_base_delay_seconds
      SOURCE_BUCKET                       = aws_s3_bucket.images.bucket
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.image_generation_recovery,
    aws_iam_role_policy_attachment.image_generation_recovery_logs,
  ]
}

resource "aws_cloudwatch_event_rule" "image_generation_recovery" {
  name                = "${local.image_generation_recovery_function_name}-schedule"
  description         = "Recover expired image-generation leases."
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "image_generation_recovery" {
  rule = aws_cloudwatch_event_rule.image_generation_recovery.name
  arn  = aws_lambda_function.image_generation_recovery.arn
}

resource "aws_lambda_permission" "image_generation_recovery_from_eventbridge" {
  statement_id  = "AllowScheduledGenerationRecovery"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.image_generation_recovery.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.image_generation_recovery.arn
}

resource "aws_cloudwatch_metric_alarm" "image_generation_recovery_errors" {
  alarm_name          = "${local.image_generation_recovery_function_name}-errors"
  alarm_description   = "The image-generation recovery worker could not process expired leases."
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
    FunctionName = aws_lambda_function.image_generation_recovery.function_name
  }
}
