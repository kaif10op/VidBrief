import fs from 'fs';

async function run() {
    const filePath = 'C:\\Users\\mkaif\\AppData\\Local\\Temp\\audio_90IxM5XRPAE_1774635875392.webm';
    console.log("Reading file:", filePath);
    
    try {
        const buffer = fs.readFileSync(filePath);
        console.log("Buffer size:", buffer.byteLength);
        
        const blob = new Blob([buffer], { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('file', blob, 'audio.webm');
        formData.append('model', 'whisper-large-v3-turbo');
        
        console.log("Sending to Groq...");
        const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
             method: 'POST',
             headers: {
                 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
             },
             body: formData
        });
        
        const str = await res.text();
        console.log("Groq status:", res.status, str.substring(0, 100));
        
    } catch(e) {
        console.error("Test error:", e.message);
    }
}

run();
