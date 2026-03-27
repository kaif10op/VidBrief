import { Innertube } from 'youtubei.js';
import fs from 'fs';

async function run() {
    const videoId = '90IxM5XRPAE'; // The problematic video
    console.log("Testing:", videoId);
    
    try {
        const youtube = await Innertube.create({
            lang: 'en',
            location: 'US',
            retrieve_player: false
        });

        const info = await youtube.getInfo(videoId);
        const format = info.chooseFormat({ type: 'audio', quality: 'best' });
        
        console.log("Format found:", format.mime_type, format.content_length);
        
        // Let's just grab the direct URL and see if it works
        if (format.deciphered_url) {
            console.log("Got deciphered URL!");
            // Just test fetching 1MB
            const res = await fetch(format.deciphered_url, { headers: { Range: 'bytes=0-1000000' } });
            console.log("Fetch status:", res.status);
            const buffer = await res.arrayBuffer();
            console.log("Downloaded buffer size:", buffer.byteLength);
        } else {
             console.log("No url found.");
        }
        
    } catch(e) {
        console.error("Youtubei Error:", e.message);
    }
}

run();
