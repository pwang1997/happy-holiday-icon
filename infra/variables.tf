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

variable "max_source_image_bytes" {
  type        = number
  description = "Maximum byte size accepted for one browser-uploaded source image."
  default     = 10485760

  validation {
    condition     = var.max_source_image_bytes >= 1024 && var.max_source_image_bytes <= 26214400
    error_message = "max_source_image_bytes must be between 1 KiB and 25 MiB."
  }
}

variable "max_source_image_dimension" {
  type        = number
  description = "Maximum width or height accepted for one source image."
  default     = 4096

  validation {
    condition     = var.max_source_image_dimension >= 32 && var.max_source_image_dimension <= 16384
    error_message = "max_source_image_dimension must be between 32 and 16384 pixels."
  }
}

variable "max_source_image_pixels" {
  type        = number
  description = "Maximum decoded pixel count accepted for one source image."
  default     = 16777216

  validation {
    condition     = var.max_source_image_pixels >= 1024 && var.max_source_image_pixels <= 268435456
    error_message = "max_source_image_pixels must be between 1024 and 268435456 pixels."
  }
}

variable "submission_rate_limit_window_seconds" {
  type        = number
  description = "Fixed window used to rate-limit prompt validation before OpenAI is called."
  default     = 60

  validation {
    condition     = floor(var.submission_rate_limit_window_seconds) == var.submission_rate_limit_window_seconds && var.submission_rate_limit_window_seconds >= 10 && var.submission_rate_limit_window_seconds <= 3600
    error_message = "submission_rate_limit_window_seconds must be between 10 seconds and one hour."
  }
}

variable "anonymous_submission_rate_limit" {
  type        = number
  description = "Maximum anonymous prompt validations per rate-limit window and trusted client address."
  default     = 3

  validation {
    condition     = floor(var.anonymous_submission_rate_limit) == var.anonymous_submission_rate_limit && var.anonymous_submission_rate_limit >= 1 && var.anonymous_submission_rate_limit <= 100
    error_message = "anonymous_submission_rate_limit must be between 1 and 100."
  }
}

variable "authenticated_submission_rate_limit" {
  type        = number
  description = "Maximum authenticated prompt validations per rate-limit window and Cognito subject."
  default     = 10

  validation {
    condition     = floor(var.authenticated_submission_rate_limit) == var.authenticated_submission_rate_limit && var.authenticated_submission_rate_limit >= 1 && var.authenticated_submission_rate_limit <= 1000
    error_message = "authenticated_submission_rate_limit must be between 1 and 1000."
  }
}

variable "anonymous_submission_max_concurrency" {
  type        = number
  description = "Maximum simultaneous anonymous prompt validations per trusted client address."
  default     = 1

  validation {
    condition     = floor(var.anonymous_submission_max_concurrency) == var.anonymous_submission_max_concurrency && var.anonymous_submission_max_concurrency >= 1 && var.anonymous_submission_max_concurrency <= 10
    error_message = "anonymous_submission_max_concurrency must be between 1 and 10."
  }
}

variable "authenticated_submission_max_concurrency" {
  type        = number
  description = "Maximum simultaneous authenticated prompt validations per Cognito subject."
  default     = 2

  validation {
    condition     = floor(var.authenticated_submission_max_concurrency) == var.authenticated_submission_max_concurrency && var.authenticated_submission_max_concurrency >= 1 && var.authenticated_submission_max_concurrency <= 20
    error_message = "authenticated_submission_max_concurrency must be between 1 and 20."
  }
}

variable "submission_concurrency_lease_seconds" {
  type        = number
  description = "Recovery lease for a prompt-validation concurrency slot after a runtime crash."
  default     = 60

  validation {
    condition     = floor(var.submission_concurrency_lease_seconds) == var.submission_concurrency_lease_seconds && var.submission_concurrency_lease_seconds >= 10 && var.submission_concurrency_lease_seconds <= 300
    error_message = "submission_concurrency_lease_seconds must be between 10 seconds and five minutes."
  }
}

variable "image_generation_visibility_timeout_seconds" {
  type        = number
  description = "SQS visibility timeout for a source-image generation job. Keep this at least six times the generation Lambda timeout."
  default     = 5400

  validation {
    condition     = var.image_generation_visibility_timeout_seconds >= 60 && var.image_generation_visibility_timeout_seconds <= 43200
    error_message = "image_generation_visibility_timeout_seconds must be between 60 seconds and 12 hours."
  }
}

