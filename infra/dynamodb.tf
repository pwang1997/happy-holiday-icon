resource "aws_dynamodb_table" "image_jobs" {
  name         = "${var.project_name}-${var.environment}-image-jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "job_id"

  attribute {
    name = "job_id"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "owner_id"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "N"
  }

  attribute {
    name = "generation_retry_at"
    type = "N"
  }

  global_secondary_index {
    name            = "generation-recovery"
    projection_type = "ALL"

    key_schema {
      attribute_name = "status"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "generation_retry_at"
      key_type       = "RANGE"
    }
  }

  global_secondary_index {
    name            = "owner-created-at"
    projection_type = "ALL"

    key_schema {
      attribute_name = "owner_id"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "created_at"
      key_type       = "RANGE"
    }
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
