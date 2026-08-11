resource "aws_dynamodb_table" "image_jobs" {
  name         = "${var.project_name}-${var.environment}-image-jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "job_id"

  attribute {
    name = "job_id"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    DataRole = "transient-job-status"
  }
}
