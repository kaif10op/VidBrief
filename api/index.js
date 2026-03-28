import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { YoutubeTranscript } from 'youtube-transcript';
import youtubedl from 'youtube-dl-exec';
import fs from 'fs';
import os from 'os';
import path from 'path';
import OpenAI, { toFile } from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
// Import other fallback libraries if needed

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// --- Timeout Helper ---
function withTimeout(promise, ms, label = 'Operation') {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
        )
    ]);
}

// Expose API keys to the frontend securely
app.get('/api/config', (req, res) => {
    try {
        res.json({
            openrouter: process.env.OPENROUTER_API_KEY || '',
            groq: process.env.GROQ_API_KEY || '',
            gemini: process.env.GOOGLE_AI_KEY || '',
            cerebras: process.env.CEREBRAS_API_KEY || '',
            xai: process.env.XAI_API_KEY || '',
            supabaseUrl: process.env.SUPABASE_URL || '',
            supabaseKey: process.env.SUPABASE_ANON_KEY || ''
        });
    } catch (err) {
        console.error("Config fetch error:", err);
        // Fallback to empty config so frontend doesn't crash
        res.json({});
    }
});

function extractVideoId(url) {
    const patterns = [
        /(?:v=|\/v\/|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const p of patterns) {
        const match = url.match(p);
        if (match) return match[1];
    }
    return null;
}

// Optimized Transcript Fetching with Timeouts
app.post('/api/transcript', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'YouTube URL is required' });

    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL' });

    console.log(`[API] Fetching transcript for ${videoId}...`);
    const startTime = Date.now();

    try {
        // Strategy 1: youtube-transcript (Library) — 15s timeout
        try {
            console.log(`[Strategy 1] youtube-transcript library...`);
            const transcript = await withTimeout(
                YoutubeTranscript.fetchTranscript(videoId),
                15000,
                'Strategy 1 (youtube-transcript)'
            );
            if (transcript && transcript.length > 0) {
                let metadata = { title: "YouTube Video", channel: "YouTube Channel", thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, views: "N/A" };
                try {
                    const meta = await withTimeout(fetchMetadata(videoId), 10000, 'Metadata fetch');
                    metadata = { ...metadata, ...meta };
                } catch(e) { console.warn("[Metadata] Skipped:", e.message); }

                console.log(`[Strategy 1] SUCCESS in ${Date.now() - startTime}ms — ${transcript.length} segments`);
                return res.json({
                    success: true,
                    transcript: transcript.map(t => ({
                        text: t.text,
                        offset: t.offset,
                        duration: t.duration
                    })),
                    metadata
                });
            }
        } catch (e) {
            console.warn(`[Strategy 1 Fail] ${e.message} (${Date.now() - startTime}ms)`);
        }

        // Strategy 2: Manual Scraping — 15s timeout
        try {
            console.log(`[Strategy 2] Manual HTML scraping...`);
            const result = await withTimeout(
                fetchTranscriptFromHTML(videoId),
                15000,
                'Strategy 2 (HTML scraping)'
            );
            if (result && result.transcript.length > 0) {
                console.log(`[Strategy 2] SUCCESS in ${Date.now() - startTime}ms — ${result.transcript.length} segments`);
                return res.json({ success: true, ...result });
            }
        } catch (e) {
            console.warn(`[Strategy 2 Fail] ${e.message} (${Date.now() - startTime}ms)`);
        }
        
        // Strategy 3: yt-dlp subtitle extraction — 30s timeout
        try {
            console.log(`[Strategy 3] yt-dlp subtitle extraction...`);
            const info = await withTimeout(
                youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
                    dumpJson: true,
                    noCheckCertificates: true,
                    noWarnings: true
                }),
                30000,
                'Strategy 3 (yt-dlp)'
            );
            
            const subs = info.subtitles || {};
            const autoCaptions = info.automatic_captions || {};
            
            let subUrl = null;
            let subLang = null;
            
            const pickTrack = (tracks, lang) => {
                if (tracks[lang]) {
                    const json3 = tracks[lang].find(f => f.ext === 'json3');
                    const srv1 = tracks[lang].find(f => f.ext === 'srv1');
                    return json3 || srv1 || tracks[lang][0];
                }
                return null;
            };
            
            const englishVariants = ['en', 'en-US', 'en-GB', 'en-orig'];
            
            for (const source of [subs, autoCaptions]) {
                if (Object.keys(source).length === 0) continue;
                for (const lang of englishVariants) {
                    let track = pickTrack(source, lang);
                    if (track) { subUrl = track.url; subLang = lang; break; }
                }
                if (subUrl) break;
            }
            
            if (!subUrl) {
                for (const source of [subs, autoCaptions]) {
                    if (Object.keys(source).length === 0) continue;
                    const firstLang = Object.keys(source)[0];
                    let track = pickTrack(source, firstLang);
                    if (track) { subUrl = track.url; subLang = firstLang; break; }
                }
            }
            
            if (subUrl) {
                console.log(`[Strategy 3] Found ${subLang} subtitles. Downloading...`);
                const subRes = await withTimeout(
                    fetch(subUrl, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                    }),
                    10000,
                    'Subtitle download'
                );
                const subData = await subRes.text();
                
                let segments = [];
                
                try {
                    const json = JSON.parse(subData);
                    if (json.events) {
                        segments = json.events
                            .filter(e => e.segs && e.segs.length > 0)
                            .map(e => ({
                                text: e.segs.map(s => s.utf8).join('').trim(),
                                offset: e.tStartMs || 0,
                                duration: e.dDurationMs || 0
                            }))
                            .filter(s => s.text.length > 0);
                    }
                } catch(jsonErr) {
                    const regex = /<text start="([\d.]+)" dur="([\d.]+)".*?>(.*?)<\/text>/g;
                    let match;
                    while ((match = regex.exec(subData)) !== null) {
                        segments.push({
                            text: match[3].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
                            offset: Math.round(parseFloat(match[1]) * 1000),
                            duration: Math.round(parseFloat(match[2]) * 1000)
                        });
                    }
                }
                
                if (segments.length > 0) {
                    console.log(`[Strategy 3] SUCCESS in ${Date.now() - startTime}ms — ${segments.length} segments (lang: ${subLang})`);
                    let metadata = { title: info.title || "YouTube Video", channel: info.uploader || "YouTube Channel", thumbnail: info.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, views: info.view_count ? info.view_count.toLocaleString() : "N/A" };
                    return res.json({ success: true, transcript: segments, language: subLang, metadata });
                }
            }
            
            console.log(`[Strategy 3] No usable subtitles found via yt-dlp.`);
        } catch (e) {
            console.warn(`[Strategy 3 Fail] ${e.message} (${Date.now() - startTime}ms)`);
        }
        
        // If all strategies fail
        console.log(`[API] All transcript strategies failed for ${videoId} in ${Date.now() - startTime}ms`);
        return res.status(200).json({ success: false, code: 'NO_TRANSCRIPT_AVAILABLE', error: 'This video does not have any captions or transcripts available on YouTube.' });

    } catch (error) {
        console.error('Final Transcript error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

async function fetchMetadata(videoId) {
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetch(pageUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        }
    });
    const html = await res.text();
    let metadata = {};
    const metaMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.*?\});/s) 
                   || html.match(/"videoDetails"\s*:\s*(\{[^}]+\})/);
    if (metaMatch) {
        try {
            const playerResp = JSON.parse(metaMatch[1]);
            const vd = playerResp.videoDetails || playerResp;
            metadata.title = vd.title;
            metadata.channel = vd.author;
            metadata.thumbnail = vd.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
            metadata.views = vd.viewCount ? parseInt(vd.viewCount).toLocaleString() : "N/A";
        } catch(e) {}
    }
    return metadata;
}

