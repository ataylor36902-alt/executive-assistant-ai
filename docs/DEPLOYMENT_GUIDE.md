# Deployment & Infrastructure Guide

## Development Environment Setup

### Prerequisites
```bash
# Node.js v18+
node --version

# PostgreSQL 14+
psql --version

# Redis 7+
redis-cli --version

# Docker & Docker Compose
docker --version
docker-compose --version
```

### Local Development

1. **Clone repository**
```bash
git clone https://github.com/ataylor36902-alt/executive-assistant-ai.git
cd executive-assistant-ai
```

2. **Set up backend**
```bash
cd backend
cp .env.example .env
# Edit .env with your local configuration

npm install
npm run migrate
npm run seed  # Optional: seed test data
npm run dev   # Start development server on port 3001
```

3. **Set up frontend**
```bash
cd ../frontend
cp .env.example .env
# Edit .env with API URL (http://localhost:3001)

npm install
npm run dev   # Start dev server on port 3000
```

4. **Start infrastructure with Docker**
```bash
# From project root
docker-compose up -d

# This starts:
# - PostgreSQL on port 5432
# - Redis on port 6379
# - RabbitMQ on port 5672 (UI on 15672)
# - Elasticsearch on port 9200
```

5. **Verify everything is running**
```bash
# Backend health check
curl http://localhost:3001/health

# Frontend
open http://localhost:3000
```

---

## Production Deployment

### Architecture Overview

```
Internet
   ↓
CloudFlare (CDN + DDoS protection)
   ↓
AWS ALB (Application Load Balancer)
   ↓
┌─────────────────────────────────────┐
│  ECS Cluster (Auto-scaling)         │
│  ┌─────────────┬─────────────┐      │
│  │ API Pod 1   │ API Pod 2   │      │
│  │ Node.js     │ Node.js     │      │
│  │ Express     │ Express     │      │
│  └─────────────┴─────────────┘      │
│  ┌─────────────┬─────────────┐      │
│  │ Worker 1    │ Worker 2    │      │
│  │ Bull Queue  │ Bull Queue  │      │
│  └─────────────┴─────────────┘      │
└─────────────────────────────────────┘
   ↓
┌─────────────────────────────────────┐
│  Data Layer                         │
│  ┌──────────────────────────────┐  │
│  │ RDS PostgreSQL (Multi-AZ)    │  │
│  │ Primary + Standby            │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ ElastiCache Redis Cluster    │  │
│  │ Multi-AZ replication         │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ Elasticsearch Cluster        │  │
│  │ 3+ nodes for high availability   │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
   ↓
┌─────────────────────────────────────┐
│  Storage                            │
│  ├─ S3 (Files, recordings)          │
│  ├─ S3 Backups                      │
│  └─ CloudFront CDN                  │
└─────────────────────────────────────┘
```

### AWS Infrastructure as Code (Terraform)

**Create `terraform/main.tf`:**
```hcl
provider "aws" {
  region = var.aws_region
}

# RDS PostgreSQL
resource "aws_rds_cluster" "main" {
  cluster_identifier      = "executive-assistant-db"
  engine                  = "aurora-postgresql"
  engine_version          = "14.6"
  database_name           = var.db_name
  master_username         = var.db_user
  master_password         = var.db_password
  
  db_subnet_group_name    = aws_db_subnet_group.main.name
  vpc_security_group_ids  = [aws_security_group.db.id]
  
  backup_retention_period = 30
  preferred_backup_window = "03:00-04:00"
  
  enabled_cloudwatch_logs_exports = ["postgresql"]
  
  tags = {
    Name = "executive-assistant-db"
  }
}

# ElastiCache Redis
resource "aws_elasticache_cluster" "main" {
  cluster_id           = "executive-assistant-redis"
  engine               = "redis"
  node_type            = "cache.r6g.xlarge"
  num_cache_nodes      = 3
  parameter_group_name = "default.redis7"
  
  engine_version           = "7.0"
  port                     = 6379
  parameter_group_name     = aws_elasticache_parameter_group.main.name
  node_type                = "cache.r6g.xlarge"
  automatic_failover_enabled = true
  
  subnet_group_name = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]
  
  tags = {
    Name = "executive-assistant-redis"
  }
}

# S3 for file storage
resource "aws_s3_bucket" "main" {
  bucket = "executive-assistant-${var.environment}"
}

resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id
  versioning_configuration {
    status = "Enabled"
  }
}

# ECS Cluster for API servers
resource "aws_ecs_cluster" "main" {
  name = "executive-assistant-cluster"
  
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# Load Balancer
resource "aws_lb" "main" {
  name               = "executive-assistant-alb"
  internal           = false
  load_balancer_type = "application"
  
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  
  enable_deletion_protection = true
}
```

### Docker Deployment

**Backend Dockerfile:**
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY src ./src

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

EXPOSE 3001
CMD ["npm", "start"]
```

**Production Docker Compose:**
```yaml
version: '3.8'
services:
  api:
    image: executive-assistant-api:latest
    container_name: api-server
    environment:
      NODE_ENV: production
      DB_HOST: postgres
      REDIS_HOST: redis
      RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672
    ports:
      - "3001:3001"
    depends_on:
      - postgres
      - redis
      - rabbitmq
    restart: always
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    image: executive-assistant-api:latest
    container_name: worker-server
    environment:
      NODE_ENV: production
      WORKER_MODE: true
      DB_HOST: postgres
      REDIS_HOST: redis
      RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672
    depends_on:
      - postgres
      - redis
      - rabbitmq
    restart: always
    command: npm run start:worker

  postgres:
    image: postgres:14-alpine
    container_name: postgres
    environment:
      POSTGRES_DB: executive_assistant
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: always
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: always
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  rabbitmq:
    image: rabbitmq:3-management-alpine
    container_name: rabbitmq
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
    ports:
      - "5672:5672"
      - "15672:15672"
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    restart: always

