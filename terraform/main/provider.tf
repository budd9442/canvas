terraform {
  required_version = ">= 1.3"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.11"
    }
  }

  backend "s3" {
    bucket         = "canvas-terraform-state-assured-seagull" 
    key            = "main/terraform.tfstate"
    region         = "ap-southeast-1"
    dynamodb_table = "canvas-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}
