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
        xai: process.env.XAI_API_KEY || '',
        openai: process.env.OPENAI_API_KEY || '',
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

// --- Strategy 1: Scrape YouTube page HTML directly ---
async function fetchTranscriptFromHTML(videoId) {
    console.log(`[Strategy 1] Scraping YouTube page for ${videoId}...`);
    
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const pageRes = await fetch(pageUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
    });
    
    // Grab cookies for subsequent requests
    const cookies = pageRes.headers.getSetCookie?.() || [];
    const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');
    
    const html = await pageRes.text();
    
    // Check for captcha / bot detection
    if (html.includes('class="g-recaptcha"')) {
        throw new Error('YouTube requires captcha — IP is rate limited');
    }
    
    // Extract video metadata from ytInitialPlayerResponse
    let metadata = { title: "YouTube Video", channel: "YouTube Channel", thumbnail: "", views: "N/A" };
    const metaMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.*?\});/s) 
                   || html.match(/"videoDetails"\s*:\s*(\{[^}]+\})/);
    if (metaMatch) {
        try {
            const playerResp = JSON.parse(metaMatch[1]);
            const vd = playerResp.videoDetails || playerResp;
            metadata.title = vd.title || metadata.title;
            metadata.channel = vd.author || metadata.channel;
            metadata.thumbnail = vd.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
            metadata.views = vd.viewCount ? parseInt(vd.viewCount).toLocaleString() : "N/A";
        } catch(e) { /* ignore parse errors */ }
    }
    
    // Extract caption tracks
    const tracksMatch = html.match(/"captionTracks":\s*(\[.*?\])/s);
    if (!tracksMatch) {
        throw new Error('No caption tracks found in YouTube page');
    }
    
    const tracks = JSON.parse(tracksMatch[1]);
    
    // Find English track
    let track = tracks.find(t => t.languageCode === 'en' && !t.kind);
    if (!track) track = tracks.find(t => t.languageCode === 'en');
    if (!track) track = tracks.find(t => t.languageCode.startsWith('en'));
    if (!track) track = tracks[0];
    
    const captionUrl = track.baseUrl;
    
    // Try fetching with cookies + retry logic
    for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`  Attempt ${attempt}: Fetching captions from timedtext API...`);
        
        const capRes = await fetch(captionUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cookie': cookieStr,
                'Referer': pageUrl,
            }
        });
        
        if (!capRes.ok) {
            if (capRes.status === 429 && attempt < 3) {
                console.log(`  Got 429, waiting ${attempt * 2}s before retry...`);
                await new Promise(r => setTimeout(r, attempt * 2000));
                continue;
            }
            throw new Error(`Caption fetch failed: ${capRes.status}`);
        }
        
        const capText = await capRes.text();
        if (capText.length === 0 && attempt < 3) {
            console.log(`  Empty response, waiting ${attempt * 2}s before retry...`);
            await new Promise(r => setTimeout(r, attempt * 2000));
            continue;
        }
        
        if (capText.length > 0) {
            const segments = parseXMLCaptions(capText);
            if (segments.length > 0) {
                return { transcript: segments, metadata };
            }
        }
    }
    
    throw new Error('Caption content was empty after retries');
}

