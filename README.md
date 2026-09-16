# AyahLink

Upload a Qur'an recitation. Get one audio file that goes:

**Arabic verse -> English voice -> Arabic verse -> English voice...**

## Stack

| Step | Tool |
|------|------|
| Translation text | [Quran.com API](https://api.quran.com/api/v4) |
| Ayah boundaries | OpenAI Whisper (if credits) -> silence -> text-length |
| English speech | Edge TTS (free, default) |
| Audio cut/merge | FFmpeg (`ffmpeg-static`) |

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000

Optional `.env.local`:

```
EDGE_TTS_VOICE=en-US-GuyNeural
TTS_PROVIDER=edge
OPENAI_API_KEY=sk-...
```

## Deploy to GitHub + Vercel (for your boss)

### 1) Push to GitHub

```bash
git add .
git commit -m "Prepare AyahLink for Vercel demo"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ayahlink.git
git push -u origin main
```

(Replace the GitHub URL with yours. Create an empty repo on GitHub first.)

### 2) Import in Vercel

1. Go to https://vercel.com/new
2. Import the GitHub repo
3. Framework: **Next.js** (auto-detected)
4. Add Environment Variables (optional but recommended):

| Name | Value | Notes |
|------|--------|------|
| `TTS_PROVIDER` | `edge` | Free English voice |
| `EDGE_TTS_VOICE` | `en-US-GuyNeural` | Optional |
| `OPENAI_API_KEY` | `sk-...` | Optional - better verse detection if you have credits |

5. Click **Deploy**

### 3) Share with your boss

Send the Vercel URL, for example:

`https://ayahlink-xxxx.vercel.app`

### Important demo tips for boss

- Use a **short** MP3 (under **25 MB**), ideally one short Surah only
- First test: **Al-Fatihah**, verses **1-7**
- Keep the browser tab open until the progress modal finishes
- You should hear Arabic, then the English translation, then the next verse
- Hobby Vercel plans have time limits - short files work best

## Scripts

- `npm run dev` - local development
- `npm run build` - production build
- `npm run start` - run production server

## Notes

- On Vercel, processing runs in one request (sync) so the result survives for preview/download
- Prefer short clear recitations with pauses between verses
- OpenAI key is optional; Edge TTS works without it
