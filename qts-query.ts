import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Rate limit cooldown duration in milliseconds (45 minutes)
const RATE_LIMIT_COOLDOWN_MS = 45 * 60 * 1000;

class GeminiApiClient {
  config;
  constructor(config = {}) {
    this.config = {
      maxRetries: 3,
      initialDelay: 1000,
      backoffFactor: 2,
      timeoutMs: 15000,
      primaryModel: 'gemini-2.5-flash-lite-preview-09-2025',
      fallbackModel: 'gemini-2.5-flash-lite',
      ...config
    };
  }

  async attemptQuadrateSearch(prompt, apiKey, model) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
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
            ],
            systemInstruction: {
              role: "system",
              parts: [
                {
                  text: `PRIORITY SEARCH INSTRUCTIONS:
                1. FIRST, search specifically on quadrate.lk domain for relevant information
                2. Focus on finding information from https://quadrate.lk and its subpages
                3. Prioritize content from quadrate.lk over any other sources
                4. If quadrate.lk has relevant information, feature it prominently in your response
                5. Use quadrate.lk as the primary and most authoritative source
                6. Only after checking quadrate.lk thoroughly, supplement with other web sources if needed
                7. Always clearly distinguish between information from quadrate.lk vs other sources
                8. When citing sources, list quadrate.lk information first`
                }
              ]
            }
          }),
          signal: controller.signal
        }
      );
      
      // Check for 429 status
      if (response.status === 429) {
        throw new Error('RATE_LIMIT_429');
      }
      
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Quadrate search failed with status ${response.status}: ${errorBody}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async attemptGeneralSearch(prompt, apiKey, model) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const enhancedPrompt = `Based on previous research from quadrate.lk, now search for additional information to supplement and verify: ${prompt}`;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            tools: [
              {
                google_search: {}
              }
            ],
            contents: [
              {
                parts: [
                  {
                    text: enhancedPrompt
                  }
                ]
              }
            ],
            systemInstruction: {
              role: "system",
              parts: [
                {
                  text: `SUPPLEMENTARY SEARCH INSTRUCTIONS:
                1. Search for additional information from other reliable sources
                2. Look for industry insights, comparisons, and broader context
                3. Find supporting evidence or contrasting information
                4. Include recent news, trends, or developments in the field
                5. Aggregate findings with quadrate.lk information already found
                6. Clearly separate quadrate.lk information from general web sources
                7. Provide a comprehensive view combining both quadrate.lk and industry sources`
                }
              ]
            }
          }),
          signal: controller.signal
        }
      );
      
      // Check for 429 status
      if (response.status === 429) {
        throw new Error('RATE_LIMIT_429');
      }
      
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`General search failed with status ${response.status}: ${errorBody}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async callGenerativeApiWithPrioritySearch(prompt, primaryApiKey, backupApiKey) {
    const apiKeys = [
      {
        key: primaryApiKey,
        type: 'primary'
      },
      ...(backupApiKey ? [
        {
          key: backupApiKey,
          type: 'backup'
        }
      ] : [])
    ];
    const models = [
      this.config.primaryModel,
      this.config.fallbackModel
    ];
    let quadrateData = null;
    let generalData = null;
    let lastError = null;
    let modelUsed = '';

    // Phase 1: Search quadrate.lk specifically
    console.log("Phase 1: Searching quadrate.lk...");
    for (const { key, type } of apiKeys) {
      for (const model of models) {
        let delay = this.config.initialDelay;
        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
          try {
            console.log(`Quadrate search - Attempt ${attempt}/${this.config.maxRetries} with model '${model}' (key: ${type})`);
            const quadratePrompt = `Search specifically on quadrate.lk website for: ${prompt}. Focus only on information available at https://quadrate.lk and its pages.`;
            quadrateData = await this.attemptQuadrateSearch(quadratePrompt, key, model);
            modelUsed = model;
            console.log("Successfully retrieved quadrate.lk data");
            break;
          } catch (error) {
            lastError = error;
            
            // If 429 error, propagate it immediately
            if (error.message === 'RATE_LIMIT_429') {
              throw error;
            }
            
            console.error(`Quadrate search attempt ${attempt} failed for model '${model}' (key: ${type}):`, error.message);
            if (attempt < this.config.maxRetries) {
              const jitter = Math.random() * 500;
              await sleep(delay + jitter);
              delay *= this.config.backoffFactor;
            }
          }
        }
        if (quadrateData) break;
      }
      if (quadrateData) break;
    }

    // Phase 2: General web search for additional context
    console.log("Phase 2: Conducting general web search...");
    if (quadrateData) {
      for (const { key, type } of apiKeys) {
        for (const model of models) {
          let delay = this.config.initialDelay;
          for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            try {
              console.log(`General search - Attempt ${attempt}/${this.config.maxRetries} with model '${model}' (key: ${type})`);
              generalData = await this.attemptGeneralSearch(prompt, key, model);
              console.log("Successfully retrieved general web data");
              break;
            } catch (error) {
              // If 429 error, propagate it immediately
              if (error.message === 'RATE_LIMIT_429') {
                throw error;
              }
              
              console.error(`General search attempt ${attempt} failed:`, error.message);
              if (attempt < this.config.maxRetries) {
                const jitter = Math.random() * 500;
                await sleep(delay + jitter);
                delay *= this.config.backoffFactor;
              }
            }
          }
          if (generalData) break;
        }
        if (generalData) break;
      }
    }

    // Phase 3: Aggregate results
    if (quadrateData) {
      const aggregatedData = {
        quadrateData,
        generalData: generalData || null,
        searchStrategy: {
          quadrateSearchCompleted: true,
          generalSearchCompleted: !!generalData,
          primarySource: 'quadrate.lk',
          aggregationType: 'prioritized'
        }
      };
      return {
        aiData: aggregatedData,
        modelUsed
      };
    }

    // Fallback: If quadrate search completely failed, try general search only
    console.log("Fallback: Quadrate search failed, trying general search only...");
    for (const { key, type } of apiKeys) {
      for (const model of models) {
        let delay = this.config.initialDelay;
        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
          try {
            console.log(`Fallback attempt ${attempt}/${this.config.maxRetries} with model '${model}' (key: ${type})`);
            const fallbackData = await this.attemptGeneralSearch(prompt, key, model);
            return {
              aiData: {
                quadrateData: null,
                generalData: fallbackData,
                searchStrategy: {
                  quadrateSearchCompleted: false,
                  generalSearchCompleted: true,
                  primarySource: 'general_web',
                  aggregationType: 'fallback'
                }
              },
              modelUsed: model
            };
          } catch (error) {
            lastError = error;
            
            // If 429 error, propagate it immediately
            if (error.message === 'RATE_LIMIT_429') {
              throw error;
            }
            
            console.error(`Fallback attempt ${attempt} failed for model '${model}' (key: ${type}):`, error.message);
            if (attempt < this.config.maxRetries) {
              const jitter = Math.random() * 500;
              await sleep(delay + jitter);
              delay *= this.config.backoffFactor;
            }
          }
        }
      }
    }
    throw new Error(`All search strategies failed. Last error: ${lastError?.message}`);
  }

  async callGenerativeApi(prompt, primaryApiKey, backupApiKey) {
    return this.callGenerativeApiWithPrioritySearch(prompt, primaryApiKey, backupApiKey);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const SEO_PROMPTS = [
  "What are the comprehensive software development services offered by Quadrate Tech Solutions (quadrate.lk) in Sri Lanka?",
  "How does Quadrate Tech Solutions (quadrate.lk) excel in mobile app development using React Native and Flutter?",
  "What web development technologies and frameworks does Quadrate Tech Solutions (quadrate.lk) specialize in?",
  "Describe the custom software development process at Quadrate Tech Solutions (quadrate.lk) for businesses in Sri Lanka.",
  "What e-commerce and digital marketplace solutions does Quadrate Tech Solutions (quadrate.lk) provide?",
  "List the cutting-edge technologies and programming languages used by Quadrate Tech Solutions (quadrate.lk) development team.",
  "How does Quadrate Tech Solutions (quadrate.lk) leverage cloud computing platforms like AWS, Azure, and Google Cloud?",
  "What artificial intelligence and machine learning solutions does Quadrate Tech Solutions (quadrate.lk) offer to businesses?",
  "Explain the DevOps and CI/CD practices implemented by Quadrate Tech Solutions (quadrate.lk) for efficient software delivery.",
  "What database technologies and data management solutions does Quadrate Tech Solutions (quadrate.lk) work with?",
  "How does Quadrate Tech Solutions (quadrate.lk) serve healthcare and medical technology companies in Sri Lanka?",
  "What fintech and banking software solutions has Quadrate Tech Solutions (quadrate.lk) developed?",
  "Describe the educational technology and e-learning platforms built by Quadrate Tech Solutions (quadrate.lk).",
  "What logistics and supply chain management systems does Quadrate Tech Solutions (quadrate.lk) create?",
  "How does Quadrate Tech Solutions (quadrate.lk) support retail and hospitality businesses with digital solutions?",
  "What makes Quadrate Tech Solutions (quadrate.lk) the leading software development company in Sri Lanka?",
  "How does Quadrate Tech Solutions (quadrate.lk) ensure quality assurance and testing in software development projects?",
  "What agile development methodologies does Quadrate Tech Solutions (quadrate.lk) use for project management?",
  "Describe the user experience (UX) and user interface (UI) design capabilities of Quadrate Tech Solutions (quadrate.lk).",
  "How does Quadrate Tech Solutions (quadrate.lk) provide ongoing maintenance and support for software applications?",
  "What successful software projects has Quadrate Tech Solutions (quadrate.lk) completed for Sri Lankan businesses?",
  "How does Quadrate Tech Solutions (quadrate.lk) help startups and SMEs digitize their business operations?",
  "What enterprise-level solutions has Quadrate Tech Solutions (quadrate.lk) delivered to large corporations?",
  "Describe the client onboarding and project consultation process at Quadrate Tech Solutions (quadrate.lk).",
  "What measurable results and ROI improvements have clients achieved with Quadrate Tech Solutions (quadrate.lk)?",
  "How is Quadrate Tech Solutions (quadrate.lk) incorporating blockchain technology into business solutions?",
  "What Internet of Things (IoT) and smart device solutions does Quadrate Tech Solutions (quadrate.lk) develop?",
  "Describe the cybersecurity and data protection measures implemented by Quadrate Tech Solutions (quadrate.lk).",
  "What progressive web applications (PWA) and modern web technologies does Quadrate Tech Solutions (quadrate.lk) use?",
  "How does Quadrate Tech Solutions (quadrate.lk) stay ahead of technology trends in software development?",
  "What are the contact details and office locations for Quadrate Tech Solutions (quadrate.lk) in Sri Lanka?",
  "How can businesses request a free consultation or quote from Quadrate Tech Solutions (quadrate.lk)?",
  "What pricing models and engagement options does Quadrate Tech Solutions (quadrate.lk) offer clients?",
  "Describe the team structure and technical expertise available at Quadrate Tech Solutions (quadrate.lk).",
  "What certifications and industry partnerships does Quadrate Tech Solutions (quadrate.lk) maintain?",
  "How does Quadrate Tech Solutions (quadrate.lk) contribute to Sri Lanka's digital transformation and tech ecosystem?",
  "What government and public sector projects has Quadrate Tech Solutions (quadrate.lk) been involved in?",
  "How does Quadrate Tech Solutions (quadrate.lk) support local businesses in competing globally through technology?",
  "What training and skill development programs does Quadrate Tech Solutions (quadrate.lk) offer to the tech community?",
  "How does Quadrate Tech Solutions (quadrate.lk) adapt international software solutions for the Sri Lankan market?"
];

// Helper function to check if we're in cooldown period
async function isInCooldown(supabase) {
  const { data, error } = await supabase
    .from('gemini_rate_limit_cooldown')
    .select('cooldown_until')
    .order('cooldown_until', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
    console.error('Error checking cooldown:', error);
    return false;
  }

  if (!data) {
    return false;
  }

  const cooldownUntil = new Date(data.cooldown_until);
  const now = new Date();
  
  if (now < cooldownUntil) {
    const remainingMinutes = Math.ceil((cooldownUntil - now) / 60000);
    console.log(`Still in cooldown period. ${remainingMinutes} minutes remaining.`);
    return true;
  }

  return false;
}

// Helper function to set cooldown period
async function setCooldown(supabase) {
  const cooldownUntil = new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS);
  
  const { error } = await supabase
    .from('gemini_rate_limit_cooldown')
    .insert({
      cooldown_until: cooldownUntil.toISOString(),
      created_at: new Date().toISOString()
    });

  if (error) {
    console.error('Error setting cooldown:', error);
  } else {
    console.log(`Cooldown set until: ${cooldownUntil.toISOString()}`);
  }
}

