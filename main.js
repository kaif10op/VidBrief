import './style.css'
import { createClient } from '@supabase/supabase-js'

// --- Sticky Nav Scroll Effect ---
const topNav = document.getElementById('top-nav');
if (topNav) {
  window.addEventListener('scroll', () => {
    topNav.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });
}

// --- Supabase Initialization ---
// These will be exposed via the backend config to avoid leaking into the bundle directly if needed, 
// but for Vite we can use env vars or fetched config.
let supabase = null;

async function initSupabase() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();
        // Check carefully because invalid malformed keys crash the client
        if (config.supabaseUrl && config.supabaseKey) {
            try {
                // Initialize safely
                supabase = createClient(config.supabaseUrl, config.supabaseKey);
                checkUser();
            } catch(initErr) {
                console.warn("Supabase client creation failed (likely invalid key):", initErr.message);
                supabase = null;
            }
        }
    } catch(e) {
        console.warn("Could not fetch /api/config or parse response.", e);
    }
}
initSupabase();

// --- State Management & DOM Elements ---
const views = {
  landing: document.getElementById('landing-view'),
  loading: document.getElementById('loading-view'),
  dashboard: document.getElementById('dashboard-view')
}

// Global App State
let currentTranscriptText = "";
let chatHistory = [];

// Settings Elements
const btnSettings = document.getElementById('btn-settings');
const btnSignIn = document.getElementById('btn-sign-in');
const settingsModal = document.getElementById('settings-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnSaveKey = document.getElementById('btn-save-key');

const providerSelect = document.getElementById('provider-select');
const keys = {
    openrouter: document.getElementById('openrouter-key-input'),
    openai: document.getElementById('openai-key-input'),
    groq: document.getElementById('groq-key-input'),
    gemini: document.getElementById('gemini-key-input'),
    cerebras: document.getElementById('cerebras-key-input'),
    xai: document.getElementById('xai-key-input')
}

// Auth Elements
const authModal = document.getElementById('auth-modal');
const authForm = document.getElementById('auth-form');
const authTitle = document.getElementById('auth-title');
const authDesc = document.getElementById('auth-desc');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authSubmitBtn = document.getElementById('btn-auth-submit');
const authSwitchLink = document.getElementById('auth-switch-link');
const authSwitchText = document.getElementById('auth-switch-text');
const btnCloseAuth = document.getElementById('btn-close-auth');
const btnLogout = document.getElementById('btn-logout');

let isSignUp = false;
let currentUser = null;

// Landing Elements
const urlForm = document.getElementById('url-form');
const urlInput = document.getElementById('youtube-url');

// Loading Elements
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const loadingStep = document.getElementById('loading-step');

// Dashboard Elements
const btnNew = document.getElementById('btn-new');
const tabs = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// --- Initialization ---
async function loadSettings() {
    // Load active provider
    try {
        const savedProvider = localStorage.getItem('vidbrief_provider');
        if (savedProvider && providerSelect) {
            providerSelect.value = savedProvider;
        }

        // Try to load keys from backend first, fallback to localStorage
        const res = await fetch('/api/config');
        if (res.ok) {
            const envKeys = await res.json();
            
            Object.keys(keys).forEach(k => {
                // Precedence: .env server config > localStorage (so updated .env keys always apply)
                if (envKeys[k] && keys[k]) {
                    keys[k].value = envKeys[k];
                    localStorage.setItem(`vidbrief_${k}_key`, envKeys[k]);
                } else {
                    const savedKey = localStorage.getItem(`vidbrief_${k}_key`);
                    if (savedKey && keys[k]) {
                        keys[k].value = savedKey;
                    }
                }
            });

            // If user is logged in, try to fetch from Supabase table
            if (currentUser && supabase) {
                try {
                    const { data, error } = await supabase
                        .from('user_configs')
                        .select('*')
                        .eq('id', currentUser.id)
                        .single();

                    if (data) {
                        if (providerSelect && data.provider) {
                            providerSelect.value = data.provider;
                        }
                        Object.keys(keys).forEach(k => {
                            if (data[`${k}_key`] && keys[k]) {
                                keys[k].value = data[`${k}_key`];
                                localStorage.setItem(`vidbrief_${k}_key`, data[`${k}_key`]);
                            }
                        });
                    }
                } catch(dbErr) {
                    console.warn("Could not fetch user configs from DB:", dbErr.message);
                }
            }
        }
    } catch (e) {
        console.warn("Could not load backend config, falling back to pure localStorage", e);
        Object.keys(keys).forEach(k => {
            const savedKey = localStorage.getItem(`vidbrief_${k}_key`);
            if (savedKey && keys[k]) keys[k].value = savedKey;
        });
    }
}
loadSettings();

// --- Modal Logic ---
btnSettings?.addEventListener('click', () => settingsModal?.classList.remove('hidden'));
btnCloseModal?.addEventListener('click', () => settingsModal?.classList.add('hidden'));

btnSaveKey?.addEventListener('click', async () => {
    localStorage.setItem('vidbrief_provider', providerSelect.value);
    const configData = { provider: providerSelect.value };
    
    Object.keys(keys).forEach(k => {
        const val = keys[k].value.trim();
        localStorage.setItem(`vidbrief_${k}_key`, val);
        configData[`${k}_key`] = val;
    });

    if (currentUser && supabase) {
        try {
            const { error } = await supabase
                .from('user_configs')
                .upsert({ id: currentUser.id, ...configData });
            
            if (error) console.error("Failed to sync to Supabase:", error);
        } catch(e) {
            console.error("Failed to sync to Supabase:", e);
        }
    }
    
    settingsModal?.classList.add('hidden');
    // Non-blocking notification
    console.log("Configuration saved securely.");
});

// --- Auth Logic ---
async function checkUser() {
    if (!supabase) return;
    try {
        const { data: { user } } = await supabase.auth.getUser();
        currentUser = user;
        
        if (user) {
            btnSignIn?.classList.add('hidden');
            btnLogout?.classList.remove('hidden');
            // Reload settings for this user
            loadSettings();
        } else {
            btnSignIn?.classList.remove('hidden');
            btnLogout?.classList.add('hidden');
        }
    } catch(e) {
        console.warn("Auth check failed:", e.message);
    }
}

btnSignIn?.addEventListener('click', () => {
    authModal?.classList.remove('hidden');
});

btnCloseAuth?.addEventListener('click', () => {
    authModal?.classList.add('hidden');
});

btnLogout?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    currentUser = null;
    checkUser();
    alert("Logged out successfully.");
});

