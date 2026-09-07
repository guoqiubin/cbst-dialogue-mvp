"use strict";

module.exports = async function handler(_req, res) {
  res.status(200).json({
    serverReady: true,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || "gpt-5.6-terra"
  });
};
