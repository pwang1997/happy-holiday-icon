terraform {
  required_version = ">= 1.10.0"

  cloud {
    organization = "happy-holiday-icon"

    workspaces {
      name    = "dev"
      project = "dev" # optional
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}