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
                        .limit(1);

                    if (data && data.length > 0) {
                        const dbConfig = data[0];
                        if (providerSelect && dbConfig.provider) {
                            providerSelect.value = dbConfig.provider;
                        }
                        Object.keys(keys).forEach(k => {
                            if (dbConfig[`${k}_key`] && keys[k]) {
                                keys[k].value = dbConfig[`${k}_key`];
                                localStorage.setItem(`vidbrief_${k}_key`, dbConfig[`${k}_key`]);
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

// --- Timeout Helper ---
function fetchWithTimeout(url, options, timeoutMs = 90000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal })
        .finally(() => clearTimeout(timeout));
}

// --- Local Backend Fetch Logic ---
async function fetchTranscriptFromBackend(url) {
    try {
        const response = await fetchWithTimeout('/api/transcript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        }, 90000); // 90s timeout for transcript strategies
        const data = await response.json();
        
        if (!data.success) {
            const errorObj = new Error(data.error);
            errorObj.code = data.code;
            throw errorObj;
        }
        return data; 
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error('Transcript fetch timed out. The video may be unavailable or YouTube is rate-limiting requests. Please try again.');
        }
        throw err;
    }
}

async function fetchAudioTranscriptFromBackend(url, whisperKey) {
    try {
        const response = await fetchWithTimeout('/api/audio-transcript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, whisperKey })
        }, 120000); // 120s timeout for audio download + transcription
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Audio Extraction Failed');
        }
        return data; 
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error('Audio transcription timed out. The video may be too long or the service is unavailable. Please try again.');
        }
        throw err;
    }
}

