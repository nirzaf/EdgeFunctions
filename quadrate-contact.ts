import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// --- Configuration for the retry mechanism ---
const RETRY_CONFIG = {
  maxRetries: 2,
  initialDelay: 1000,
  maxDelay: 8000
};
/**
 * A more robust API calling function with exponential backoff and jitter.
 * @param {string} prompt - The prompt to send.
 * @param {string} geminiApiKey - The API key.
 * @returns {Promise<{aiData: object, modelUsed: string}>}
 */ async function callGenerativeApiWithRetry(prompt, geminiApiKey) {
  let model = 'gemini-2.5-flash';
  for(let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++){
    // On the first retry (attempt 1), switch to the lighter model
    if (attempt === 1) {
      console.warn("Initial model failed or was rate-limited. Switching to gemini-2.5-flash-lite.");
      model = 'gemini-2.5-flash-lite';
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
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
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      // If the response is successful (2xx), parse and return it.
      if (response.ok) {
        const aiData = await response.json();
        return {
          aiData,
          modelUsed: model
        };
      }
      // Identify which errors are temporary and thus "retryable".
      const isRetryable = [
        429,
        500,
        503
      ].includes(response.status);
      if (isRetryable && attempt < RETRY_CONFIG.maxRetries) {
        // Calculate delay with exponential backoff
        const exponentialDelay = Math.pow(2, attempt) * RETRY_CONFIG.initialDelay;
        // Add jitter (randomness) to prevent thundering herd
        const jitter = Math.random() * RETRY_CONFIG.initialDelay;
        const delay = Math.min(exponentialDelay + jitter, RETRY_CONFIG.maxDelay);
        console.warn(`Attempt ${attempt + 1} failed with status ${response.status}. Retrying in ${delay.toFixed(0)}ms...`);
        await new Promise((resolve)=>setTimeout(resolve, delay));
      } else {
        // If the error is not retryable or we've run out of retries, throw an error.
        const errorBody = await response.json().catch(()=>({
            error: {
              message: "Failed to parse error response."
            }
          }));
        throw new Error(`Non-retryable Google AI API error (${response.status}): ${errorBody.error.message}`);
      }
    } catch (error) {
      // Handle network errors or other exceptions
      if (attempt < RETRY_CONFIG.maxRetries) {
        console.warn(`Attempt ${attempt + 1} failed with network error: ${error.message}. Retrying...`);
        const delay = Math.pow(2, attempt) * RETRY_CONFIG.initialDelay + Math.random() * 1000;
        await new Promise((resolve)=>setTimeout(resolve, delay));
      } else {
        throw new Error(`Failed to communicate with Google AI API after ${RETRY_CONFIG.maxRetries + 1} attempts: ${error.message}`);
      }
    }
  }
  // This line should not be reachable, but it prevents linting errors.
  throw new Error("API call failed after all retry attempts.");
}
console.info('server started');
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { prompt } = await req.json();
    if (!prompt) {
      throw new Error("Missing 'prompt' in request body.");
    }
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not set in Supabase secrets.");
    }
    const { aiData, modelUsed } = await callGenerativeApiWithRetry(prompt, geminiApiKey);
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
    console.log(`Successfully inserted response (ID: ${insertData.id}) using model: ${modelUsed}`);
    const response = {
      reply: insertData.id
    };
    return new Response(JSON.stringify(response), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("Error processing request:", error.message);
    return new Response(JSON.stringify({
      error: "Failed to process request",
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
