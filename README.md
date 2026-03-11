# VidBrief 🎥✨

**VidBrief** is a web application that takes YouTube videos and instantly generates concise summaries, key highlights, and full transcripts using powerful AI. 

Just paste a YouTube URL and let the AI do the heavy lifting for you!

## ✨ Features

- **Instant YouTube Transcripts**: Extracts subtitles directly from YouTube videos (supports both manual and auto-generated English captions).
- **AI-Powered Summaries**: Generates high-quality summaries of the video content.
- **Key Highlights Extraction**: Pulls out the most important points and takeaways.
- **Multiple AI Providers Supported**: 
  - Google Gemini
  - Groq
  - OpenRouter
  - Cerebras
  - xAI
- **Modern UI/UX**: Clean, responsive interface with a dark theme, gradient accents, and smooth transitions.
- **Copilot Integration**: Built-in chat interface to ask specific questions about the video content.

## 🚀 Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (Vite for bundling)
- **Backend**: Node.js, Express.js
- **Transcript Extraction**: `yt-dlp` (via `child_process`)
- **AI Integration**: `@google/generative-ai` and REST APIs for other providers

## 🛠️ Installation & Setup

### Prerequisites
- Node.js installed (v16+ recommended)
- `yt-dlp` installed and available in your system's PATH. You can get it from [yt-dlp's GitHub release page](https://github.com/yt-dlp/yt-dlp).

### Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/kaif10op/VidBrief.git
   cd VidBrief
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Setup:**
   Create a `.env` file in the root directory and add your preferred AI API keys:
   ```env
   GOOGLE_AI_KEY=your_gemini_api_key_here
   GROQ_API_KEY=your_groq_api_key_here
   OPENROUTER_API_KEY=your_openrouter_api_key_here
   CEREBRAS_API_KEY=your_cerebras_api_key_here
   XAI_API_KEY=your_xai_api_key_here
   ```
   *Note: You only need to provide keys for the AI services you intend to use.*

4. **Run the Application:**
   Start both the backend server and the Vite frontend concurrently:
   ```bash
   npm run dev
   ```

5. **Open in Browser:**
   The frontend should automatically open, typically at `http://localhost:5173/`. The backend server runs on `http://localhost:3000/`.

## 📂 Project Structure
- `index.html` - The main UI of the application.
- `style.css` - Custom styling ensuring a premium, dark-themed experience.
- `main.js` - Client-side logic handling UI interactions, API calls to the backend, and AI prompt generation.
- `server.js` - Express backend responsible for securely providing API keys to the frontend and fetching YouTube transcripts via `yt-dlp`.

## 🤝 Contributing
Contributions are welcome! Feel free to open issues or submit pull requests.

## 📝 License
This project is open-source.