function parseXMLCaptions(xmlText) {
    const segments = [];
    const regex = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    let match;
    while ((match = regex.exec(xmlText)) !== null) {
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
    return segments;
}

function parseJson3Captions(jsonText) {
    const segments = [];
    try {
        const j3 = JSON.parse(jsonText);
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
    } catch(e) { /* not valid json3 */ }
    return segments;
}

// --- Strategy 2: Use yt-dlp to get metadata + subtitle URL, then fetch ---
async function fetchTranscriptWithYtDlp(videoId) {
    console.log(`[Strategy 2] Using yt-dlp for ${videoId}...`);
    
    const cmd = `yt-dlp --dump-json "https://www.youtube.com/watch?v=${videoId}"`;
    const { stdout } = await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10 });
    const info = JSON.parse(stdout);
    
    const metadata = {
        title: info.title || "YouTube Video",
        channel: info.uploader || "YouTube Channel",
        thumbnail: info.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        views: info.view_count ? info.view_count.toLocaleString() : "N/A"
    };
    
    // Find subtitle URL
    let subUrl = null;
    let isJson3 = false;
    
    const checkSubs = (subs) => {
        if (!subs) return;
        const json3Fmt = subs.find(s => s.ext === 'json3');
        if (json3Fmt) { subUrl = json3Fmt.url; isJson3 = true; return; }
        const xmlFmt = subs.find(s => s.ext === 'srv3' || s.ext === 'srv1' || s.ext === 'ttml');
        if (xmlFmt) subUrl = xmlFmt.url;
    };
    
    if (info.subtitles?.en) checkSubs(info.subtitles.en);
    if (!subUrl && info.automatic_captions?.en) checkSubs(info.automatic_captions.en);
    if (!subUrl && info.automatic_captions?.['en-orig']) checkSubs(info.automatic_captions['en-orig']);
    
    if (!subUrl) {
        throw new Error('No English transcript found via yt-dlp');
    }
    
    // Try fetching subtitle content with retries
    for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`  Attempt ${attempt}: Fetching subtitle (json3=${isJson3})...`);
        
        const fetchRes = await fetch(subUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
            }
        });
        
        if (!fetchRes.ok) {
            if (fetchRes.status === 429 && attempt < 3) {
                console.log(`  Got 429, waiting ${attempt * 3}s...`);
                await new Promise(r => setTimeout(r, attempt * 3000));
                continue;
            }
            throw new Error(`Subtitle fetch failed: ${fetchRes.status}`);
        }
        
        const content = await fetchRes.text();
        if (content.length === 0 && attempt < 3) {
            console.log(`  Empty response, retrying in ${attempt * 3}s...`);
            await new Promise(r => setTimeout(r, attempt * 3000));
            continue;
        }
        
        if (content.length > 0) {
            const segments = (isJson3 || content.startsWith('{')) 
                ? parseJson3Captions(content) 
                : parseXMLCaptions(content);
            if (segments.length > 0) {
                return { transcript: segments, metadata };
            }
        }
    }
    
    // Fallback: return metadata with yt-dlp description as pseudo-transcript
    throw new Error('Subtitle content was empty (429 rate limited)');
}

// --- Strategy 3: Use yt-dlp to write subtitles to a temp file ---
async function fetchTranscriptWithYtDlpFile(videoId) {
    console.log(`[Strategy 3] Using yt-dlp file download for ${videoId}...`);
    
    const tmpPrefix = `tmp_sub_${videoId}_${Date.now()}`;
    
    try {
        // First get metadata
        const metaCmd = `yt-dlp --dump-json "https://www.youtube.com/watch?v=${videoId}"`;
        const { stdout: metaOut } = await execAsync(metaCmd, { maxBuffer: 1024 * 1024 * 10 });
        const info = JSON.parse(metaOut);
        
        const metadata = {
            title: info.title || "YouTube Video",
            channel: info.uploader || "YouTube Channel",
            thumbnail: info.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
            views: info.view_count ? info.view_count.toLocaleString() : "N/A"
        };
        
        // Try to download subs to file
        const subCmd = `yt-dlp --write-auto-subs --write-subs --sub-lang en --sub-format json3/srv3/vtt --skip-download -o "${tmpPrefix}" "https://www.youtube.com/watch?v=${videoId}"`;
        await execAsync(subCmd, { maxBuffer: 1024 * 1024 * 5 });
        
        // Check for downloaded subtitle files
        const { readdir, readFile, unlink } = await import('fs/promises');
        const files = (await readdir('.')).filter(f => f.startsWith(tmpPrefix) && !f.endsWith('.json'));
        
        if (files.length === 0) {
            throw new Error('No subtitle file was downloaded');
        }
        
        for (const file of files) {
            const content = await readFile(file, 'utf-8');
            // Clean up temp file
            await unlink(file).catch(() => {});
            
            if (content.length > 0) {
                let segments = [];
                if (file.endsWith('.json3')) {
                    segments = parseJson3Captions(content);
                } else if (file.endsWith('.vtt')) {
                    segments = parseVTTCaptions(content);
                } else {
                    segments = parseXMLCaptions(content);
                }
                if (segments.length > 0) {
                    return { transcript: segments, metadata };
                }
            }
        }
        
        throw new Error('Downloaded subtitle files were empty');
    } finally {
        // Clean up any leftover files
        const { readdir, unlink } = await import('fs/promises');
        const files = (await readdir('.')).filter(f => f.startsWith(tmpPrefix));
        for (const f of files) await unlink(f).catch(() => {});
    }
}