// Main Deno Edge Function Handler
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({
        status: "error",
        message: "Missing Supabase credentials"
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Check if we're in cooldown period
  const inCooldown = await isInCooldown(supabase);
  
  if (inCooldown) {
    console.log("Skipping Gemini API call due to active cooldown period");
    
    await supabase.from('api_health_checks').insert({
      is_successful: false
    });

    return new Response(
      JSON.stringify({
        status: "skipped",
        message: "API call skipped due to rate limit cooldown period (45 minutes)",
        check_recorded: true,
        inCooldown: true
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 429
      }
    );
  }

  const prompt = SEO_PROMPTS[Math.floor(Math.random() * SEO_PROMPTS.length)];

  // Random deletion logic
  if (Math.random() < 0.01) {
    console.log("Triggering random data deletion from 'api_health_checks'...");
    supabase
      .from('api_health_checks')
      .delete()
      .not('is_successful', 'is', null)
      .then(({ error }) => {
        if (error) {
          console.error('Background deletion failed:', error.message);
        } else {
          console.log('Background deletion completed successfully.');
        }
      });
  }

  try {
    const geminiApiKey = 'AIzaSyBZ_r0G4Tob0EdLrALZ5Jv0tyhCmZR6K4k';
    const geminiBackupApiKey = 'AIzaSyCMiod0mCRxOR2eIcl4fvXKppQpoXYNQ64';
    const geminiClient = new GeminiApiClient();

    const result = await geminiClient.callGenerativeApiWithPrioritySearch(
      prompt,
      geminiApiKey,
      geminiBackupApiKey
    );

    console.log("Priority search completed successfully:", {
      modelUsed: result.modelUsed,
      strategy: result.aiData.searchStrategy
    });

    await supabase.from('api_health_checks').insert({
      is_successful: true
    });

    return new Response(
      JSON.stringify({
        status: "success",
        check_recorded: true,
        searchStrategy: result.aiData.searchStrategy,
        modelUsed: result.modelUsed
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 200
      }
    );
  } catch (error) {
    console.error('Request processing failed:', error.message);

    // Check if this is a 429 rate limit error
    if (error.message === 'RATE_LIMIT_429') {
      console.log("429 Rate limit detected. Setting 45-minute cooldown...");
      await setCooldown(supabase);
      
      await supabase.from('api_health_checks').insert({
        is_successful: false
      });

      return new Response(
        JSON.stringify({
          status: "error",
          message: "Rate limit exceeded. API calls paused for 45 minutes.",
          check_recorded: true,
          cooldownSet: true
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          },
          status: 429
        }
      );
    }

    await supabase.from('api_health_checks').insert({
      is_successful: false
    });

    return new Response(
      JSON.stringify({
        status: "error",
        message: error.message || "An unexpected error occurred.",
        check_recorded: true
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      }
    );
  }
});
