import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

// Load .env file from the project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Expose API keys to the frontend
app.get('/api/config', (req, res) => {
    res.json({
        openrouter: process.env.OPENROUTER_API_KEY || '',
        groq: process.env.GROQ_API_KEY || '',
        gemini: process.env.GOOGLE_AI_KEY || '',
        cerebras: process.env.CEREBRAS_API_KEY || '',
        xai: process.env.XAI_API_KEY || ''
    });
});

function extractVideoId(url) {
    const patterns = [
        /(?:v=|\/v\/|youtu\.be\/|\/embed\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const p of patterns) {
        const match = url.match(p);
        if (match) return match[1];
    }
    return null;
}

async function fetchYouTubeTranscript(videoId) {
    console.log(`Extracting info for ${videoId} using yt-dlp...`);
    
    // Use yt-dlp to dump all metadata including subtitle URLs as JSON
    const cmd = `yt-dlp --dump-json "https://www.youtube.com/watch?v=${videoId}"`;
    
    // Set a larger maxBuffer since JSON dumps can be huge (10MB)
    const { stdout } = await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10 });
    
    const info = JSON.parse(stdout);
    
    let subUrl = null;
    let isJson3 = false;
    
    // First check manual subtitles for English
    if (info.subtitles && info.subtitles.en) {
        // Try to find json3 format first, fallback to srv3/srv1
        const json3Fmt = info.subtitles.en.find(s => s.ext === 'json3');
        if (json3Fmt) {
            subUrl = json3Fmt.url;
            isJson3 = true;
        } else {
            const xmlFmt = info.subtitles.en.find(s => s.ext === 'srv3' || s.ext === 'srv1' || s.ext === 'ttml');
            if (xmlFmt) subUrl = xmlFmt.url;
        }
    }
    
    // Fallback to auto-generated subtitles if no manual en
    if (!subUrl && info.automatic_captions && (info.automatic_captions.en || info.automatic_captions['en-orig'])) {
        const autoEn = info.automatic_captions.en || info.automatic_captions['en-orig'];
        const json3Fmt = autoEn.find(s => s.ext === 'json3');
        if (json3Fmt) {
            subUrl = json3Fmt.url;
            isJson3 = true;
        } else {
            const xmlFmt = autoEn.find(s => s.ext === 'srv3' || s.ext === 'srv1');
            if (xmlFmt) subUrl = xmlFmt.url;
        }
    }
    
    if (!subUrl) {
        throw new Error('No English transcript (manual or auto-generated) found for this video.');
    }
    
    console.log(`Fetching subtitle URL (isJson3: ${isJson3}): ${subUrl.substring(0, 100)}...`);
    
    const fetchRes = await fetch(subUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });
    
    if (!fetchRes.ok) {
        throw new Error(`Failed to fetch subtitle payload: ${fetchRes.status}`);
    }
    
    const content = await fetchRes.text();
    const segments = [];
    
    if (isJson3 || content.startsWith('{')) {
        try {
            const j3 = JSON.parse(content);
            if (j3.events) {
                for (const ev of j3.events) {
                    if (ev.segs) {
                        const txt = ev.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
                        if (txt) {
                            segments.push({
                                text: txt,
                                offset: ev.tStartMs || 0,
                                duration: ev.dDurationMs || 0
                            });
                        }
                    }
                }
            }
        } catch(e) {
            console.error('Failed to parse json3 format', e);
        }
    } else {
        // Parse basic XML
        const regex = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            let text = match[3]
                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                .replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim();
            if (text) {
                segments.push({
                    text,
                    offset: Math.round(parseFloat(match[1]) * 1000),
                    duration: Math.round(parseFloat(match[2]) * 1000)
                });
            }
        }
    }
    
    if (segments.length === 0) {
         throw new Error('Parsed transcript was empty.');
    }
    
    return {
        transcript: segments,
        metadata: {
            title: info.title || "YouTube Video",
            channel: info.uploader || "YouTube Channel",
            thumbnail: info.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
            views: info.view_count ? info.view_count.toLocaleString() : "N/A"
        }
    };
}

app.get('/api/transcript', async (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.status(400).json({ error: 'YouTube URL is required' });
    }
    
    const videoId = extractVideoId(url);
    if (!videoId) {
        return res.status(400).json({ success: false, error: 'Invalid YouTube URL.' });
    }

    try {
        const result = await fetchYouTubeTranscript(videoId);
        
        console.log(`✓ Transcript ready: ${result.transcript.length} segments for "${result.metadata.title}"`);

        res.json({
            success: true,
            metadata: result.metadata,
            transcript: result.transcript
        });

    } catch (error) {
        console.error('✗ Error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to analyze video. Ensure the video is public and has captions.' 
        });
    }
});

app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
});
