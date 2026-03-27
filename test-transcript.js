// Debug the baseUrl issue
async function test() {
    const videoId = 'dQw4w9WgXcQ';
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    const pageRes = await fetch(pageUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        }
    });
    
    const html = await pageRes.text();
    
    const tracksMatch = html.match(/"captionTracks":\s*(\[.*?\])/s);
    
    // The raw match still has \u0026 escapes; JSON.parse should handle them
    const tracks = JSON.parse(tracksMatch[1]);
    const track = tracks[0];
    
    // Check the raw baseUrl
    console.log('baseUrl (first 200):', track.baseUrl.substring(0, 200));
    console.log('Contains \\u0026:', track.baseUrl.includes('\\u0026'));
    console.log('Contains &:', track.baseUrl.includes('&'));
    
    // Try fetching with proper user agent
    const captionRes = await fetch(track.baseUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }
    });
    console.log('Caption status:', captionRes.status);
    const xml = await captionRes.text();
    console.log('XML length:', xml.length);
    console.log('XML first 300:', xml.substring(0, 300));
}

test().catch(e => console.error('ERROR:', e.message));
