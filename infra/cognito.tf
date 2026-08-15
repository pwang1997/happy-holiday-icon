data "aws_caller_identity" "current" {}

locals {
  cognito_user_pool_name   = "${var.project_name}-${var.environment}-users"
  cognito_user_pool_domain = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_cognito_user_pool" "users" {
  name                     = local.cognito_user_pool_name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = var.environment == "prod" ? "ACTIVE" : "INACTIVE"

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.cognito_user_pool_name}-web"
  user_pool_id = aws_cognito_user_pool.users.id

  # This is a public browser client. The application must use PKCE with the
  # authorization-code flow because a browser cannot keep a client secret.
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = var.cognito_callback_urls
  logout_urls                          = var.cognito_logout_urls
  supported_identity_providers         = ["COGNITO"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true

  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_AUTH",
  ]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "web" {
  domain       = local.cognito_user_pool_domain
  user_pool_id = aws_cognito_user_pool.users.id
}