variable "image_generation_timeout_seconds" {
  type        = number
  description = "Maximum execution time for one image-generation Lambda invocation; keep it below five minutes."
  default     = 270

  validation {
    condition     = var.image_generation_timeout_seconds >= 60 && var.image_generation_timeout_seconds < 300
    error_message = "image_generation_timeout_seconds must be between 60 seconds and five minutes."
  }
}

variable "image_generation_lease_grace_seconds" {
  type        = number
  description = "Extra time after the generator timeout before an unfinished generation is failed."
  default     = 30

  validation {
    condition     = var.image_generation_lease_grace_seconds >= 30 && var.image_generation_timeout_seconds + var.image_generation_lease_grace_seconds <= 300
    error_message = "image_generation_lease_grace_seconds must be at least 30 seconds and keep the total generation lease at five minutes or less."
  }
}

variable "image_generation_max_retries" {
  type        = number
  description = "Maximum generator retries after an explicitly retryable provider failure."
  default     = 3

  validation {
    condition     = var.image_generation_max_retries >= 1 && var.image_generation_max_retries <= 10
    error_message = "image_generation_max_retries must be between 1 and 10."
  }
}

variable "image_generation_retry_base_delay_seconds" {
  type        = number
  description = "Initial delay for a recovered generator attempt; later retries double it."
  default     = 30

  validation {
    condition     = var.image_generation_retry_base_delay_seconds >= 1 && var.image_generation_retry_base_delay_seconds <= 900
    error_message = "image_generation_retry_base_delay_seconds must be between 1 second and 15 minutes."
  }
}

variable "image_reshaping_timeout_seconds" {
  type        = number
  description = "Maximum execution time for one image-reshaping Lambda invocation."
  default     = 60

  validation {
    condition     = var.image_reshaping_timeout_seconds >= 60 && var.image_reshaping_timeout_seconds <= 900
    error_message = "image_reshaping_timeout_seconds must be between 60 and 900 seconds."
  }
}

variable "image_reshaping_lease_grace_seconds" {
  type        = number
  description = "Extra time after the reshaper timeout before a stale reshape lease can be recovered."
  default     = 60

  validation {
    condition     = var.image_reshaping_lease_grace_seconds >= 30 && var.image_reshaping_lease_grace_seconds <= 900
    error_message = "image_reshaping_lease_grace_seconds must be between 30 seconds and 15 minutes."
  }
}

variable "image_reshaping_max_retries" {
  type        = number
  description = "Maximum reshaper retries after the initial attempt before an expired reshape lease becomes FAILED."
  default     = 3

  validation {
    condition     = var.image_reshaping_max_retries >= 1 && var.image_reshaping_max_retries <= 10
    error_message = "image_reshaping_max_retries must be between 1 and 10."
  }
}

variable "image_reshaping_retry_base_delay_seconds" {
  type        = number
  description = "Initial delay for a recovered reshaper attempt; later retries double it."
  default     = 30

  validation {
    condition     = var.image_reshaping_retry_base_delay_seconds >= 1 && var.image_reshaping_retry_base_delay_seconds <= 900
    error_message = "image_reshaping_retry_base_delay_seconds must be between 1 second and 15 minutes."
  }
}

variable "image_generation_reserved_concurrency" {
  type        = number
  description = "Maximum concurrent image-generation Lambda executions and SQS consumers."
  default     = 2

  validation {
    condition     = var.image_generation_reserved_concurrency >= 1 && var.image_generation_reserved_concurrency <= 100
    error_message = "image_generation_reserved_concurrency must be between 1 and 100."
  }
}

variable "image_generation_model" {
  type        = string
  description = "GPT Image model used by the asynchronous image-generation worker."
  default     = "gpt-image-1"

  validation {
    condition     = contains(["gpt-image-1", "gpt-image-1.5", "gpt-image-2"], var.image_generation_model)
    error_message = "image_generation_model must be a supported GPT Image edit model."
  }
}

variable "image_generation_background" {
  type        = string
  description = "Background requested from the GPT Image edit API. Use auto for models that do not support transparency."
  default     = "transparent"

  validation {
    condition     = contains(["auto", "opaque", "transparent"], var.image_generation_background)
    error_message = "image_generation_background must be auto, opaque, or transparent."
  }
}

variable "image_generation_log_retention_days" {
  type        = number
  description = "CloudWatch log retention for the image-generation worker."
  default     = 30

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.image_generation_log_retention_days)
    error_message = "image_generation_log_retention_days must be a CloudWatch-supported retention period."
  }
}

variable "image_generation_alarm_actions" {
  type        = list(string)
  description = "Optional SNS topic ARNs or other supported CloudWatch alarm actions for image-generation failures."
  default     = []
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
