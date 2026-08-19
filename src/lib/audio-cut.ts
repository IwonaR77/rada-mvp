// Wycinanie fragmentu nagrania (mp3) wymaga ffmpeg na serwerze, a ten stoi
// tylko na maszynie domowej — publiczne wdrożenie na Vercelu go nie ma.
// Flaga włącza i trasę (src/app/sesje/[id]/fragment/route.ts), i przycisk
// przy bloku wypowiedzi; bez niej jedno i drugie po prostu nie istnieje.
export const AUDIO_CUT_ENABLED = process.env.RADA_AUDIO_CUT === "1";
