// ai/aiEngine.js
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ══════════════════════════════════════════════════════════════════
// 1. AI CAMPAIGN GENERATOR
// Input: campaign goal in plain language
// Output: ready-to-use WhatsApp messages + strategy
// ══════════════════════════════════════════════════════════════════
async function generateCampaign({ goal, orgName, industry, targetAudience, tone = 'friendly' }) {
  try {
    const prompt = `You are a WhatsApp marketing expert for Indian businesses.

Business Name: ${orgName}
Industry: ${industry || 'General Business'}
Target Audience: ${targetAudience || 'potential customers in India'}
Campaign Goal: ${goal}
Message Tone: ${tone}

Create a complete WhatsApp marketing campaign. 
Return ONLY valid JSON — no extra text, no markdown.

{
  "campaignName": "short catchy name",
  "mainMessage": {
    "body": "Main WhatsApp message. Use {{1}} for customer name. Max 200 words. Use emojis naturally. Write in simple Indian English.",
    "footer": "short footer like company name or tagline",
    "ctaText": "button text like 'Know More' or 'Book Now'",
    "ctaUrl": "https://wa.me/91XXXXXXXXXX"
  },
  "followUpMessages": [
    {
      "delayHours": 24,
      "body": "First follow-up message after 24 hours",
      "purpose": "remind and add urgency"
    },
    {
      "delayHours": 72,
      "body": "Second follow-up after 3 days",
      "purpose": "final offer or closing"
    }
  ],
  "targetingTips": {
    "bestTags": ["tag1", "tag2"],
    "bestCities": ["Hyderabad", "Vijayawada"],
    "avoidSending": "tips on who not to target"
  },
  "bestSendTime": "10:00 AM IST on weekdays",
  "estimatedConversionRate": "8-12%",
  "whyThisWorks": "brief explanation of the strategy"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1500,
    });

    const result = JSON.parse(response.choices[0].message.content);
    return { success: true, campaign: result };

  } catch (err) {
    console.error('generateCampaign error:', err.message);
    return { success: false, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════════
// 2. LEAD SCORER
// Scores a lead 0-100 based on their behavior
// Hot (70-100), Warm (40-69), Cold (0-39)
// ══════════════════════════════════════════════════════════════════
async function scoreLead(leadData) {
  try {
    // Rule-based scoring (fast, no API call needed)
    let score = 0;
    const reasons = [];

    // Replied to messages (+30)
    if (leadData.repliedToMessage) {
      score += 30;
      reasons.push('Replied to WhatsApp message');
    }

    // Read multiple campaigns (+15)
    if (leadData.campaignsRead >= 3) {
      score += 15;
      reasons.push('Read 3+ campaigns');
    } else if (leadData.campaignsRead >= 1) {
      score += 8;
      reasons.push('Read campaign messages');
    }

    // Has email (+10)
    if (leadData.email) {
      score += 10;
      reasons.push('Email provided');
    }

    // Has name (+5)
    if (leadData.name) {
      score += 5;
      reasons.push('Name known');
    }

    // Sent long message (+10) — shows interest
    if (leadData.longestMessageLength > 50) {
      score += 10;
      reasons.push('Sent detailed message — high interest');
    }

    // Multiple conversations (+10)
    if (leadData.totalMessages >= 5) {
      score += 10;
      reasons.push('Active in conversation');
    }

    // Recently opted in (+5)
    if (leadData.optedInDaysAgo < 7) {
      score += 5;
      reasons.push('Recently opted in');
    }

    // Mentioned budget (+15) — very hot signal
    if (leadData.mentionedBudget) {
      score += 15;
      reasons.push('Mentioned budget — strong buying signal');
    }

    // Cap at 100
    score = Math.min(score, 100);

    const scoreLabel = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';
    const emoji      = score >= 70 ? '🔥' : score >= 40 ? '🌡️' : '🧊';

    return {
      success: true,
      score,
      scoreLabel,
      emoji,
      reasons,
      nextAction: getNextAction(scoreLabel),
    };

  } catch (err) {
    console.error('scoreLead error:', err.message);
    return { success: false, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════════
// 3. AI LEAD ANALYZER
// Uses GPT to deeply analyze conversation and give insights
// ══════════════════════════════════════════════════════════════════
async function analyzeLead({ leadName, phone, conversationHistory, industry }) {
  try {
    // Format conversation for GPT
    const conversation = conversationHistory
      .slice(-10)
      .map(m => `${m.direction === 'inbound' ? 'Customer' : 'Bot/Agent'}: ${m.content}`)
      .join('\n');

    const prompt = `Analyze this WhatsApp conversation for a ${industry || 'business'} lead.

Customer: ${leadName || 'Unknown'} (${phone})

Conversation:
${conversation}

Return ONLY valid JSON:
{
  "score": 0-100,
  "label": "hot or warm or cold",
  "buyingIntent": "high or medium or low",
  "urgency": "high or medium or low",
  "mainInterest": "what the customer is most interested in",
  "concerns": "any objections or concerns raised",
  "nextBestAction": "exactly what the sales team should do next",
  "suggestedReply": "a short WhatsApp reply to send right now",
  "keyInsights": ["insight 1", "insight 2", "insight 3"]
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 600,
    });

    const result = JSON.parse(response.choices[0].message.content);
    return { success: true, analysis: result };

  } catch (err) {
    console.error('analyzeLead error:', err.message);
    return { success: false, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════════
// 4. AI CHATBOT REPLY GENERATOR
// Generates smart replies to incoming WhatsApp messages
// ══════════════════════════════════════════════════════════════════
async function generateChatbotReply({
  orgName,
  industry,
  businessDescription,
  incomingMessage,
  conversationHistory = [],
  language = 'English',
}) {
  try {
    // Format recent history
    const history = conversationHistory.slice(-6).map(m => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.content || '',
    }));

    const systemPrompt = `You are a helpful WhatsApp customer service assistant for "${orgName}", an ${industry || 'Indian'} business.

Your job:
1. Answer customer questions helpfully and briefly
2. Collect their name, email, and requirement naturally
3. Generate interest in the business
4. Escalate to human agent when needed — add [ESCALATE] at end

Rules:
- Keep replies SHORT — max 3 sentences for WhatsApp
- Be warm and friendly in ${language}
- Mix simple Hindi phrases if customer uses Hindi (like "Ji", "bilkul", "dhanyawad")
- Never make up product prices or details you don't know
- If customer is angry or frustrated — add [ESCALATE]
- If customer asks to speak to human — add [ESCALATE]

Business info: ${businessDescription || `We are ${orgName}, providing quality products and services.`}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: incomingMessage },
      ],
      temperature: 0.6,
      max_tokens: 200,
    });

    const rawReply = response.choices[0].message.content || '';
    const shouldEscalate = rawReply.includes('[ESCALATE]');
    const reply = rawReply.replace('[ESCALATE]', '').trim();

    // Try to extract lead info from the message
    const extractedInfo = extractLeadInfo(incomingMessage);

    return {
      success: true,
      reply,
      shouldEscalate,
      extractedInfo,
    };

  } catch (err) {
    console.error('generateChatbotReply error:', err.message);
    // Fallback reply if OpenAI fails
    return {
      success: false,
      reply: `Thank you for your message! Our team will get back to you shortly. 🙏`,
      shouldEscalate: false,
      extractedInfo: null,
      error: err.message,
    };
  }
}

// ══════════════════════════════════════════════════════════════════
// 5. AI MESSAGE PERSONALIZER
// Makes a template message personal for each contact
// ══════════════════════════════════════════════════════════════════
async function personalizeMessage({ template, contactName, contactCity, contactIndustry, campaignGoal }) {
  try {
    const prompt = `Personalize this WhatsApp message for a specific customer.

Original message: "${template}"
Customer name: ${contactName || 'Customer'}
Customer city: ${contactCity || 'India'}
Customer industry: ${contactIndustry || 'Business'}
Campaign goal: ${campaignGoal || 'promote our services'}

Rules:
- Keep the same meaning and offer
- Make it feel personal and relevant to this customer
- Keep it short and WhatsApp-friendly
- Return ONLY the personalized message text, nothing else`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 300,
    });

    return {
      success: true,
      message: response.choices[0].message.content.trim(),
    };

  } catch (err) {
    console.error('personalizeMessage error:', err.message);
    return { success: false, message: template, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════════
// Helper: extract lead info from message text
// ══════════════════════════════════════════════════════════════════
function extractLeadInfo(message) {
  if (!message) return null;
  const info = {};

  // Email
  const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) info.email = emailMatch[0];

  // Indian phone number
  const phoneMatch = message.match(/(?:^|\s)(\+?91[-\s]?)?[6-9]\d{9}(?:\s|$)/);
  if (phoneMatch) info.phone = phoneMatch[0].trim();

  // Budget mentions (₹ amounts or lakh/crore)
  const budgetMatch = message.match(/₹[\d,]+|(\d+)\s*(lakh|lakhs|lac|crore|k|thousand)/i);
  if (budgetMatch) info.budgetMention = budgetMatch[0];

  // Name (I am X / my name is X)
  const nameMatch = message.match(/(?:I am|my name is|I'm|myself)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i);
  if (nameMatch) info.name = nameMatch[1];

  // Budget indicator
  info.mentionedBudget = !!budgetMatch;

  return Object.keys(info).length > 1 ? info : null;
}

// ══════════════════════════════════════════════════════════════════
// Helper: get next action based on lead score label
// ══════════════════════════════════════════════════════════════════
function getNextAction(scoreLabel) {
  const actions = {
    hot:  '🔥 Call immediately — high buying intent detected',
    warm: '📲 Send follow-up WhatsApp with offer details',
    cold: '📅 Add to nurture campaign — check back in 7 days',
  };
  return actions[scoreLabel] || 'Follow up with the lead';
}

module.exports = {
  generateCampaign,
  scoreLead,
  analyzeLead,
  generateChatbotReply,
  personalizeMessage,
  extractLeadInfo,
};
