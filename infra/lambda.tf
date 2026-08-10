locals {
  image_reshaper_function_name = "${var.project_name}-${var.environment}-image-reshaper"
  image_reshaper_package_path  = "${path.module}/lambda/image-reshaper.zip"
}

data "aws_iam_policy_document" "image_reshaper_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "image_reshaper" {
  name               = local.image_reshaper_function_name
  assume_role_policy = data.aws_iam_policy_document.image_reshaper_assume_role.json
}

resource "aws_iam_role_policy" "image_reshaper_s3" {
  name = "${local.image_reshaper_function_name}-s3"
  role = aws_iam_role.image_reshaper.id

  policy = jsonencode({
    Version = "2012-10-17"

    Statement = [
      {
        Sid    = "ReadTemporaryImages"
        Effect = "Allow"

        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.images.arn}/images/*"
      },
      {
        Sid    = "WriteFinalImages"
        Effect = "Allow"

        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.final_images.arn}/images/*"
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "image_reshaper_logs" {
  role       = aws_iam_role.image_reshaper.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "image_reshaper" {
  function_name = local.image_reshaper_function_name
  role          = aws_iam_role.image_reshaper.arn
  runtime       = "nodejs22.x"
  handler       = "index.handler"

  architectures = ["arm64"]
  filename      = local.image_reshaper_package_path

  source_code_hash = filebase64sha256(local.image_reshaper_package_path)

  memory_size = 1024
  timeout     = 60

  environment {
    variables = {
      SOURCE_BUCKET      = aws_s3_bucket.images.bucket
      DESTINATION_BUCKET = aws_s3_bucket.final_images.bucket
    }
  }

  depends_on = [aws_iam_role_policy_attachment.image_reshaper_logs]
}

resource "aws_lambda_permission" "image_reshaper_from_s3" {
  statement_id  = "AllowImageBucketInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.image_reshaper.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.images.arn
}

resource "aws_s3_bucket_notification" "images" {
  bucket = aws_s3_bucket.images.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.image_reshaper.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "images/"
  }

  depends_on = [aws_lambda_permission.image_reshaper_from_s3]
}
