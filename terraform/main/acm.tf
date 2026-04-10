resource "aws_acm_certificate" "cert" {
  domain_name       = "canvas.budd.codes"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

output "acm_certificate_arn" {
  value       = aws_acm_certificate.cert.arn
  description = "The ARN of the ACM certificate. You must update your DNS with the CNAME provided in the AWS Console to validate this certificate."
}
