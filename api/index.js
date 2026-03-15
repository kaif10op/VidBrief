import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { YoutubeTranscript } from 'youtube-transcript';
// Import other fallback libraries if needed

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Expose API keys to the frontend
app.get('/api/config', (req, res) => {
    res.json({
        openrouter: process.env.OPENROUTER_API_KEY || '',
        groq: process.env.GROQ_API_KEY || '',
        gemini: process.env.GOOGLE_AI_KEY || '',
        cerebras: process.env.CEREBRAS_API_KEY || '',
        xai: process.env.XAI_API_KEY || '',
        supabaseUrl: process.env.SUPABASE_URL || '',
        supabaseKey: process.env.SUPABASE_ANON_KEY || ''
    });
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

        // Strategy 3: Description Fallback (Ported from server.js)
        try {
            const result = await fetchDescriptionFallback(videoId);
            if (result && result.transcript.length > 0) {
                return res.json({ success: true, ...result, isDescriptionFallback: true });
            }
        } catch (e) {
            console.error("[Strategy 3 Fail]", e.message);
        }
        
        throw new Error('All transcript extraction strategies failed. YouTube may be rate-limiting serverless IPs.');

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

async function fetchDescriptionFallback(videoId) {
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetch(pageUrl);
    const html = await res.text();
    
    let description = "";
    const descMatch = html.match(/"shortDescription":"(.*?)"/);
    if (descMatch) {
        description = descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }

    if (description.length < 50) throw new Error('Description too short');

    const sentences = description.split(/[.\n]+/).filter(s => s.trim().length > 0);
    const transcript = sentences.map((s, i) => ({
        text: s.trim(),
        offset: i * 5000,
        duration: 5000
    }));
    
    return { transcript, metadata: await fetchMetadata(videoId) };
}


// For local testing if needed
if (process.env.NODE_ENV !== 'production') {
    const port = 3001;
    app.listen(port, () => console.log(`API listening on port ${port}`));
}

export default app;