authSwitchLink?.addEventListener('click', (e) => {
    e.preventDefault();
    isSignUp = !isSignUp;
    authTitle.textContent = isSignUp ? "Sign Up" : "Sign In";
    authDesc.textContent = isSignUp ? "Create an account to sync your settings." : "Login to sync your API keys across devices.";
    authSubmitBtn.textContent = isSignUp ? "Sign Up" : "Sign In";
    authSwitchText.textContent = isSignUp ? "Already have an account?" : "Don't have an account?";
    authSwitchLink.textContent = isSignUp ? "Sign In" : "Sign Up";
});

authForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = authEmail.value;
    const password = authPassword.value;
    
    authSubmitBtn.disabled = true;
    authSubmitBtn.textContent = isSignUp ? "Creating account..." : "Signing in...";
    
    if (!supabase) {
        alert("Authentication service is unavailable.");
        authSubmitBtn.disabled = false;
        authSubmitBtn.textContent = isSignUp ? "Sign Up" : "Sign In";
        return;
    }

    try {
        let result;
        if (isSignUp) {
            result = await supabase.auth.signUp({ email, password });
        } else {
            result = await supabase.auth.signInWithPassword({ email, password });
        }
        
        if (result.error) throw result.error;
        
        if (isSignUp) {
            alert("Signup successful! Please check your email for verification.");
        } else {
            authModal?.classList.add('hidden');
            checkUser();
        }
    } catch(err) {
        console.error("Auth error:", err.message);
        
        // Display a more subtle temporary message directly under the button instead of a blocking alert
        const errorMsg = document.createElement('div');
        errorMsg.style.color = '#ff4a4a';
        errorMsg.style.marginTop = '0.5rem';
        errorMsg.style.fontSize = '0.9rem';
        errorMsg.style.textAlign = 'center';
        
        if (err.message === 'Failed to fetch') {
            errorMsg.innerText = "Network Error: Could not reach the authentication server. Please check that your SUPABASE_URL in .env is valid.";
        } else {
            errorMsg.innerText = err.message;
        }
        
        authForm.appendChild(errorMsg);
        setTimeout(() => errorMsg.remove(), 6000);
        
    } finally {
        authSubmitBtn.disabled = false;
        authSubmitBtn.textContent = isSignUp ? "Sign Up" : "Sign In";
    }
});

