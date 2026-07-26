export type VttSegment = { start: number; end: number; text: string };

const CUE_TIME_RE =
  /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})/;

// Some pipeline runs still tag cues with a diarization speaker label
// ("[SPEAKER_05_1]: ...") even though speaker identification is meant to
// come later from voice-sample matching, not this transcription step —
// strip it so it never lands in segment.text.
const SPEAKER_LABEL_RE = /^\[speaker[\w]*\]:?\s*/i;

function timeToSeconds(h: string, m: string, s: string, ms: string) {
  return Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

export function parseVtt(content: string): VttSegment[] {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  const segments: VttSegment[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim());
    const timeLineIndex = lines.findIndex((l) => CUE_TIME_RE.test(l));
    if (timeLineIndex === -1) continue;

    const match = lines[timeLineIndex].match(CUE_TIME_RE)!;
    const [, sh, sm, ss, sms, eh, em, es, ems] = match;
    const start = timeToSeconds(sh, sm, ss, sms);
    const end = timeToSeconds(eh, em, es, ems);

    const text = lines
      .slice(timeLineIndex + 1)
      .filter(Boolean)
      .join(" ")
      .trim()
      .replace(SPEAKER_LABEL_RE, "");

    if (text) segments.push({ start, end, text });
  }

  return segments;
}
