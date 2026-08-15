resource "aws_iam_policy" "nextjs_s3_upload" {
  name        = "${var.project_name}-${var.environment}-s3-upload"
  description = "Allow the Next.js runtime to create image objects in the private image bucket."

  policy = jsonencode({
    Version = "2012-10-17"

    Statement = [
      {
        Sid    = "TemporaryImages"
        Effect = "Allow"

        Action = [
          "s3:PutObject",
          "s3:GetObject",
        ]

        Resource = [
          "${aws_s3_bucket.images.arn}/images/*",
          "${aws_s3_bucket.images.arn}/uploads/*",
        ]
      },
      {
        Sid    = "FinalImages"
        Effect = "Allow"

        Action = [
          "s3:PutObject",
          "s3:GetObject",
        ]

        Resource = "${aws_s3_bucket.final_images.arn}/images/*"
      },
    ]
  })
}

resource "aws_iam_policy" "nextjs_image_jobs" {
  name        = "${var.project_name}-${var.environment}-image-jobs"
  description = "Allow the Next.js runtime to manage transient image job status."

  policy = jsonencode({
    Version = "2012-10-17"

    Statement = [
      {
        Sid    = "ImageJobs"
        Effect = "Allow"

        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
        ]

        Resource = aws_dynamodb_table.image_jobs.arn
      },
    ]
  })
}

resource "aws_iam_policy" "nextjs_anonymous_usage" {
  name        = "${var.project_name}-${var.environment}-anonymous-usage"
  description = "Allow the Next.js runtime to enforce anonymous image usage limits."

  policy = jsonencode({
    Version = "2012-10-17"

    Statement = [
      {
        Sid    = "AnonymousUsage"
        Effect = "Allow"

        Action = [
          "dynamodb:UpdateItem",
        ]

        Resource = aws_dynamodb_table.anonymous_usage.arn
      },
    ]
  })
}
