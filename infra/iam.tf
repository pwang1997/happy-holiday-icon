resource "aws_iam_policy" "nextjs_s3_upload" {
  name        = "${var.project_name}-${var.environment}-s3-upload"
  description = "Allow the Next.js runtime to create image objects in the private image bucket."

  policy = jsonencode({
    Version = "2012-10-17"

    Statement = [
      {
        Effect = "Allow"

        Action = [
          "s3:PutObject",
          "s3:GetObject",
        ]

        Resource = "${aws_s3_bucket.images.arn}/images/*"
      }
    ]
  })
}