volumes:
  postgres_data:
  redis_data:
  rabbitmq_data:
```

---

## CI/CD Pipeline

### GitHub Actions Workflow

**`.github/workflows/deploy.yml`:**
```yaml
name: Deploy to Production

on:
  push:
    branches: [main]
  pull_request:
    branches: [develop, main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: test_db
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run linter
      run: npm run lint
    
    - name: Run tests
      run: npm test -- --coverage
      env:
        DB_HOST: localhost
        DB_USER: postgres
        DB_PASSWORD: postgres
        DB_NAME: test_db
    
    - name: Upload coverage
      uses: codecov/codecov-action@v3

  build:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Login to Amazon ECR
      id: login-ecr
      uses: aws-actions/amazon-ecr-login@v1
      env:
        AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
        AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        AWS_REGION: us-east-1
    
    - name: Build and push Docker image
      env:
        ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
        ECR_REPOSITORY: executive-assistant
        IMAGE_TAG: ${{ github.sha }}
      run: |
        docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
        docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - name: Deploy to ECS
      env:
        AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
        AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        AWS_REGION: us-east-1
      run: |
        aws ecs update-service \
          --cluster executive-assistant-cluster \
          --service executive-assistant-service \
          --force-new-deployment
    
    - name: Slack Notification
      uses: slackapi/slack-github-action@v1.24.0
      with:
        webhook-url: ${{ secrets.SLACK_WEBHOOK }}
        payload: |
          {
            "text": "Deployment to production completed",
            "blocks": [
              {
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": "*Executive Assistant AI* deployed to production\n*Commit*: ${{ github.sha }}\n*Branch*: ${{ github.ref }}"
                }
              }
            ]
          }
```

---

## Monitoring & Observability

### Datadog Setup
```yaml
# datadog-values.yaml
Agent:
  enabled: true
  image:
    tag: latest
  env:
    - name: DD_LOGS_ENABLED
      value: "true"
    - name: DD_APM_ENABLED
      value: "true"

clusterAgent:
  enabled: true
  metricsProvider:
    enabled: true

apm:
  enabled: true
  servicePort: 8126
```

### Custom Dashboards

**Key Metrics to Monitor:**
- API Response time (p50, p95, p99)
- Email sync success rate
- Calendar sync latency
- Transcription accuracy
- Database query performance
- Redis cache hit rate
- Worker queue depth
- Error rate by endpoint
- User authentication failures
- Third-party API errors

### Alerting Rules

```yaml
alerts:
  - name: High API Error Rate
    condition: error_rate > 1%
    duration: 5m
    severity: critical
  
  - name: Database Connection Pool Exhausted
    condition: pg_connections > 80%
    duration: 2m
    severity: critical
  
  - name: Email Sync Delay
    condition: email_sync_lag > 10m
    duration: 10m
    severity: warning
  
  - name: Redis Memory High
    condition: redis_memory > 80%
    duration: 5m
    severity: warning
```

---

## Backup & Disaster Recovery

### Backup Strategy

```bash
# Daily automated backups
# Daily at 3 AM UTC

# PostgreSQL
- RDS automated backups (30-day retention)
- Weekly full backups to S3
- Monthly backups to Glacier

# Redis
- AOF (Append-only file) snapshots
- RDB snapshots every 6 hours
- Replicated to standby node

# S3 Data
- Versioning enabled
- Cross-region replication
- Backup to Glacier after 90 days
```

### Disaster Recovery Plan

**RTO (Recovery Time Objective): 1 hour**
**RPO (Recovery Point Objective): 15 minutes**

1. **Detection:** CloudWatch alarms detect failure
2. **Failover:** RDS automatic failover to standby (2 min)
3. **Restore:** ECS tasks restart on healthy instances (5 min)
4. **Data:** Restore from latest Redis snapshot (5 min)
5. **Verification:** Health checks confirm service health (3 min)

---

## Scaling Strategy

### Horizontal Scaling
- API servers: Auto-scale 2-10 instances based on CPU/memory
- Database: RDS read replicas for read-heavy workloads
- Redis: Cluster mode for horizontal scaling
- Elasticsearch: Add nodes as data grows

### Vertical Scaling
- ECS task CPU/memory increase
- RDS instance type upgrade
- Redis node type upgrade

### Database Optimization
```sql
-- Key indexes for performance
CREATE INDEX idx_contacts_user_id ON contacts(user_id);
CREATE INDEX idx_emails_contact_id ON emails(contact_id);
CREATE INDEX idx_emails_received_at ON emails(received_at);
CREATE INDEX idx_interactions_contact_id ON interactions(contact_id);
CREATE INDEX idx_meetings_contact_id ON meetings(contact_id);

-- Partitioning for large tables
CREATE TABLE emails_2024_01 PARTITION OF emails
  FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

---

## Security Checklist

```
[ ] HTTPS/TLS enabled (grade A+)
[ ] JWT tokens use RS256 (asymmetric)
[ ] Secrets manager configured (AWS Secrets Manager)
[ ] Database encryption at rest
[ ] S3 bucket encryption enabled
[ ] VPC security groups configured
[ ] DDoS protection (CloudFlare, AWS Shield)
[ ] WAF rules configured
[ ] Audit logging enabled
[ ] Regular security scanning (OWASP, SAST)
[ ] Penetration testing scheduled
[ ] Incident response plan documented
[ ] GDPR/CCPA compliance verified
[ ] Third-party API credentials rotated
```

