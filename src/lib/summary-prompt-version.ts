// Bump this whenever prompty-prywatne/summary/prompt.md changes in a way that would
// meaningfully change existing summaries' content — meeting rows whose
// summary_prompt_version is lower then read as "generated with an older
// prompt", which the timeline flags (red session number) as a reminder to
// regenerate that session's summary.
export const CURRENT_SUMMARY_PROMPT_VERSION = 4;
