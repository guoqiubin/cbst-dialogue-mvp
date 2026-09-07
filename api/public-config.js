"use strict";

module.exports = async function handler(req, res) {
  const url = process.env.SUPABASE_URL || "";
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || "";

  res.status(200).json({
    cloudSyncEnabled: Boolean(url && publishableKey),
    supabaseUrl: url,
    supabasePublishableKey: publishableKey
  });
};