// --- View Navigation Logic ---
function showView(viewName) {
  Object.values(views).forEach(v => {
    v.classList.remove('active');
    v.classList.add('hidden');
  });
  views[viewName].classList.remove('hidden');
  setTimeout(() => {
    views[viewName].classList.add('active');
  }, 10);
}

// --- Local Backend Fetch Logic ---
async function fetchTranscriptFromBackend(url) {
    try {
        const response = await fetch('/api/transcript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await response.json();
        
        if (!data.success) {
            const errorObj = new Error(data.error);
            errorObj.code = data.code;
            throw errorObj;
        }
        return data; 
    } catch (err) {
        throw err;
    }
}

async function fetchAudioTranscriptFromBackend(url, whisperKey) {
    try {
        const response = await fetch('/api/audio-transcript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, whisperKey })
        });
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Audio Extraction Failed');
        }
        return data; 
    } catch (err) {
        throw err;
    }
}

// --- Unified AI Client ---
async function executeAIRequest(provider, apiKey, systemPrompt, userMessages) {
    let url = '';
    let headers = {
        'Content-Type': 'application/json'
    };
    let body = {};
    let isGoogleFormat = false;

    // Build standard OpenAI-compatible messages array
    let messages = [];
    if (systemPrompt && provider !== 'gemini') {
        messages.push({ role: "system", content: systemPrompt });
    }
    
    // Convert generic userMessages to OpenAI format usually
    const formattedUserMessages = userMessages.map(m => ({ role: m.role, content: m.parts[0].text }));
    messages = messages.concat(formattedUserMessages);

    switch(provider) {
        case 'openrouter':
            url = 'https://openrouter.ai/api/v1/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
            body = {
                model: 'meta-llama/llama-3.3-70b-instruct:free',
                messages: messages
            };
            break;
        case 'groq':
            url = 'https://api.groq.com/openai/v1/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
            body = {
                model: 'llama-3.3-70b-versatile',
                messages: messages
            };
            break;
        case 'cerebras':
            url = 'https://api.cerebras.ai/v1/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
            body = {
                model: 'llama3.1-8b',
                messages: messages
            };
            break;
        case 'xai':
            url = 'https://api.x.ai/v1/chat/completions';
            headers['Authorization'] = `Bearer ${apiKey}`;
            body = {
                model: 'grok-3-mini-fast',
                messages: messages
            };
            break;
        case 'gemini':
            isGoogleFormat = true;
            url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            
            // Re-map messages to Gemini specifics
            let geminiContext = "";
            if (systemPrompt) geminiContext = `System Instructions: ${systemPrompt}\n\n`;
            
            let geminiMessages = userMessages.map(m => {
                let r = m.role === 'assistant' ? 'model' : m.role;
                // Deep copy parts to prevent mutating the original msg object in fallbacks
                return { role: r, parts: [{ text: m.parts[0].text }] }
            });

            if (geminiMessages.length > 0) {
               geminiMessages[0].parts[0].text = geminiContext + geminiMessages[0].parts[0].text;
            }

            body = { contents: geminiMessages };
            break;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errInfo = await response.text();
        throw new Error(`${provider} API Error: ${response.status} ${errInfo}`);
    }

    const data = await response.json();
    
    if (isGoogleFormat) {
        return data.candidates[0].content.parts[0].text;
    } else {
        return data.choices[0].message.content;
    }
}

