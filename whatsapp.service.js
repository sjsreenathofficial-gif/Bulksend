// services/whatsapp.service.js
const axios = require('axios');

const WA_VERSION = 'v18.0';
const WA_BASE    = `https://graph.facebook.com/${WA_VERSION}`;

// ══════════════════════════════════════════════════════════════════
// Send a WhatsApp Template Message
// Used for bulk campaigns (only approved templates allowed)
// ══════════════════════════════════════════════════════════════════
async function sendTemplateMessage({
  accessToken,
  phoneNumberId,
  toPhone,
  templateName,
  languageCode = 'en',
  variables = {},   // { '1': 'Ravi', '2': 'Hyderabad' }
  headerMedia = null, // { type: 'image', url: '...' }
}) {
  try {
    // Build template components
    const components = buildComponents(variables, headerMedia);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toPhone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    };

    const response = await axios.post(
      `${WA_BASE}/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    return {
      success: true,
      messageId: response.data.messages?.[0]?.id,
      waId: response.data.contacts?.[0]?.wa_id,
    };

  } catch (err) {
    const errorData = err.response?.data?.error;
    console.error(`WA send failed to ${toPhone}:`, errorData?.message || err.message);

    return {
      success: false,
      error: errorData?.message || err.message,
      errorCode: errorData?.code,
    };
  }
}

// ══════════════════════════════════════════════════════════════════
// Send a plain text message
// Used for chatbot replies and manual agent messages
// ══════════════════════════════════════════════════════════════════
async function sendTextMessage({
  accessToken,
  phoneNumberId,
  toPhone,
  text,
}) {
  try {
    const response = await axios.post(
      `${WA_BASE}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: {
          body: text,
          preview_url: false,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    return {
      success: true,
      messageId: response.data.messages?.[0]?.id,
    };

  } catch (err) {
    const errorData = err.response?.data?.error;
    console.error(`WA text send failed to ${toPhone}:`, errorData?.message || err.message);

    return {
      success: false,
      error: errorData?.message || err.message,
    };
  }
}

// ══════════════════════════════════════════════════════════════════
// Mark a message as read
// ══════════════════════════════════════════════════════════════════
async function markAsRead({ accessToken, phoneNumberId, messageId }) {
  try {
    await axios.post(
      `${WA_BASE}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 5000,
      }
    );
  } catch (err) {
    // Non-critical — just log it
    console.warn(`Could not mark message ${messageId} as read`);
  }
}

// ══════════════════════════════════════════════════════════════════
// Get WhatsApp Business Profile
// ══════════════════════════════════════════════════════════════════
async function getBusinessProfile({ accessToken, phoneNumberId }) {
  try {
    const response = await axios.get(
      `${WA_BASE}/${phoneNumberId}/whatsapp_business_profile`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { fields: 'about,address,description,email,profile_picture_url,websites,vertical' },
      }
    );
    return { success: true, profile: response.data.data?.[0] };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════════
// Get org credentials from Firestore
// Helper used by controllers
// ══════════════════════════════════════════════════════════════════
async function getOrgCredentials(orgId) {
  const orgDoc = await global.db.collection('organizations').doc(orgId).get();
  if (!orgDoc.exists) throw new Error('Organization not found');

  const org = orgDoc.data();
  if (!org.phoneNumberId || !org.accessToken) {
    throw new Error('WhatsApp not connected. Please configure in Settings.');
  }

  return {
    accessToken: org.accessToken,
    phoneNumberId: org.phoneNumberId,
    wabaId: org.wabaId,
  };
}

// ══════════════════════════════════════════════════════════════════
// Build WhatsApp template components from variables
// ══════════════════════════════════════════════════════════════════
function buildComponents(variables = {}, headerMedia = null) {
  const components = [];

  // Header component (image/video/document)
  if (headerMedia) {
    components.push({
      type: 'header',
      parameters: [{
        type: headerMedia.type,
        [headerMedia.type]: { link: headerMedia.url },
      }],
    });
  }

  // Body component with text variables
  const varKeys = Object.keys(variables);
  if (varKeys.length > 0) {
    // Sort by key to maintain order: '1', '2', '3'
    const sorted = varKeys
      .filter(k => !isNaN(k)) // only numeric keys
      .sort((a, b) => parseInt(a) - parseInt(b));

    if (sorted.length > 0) {
      components.push({
        type: 'body',
        parameters: sorted.map(key => ({
          type: 'text',
          text: String(variables[key]),
        })),
      });
    }
  }

  return components;
}

module.exports = {
  sendTemplateMessage,
  sendTextMessage,
  markAsRead,
  getBusinessProfile,
  getOrgCredentials,
  buildComponents,
};
