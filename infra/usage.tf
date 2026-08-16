resource "aws_dynamodb_table" "anonymous_usage" {
  name         = "${var.project_name}-${var.environment}-anonymous-usage"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "usage_id"

  attribute {
    name = "usage_id"
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
    DataRole = "usage-control"
  }
}