function parseVTTCaptions(vttText) {
    const segments = [];
    const lines = vttText.split('\n');
    let i = 0;
    while (i < lines.length) {
        // Look for timestamp lines: 00:00:00.000 --> 00:00:05.000
        const tsMatch = lines[i]?.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
        if (tsMatch) {
            const startMs = (parseInt(tsMatch[1]) * 3600 + parseInt(tsMatch[2]) * 60 + parseInt(tsMatch[3])) * 1000 + parseInt(tsMatch[4]);
            const endMs = (parseInt(tsMatch[5]) * 3600 + parseInt(tsMatch[6]) * 60 + parseInt(tsMatch[7])) * 1000 + parseInt(tsMatch[8]);
            
            i++;
            let text = '';
            while (i < lines.length && lines[i]?.trim() !== '') {
                text += (text ? ' ' : '') + lines[i].replace(/<[^>]+>/g, '').trim();
                i++;
            }
            if (text) {
                segments.push({ text, offset: startMs, duration: endMs - startMs });
            }
        }
        i++;
    }
    return segments;
}

// --- Strategy 4: Use video description as fallback "transcript" ---
async function fetchDescriptionFallback(videoId) {
    console.log(`[Strategy 4] Using video description as fallback for ${videoId}...`);
    
    const cmd = `yt-dlp --dump-json "https://www.youtube.com/watch?v=${videoId}"`;
    const { stdout } = await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10 });
    const info = JSON.parse(stdout);
    
    const metadata = {
        title: info.title || "YouTube Video",
        channel: info.uploader || "YouTube Channel",
        thumbnail: info.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        views: info.view_count ? info.view_count.toLocaleString() : "N/A"
    };
    
    const description = info.description || '';
    if (description.length < 50) {
        throw new Error('Video description too short for meaningful analysis');
    }
    
    // Split description into pseudo-transcript segments
    const sentences = description.split(/[.\n]+/).filter(s => s.trim().length > 0);
    const transcript = sentences.map((s, i) => ({
        text: s.trim(),
        offset: i * 5000,  // Fake timestamps
        duration: 5000
    }));
    
    return { transcript, metadata, isDescriptionFallback: true };
}

// --- Main fetch function with strategy cascade ---
async function fetchYouTubeTranscript(videoId) {
    const strategies = [
        { name: 'HTML Scraping', fn: fetchTranscriptFromHTML },
        { name: 'yt-dlp URL', fn: fetchTranscriptWithYtDlp },
        { name: 'yt-dlp File', fn: fetchTranscriptWithYtDlpFile },
        { name: 'Description Fallback', fn: fetchDescriptionFallback },
    ];
    
    let lastError = null;
    
    for (const strategy of strategies) {
        try {
            const result = await strategy.fn(videoId);
            console.log(`✓ ${strategy.name} succeeded: ${result.transcript.length} segments`);
            return result;
        } catch(err) {
            console.log(`✗ ${strategy.name} failed: ${err.message}`);
            lastError = err;
        }
    }
    
    throw new Error(`All transcript strategies failed. Last error: ${lastError?.message}. YouTube may be rate-limiting this IP. Try again later or use a VPN.`);
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
            transcript: result.transcript,
            isDescriptionFallback: result.isDescriptionFallback || false
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
