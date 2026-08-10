import { currentSummaryPromptVersion } from "@/lib/summary-prompt";

// Wersja promptu podsumowań. Posiedzenia z niższym summary_prompt_version
// czytają się jako „wygenerowane starszym promptem", co oś czasu oznacza
// (czerwony numer sesji) jako przypomnienie, że warto je odświeżyć.
//
// Numer nie jest już wpisywany ręcznie — pochodzi z nagłówka samego pliku
// promptu w prompty/, patrz src/lib/summary-prompt.ts.
export const CURRENT_SUMMARY_PROMPT_VERSION = currentSummaryPromptVersion();
