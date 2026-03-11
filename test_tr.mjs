const videoId = 'rfscVS0vtbw';

async function test() {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });
    
    const html = await pageRes.text();
    
    const tracksMatch = html.match(/"captionTracks":\s*(\[.*?\])/s);
    const tracks = JSON.parse(tracksMatch[1]);
    console.log('Track 0 full:', JSON.stringify(tracks[0]).substring(0, 300));
    console.log('---');
    
    // The baseUrl might have escaped characters
    let captionUrl = tracks[0].baseUrl;
    console.log('Raw URL:', captionUrl.substring(0, 150));
    
    // Try with fmt=json3
    const jsonUrl = captionUrl + '&fmt=json3';
    console.log('Trying json3 format...');
    const res1 = await fetch(jsonUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const text1 = await res1.text();
    console.log('json3 length:', text1.length);
    console.log('json3 sample:', text1.substring(0, 300));
}

test().catch(e => console.error(e));
