const express = require("express");
const { Task } = require("../models");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

/**
 * AI-Augmented Dependency Suggestion.
 *
 * Grounding technique used to reduce hallucination:
 *  1. We only ever give the model the EXISTING task ids + titles + short
 *     descriptions that are actually in the database (closed-world list),
 *     and explicitly instruct it to choose only from that list.
 *  2. We force strict JSON output (id, confidence, reasoning) — no free text.
 *  3. After the model responds, we re-validate every suggested id against
 *     the real task list server-side and silently drop anything that
 *     doesn't exist (a hallucinated id can never reach the client).
 *  4. Nothing here writes to the `dependencies` table. Suggestions are
 *     advisory only — a human must explicitly accept each one in the UI,
 *     which then goes through the normal POST /tasks/:id/dependencies
 *     endpoint (same cycle-check as any manual edge).
 */
router.post("/suggest-dependencies", asyncHandler(async (req, res) => {
  const { title, description } = req.body;
  if (!title || typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "title is required" });
  }

  const existing = (await Task.findAll()).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
  }));

  if (existing.length === 0) {
    return res.json({ suggestions: [] });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(501).json({
      error:
        "ANTHROPIC_API_KEY is not set on the server. Add it to backend/.env to enable AI suggestions.",
    });
  }

  const prompt = `You are helping plan a project's task dependency graph.

New task:
Title: ${title}
Description: ${description || "(none)"}

Existing tasks (this is the COMPLETE list of tasks that may be chosen as prerequisites — do not invent or reference any task outside this list):
${existing
  .map((t) => `- id: ${t.id} | title: "${t.title}" | description: "${t.description || ""}"`)
  .join("\n")}

Which of the existing tasks above (if any) are likely PREREQUISITES of the new task — i.e. work that logically must finish before the new task can start? Only suggest a dependency when there is a clear logical or technical reason (e.g. "API" before "integration tests", "schema" before "API").

Respond with ONLY a JSON object, no markdown fences, no commentary, in exactly this shape:
{"suggestions": [{"id": "<one of the ids above>", "confidence": <0 to 1 number>, "reasoning": "<one short sentence>"}]}

If nothing is a plausible prerequisite, respond with {"suggestions": []}.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    let parsed = { suggestions: [] };
    if (textBlock) {
      const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { suggestions: [] };
      }
    }

    // Re-ground: drop any suggestion whose id isn't a real, current task.
    const validIds = new Set(existing.map((t) => t.id));
    const suggestions = (parsed.suggestions || [])
      .filter((s) => validIds.has(s.id))
      .map((s) => ({
        ...s,
        title: existing.find((t) => t.id === s.id)?.title,
      }));

    res.json({ suggestions });
  } catch (err) {
    console.error("AI suggestion error:", err);
    res.status(502).json({ error: "AI suggestion request failed" });
  }
}));

module.exports = router;
