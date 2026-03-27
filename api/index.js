import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { YoutubeTranscript } from 'youtube-transcript';
import youtubedl from 'youtube-dl-exec';
import fs from 'fs';
import os from 'os';
import path from 'path';
import OpenAI, { toFile } from 'openai';
// Import other fallback libraries if needed

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

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

// Optimized Transcript Fetching for Serverless (Pure JS)
app.post('/api/transcript', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'YouTube URL is required' });

    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL' });

    console.log(`[Vercel API] Fetching transcript for ${videoId}...`);

    try {
        // Strategy 1: youtube-transcript (Library)
        try {
            const transcript = await YoutubeTranscript.fetchTranscript(videoId);
            if (transcript && transcript.length > 0) {
                // We still need metadata (title, channel, thumbnails)
                // We'll use a basic metadata fetch strategy
                let metadata = { title: "YouTube Video", channel: "YouTube Channel", thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, views: "N/A" };
                try {
                    const meta = await fetchMetadata(videoId);
                    metadata = { ...metadata, ...meta };
                } catch(e) {}

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
            console.error("[Strategy 1 Fail]", e.message);
        }

        // Strategy 2: Manual Scraping (Ported from server.js)
        try {
            const result = await fetchTranscriptFromHTML(videoId);
            if (result && result.transcript.length > 0) {
                return res.json({ success: true, ...result });
            }
        } catch (e) {
            console.error("[Strategy 2 Fail]", e.message);
        }
        
        // Strategy 3: yt-dlp subtitle extraction (bypasses YouTube bot protection)
        try {
            console.log(`[Strategy 3] Trying yt-dlp subtitle extraction for ${videoId}...`);
            const info = await youtubedl(url, {
                dumpJson: true,
                noCheckCertificates: true,
                noWarnings: true
            });
            
            const subs = info.subtitles || {};
            const autoCaptions = info.automatic_captions || {};
            
            // Pick best subtitle track: prefer manual English > manual any > auto English > auto any
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
            
            // Try manual subs first, then auto-captions
            // Priority: Manual English > Auto English > Manual any > Auto any
            const englishVariants = ['en', 'en-US', 'en-GB', 'en-orig'];
            
            // Phase 1: Try English first across all sources
            for (const source of [subs, autoCaptions]) {
                if (Object.keys(source).length === 0) continue;
                for (const lang of englishVariants) {
                    let track = pickTrack(source, lang);
                    if (track) { subUrl = track.url; subLang = lang; break; }
                }
                if (subUrl) break;
            }
            
            // Phase 2: If no English found, take the first available language
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
                const subRes = await fetch(subUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                });
                const subData = await subRes.text();
                
                let segments = [];
                
                // Try JSON3 format first
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
                    // Fallback: parse as XML/SRV1
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
                    console.log(`[Strategy 3] Got ${segments.length} segments via yt-dlp subtitles.`);
                    return res.json({ success: true, transcript: segments, metadata: await fetchMetadata(videoId) });
                }
            }
            
            console.log(`[Strategy 3] No usable subtitles found via yt-dlp.`);
        } catch (e) {
            console.error("[Strategy 3 Fail]", e.message);
        }
        
        // If all strategies fail, the video truly has no captions available
        return res.status(404).json({ success: false, code: 'NO_TRANSCRIPT_AVAILABLE', error: 'This video does not have any captions or transcripts available on YouTube.' });

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
    if (!whisperKey) return res.status(400).json({ error: 'Groq API Key is required. Set GROQ_API_KEY in .env or pass a key from client settings.' });

    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL' });

    console.log(`[Audio API] Extracting audio stream for ${videoId}...`);

    try {
        // 1. Download audio file via yt-dlp
        const tmpDir = os.tmpdir();
        const baseName = `audio_${videoId}_${Date.now()}`;
        const outputTemplate = path.join(tmpDir, `${baseName}.%(ext)s`);
        
        await youtubedl(url, {
            format: 'bestaudio',
            output: outputTemplate,
            noCheckCertificates: true,
            maxFilesize: '24m',
            noWarnings: true
        });

        // Find the actual file yt-dlp created (it often leaves it as .part if ffmpeg is missing)
        const files = fs.readdirSync(tmpDir);
        const actualFile = files.find(f => f.startsWith(baseName));
        if (!actualFile) throw new Error("Failed to neatly download audio file from YouTube (video may be too large or restricted).");
        
        const outputFilename = path.join(tmpDir, actualFile);
        const ext = path.extname(actualFile).replace('.', '') || 'webm';

        console.log(`[Audio API] Downloaded to ${outputFilename}. Ping Groq Whisper...`);

        // 2. Read file to Buffer and prep FormData using native OpenAI SDK (Groq Compatible)
        const openai = new OpenAI({
            baseURL: "https://api.groq.com/openai/v1",
            apiKey: whisperKey
        });

        // We force the extension to .mp4 to bypass Groq WebM proxy restrictions
        const fileObj = await toFile(fs.createReadStream(outputFilename), 'audio.mp4');

        const whisperData = await openai.audio.transcriptions.create({
            file: fileObj,
            model: "whisper-large-v3-turbo",
            response_format: "verbose_json",
            prompt: "Please transcribe the following audio carefully."
        });

        // 3. Cleanup temp file instantly
        try { fs.unlinkSync(outputFilename); } catch (e) { console.error("Cleanup error:", e); }
        
        // 5. Transform Groq segments into standard transcript app format
        const transcript = (whisperData.segments || []).map(seg => ({
            text: seg.text.trim(),
            offset: Math.floor(seg.start * 1000),
            duration: Math.floor((seg.end - seg.start) * 1000)
        }));

        if (transcript.length === 0) {
             throw new Error('Whisper returned empty transcription.');
        }

        res.json({ success: true, transcript, metadata: await fetchMetadata(videoId), isWhisperFallback: true });

    } catch (error) {
        console.error('Audio Transcription error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// For local testing if needed
if (process.env.NODE_ENV !== 'production') {
    const port = 3001;
    app.listen(port, () => console.log(`API listening on port ${port}`));
}

export default app;
