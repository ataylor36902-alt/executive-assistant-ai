# Heroku Deployment Guide

## Step 1: Install Heroku CLI

```bash
# macOS
brew tap heroku/brew && brew install heroku

# Windows (via installer)
# Download from https://devcenter.heroku.com/articles/heroku-cli

# Linux
curl https://cli-assets.heroku.com/install.sh | sh
```

Verify installation:
```bash
heroku --version
```

## Step 2: Login to Heroku

```bash
heroku login
# Opens browser to authenticate
```

## Step 3: Create Heroku App

```bash
# From project root
heroku create executive-assistant-api
# Output: Created https://executive-assistant-api.herokuapp.com/
```

## Step 4: Add Database Add-ons

```bash
# PostgreSQL Database
heroku addons:create heroku-postgresql:standard-0

# Redis Cache
heroku addons:create heroku-redis:premium-0
```

## Step 5: Set Environment Variables

```bash
# JWT Secrets
heroku config:set JWT_SECRET=$(openssl rand -base64 32)
heroku config:set REFRESH_TOKEN_SECRET=$(openssl rand -base64 32)

# Google OAuth
heroku config:set GOOGLE_CLIENT_ID="your_client_id"
heroku config:set GOOGLE_CLIENT_SECRET="your_client_secret"
heroku config:set GOOGLE_CALLBACK_URL="https://executive-assistant-api.herokuapp.com/auth/google/callback"

# API Keys
heroku config:set OPENAI_API_KEY="your_openai_key"
heroku config:set ANTHROPIC_API_KEY="your_claude_key"
heroku config:set DEEPGRAM_API_KEY="your_deepgram_key"
heroku config:set TWILIO_ACCOUNT_SID="your_twilio_sid"
heroku config:set TWILIO_AUTH_TOKEN="your_twilio_token"
heroku config:set TWILIO_PHONE_NUMBER="+1234567890"
heroku config:set STRIPE_SECRET_KEY="your_stripe_key"

# App URLs
heroku config:set API_URL="https://executive-assistant-api.herokuapp.com"
heroku config:set FRONTEND_URL="https://your-adalo-app.adalo.com"

# Logging
heroku config:set LOG_LEVEL="info"
```

Verify variables:
```bash
heroku config
```

## Step 6: Deploy Code

```bash
# Deploy to Heroku
git push heroku main

# Watch deployment logs
heroku logs --tail
```

## Step 7: Run Migrations

```bash
# Run database migrations (defined in Procfile release phase)
heroku run npm run migrate

# Seed test data (optional)
heroku run npm run seed
```

## Step 8: Verify Deployment

```bash
# Check app status
heroku ps

# Test health endpoint
curl https://executive-assistant-api.herokuapp.com/health

# Should return:
# {"status":"OK","timestamp":"2026-09-14T..."}
```

## Step 9: Scale Workers (Optional)

```bash
# Add email sync worker
heroku ps:scale worker=1

# View all dynos
heroku ps
```

## Step 10: Enable Monitoring

```bash
# View logs in real-time
heroku logs --tail

# View logs for specific dyno
heroku logs --tail --dyno web.1

# View error logs
heroku logs --tail --grep "error"
```

## Useful Commands

```bash
# Restart app
heroku restart

# Open app in browser
heroku open

# Access Heroku Postgres
heroku pg:psql

# View database info
heroku pg:info

# Download database backup
heroku pg:backups:capture
heroku pg:backups:download

# View Redis info
heroku redis:info

# SSH into dyno (if enabled)
heroku ps:exec

# Add custom domain
heroku domains:add api.yourdomain.com

# Enable metrics
heroku metrics --dyno web.1

# View costs
heroku billing
```

## Troubleshooting

### App crashes on startup
```bash
heroku logs --tail
# Check for missing dependencies or env variables
```

### Database connection error
```bash
heroku pg:info
heroku pg:reset  # WARNING: Deletes all data!
```

### Out of memory
```bash
# Upgrade dyno type
heroku dyno:type standard-1x web.1
```

### DNS not working
```bash
# Check domain configuration
heroku domains
# Verify DNS records point to Heroku
```

## Maintenance

```bash
# Enable maintenance mode
heroku maintenance:on

# Disable maintenance mode
heroku maintenance:off

# Check maintenance status
heroku maintenance
```

## Costs Estimate

- **Free Tier:** $0/month (gets shut down after 30 min inactivity)
- **Basic Dyno:** $7/month (recommended for testing)
- **Standard Dyno:** $25/month (for production)
- **PostgreSQL:** $9-84/month (depending on size)
- **Redis:** $15/month
- **Total (production):** ~$50-150/month

## Alternative: Railway.app

If Heroku is too expensive, try Railway.app:
- Pricing: Pay per usage (~$5/month typical)
- Similar deployment process
- Better performance
- https://railway.app
