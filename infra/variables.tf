variable "project_name" {
  type    = string
  default = "happy-holiday-icon"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]+[a-z0-9]$", var.project_name))
    error_message = "project_name must contain only lowercase letters, numbers, and hyphens."
  }
}

variable "environment" {
  type    = string
  default = "dev"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]*$", var.environment))
    error_message = "environment must contain only lowercase letters, numbers, and hyphens."
  }
}

variable "aws_region" {
  type    = string
  default = "ca-central-1"
}

variable "allowed_origins" {
  type = list(string)

  default = [
    "http://localhost:3000",
    "https://happy-holiday-icon.vercel.app",
  ]

  validation {
    condition     = length(var.allowed_origins) > 0
    error_message = "allowed_origins must contain at least one browser origin."
  }
}

variable "force_destroy" {
  type        = bool
  description = "Delete all bucket objects when Terraform destroys the bucket. Keep false outside disposable environments."
  default     = false
}

variable "temporary_object_retention_days" {
  type        = number
  description = "Number of days to retain current objects in the temporary ingest bucket."
  default     = 7

  validation {
    condition     = var.temporary_object_retention_days > 0
    error_message = "temporary_object_retention_days must be greater than zero."
  }
}

variable "cognito_callback_urls" {
  type        = list(string)
  description = "OAuth callback URLs allowed by the Cognito web client."

  default = [
    "http://localhost:3000/auth/callback",
    "https://happy-holiday-icon.vercel.app/auth/callback",
  ]

  validation {
    condition     = length(var.cognito_callback_urls) > 0
    error_message = "cognito_callback_urls must contain at least one callback URL."
  }
}

variable "cognito_logout_urls" {
  type        = list(string)
  description = "Logout redirect URLs allowed by the Cognito web client."

  default = [
    "http://localhost:3000",
    "https://happy-holiday-icon.vercel.app",
  ]

  validation {
    condition     = length(var.cognito_logout_urls) > 0
    error_message = "cognito_logout_urls must contain at least one logout URL."
  }
}
