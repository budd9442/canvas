resource "aws_security_group" "rds" {
  name        = "${var.cluster_name}-rds-sg"
  description = "Security group for RDS PostgreSQL"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "rds" {
  name       = "${var.cluster_name}-rds-subnet-group"
  subnet_ids = module.vpc.private_subnets
}

# Generate a random password for RDS
resource "random_password" "rds_password" {
  length           = 16
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# Store the connection details in AWS Secrets Manager
resource "aws_secretsmanager_secret" "db_credentials" {
  name_prefix = "${var.cluster_name}-db-credentials-"
  description = "Database credentials for Canvas"
}

resource "aws_secretsmanager_secret_version" "db_credentials_version" {
  secret_id     = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username            = "postgres"
    password            = random_password.rds_password.result
    engine              = "postgres"
    host                = aws_db_instance.postgres.endpoint
    port                = 5432
    dbClusterIdentifier = aws_db_instance.postgres.identifier
    dbname              = "canvas_db"
    redis_endpoint      = aws_elasticache_cluster.redis.cache_nodes[0].address
  })
}

resource "aws_db_instance" "postgres" {
  identifier           = "${var.cluster_name}-postgres"
  engine               = "postgres"
  engine_version       = "16.13"
  instance_class       = "db.t3.micro"
  allocated_storage    = 20
  storage_type         = "gp3"
  
  db_name              = "canvas_db"
  username             = "postgres"
  password             = random_password.rds_password.result
  
  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.rds.name
  
  skip_final_snapshot  = true
  publicly_accessible  = false
}