async function fetchTranscriptFromHTML(videoId) {
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const pageRes = await fetch(pageUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        }
    });
    
    const html = await pageRes.text();
    if (html.includes('class="g-recaptcha"')) throw new Error('Bot detection triggered');
    
    const tracksMatch = html.match(/"captionTracks":\s*(\[.*?\])/s);
    if (!tracksMatch) throw new Error('No caption tracks found');
    
    const tracks = JSON.parse(tracksMatch[1]);
    let track = tracks.find(t => t.languageCode === 'en' && !t.kind) 
                || tracks.find(t => t.languageCode === 'en')
                || tracks.find(t => t.languageCode.startsWith('en'))
                || tracks[0];
    
    const captionRes = await fetch(track.baseUrl);
    const captionXml = await captionRes.text();
    
    const segments = [];
    const regex = /<text start="([\d.]+)" dur="([\d.]+)".*?>(.*?)<\/text>/g;
    let match;
    while ((match = regex.exec(captionXml)) !== null) {
        segments.push({
            text: match[3].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
            offset: Math.round(parseFloat(match[1]) * 1000),
            duration: Math.round(parseFloat(match[2]) * 1000)
        });
    }
    
    return { transcript: segments, metadata: await fetchMetadata(videoId) };
}


// --- Whisper Audio Fallback Strategy ---
app.post('/api/audio-transcript', async (req, res) => {
    const { url } = req.body;
    const whisperKey = req.body.whisperKey || process.env.GROQ_API_KEY;
    if (!url) return res.status(400).json({ error: 'YouTube URL is required' });
    if (!whisperKey && !process.env.GOOGLE_AI_KEY) return res.status(400).json({ error: 'At least one Audio API Key (Groq or Gemini) is required.' });

    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL' });

    console.log(`[Audio API] Extracting audio stream for ${videoId}...`);

    try {
        // 1. Download audio file via yt-dlp — 60s timeout
        const tmpDir = os.tmpdir();
        const baseName = `audio_${videoId}_${Date.now()}`;
        const outputTemplate = path.join(tmpDir, `${baseName}.%(ext)s`);
        
        await withTimeout(
            youtubedl(url, {
                format: 'bestaudio[filesize<25M]/bestaudio',
                output: outputTemplate,
                noCheckCertificates: true,
                maxFilesize: '24m',
                noWarnings: true
            }),
            60000,
            'Audio download'
        );

        // Find the actual file yt-dlp created
        const files = fs.readdirSync(tmpDir);
        const actualFile = files.find(f => f.startsWith(baseName));
        if (!actualFile) throw new Error("Failed to download audio file from YouTube (video may be too large or restricted).");
        
        const outputFilename = path.join(tmpDir, actualFile);
        const ext = path.extname(actualFile).replace('.', '') || 'webm';

        console.log(`[Audio API] Downloaded to ${outputFilename}. Trying Groq Whisper...`);

        let transcript;

        try {
            if (!whisperKey) throw new Error("No Groq Whisper key provided.");
            const openai = new OpenAI({
                baseURL: "https://api.groq.com/openai/v1",
                apiKey: whisperKey
            });

            const fileObj = await toFile(fs.createReadStream(outputFilename), 'audio.mp4');

            const whisperData = await withTimeout(
                openai.audio.transcriptions.create({
                    file: fileObj,
                    model: "whisper-large-v3-turbo",
                    response_format: "verbose_json",
                    prompt: "Please transcribe the following audio carefully."
                }),
                45000,
                'Groq Whisper transcription'
            );

            transcript = (whisperData.segments || []).map(seg => ({
                text: seg.text.trim(),
                offset: Math.floor(seg.start * 1000),
                duration: Math.floor((seg.end - seg.start) * 1000)
            }));

            if (transcript.length === 0) {
                 throw new Error('Whisper returned empty transcription.');
            }
        } catch (groqErr) {
            console.warn(`[Groq Audio Fail] ${groqErr.message}. Falling back to Gemini 1.5 Flash...`);
            
            const geminiKey = process.env.GOOGLE_AI_KEY;
            if (!geminiKey) throw new Error(`Groq failed and no Google AI key available for fallback. Groq Error: ${groqErr.message}`);

            const fileManager = new GoogleAIFileManager(geminiKey);
            const uploadResult = await withTimeout(
                fileManager.uploadFile(outputFilename, { mimeType: "audio/mp4", displayName: "Audio Fallback" }),
                30000,
                'Gemini file upload'
            );
            
            const genAI = new GoogleGenerativeAI(geminiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            
            const result = await withTimeout(
                model.generateContent([
                    "Transcribe this audio exactly. Do not add any conversational filler, just the exact words spoken in the audio.",
                    { fileData: { fileUri: uploadResult.file.uri, mimeType: uploadResult.file.mimeType } }
                ]),
                45000,
                'Gemini transcription'
            );
            
            const text = result.response.text();
            
            try { await fileManager.deleteFile(uploadResult.file.name); } catch(delErr) {}
            
            if (!text || text.trim() === '') throw new Error("Gemini returned empty transcription.");
            
            transcript = [{
                text: text.trim(),
                offset: 0,
                duration: 60000
            }];
        }

        // Cleanup temp file
        try { fs.unlinkSync(outputFilename); } catch (e) { console.error("Cleanup error:", e); }

        res.json({ success: true, transcript, metadata: await fetchMetadata(videoId), isWhisperFallback: true });

    } catch (error) {
        console.error('Audio Transcription error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- AI GENERATION ENGINE ---
const PROVIDER_MAX_CHARS = {
    groq: 10000,
    openrouter: 50000,
    gemini: 50000,
    cerebras: 6000
};

async function executeAIRequestServer(provider, apiKey, systemPrompt, userMessages) {
    let url, headers = {}, body = {};
    const messages = systemPrompt ? [{ role: "system", content: systemPrompt }, ...userMessages] : userMessages;
    let isGoogleFormat = false;

    switch (provider) {
        case 'openrouter':
            url = 'https://openrouter.ai/api/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
            body = { model: 'meta-llama/llama-3.3-70b-instruct:free', messages };
            break;
        case 'cerebras':
            url = 'https://api.cerebras.ai/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
            body = { model: 'llama3.1-8b', messages };
            break;
        case 'groq':
            url = 'https://api.groq.com/openai/v1/chat/completions';
            headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
            body = { model: 'llama-3.3-70b-versatile', messages };
            break;
        case 'gemini':
            isGoogleFormat = true;
            url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            headers = { 'Content-Type': 'application/json' };
            const geminiMessages = messages.map(m => ({
                role: m.role === 'system' ? 'user' : (m.role === 'assistant' ? 'model' : 'user'),
                parts: [{ text: m.content || m.parts?.[0]?.text || '' }]
            }));
            if (systemPrompt) geminiMessages.unshift({ role: 'user', parts: [{ text: `SYSTEM INSTRUCTION: ${systemPrompt}` }] });
            body = { contents: geminiMessages };
            break;
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) {
        const errInfo = await response.text();
        throw new Error(`${provider} API Error: ${response.status} ${errInfo}`);
    }
    const data = await response.json();
    return isGoogleFormat ? data.candidates[0].content.parts[0].text : data.choices[0].message.content;
}

app.post('/api/generate', async (req, res) => {
    try {
        const { systemPrompt, userMessages, clientKeys, preferredProvider } = req.body;
        
        const getApiKey = (provider) => {
            const keyMap = { openrouter: 'OPENROUTER_API_KEY', groq: 'GROQ_API_KEY', gemini: 'GOOGLE_AI_KEY', cerebras: 'CEREBRAS_API_KEY'};
            return (clientKeys && clientKeys[provider]) || process.env[keyMap[provider]];
        };

        const allProviders = ['groq', 'openrouter', 'gemini', 'cerebras'];
        const fallbackQueue = [preferredProvider || 'groq', ...allProviders.filter(p => p !== (preferredProvider || 'groq'))];

        for (const provider of fallbackQueue) {
            const apiKey = getApiKey(provider);
            if (!apiKey) continue;
            
            const maxChars = PROVIDER_MAX_CHARS[provider] || 20000;
            const sizedMessages = userMessages.map(m => {
                const text = m.content || (m.parts && m.parts[0] && m.parts[0].text) || '';
                return { role: m.role, content: text.substring(0, maxChars) };
            });

            try {
                console.log(`[AI] Attempting generation via ${provider}...`);
                const result = await withTimeout(
                    executeAIRequestServer(provider, apiKey, systemPrompt, sizedMessages),
                    30000,
                    `AI generation (${provider})`
                );
                return res.json({ success: true, result, provider });
            } catch (err) {
                console.warn(`[AI] Provider ${provider} failed: ${err.message}`);
            }
        }
        res.status(500).json({ success: false, error: 'All configured AI providers failed due to rate limits or API errors.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// For local testing if needed
if (process.env.NODE_ENV !== 'production') {
    const port = 3001;
    app.listen(port, () => console.log(`API listening on port ${port}`));
}

export default app;