async function generateAIContent(systemPrompt, userMessages) {
    const selectedProvider = localStorage.getItem('vidbrief_provider') || 'openrouter';
    const allProviders = ['groq', 'openrouter', 'gemini', 'cerebras'];
    
    // Put selected provider first, then the rest
    const fallbackQueue = [selectedProvider, ...allProviders.filter(p => p !== selectedProvider)];

    let lastError = null;
    let triedCount = 0;

    for (const provider of fallbackQueue) {
        const apiKey = localStorage.getItem(`vidbrief_${provider}_key`);
        
        // Skip provider if no key is configured
        if (!apiKey) continue;
        
        triedCount++;
        
        // Update loading UI slightly if we are falling back
        if (triedCount > 1) {
             const stepEl = document.getElementById('loading-step');
             if (stepEl) {
                 stepEl.innerText = `Retrying with ${provider}...`;
             }
        }

        try {
            return await executeAIRequest(provider, apiKey, systemPrompt, userMessages);
        } catch (err) {
            console.warn(`Provider ${provider} failed: ${err.message}. Fetching fallback...`);
            lastError = err;
            
            // On 429 rate limit, wait briefly then continue to next provider
            if (err.message.includes('429')) {
                await new Promise(r => setTimeout(r, 2000));
            }
            
            // On context_length_exceeded, truncate messages and retry same provider once
            if (err.message.includes('context_length_exceeded') && !err._retried) {
                try {
                    const shorterMessages = userMessages.map(m => ({
                        ...m,
                        parts: [{ text: m.parts[0].text.substring(0, 4000) }]
                    }));
                    return await executeAIRequest(provider, apiKey, systemPrompt, shorterMessages);
                } catch(retryErr) {
                    retryErr._retried = true;
                    lastError = retryErr;
                }
            }
        }
    }

    if (triedCount === 0) {
        throw new Error(`No API keys configured. Please configure at least one provider in Settings.`);
    }

    throw new Error(`All configured AI providers failed. Last error: ${lastError?.message}`);
}


// --- Loading Simulation & AI Processing ---
function setProgress(percentage, text) {
    progressBar.style.width = percentage + '%';
    progressText.innerText = percentage + '%';
    loadingStep.innerText = text;
}

