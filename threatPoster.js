const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function generateThreatBrief({ summary }) {
  try {
    const res = await openai.responses.create({
      model: "gpt-5.2",
      input: `
Write a short crypto threat alert.

No emojis.
No hashtags.
Professional tone.
Max 220 chars.

Summary:
${JSON.stringify(summary)}
`
    });

    return res.output_text.trim();
  } catch {
    return "Threat brief: recurring lure is outbound-link spam with low-context prompts and mass tagging. Treat unknown URLs as hostile until verified via official channels; avoid wallet connects from broadcast posts. $F007";
  }
}

module.exports = { generateThreatBrief };