import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/// <reference types="https://deno.land/x/deno/lib/deno.ns.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
console.info('server started');
Deno.serve(async (req) => {
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
        // Use 'let' to allow the model to be changed on retry
        let model = 'gemini-2.5-flash';
        let apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
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
        let aiApiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        // Check for rate limit error (429) and retry with the lite model
        if (aiApiResponse.status === 429) {
            console.warn("Google AI API rate limit exceeded. Retrying with gemini-2.5-flash-lite after 3 seconds...");
            await new Promise((resolve) => setTimeout(resolve, 3000));
            // Switch to the lite model for the retry attempt
            model = 'gemini-2.5-flash-lite';
            apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
            console.log(`Retrying with new URL: ${apiUrl}`);
            aiApiResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
        }
        if (!aiApiResponse.ok) {
            const errorBody = await aiApiResponse.json();
            throw new Error(`Google AI API error: ${errorBody.error.message}`);
        }
        const aiData = await aiApiResponse.json();
        const aiResponseText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!aiResponseText) {
            throw new Error("Could not extract text from the AI's response.");
        }
        // The 'model' variable will now correctly reflect which model was successfully used
        const { data: insertData, error: insertError } = await supabase.from('gemini_responses').insert({
            prompt: prompt,
            response: aiResponseText,
            grounding_metadata: aiData.candidates?.[0]?.groundingMetadata || null,
            model_used: model,
            created_at: new Date().toISOString()
        }).select().single();
        if (insertError) {
            console.error('Database insert error:', insertError);
        } else {
            console.log(`Successfully inserted response to database (ID: ${insertData?.id}) using model: ${model}`);
        }
        const response = {
            reply: insertData?.id || null
        };
        return new Response(JSON.stringify(response), {
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error("Error processing request:", error);
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