async function processVideoUrl(url) {
    const provider = localStorage.getItem('vidbrief_provider') || 'openrouter';
    const apiKey = localStorage.getItem(`vidbrief_${provider}_key`);

    if (!apiKey) {
        settingsModal.classList.remove('hidden');
        alert(`Please configure the API Key for ${provider} in Settings to continue.`);
        return;
    }

    showView('loading');
    setProgress(5, "Fetching video metadata and neural transcript...");

    try {
        // 1. Fetch transcript — auto-cascade to Whisper Audio if captions missing
        let backendData;
        try {
            backendData = await fetchTranscriptFromBackend(url);
        } catch (transcriptErr) {
            if (transcriptErr.code === 'NO_TRANSCRIPT_AVAILABLE') {
                console.warn('No captions found. Automatically falling back to Whisper Audio extraction...');
                setProgress(10, "No captions detected. Extracting native audio via Whisper AI...");
                
                // Try to get Groq key from localStorage or use the backend's .env key
                const groqKey = localStorage.getItem('vidbrief_groq_key') || '';
                backendData = await fetchAudioTranscriptFromBackend(url, groqKey);
                setProgress(30, "Audio transcribed successfully via Groq Whisper AI.");
            } else {
                throw transcriptErr; // Re-throw genuine errors
            }
        }
        
        setProgress(35, `Transcript acquired. Initializing ${provider} Intelligence...`);
        
        // Populate Transcript UI and save raw text for AI
        const rawTranscriptArr = backendData.transcript;
        currentTranscriptText = rawTranscriptArr.map(t => t.text).join(' ');
        
        const trContainer = document.getElementById('transcript-container');
        trContainer.innerHTML = '';
        rawTranscriptArr.forEach(t => {
            const div = document.createElement('div');
            div.className = 'transcript-line';
            const totalSecs = Math.floor(t.offset / 1000);
            const m = Math.floor(totalSecs / 60);
            const s = String(totalSecs % 60).padStart(2, '0');
            div.innerHTML = `<span class="t-time">${m}:${s}</span><span class="t-text">${t.text}</span>`;
            trContainer.appendChild(div);
        });

        // Populate Metadata Header
        document.getElementById('video-thumbnail').src = backendData.metadata.thumbnail;
        document.getElementById('video-title').innerText = backendData.metadata.title;
        document.getElementById('channel-name').innerText = backendData.metadata.channel;

        // Build a timestamped transcript string for AI analysis
        const timestampedContext = rawTranscriptArr.map(t => {
            const totalSecs = Math.floor(t.offset / 1000);
            const m = Math.floor(totalSecs / 60);
            const s = String(totalSecs % 60).padStart(2, '0');
            return `[${m}:${s}] ${t.text}`;
        }).join('\n').substring(0, 12000);

        const maxContext = currentTranscriptText.substring(0, 12000); 

        // 2. Generate Summary
        setProgress(45, "Synthesizing executive summary...");
        const summaryMsg = [{ role: 'user', parts: [{ text: `Provide a comprehensive executive summary of the following video transcript. The transcript may be in any language — always respond in the SAME language as the transcript. Make it flow well and capture the core essence of the video accurately.\n\nTranscript:\n${maxContext}` }] }];
        const summaryResult = await generateAIContent(null, summaryMsg);
        document.getElementById('summary-text').innerText = summaryResult;
        document.getElementById('summary-tease').innerText = "AI Generated Executive Summary complete.";

        // 3. Generate Chapters with Timestamps
        setProgress(58, "Generating intelligent video chapters...");
        const chaptersMsg = [{ role: 'user', parts: [{ text: `Analyze the following timestamped video transcript and generate 5-10 logical chapter markers. Each chapter should represent a distinct topic shift or segment of the video.\n\nReturn ONLY a JSON array of objects with "time" (in "M:SS" format) and "title" (short descriptive title) properties. Respond in the SAME language as the transcript.\n\nExample format: [{"time": "0:00", "title": "Introduction"}, {"time": "2:15", "title": "Main Topic"}]\n\nTimestamped Transcript:\n${timestampedContext}` }] }];
        const chaptersResult = await generateAIContent(null, chaptersMsg);
        
        let chapText = chaptersResult.replace(/```json/g, '').replace(/```/g, '').trim();
        let chaptersArray = [];
        try {
            chaptersArray = JSON.parse(chapText);
        } catch(e) {
            // Graceful degradation: parse line-by-line
            chaptersArray = chapText.split('\n').filter(l => l.trim().length > 0).map(l => {
                const match = l.match(/(\d+:\d+)\s*[-–:]?\s*(.+)/);
                return match ? { time: match[1], title: match[2].trim() } : { time: '0:00', title: l.trim() };
            });
        }
        
        const chList = document.getElementById('chapters-list');
        chList.innerHTML = '';
        chaptersArray.forEach((ch, idx) => {
            const li = document.createElement('li');
            li.className = 'chapter-item';
            li.innerHTML = `
                <span class="chapter-number">${String(idx + 1).padStart(2, '0')}</span>
                <span class="chapter-time">${ch.time}</span>
                <span class="chapter-title">${ch.title}</span>
            `;
            chList.appendChild(li);
        });

        setProgress(72, "Extracting actionable highlights...");

        // 4. Generate Highlights
        const highlightMsg = [{ role: "user", parts: [{ text: `Extract exactly 5 to 7 key bullet point takeaways from the following video transcript. The transcript may be in any language — always respond in the SAME language as the transcript. Return ONLY a JSON array of strings representing each bullet point.\n\nTranscript:\n${maxContext}` }] }];
        const highlightResult = await generateAIContent(null, highlightMsg);
        
        let hlText = highlightResult.replace(/```json/g, '').replace(/```/g, '').trim();
        let highlightsArray = [];
        try {
            highlightsArray = JSON.parse(hlText);
        } catch(e) {
            highlightsArray = hlText.split('\n').filter(l => l.trim().length > 0).map(l => l.replace(/^[-\*0-9.]+\s*/, ''));
        }
        
        const hlList = document.getElementById('highlights-list');
        hlList.innerHTML = '';
        highlightsArray.forEach(hl => {
            const li = document.createElement('li');
            li.innerText = hl;
            hlList.appendChild(li);
        });

        setProgress(90, "Instantiating interactive chat context...");

        // 5. Initialize Chat History
        chatHistory = [
             {
                 role: "user",
                 parts: [{ text: `I am going to ask you questions about a video. Here is the transcript of the video as context. The transcript may be in any language — please always respond in the SAME language as the transcript.\n\n${maxContext}` }],
             },
             {
                 role: "assistant",
                 parts: [{ text: "I have read the transcript. I am ready to answer any questions about the video." }],
             }
        ];

        // Done! Show Dashboard.
        setProgress(100, "Complete.");
        setTimeout(() => showView('dashboard'), 400);

    } catch (err) {
        console.error(err);
        const errorDiv = document.getElementById('error-message') || document.createElement('div');
        errorDiv.id = 'error-message';
        errorDiv.className = 'error-banner';
        errorDiv.innerText = `Error: ${err.message}`;
        errorDiv.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
        errorDiv.style.color = 'var(--error-color)';
        errorDiv.style.border = '1px solid rgba(239, 68, 68, 0.2)';
        urlForm.parentNode.insertBefore(errorDiv, urlForm);
        showView('landing');
    }
}

