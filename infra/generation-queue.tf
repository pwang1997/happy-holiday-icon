locals {
  image_generation_queue_name = "${var.project_name}-${var.environment}-image-generation"
}

resource "aws_sqs_queue" "image_generation_dlq" {
  name                      = "${local.image_generation_queue_name}-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true

  tags = {
    ServiceRole = "image-generation-dead-letter"
  }
}

resource "aws_sqs_queue" "image_generation" {
  name                       = local.image_generation_queue_name
  delay_seconds              = 0
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = var.image_generation_visibility_timeout_seconds
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.image_generation_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    ServiceRole = "image-generation-source-events"
  }
}

data "aws_iam_policy_document" "image_generation_queue" {
  statement {
    sid    = "AllowTemporaryImageBucketToSendMessages"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }

    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.image_generation.arn]

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.images.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sqs_queue_policy" "image_generation" {
  queue_url = aws_sqs_queue.image_generation.id
  policy    = data.aws_iam_policy_document.image_generation_queue.json
}
