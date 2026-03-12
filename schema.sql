-- ============================================================
-- WA Growth Engine — Complete PostgreSQL Database Schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ORGANIZATIONS (Multi-Tenant Root)
-- ============================================================
CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) UNIQUE NOT NULL,
    whatsapp_number VARCHAR(20),
    waba_id         VARCHAR(100),          -- WhatsApp Business Account ID
    phone_number_id VARCHAR(100),          -- Meta Phone Number ID
    access_token    TEXT,                  -- Encrypted WA Cloud API token
    logo_url        TEXT,
    industry        VARCHAR(100),
    city            VARCHAR(100),
    state           VARCHAR(100) DEFAULT 'Telangana',
    plan            VARCHAR(50) DEFAULT 'starter',
    plan_status     VARCHAR(20) DEFAULT 'trial',  -- trial, active, suspended
    message_limit   INTEGER DEFAULT 1000,
    messages_used   INTEGER DEFAULT 0,
    trial_ends_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_organizations_slug ON organizations(slug);

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    full_name       VARCHAR(255) NOT NULL,
    phone           VARCHAR(20),
    role            VARCHAR(50) DEFAULT 'member',  -- owner, admin, member, viewer
    avatar_url      TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    email_verified  BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- CONTACTS
-- ============================================================
CREATE TABLE contacts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    phone           VARCHAR(20) NOT NULL,
    name            VARCHAR(255),
    email           VARCHAR(255),
    city            VARCHAR(100),
    state           VARCHAR(100),
    industry        VARCHAR(100),
    source          VARCHAR(100),           -- manual, csv_import, api, webhook
    opt_in          BOOLEAN DEFAULT TRUE,
    opt_in_at       TIMESTAMPTZ,
    opt_out_at      TIMESTAMPTZ,
    last_message_at TIMESTAMPTZ,
    custom_fields   JSONB DEFAULT '{}',
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, phone)
);
CREATE INDEX idx_contacts_org_id ON contacts(org_id);
CREATE INDEX idx_contacts_phone ON contacts(phone);
CREATE INDEX idx_contacts_city ON contacts(city);
CREATE INDEX idx_contacts_industry ON contacts(industry);
CREATE INDEX idx_contacts_opt_in ON contacts(opt_in);

-- ============================================================
-- CONTACT TAGS
-- ============================================================
CREATE TABLE tags (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    color           VARCHAR(20) DEFAULT '#6366f1',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, name)
);

CREATE TABLE contact_tags (
    contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag_id          UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (contact_id, tag_id)
);
CREATE INDEX idx_contact_tags_tag_id ON contact_tags(tag_id);

-- ============================================================
-- TEMPLATES
-- ============================================================
CREATE TABLE templates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    meta_template_id VARCHAR(100),           -- Meta's template ID after approval
    category        VARCHAR(100),            -- MARKETING, UTILITY, AUTHENTICATION
    language        VARCHAR(10) DEFAULT 'en',
    status          VARCHAR(50) DEFAULT 'pending',  -- pending, approved, rejected
    header_type     VARCHAR(20),             -- text, image, video, document
    header_content  TEXT,
    body_text       TEXT NOT NULL,
    footer_text     TEXT,
    buttons         JSONB DEFAULT '[]',
    variables       JSONB DEFAULT '[]',      -- list of variable names
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_templates_org_id ON templates(org_id);
CREATE INDEX idx_templates_status ON templates(status);

