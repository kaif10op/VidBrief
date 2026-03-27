import youtubedl from 'youtube-dl-exec';
import os from 'os';
import path from 'path';
import fs from 'fs';

async function run() {
    const videoUrl = 'https://www.youtube.com/watch?v=90IxM5XRPAE'; 
    console.log("Testing:", videoUrl);
    
    try {
        const tmpDir = os.tmpdir();
        const baseName = `audio_90IxM5XRPAE_${Date.now()}`;
        const outputTemplate = path.join(tmpDir, `${baseName}.%(ext)s`);
        
        console.log("Downloading to:", outputTemplate);
        await youtubedl(videoUrl, {
            format: 'bestaudio',
            output: outputTemplate,
            noCheckCertificates: true,
            maxFilesize: '24m',
            noWarnings: true
        });
        
        console.log("Download finished.");
        const files = fs.readdirSync(tmpDir);
        const matches = files.filter(f => f.startsWith(baseName));
        console.log("Found matching files:", matches);

    } catch(e) {
        console.error("yt-dlp Error:", e.message);
    }
}

run();
