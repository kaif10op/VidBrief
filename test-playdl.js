import play from 'play-dl';

async function run() {
    const videoUrl = 'https://www.youtube.com/watch?v=90IxM5XRPAE'; 
    console.log("Testing:", videoUrl);
    
    try {
        const stream = await play.stream(videoUrl, { discordPlayerCompatibility: true });
        console.log("Found stream type:", stream.type);
        console.log("Stream URL:", stream.url?.substring(0, 100) + "...");
        
        if (stream.url) {
            const res = await fetch(stream.url, { headers: { Range: 'bytes=0-1000' }});
            console.log("Status:", res.status);
            console.log("Headers:", [...res.headers.entries()]);
        }
    } catch(e) {
        console.error("Play-dl Error:", e.message);
    }
}

run();