// --- Tab Logic ---
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    // Deactivate all tabs
    tabs.forEach(t => t.classList.remove('active'));
    
    // Hide all tab content panels immediately (no setTimeout)
    tabContents.forEach(c => {
      c.classList.remove('active');
      c.classList.add('hidden');
    });

    // Activate the clicked tab
    tab.classList.add('active');
    const targetId = tab.getAttribute('data-target');
    const targetEl = document.getElementById(targetId);
    
    // Show the target content
    targetEl.classList.remove('hidden');
    targetEl.classList.add('active');
  });
});

// --- Chat Logic ---
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (!msg || chatHistory.length === 0) return;

  // Append user message to UI
  const userDiv = document.createElement('div');
  userDiv.className = 'message user fade-in';
  userDiv.innerHTML = `
    <div class="avatar">You</div>
    <div class="msg-content">${msg}</div>
  `;
  chatMessages.appendChild(userDiv);
  chatInput.value = '';
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Track in history
  chatHistory.push({ role: "user", parts: [{ text: msg }] });

  // Show "typings" state
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'message ai fade-in';
  loadingDiv.id = "chat-loading-indicator";
  loadingDiv.innerHTML = `
      <div class="avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path></svg></div>
      <div class="msg-content">Thinking...</div>
  `;
  chatMessages.appendChild(loadingDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
      const responseText = await generateAIContent("You are an AI designed to answer questions based strictly on the provided video context.", chatHistory);
      loadingDiv.remove();

      // Track in history
      chatHistory.push({ role: "assistant", parts: [{ text: responseText }] });

      const aiDiv = document.createElement('div');
      aiDiv.className = 'message ai fade-in';
      aiDiv.innerHTML = `
        <div class="avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path></svg></div>
        <div class="msg-content">${responseText}</div>
      `;
      chatMessages.appendChild(aiDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;

  } catch(error) {
      console.error(error);
      loadingDiv.querySelector('.msg-content').innerText = `Oops, I ran into an error generating a response: ${error.message}`;
      chatHistory.pop(); // Remove failed message from history
  }
});

// --- Event Listeners ---
urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (urlInput.value.trim() !== '') {
    processVideoUrl(urlInput.value.trim());
  }
});

btnNew.addEventListener('click', () => {
    urlInput.value = '';
    showView('landing');
    chatHistory = []; // Reset history
    chatMessages.innerHTML = `
        <div class="message ai">
            <div class="avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"></path></svg></div>
            <div class="msg-content">Hello! I've analyzed this video inside out. Ask me anything, or try: <br><br>
            <span class="suggestion-chip">What is the main conclusion?</span>
            <span class="suggestion-chip">Summarize the first 5 minutes.</span>
            </div>
        </div>
    `;
});

// Transcript search logically highlights
const tSearch = document.getElementById('transcript-search');
tSearch.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase();
  const lines = document.querySelectorAll('.transcript-line');
  lines.forEach(line => {
    const text = line.querySelector('.t-text').innerText.toLowerCase();
    if (text.includes(query)) {
      line.style.display = 'flex';
    } else {
      line.style.display = 'none';
    }
  });
});

// Pre-click chips in chat
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('suggestion-chip')) {
    chatInput.value = e.target.innerText;
    chatForm.dispatchEvent(new Event('submit'));
  }
});

// --- Card Spotlight Effect (Mouse Tracking) ---
document.addEventListener('mousemove', (e) => {
  const cards = document.querySelectorAll('.card-spotlight');
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    card.style.setProperty('--x', `${x}px`);
    card.style.setProperty('--y', `${y}px`);
  }
});
