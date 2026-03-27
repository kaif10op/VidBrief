import ytdl from '@distube/ytdl-core';

async function run() {
    const videoId = '90IxM5XRPAE'; 
    console.log("Testing:", videoId);
    
    try {
        const info = await ytdl.getInfo(videoId);
        const format = ytdl.chooseFormat(info.formats, { filter: 'audioonly' });
        console.log("Found format:", format.mimeType, format.url.substring(0, 50) + "...");
        
        // Let's just do a simple fetch to see if URL works
        const res = await fetch(format.url, { headers: { Range: 'bytes=0-1000' }});
        console.log("Status:", res.status);
    } catch(e) {
        console.error("YTDL Error:", e.message);
    }
}

run();
