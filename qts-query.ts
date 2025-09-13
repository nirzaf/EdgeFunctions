import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
// --- Array of prompts to be used randomly ---
const PROMPTS = [
  // ... (your prompts remain unchanged)
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
  "How can enterprises benefit from partnering with Quadrate Tech Solutions (quadrate.lk) for large-scale projects?"
];
/**
 * A highly robust function to call the Google AI API with exponential backoff, jitter,
 * retry logic, model fallback, and backup API key support.
 *
 * @param {string} prompt - The prompt to send to the AI.
 * @param {string} apiKey - The primary Google AI API key.
 * @param {string | null} backupApiKey - The backup Google AI API key.
 * @param {object} [config={}] - Configuration for retry logic.
 * @param {number} [config.maxRetries=5] - The maximum number of retries.
 * @param {number} [config.initialDelay=1000] - The initial delay in ms for backoff.
 * @param {string} [config.primaryModel='gemini-1.5-flash'] - The primary model to use.
 * @param {string} [config.fallbackModel='gemini-1.0-pro'] - The model to use if the primary is rate-limited.
 * @returns {Promise<{aiData: object, modelUsed: string, keyUsed: string}>} - A promise that resolves with the AI data.
 */ async function callGenerativeApi(prompt, apiKey, backupApiKey = null, config = {}) {
  const { maxRetries = 5, initialDelay = 1000, primaryModel = 'gemini-2.5-flash', fallbackModel = 'gemini-2.5-flash-lite' } = config;
  const requestBody = {
    tools: [
      {
        google_search: {}
      }
    ],
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ]
  };
  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  };
  /**
   * Attempts the API call with a specific key, including retry logic.
   * @param {string} key - The API key to use.
   * @param {string} keyLabel - 'primary' or 'backup'.
   * @returns {Promise<{aiData: object, modelUsed: string, keyUsed: string}>}
   */ const attemptWithKeyAndRetries = async (key, keyLabel)=>{
    let currentModel = primaryModel;
    let lastError = null;
    for(let attempt = 0; attempt < maxRetries; attempt++){
      // --- Exponential backoff with jitter ---
      if (attempt > 0) {
        const delay = initialDelay * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000; // Add up to 1s of jitter
        const waitTime = Math.round(delay + jitter);
        console.log(`Attempt ${attempt + 1}/${maxRetries}. Waiting for ${waitTime}ms before retrying...`);
        await new Promise((resolve)=>setTimeout(resolve, waitTime));
      }
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${key}`;
      try {
        const response = await fetch(apiUrl, requestOptions);
        if (response.ok) {
          const aiData = await response.json();
          return {
            aiData,
            modelUsed: currentModel,
            keyUsed: keyLabel
          };
        }
        // --- Handle different HTTP errors ---
        if (response.status === 429) {
          console.warn(`Rate limit exceeded (429) on attempt ${attempt + 1} with ${currentModel}.`);
          // On rate limit, immediately switch to the fallback model for the next retry
          if (currentModel !== fallbackModel) {
            console.log(`Switching to fallback model: ${fallbackModel}`);
            currentModel = fallbackModel;
          }
          lastError = new Error(`API rate limit exceeded (${response.status})`);
          continue; // Proceed to the next retry attempt
        } else if (response.status >= 500) {
          console.warn(`Server error (${response.status}) on attempt ${attempt + 1}.`);
          lastError = new Error(`API server error (${response.status})`);
          continue; // Proceed to the next retry attempt
        } else {
          // For 4xx client errors (other than 429), retrying is useless. Fail fast.
          const errorBody = await response.json().catch(()=>({
              error: {
                message: "Failed to parse error response."
              }
            }));
          throw new Error(`Non-retryable Google AI API error (${response.status}): ${errorBody.error.message}`);
        }
      } catch (error) {
        lastError = error;
        // If it's a non-retryable error, it would have been thrown from the block above.
        // This catch block will mostly handle network errors or the re-thrown error.
        if (error.message.startsWith('Non-retryable')) {
          throw error; // Immediately exit if it's a client-side error.
        }
        console.warn(`Fetch error on attempt ${attempt + 1}: ${error.message}`);
      }
    }
    // If the loop completes without a successful return, throw the last known error.
    throw new Error(`Failed to call API with ${keyLabel} key after ${maxRetries} attempts. Last error: ${lastError.message}`);
  };
  // --- Main execution flow ---
  try {
    // 1. Try with the primary key and all its retries
    console.log("Attempting API call with primary key...");
    return await attemptWithKeyAndRetries(apiKey, 'primary');
  } catch (primaryError) {
    console.error(`Primary key failed after all retries: ${primaryError.message}`);
    // 2. If primary fails and a backup key exists, try the backup key with all its retries
    if (backupApiKey) {
      console.log("Attempting API call with backup key...");
      try {
        return await attemptWithKeyAndRetries(backupApiKey, 'backup');
      } catch (backupError) {
        console.error(`Backup key also failed after all retries: ${backupError.message}`);
        throw new Error(`Both API keys failed. Primary: ${primaryError.message}. Backup: ${backupError.message}`);
      }
    }
    // 3. If no backup key, re-throw the original error.
    throw primaryError;
  }
}
// --- Deno Server ---
console.info('Server started');
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    console.log(`Selected prompt: "${prompt}"`);
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase URL or Service Key is not configured.");
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    const geminiBackupApiKey = Deno.env.get('GEMINI_API_BACKUP_KEY');
    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not set in Supabase secrets.");
    }
    // Call the new robust function. We can optionally pass a config.
    const { aiData, modelUsed, keyUsed } = await callGenerativeApi(geminiApiKey, geminiBackupApiKey, {
      maxRetries: 4,
      initialDelay: 1500
    });
    const aiResponseText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiResponseText) {
      throw new Error("Could not extract text from the AI's response.");
    }
    const { data: insertData, error: insertError } = await supabase.from('gemini_responses').insert({
      prompt: prompt,
      response: aiResponseText,
      grounding_metadata: aiData.candidates?.[0]?.groundingMetadata || null,
      model_used: modelUsed,
      created_at: new Date().toISOString()
    }).select('id').single();
    if (insertError) {
      throw new Error(`Database insert error: ${insertError.message}`);
    }
    console.log(`Successfully inserted response (ID: ${insertData.id}) using model: ${modelUsed} with ${keyUsed} API key`);
    return new Response(JSON.stringify({
      status: "success",
      replyId: insertData.id
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error("Error processing request:", error.message);
    return new Response(JSON.stringify({
      status: "error",
      message: "Failed to process request",
      details: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
