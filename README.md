# 🚀 WA Growth Engine — Bulksend

> AI-powered WhatsApp Marketing & Automation SaaS for Indian Businesses

[![Status](https://img.shields.io/badge/Status-In%20Development-yellow)]()
[![Stack](https://img.shields.io/badge/Stack-Firebase%20%2B%20Node.js%20%2B%20Next.js-blue)]()
[![License](https://img.shields.io/badge/License-Private-red)]()

---

## 📌 What is this?

**Bulksend (WA Growth Engine)** is a next-generation WhatsApp marketing platform built for small businesses, real estate companies, coaching institutes, and e-commerce stores in India — especially Andhra Pradesh and Telangana.

Better than Interakt, WATI, and MSG91 with:
- ✅ AI-generated campaigns
- ✅ Smart lead scoring (Hot / Warm / Cold)
- ✅ AI chatbot with auto-replies
- ✅ Campaign analytics
- ✅ Razorpay subscription billing

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js + Tailwind CSS |
| Backend | Node.js + Express |
| Database | Firebase Firestore |
| Auth | Firebase Authentication |
| Queue | Firebase Cloud Functions + Pub/Sub |
| AI | OpenAI GPT-4o API |
| Messaging | WhatsApp Cloud API (Meta) |
| Payments | Razorpay |
| Hosting | Vercel (Frontend) + Firebase Functions (Backend) |

---

## 📁 Project Structure

```
bulksend/
├── frontend/                  # Next.js dashboard
│   ├── src/
│   │   ├── app/               # Pages
│   │   ├── components/        # UI components
│   │   └── lib/               # Firebase client, API
│   └── package.json
│
├── backend/                   # Node.js API / Firebase Functions
│   ├── functions/             # Firebase Cloud Functions
│   ├── src/
│   │   ├── controllers/       # Route handlers
│   │   ├── services/          # Business logic
│   │   │   ├── whatsapp.js    # WhatsApp Cloud API
│   │   │   ├── chatbot.js     # AI chatbot engine
│   │   │   └── firebase.js    # Firestore helpers
│   │   ├── routes/            # Express routes
│   │   ├── middleware/        # Auth, rate limiting
│   │   └── ai/
│   │       └── aiEngine.js    # OpenAI integration
│   └── package.json
│
├── schema.sql                 # Reference schema (PostgreSQL version)
├── aiEngine.js                # AI engine (OpenAI)
├── server.js                  # Express server entry
├── wa-growth-engine-dashboard.jsx  # Full dashboard UI
└── DEPLOYMENT.md              # Deployment guide
```

---

## 🔥 Firebase Collections Structure

```
/organizations/{orgId}
  - name, plan, messageLimit, messagesUsed, wabaId, phoneNumberId

/organizations/{orgId}/contacts/{contactId}
  - phone, name, city, tags[], optIn, source

/organizations/{orgId}/campaigns/{campaignId}
  - name, templateId, status, segmentFilters, scheduledAt
  - sentCount, deliveredCount, readCount, replyCount

/organizations/{orgId}/messages/{messageId}
  - campaignId, contactId, waMessageId, status
  - sentAt, deliveredAt, readAt

/organizations/{orgId}/leads/{leadId}
  - contactId, score, scoreLabel, status, source

/organizations/{orgId}/conversations/{contactId}
  - lastMessage, lastMessageAt, unreadCount, status

/organizations/{orgId}/chatMessages/{messageId}
  - direction, content, createdAt, aiHandled

/users/{userId}
  - email, orgId, role, fullName
```

---

## 🚀 Features

### 📣 Campaign Management
- Create bulk WhatsApp campaigns
- Target by city, tags, industry
- Schedule for specific time
- Real-time delivery tracking

### 🤖 AI Campaign Generator
- Enter your goal in plain language
- AI writes the WhatsApp message
- Suggests follow-up messages
- Recommends best send time

### 🎯 Lead Scoring
- Auto score leads 0–100
- Labels: 🔥 Hot / 🌡️ Warm / 🧊 Cold
- Based on replies, reads, engagement

### 💬 AI Chatbot
- Auto-replies to incoming messages
- Collects name, email, requirement
- Escalates to human when needed

### 📊 Analytics Dashboard
- Delivery rate, read rate, reply rate
- Per-campaign breakdown
- Daily trends chart

### 💳 Billing (Razorpay)
| Plan | Price | Messages |
|------|-------|----------|
| Starter | ₹999/month | 5,000 |
| Growth | ₹3,999/month | 25,000 |
| Agency | ₹9,999/month | 1,00,000 |

---

## ⚙️ Setup Guide

### 1. Clone the repo
```bash
git clone https://github.com/sjsreenathofficial-gif/Bulksend.git
cd Bulksend
```

### 2. Firebase Setup
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create new project → enable Firestore + Authentication
3. Download `serviceAccountKey.json`
4. Enable Email/Password auth

### 3. Backend Setup
```bash
cd backend
npm install
cp .env.example .env
# Fill in your keys in .env
npm run dev
```

### 4. Frontend Setup
```bash
cd frontend
npm install
cp .env.example .env.local
# Fill in Firebase config
npm run dev
```

### 5. Environment Variables

**Backend `.env`**
```
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_SERVICE_ACCOUNT=path/to/serviceAccountKey.json
WA_VERIFY_TOKEN=your-verify-token
WA_APP_SECRET=your-meta-app-secret
OPENAI_API_KEY=sk-...
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
JWT_SECRET=your-secret-key
```

**Frontend `.env.local`**
```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
```

---

## 🔗 WhatsApp Cloud API Setup

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create App → Business → Add WhatsApp
3. Get your **Phone Number ID** and **WABA ID**
4. Set webhook URL: `https://your-api.com/api/v1/webhooks/whatsapp`
5. Subscribe to: `messages`, `message_deliveries`, `message_reads`

---

## 📋 Roadmap

- [x] System architecture
- [x] Database schema (Firestore)
- [x] Backend API (Node.js + Express)
- [x] AI engine (OpenAI)
- [x] Frontend dashboard (Next.js)
- [ ] Firebase integration
- [ ] WhatsApp Cloud API live connection
- [ ] Razorpay billing
- [ ] Chatbot builder UI
- [ ] Deploy to production

---

## 👨‍💻 Built By

**Sreenath** — Solo Developer & Product Owner
- Building SaaS products for Indian small businesses
- Also building: CampusPrime, KiranaBoost, Invoicebillers

---

## 📄 License

Private — All rights reserved
