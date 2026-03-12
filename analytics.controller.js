// controllers/analytics.controller.js

// ─── Helpers ──────────────────────────────────────────────────────
function orgRef(orgId) {
  return global.db.collection('organizations').doc(orgId);
}

// ══════════════════════════════════════════════════════════════════
// GET /api/v1/analytics/dashboard
// Main dashboard stats — overview of everything
// ══════════════════════════════════════════════════════════════════
async function getDashboard(req, res) {
  try {
    const db    = global.db;
    const orgId = req.orgId;

    // Run all queries in parallel for speed
    const [
      orgDoc,
      contactsSnap,
      campaignsSnap,
      leadsSnap,
      recentCampaignsSnap,
    ] = await Promise.all([
      orgRef(orgId).get(),
      orgRef(orgId).collection('contacts').count().get(),
      orgRef(orgId).collection('campaigns').count().get(),
      orgRef(orgId).collection('leads').get(),
      orgRef(orgId).collection('campaigns')
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get(),
    ]);

    const org            = orgDoc.data();
    const totalContacts  = contactsSnap.data().count;
    const totalCampaigns = campaignsSnap.data().count;

    // Lead breakdown by label
    const leadCounts = { hot: 0, warm: 0, cold: 0, total: leadsSnap.size };
    leadsSnap.docs.forEach(d => {
      const label = d.data().scoreLabel || 'cold';
      leadCounts[label] = (leadCounts[label] || 0) + 1;
    });

    // Sum up all campaign message stats
    let totalSent      = 0;
    let totalDelivered = 0;
    let totalRead      = 0;
    let totalReplies   = 0;
    let totalFailed    = 0;

    const recentCampaigns = recentCampaignsSnap.docs.map(d => {
      const c = { id: d.id, ...d.data() };
      totalSent      += c.sentCount      || 0;
      totalDelivered += c.deliveredCount || 0;
      totalRead      += c.readCount      || 0;
      totalReplies   += c.replyCount     || 0;
      totalFailed    += c.failedCount    || 0;
      return {
        id:            c.id,
        name:          c.name,
        status:        c.status,
        sentCount:     c.sentCount      || 0,
        deliveredCount:c.deliveredCount || 0,
        readCount:     c.readCount      || 0,
        replyCount:    c.replyCount     || 0,
        createdAt:     c.createdAt,
      };
    });

    // Calculate rates
    const deliveryRate = totalSent > 0
      ? ((totalDelivered / totalSent) * 100).toFixed(1)
      : '0';
    const readRate = totalDelivered > 0
      ? ((totalRead / totalDelivered) * 100).toFixed(1)
      : '0';
    const replyRate = totalSent > 0
      ? ((totalReplies / totalSent) * 100).toFixed(1)
      : '0';

    // Unread conversations count
    const unreadSnap = await orgRef(orgId)
      .collection('conversations')
      .where('unreadCount', '>', 0)
      .count()
      .get();

    res.json({
      overview: {
        totalContacts,
        totalCampaigns,
        totalSent,
        totalDelivered,
        totalRead,
        totalReplies,
        totalFailed,
        deliveryRate: deliveryRate + '%',
        readRate:     readRate     + '%',
        replyRate:    replyRate    + '%',
        unreadChats:  unreadSnap.data().count,
      },
      usage: {
        plan:          org.plan,
        messageLimit:  org.messageLimit,
        messagesUsed:  org.messagesUsed,
        remaining:     org.messageLimit - org.messagesUsed,
        usagePercent:  ((org.messagesUsed / org.messageLimit) * 100).toFixed(1) + '%',
      },
      leads: leadCounts,
      recentCampaigns,
    });

  } catch (err) {
    console.error('getDashboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /api/v1/analytics/campaigns/:id
// Detailed stats for one campaign
// ══════════════════════════════════════════════════════════════════
async function getCampaignAnalytics(req, res) {
  try {
    const db    = global.db;
    const orgId = req.orgId;

    const campaignDoc = await orgRef(orgId)
      .collection('campaigns')
      .doc(req.params.id)
      .get();

    if (!campaignDoc.exists) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = { id: campaignDoc.id, ...campaignDoc.data() };

    // Get all messages for this campaign
    const msgsSnap = await orgRef(orgId)
      .collection('messages')
      .where('campaignId', '==', campaign.id)
      .get();

    // Build status breakdown
    const breakdown = {
      queued:    0,
      sent:      0,
      delivered: 0,
      read:      0,
      replied:   0,
      failed:    0,
    };

    msgsSnap.docs.forEach(d => {
      const status = d.data().status || 'queued';
      breakdown[status] = (breakdown[status] || 0) + 1;
    });

    // Calculate rates
    const sent      = campaign.sentCount      || 0;
    const delivered = campaign.deliveredCount || 0;
    const read      = campaign.readCount      || 0;
    const replies   = campaign.replyCount     || 0;
    const failed    = campaign.failedCount    || 0;
    const total     = campaign.totalContacts  || 1;

    const rates = {
      deliveryRate: sent > 0      ? ((delivered / sent)      * 100).toFixed(1) + '%' : '0%',
      readRate:     delivered > 0 ? ((read      / delivered)  * 100).toFixed(1) + '%' : '0%',
      replyRate:    sent > 0      ? ((replies   / sent)       * 100).toFixed(1) + '%' : '0%',
      failureRate:  total > 0     ? ((failed    / total)      * 100).toFixed(1) + '%' : '0%',
    };

    // Build hourly timeline from message sentAt timestamps
    const timeline = {};
    msgsSnap.docs.forEach(d => {
      const data = d.data();
      if (data.sentAt) {
        const hour = data.sentAt.slice(0, 13); // "2025-03-12T10"
        timeline[hour] = (timeline[hour] || 0) + 1;
      }
    });

    // Convert to array sorted by time
    const timelineArray = Object.entries(timeline)
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    res.json({
      campaign: {
        id:            campaign.id,
        name:          campaign.name,
        status:        campaign.status,
        templateName:  campaign.templateName,
        totalContacts: campaign.totalContacts,
        startedAt:     campaign.startedAt,
        completedAt:   campaign.completedAt,
        createdAt:     campaign.createdAt,
        goal:          campaign.goal,
      },
      counts: { sent, delivered, read, replies, failed },
      rates,
      breakdown,
      timeline: timelineArray,
    });

  } catch (err) {
    console.error('getCampaignAnalytics error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /api/v1/analytics/overview
// Last 7 days daily breakdown
// ══════════════════════════════════════════════════════════════════
async function getOverview(req, res) {
  try {
    const db    = global.db;
    const orgId = req.orgId;

    // Get campaigns from last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const campaignsSnap = await orgRef(orgId)
      .collection('campaigns')
      .where('createdAt', '>=', sevenDaysAgo)
      .get();

    // Build daily stats
    const dailyStats = {};

    // Init last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key  = date.toISOString().slice(0, 10); // YYYY-MM-DD
      dailyStats[key] = {
        date: key,
        sent:      0,
        delivered: 0,
        read:      0,
        replies:   0,
      };
    }

    campaignsSnap.docs.forEach(d => {
      const c    = d.data();
      const date = (c.createdAt || '').slice(0, 10);
      if (dailyStats[date]) {
        dailyStats[date].sent      += c.sentCount      || 0;
        dailyStats[date].delivered += c.deliveredCount || 0;
        dailyStats[date].read      += c.readCount      || 0;
        dailyStats[date].replies   += c.replyCount     || 0;
      }
    });

    res.json({
      daily: Object.values(dailyStats),
      period: '7 days',
    });

  } catch (err) {
    console.error('getOverview error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /api/v1/analytics/contacts
// Contact growth stats
// ══════════════════════════════════════════════════════════════════
async function getContactStats(req, res) {
  try {
    const db    = global.db;
    const orgId = req.orgId;

    const contactsSnap = await orgRef(orgId)
      .collection('contacts')
      .get();

    const contacts  = contactsSnap.docs.map(d => d.data());
    const total     = contacts.length;
    const optedIn   = contacts.filter(c => c.optIn).length;
    const optedOut  = total - optedIn;

    // By city
    const byCity = {};
    contacts.forEach(c => {
      if (c.city) {
        byCity[c.city] = (byCity[c.city] || 0) + 1;
      }
    });

    // By industry
    const byIndustry = {};
    contacts.forEach(c => {
      if (c.industry) {
        byIndustry[c.industry] = (byIndustry[c.industry] || 0) + 1;
      }
    });

    // By source
    const bySource = {};
    contacts.forEach(c => {
      const src = c.source || 'manual';
      bySource[src] = (bySource[src] || 0) + 1;
    });

    // Top cities sorted
    const topCities = Object.entries(byCity)
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.json({
      total,
      optedIn,
      optedOut,
      optInRate: total > 0 ? ((optedIn / total) * 100).toFixed(1) + '%' : '0%',
      topCities,
      byIndustry,
      bySource,
    });

  } catch (err) {
    console.error('getContactStats error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getDashboard,
  getCampaignAnalytics,
  getOverview,
  getContactStats,
};
