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
 * A robust function to call the Google AI API with built-in retry logic.
 * @param {string} prompt - The prompt to send to the AI.
 * @param {string} apiKey - The Google AI API key.
 * @returns {Promise<{aiData: object, modelUsed: string}>} - A promise that resolves with the AI data and the model that was used.
 */
async function callGenerativeApi(prompt, apiKey) {
  let model = 'gemini-2.5-flash';
  let apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody = {
    tools: [{ google_search: {} }],
    contents: [{ parts: [{ text: prompt }] }],
  };

  const requestOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  };

  try {
    let response = await fetch(apiUrl, requestOptions);

    // If rate-limited, wait 3 seconds and retry with the lite model
    if (response.status === 429) {
      console.warn(`Rate limit exceeded with ${model}. Retrying with gemini-1.5-flash-lite in 3 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 3000));

      model = 'gemini-2.5-flash-lite';
      apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      
      response = await fetch(apiUrl, requestOptions);
    }

    // If the response is still not OK after potential retry, throw an error
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: { message: "Failed to parse error response." } }));
      throw new Error(`Google AI API error (${response.status}): ${errorBody.error.message}`);
    }

    const aiData = await response.json();
    return { aiData, modelUsed: model };

  } catch (error) {
    // Gracefully handle network errors or other fetch-related issues
    console.error("Error during Google AI API call:", error.message);
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
    

    // 3. Get Gemini API Key
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not set in Supabase secrets.");
    }

    // 4. Call the robust API function
    const { aiData, modelUsed } = await callGenerativeApi(prompt, geminiApiKey);

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

    console.log(`Successfully inserted response (ID: ${insertData.id}) using model: ${modelUsed}`);

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