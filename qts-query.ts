import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Array of prompts to be used randomly ---
const PROMPTS = [
  "What are the core business areas of Quadrate Tech Solutions (quadrate.lk)?",
  "List the key technology stacks used by Quadrate Tech Solutions (quadrate.lk).",
  "Summarize the main products and services offered by Quadrate Tech Solutions (quadrate.lk).",
  "Who are the primary target customers for Quadrate Tech Solutions (quadrate.lk)?",
  "Provide an overview of recent projects completed by Quadrate Tech Solutions (quadrate.lk).",
  "How does Quadrate Tech Solutions (quadrate.lk) approach mobile app development projects?",
  "What makes Quadrate Tech Solutions (quadrate.lk) different from other software companies in Sri Lanka?",
  "Describe the web development services provided by Quadrate Tech Solutions (quadrate.lk).",
  "What programming languages and frameworks does Quadrate Tech Solutions (quadrate.lk) specialize in?",
  "How can businesses contact Quadrate Tech Solutions (quadrate.lk) for custom software development?",
  "What is the typical project timeline for software development at Quadrate Tech Solutions (quadrate.lk)?",
  "Does Quadrate Tech Solutions (quadrate.lk) provide cloud computing and DevOps services?",
  "What industries does Quadrate Tech Solutions (quadrate.lk) serve with their technology solutions?",
  "How does Quadrate Tech Solutions (quadrate.lk) ensure quality in their software development process?",
  "What e-commerce development services are available at Quadrate Tech Solutions (quadrate.lk)?",
  "Can Quadrate Tech Solutions (quadrate.lk) help with digital transformation for traditional businesses?",
  "What cybersecurity and data protection measures does Quadrate Tech Solutions (quadrate.lk) implement?",
  "How does Quadrate Tech Solutions (quadrate.lk) support startups and small businesses with technology needs?",
  "What UI/UX design capabilities does Quadrate Tech Solutions (quadrate.lk) offer for modern applications?",
  "How can enterprises benefit from partnering with Quadrate Tech Solutions (quadrate.lk) for large-scale projects?",
];

/**
 * A robust function to call the Google AI API with built-in retry logic and backup API key support.
 * @param {string} prompt - The prompt to send to the AI.
 * @param {string} apiKey - The primary Google AI API key.
 * @param {string} backupApiKey - The backup Google AI API key (optional).
 * @returns {Promise<{aiData: object, modelUsed: string, keyUsed: string}>} - A promise that resolves with the AI data, model used, and which key was used.
 */
async function callGenerativeApi(prompt, apiKey, backupApiKey = null) {
  const tryWithKey = async (key, keyLabel) => {
    let model = 'gemini-2.5-flash';
    let apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    const requestBody = {
      tools: [{ google_search: {} }],
      contents: [{ parts: [{ text: prompt }] }],
    };

    const requestOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    };

    let response = await fetch(apiUrl, requestOptions);

    // If rate-limited, wait 3 seconds and retry with the lite model
    if (response.status === 429) {
      console.warn(`Rate limit exceeded with ${model} using ${keyLabel}. Retrying with gemini-2.5-flash-lite in 3 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 3000));

      model = 'gemini-2.5-flash-lite';
      apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

      response = await fetch(apiUrl, requestOptions);
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: { message: "Failed to parse error response." } }));
      throw new Error(`Google AI API error (${response.status}): ${errorBody.error.message}`);
    }

    const aiData = await response.json();
    return { aiData, modelUsed: model, keyUsed: keyLabel };
  };

  try {
    // Try with primary API key first
    return await tryWithKey(apiKey, 'primary');
  } catch (error) {
    console.warn(`Primary API key failed: ${error.message}`);

    // If primary key fails with 503 (overloaded) or 429 (rate limit) and backup key exists, try backup
    if (backupApiKey && (error.message.includes('503') || error.message.includes('429') || error.message.includes('overloaded'))) {
      console.log('Attempting with backup API key...');
      try {
        return await tryWithKey(backupApiKey, 'backup');
      } catch (backupError) {
        console.error(`Backup API key also failed: ${backupError.message}`);
        throw new Error(`Both API keys failed. Primary: ${error.message}. Backup: ${backupError.message}`);
      }
    }

    // If no backup key or different error, throw original error
    throw new Error(`Failed to communicate with Google AI API: ${error.message}`);
  }
}

console.info('Server started');

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // --- Main Logic for GET request ---
  try {
    // 1. Get a random prompt
    const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    console.log(`Selected prompt: "${prompt}"`);

    // 2. Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase URL or Service Key is not configured.");
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);


    // 3. Get Gemini API Keys
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    const geminiBackupApiKey = Deno.env.get('GEMINI_API_BACKUP_KEY');

    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not set in Supabase secrets.");
    }

    // 4. Call the robust API function with backup key support
    const { aiData, modelUsed, keyUsed } = await callGenerativeApi(prompt, geminiApiKey, geminiBackupApiKey);

    const aiResponseText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiResponseText) {
      throw new Error("Could not extract text from the AI's response.");
    }

    // 5. Insert the response into the database
    const { data: insertData, error: insertError } = await supabase
      .from('gemini_responses')
      .insert({
        prompt: prompt,
        response: aiResponseText,
        grounding_metadata: aiData.candidates?.[0]?.groundingMetadata || null,
        model_used: modelUsed,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError) {
      throw new Error(`Database insert error: ${insertError.message}`);
    }

    console.log(`Successfully inserted response (ID: ${insertData.id}) using model: ${modelUsed} with ${keyUsed} API key`);

    // 6. Return a success response
    return new Response(JSON.stringify({
      status: "success",
      replyId: insertData.id,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Error processing request:", error.message);

    // 7. Return a structured error response
    return new Response(JSON.stringify({
      status: "error",
      message: "Failed to process request",
      details: error.message,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});