// --- Unified AI Client (Now Server-Side) ---
async function generateAIContent(systemPrompt, userMessages) {
    const preferredProvider = localStorage.getItem('vidbrief_provider') || 'groq';
    
    // Pass user's local keys to the backend in case they BYOK (Bring Your Own Key)
    const clientKeys = {
        groq: localStorage.getItem('vidbrief_groq_key') || null,
        openrouter: localStorage.getItem('vidbrief_openrouter_key') || null,
        gemini: localStorage.getItem('vidbrief_gemini_key') || null,
        cerebras: localStorage.getItem('vidbrief_cerebras_key') || null
    };

    const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt, userMessages, clientKeys, preferredProvider })
    });

    const data = await response.json();
    if (!data.success) {
        throw new Error(data.error || 'Server failed to generate AI content');
    }
    
    // Update loading UI if backend automatically fell back to another provider
    const stepEl = document.getElementById('loading-step');
    if (stepEl && data.provider && data.provider !== preferredProvider) {
        stepEl.innerText = `Fell back to ${data.provider}...`;
    }

    return data.result;
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
        // 1. Fetch transcript — check cache first, then auto-cascade to Whisper Audio if captions missing
        let backendData;
        
        // Try sessionStorage cache first (avoids re-fetching same video)
        const videoIdMatch = url.match(/(?:v=|\/v\/|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
        const cacheKey = videoIdMatch ? `vidbrief_cache_${videoIdMatch[1]}` : null;
        
        if (cacheKey) {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                try {
                    backendData = JSON.parse(cached);
                    console.log('Using cached transcript for', videoIdMatch[1]);
                    setProgress(30, "Using cached transcript...");
                } catch(e) {
                    sessionStorage.removeItem(cacheKey);
                }
            }
        }
        if (!backendData) {
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

            // Cache the successful transcript for this session
            if (cacheKey && backendData) {
                try { sessionStorage.setItem(cacheKey, JSON.stringify(backendData)); } catch(e) {}
            }
        }
        
        setProgress(35, `Transcript acquired. Initializing ${provider} Intelligence...`);
        
        // Populate Transcript UI and save raw text for AI
        let rawTranscriptArr = backendData.transcript;
        const transcriptLang = backendData.language || 'en';
        
        // If transcript is NOT in English, translate it via AI
        if (transcriptLang && !transcriptLang.startsWith('en')) {
            try {
                setProgress(35, `Transcript is in "${transcriptLang}". Translating to English...`);
                
                // Translate in chunks of ~50 segments to stay within token limits
                const chunkSize = 50;
                const translatedSegments = [];
                
                for (let i = 0; i < rawTranscriptArr.length; i += chunkSize) {
                    const chunk = rawTranscriptArr.slice(i, i + chunkSize);
                    const textToTranslate = chunk.map((t, idx) => `[${idx}] ${t.text}`).join('\n');
                    
                    const translateMsg = [{ role: 'user', parts: [{ text: `Translate the following subtitles to English. Keep the [number] prefix intact on each line. Only translate the text, do not add explanations. Return one translated line per original line.\n\n${textToTranslate}` }] }];
                    
                    const translated = await generateAIContent(null, translateMsg);
                    const translatedLines = translated.split('\n').filter(l => l.trim().length > 0);
                    
                    chunk.forEach((seg, idx) => {
                        const matchedLine = translatedLines.find(l => l.startsWith(`[${idx}]`));
                        translatedSegments.push({
                            ...seg,
                            text: matchedLine ? matchedLine.replace(/^\[\d+\]\s*/, '').trim() : seg.text
                        });
                    });
                    
                    // Cooldown between translation chunks
                    if (i + chunkSize < rawTranscriptArr.length) {
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }
                
                rawTranscriptArr = translatedSegments;
                setProgress(38, "Translation complete!");
            } catch(e) {
                console.warn("Transcript translation failed, using original language:", e.message);
            }
        }

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
        }).join('\n').substring(0, 50000);

        const maxContext = currentTranscriptText.substring(0, 50000); 

        // --- AI Generation Pipeline (each step is independent) ---

        // 2. Generate Summary
        try {
            setProgress(40, "Synthesizing comprehensive executive summary...");
            const summaryMsg = [{ role: 'user', parts: [{ text: `You are an expert content analyst. Write a COMPREHENSIVE and DETAILED executive summary of the following video transcript. 

IMPORTANT REQUIREMENTS:
- You MUST respond in ENGLISH only, regardless of the transcript's language
- Your summary MUST be at least 300 words long
- Structure your response with clear paragraphs
- Start with a brief overview paragraph
- Then cover the main topics discussed in detail
- End with key conclusions or final thoughts from the video
- Use professional, engaging language
- Capture ALL major points, not just a brief overview

Transcript:\n${maxContext}` }] }];
            const summaryResult = await generateAIContent(null, summaryMsg);
            // Render with paragraph formatting
            const formattedSummary = summaryResult
                .split('\n')
                .filter(p => p.trim().length > 0)
                .map(p => {
                    if (p.startsWith('#')) return `<h4 style="color:var(--accent-primary);margin:16px 0 8px;">${p.replace(/^#+\s*/, '')}</h4>`;
                    if (p.startsWith('**') && p.endsWith('**')) return `<h4 style="color:var(--accent-primary);margin:16px 0 8px;">${p.replace(/\*\*/g, '')}</h4>`;
                    return `<p style="margin-bottom:12px;line-height:1.8;color:var(--text-secondary);">${p}</p>`;
                })
                .join('');
            document.getElementById('summary-text').innerHTML = formattedSummary || `<p style="line-height:1.8;">${summaryResult}</p>`;
            document.getElementById('summary-tease').innerText = "AI Generated Executive Summary complete.";
        } catch(e) {
            console.error("Summary generation failed:", e.message);
            document.getElementById('summary-text').innerText = "⚠️ Summary generation failed. Please try again or switch AI providers in Settings.";
            document.getElementById('summary-tease').innerText = "Summary unavailable.";
        }

        // Brief cooldown to avoid hitting TPM limits on same provider
        await new Promise(r => setTimeout(r, 3000));

        // 3. Generate Chapters (sequential to avoid double TPM usage)
        setProgress(55, "Generating intelligent video chapters...");

        let chaptersResult = null;
        try {
            const chaptersMsg = [{ role: 'user', parts: [{ text: `You are a video content analyst. Analyze the following timestamped transcript and generate 8-15 detailed chapter markers. Each chapter should represent a distinct topic shift or segment.

IMPORTANT REQUIREMENTS:
- Respond in ENGLISH only, regardless of transcript language
- Generate 8-15 chapters (more for longer videos)
- Each chapter needs a "time" (M:SS format), "title" (concise), and "description" (1-2 sentence summary of what happens in this segment)
- Return ONLY a valid JSON array

Example: [{"time": "0:00", "title": "Introduction", "description": "The host introduces the topic and sets the stage."}, {"time": "2:15", "title": "Main Discussion", "description": "Deep dive into the core subject with examples."}]

Timestamped Transcript:\n${timestampedContext}` }] }];
            chaptersResult = await generateAIContent(null, chaptersMsg);
        } catch(e) {
            console.error("Chapters generation failed:", e.message);
        }

        // Cooldown before next AI call
        await new Promise(r => setTimeout(r, 3000));

        // 4. Generate Highlights
        setProgress(70, "Extracting key highlights...");

        let highlightsResult = null;
        try {
            const highlightMsg = [{ role: "user", parts: [{ text: `You are a content analyst. Extract 8-10 KEY INSIGHTS and takeaways from this video transcript.

IMPORTANT REQUIREMENTS:
- Respond in ENGLISH only, regardless of transcript language
- Extract 8-10 key points (not less)
- Each takeaway should be 2-3 detailed sentences, not just a brief phrase
- Cover different aspects of the video — don't repeat similar points
- Include specific details, facts, numbers, or examples mentioned in the video
- Return ONLY a valid JSON array of strings

Transcript:\n${maxContext}` }] }];
            highlightsResult = await generateAIContent(null, highlightMsg);
        } catch(e) {
            console.error("Highlights generation failed:", e.message);
        }

        const [chaptersSettled, highlightsSettled] = [
            chaptersResult ? { status: 'fulfilled', value: chaptersResult } : { status: 'rejected', reason: new Error('Chapters generation failed') },
            highlightsResult ? { status: 'fulfilled', value: highlightsResult } : { status: 'rejected', reason: new Error('Highlights generation failed') }
        ];

        // Render Chapters
        if (chaptersSettled.status === 'fulfilled') {
            try {
                let chapText = chaptersSettled.value.replace(/```json/g, '').replace(/```/g, '').trim();
                let chaptersArray = [];
                try {
                    chaptersArray = JSON.parse(chapText);
                } catch(e) {
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
                        <div class="chapter-content">
                            <span class="chapter-title">${ch.title}</span>
                            ${ch.description ? `<span class="chapter-desc" style="display:block;font-size:12px;color:var(--text-muted);margin-top:4px;line-height:1.5;">${ch.description}</span>` : ''}
                        </div>
                    `;
                    chList.appendChild(li);
                });
            } catch(e) {
                document.getElementById('chapters-list').innerHTML = '<li style="color: var(--text-muted);">⚠️ Chapter parsing failed.</li>';
            }
        } else {
            console.error("Chapters generation failed:", chaptersSettled.reason?.message);
            document.getElementById('chapters-list').innerHTML = '<li style="color: var(--text-muted);">⚠️ Chapter generation failed. Please try again.</li>';
        }

        // Render Highlights
        if (highlightsSettled.status === 'fulfilled') {
            try {
                let hlText = highlightsSettled.value.replace(/```json/g, '').replace(/```/g, '').trim();
                let highlightsArray = [];
                try {
                    highlightsArray = JSON.parse(hlText);
                } catch(e) {
                    highlightsArray = hlText.split('\n').filter(l => l.trim().length > 0).map(l => l.replace(/^[-\*0-9.]+\s*/, ''));
                }
                
                const hlList = document.getElementById('highlights-list');
                hlList.innerHTML = '';
                highlightsArray.forEach((hl, idx) => {
                    const li = document.createElement('li');
                    li.style.cssText = 'padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05);line-height:1.7;';
                    li.innerHTML = `<strong style="color:var(--accent-primary);margin-right:8px;">${idx + 1}.</strong> ${hl}`;
                    hlList.appendChild(li);
                });
            } catch(e) {
                document.getElementById('highlights-list').innerHTML = '<li style="color: var(--text-muted);">⚠️ Highlights parsing failed.</li>';
            }
        } else {
            console.error("Highlights generation failed:", highlightsSettled.reason?.message);
            document.getElementById('highlights-list').innerHTML = '<li style="color: var(--text-muted);">⚠️ Highlights generation failed. Please try again.</li>';
        }

        setProgress(80, "Finalizing...");

        // Transcript stats
        const wordCount = currentTranscriptText.split(/\s+/).length;
        const readingTime = Math.ceil(wordCount / 200);
        const statsEl = document.getElementById('transcript-stats');
        if (statsEl) statsEl.innerText = `${wordCount.toLocaleString()} words · ~${readingTime} min read`;

        setProgress(90, "Instantiating interactive chat context...");

        // 5. Initialize Chat History
        chatHistory = [
             {
                 role: "user",
                 parts: [{ text: `I am going to ask you questions about a video. Here is the transcript of the video as context. The transcript may be in any language, but you MUST ALWAYS respond in ENGLISH only.\n\n${maxContext}` }],
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
        // Clean, user-friendly error banner with retry button
        const existingError = document.getElementById('error-message');
        if (existingError) existingError.remove();
        
        const errorDiv = document.createElement('div');
        errorDiv.id = 'error-message';
        errorDiv.style.cssText = 'background:rgba(239,68,68,0.08);color:#ef4444;border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;gap:12px;font-size:14px;';
        
        const msg = err.message.includes('All configured AI providers failed') 
            ? 'All AI providers are temporarily rate-limited. Please wait 30 seconds and try again.' 
            : `Error: ${err.message}`;
        
        errorDiv.innerHTML = `<span style="flex:1">⚠️ ${msg}</span><button onclick="this.parentNode.remove()" style="background:rgba(239,68,68,0.15);border:none;color:#ef4444;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px;">Dismiss</button>`;
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

// --- Copy & Download Handlers ---
function flashButton(btn, text) {
    const original = btn.innerHTML;
    btn.innerHTML = `<span style="font-size:12px;">${text}</span>`;
    setTimeout(() => { btn.innerHTML = original; }, 1500);
}

document.getElementById('btn-copy-summary')?.addEventListener('click', () => {
    const text = document.getElementById('summary-text')?.innerText;
    if (text) { navigator.clipboard.writeText(text); flashButton(document.getElementById('btn-copy-summary'), '✓ Copied!'); }
});

document.getElementById('btn-copy-highlights')?.addEventListener('click', () => {
    const items = document.querySelectorAll('#highlights-list li');
    const text = Array.from(items).map((li, i) => `${i+1}. ${li.innerText}`).join('\n');
    if (text) { navigator.clipboard.writeText(text); flashButton(document.getElementById('btn-copy-highlights'), '✓ Copied!'); }
});

document.getElementById('btn-copy-transcript')?.addEventListener('click', () => {
    if (currentTranscriptText) { navigator.clipboard.writeText(currentTranscriptText); flashButton(document.getElementById('btn-copy-transcript'), '✓ Copied!'); }
});

document.getElementById('btn-download-transcript')?.addEventListener('click', () => {
    if (!currentTranscriptText) return;
    const title = document.getElementById('video-title')?.innerText || 'transcript';
    const blob = new Blob([currentTranscriptText], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}_transcript.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    flashButton(document.getElementById('btn-download-transcript'), '✓ Saved!');
});
