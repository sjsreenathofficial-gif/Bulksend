const OpenAI = require('openai');
const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── CAMPAIGN GENERATOR ────────────────────────────────────────────

/**
 * Generate a WhatsApp campaign from a goal description
 */
async function generateCampaign({ goal, industry, targetAudience, tone = 'professional', orgName }) {
  const prompt = `You are a WhatsApp marketing expert for Indian businesses.

Organization: ${orgName}
Industry: ${industry || 'General'}
Target Audience: ${targetAudience || 'potential customers'}
Campaign Goal: ${goal}
Tone: ${tone}

Generate a WhatsApp marketing campaign. Return ONLY valid JSON with this structure:
{
  "campaignName": "string",
  "mainMessage": {
    "body": "WhatsApp message body (max 1024 chars, use {{1}} for customer name variable)",
    "footer": "optional footer text",
    "ctaText": "Call to action button text",
    "ctaUrl": "placeholder URL or phone number"
  },
  "followUpMessages": [
    {
      "delayHours": 24,
      "body": "Follow-up message body",
      "purpose": "reason for this follow-up"
    },
    {
      "delayHours": 72,
      "body": "Second follow-up body",
      "purpose": "final nudge"
    }
  ],
  "suggestedSegmentation": {
    "tags": [],
    "industries": [],
    "notes": "who to target"
  },
  "bestSendTime": "HH:MM in IST",
  "estimatedConversionRate": "X-Y%"
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 1500,
  });

  return JSON.parse(response.choices[0].message.content);
}

// ─── LEAD SCORING ─────────────────────────────────────────────────

const SCORING_RULES = {
  message_replied: 30,
  link_clicked: 20,
  multiple_messages_received: 10,
  profile_complete: 10,
  email_provided: 10,
  campaign_opened_multiple: 15,
  opted_in_recently: 5,
  long_message_sent: 10,
};

/**
 * Score a lead based on their behavior
 */
async function scoreLead(leadId, orgId) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      contact: {
        include: {
          chatMessages: { where: { direction: 'inbound' }, take: 20 },
          campaignMessages: { take: 50 },
        },
      },
    },
  });

  if (!lead) return null;

  let score = lead.score || 0;
  const reasons = [];

  const inboundCount = lead.contact?.chatMessages?.length || 0;
  const deliveredCount = lead.contact?.campaignMessages?.filter(m => m.status === 'delivered')?.length || 0;
  const readCount = lead.contact?.campaignMessages?.filter(m => m.status === 'read')?.length || 0;

  if (inboundCount > 0) { score += SCORING_RULES.message_replied; reasons.push('Replied to messages'); }
  if (readCount > 2) { score += SCORING_RULES.campaign_opened_multiple; reasons.push('Opened multiple campaigns'); }
  if (lead.contact?.email) { score += SCORING_RULES.email_provided; reasons.push('Email provided'); }
  if (lead.contact?.name) { score += SCORING_RULES.profile_complete; reasons.push('Profile complete'); }

  // Cap at 100
  score = Math.min(score, 100);

  const scoreLabel = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';

  await prisma.lead.update({
    where: { id: leadId },
    data: { score, scoreLabel },
  });

  // Record score history
  if (reasons.length > 0) {
    await prisma.leadScore.create({
      data: { leadId, orgId, score, reason: reasons.join(', ') },
    });
  }

  return { score, scoreLabel, reasons };
}

/**
 * AI-powered lead analysis
 */
async function analyzeLeadWithAI(lead, conversationHistory) {
  const conversation = conversationHistory
    .slice(-10)
    .map(m => `${m.direction === 'inbound' ? 'Customer' : 'Bot'}: ${m.content}`)
    .join('\n');

  const prompt = `Analyze this WhatsApp conversation and score the lead.

Lead Info:
- Name: ${lead.name || 'Unknown'}
- Industry: ${lead.industry || 'Unknown'}
- Messages sent by customer: ${conversationHistory.filter(m => m.direction === 'inbound').length}

Recent conversation:
${conversation}

Return JSON only:
{
  "score": 0-100,
  "label": "hot|warm|cold",
  "intent": "buying|researching|just_browsing|not_interested",
  "urgency": "high|medium|low",
  "nextAction": "what the sales team should do next",
  "keyInsights": ["insight 1", "insight 2"]
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 500,
  });

  return JSON.parse(response.choices[0].message.content);
}

// ─── CHATBOT ENGINE ───────────────────────────────────────────────

/**
 * Generate AI chatbot response
 */
async function generateChatbotReply({ orgId, contactId, incomingMessage, conversationHistory, orgContext }) {
  const recentHistory = conversationHistory.slice(-8).map(m => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.content,
  }));

  const systemPrompt = `You are a helpful WhatsApp customer service assistant for ${orgContext.orgName}, an ${orgContext.industry || 'Indian'} business.

Your role:
1. Answer customer questions about products/services
2. Collect lead information (name, email, requirement) naturally in conversation
3. Qualify the lead's intent and urgency
4. Escalate to a human agent when needed (use [ESCALATE] tag)

Rules:
- Keep responses SHORT (1-3 sentences max for WhatsApp)
- Be conversational and friendly in ${orgContext.language || 'English'} (mix Hindi/Telugu phrases if appropriate for Indian customers)
- If customer provides name/email/phone/budget — acknowledge it
- If customer seems frustrated — use [ESCALATE]
- Don't make up product details you don't know

Business Context: ${orgContext.businessDescription || 'We provide quality products and services.'}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      ...recentHistory,
      { role: 'user', content: incomingMessage },
    ],
    temperature: 0.6,
    max_tokens: 300,
  });

  const reply = response.choices[0].message.content;
  const shouldEscalate = reply.includes('[ESCALATE]');
  const cleanReply = reply.replace('[ESCALATE]', '').trim();

  // Extract lead info from conversation
  const leadInfo = extractLeadInfo(incomingMessage, recentHistory);

  return {
    reply: cleanReply,
    shouldEscalate,
    leadInfo,
  };
}

/**
 * Extract lead information from message text
 */
function extractLeadInfo(message) {
  const info = {};

  // Email
  const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) info.email = emailMatch[0];

  // Budget mentions (₹ or lakhs)
  const budgetMatch = message.match(/₹[\d,]+|(\d+)\s*(lakh|lakhs|lac|k|thousand)/i);
  if (budgetMatch) info.budgetMention = budgetMatch[0];

  // Name detection (simple heuristic: "I am X" or "my name is X")
  const nameMatch = message.match(/(?:I am|my name is|I'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (nameMatch) info.name = nameMatch[1];

  return Object.keys(info).length > 0 ? info : null;
}

// ─── MESSAGE PERSONALIZATION ──────────────────────────────────────

/**
 * AI-powered message personalization at scale
 */
async function personalizeMessage({ template, contactData, campaignGoal }) {
  const prompt = `Personalize this WhatsApp template for a specific customer.

Template: "${template}"
Customer Name: ${contactData.name || 'Customer'}
Customer City: ${contactData.city || 'India'}
Customer Industry: ${contactData.industry || 'Business'}
Campaign Goal: ${campaignGoal}

Return a personalized version of the message. Keep it natural and concise. Return just the message text.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_tokens: 500,
  });

  return response.choices[0].message.content.trim();
}

module.exports = {
  generateCampaign,
  scoreLead,
  analyzeLeadWithAI,
  generateChatbotReply,
  personalizeMessage,
  extractLeadInfo,
};
