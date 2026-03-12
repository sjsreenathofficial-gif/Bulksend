# WA Growth Engine — Production Deployment Guide

## Infrastructure Overview

```
Vercel (Frontend) → AWS ALB → EC2 Auto Scaling Group → RDS PostgreSQL
                                         ↓
                                   ElastiCache Redis
```

---

## Step 1 — AWS Setup

### 1.1 Create VPC
```bash
aws ec2 create-vpc --cidr-block 10.0.0.0/16 --region ap-south-1
# Create public subnet: 10.0.1.0/24 (for EC2)
# Create private subnet: 10.0.2.0/24 (for RDS)
```

### 1.2 RDS PostgreSQL
```bash
aws rds create-db-instance \
  --db-instance-identifier wa-growth-engine-prod \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --engine-version 15.4 \
  --master-username postgres \
  --master-user-password YOUR_SECURE_PASSWORD \
  --allocated-storage 100 \
  --storage-type gp3 \
  --storage-encrypted \
  --multi-az \
  --db-name wa_growth_engine \
  --vpc-security-group-ids sg-xxxx \
  --region ap-south-1
```

### 1.3 ElastiCache Redis
```bash
aws elasticache create-replication-group \
  --replication-group-id wa-growth-redis \
  --replication-group-description "WA Growth Engine Redis" \
  --cache-node-type cache.t3.medium \
  --engine redis \
  --engine-version 7.0 \
  --num-cache-clusters 2 \
  --security-group-ids sg-xxxx
```

---

## Step 2 — EC2 Backend Setup

### 2.1 Launch EC2 (Ubuntu 22.04)
- Instance type: t3.medium (start), scale to c5.large for production
- AMI: ami-0f58b397bc5c1f2e8 (Ubuntu 22.04 ap-south-1)

### 2.2 Install dependencies
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2
npm install -g pm2

# Install Nginx
sudo apt install -y nginx

# Clone repo
git clone https://github.com/YOUR_ORG/wa-growth-engine.git /app
cd /app/backend
npm install --production
```

### 2.3 Environment Variables
```bash
# Create .env file
sudo nano /app/backend/.env
# Paste all values from .env.example with production values

# Secure it
chmod 600 /app/backend/.env
```

### 2.4 Database Migration
```bash
cd /app/backend
npx prisma migrate deploy
```

### 2.5 Start with PM2
```bash
pm2 start src/server.js --name "wa-growth-api" --instances max
pm2 save
pm2 startup
```

---

## Step 3 — Nginx Configuration

```nginx
# /etc/nginx/sites-available/wa-growth-engine
server {
    listen 80;
    server_name api.wagrowthengine.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.wagrowthengine.com;

    ssl_certificate /etc/letsencrypt/live/api.wagrowthengine.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.wagrowthengine.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }

    # Webhook endpoint — no rate limiting
    location /api/v1/webhooks {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
# Enable and test
sudo ln -s /etc/nginx/sites-available/wa-growth-engine /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# SSL with Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.wagrowthengine.com
```

---

## Step 4 — Frontend on Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# From frontend directory
cd /app/frontend
vercel --prod
```

### Frontend Environment Variables (Vercel Dashboard)
```
NEXT_PUBLIC_API_URL=https://api.wagrowthengine.com/api/v1
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxx
```

---

## Step 5 — WhatsApp Cloud API Setup

1. Go to https://developers.facebook.com
2. Create a new App → Business → WhatsApp
3. Add WhatsApp product
4. Get Phone Number ID and WABA ID
5. Generate permanent access token
6. Set webhook URL: `https://api.wagrowthengine.com/api/v1/webhooks/whatsapp`
7. Subscribe to: `messages`, `message_deliveries`, `message_reads`
8. Set verify token in Meta dashboard + your `.env`

---

## Step 6 — Auto Scaling (Production)

### Launch Template
```json
{
  "ImageId": "ami-0f58b397bc5c1f2e8",
  "InstanceType": "t3.large",
  "UserData": "base64-encoded-startup-script",
  "IamInstanceProfile": { "Arn": "arn:aws:iam::xxx:instance-profile/wa-growth-engine" }
}
```

### Auto Scaling Group
- Min: 2, Max: 10, Desired: 2
- Scale out: CPU > 70% for 5 minutes
- Scale in: CPU < 30% for 10 minutes
- ALB health check: `/health`

---

## Step 7 — Monitoring

### CloudWatch Alarms
```bash
# High error rate alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "wa-growth-high-errors" \
  --metric-name "5XXError" \
  --namespace "AWS/ApplicationELB" \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --period 60 \
  --alarm-actions arn:aws:sns:ap-south-1:xxx:alerts
```

---

## Environment Variables Summary

### Backend (.env)
| Variable | Description |
|----------|-------------|
| DATABASE_URL | RDS connection string |
| REDIS_HOST | ElastiCache endpoint |
| JWT_SECRET | 64-char random string |
| JWT_REFRESH_SECRET | Different 64-char string |
| ENCRYPTION_KEY | 32-char key for WA token encryption |
| WA_VERIFY_TOKEN | Random string for Meta webhook |
| WA_APP_SECRET | From Meta App dashboard |
| OPENAI_API_KEY | OpenAI API key |
| RAZORPAY_KEY_ID | Razorpay live key |
| RAZORPAY_KEY_SECRET | Razorpay secret |

---

## Cost Estimate (Monthly) — India Region

| Service | Spec | Cost |
|---------|------|------|
| EC2 (2x t3.large) | 2 vCPU, 8GB | ₹8,500 |
| RDS (db.t3.medium) | Multi-AZ | ₹6,200 |
| ElastiCache (t3.medium) | Redis | ₹3,100 |
| ALB | Per LCU | ₹2,000 |
| Vercel (Pro) | Frontend | ₹1,700 |
| Bandwidth | 100GB | ₹1,200 |
| **Total** | | **~₹22,700/month** |

---

## Security Checklist

- [x] JWT tokens with short expiry (15min access, 7d refresh)
- [x] bcrypt password hashing (cost factor 12)
- [x] AES-256-GCM encryption for WhatsApp tokens
- [x] Rate limiting (500 req/15min general, 10 req/15min auth)
- [x] Helmet.js security headers
- [x] CORS restricted to frontend domain
- [x] Webhook signature verification (HMAC-SHA256)
- [x] PostgreSQL Row-Level Security
- [x] Input validation with Zod
- [x] SQL injection prevention via Prisma ORM
- [x] RBAC (owner, admin, member, viewer roles)
- [x] API key hashing
- [x] Encrypted database at rest (RDS)
- [x] VPC with private subnets for DB
- [x] AWS Secrets Manager for sensitive vars
