// ═══════════════════════════════════════════
//  GYAN AI — AI Engine (Groq)
//  File: ai.js
// ═══════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── GROQ API CALL ──
async function callGroq(prompt, systemPrompt) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama3-70b-8192',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 4096,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Groq API error');
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ── SYSTEM PROMPT ──
const SYSTEM_PROMPT = `You are Gyan AI — an expert web developer. 
Your job is to generate complete, beautiful, working web apps based on user descriptions.

RULES:
1. Always return ONLY valid HTML code — no markdown, no backticks, no explanation
2. Include all CSS inside <style> tags
3. Include all JavaScript inside <script> tags  
4. Make it fully responsive (mobile-friendly)
5. Use a beautiful modern dark theme by default
6. Include meaningful content based on the description
7. Make it production-ready and professional
8. Add subtle animations and good UX
9. Support Hindi and English text

The output must be a single complete HTML file that works standalone.`;

// ── GENERATE WEB APP ──
router.post('/generate', async (req, res) => {
  try {
    const { prompt, userId, projectId } = req.body;

    if (!prompt || !userId) {
      return res.status(400).json({ error: 'Prompt and userId are required' });
    }

    if (!prompt.trim() || prompt.length < 5) {
      return res.status(400).json({ error: 'Please describe your app in more detail' });
    }

    // Check credits
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('credits, plan')
      .eq('id', userId)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Premium users skip credit check
    if (user.plan === 'free') {
      if (user.credits < 5) {
        return res.status(403).json({
          error: 'Not enough credits',
          credits: user.credits,
          needed: 5,
          message: 'You need 5 credits to build an app. Get 1 credit per day, or upgrade to Premium!'
        });
      }
    }

    // Generate code
    console.log(`[AI] Generating app for user ${userId}: "${prompt.substring(0, 50)}..."`);
    const generatedCode = await callGroq(prompt, SYSTEM_PROMPT);

    // Deduct credits for free users
    if (user.plan === 'free') {
      await supabase
        .from('users')
        .update({ credits: user.credits - 5 })
        .eq('id', userId);
    }

    // Save to database
    const appData = {
      user_id: userId,
      project_id: projectId || null,
      prompt: prompt,
      code: generatedCode,
      status: 'draft',
      created_at: new Date().toISOString()
    };

    const { data: savedApp, error: saveErr } = await supabase
      .from('apps')
      .insert(appData)
      .select()
      .single();

    if (saveErr) {
      console.error('[DB] Save error:', saveErr);
    }

    res.json({
      success: true,
      code: generatedCode,
      appId: savedApp?.id || null,
      creditsRemaining: user.plan === 'free' ? user.credits - 5 : null
    });

  } catch (err) {
    console.error('[AI] Error:', err.message);

    // Fallback to OpenRouter if Groq fails
    if (err.message.includes('Groq')) {
      try {
        const fallback = await callOpenRouter(req.body.prompt);
        return res.json({ success: true, code: fallback, fallback: true });
      } catch (fallbackErr) {
        return res.status(500).json({ error: 'AI service temporarily unavailable. Please try again.' });
      }
    }

    res.status(500).json({ error: err.message });
  }
});

// ── EDIT APP (Chat) ──
router.post('/edit', async (req, res) => {
  try {
    const { currentCode, editPrompt, userId } = req.body;

    if (!currentCode || !editPrompt || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const editSystemPrompt = `You are Gyan AI. The user has an existing web app and wants to make changes.
    
Current HTML code:
${currentCode}

RULES:
1. Make ONLY the requested changes
2. Return the COMPLETE updated HTML — not just the changed part
3. Keep all existing functionality intact
4. Return ONLY the HTML code, no explanation`;

    const updatedCode = await callGroq(editPrompt, editSystemPrompt);

    res.json({ success: true, code: updatedCode });

  } catch (err) {
    console.error('[AI Edit] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── OPENROUTER FALLBACK ──
async function callOpenRouter(prompt) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://gyan-ai.tech'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3-70b-instruct',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 4096
    })
  });

  if (!response.ok) throw new Error('OpenRouter error');
  const data = await response.json();
  return data.choices[0].message.content;
}

module.exports = router;