-- ============================================================
-- CAMPAIGNS
-- ============================================================
CREATE TABLE campaigns (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by      UUID REFERENCES users(id),
    name            VARCHAR(255) NOT NULL,
    template_id     UUID REFERENCES templates(id),
    status          VARCHAR(50) DEFAULT 'draft',  -- draft, scheduled, running, completed, paused, failed
    segment_filters JSONB DEFAULT '{}',      -- filters: tags, city, industry, etc.
    scheduled_at    TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    total_contacts  INTEGER DEFAULT 0,
    sent_count      INTEGER DEFAULT 0,
    delivered_count INTEGER DEFAULT 0,
    read_count      INTEGER DEFAULT 0,
    reply_count     INTEGER DEFAULT 0,
    failed_count    INTEGER DEFAULT 0,
    ai_generated    BOOLEAN DEFAULT FALSE,
    goal            TEXT,                    -- campaign goal for AI context
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_campaigns_org_id ON campaigns(org_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_scheduled_at ON campaigns(scheduled_at);

-- ============================================================
-- CAMPAIGN MESSAGES (Individual message tracking)
-- ============================================================
CREATE TABLE campaign_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_id      UUID NOT NULL REFERENCES contacts(id),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    wa_message_id   VARCHAR(100),            -- Meta's message ID
    status          VARCHAR(50) DEFAULT 'queued',  -- queued, sent, delivered, read, failed, replied
    error_message   TEXT,
    variables       JSONB DEFAULT '{}',      -- Personalization variables
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    replied_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_campaign_messages_campaign_id ON campaign_messages(campaign_id);
CREATE INDEX idx_campaign_messages_contact_id ON campaign_messages(contact_id);
CREATE INDEX idx_campaign_messages_wa_message_id ON campaign_messages(wa_message_id);
CREATE INDEX idx_campaign_messages_status ON campaign_messages(status);

-- ============================================================
-- LEADS
-- ============================================================
CREATE TABLE leads (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contact_id      UUID REFERENCES contacts(id),
    name            VARCHAR(255),
    phone           VARCHAR(20),
    email           VARCHAR(255),
    source          VARCHAR(100),            -- campaign, chatbot, landing_page, manual
    status          VARCHAR(50) DEFAULT 'new', -- new, contacted, qualified, converted, lost
    score           INTEGER DEFAULT 0,        -- 0-100
    score_label     VARCHAR(20) DEFAULT 'cold', -- cold, warm, hot
    assigned_to     UUID REFERENCES users(id),
    campaign_id     UUID REFERENCES campaigns(id),
    notes           TEXT,
    converted_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_leads_org_id ON leads(org_id);
CREATE INDEX idx_leads_score_label ON leads(score_label);
CREATE INDEX idx_leads_status ON leads(status);

-- ============================================================
-- LEAD SCORES (Score history)
-- ============================================================
CREATE TABLE lead_scores (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES organizations(id),
    score           INTEGER NOT NULL,
    reason          VARCHAR(255),
    action          VARCHAR(100),            -- message_replied, link_clicked, etc.
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_lead_scores_lead_id ON lead_scores(lead_id);

-- ============================================================
-- CHATBOT FLOWS
-- ============================================================
CREATE TABLE chatbot_flows (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    trigger_keyword VARCHAR(100),            -- keyword that triggers the flow
    trigger_type    VARCHAR(50) DEFAULT 'keyword', -- keyword, any_message, first_message
    flow_data       JSONB NOT NULL DEFAULT '{}',   -- Visual flow JSON
    is_active       BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_chatbot_flows_org_id ON chatbot_flows(org_id);
CREATE INDEX idx_chatbot_flows_active ON chatbot_flows(is_active);

-- ============================================================
-- CHAT MESSAGES (Conversation history)
-- ============================================================
CREATE TABLE chat_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contact_id      UUID NOT NULL REFERENCES contacts(id),
    wa_message_id   VARCHAR(100) UNIQUE,
    direction       VARCHAR(10) NOT NULL,    -- inbound, outbound
    message_type    VARCHAR(50) DEFAULT 'text', -- text, image, audio, video, document, template
    content         TEXT,
    media_url       TEXT,
    media_type      VARCHAR(100),
    campaign_id     UUID REFERENCES campaigns(id),
    is_read         BOOLEAN DEFAULT FALSE,
    read_at         TIMESTAMPTZ,
    agent_id        UUID REFERENCES users(id),  -- assigned agent
    ai_handled      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_chat_messages_org_id ON chat_messages(org_id);
CREATE INDEX idx_chat_messages_contact_id ON chat_messages(contact_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at DESC);
CREATE INDEX idx_chat_messages_direction ON chat_messages(direction);

-- ============================================================
-- CONVERSATIONS (Thread tracking)
-- ============================================================
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contact_id      UUID NOT NULL REFERENCES contacts(id),
    status          VARCHAR(50) DEFAULT 'open',  -- open, closed, bot, assigned
    assigned_to     UUID REFERENCES users(id),
    last_message_at TIMESTAMPTZ,
    last_message    TEXT,
    unread_count    INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, contact_id)
);
CREATE INDEX idx_conversations_org_id ON conversations(org_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_last_message_at ON conversations(last_message_at DESC);

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================
CREATE TABLE subscriptions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    razorpay_sub_id     VARCHAR(100) UNIQUE,
    razorpay_plan_id    VARCHAR(100),
    plan                VARCHAR(50) NOT NULL,  -- starter, growth, agency
    status              VARCHAR(50) DEFAULT 'created', -- created, active, paused, cancelled, expired
    current_period_start TIMESTAMPTZ,
    current_period_end  TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_subscriptions_org_id ON subscriptions(org_id);

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE payments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES organizations(id),
    subscription_id     UUID REFERENCES subscriptions(id),
    razorpay_payment_id VARCHAR(100) UNIQUE,
    razorpay_order_id   VARCHAR(100),
    amount              INTEGER NOT NULL,       -- in paise (₹999 = 99900)
    currency            VARCHAR(10) DEFAULT 'INR',
    status              VARCHAR(50) DEFAULT 'pending', -- pending, paid, failed, refunded
    method              VARCHAR(50),            -- card, upi, netbanking
    invoice_url         TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_payments_org_id ON payments(org_id);

-- ============================================================
-- ANALYTICS (Daily aggregates)
-- ============================================================
CREATE TABLE analytics (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    campaign_id     UUID REFERENCES campaigns(id),
    date            DATE NOT NULL,
    messages_sent   INTEGER DEFAULT 0,
    messages_delivered INTEGER DEFAULT 0,
    messages_read   INTEGER DEFAULT 0,
    messages_replied INTEGER DEFAULT 0,
    messages_failed INTEGER DEFAULT 0,
    link_clicks     INTEGER DEFAULT 0,
    leads_generated INTEGER DEFAULT 0,
    conversions     INTEGER DEFAULT 0,
    revenue_attributed DECIMAL(12,2) DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, campaign_id, date)
);
CREATE INDEX idx_analytics_org_id ON analytics(org_id);
CREATE INDEX idx_analytics_date ON analytics(date DESC);

-- ============================================================
-- WEBHOOK EVENTS (Idempotency)
-- ============================================================
CREATE TABLE webhook_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID REFERENCES organizations(id),
    source          VARCHAR(50) NOT NULL,     -- whatsapp, razorpay
    event_id        VARCHAR(255) UNIQUE,      -- deduplication key
    event_type      VARCHAR(100),
    payload         JSONB NOT NULL,
    processed       BOOLEAN DEFAULT FALSE,
    processed_at    TIMESTAMPTZ,
    error           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX idx_webhook_events_processed ON webhook_events(processed);

-- ============================================================
-- API KEYS
-- ============================================================
CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by      UUID REFERENCES users(id),
    name            VARCHAR(100) NOT NULL,
    key_hash        TEXT UNIQUE NOT NULL,     -- bcrypt hash of actual key
    key_prefix      VARCHAR(20) NOT NULL,     -- e.g., "wge_live_xxxx" for display
    last_used_at    TIMESTAMPTZ,
    is_active       BOOLEAN DEFAULT TRUE,
    scopes          TEXT[] DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_api_keys_org_id ON api_keys(org_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    user_id         UUID REFERENCES users(id),
    action          VARCHAR(100) NOT NULL,
    resource_type   VARCHAR(100),
    resource_id     UUID,
    metadata        JSONB DEFAULT '{}',
    ip_address      INET,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_logs_org_id ON audit_logs(org_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================================
-- ROW-LEVEL SECURITY (Enable for all tenant tables)
-- ============================================================
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Policy example (application sets app.current_org_id):
CREATE POLICY contacts_isolation ON contacts
    USING (org_id = current_setting('app.current_org_id')::UUID);

CREATE POLICY campaigns_isolation ON campaigns
    USING (org_id = current_setting('app.current_org_id')::UUID);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_contacts_updated BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_campaigns_updated BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_conversations_updated BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
